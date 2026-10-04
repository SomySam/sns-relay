import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../src/core/env.js'
import { issuePageToken } from '../../src/core/fb-page-token.js'
import { installMockAgent, makeTempDir } from '../helpers.js'

const JSON_HEADERS = { headers: { 'content-type': 'application/json' } }
let agent: MockAgent
let restore: () => Promise<void>
let root: string

beforeEach(() => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  writeFileSync(join(root, '.env'), 'META_APP_ID=appid1\nMETA_APP_SECRET=APPSECRET999\nFB_PAGE_ID=1334\nFB_PAGE_TOKEN=OLDPAGE12345\n')
})
afterEach(() => restore())

const fb = () => agent.get('https://graph.facebook.com')
const exchangeOk = () =>
  fb()
    .intercept({ path: (p) => p.startsWith('/v26.0/oauth/access_token?') && p.includes('grant_type=fb_exchange_token') && p.includes('fb_exchange_token=SHORTUSER123'), method: 'GET' })
    .reply(200, { access_token: 'LONGUSER456', token_type: 'bearer', expires_in: 5183944 }, JSON_HEADERS)

describe('issuePageToken', () => {
  it('장기 사용자 토큰으로 바꾼 뒤 FB_PAGE_ID 의 페이지 토큰을 .env 에 쓴다', async () => {
    exchangeOk()
    fb()
      .intercept({ path: (p) => p.startsWith('/v26.0/me/accounts?') && p.includes('access_token=LONGUSER456'), method: 'GET' })
      .reply(200, { data: [{ id: '999', name: '다른 페이지', access_token: 'OTHERPAGE' }, { id: '1334', name: '테스트 페이지', access_token: 'NEWPAGE789' }] }, JSON_HEADERS)
    const r = await issuePageToken(root, 'SHORTUSER123')
    expect(r).toEqual({ pageId: '1334', pageName: '테스트 페이지' })
    expect(loadEnv(root).FB_PAGE_TOKEN).toBe('NEWPAGE789')
    expect(loadEnv(root).META_APP_SECRET).toBe('APPSECRET999')
  })

  it('FB_PAGE_ID 페이지가 목록에 없으면 .env 를 바꾸지 않고 받은 페이지 이름·ID 만 알려 준다', async () => {
    exchangeOk()
    fb()
      .intercept({ path: (p) => p.startsWith('/v26.0/me/accounts?'), method: 'GET' })
      .reply(200, { data: [{ id: '999', name: '다른 페이지', access_token: 'OTHERPAGE' }] }, JSON_HEADERS)
    const before = readFileSync(join(root, '.env'), 'utf8')
    const err = await issuePageToken(root, 'SHORTUSER123').catch((e: Error) => e)
    expect((err as Error).message).toContain('1334')
    expect((err as Error).message).toContain('다른 페이지(999)')
    expect((err as Error).message).not.toContain('OTHERPAGE')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(before)
  })

  it('교환이 거절되면 오류에 단기 토큰·앱 시크릿이 없다', async () => {
    fb()
      .intercept({ path: (p) => p.startsWith('/v26.0/oauth/access_token?'), method: 'GET' })
      .reply(400, { error: { message: 'bad SHORTUSER123 APPSECRET999', type: 'OAuthException', code: 190 } }, JSON_HEADERS)
    const err = await issuePageToken(root, 'SHORTUSER123').catch((e: Error) => e)
    expect((err as Error).message).not.toContain('SHORTUSER123')
    expect((err as Error).message).not.toContain('APPSECRET999')
    expect((err as Error).message).toContain('페이지 토큰을 발급하지 못했습니다')
  })

  it('앱 ID·시크릿이 없으면 요청하지 않고 오류', async () => {
    writeFileSync(join(root, '.env'), 'FB_PAGE_ID=1334\n')
    await expect(issuePageToken(root, 'SHORTUSER123')).rejects.toThrow('META_APP_ID')
  })

  it('빈 토큰은 거부한다', async () => {
    await expect(issuePageToken(root, '  ')).rejects.toThrow('비어 있습니다')
  })
})
