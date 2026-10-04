import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnv, requireEnv, scrubEnvValues } from './env.js'
import { updateEnvFile } from './env-file.js'
import { describeMetaError, metaRequest } from './meta-http.js'

export type RefreshableChannel = 'threads' | 'instagram'

const SETTINGS = {
  threads: { base: 'https://graph.threads.net', grant: 'th_refresh_token', tokenKey: 'THREADS_TOKEN', expiresKey: 'THREADS_TOKEN_EXPIRES_AT' },
  instagram: { base: 'https://graph.instagram.com', grant: 'ig_refresh_token', tokenKey: 'IG_TOKEN', expiresKey: 'IG_TOKEN_EXPIRES_AT' },
} as const

/**
 * 장기 토큰을 갱신해 .env 에 새 토큰과 만료일을 쓴다. 토큰 값은 돌려주지도, 오류에 싣지도 않는다.
 * 조건(Meta): 발급 24시간 뒤부터, 만료 전에만 갱신된다. 갱신하면 60일이 다시 시작된다.
 */
export async function refreshToken(
  root: string,
  channel: RefreshableChannel,
  now: () => Date = () => new Date(),
): Promise<{ channel: RefreshableChannel; expiresAt: string }> {
  const s = SETTINGS[channel]
  const env = loadEnv(root)
  const token = requireEnv(env, [s.tokenKey])[s.tokenKey]

  // 갱신하면 이전 토큰이 바뀌므로, .env 를 쓸 수 있는지 API 를 부르기 전에 확인한다.
  const envPath = join(root, '.env')
  try {
    await access(envPath, constants.R_OK | constants.W_OK)
  } catch {
    throw new Error(`.env 를 쓸 수 없어 갱신하지 않았습니다 (${envPath}). 파일 권한·잠금을 확인하세요.`)
  }

  let res: Record<string, unknown>
  try {
    res = await metaRequest({ base: s.base, path: '/refresh_access_token', params: { grant_type: s.grant }, token })
  } catch (e) {
    const message = scrubEnvValues(describeMetaError(e), env)
    throw new Error(`${channel} 토큰을 갱신하지 못했습니다: ${message} (발급 24시간 이내이거나 이미 만료된 토큰은 갱신되지 않습니다.)`)
  }

  const next = typeof res.access_token === 'string' ? res.access_token : ''
  const seconds = typeof res.expires_in === 'number' ? res.expires_in : NaN
  if (!next || !Number.isFinite(seconds)) {
    throw new Error(`${channel} 갱신 응답에 새 토큰이나 만료 시간이 없습니다. .env 는 바꾸지 않았습니다.`)
  }
  const expiresAt = new Date(now().getTime() + seconds * 1000).toISOString().slice(0, 10)
  try {
    await updateEnvFile(root, { [s.tokenKey]: next, [s.expiresKey]: expiresAt })
  } catch (e) {
    // 새 토큰은 화면에 내지 않는다. 이전 토큰은 원래 만료일까지 쓸 수 있으니 다시 갱신하면 된다.
    throw new Error(`${channel} 토큰은 갱신됐지만 .env 에 쓰지 못했습니다: ${(e as Error).message}. 다시 실행하세요.`)
  }
  return { channel, expiresAt }
}
