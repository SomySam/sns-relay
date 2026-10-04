import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyMetaError, describeMetaError, isClearRejection, MetaError, metaRequest } from '../../src/core/meta-http.js'
import { installMockAgent } from '../helpers.js'
import { JSON_HEADERS, THREADS_ORIGIN, TOKEN } from '../threads-mock.js'

const BASE = `${THREADS_ORIGIN}/v1.0`
let agent: MockAgent
let restore: () => Promise<void>
beforeEach(() => ({ agent, restore } = installMockAgent()))
afterEach(() => restore())

const pool = () => agent.get(THREADS_ORIGIN)

describe('metaRequest', () => {
  it('GET 은 access_token 을 쿼리로 보내고 JSON 을 돌려준다', async () => {
    pool()
      .intercept({ path: (p) => p.startsWith('/v1.0/me?') && p.includes(`access_token=${TOKEN}`) && p.includes('fields=id'), method: 'GET' })
      .reply(200, { id: '42' }, JSON_HEADERS)
    expect(await metaRequest({ base: BASE, path: '/me', params: { fields: 'id' }, token: TOKEN })).toEqual({ id: '42' })
  })

  it('POST 는 form body 로 보낸다', async () => {
    pool()
      .intercept({
        path: '/v1.0/42/threads',
        method: 'POST',
        body: (b) => {
          const p = new URLSearchParams(String(b))
          return p.get('text') === '안녕' && p.get('access_token') === TOKEN
        },
      })
      .reply(200, { id: 'c1' }, JSON_HEADERS)
    expect(await metaRequest({ base: BASE, path: '/42/threads', method: 'POST', params: { text: '안녕' }, token: TOKEN })).toEqual({ id: 'c1' })
  })

  it('Meta 오류는 MetaError 로 바꾸고 토큰을 가린다', async () => {
    pool()
      .intercept({ path: '/v1.0/42/threads', method: 'POST' })
      .reply(400, { error: { message: `Invalid token ${TOKEN}`, code: 190, error_subcode: 463, fbtrace_id: 'T1' } }, JSON_HEADERS)
    const e = await metaRequest({ base: BASE, path: '/42/threads', method: 'POST', token: TOKEN }).catch((x) => x)
    expect(e).toBeInstanceOf(MetaError)
    expect(e.kind).toBe('auth')
    expect(e.code).toBe(190)
    expect(e.subcode).toBe(463)
    expect(e.message).not.toContain(TOKEN)
    expect(e.message).toContain('***')
  })

  it('연결 실패는 network 이고 토큰을 가린다', async () => {
    pool().intercept({ path: '/v1.0/42/threads', method: 'POST' }).replyWithError(new Error(`socket hang up ${TOKEN}`))
    const e = await metaRequest({ base: BASE, path: '/42/threads', method: 'POST', token: TOKEN }).catch((x) => x)
    expect(e.kind).toBe('network')
    expect(e.message).not.toContain(TOKEN)
  })

  it('JSON 이 아닌 5xx 는 transient', async () => {
    pool().intercept({ path: '/v1.0/me', method: 'POST' }).reply(502, 'Bad Gateway')
    const e = await metaRequest({ base: BASE, path: '/me', method: 'POST', token: TOKEN }).catch((x) => x)
    expect(e.kind).toBe('transient')
  })
})

describe('classifyMetaError', () => {
  it.each([
    [400, 190, 'auth'],
    [400, 10, 'permission'],
    [400, 200, 'permission'],
    [400, 4, 'rate'],
    [400, 613, 'rate'],
    [400, 506, 'duplicate'],
    [500, 2, 'transient'],
    [503, undefined, 'transient'],
    [400, 100, 'invalid'],
  ] as const)('HTTP %s, code %s → %s', (status, code, kind) => {
    expect(classifyMetaError(status, code)).toBe(kind)
  })
})

describe('describeMetaError', () => {
  it('토큰 오류에 재발급 안내를 붙인다', () => {
    const text = describeMetaError(new MetaError('Invalid token (code 190)', 'auth', { code: 190 }))
    expect(text).toContain('Invalid token')
    expect(text).toContain('토큰')
  })
})

describe('isClearRejection', () => {
  it.each([
    [new MetaError('x', 'auth', { status: 400, code: 190 }), true],
    [new MetaError('x', 'rate', { status: 400, code: 4 }), true],
    [new MetaError('x', 'invalid', { status: 400, code: 100 }), true],
    [new MetaError('x', 'duplicate', { status: 400, code: 506 }), false],
    [new MetaError('x', 'invalid', { status: 400 }), false],
    [new MetaError('x', 'invalid', { status: 200, code: 100 }), false],
    [new MetaError('x', 'transient', { status: 503 }), false],
    [new MetaError('x', 'network'), false],
    [new Error('x'), false],
  ] as const)('%s → %s', (e, expected) => {
    expect(isClearRejection(e)).toBe(expected)
  })
})

describe('metaRequest — 200 인데 error 가 있는 본문', () => {
  it('MetaError 로 바꾸고 status 는 200 으로 남긴다', async () => {
    pool()
      .intercept({ path: '/v1.0/42/threads', method: 'POST' })
      .reply(200, { error: { message: 'weird', code: 100 } }, JSON_HEADERS)
    const e = await metaRequest({ base: BASE, path: '/42/threads', method: 'POST', token: TOKEN }).catch((x) => x)
    expect(e).toBeInstanceOf(MetaError)
    expect(e.status).toBe(200)
    expect(isClearRejection(e)).toBe(false)
  })
})
