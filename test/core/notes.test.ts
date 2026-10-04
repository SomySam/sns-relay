import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace, loadConfig } from '../../src/core/config.js'
import { readDrafts } from '../../src/core/draft-files.js'
import { fetchArticle } from '../../src/core/fetch-article.js'
import { createFromNotes, imagePublicId, rehostImage } from '../../src/core/notes.js'
import { readArticle } from '../../src/core/workspace.js'
import { installMockAgent, makeTempDir } from '../helpers.js'
import { fakeJpeg } from '../jpeg-helpers.js'

const sha6 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 6)
const NOW = () => new Date('2026-10-01T00:00:00Z')
const JSON_HEADERS = { headers: { 'content-type': 'application/json' } }
let agent: MockAgent
let restore: () => Promise<void>
let root: string

beforeEach(async () => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  await initWorkspace(root)
})
afterEach(() => restore())

const useCloudinary = async () => {
  const config = await loadConfig(root)
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, imageHost: 'cloudinary' }, null, 2))
  writeFileSync(join(root, '.env'), 'CLOUDINARY_CLOUD_NAME=demo\nCLOUDINARY_API_KEY=123456\nCLOUDINARY_API_SECRET=CLSECRET999\n')
}
const uploadOk = (publicId = 'sns-relay/notes-1790812800', version = 11) =>
  agent
    .get('https://api.cloudinary.com')
    .intercept({ path: '/v1_1/demo/image/upload', method: 'POST' })
    .reply(200, { public_id: publicId, version, width: 1200, height: 900 }, JSON_HEADERS)

describe('imagePublicId', () => {
  it('영문·숫자 부분 + 작업 이름 해시 6자 + 초', () => {
    expect(imagePublicId('Move photo', NOW)).toBe(`move-photo-${sha6('Move photo')}-1790812800`)
  })
  it('한글 이름은 notes 로 쓰고, 이름이 다르면 해시가 달라 겹치지 않는다', () => {
    const a = imagePublicId('동네-카페', NOW)
    const b = imagePublicId('창가-자리', NOW)
    expect(a).toBe(`notes-${sha6('동네-카페')}-1790812800`)
    expect(a).not.toBe(b)
  })
})

describe('사진 여러 장', () => {
  const photo = (name: string) => {
    const file = join(makeTempDir(), name)
    writeFileSync(file, Buffer.from(fakeJpeg(1200, 900)))
    return file
  }
  const upload = (n: number) =>
    agent
      .get('https://api.cloudinary.com')
      .intercept({ path: '/v1_1/demo/image/upload', method: 'POST' })
      .reply(200, { public_id: `sns-relay/n-${n}`, version: n, width: 1200, height: 900 }, JSON_HEADERS)

  it('imagePublicId 는 순번을 붙인다', () => {
    expect(imagePublicId('Move photo', NOW, 1)).toBe(`move-photo-${sha6('Move photo')}-1790812800-2`)
  })

  it('3장(파일 2 + 주소 1)을 차례로 올려 images 3개, 첫 장이 대표', async () => {
    await useCloudinary()
    upload(1)
    upload(2)
    upload(3)
    const r = await createFromNotes(root, { title: '세 장', text: '글감', images: [{ file: photo('a.jpg') }, { file: photo('b.jpg') }, { url: 'https://img.test/c.jpg' }] }, NOW)
    expect(r.uploaded).toBe(true)
    expect(r.article.images).toHaveLength(3)
    expect(r.article.image).toBe(r.article.images![0])
    expect(new Set(r.article.images).size).toBe(3)
    expect(r.article.images![2]).toContain('/v3/sns-relay/n-3')
    expect(await readArticle(root, r.article.id)).toMatchObject({ images: r.article.images })
  })

  it('한 장짜리 목록은 images 없이 기존과 같다', async () => {
    const r = await createFromNotes(root, { title: '한 장', text: '글감', images: [{ url: 'https://img.test/a.jpg' }] }, NOW)
    expect(r.article.image).toBe('https://img.test/a.jpg')
    expect(r.article.images).toBeUndefined()
  })

  it('11장이면 업로드 전에 오류', async () => {
    await useCloudinary()
    const images = Array.from({ length: 11 }, (_, i) => ({ url: `https://img.test/${i}.jpg` }))
    await expect(createFromNotes(root, { title: '열한 장', text: '글감', images }, NOW)).rejects.toThrow('사진은 10장까지')
  })

  it('올리다 실패하면 작업을 저장하지 않는다', async () => {
    await useCloudinary()
    upload(1)
    agent.get('https://api.cloudinary.com').intercept({ path: '/v1_1/demo/image/upload', method: 'POST' }).reply(400, { error: { message: 'bad' } }, JSON_HEADERS)
    await expect(createFromNotes(root, { title: '실패', text: '글감', images: [{ url: 'https://img.test/a.jpg' }, { url: 'https://img.test/b.jpg' }] }, NOW)).rejects.toThrow()
    expect(await readArticle(root, '실패')).toBeNull()
  })

  it('rehostImage 에 목록을 주면 사진 전체가 바뀌고 초안 사진도 갱신된다', async () => {
    const made = await createFromNotes(root, { title: 'Swap all', text: '글감', image: { url: 'https://img.test/a.jpg' } }, NOW)
    await useCloudinary()
    upload(1)
    upload(2)
    const r = await rehostImage(root, made.article.id, [{ url: 'https://img.test/x.jpg' }, { url: 'https://img.test/y.jpg' }], NOW)
    expect([...r.reimaged].sort()).toEqual(['facebook', 'instagram', 'threads'])
    expect(r.urls).toHaveLength(2)
    const saved = (await readArticle(root, made.article.id))!
    expect(saved.images).toEqual(r.urls)
    expect(saved.image).toBe(r.urls[0])
  })

  it('--article 은 목록 작업의 첫 장만 바꾸고 나머지는 유지한다', async () => {
    const made = await createFromNotes(root, { title: 'Keep rest', text: '글감', images: [{ url: 'https://img.test/a.webp' }, { url: 'https://img.test/b.jpg' }] }, NOW)
    await useCloudinary()
    upload(5)
    const r = await rehostImage(root, made.article.id, { article: true }, NOW)
    const saved = (await readArticle(root, made.article.id))!
    expect(saved.images).toEqual([r.url, 'https://img.test/b.jpg'])
  })
})

describe('createFromNotes', () => {
  it('글감만으로 링크 없는 작업을 만든다', async () => {
    const r = await createFromNotes(root, { title: '동네 카페 창가 자리', text: '오후 세 시 창가.' }, NOW)
    expect(r.article).toMatchObject({ id: '동네-카페-창가-자리', source: 'notes', canonicalUrl: '', image: null, links: {} })
    expect(r.drafts.created).toEqual(['threads', 'instagram', 'facebook', 'naver'])
    expect(r.uploaded).toBe(false)
    const { views } = await readDrafts(root, r.article.id)
    expect(views.every((v) => v.draft?.link === '')).toBe(true)
  })

  it('링크를 주면 UTM 링크가 붙는다', async () => {
    const r = await createFromNotes(root, { title: '행사 안내', text: '토요일 행사.', link: 'https://blog.example.com/event' }, NOW)
    expect(r.article.canonicalUrl).toBe('https://blog.example.com/event')
    expect(r.article.links.threads).toContain('utm_source=threads')
  })

  it('imageHost 가 url 이면 로컬 사진은 거부하고 설정을 안내한다', async () => {
    const file = join(makeTempDir(), 'p.jpg')
    writeFileSync(file, Buffer.from(fakeJpeg(1200, 900)))
    await expect(createFromNotes(root, { title: '사진', text: '글감', image: { file } }, NOW)).rejects.toThrow('imageHost')
  })

  it('imageHost 가 url 이면 이미지 주소를 그대로 쓴다', async () => {
    const r = await createFromNotes(root, { title: '주소 사진', text: '글감', image: { url: 'https://img.test/a.jpg' } }, NOW)
    expect(r.article.image).toBe('https://img.test/a.jpg')
    expect(r.uploaded).toBe(false)
  })

  it('cloudinary 면 로컬 사진을 올려 JPEG 주소를 쓰고, 초안 사진에도 들어간다', async () => {
    await useCloudinary()
    uploadOk()
    const file = join(makeTempDir(), 'p.png')
    writeFileSync(file, Buffer.from(fakeJpeg(1200, 900)))
    const r = await createFromNotes(root, { title: '동네 카페 창가 자리', text: '글감', image: { file } }, NOW)
    expect(r.uploaded).toBe(true)
    expect(r.article.image).toBe('https://res.cloudinary.com/demo/image/upload/q_85/v11/sns-relay/notes-1790812800.jpg')
    const { views } = await readDrafts(root, r.article.id)
    expect(views.find((v) => v.channel === 'threads')!.draft!.image).toBe(r.article.image)
  })

  it('cloudinary 모드에서도 http(s) 가 아닌 이미지 주소는 요청 없이 거절한다', async () => {
    await useCloudinary()
    await expect(createFromNotes(root, { title: '주소', text: '글감', image: { url: 'ftp://x/a.jpg' } }, NOW)).rejects.toThrow('http(s)')
  })

  it('같은 작업 이름이 있으면 오류', async () => {
    await createFromNotes(root, { title: '같은 제목', text: '하나' }, NOW)
    await expect(createFromNotes(root, { title: '같은 제목', text: '둘' }, NOW)).rejects.toThrow('이미 있습니다')
  })

  it('제목·글감이 비면 오류', async () => {
    await expect(createFromNotes(root, { title: ' ', text: '글감' }, NOW)).rejects.toThrow('제목')
    await expect(createFromNotes(root, { title: '제목', text: ' ' }, NOW)).rejects.toThrow('글감')
  })
})

describe('rehostImage', () => {
  it('작업 대표 이미지를 Cloudinary 로 옮기고 초안 사진을 바꾼다', async () => {
    const made = await createFromNotes(root, { title: 'Move photo', text: '글감', image: { url: 'https://img.test/a.webp' } }, NOW)
    await useCloudinary()
    uploadOk('sns-relay/move-photo-1790812800', 12)
    const r = await rehostImage(root, made.article.id, { article: true }, NOW)
    expect(r.url).toBe('https://res.cloudinary.com/demo/image/upload/q_85/v12/sns-relay/move-photo-1790812800.jpg')
    expect([...r.reimaged].sort()).toEqual(['facebook', 'instagram', 'threads'])
    expect((await readArticle(root, made.article.id))!.image).toBe(r.url)
  })

  it('imageHost 가 url 이면 안내 오류', async () => {
    const made = await createFromNotes(root, { title: 'No host', text: '글감', image: { url: 'https://img.test/a.jpg' } }, NOW)
    await expect(rehostImage(root, made.article.id, { article: true }, NOW)).rejects.toThrow('imageHost')
  })
})

describe('블로그 다시 가져오기와 옮긴 사진', () => {
  const html = readFileSync(new URL('../fixtures/article.html', import.meta.url), 'utf8')
  const HTML_HEADERS = { headers: { 'content-type': 'text/html; charset=utf-8' } }
  const BLOG = 'https://blog.example.com/blog/ai-task-brief'
  const blog = () => agent.get('https://blog.example.com').intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS)

  it('--article 로 옮긴 사진은 같은 og:image 로 다시 가져와도 유지된다', async () => {
    blog()
    const first = await fetchArticle(root, BLOG, { now: NOW })
    await useCloudinary()
    uploadOk('sns-relay/ai-task-brief-x-1', 21)
    const moved = await rehostImage(root, first.article.id, { article: true }, NOW)
    const before = await readArticle(root, first.article.id)
    expect(before!.image).toBe(moved.url)
    expect(before!.imageOrigin).toBe('https://blog.example.com/images/cover.jpg')

    blog()
    const again = await fetchArticle(root, BLOG, { now: NOW })
    expect(again.article.image).toBe(moved.url)
    expect(again.article.imageOrigin).toBe('https://blog.example.com/images/cover.jpg')
    expect(again.drafts.reimaged).toEqual([])
  })

  it('글감으로 만든 작업 이름에는 fetch 가 덮어쓰지 못한다', async () => {
    await createFromNotes(root, { title: '글감 작업', text: '글감', id: 'ai-task-brief' }, NOW)
    blog()
    await expect(fetchArticle(root, BLOG, { now: NOW })).rejects.toThrow('글감으로 만든 작업입니다')
  })
})
