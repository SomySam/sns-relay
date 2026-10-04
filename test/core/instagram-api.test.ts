import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishToInstagram } from '../../src/core/channels/instagram-api.js'
import type { ChannelDraft } from '../../src/core/types.js'
import { installMockAgent } from '../helpers.js'
import { IG_ORIGIN, IG_PERMALINK, IG_TOKEN_VALUE, IG_UID, mockInstagramSuccess } from '../instagram-mock.js'
import { JSON_HEADERS } from '../threads-mock.js'

const DRAFT: ChannelDraft = {
  channel: 'instagram',
  approved: true,
  link: 'https://blog.example.com/blog/x?utm_source=instagram',
  image: 'https://blog.example.com/images/cover.jpg',
  body: '이런 고민 해 본 사람 있나요?\n\n#AI활용',
}
const ENV = { IG_USER_ID: IG_UID, IG_TOKEN: IG_TOKEN_VALUE }

let agent: MockAgent
let restore: () => Promise<void>
beforeEach(() => ({ agent, restore } = installMockAgent()))
afterEach(() => restore())
const pool = () => agent.get(IG_ORIGIN)

function ctx(over: Record<string, unknown> = {}) {
  return { env: ENV, sleep: vi.fn(async (_ms: number) => {}), onBeforePublish: vi.fn(async () => {}), ...over }
}

describe('publishToInstagram', () => {
  it('이미지 주소와 캡션으로 컨테이너 → 5초 대기 → 게시 → 주소', async () => {
    pool()
      .intercept({
        path: `/v25.0/${IG_UID}/media`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('image_url') === DRAFT.image && p.get('caption') === DRAFT.body && p.get('access_token') === IG_TOKEN_VALUE
        },
      })
      .reply(200, { id: 'ic1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/ic1?'), method: 'GET' }).reply(200, { status_code: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v25.0/${IG_UID}/media_publish`, method: 'POST' }).reply(200, { id: 'im1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/im1?'), method: 'GET' }).reply(200, { permalink: IG_PERMALINK }, JSON_HEADERS)
    const c = ctx()
    expect(await publishToInstagram(DRAFT, c)).toEqual({ status: 'published', postId: 'im1', postUrl: IG_PERMALINK })
    expect(c.sleep.mock.calls).toEqual([[5_000]])
    expect(c.onBeforePublish).toHaveBeenCalledTimes(1)
  })

  it('status_code ERROR 는 게시하지 않고 failed (status 사유 포함)', async () => {
    pool().intercept({ path: `/v25.0/${IG_UID}/media`, method: 'POST' }).reply(200, { id: 'ic1' }, JSON_HEADERS)
    pool()
      .intercept({ path: (p) => p.startsWith('/v25.0/ic1?'), method: 'GET' })
      .reply(200, { status_code: 'ERROR', status: 'Error: image aspect ratio' }, JSON_HEADERS)
    const c = ctx()
    const r = await publishToInstagram(DRAFT, c)
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('image aspect ratio') })
    expect(c.onBeforePublish).not.toHaveBeenCalled()
  })

  it('게시 요청이 503 이면 unknown', async () => {
    pool().intercept({ path: `/v25.0/${IG_UID}/media`, method: 'POST' }).reply(200, { id: 'ic1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/ic1?'), method: 'GET' }).reply(200, { status_code: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v25.0/${IG_UID}/media_publish`, method: 'POST' }).reply(503, 'down')
    expect(await publishToInstagram(DRAFT, ctx())).toEqual({ status: 'unknown', reason: expect.stringContaining('인스타그램 에서 게시 여부') })
  })

  it('토큰 오류는 failed, 토큰은 드러나지 않는다', async () => {
    pool()
      .intercept({ path: `/v25.0/${IG_UID}/media`, method: 'POST' })
      .reply(400, { error: { message: `bad ${IG_TOKEN_VALUE}`, code: 190 } }, JSON_HEADERS)
    const r = await publishToInstagram(DRAFT, ctx())
    expect(r.status).toBe('failed')
    expect(JSON.stringify(r)).not.toContain(IG_TOKEN_VALUE)
  })

  it('이미지가 없으면 요청 없이 failed', async () => {
    const r = await publishToInstagram({ ...DRAFT, image: null }, ctx())
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('이미지') })
  })

  it('.env 에 키가 없으면 failed', async () => {
    expect(await publishToInstagram(DRAFT, ctx({ env: {} }))).toEqual({ status: 'failed', reason: expect.stringContaining('IG_USER_ID') })
  })

  it('성공 도우미', async () => {
    mockInstagramSuccess(agent)
    expect((await publishToInstagram(DRAFT, ctx())).status).toBe('published')
  })
})

describe('publishToInstagram — 캐러셀', () => {
  const URLS = ['https://blog.example.com/images/a.jpg', 'https://blog.example.com/images/b.jpg', 'https://blog.example.com/images/c.jpg']
  const CAROUSEL: ChannelDraft = { ...DRAFT, image: URLS[0], images: URLS }
  const form = (b: unknown) => new URLSearchParams(String(b))

  function items(statusFor: (i: number) => Record<string, unknown> = () => ({ status_code: 'FINISHED' })) {
    URLS.forEach((u, i) => {
      pool()
        .intercept({ path: `/v25.0/${IG_UID}/media`, method: 'POST', body: (b) => form(b).get('image_url') === u && form(b).get('is_carousel_item') === 'true' && !form(b).has('caption') })
        .reply(200, { id: `it${i + 1}` }, JSON_HEADERS)
      pool().intercept({ path: (p) => p.startsWith(`/v25.0/it${i + 1}?`), method: 'GET' }).reply(200, statusFor(i), JSON_HEADERS)
    })
  }

  it('항목 3개 → 캐러셀(children·caption) → 게시 → 주소', async () => {
    items()
    pool()
      .intercept({
        path: `/v25.0/${IG_UID}/media`,
        method: 'POST',
        body: (b) => form(b).get('media_type') === 'CAROUSEL' && form(b).get('children') === 'it1,it2,it3' && form(b).get('caption') === DRAFT.body,
      })
      .reply(200, { id: 'car1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/car1?'), method: 'GET' }).reply(200, { status_code: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v25.0/${IG_UID}/media_publish`, method: 'POST', body: (b) => form(b).get('creation_id') === 'car1' }).reply(200, { id: 'im1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/im1?'), method: 'GET' }).reply(200, { permalink: IG_PERMALINK }, JSON_HEADERS)
    const c = ctx()
    expect(await publishToInstagram(CAROUSEL, c)).toEqual({ status: 'published', postId: 'im1', postUrl: IG_PERMALINK })
    expect(c.sleep.mock.calls).toEqual([[5_000]])
    expect(c.onBeforePublish).toHaveBeenCalledTimes(1)
  })

  it('항목이 ERROR 면 캐러셀도 게시도 없이 failed(사진 번호), onBeforePublish 안 불림', async () => {
    items((i) => (i === 1 ? { status_code: 'ERROR', status: 'bad image' } : { status_code: 'FINISHED' }))
    // 캐러셀·게시 요청은 등록하지 않았다 — 나가면 MockAgent 가 거부한다.
    const c = ctx()
    const r = await publishToInstagram(CAROUSEL, c)
    expect(r).toEqual({ status: 'failed', reason: expect.stringMatching(/2번째 사진.*ERROR/) })
    expect(c.onBeforePublish).not.toHaveBeenCalled()
  })

  it('항목이 준비 중이면 pollMs 만큼 기다렸다 다시 본다', async () => {
    URLS.slice(0, 2).forEach((u, i) => {
      pool().intercept({ path: `/v25.0/${IG_UID}/media`, method: 'POST', body: (b) => form(b).get('image_url') === u }).reply(200, { id: `it${i + 1}` }, JSON_HEADERS)
    })
    pool().intercept({ path: (p) => p.startsWith('/v25.0/it1?'), method: 'GET' }).reply(200, { status_code: 'IN_PROGRESS' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/it1?'), method: 'GET' }).reply(200, { status_code: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/it2?'), method: 'GET' }).reply(200, { status_code: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v25.0/${IG_UID}/media`, method: 'POST', body: (b) => form(b).get('media_type') === 'CAROUSEL' }).reply(200, { id: 'car1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/car1?'), method: 'GET' }).reply(200, { status_code: 'FINISHED' }, JSON_HEADERS)
    pool().intercept({ path: `/v25.0/${IG_UID}/media_publish`, method: 'POST' }).reply(200, { id: 'im1' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v25.0/im1?'), method: 'GET' }).reply(200, { permalink: IG_PERMALINK }, JSON_HEADERS)
    const c = ctx()
    const r = await publishToInstagram({ ...CAROUSEL, images: URLS.slice(0, 2) }, c)
    expect(r.status).toBe('published')
    expect(c.sleep.mock.calls).toEqual([[3_000], [5_000]])
  })
})
