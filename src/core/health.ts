import { cloudinaryUsage } from './cloudinary.js'
import { FACEBOOK_API_BASE } from './channels/facebook-api.js'
import { INSTAGRAM_API_BASE } from './channels/instagram-api.js'
import { THREADS_API_BASE } from './channels/threads-api.js'
import { loadConfig } from './config.js'
import { loadEnv, scrubEnvValues, type Env, type EnvKey } from './env.js'
import { describeMetaError, metaRequest } from './meta-http.js'
import type { ChannelId } from './types.js'

export type HealthLevel = 'ok' | 'warn' | 'error' | 'skip'

export interface HealthReport {
  channel: ChannelId | 'cloudinary'
  level: HealthLevel
  /** 토큰이 가리키는 계정(@이름 또는 페이지 이름) */
  account?: string
  /** 만료일(YYYY-MM-DD). null 이면 모른다. */
  expiresAt?: string | null
  daysLeft?: number | null
  messages: string[]
}

export const EXPIRY_WARN_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

const worst = (a: HealthLevel, b: HealthLevel): HealthLevel => {
  const order: HealthLevel[] = ['skip', 'ok', 'warn', 'error']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

function daysUntil(date: Date, now: Date): number {
  const d0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const d1 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.round((d1 - d0) / DAY_MS)
}

/** 만료일 판정 — 지났으면 error, 14일 이내면 warn. */
function expiryReport(expires: Date | null, now: Date, refreshHint: string): { level: HealthLevel; expiresAt: string | null; daysLeft: number | null; message: string } {
  if (!expires) {
    return { level: 'warn', expiresAt: null, daysLeft: null, message: '' }
  }
  const daysLeft = daysUntil(expires, now)
  const expiresAt = expires.toISOString().slice(0, 10)
  if (daysLeft < 0) return { level: 'error', expiresAt, daysLeft, message: `토큰이 ${expiresAt} 에 만료됐습니다. 새로 발급해 .env 에 넣으세요.` }
  if (daysLeft <= EXPIRY_WARN_DAYS) return { level: 'warn', expiresAt, daysLeft, message: `만료까지 ${daysLeft}일 (${expiresAt}). ${refreshHint}` }
  return { level: 'ok', expiresAt, daysLeft, message: `만료까지 ${daysLeft}일 (${expiresAt})` }
}

/** YYYY-MM-DD 만 받는다(달력에 없는 날짜도 거부). 값이 없으면 null, 틀리면 'invalid'. */
function parseDate(value: string | undefined): Date | null | 'invalid' {
  const v = value?.trim()
  if (!v) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'invalid'
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? 'invalid' : d
}

function missing(env: Env, keys: EnvKey[]): EnvKey[] {
  return keys.filter((k) => !env[k])
}

async function checkUserToken(opts: {
  channel: 'threads' | 'instagram'
  env: Env
  now: Date
  base: string
  idKey: 'THREADS_USER_ID' | 'IG_USER_ID'
  tokenKey: 'THREADS_TOKEN' | 'IG_TOKEN'
  expiresKey: 'THREADS_TOKEN_EXPIRES_AT' | 'IG_TOKEN_EXPIRES_AT'
  fields: string
  idField: 'id' | 'user_id'
}): Promise<HealthReport> {
  const { channel, env, now } = opts
  const lack = missing(env, [opts.idKey, opts.tokenKey])
  if (lack.length > 0) return { channel, level: 'error', messages: [`.env 에 ${lack.join(', ')} 값이 없습니다.`] }

  const messages: string[] = []
  let level: HealthLevel = 'ok'
  let account: string | undefined
  try {
    const me = await metaRequest({ base: opts.base, path: '/me', params: { fields: opts.fields }, token: env[opts.tokenKey]! })
    account = typeof me.username === 'string' ? `@${me.username}` : undefined
    if (String(me[opts.idField]) !== env[opts.idKey]) {
      level = 'error'
      messages.push(`${opts.idKey} 가 토큰의 계정과 다릅니다. 토큰 계정 ID 로 고치세요.`)
    } else {
      messages.push('토큰 확인됨')
    }
  } catch (e) {
    return { channel, level: 'error', messages: [scrubEnvValues(describeMetaError(e), env)] }
  }

  const parsed = parseDate(env[opts.expiresKey])
  if (parsed === 'invalid') {
    messages.push(`.env 의 ${opts.expiresKey} 값 형식이 틀렸습니다(YYYY-MM-DD). sns-relay token refresh ${channel} 로 다시 적거나 고치세요.`)
    return { channel, level: worst(level, 'warn'), account, expiresAt: null, daysLeft: null, messages }
  }
  const exp = expiryReport(parsed, now, `sns-relay token refresh ${channel} 로 갱신하세요.`)
  level = worst(level, exp.level)
  messages.push(
    exp.expiresAt === null
      ? `만료일을 모릅니다. sns-relay token refresh ${channel} 를 한 번 실행하거나 .env 에 ${opts.expiresKey}=YYYY-MM-DD 를 적으세요.`
      : exp.message,
  )
  return { channel, level, account, expiresAt: exp.expiresAt, daysLeft: exp.daysLeft, messages }
}

async function checkFacebook(env: Env, now: Date): Promise<HealthReport> {
  const channel = 'facebook' as const
  const lack = missing(env, ['FB_PAGE_ID', 'FB_PAGE_TOKEN'])
  if (lack.length > 0) return { channel, level: 'error', messages: [`.env 에 ${lack.join(', ')} 값이 없습니다.`] }

  const pageToken = env.FB_PAGE_TOKEN!
  // 앱 토큰(APP_ID|APP_SECRET)이 있으면 그것으로, 없으면 페이지 토큰 자체로 조회한다.
  const inspector = env.META_APP_ID && env.META_APP_SECRET ? `${env.META_APP_ID}|${env.META_APP_SECRET}` : pageToken
  const messages: string[] = []
  let level: HealthLevel = 'ok'
  let expiresAt: string | null = null
  let daysLeft: number | null = null
  try {
    const res = await metaRequest({ base: FACEBOOK_API_BASE, path: '/debug_token', params: { input_token: pageToken }, token: inspector })
    const data = (res.data ?? {}) as { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; profile_id?: string }
    if (data.is_valid !== true) {
      return { channel, level: 'error', messages: ['페이지 토큰이 유효하지 않습니다. 새로 발급해 .env 에 넣으세요.'] }
    }
    if (!(data.scopes ?? []).includes('pages_manage_posts')) {
      level = 'error'
      messages.push('pages_manage_posts 권한이 없습니다. 권한을 포함해 페이지 토큰을 다시 발급하세요.')
    }
    if (data.profile_id !== undefined && data.profile_id !== env.FB_PAGE_ID) {
      level = 'error'
      messages.push('토큰의 페이지가 FB_PAGE_ID 와 다릅니다.')
    }
    // 만료일이 둘이면 더 이른 쪽을 대표로 보여 준다.
    const earlier = (e: { expiresAt: string | null; daysLeft: number | null }) => {
      if (e.expiresAt !== null && (expiresAt === null || e.expiresAt < expiresAt)) {
        expiresAt = e.expiresAt
        daysLeft = e.daysLeft
      }
    }
    if (typeof data.expires_at === 'number' && data.expires_at > 0) {
      const exp = expiryReport(new Date(data.expires_at * 1000), now, '페이지 토큰을 다시 발급하세요.')
      level = worst(level, exp.level)
      earlier(exp)
      messages.push(`페이지 토큰 — ${exp.message}`)
    } else {
      messages.push('페이지 토큰 만료 없음')
    }
    if (data.data_access_expires_at) {
      const exp = expiryReport(new Date(data.data_access_expires_at * 1000), now, '앱 데이터 접근이 끝나기 전에 페이지 토큰을 다시 발급하세요.')
      level = worst(level, exp.level)
      earlier(exp)
      messages.push(`데이터 접근 — ${exp.message}`)
    }
  } catch (e) {
    return { channel, level: 'error', messages: [scrubEnvValues(describeMetaError(e), env)] }
  }

  let account: string | undefined
  try {
    const page = await metaRequest({ base: FACEBOOK_API_BASE, path: `/${env.FB_PAGE_ID}`, params: { fields: 'name' }, token: pageToken })
    account = typeof page.name === 'string' ? page.name : undefined
  } catch {
    // 이름을 못 가져와도 점검 결과는 그대로 둔다.
  }
  return { channel, level, account, expiresAt, daysLeft, messages }
}

/** config 의 채널마다 토큰을 점검한다. 읽기 전용 요청만 보낸다. */
export async function runDoctor(root: string, now: () => Date = () => new Date()): Promise<HealthReport[]> {
  const config = await loadConfig(root)
  const env = loadEnv(root)
  const at = now()
  const reports: HealthReport[] = []
  for (const channel of config.channels) {
    switch (channel) {
      case 'threads':
        reports.push(
          await checkUserToken({
            channel, env, now: at, base: THREADS_API_BASE,
            idKey: 'THREADS_USER_ID', tokenKey: 'THREADS_TOKEN', expiresKey: 'THREADS_TOKEN_EXPIRES_AT',
            fields: 'id,username', idField: 'id',
          }),
        )
        break
      case 'instagram':
        reports.push(
          await checkUserToken({
            channel, env, now: at, base: INSTAGRAM_API_BASE,
            idKey: 'IG_USER_ID', tokenKey: 'IG_TOKEN', expiresKey: 'IG_TOKEN_EXPIRES_AT',
            fields: 'user_id,username', idField: 'user_id',
          }),
        )
        break
      case 'facebook':
        reports.push(await checkFacebook(env, at))
        break
      case 'naver':
        reports.push({ channel, level: 'skip', messages: ['수동 발행 채널 — 점검할 토큰이 없습니다.'] })
        break
    }
  }
  const hasCloudinaryKey = Boolean(env.CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_API_KEY || env.CLOUDINARY_API_SECRET)
  if (config.imageHost === 'cloudinary' || hasCloudinaryKey) {
    const lack = missing(env, ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'])
    if (lack.length > 0) {
      reports.push({ channel: 'cloudinary', level: 'error', messages: [`.env 에 ${lack.join(', ')} 값이 없습니다.`] })
    } else {
      try {
        const u = await cloudinaryUsage(env)
        reports.push({ channel: 'cloudinary', level: 'ok', account: env.CLOUDINARY_CLOUD_NAME, messages: [`연결 확인됨 — 이번 달 크레딧 ${u.usage}/${u.limit}`] })
      } catch (e) {
        reports.push({ channel: 'cloudinary', level: 'error', messages: [scrubEnvValues((e as Error).message, env)] })
      }
    }
  }
  return reports
}
