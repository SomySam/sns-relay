import type { MockAgent } from 'undici'
import { JSON_HEADERS } from './threads-mock.js'

export const IG_ORIGIN = 'https://graph.instagram.com'
export const IG_UID = '1784'
export const IG_TOKEN_VALUE = 'IGTOKEN789'
export const IG_PERMALINK = 'https://www.instagram.com/p/XYZ/'

export function mockInstagramSuccess(agent: MockAgent): void {
  const pool = agent.get(IG_ORIGIN)
  pool.intercept({ path: `/v25.0/${IG_UID}/media`, method: 'POST' }).reply(200, { id: 'ic1' }, JSON_HEADERS)
  pool
    .intercept({ path: (p) => p.startsWith('/v25.0/ic1?'), method: 'GET' })
    .reply(200, { id: 'ic1', status_code: 'FINISHED' }, JSON_HEADERS)
  pool.intercept({ path: `/v25.0/${IG_UID}/media_publish`, method: 'POST' }).reply(200, { id: 'im1' }, JSON_HEADERS)
  pool
    .intercept({ path: (p) => p.startsWith('/v25.0/im1?'), method: 'GET' })
    .reply(200, { id: 'im1', permalink: IG_PERMALINK }, JSON_HEADERS)
}
