import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishToFacebook } from '../../src/core/channels/facebook-api.js'
import type { ChannelDraft } from '../../src/core/types.js'
import { FB_ORIGIN, FB_PERMALINK, FB_POST_ID, mockFacebookSuccess, PAGE_ID, PAGE_TOKEN } from '../facebook-mock.js'
import { installMockAgent } from '../helpers.js'
import { JSON_HEADERS } from '../threads-mock.js'

const DRAFT: ChannelDraft = {
  channel: 'facebook',
  approved: true,
  link: 'https://blog.example.com/blog/x?utm_source=facebook&utm_medium=social&utm_campaign=x',
  image: null,
  body: '이런 고민 해 본 사람 있나요?',
}
const ENV = { FB_PAGE_ID: PAGE_ID, FB_PAGE_TOKEN: PAGE_TOKEN }

let agent: MockAgent
let restore: () => Promise<void>
beforeEach(() => ({ agent, restore } = installMockAgent()))
afterEach(() => restore())
const pool = () => agent.get(FB_ORIGIN)
const attachments = (data: Record<string, unknown>) =>
  pool()
    .intercept({ path: (p) => decodeURIComponent(p).includes('attachments'), method: 'GET' })
    .reply(200, data, JSON_HEADERS)
const feed = () => pool().intercept({ path: `/v26.0/${PAGE_ID}/feed`, method: 'POST' })

function ctx(over: Record<string, unknown> = {}) {
  return { env: ENV, sleep: vi.fn(async (_ms: number) => {}), onBeforePublish: vi.fn(async () => {}), ...over }
}

describe('publishToFacebook', () => {
  it('게시 직전 기록 → 게시 → 주소', async () => {
    const events: string[] = []
    pool()
      .intercept({
        path: `/v26.0/${PAGE_ID}/feed`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('message') === DRAFT.body && p.get('link') === DRAFT.link && p.get('access_token') === PAGE_TOKEN
        },
      })
      .reply(() => {
        events.push('feed')
        return { statusCode: 200, data: { id: FB_POST_ID }, responseOptions: JSON_HEADERS }
      })
    pool()
      .intercept({ path: (p) => p.startsWith(`/v26.0/${FB_POST_ID}?`), method: 'GET' })
      .reply(200, { permalink_url: FB_PERMALINK }, JSON_HEADERS)
    const c = ctx({ onBeforePublish: vi.fn(async () => void events.push('before')) })
    expect(await publishToFacebook(DRAFT, c)).toEqual({ status: 'published', postId: FB_POST_ID, postUrl: FB_PERMALINK })
    expect(events).toEqual(['before', 'feed'])
  })

  it('토큰 오류로 분명히 거절되면 failed, 토큰은 드러나지 않는다', async () => {
    feed().reply(400, { error: { message: `bad ${PAGE_TOKEN}`, code: 190 } }, JSON_HEADERS)
    const r = await publishToFacebook(DRAFT, ctx())
    expect(r.status).toBe('failed')
    expect(JSON.stringify(r)).not.toContain(PAGE_TOKEN)
  })

  it.each([
    ['503', () => feed().reply(503, 'Service Unavailable')],
    ['506 중복', () => feed().reply(400, { error: { message: 'dup', code: 506 } }, JSON_HEADERS)],
    ['200 비 JSON', () => feed().reply(200, 'not json')],
    ['연결 끊김', () => feed().replyWithError(new Error('reset'))],
  ])('%s 는 unknown', async (_name, setup) => {
    setup()
    const r = await publishToFacebook(DRAFT, ctx())
    expect(r).toEqual({ status: 'unknown', reason: expect.stringContaining('sns-relay resolve') })
  })

  it('게시 응답에 id 가 없으면 unknown', async () => {
    feed().reply(200, {}, JSON_HEADERS)
    const r = await publishToFacebook(DRAFT, ctx())
    expect(r).toEqual({ status: 'unknown', reason: expect.stringContaining('게시물 ID') })
  })

  it('주소 조회가 실패하면 기본 형식 주소로 published', async () => {
    feed().reply(200, { id: FB_POST_ID }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith(`/v26.0/${FB_POST_ID}?`), method: 'GET' }).reply(500, 'oops')
    const r = await publishToFacebook(DRAFT, ctx())
    expect(r).toEqual({
      status: 'published',
      postId: FB_POST_ID,
      postUrl: `https://www.facebook.com/${FB_POST_ID}`,
      note: expect.stringContaining('기본 형식 주소'),
    })
  })

  it('.env 에 페이지 키가 없으면 요청·기록 없이 failed', async () => {
    const c = ctx({ env: {} })
    const r = await publishToFacebook(DRAFT, c)
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('FB_PAGE_ID') })
    expect(c.onBeforePublish).not.toHaveBeenCalled()
  })

  it('성공 도우미로 한 번에', async () => {
    mockFacebookSuccess(agent)
    expect((await publishToFacebook(DRAFT, ctx())).status).toBe('published')
  })
})

describe('publishToFacebook 링크 없는 게시', () => {
  it('링크 없고 사진 있으면 /photos 에 url·message, post_id 로 주소 조회', async () => {
    const events: string[] = []
    pool()
      .intercept({
        path: `/v26.0/${PAGE_ID}/photos`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('url') === 'https://img.test/a.jpg' && p.get('message') === '글' && !p.has('link')
        },
      })
      .reply(() => {
        events.push('photos')
        return { statusCode: 200, data: { id: 'PHOTO1', post_id: '1334_777' }, responseOptions: JSON_HEADERS }
      })
    pool()
      .intercept({ path: (p) => p.startsWith('/v26.0/1334_777?'), method: 'GET' })
      .reply(200, { permalink_url: FB_PERMALINK }, JSON_HEADERS)
    const c = ctx({ onBeforePublish: vi.fn(async () => void events.push('before')) })
    const r = await publishToFacebook({ ...DRAFT, link: '', image: 'https://img.test/a.jpg', body: '글' }, c)
    expect(r).toEqual({ status: 'published', postId: '1334_777', postUrl: FB_PERMALINK })
    expect(events).toEqual(['before', 'photos'])
  })
  it('링크도 사진도 없으면 /feed 에 message 만', async () => {
    pool()
      .intercept({
        path: `/v26.0/${PAGE_ID}/feed`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('message') === '글' && !p.has('link')
        },
      })
      .reply(200, { id: FB_POST_ID }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith(`/v26.0/${FB_POST_ID}?`), method: 'GET' }).reply(200, { permalink_url: FB_PERMALINK }, JSON_HEADERS)
    const r = await publishToFacebook({ ...DRAFT, link: '', image: null, body: '글' }, ctx())
    expect(r.status).toBe('published')
  })
})

describe('publishToFacebook 여러 장 사진', () => {
  const MULTI = { ...DRAFT, link: '', image: 'https://img.test/1.jpg', images: ['https://img.test/1.jpg', 'https://img.test/2.jpg', 'https://img.test/3.jpg'], body: '글' }
  const photoUp = (n: number, events: string[], id: string) =>
    pool()
      .intercept({
        path: `/v26.0/${PAGE_ID}/photos`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('url') === `https://img.test/${n}.jpg` && p.get('published') === 'false' && !p.has('message')
        },
      })
      .reply(() => {
        events.push(`photo${n}`)
        return { statusCode: 200, data: { id }, responseOptions: JSON_HEADERS }
      })

  it('사진을 비공개로 올린 뒤 onBeforePublish, 그다음 attached_media 로 /feed', async () => {
    const events: string[] = []
    photoUp(1, events, 'p1')
    photoUp(2, events, 'p2')
    photoUp(3, events, 'p3')
    pool()
      .intercept({
        path: `/v26.0/${PAGE_ID}/feed`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return (
            p.get('message') === '글' &&
            p.get('attached_media[0]') === '{"media_fbid":"p1"}' &&
            p.get('attached_media[1]') === '{"media_fbid":"p2"}' &&
            p.get('attached_media[2]') === '{"media_fbid":"p3"}' &&
            !p.has('link')
          )
        },
      })
      .reply(() => {
        events.push('feed')
        return { statusCode: 200, data: { id: FB_POST_ID }, responseOptions: JSON_HEADERS }
      })
    attachments({ attachments: { data: [{ subattachments: { data: [{}, {}, {}] } }] } })
    pool().intercept({ path: (p) => p.startsWith(`/v26.0/${FB_POST_ID}?`), method: 'GET' }).reply(200, { permalink_url: FB_PERMALINK }, JSON_HEADERS)
    const c = ctx({ onBeforePublish: vi.fn(async () => void events.push('before')) })
    expect(await publishToFacebook(MULTI, c)).toEqual({ status: 'published', postId: FB_POST_ID, postUrl: FB_PERMALINK })
    expect(events).toEqual(['photo1', 'photo2', 'photo3', 'before', 'feed'])
  })

  it('게시 뒤 첨부 정보가 없으면 published 유지 + 0/3 안내', async () => {
    const events: string[] = []
    photoUp(1, events, 'p1')
    photoUp(2, events, 'p2')
    photoUp(3, events, 'p3')
    feed().reply(200, { id: FB_POST_ID }, JSON_HEADERS)
    attachments({ id: FB_POST_ID })
    pool().intercept({ path: (p) => p.startsWith(`/v26.0/${FB_POST_ID}?`), method: 'GET' }).reply(200, { permalink_url: FB_PERMALINK }, JSON_HEADERS)
    const r = await publishToFacebook(MULTI, ctx())
    expect(r).toMatchObject({ status: 'published', postId: FB_POST_ID, postUrl: FB_PERMALINK, note: expect.stringContaining('0/3') })
  })

  it('첨부 확인이 실패해도 published 유지 + 확인 못함 안내', async () => {
    const events: string[] = []
    photoUp(1, events, 'p1')
    photoUp(2, events, 'p2')
    photoUp(3, events, 'p3')
    feed().reply(200, { id: FB_POST_ID }, JSON_HEADERS)
    pool()
      .intercept({ path: (p) => decodeURIComponent(p).includes('attachments'), method: 'GET' })
      .reply(500, 'oops')
    pool().intercept({ path: (p) => p.startsWith(`/v26.0/${FB_POST_ID}?`), method: 'GET' }).reply(200, { permalink_url: FB_PERMALINK }, JSON_HEADERS)
    const r = await publishToFacebook(MULTI, ctx())
    expect(r).toMatchObject({ status: 'published', note: '사진 첨부 여부를 확인하지 못했습니다. 페이지에서 확인하세요.' })
  })

  it('사진 올리기가 분명히 거절되면 failed, onBeforePublish·/feed 없음', async () => {
    const events: string[] = []
    photoUp(1, events, 'p1')
    pool().intercept({ path: `/v26.0/${PAGE_ID}/photos`, method: 'POST' }).reply(400, { error: { message: 'bad image', code: 100 } }, JSON_HEADERS)
    const c = ctx()
    const r = await publishToFacebook(MULTI, c)
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('2번째 사진') })
    expect(c.onBeforePublish).not.toHaveBeenCalled()
  })

  it('/feed 가 5xx 면 unknown', async () => {
    const events: string[] = []
    photoUp(1, events, 'p1')
    photoUp(2, events, 'p2')
    photoUp(3, events, 'p3')
    feed().reply(503, 'Service Unavailable')
    const c = ctx()
    const r = await publishToFacebook(MULTI, c)
    expect(r).toEqual({ status: 'unknown', reason: expect.stringContaining('sns-relay resolve') })
    expect(c.onBeforePublish).toHaveBeenCalledTimes(1)
  })

  it('한 장이면 지금처럼 /photos(url, message) 한 번', async () => {
    pool()
      .intercept({
        path: `/v26.0/${PAGE_ID}/photos`,
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('url') === 'https://img.test/a.jpg' && p.get('message') === '글' && !p.has('published')
        },
      })
      .reply(200, { id: 'P', post_id: '1334_5' }, JSON_HEADERS)
    pool().intercept({ path: (p) => p.startsWith('/v26.0/1334_5?'), method: 'GET' }).reply(200, { permalink_url: FB_PERMALINK }, JSON_HEADERS)
    const r = await publishToFacebook({ ...DRAFT, link: '', image: 'https://img.test/a.jpg', body: '글' }, ctx())
    expect(r.status).toBe('published')
  })
})
