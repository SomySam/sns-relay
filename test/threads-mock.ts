import type { MockAgent } from 'undici'

export const THREADS_ORIGIN = 'https://graph.threads.net'
export const UID = '42'
export const TOKEN = 'TESTTOKEN123'
export const JSON_HEADERS = { headers: { 'content-type': 'application/json' } }
export const PERMALINK = 'https://www.threads.net/@my.threads/post/ABC'

export const noSleep = async (_ms: number): Promise<void> => {}

/** 컨테이너 → FINISHED → 게시 → 주소, 한 번의 성공 흐름 */
export function mockThreadsSuccess(agent: MockAgent, opts: { containerId?: string; mediaId?: string } = {}): void {
  const cid = opts.containerId ?? 'c1'
  const mid = opts.mediaId ?? 'm1'
  const pool = agent.get(THREADS_ORIGIN)
  pool.intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: cid }, JSON_HEADERS)
  pool
    .intercept({ path: (p) => p.startsWith(`/v1.0/${cid}?`), method: 'GET' })
    .reply(200, { id: cid, status: 'FINISHED' }, JSON_HEADERS)
  pool.intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' }).reply(200, { id: mid }, JSON_HEADERS)
  pool
    .intercept({ path: (p) => p.startsWith(`/v1.0/${mid}?`), method: 'GET' })
    .reply(200, { id: mid, permalink: PERMALINK }, JSON_HEADERS)
}
