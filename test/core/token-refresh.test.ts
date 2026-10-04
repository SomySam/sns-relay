import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../src/core/env.js'
import { refreshToken } from '../../src/core/token-refresh.js'
import { installMockAgent, makeTempDir } from '../helpers.js'

const NOW = () => new Date('2026-11-20T09:00:00Z')
const JSON_HEADERS = { headers: { 'content-type': 'application/json' } }
let agent: MockAgent
let restore: () => Promise<void>
let root: string

beforeEach(() => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  writeFileSync(join(root, '.env'), '# 비밀\nTHREADS_USER_ID=42\nTHREADS_TOKEN=OLDTH12345\nIG_USER_ID=1784\nIG_TOKEN=OLDIG12345\n')
})
afterEach(() => restore())

describe('refreshToken', () => {
  it('Threads — 새 토큰과 만료일을 .env 에 쓰고, 결과에는 토큰을 싣지 않는다', async () => {
    agent
      .get('https://graph.threads.net')
      .intercept({ path: (p) => p.startsWith('/refresh_access_token?') && p.includes('grant_type=th_refresh_token'), method: 'GET' })
      .reply(200, { access_token: 'NEWTH67890', token_type: 'bearer', expires_in: 5184000 }, JSON_HEADERS)
    const r = await refreshToken(root, 'threads', NOW)
    expect(r).toEqual({ channel: 'threads', expiresAt: '2027-01-19' })
    expect(JSON.stringify(r)).not.toContain('NEWTH67890')
    const env = loadEnv(root)
    expect(env.THREADS_TOKEN).toBe('NEWTH67890')
    expect(env.THREADS_TOKEN_EXPIRES_AT).toBe('2027-01-19')
    expect(env.IG_TOKEN).toBe('OLDIG12345')
    expect(readFileSync(join(root, '.env'), 'utf8').startsWith('# 비밀\n')).toBe(true)
  })

  it('Instagram — ig_refresh_token 으로 갱신한다', async () => {
    agent
      .get('https://graph.instagram.com')
      .intercept({ path: (p) => p.startsWith('/refresh_access_token?') && p.includes('grant_type=ig_refresh_token'), method: 'GET' })
      .reply(200, { access_token: 'NEWIG67890', token_type: 'bearer', expires_in: 5184000 }, JSON_HEADERS)
    await refreshToken(root, 'instagram', NOW)
    expect(loadEnv(root).IG_TOKEN).toBe('NEWIG67890')
    expect(loadEnv(root).IG_TOKEN_EXPIRES_AT).toBe('2027-01-19')
  })

  it('거절되면 .env 를 바꾸지 않고, 오류에 토큰 값이 없다', async () => {
    agent
      .get('https://graph.threads.net')
      .intercept({ path: (p) => p.startsWith('/refresh_access_token?'), method: 'GET' })
      .reply(400, { error: { message: 'token OLDTH12345 too new', type: 'OAuthException', code: 190 } }, JSON_HEADERS)
    const before = readFileSync(join(root, '.env'), 'utf8')
    const err = await refreshToken(root, 'threads', NOW).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('OLDTH12345')
    expect((err as Error).message).toContain('24시간')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(before)
  })

  it('응답에 access_token 이 없으면 .env 를 바꾸지 않는다', async () => {
    agent
      .get('https://graph.threads.net')
      .intercept({ path: (p) => p.startsWith('/refresh_access_token?'), method: 'GET' })
      .reply(200, { token_type: 'bearer' }, JSON_HEADERS)
    await expect(refreshToken(root, 'threads', NOW)).rejects.toThrow('새 토큰')
    expect(loadEnv(root).THREADS_TOKEN).toBe('OLDTH12345')
  })

  it('.env 가 없으면 API 를 부르지 않고 오류', async () => {
    rmSync(join(root, '.env'))
    await expect(refreshToken(root, 'threads', NOW)).rejects.toThrow('.env')
  })

  it('토큰이 없으면 요청하지 않고 오류', async () => {
    writeFileSync(join(root, '.env'), 'THREADS_USER_ID=42\n')
    await expect(refreshToken(root, 'threads', NOW)).rejects.toThrow('THREADS_TOKEN')
  })
})
