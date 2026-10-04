import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace, loadConfig } from '../../src/core/config.js'
import { fakeJpeg } from '../jpeg-helpers.js'
import { installMockAgent, makeTempDir } from '../helpers.js'
import { connect } from '../mcp-helpers.js'

const html = readFileSync(new URL('../fixtures/article.html', import.meta.url), 'utf8')
const HTML_HEADERS = { headers: { 'content-type': 'text/html; charset=utf-8' } }
const URL_ = 'https://blog.example.com/blog/ai-task-brief'

let agent: MockAgent
let restore: () => Promise<void>
let root: string
let mcp: Awaited<ReturnType<typeof connect>>

beforeEach(async () => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  await initWorkspace(root)
  mcp = await connect(root, { now: () => new Date('2026-09-30T00:00:00Z') })
})
afterEach(async () => {
  await mcp.close()
  await restore()
})

describe('fetch_article', () => {
  it('본문과 규칙을 돌려주고 초안 파일을 만든다', async () => {
    agent.get('https://blog.example.com').intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS)
    const r = await mcp.call('fetch_article', { url: URL_ })
    expect(r.isError).toBe(false)
    expect(r.data.id).toBe('ai-task-brief')
    expect(r.data.text.length).toBeGreaterThan(100)
    expect(r.data.rules).toContain('판매 문구를 쓰지 않는다')
    expect(r.data.drafts.created).toEqual(['threads', 'instagram', 'facebook', 'naver'])
    expect(r.text).toContain('save_drafts')
  })

  it('규칙에 계정 말투 메모가 들어간다', async () => {
    const cfgPath = join(root, 'config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, notes: { common: '짧은 호흡' } }))
    agent.get('https://blog.example.com').intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS)
    const r = await mcp.call('fetch_article', { url: URL_ })
    expect(r.data.rules).toContain('짧은 호흡')
  })

  it('주소가 틀리면 오류', async () => {
    const r = await mcp.call('fetch_article', { url: 'not a url' })
    expect(r.isError).toBe(true)
  })
})

describe('save_drafts', () => {
  it('저장한 뒤 검증 결과를 함께 돌려준다', async () => {
    agent.get('https://blog.example.com').intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS)
    await mcp.call('fetch_article', { url: URL_ })
    const r = await mcp.call('save_drafts', {
      id: 'ai-task-brief',
      drafts: [{ channel: 'threads', body: '짧은 글 https://example.com' }],
    })
    expect(r.isError).toBe(false)
    expect(r.data.results).toEqual([{ channel: 'threads', saved: true }])
    const threads = r.data.drafts.find((d: { channel: string }) => d.channel === 'threads')
    expect(threads.problems.some((p: { level: string }) => p.level === 'error')).toBe(true)
    expect(r.text).toContain('threads 저장')
  })

  it('없는 채널 이름은 입력 검증에서 막힌다', async () => {
    const r = await mcp.call('save_drafts', { id: 'ai-task-brief', drafts: [{ channel: 'x', body: '가' }] })
    expect(r.isError).toBe(true)
  })

  it('id 가 위험하면 오류', async () => {
    const r = await mcp.call('save_drafts', { id: '../x', drafts: [{ channel: 'threads', body: '가' }] })
    expect(r.isError).toBe(true)
  })

  it('threads 에 title 을 주면 저장하지 않는다', async () => {
    agent.get('https://blog.example.com').intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS)
    await mcp.call('fetch_article', { url: URL_ })
    const r = await mcp.call('save_drafts', { id: 'ai-task-brief', drafts: [{ channel: 'threads', body: '가', title: '제목' }] })
    expect(r.data.results[0].saved).toBe(false)
    expect(r.data.results[0].reason).toContain('네이버 초안만')
  })
})

describe('create_from_notes · rehost_image', () => {
  it('글감으로 링크 없는 작업을 만든다', async () => {
    const r = await mcp.call('create_from_notes', { title: '동네 카페', text: '창가 자리.' })
    expect(r.isError).toBe(false)
    expect(r.data.id).toBe('동네-카페')
    expect(r.data.link).toBeNull()
    expect(r.data.rules).toContain('판매 문구를 쓰지 않는다')
    expect(r.text).toContain('링크 없음')
  })

  it('image_path 와 image_url 을 같이 주면 오류', async () => {
    const r = await mcp.call('create_from_notes', { title: '사진', text: '글감', image_path: 'a.jpg', image_url: 'https://img.test/a.jpg' })
    expect(r.isError).toBe(true)
  })

  it('상대 image_path 는 작업 폴더 기준으로 읽는다', async () => {
    const config = await loadConfig(root)
    writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, imageHost: 'cloudinary' }, null, 2))
    writeFileSync(join(root, '.env'), 'CLOUDINARY_CLOUD_NAME=demo\nCLOUDINARY_API_KEY=123456\nCLOUDINARY_API_SECRET=CLSECRET999\n')
    writeFileSync(join(root, 'photo.jpg'), Buffer.from(fakeJpeg(1200, 900)))
    agent
      .get('https://api.cloudinary.com')
      .intercept({ path: '/v1_1/demo/image/upload', method: 'POST' })
      .reply(200, { public_id: 'sns-relay/x-1', version: 7, width: 1200, height: 900 }, { headers: { 'content-type': 'application/json' } })
    const r = await mcp.call('create_from_notes', { title: '상대 경로', text: '글감', image_path: 'photo.jpg' })
    expect(r.isError).toBe(false)
    expect(r.text).not.toContain('CLSECRET999')
  })

  const cloudinaryOn = async () => {
    const config = await loadConfig(root)
    writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, imageHost: 'cloudinary' }, null, 2))
    writeFileSync(join(root, '.env'), 'CLOUDINARY_CLOUD_NAME=demo\nCLOUDINARY_API_KEY=123456\nCLOUDINARY_API_SECRET=CLSECRET999\n')
    for (const n of [1, 2])
      agent
        .get('https://api.cloudinary.com')
        .intercept({ path: '/v1_1/demo/image/upload', method: 'POST' })
        .reply(200, { public_id: `sns-relay/x-${n}`, version: n, width: 1200, height: 900 }, { headers: { 'content-type': 'application/json' } })
  }

  it('image_paths 두 장이면 data.images 길이 2', async () => {
    await cloudinaryOn()
    writeFileSync(join(root, 'a.jpg'), Buffer.from(fakeJpeg(1200, 900)))
    writeFileSync(join(root, 'b.jpg'), Buffer.from(fakeJpeg(1200, 900)))
    const r = await mcp.call('create_from_notes', { title: '두 장', text: '글감', image_paths: ['a.jpg', 'b.jpg'] })
    expect(r.isError).toBe(false)
    expect(r.data.images).toHaveLength(2)
    expect(r.data.image).toBe(r.data.images[0])
    expect(r.text).toContain('사진 2장 올림')
  })

  it('image_urls 로 rehost_image 하면 사진 전체가 바뀐다', async () => {
    await mcp.call('create_from_notes', { title: '주소 글', text: '글감', image_url: 'https://img.test/a.jpg' })
    await cloudinaryOn()
    const r = await mcp.call('rehost_image', { id: '주소-글', image_urls: ['https://img.test/x.jpg', 'https://img.test/y.jpg'] })
    expect(r.isError).toBe(false)
    expect(r.data.urls).toHaveLength(2)
  })

  it('단일 사진과 목록을 섞으면 create_from_notes·rehost_image 모두 오류', async () => {
    const msg = '사진은 image_path·image_url 하나, 또는 image_paths·image_urls 목록으로 주세요(섞지 않음).'
    const a = await mcp.call('create_from_notes', { title: '섞기', text: '글감', image_url: 'https://img.test/a.jpg', image_urls: ['https://img.test/b.jpg'] })
    expect(a.isError).toBe(true)
    expect(a.text).toContain(msg)
    const b = await mcp.call('rehost_image', { id: 'x', image_path: 'a.jpg', image_urls: ['https://img.test/b.jpg'] })
    expect(b.isError).toBe(true)
    expect(b.text).toContain(msg)
  })

  it('rehost_image 에 인자가 없으면 오류', async () => {
    const r = await mcp.call('rehost_image', { id: 'x' })
    expect(r.isError).toBe(true)
  })
})
