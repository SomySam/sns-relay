import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

export const ENV_KEYS = [
  'META_APP_ID',
  'META_APP_SECRET',
  'THREADS_APP_ID',
  'THREADS_APP_SECRET',
  'THREADS_USER_ID',
  'THREADS_TOKEN',
  'THREADS_TOKEN_EXPIRES_AT',
  'IG_APP_ID',
  'IG_APP_SECRET',
  'IG_USER_ID',
  'IG_TOKEN',
  'IG_TOKEN_EXPIRES_AT',
  'FB_PAGE_ID',
  'FB_PAGE_TOKEN',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const
export type EnvKey = (typeof ENV_KEYS)[number]
export type Env = Partial<Record<EnvKey, string>>

/** 작업 폴더의 .env 만 읽는다. process.env 는 쓰지 않는다(다른 프로그램의 비밀이 섞이지 않게). */
export function loadEnv(root: string): Env {
  const path = join(root, '.env')
  if (!existsSync(path)) return {}
  const parsed = parseEnv(readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'))
  const env: Env = {}
  for (const key of ENV_KEYS) {
    const value = parsed[key]?.trim()
    if (value) env[key] = value
  }
  return env
}

/** 텍스트 속의 .env 값(minLength 이상)을 긴 것부터 '***' 로 가린다 — 오류 메시지에 비밀이 섞이지 않게. */
export function scrubEnvValues(text: string, env: Env, minLength = 4): string {
  let out = text
  const values = Object.values(env)
    .filter((v): v is string => !!v && v.length >= minLength)
    .sort((a, b) => b.length - a.length)
  for (const v of values) out = out.split(v).join('***')
  return out
}

export function requireEnv<K extends EnvKey>(env: Env, keys: K[]): Record<K, string> {
  const missing = keys.filter((k) => !env[k])
  if (missing.length > 0) {
    throw new Error(`작업 폴더 .env 에 ${missing.join(', ')} 값이 없습니다.`)
  }
  return Object.fromEntries(keys.map((k) => [k, env[k] as string])) as Record<K, string>
}
