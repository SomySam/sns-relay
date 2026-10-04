import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace } from '../../src/core/config.js'
import { runDoctor } from '../../src/core/health.js'
import { installMockAgent, makeTempDir } from '../helpers.js'

const NOW = () => new Date('2026-11-20T00:00:00Z')
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

const env = (lines: string[]) => writeFileSync(join(root, '.env'), lines.join('\n') + '\n')
const threads = () => agent.get('https://graph.threads.net')
const ig = () => agent.get('https://graph.instagram.com')
const fb = () => agent.get('https://graph.facebook.com')
const byChannel = async () => Object.fromEntries((await runDoctor(root, NOW)).map((r) => [r.channel, r]))

describe('runDoctor — Threads', () => {
  it('계정과 남은 날을 보여 주고, 14일 이내면 경고', async () => {
    env(['THREADS_USER_ID=42', 'THREADS_TOKEN=THTOKEN12345', 'THREADS_TOKEN_EXPIRES_AT=2026-11-28'])
    threads()
      .intercept({ path: (p) => p.startsWith('/v1.0/me?'), method: 'GET' })
      .reply(200, { id: '42', username: 'my.threads' }, JSON_HEADERS)
    const r = (await byChannel()).threads
    expect(r.level).toBe('warn')
    expect(r.account).toBe('@my.threads')
    expect(r.daysLeft).toBe(8)
    expect(r.messages.join()).toContain('sns-relay token refresh threads')
  })

  it('만료일을 모르면 경고로 적는 법을 안내한다', async () => {
    env(['THREADS_USER_ID=42', 'THREADS_TOKEN=THTOKEN12345'])
    threads().intercept({ path: (p) => p.startsWith('/v1.0/me?'), method: 'GET' }).reply(200, { id: '42', username: 'a' }, JSON_HEADERS)
    const r = (await byChannel()).threads
    expect(r.level).toBe('warn')
    expect(r.expiresAt).toBeNull()
    expect(r.messages.join()).toContain('THREADS_TOKEN_EXPIRES_AT')
  })

  it('만료일 형식이 틀리면 경고로 고치는 법을 안내한다', async () => {
    for (const bad of ['abc', '2026-02-30']) {
      env(['THREADS_USER_ID=42', 'THREADS_TOKEN=THTOKEN12345', 'THREADS_TOKEN_EXPIRES_AT=' + bad])
      threads().intercept({ path: (p) => p.startsWith('/v1.0/me?'), method: 'GET' }).reply(200, { id: '42', username: 'a' }, JSON_HEADERS)
      const r = (await byChannel()).threads
      expect(r.level).toBe('warn')
      expect(r.expiresAt).toBeNull()
      expect(r.messages.join()).toContain('.env 의 THREADS_TOKEN_EXPIRES_AT 값 형식이 틀렸습니다(YYYY-MM-DD). sns-relay token refresh threads 로 다시 적거나 고치세요.')
    }
  })

  it('계정 ID 가 다르면 오류', async () => {
    env(['THREADS_USER_ID=99', 'THREADS_TOKEN=THTOKEN12345', 'THREADS_TOKEN_EXPIRES_AT=2027-01-30'])
    threads().intercept({ path: (p) => p.startsWith('/v1.0/me?'), method: 'GET' }).reply(200, { id: '42', username: 'a' }, JSON_HEADERS)
    const r = (await byChannel()).threads
    expect(r.level).toBe('error')
    expect(r.messages.join()).toContain('THREADS_USER_ID')
  })

  it('토큰이 거절되면 오류이고 토큰 값은 싣지 않는다', async () => {
    env(['THREADS_USER_ID=42', 'THREADS_TOKEN=THTOKEN12345'])
    threads()
      .intercept({ path: (p) => p.startsWith('/v1.0/me?'), method: 'GET' })
      .reply(400, { error: { message: 'Invalid token THTOKEN12345', type: 'OAuthException', code: 190 } }, JSON_HEADERS)
    const r = (await byChannel()).threads
    expect(r.level).toBe('error')
    expect(JSON.stringify(r)).not.toContain('THTOKEN12345')
  })

  it('토큰이 없으면 오류로 빠진 키를 알려 주고 요청하지 않는다', async () => {
    env([])
    const r = (await byChannel()).threads
    expect(r.level).toBe('error')
    expect(r.messages.join()).toContain('THREADS_TOKEN')
  })
})

describe('runDoctor — Instagram', () => {
  it('user_id 와 IG_USER_ID 를 맞춰 보고 만료가 지났으면 오류', async () => {
    env(['IG_USER_ID=1784', 'IG_TOKEN=IGTOKEN12345', 'IG_TOKEN_EXPIRES_AT=2026-11-10'])
    ig().intercept({ path: (p) => p.startsWith('/v25.0/me?'), method: 'GET' }).reply(200, { user_id: '1784', username: 'myinsta' }, JSON_HEADERS)
    const r = (await byChannel()).instagram
    expect(r.account).toBe('@myinsta')
    expect(r.level).toBe('error')
    expect(r.daysLeft).toBe(-10)
  })
})

describe('runDoctor — Facebook', () => {
  const debug = (data: Record<string, unknown>) =>
    fb().intercept({ path: (p) => p.startsWith('/v26.0/debug_token?'), method: 'GET' }).reply(200, { data }, JSON_HEADERS)
  const page = () =>
    fb().intercept({ path: (p) => p.startsWith('/v26.0/1334?'), method: 'GET' }).reply(200, { id: '1334', name: '내 페이지' }, JSON_HEADERS)

  it('만료 없는 페이지 토큰 — 데이터 접근 만료일을 보여 준다', async () => {
    env(['META_APP_ID=app', 'META_APP_SECRET=APPSECRET999', 'FB_PAGE_ID=1334', 'FB_PAGE_TOKEN=FBTOKEN12345'])
    debug({ is_valid: true, expires_at: 0, data_access_expires_at: Date.parse('2026-12-28T00:00:00Z') / 1000, scopes: ['pages_manage_posts', 'pages_read_engagement'], profile_id: '1334' })
    page()
    const r = (await byChannel()).facebook
    expect(r.level).toBe('ok')
    expect(r.account).toBe('내 페이지')
    expect(r.expiresAt).toBe('2026-12-28')
    expect(r.daysLeft).toBe(38)
    expect(r.messages.join()).toContain('만료 없음')
  })

  it('게시 권한이 없거나 다른 페이지면 오류', async () => {
    env(['FB_PAGE_ID=1334', 'FB_PAGE_TOKEN=FBTOKEN12345'])
    debug({ is_valid: true, expires_at: 0, scopes: ['pages_read_engagement'], profile_id: '777' })
    page()
    const r = (await byChannel()).facebook
    expect(r.level).toBe('error')
    expect(r.messages.join()).toContain('pages_manage_posts')
    expect(r.messages.join()).toContain('FB_PAGE_ID')
  })

  it('is_valid 가 false 면 오류', async () => {
    env(['FB_PAGE_ID=1334', 'FB_PAGE_TOKEN=FBTOKEN12345'])
    debug({ is_valid: false, expires_at: 0, scopes: [] })
    expect((await byChannel()).facebook.level).toBe('error')
  })

  it('페이지 토큰 만료일이 가까우면 데이터 접근 기한보다 먼저 경고한다', async () => {
    env(['FB_PAGE_ID=1334', 'FB_PAGE_TOKEN=FBTOKEN12345'])
    debug({ is_valid: true, expires_at: Date.parse('2026-11-25T00:00:00Z') / 1000, data_access_expires_at: Date.parse('2026-12-28T00:00:00Z') / 1000, scopes: ['pages_manage_posts'], profile_id: '1334' })
    page()
    const r = (await byChannel()).facebook
    expect(r.level).toBe('warn')
    expect(r.daysLeft).toBe(5)
    expect(r.expiresAt).toBe('2026-11-25')
  })

  it('debug_token 오류에 앱 시크릿·토큰 값이 섞여도 가린다', async () => {
    env(['META_APP_ID=app', 'META_APP_SECRET=APPSECRET999', 'FB_PAGE_ID=1334', 'FB_PAGE_TOKEN=FBTOKEN12345'])
    fb()
      .intercept({ path: (p) => p.startsWith('/v26.0/debug_token?'), method: 'GET' })
      .reply(400, { error: { message: 'bad APPSECRET999 FBTOKEN12345 app|APPSECRET999', type: 'OAuthException', code: 190 } }, JSON_HEADERS)
    const r = (await byChannel()).facebook
    expect(r.level).toBe('error')
    const json = JSON.stringify(r)
    expect(json).not.toContain('APPSECRET999')
    expect(json).not.toContain('FBTOKEN12345')
  })
})

describe('runDoctor — 네이버', () => {
  it('수동 채널은 건너뛴다', async () => {
    env([])
    expect((await byChannel()).naver).toEqual({ channel: 'naver', level: 'skip', messages: ['수동 발행 채널 — 점검할 토큰이 없습니다.'] })
  })
})

describe('runDoctor — Cloudinary', () => {
  const setHost = async (host: 'url' | 'cloudinary') => {
    const { loadConfig } = await import('../../src/core/config.js')
    const config = await loadConfig(root)
    writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, channels: ['naver'], imageHost: host }, null, 2))
  }

  it('imageHost 가 url 이고 키가 없으면 점검하지 않는다', async () => {
    await setHost('url')
    env([])
    const reports = await runDoctor(root, NOW)
    expect(reports.map((r) => r.channel)).toEqual(['naver'])
  })

  it('cloudinary 인데 키가 없으면 오류', async () => {
    await setHost('cloudinary')
    env([])
    const r = (await runDoctor(root, NOW)).find((x) => x.channel === 'cloudinary')!
    expect(r.level).toBe('error')
    expect(r.messages.join()).toContain('CLOUDINARY_CLOUD_NAME')
  })

  it('연결되면 이번 달 크레딧 사용량을 보여 주고, secret 은 싣지 않는다', async () => {
    await setHost('cloudinary')
    env(['CLOUDINARY_CLOUD_NAME=demo', 'CLOUDINARY_API_KEY=123456', 'CLOUDINARY_API_SECRET=CLSECRET999'])
    agent
      .get('https://api.cloudinary.com')
      .intercept({ path: '/v1_1/demo/usage', method: 'GET' })
      .reply(200, { plan: 'Free', credits: { usage: 1.25, limit: 25, used_percent: 5 } }, JSON_HEADERS)
    const r = (await runDoctor(root, NOW)).find((x) => x.channel === 'cloudinary')!
    expect(r.level).toBe('ok')
    expect(r.messages.join()).toContain('1.25/25')
    expect(JSON.stringify(r)).not.toContain('CLSECRET999')
  })

  it('키가 틀리면 오류', async () => {
    await setHost('cloudinary')
    env(['CLOUDINARY_CLOUD_NAME=demo', 'CLOUDINARY_API_KEY=123456', 'CLOUDINARY_API_SECRET=CLSECRET999'])
    agent.get('https://api.cloudinary.com').intercept({ path: '/v1_1/demo/usage', method: 'GET' }).reply(401, { error: { message: 'bad CLSECRET999' } }, JSON_HEADERS)
    const r = (await runDoctor(root, NOW)).find((x) => x.channel === 'cloudinary')!
    expect(r.level).toBe('error')
    expect(JSON.stringify(r)).not.toContain('CLSECRET999')
  })

  it('cloud name 이 계정과 다르면 그 이유를 알려 준다', async () => {
    await setHost('cloudinary')
    env(['CLOUDINARY_CLOUD_NAME=demo', 'CLOUDINARY_API_KEY=123456', 'CLOUDINARY_API_SECRET=CLSECRET999'])
    agent.get('https://api.cloudinary.com').intercept({ path: '/v1_1/demo/usage', method: 'GET' }).reply(401, { error: { message: 'cloud_name mismatch' } }, JSON_HEADERS)
    const r = (await runDoctor(root, NOW)).find((x) => x.channel === 'cloudinary')!
    expect(r.level).toBe('error')
    expect(r.messages.join()).toContain('CLOUDINARY_CLOUD_NAME 이 API key 의 계정과 다릅니다')
  })
})
