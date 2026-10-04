import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishToThreads } from '../../src/core/channels/threads-api.js'
import type { ChannelDraft } from '../../src/core/types.js'
import { installMockAgent } from '../helpers.js'
import { JSON_HEADERS, mockThreadsSuccess, PERMALINK, THREADS_ORIGIN, TOKEN, UID } from '../threads-mock.js'

const DRAFT: ChannelDraft = {
  channel: 'threads',
  approved: true,
  link: 'https://blog.example.com/blog/x?utm_source=threads&utm_medium=social&utm_campaign=x',
  image: null,
  body: '나만 그런가요?',
}
const ENV = { THREADS_USER_ID: UID, THREADS_TOKEN: TOKEN }

let agent: MockAgent
let restore: () => Promise<void>
beforeEach(() => ({ agent, restore } = installMockAgent()))
afterEach(() => restore())
const pool = () => agent.get(THREADS_ORIGIN)

function ctx(over: Partial<Parameters<typeof publishToThreads>[1]> = {}) {
  return { env: ENV, sleep: vi.fn(async (_ms: number) => {}), onBeforePublish: vi.fn(async () => {}), ...over }
}

describe('publishToThreads', () => {
  it('컨테이너 → 30초 대기 → 게시 → 주소', async () => {
    mockThreadsSuccess(agent)
    const c = ctx()
    expect(await publishToThreads(DRAFT, c)).toEqual({ status: 'published', postId: 'm1', postUrl: PERMALINK })
    expect(c.sleep.mock.calls).toEqual([[30_000]])
    expect(c.onBeforePublish).toHaveBeenCalledTimes(1)
  })

  it('컨테이너 응답에 id 가 없으면 기다리지 않고 failed', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, {}, JSON_HEADERS)
    const c = ctx()
    const r = await publishToThreads(DRAFT, c)
    expect(r).toEqual({ status: 'failed', reason: '컨테이너 ID 를 받지 못했습니다. 잠시 뒤 다시 게시하세요.' })
    expect(c.sleep).not.toHaveBeenCalled()
    expect(c.onBeforePublish).not.toHaveBeenCalled()
  })

  it('컨테이너 요청에 TEXT·본문·링크 카드를 싣는다', async () => {
    pool()
      .intercept({
        path: `/v1.0/${UID}/threads`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('media_type') === 'TEXT' && p.get('text') === DRAFT.body && p.get('link_attachment') === DRAFT.link
        },
      })
      .reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).reply(200, { id: 'm1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(200, { permalink: PERMALINK }, JSON_HEADERS)
    expect((await publishToThreads(DRAFT, ctx())).status).toBe('published')
  })

  it('준비 중이면 1분 간격으로 다시 본다', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    const status = pool()
    status.intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'IN_PROGRESS' }, JSON_HEADERS)
    status.intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'IN_PROGRESS' }, JSON_HEADERS)
    status.intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).reply(200, { id: 'm1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(200, { permalink: PERMALINK }, JSON_HEADERS)
    const c = ctx()
    expect((await publishToThreads(DRAFT, c)).status).toBe('published')
    expect(c.sleep.mock.calls).toEqual([[30_000], [60_000], [60_000]])
  })

  it('컨테이너 ERROR 는 게시하지 않고 failed', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool()
      .intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' })
      .reply(200, { status: 'ERROR', error_message: 'LINK_LIMIT' }, JSON_HEADERS)
    const c = ctx()
    const r = await publishToThreads(DRAFT, c)
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('LINK_LIMIT') })
    expect(c.onBeforePublish).not.toHaveBeenCalled()
  })

  it('5번 확인해도 준비되지 않으면 failed', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool()
      .intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' })
      .reply(200, { status: 'IN_PROGRESS' }, JSON_HEADERS)
      .times(5)
    const r = await publishToThreads(DRAFT, ctx())
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('5분') })
  })

  it('컨테이너 단계 토큰 오류는 failed, 토큰은 드러나지 않는다', async () => {
    pool()
      .intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' })
      .reply(400, { error: { message: `bad ${TOKEN}`, code: 190 } }, JSON_HEADERS)
    const r = await publishToThreads(DRAFT, ctx())
    expect(r.status).toBe('failed')
    expect(JSON.stringify(r)).not.toContain(TOKEN)
    expect(JSON.stringify(r)).toContain('토큰')
  })

  it('게시 요청 뒤 연결이 끊기면 unknown', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).replyWithError(new Error('socket hang up'))
    const r = await publishToThreads(DRAFT, ctx())
    expect(r).toEqual({ status: 'unknown', reason: expect.stringContaining('sns-relay resolve') })
  })

  it('게시 요청이 한도 오류로 거절되면 failed', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool()
      .intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' })
      .reply(400, { error: { message: 'limit', code: 4 } }, JSON_HEADERS)
    expect((await publishToThreads(DRAFT, ctx())).status).toBe('failed')
  })

  describe('게시 요청 뒤 불확실한 응답은 unknown', () => {
    function toPublish() {
      pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
      pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
      return pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' })
    }
    it('200 인데 JSON 이 아니면 unknown', async () => {
      toPublish().reply(200, 'not json')
      expect((await publishToThreads(DRAFT, ctx())).status).toBe('unknown')
    })
    it('503 이면 unknown', async () => {
      toPublish().reply(503, 'Service Unavailable')
      expect((await publishToThreads(DRAFT, ctx())).status).toBe('unknown')
    })
    it('중복 코드 506 이면 unknown', async () => {
      toPublish().reply(400, { error: { message: 'dup', code: 506 } }, JSON_HEADERS)
      expect((await publishToThreads(DRAFT, ctx())).status).toBe('unknown')
    })
    it('Meta 오류 JSON 없는 400 HTML 이면 unknown', async () => {
      toPublish().reply(400, '<html>bad gateway</html>')
      expect((await publishToThreads(DRAFT, ctx())).status).toBe('unknown')
    })
    it('200 인데 id 가 없으면 unknown, 주소 조회는 하지 않는다', async () => {
      toPublish().reply(200, {}, JSON_HEADERS)
      const r = await publishToThreads(DRAFT, ctx())
      expect(r).toEqual({ status: 'unknown', reason: expect.stringContaining('게시물 ID') })
    })
    it('onBeforePublish 는 게시 요청보다 먼저 불린다', async () => {
      const events: string[] = []
      toPublish().reply(() => {
        events.push('publish')
        return { statusCode: 200, data: { id: 'm1' }, responseOptions: JSON_HEADERS }
      })
      pool().intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(200, { permalink: PERMALINK }, JSON_HEADERS)
      const c = ctx({ onBeforePublish: vi.fn(async () => void events.push('before')) })
      expect((await publishToThreads(DRAFT, c)).status).toBe('published')
      expect(events).toEqual(['before', 'publish'])
    })
  })

  it('주소 조회만 실패하면 published(주소 없음, 사유 있음)', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).reply(200, { id: 'm1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(500, 'oops')
    const r = await publishToThreads(DRAFT, ctx())
    expect(r).toEqual({ status: 'published', postId: 'm1', note: expect.stringContaining('주소') })
  })

  it('.env 에 토큰이 없으면 요청 없이 failed', async () => {
    const r = await publishToThreads(DRAFT, ctx({ env: {} }))
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('THREADS_USER_ID') })
  })
})

describe('publishToThreads 링크 없는 게시', () => {
  const flow = (match: (p: URLSearchParams) => boolean) => {
    pool()
      .intercept({ path: `/v1.0/${UID}/threads`, method: 'POST', body: (b) => match(new URLSearchParams(String(b))) })
      .reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).reply(200, { id: 'm1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(200, { permalink: PERMALINK }, JSON_HEADERS)
  }
  it('링크 없고 사진 있으면 IMAGE 컨테이너, 링크 카드 없음', async () => {
    flow((p) => p.get('media_type') === 'IMAGE' && p.get('image_url') === 'https://img.test/a.jpg' && p.get('text') === '글' && !p.has('link_attachment'))
    const r = await publishToThreads({ ...DRAFT, link: '', image: 'https://img.test/a.jpg', body: '글' }, ctx())
    expect(r.status).toBe('published')
  })
  it('링크도 사진도 없으면 TEXT, 링크 카드 없음', async () => {
    flow((p) => p.get('media_type') === 'TEXT' && p.get('text') === '글' && !p.has('link_attachment') && !p.has('image_url'))
    const r = await publishToThreads({ ...DRAFT, link: '', image: null, body: '글' }, ctx())
    expect(r.status).toBe('published')
  })
})

describe('publishToThreads — 캐러셀', () => {
  const URLS = ['https://blog.example.com/images/a.jpg', 'https://blog.example.com/images/b.jpg']
  const form = (b: unknown) => new URLSearchParams(String(b))
  const CAROUSEL: ChannelDraft = { ...DRAFT, link: '', image: URLS[0], images: URLS }

  function items() {
    URLS.forEach((u, i) => {
      pool()
        .intercept({
          path: `/v1.0/${UID}/threads`,
          method: 'POST',
          body: (b) => form(b).get('media_type') === 'IMAGE' && form(b).get('image_url') === u && form(b).get('is_carousel_item') === 'true' && !form(b).has('text'),
        })
        .reply(200, { id: `it${i + 1}` }, JSON_HEADERS)
      pool().intercept({ path: (p) => p.startsWith(`/v1.0/it${i + 1}?`), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    })
  }

  it('링크 없음·사진 2장: 항목 2개 → 캐러셀 → 30초 대기 → 게시', async () => {
    items()
    pool()
      .intercept({
        path: `/v1.0/${UID}/threads`,
        method: 'POST',
        body: (b) => form(b).get('media_type') === 'CAROUSEL' && form(b).get('children') === 'it1,it2' && form(b).get('text') === DRAFT.body,
      })
      .reply(200, { id: 'car1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/car1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST', body: (b) => form(b).get('creation_id') === 'car1' }).reply(200, { id: 'm1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(200, { permalink: PERMALINK }, JSON_HEADERS)
    const c = ctx()
    expect(await publishToThreads(CAROUSEL, c)).toEqual({ status: 'published', postId: 'm1', postUrl: PERMALINK })
    expect(c.sleep.mock.calls).toEqual([[30_000]])
  })

  it('항목이 ERROR 면 failed(사진 번호), 게시 전 기록 없음', async () => {
    pool().intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'it1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/it1?'), method: 'GET' }).reply(200, { status: 'ERROR', error_message: 'bad' }, JSON_HEADERS)
    const c = ctx()
    expect(await publishToThreads(CAROUSEL, c)).toEqual({ status: 'failed', reason: expect.stringContaining('1번째 사진') })
    expect(c.onBeforePublish).not.toHaveBeenCalled()
  })

  it('링크 있는 글은 사진이 여러 장이어도 TEXT + link_attachment', async () => {
    pool()
      .intercept({
        path: `/v1.0/${UID}/threads`,
        method: 'POST',
        body: (b) => form(b).get('media_type') === 'TEXT' && form(b).get('link_attachment') === DRAFT.link && !form(b).has('children'),
      })
      .reply(200, { id: 'c1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).reply(200, { id: 'm1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(200, { permalink: PERMALINK }, JSON_HEADERS)
    expect((await publishToThreads({ ...DRAFT, image: URLS[0], images: URLS }, ctx())).status).toBe('published')
  })
})
