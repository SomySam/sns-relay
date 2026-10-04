import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { publishConfirm } from '../../src/core/confirm-token.js'
import { readDrafts } from '../../src/core/draft-files.js'
import { exportNaver } from '../../src/core/naver.js'
import { publishArticle } from '../../src/core/publish.js'
import { cellKey, getCell, loadState, setCell, statePath, updateState } from '../../src/core/state.js'
import { CHANNEL_IDS } from '../../src/core/types.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { IG_PERMALINK, IG_TOKEN_VALUE, IG_UID, mockInstagramSuccess } from '../instagram-mock.js'
import { fakeJpeg } from '../jpeg-helpers.js'
import { FB_PERMALINK, FB_POST_ID, mockFacebookSuccess, PAGE_ID, PAGE_TOKEN } from '../facebook-mock.js'
import { installMockAgent, makeTempDir } from '../helpers.js'
import { JSON_HEADERS, mockThreadsSuccess, noSleep, PERMALINK, THREADS_ORIGIN, TOKEN, UID } from '../threads-mock.js'

const ID = ARTICLE.id
const NOW = () => new Date('2026-09-30T00:00:00Z')
let agent: MockAgent
let restore: () => Promise<void>
let root: string

beforeEach(async () => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  await setupDrafts(root)
  for (const ch of CHANNEL_IDS) writeBody(root, ID, ch, VALID_BODIES[ch])
  writeFileSync(join(root, '.env'), `THREADS_USER_ID=${UID}\nTHREADS_TOKEN=${TOKEN}\n`)
})
afterEach(() => restore())

const publish = (opts = {}) => publishArticle(root, ID, { now: NOW, sleep: noSleep, ...opts })
const pool = () => agent.get(THREADS_ORIGIN)

describe('publishArticle', () => {
  it('승인되지 않은 초안은 요청 없이 막는다', async () => {
    const [r] = await publish()
    expect(r).toMatchObject({ channel: 'threads', outcome: 'blocked', reason: expect.stringContaining('승인') })
  })

  it('네이버를 지정하면 반자동 안내로 막는다', async () => {
    await approveDrafts(root, ID, ['naver'], NOW)
    const [r] = await publish({ channels: ['naver'] })
    expect(r).toMatchObject({ channel: 'naver', outcome: 'blocked', reason: expect.stringContaining('sns-relay naver') })
  })

  it('네이버 칸이 manual(수동 발행 대기)이어도 반자동 안내를 준다', async () => {
    await approveDrafts(root, ID, ['naver'], NOW)
    await exportNaver(root, ID, NOW)
    const [r] = await publish({ channels: ['naver'] })
    expect(r).toMatchObject({ channel: 'naver', outcome: 'blocked', reason: expect.stringContaining('sns-relay naver') })
  })

  it('dry-run 은 요청도 기록도 없이 최종 문구를 보여 준다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    const [r] = await publish({ dryRun: true })
    expect(r.outcome).toBe('dry-run')
    expect(r.preview?.body).toBe(VALID_BODIES.threads)
    expect(r.preview?.link).toContain('utm_source=threads')
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('approved')
  })

  it('게시하면 주소를 기록하고, 다시 게시하지 않는다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    mockThreadsSuccess(agent)
    const [r] = await publish()
    expect(r).toMatchObject({ channel: 'threads', outcome: 'published', postUrl: PERMALINK })
    expect(getCell(await loadState(root), ID, 'threads')).toMatchObject({ status: 'published', postId: 'm1', postUrl: PERMALINK })

    const [again] = await publish()
    expect(again).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('이미 게시됨') })
  })

  it('실패는 failed 로 남고, 같은 내용이면 승인이 유지돼 다시 게시할 수 있다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    pool()
      .intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' })
      .reply(400, { error: { message: `expired ${TOKEN}`, code: 190 } }, JSON_HEADERS)
    const [r] = await publish()
    expect(r.outcome).toBe('failed')
    expect(JSON.stringify(r)).not.toContain(TOKEN)
    const cell = getCell(await loadState(root), ID, 'threads')
    expect(cell?.status).toBe('failed')
    expect(JSON.stringify(cell)).not.toContain(TOKEN)
    expect((await readDrafts(root, ID, NOW)).views[0].approved).toBe(true)

    mockThreadsSuccess(agent)
    expect((await publish())[0].outcome).toBe('published')
  })

  it('expectedHashes 가 현재 초안과 다르면 요청 없이 막고 승인은 그대로 둔다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    const [r] = await publish({ expectedHashes: { threads: 'deadbeefdead' } })
    expect(r).toMatchObject({ channel: 'threads', outcome: 'blocked', reason: '미리보기 뒤에 초안이 바뀌었습니다. 다시 미리보기(dry-run) 하세요.' })
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('approved')
  })

  it('expectedHashes 에 그 채널이 없어도 막는다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    const [r] = await publish({ expectedHashes: {} })
    expect(r).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('미리보기 뒤에') })
  })

  it('expectedHashes 가 맞으면 정상 게시한다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    const { hashes } = await publishConfirm(root, ID, ['threads'], NOW)
    mockThreadsSuccess(agent)
    const [r] = await publish({ expectedHashes: hashes })
    expect(r).toMatchObject({ channel: 'threads', outcome: 'published', postUrl: PERMALINK })
  })

  it('게시 요청 뒤 응답을 못 받으면 unknown 으로 남기고 다시 게시하지 않는다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).replyWithError(new Error('reset'))
    const [r] = await publish()
    expect(r.outcome).toBe('unknown')
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('unknown')
    expect((await publish())[0]).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('resolve') })
  })

  it('.env 에 토큰이 없으면 failed', async () => {
    writeFileSync(join(root, '.env'), '')
    await approveDrafts(root, ID, ['threads'], NOW)
    const [r] = await publish()
    expect(r).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('THREADS_TOKEN') })
  })

  it('지원하지 않는 채널을 지정하면 그 칸만 막고 Threads 는 게시한다', async () => {
    await approveDrafts(root, ID, ['threads', 'naver'], NOW)
    mockThreadsSuccess(agent)
    const reports = await publish({ channels: ['threads', 'naver'] })
    expect(reports.map((r) => [r.channel, r.outcome])).toEqual([
      ['threads', 'published'],
      ['naver', 'blocked'],
    ])
    expect(reports[1].reason).toContain('sns-relay naver')
  })

  it('기본 대상은 자동 게시를 지원하는 채널(threads·instagram·facebook)', async () => {
    const reports = await publish({ dryRun: true })
    expect(reports.map((r) => r.channel)).toEqual(['threads', 'instagram', 'facebook'])
  })

  it('기다리는 사이 다른 작업이 칸을 바꾸면 게시 요청을 보내지 않고 막는다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    // threads_publish 는 등록하지 않는다 — 요청이 나가면 MockAgent 가 거부해 outcome 이 blocked 가 아니게 된다.
    const otherRun = async () => {
      await updateState(root, (s) => {
        setCell(s, ID, 'threads', { status: 'unknown', hash: 'other', reason: '다른 실행' }, NOW())
      })
    }
    const [r] = await publishArticle(root, ID, { now: NOW, sleep: otherRun })
    expect(r).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('다른 작업') })
    expect(getCell(await loadState(root), ID, 'threads')).toMatchObject({ status: 'unknown', reason: '다른 실행' })
  })

  it('기다리는 사이 다른 실행이 게시를 기록하고 이 실행은 컨테이너 ERROR 면, 기록을 덮지 않는다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    const hash = getCell(await loadState(root), ID, 'threads')!.hash
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool()
      .intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' })
      .reply(200, { status: 'ERROR', error_message: 'x' }, JSON_HEADERS)
    const otherRun = async () => {
      await updateState(root, (s) => {
        setCell(s, ID, 'threads', { status: 'published', hash, postId: 'm9', postUrl: PERMALINK }, NOW())
      })
    }
    const [r] = await publishArticle(root, ID, { now: NOW, sleep: otherRun })
    expect(r.outcome).toBe('blocked')
    expect(getCell(await loadState(root), ID, 'threads')).toMatchObject({ status: 'published', postId: 'm9' })
  })

  it('게시 요청 뒤 다른 작업이 칸을 확정했으면 결과를 덮지 않는다', async () => {
    await approveDrafts(root, ID, ['threads'], NOW)
    const hash = getCell(await loadState(root), ID, 'threads')!.hash
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool()
      .intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' })
      .reply(() => {
        const path = statePath(root)
        const st = JSON.parse(readFileSync(path, 'utf8'))
        st[cellKey(ID, 'threads')] = {
          status: 'published',
          hash,
          postId: 'owner',
          postUrl: 'https://www.threads.net/@x/post/OWNER',
          updatedAt: '2030-01-01T00:00:00.000Z',
        }
        writeFileSync(path, JSON.stringify(st))
        return { statusCode: 200, data: { id: 'm1' }, responseOptions: { headers: JSON_HEADERS } }
      })
    pool()
      .intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' })
      .reply(200, { id: 'm1', permalink: PERMALINK }, JSON_HEADERS)
    const [r] = await publish()
    expect(r.outcome).toBe('published')
    expect(r.recorded).toBe(false)
    expect(r.reason).toContain('기록하지 않았습니다')
    expect(getCell(await loadState(root), ID, 'threads')?.postUrl).toBe('https://www.threads.net/@x/post/OWNER')
  })
})

describe('publishArticle — Facebook', () => {
  beforeEach(() => {
    writeFileSync(
      join(root, '.env'),
      `THREADS_USER_ID=${UID}
THREADS_TOKEN=${TOKEN}
FB_PAGE_ID=${PAGE_ID}
FB_PAGE_TOKEN=${PAGE_TOKEN}
`,
    )
  })

  it('승인된 페이스북 초안을 게시하고 주소를 기록한다', async () => {
    await approveDrafts(root, ID, ['facebook'], NOW)
    mockFacebookSuccess(agent)
    const [r] = await publish({ channels: ['facebook'] })
    expect(r).toMatchObject({ channel: 'facebook', outcome: 'published', postUrl: FB_PERMALINK })
    expect(getCell(await loadState(root), ID, 'facebook')).toMatchObject({ status: 'published', postId: FB_POST_ID })
    expect(JSON.stringify(await loadState(root))).not.toContain(PAGE_TOKEN)
  })

  it('한 번에 두 채널: Threads 실패가 Facebook 게시를 막지 않는다', async () => {
    await approveDrafts(root, ID, ['threads', 'facebook'], NOW)
    pool()
      .intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' })
      .reply(400, { error: { message: 'expired', code: 190 } }, JSON_HEADERS)
    mockFacebookSuccess(agent)
    const reports = await publish({ channels: ['threads', 'facebook'] })
    expect(reports.map((r) => [r.channel, r.outcome])).toEqual([
      ['threads', 'failed'],
      ['facebook', 'published'],
    ])
  })
})

describe('publishArticle — Instagram', () => {
  const IMG_ORIGIN = 'https://blog.example.com'
  beforeEach(() => {
    writeFileSync(join(root, '.env'), `IG_USER_ID=${IG_UID}
IG_TOKEN=${IG_TOKEN_VALUE}
`)
  })

  it('이미지 확인을 통과하면 게시하고 주소를 기록한다', async () => {
    await approveDrafts(root, ID, ['instagram'], NOW)
    agent.get(IMG_ORIGIN).intercept({ path: '/images/cover.jpg', method: 'GET' }).reply(200, Buffer.from(fakeJpeg(1376, 768)), { headers: { 'content-type': 'image/jpeg' } })
    mockInstagramSuccess(agent)
    const [r] = await publish({ channels: ['instagram'] })
    expect(r).toMatchObject({ channel: 'instagram', outcome: 'published', postUrl: IG_PERMALINK })
    expect(JSON.stringify(await loadState(root))).not.toContain(IG_TOKEN_VALUE)
  })

  it('이미지가 WebP 면 요청 없이 failed, 같은 내용이면 승인 유지', async () => {
    await approveDrafts(root, ID, ['instagram'], NOW)
    agent.get(IMG_ORIGIN).intercept({ path: '/images/cover.jpg', method: 'GET' }).reply(200, Buffer.from('RIFF0000WEBP'), { headers: { 'content-type': 'image/webp' } })
    // Instagram API 는 등록하지 않는다 — 요청이 나가면 MockAgent 가 거부한다.
    const [r] = await publish({ channels: ['instagram'] })
    expect(r).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('JPEG 가 아닙니다') })
    expect(getCell(await loadState(root), ID, 'instagram')?.status).toBe('failed')
    expect((await readDrafts(root, ID, NOW)).views.find((v) => v.channel === 'instagram')?.approved).toBe(true)
  })

  it('dry-run 은 이미지 확인 결과를 담는다(기록 없음)', async () => {
    await approveDrafts(root, ID, ['instagram'], NOW)
    agent.get(IMG_ORIGIN).intercept({ path: '/images/cover.jpg', method: 'GET' }).reply(200, Buffer.from(fakeJpeg(700, 1000)), { headers: { 'content-type': 'image/jpeg' } })
    const [r] = await publish({ channels: ['instagram'], dryRun: true })
    expect(r.outcome).toBe('dry-run')
    expect(r.checks?.some((p) => p.level === 'error' && p.message.includes('비율'))).toBe(true)
    expect(getCell(await loadState(root), ID, 'instagram')?.status).toBe('approved')
  })
})

describe('게시 전 확인 — 사진 여러 장', () => {
  const IMG = 'https://blog.example.com'
  const jpeg = (w: number, h: number) => Buffer.from(fakeJpeg(w, h))
  const serve = (path: string, body: Buffer, type = 'image/jpeg') =>
    agent.get(IMG).intercept({ path, method: 'GET' }).reply(200, body, { headers: { 'content-type': type } })
  const draft = (channel: 'instagram' | 'threads', link = '') => ({
    channel,
    approved: true,
    link,
    image: `${IMG}/a.jpg`,
    images: [`${IMG}/a.jpg`, `${IMG}/b.jpg`],
    body: '글',
  })

  it('인스타: 모든 사진을 본다 — 둘째가 WebP 면 "2번째 사진" 오류', async () => {
    const { instagram } = await import('../../src/core/channels/instagram.js')
    serve('/a.jpg', jpeg(1000, 1000))
    serve('/b.jpg', Buffer.from('RIFF0000WEBP'), 'image/webp')
    const p = await instagram.precheck!(draft('instagram'))
    expect(p.some((x) => x.level === 'error' && x.message.includes('2번째 사진') && x.message.includes('JPEG'))).toBe(true)
  })

  it('인스타: 첫 장과 비율 차이가 0.1 이상이면 경고', async () => {
    const { instagram } = await import('../../src/core/channels/instagram.js')
    serve('/a.jpg', jpeg(1000, 1000))
    serve('/b.jpg', jpeg(1000, 800))
    const p = await instagram.precheck!(draft('instagram'))
    expect(p).toEqual([{ level: 'warn', message: '2번째 사진은 첫 장 비율로 잘립니다.' }])
  })

  it('Threads: 링크 없으면 모든 사진을 본다, 링크 있으면 보지 않는다', async () => {
    const { threads } = await import('../../src/core/channels/threads.js')
    serve('/a.jpg', jpeg(1000, 1000))
    serve('/b.jpg', Buffer.from('RIFF0000WEBP'), 'image/webp')
    const p = await threads.precheck!(draft('threads'))
    expect(p).toHaveLength(1)
    expect(p[0].message).toContain('2번째 사진')
    expect(await threads.precheck!(draft('threads', 'https://blog.example.com/x'))).toEqual([])
  })
})
