import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { loadConfig } from '../../src/core/config.js'
import { draftPath, ensureDraftFiles, readDrafts } from '../../src/core/draft-files.js'
import { hashDraft, parseDraft, serializeDraft } from '../../src/core/drafts.js'
import { saveArticle } from '../../src/core/workspace.js'
import { getCell, loadState, saveState, setCell, updateState } from '../../src/core/state.js'
import { ARTICLE, NOTES_ARTICLE, NOTES_ARTICLE_MULTI, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'

const ID = ARTICLE.id
const NOW = () => new Date('2026-09-29T02:00:00Z')

/** approve 없이 state 에 승인 칸을 직접 만든다 (Task 6 전이라 여기서는 손으로) */
async function markApproved(root: string, channel: 'threads') {
  const path = draftPath(root, ID, channel)
  const draft = { ...parseDraft(readFileSync(path, 'utf8'), channel), approved: true }
  writeFileSync(path, serializeDraft(draft))
  const state = await loadState(root)
  setCell(state, ID, channel, { status: 'approved', hash: hashDraft(draft) }, NOW())
  await saveState(root, state)
}

describe('ensureDraftFiles', () => {
  it('설정의 채널마다 빈 초안 파일을 만든다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    for (const ch of ['threads', 'instagram', 'facebook', 'naver'] as const) {
      expect(existsSync(draftPath(root, ID, ch))).toBe(true)
    }
    expect(draftPath(root, ID, 'threads')).toBe(join(root, 'work', ID, 'drafts', 'threads.md'))
  })

  it('다시 불러도 본문을 덮어쓰지 않는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    const r = await ensureDraftFiles(root, ARTICLE, await loadConfig(root))
    expect(r).toEqual({ created: [], relinked: [], reimaged: [] })
    expect(parseDraft(readFileSync(draftPath(root, ID, 'threads'), 'utf8'), 'threads').body).toBe(VALID_BODIES.threads)
  })

  it('대표 이미지가 바뀌면 인스타 초안 이미지를 바꾸고 승인을 푼다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'instagram', VALID_BODIES.instagram)
    await approveDrafts(root, ID, ['instagram'], NOW)
    const updated = { ...ARTICLE, image: 'https://blog.example.com/images/cover-new.jpg' }
    const r = await ensureDraftFiles(root, updated, await loadConfig(root))
    expect(r.reimaged).toEqual(['instagram'])
    const d = parseDraft(readFileSync(draftPath(root, ID, 'instagram'), 'utf8'), 'instagram')
    expect(d.image).toBe('https://blog.example.com/images/cover-new.jpg')
    expect(d.approved).toBe(false)
    expect(d.body).toBe(VALID_BODIES.instagram)
    expect(getCell(await loadState(root), ID, 'instagram')?.status).toBe('draft')
  })

  it('이미지가 같으면 아무것도 바꾸지 않는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    expect((await ensureDraftFiles(root, ARTICLE, await loadConfig(root))).reimaged).toEqual([])
  })

  it('UTM 설정이 바뀌면 링크만 바꾸고 승인을 푼다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await markApproved(root, 'threads')

    const config = await loadConfig(root)
    const changed = { ...config, utm: { ...config.utm, source: { ...config.utm.source, threads: 'th' } } }
    const r = await ensureDraftFiles(root, ARTICLE, changed)

    expect(r.relinked).toEqual(['threads'])
    const d = parseDraft(readFileSync(draftPath(root, ID, 'threads'), 'utf8'), 'threads')
    expect(d.link).toContain('utm_source=th&')
    expect(d.approved).toBe(false)
    expect(d.body).toBe(VALID_BODIES.threads)
  })

  it('링크를 다시 맞출 때 state 의 승인 칸도 draft 로 되돌린다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await markApproved(root, 'threads')

    const config = await loadConfig(root)
    const changed = { ...config, utm: { ...config.utm, source: { ...config.utm.source, threads: 'th' } } }
    await ensureDraftFiles(root, ARTICLE, changed)

    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('draft')
  })
})

describe('readDrafts', () => {
  it('빈 초안은 미승인이고 "본문이 비어 있습니다" 오류가 있다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const { views } = await readDrafts(root, ID, NOW)
    expect(views.map((v) => v.channel)).toEqual(['threads', 'instagram', 'facebook', 'naver'])
    expect(views.every((v) => !v.approved)).toBe(true)
    expect(views[0].problems.map((p) => p.message)).toContain('본문이 비어 있습니다.')
  })

  it('파일·state·해시가 모두 맞으면 승인됨', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await markApproved(root, 'threads')
    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].approved).toBe(true)
  })

  it('승인 뒤 본문을 고치면 승인이 풀리고 파일·state 도 되돌린다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await markApproved(root, 'threads')
    writeBody(root, ID, 'threads', VALID_BODIES.threads + ' 수정')

    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].approved).toBe(false)
    expect(parseDraft(readFileSync(draftPath(root, ID, 'threads'), 'utf8'), 'threads').approved).toBe(false)
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('draft')
  })

  it('파일에 approved: true 를 손으로 써도 승인되지 않는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const path = draftPath(root, ID, 'threads')
    const d = parseDraft(readFileSync(path, 'utf8'), 'threads')
    writeFileSync(path, serializeDraft({ ...d, body: VALID_BODIES.threads, approved: true }))

    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].approved).toBe(false)
    expect(parseDraft(readFileSync(path, 'utf8'), 'threads').approved).toBe(false)
  })

  it('형식이 깨진 파일은 draft: null 과 오류로 보여 준다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeFileSync(draftPath(root, ID, 'facebook'), '본문만 있음')
    const { views } = await readDrafts(root, ID, NOW)
    const fb = views.find((v) => v.channel === 'facebook')!
    expect(fb.draft).toBeNull()
    expect(fb.problems[0].message).toContain('초안 형식 오류')
  })

  const LINK_ERROR = '링크가 현재 설정과 다릅니다. 링크는 프로그램이 만듭니다 — `sns-relay fetch <글 주소>` 를 다시 실행하면 맞춰집니다.'

  it('링크를 손으로 고치면 오류이고 승인되지 않는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    const path = draftPath(root, ID, 'threads')
    const d = parseDraft(readFileSync(path, 'utf8'), 'threads')
    writeFileSync(path, serializeDraft({ ...d, link: 'https://evil.example/x' }))

    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].problems).toContainEqual({ level: 'error', message: LINK_ERROR })
    const [r] = await approveDrafts(root, ID, ['threads'], NOW)
    expect(r.approved).toBe(false)
    expect(r.problems.map((p) => p.message)).toContain(LINK_ERROR)
  })

  it('UTM 설정이 바뀌면 다시 가져오기 전까지 링크 오류가 나고, 다시 맞추면 사라진다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    expect((await readDrafts(root, ID, NOW)).views[0].problems.map((p) => p.message)).not.toContain(LINK_ERROR)

    const configPath = join(root, 'config.json')
    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    raw.utm.source.threads = 'th'
    writeFileSync(configPath, JSON.stringify(raw))
    expect((await readDrafts(root, ID, NOW)).views[0].problems.map((p) => p.message)).toContain(LINK_ERROR)

    await ensureDraftFiles(root, ARTICLE, await loadConfig(root))
    expect((await readDrafts(root, ID, NOW)).views[0].problems.map((p) => p.message)).not.toContain(LINK_ERROR)
  })

  it('인스타 이미지가 글의 대표 이미지와 다르면 경고한다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'instagram', VALID_BODIES.instagram)
    const msg = '이미지가 글의 대표 이미지와 다릅니다.'
    expect((await readDrafts(root, ID, NOW)).views[1].problems.map((p) => p.message)).not.toContain(msg)

    const path = draftPath(root, ID, 'instagram')
    const d = parseDraft(readFileSync(path, 'utf8'), 'instagram')
    writeFileSync(path, serializeDraft({ ...d, image: 'https://blog.example.com/images/other.jpg' }))
    const view = (await readDrafts(root, ID, NOW)).views[1]
    expect(view.problems).toContainEqual({ level: 'warn', message: msg })
  })

  it('링크 없는 작업에서 스레드·페이스북 사진이 작업 사진과 다르면 경고한다', async () => {
    const root = makeTempDir()
    await setupDrafts(root, NOTES_ARTICLE)
    const msg = '사진이 작업 사진과 다릅니다.'
    const view = async (i: number) => (await readDrafts(root, NOTES_ARTICLE.id, NOW)).views[i]
    expect((await view(0)).problems.map((p) => p.message)).not.toContain(msg)
    for (const [i, ch] of [[0, 'threads'], [2, 'facebook']] as const) {
      const path = draftPath(root, NOTES_ARTICLE.id, ch)
      const d = parseDraft(readFileSync(path, 'utf8'), ch)
      writeFileSync(path, serializeDraft({ ...d, image: 'https://img.test/other.jpg' }))
      expect((await view(i)).problems).toContainEqual({ level: 'warn', message: msg })
    }
  })

  it('네이버 제목이 원문 제목 그대로면 경고하고, 고치면 사라진다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    const msg = '네이버 제목이 원문 제목 그대로입니다. 검색어가 들어간 제목으로 고치세요.'
    const naver = async () => (await readDrafts(root, ID, NOW)).views[3]
    expect((await naver()).problems).toContainEqual({ level: 'warn', message: msg })

    const path = draftPath(root, ID, 'naver')
    const d = parseDraft(readFileSync(path, 'utf8'), 'naver')
    writeFileSync(path, serializeDraft({ ...d, title: 'AI 업무 브리프 템플릿 — 쓰는 법 정리' }))
    expect((await naver()).problems.map((p) => p.message)).not.toContain(msg)
  })

  it('없는 작업이면 fetch 를 안내한다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    await expect(readDrafts(root, 'nope', NOW)).rejects.toThrow('sns-relay fetch')
  })
})

describe('readDrafts — 게시 뒤 상태', () => {
  async function approvedThreads(root: string) {
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await approveDrafts(root, ID, ['threads'], NOW)
    return getCell(await loadState(root), ID, 'threads')!.hash!
  }

  it('failed 칸은 내용이 같으면 승인을 유지한다 (원인만 고치고 다시 게시)', async () => {
    const root = makeTempDir()
    const hash = await approvedThreads(root)
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'failed', hash, reason: '토큰 만료' }, NOW())
    })
    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].approved).toBe(true)
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('failed')
  })

  it('failed 칸도 내용을 고치면 승인이 풀린다', async () => {
    const root = makeTempDir()
    const hash = await approvedThreads(root)
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'failed', hash }, NOW())
    })
    writeBody(root, ID, 'threads', VALID_BODIES.threads + '!')
    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].approved).toBe(false)
  })

  it('unknown 칸은 승인이 아니지만 초안 파일의 approved 는 되돌리지 않는다', async () => {
    const root = makeTempDir()
    const hash = await approvedThreads(root)
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'unknown', hash }, NOW())
    })
    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].approved).toBe(false)
    expect(parseDraft(readFileSync(draftPath(root, ID, 'threads'), 'utf8'), 'threads').approved).toBe(true)
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('unknown')
  })
})

describe('링크 없는 작업', () => {
  it('readDrafts 가 링크 오류를 내지 않는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root, NOTES_ARTICLE)
    writeBody(root, NOTES_ARTICLE.id, 'threads', '창가 자리에 앉아 본 적 있나요?')
    const { views } = await readDrafts(root, NOTES_ARTICLE.id)
    const threads = views.find((v) => v.channel === 'threads')!
    expect(threads.problems.some((p) => p.message.includes('링크가 현재 설정과 다릅니다'))).toBe(false)
  })

  it('작업 사진이 바뀌면 스레드·페이스북·인스타 초안 사진도 바뀌고 승인이 풀린다', async () => {
    const root = makeTempDir()
    await setupDrafts(root, NOTES_ARTICLE)
    const changed = { ...NOTES_ARTICLE, image: 'https://res.cloudinary.com/demo/image/upload/q_85/v2/sns-relay/cafe-notes-2.jpg' }
    await saveArticle(root, changed)
    const r = await ensureDraftFiles(root, changed, await loadConfig(root))
    expect(r.reimaged.sort()).toEqual(['facebook', 'instagram', 'threads'])
  })
})

describe('사진 목록', () => {
  it('사진 순서만 바뀌어도 threads·instagram·facebook 이 reimaged 다', async () => {
    const root = makeTempDir()
    await setupDrafts(root, NOTES_ARTICLE_MULTI)
    const reordered = { ...NOTES_ARTICLE_MULTI, images: [...NOTES_ARTICLE_MULTI.images!].reverse() }
    const r = await ensureDraftFiles(root, reordered, await loadConfig(root))
    expect(r.reimaged.sort()).toEqual(['facebook', 'instagram', 'threads'])
  })
  it('사진 목록의 첫 장이 image 와 다르면 오류', async () => {
    const root = makeTempDir()
    await setupDrafts(root, NOTES_ARTICLE_MULTI)
    const path = draftPath(root, NOTES_ARTICLE_MULTI.id, 'instagram')
    const d = parseDraft(readFileSync(path, 'utf8'), 'instagram')
    writeFileSync(path, serializeDraft({ ...d, image: 'https://blog.example.com/images/other.jpg' }))
    const ig = (await readDrafts(root, NOTES_ARTICLE_MULTI.id)).views.find((v) => v.channel === 'instagram')!
    expect(ig.problems).toContainEqual({
      level: 'error',
      message: '사진 목록의 첫 장과 대표 사진(image)이 다릅니다. sns-relay image 로 사진을 다시 정하세요.',
    })
  })
  it('11장인 작업은 인스타 오류가 난다', async () => {
    const root = makeTempDir()
    const many = Array.from({ length: 11 }, (_, i) => `https://res.cloudinary.com/demo/image/upload/v1/p-${i}.jpg`)
    await setupDrafts(root, { ...NOTES_ARTICLE_MULTI, image: many[0], images: many })
    const { views } = await readDrafts(root, NOTES_ARTICLE_MULTI.id)
    const ig = views.find((v) => v.channel === 'instagram')!
    expect(ig.problems.some((p) => p.level === 'error' && p.message.includes('사진은 10장까지'))).toBe(true)
  })
})
