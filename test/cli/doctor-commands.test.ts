import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/program.js'
import { initWorkspace, loadConfig } from '../../src/core/config.js'
import { loadEnv } from '../../src/core/env.js'
import { installMockAgent, makeIo, makeTempDir } from '../helpers.js'

const JSON_HEADERS = { headers: { 'content-type': 'application/json' } }
let agent: MockAgent
let restore: () => Promise<void>
let root: string

beforeEach(async () => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  await initWorkspace(root)
  const config = await loadConfig(root)
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, channels: ['threads', 'naver'] }, null, 2))
})
afterEach(() => restore())

const run = async (args: string[]) => {
  const t = makeIo(root)
  const code = await runCli(args, t.io)
  return { code, out: t.out.join('\n'), err: t.err.join('\n') }
}

describe('doctor', () => {
  it('채널별 결과를 보여 주고, 오류가 없으면 0', async () => {
    writeFileSync(join(root, '.env'), 'THREADS_USER_ID=42\nTHREADS_TOKEN=THTOKEN12345\nTHREADS_TOKEN_EXPIRES_AT=2099-01-01\n')
    agent.get('https://graph.threads.net').intercept({ path: (p) => p.startsWith('/v1.0/me?'), method: 'GET' }).reply(200, { id: '42', username: 'my.threads' }, JSON_HEADERS)
    const r = await run(['doctor'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('✔ threads')
    expect(r.out).toContain('@my.threads')
    expect(r.out).toContain('- naver')
    expect(r.out).not.toContain('THTOKEN12345')
  })

  it('오류가 있으면 1', async () => {
    writeFileSync(join(root, '.env'), '')
    const r = await run(['doctor'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('✖ threads')
  })
})

describe('token refresh', () => {
  it('갱신하고 만료일만 보여 준다', async () => {
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=OLDTH12345\n')
    agent
      .get('https://graph.threads.net')
      .intercept({ path: (p) => p.startsWith('/refresh_access_token?'), method: 'GET' })
      .reply(200, { access_token: 'NEWTH67890', token_type: 'bearer', expires_in: 5184000 }, JSON_HEADERS)
    const r = await run(['token', 'refresh', 'threads'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/✔ threads 토큰을 갱신했습니다 — 만료 \d{4}-\d{2}-\d{2}/)
    expect(r.out + r.err).not.toContain('NEWTH67890')
    expect(r.out + r.err).not.toContain('OLDTH12345')
    expect(loadEnv(root).THREADS_TOKEN).toBe('NEWTH67890')
  })

  it('facebook 은 갱신 대상이 아니다', async () => {
    const r = await run(['token', 'refresh', 'facebook'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('threads, instagram')
  })
})

describe('token page', () => {
  it('보이지 않는 입력으로 토큰을 받고 페이지 이름만 보여 준다', async () => {
    writeFileSync(join(root, '.env'), 'META_APP_ID=appid1\nMETA_APP_SECRET=APPSECRET999\nFB_PAGE_ID=1334\n')
    const fbAgent = agent.get('https://graph.facebook.com')
    fbAgent
      .intercept({ path: (p) => p.startsWith('/v26.0/oauth/access_token?'), method: 'GET' })
      .reply(200, { access_token: 'LONGUSER456', token_type: 'bearer', expires_in: 5183944 }, JSON_HEADERS)
    fbAgent
      .intercept({ path: (p) => p.startsWith('/v26.0/me/accounts?'), method: 'GET' })
      .reply(200, { data: [{ id: '1334', name: '테스트 페이지', access_token: 'NEWPAGE789' }] }, JSON_HEADERS)
    const t = makeIo(root)
    const prompts: string[] = []
    const code = await runCli(['token', 'page'], { ...t.io, readSecret: async (p) => (prompts.push(p), 'SHORTUSER123') })
    expect(code).toBe(0)
    expect(prompts[0]).toContain('사용자 토큰')
    const shown = t.out.join('\n') + t.err.join('\n')
    expect(shown).toContain('✔ 페이스북 페이지 「테스트 페이지」(1334) 토큰을 .env 에 저장했습니다')
    for (const secret of ['SHORTUSER123', 'LONGUSER456', 'NEWPAGE789', 'APPSECRET999']) expect(shown).not.toContain(secret)
    expect(loadEnv(root).FB_PAGE_TOKEN).toBe('NEWPAGE789')
  })

  it('필요한 .env 값이 없으면 입력받기 전에 1', async () => {
    writeFileSync(join(root, '.env'), 'META_APP_ID=appid1\n')
    const t = makeIo(root)
    let called = false
    const code = await runCli(['token', 'page'], { ...t.io, readSecret: async () => ((called = true), 'X') })
    expect(code).toBe(1)
    expect(called).toBe(false)
    expect(t.err.join('\n')).toContain('META_APP_SECRET')
  })

  it('입력 수단이 없으면(비대화형) 1', async () => {
    const t = makeIo(root)
    const code = await runCli(['token', 'page'], t.io)
    expect(code).toBe(1)
    expect(t.err.join('\n')).toContain('터미널')
  })
})
