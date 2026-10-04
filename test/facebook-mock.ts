import type { MockAgent } from 'undici'
import { JSON_HEADERS } from './threads-mock.js'

export const FB_ORIGIN = 'https://graph.facebook.com'
export const PAGE_ID = '1334'
export const PAGE_TOKEN = 'FBTOKEN456'
export const FB_POST_ID = '1334_999'
export const FB_PERMALINK = 'https://www.facebook.com/mypage/posts/999'

export function mockFacebookSuccess(agent: MockAgent): void {
  const pool = agent.get(FB_ORIGIN)
  pool.intercept({ path: `/v26.0/${PAGE_ID}/feed`, method: 'POST' }).reply(200, { id: FB_POST_ID }, JSON_HEADERS)
  pool
    .intercept({ path: (p) => p.startsWith(`/v26.0/${FB_POST_ID}?`), method: 'GET' })
    .reply(200, { id: FB_POST_ID, permalink_url: FB_PERMALINK }, JSON_HEADERS)
}
