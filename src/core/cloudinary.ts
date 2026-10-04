import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { requireEnv, scrubEnvValues, type Env } from './env.js'

export const CLOUDINARY_API = 'https://api.cloudinary.com/v1_1'
export const CLOUDINARY_FOLDER = 'sns-relay'
/** Cloudinary 무료 요금제의 이미지 한 장 한도 */
export const CLOUDINARY_MAX_BYTES = 10 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 60_000
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']
const NOT_PHOTO = (path: string) => `사진 파일(JPG·PNG·WebP·GIF·HEIC)만 올릴 수 있습니다: ${path}`

/** 앞 16바이트가 사진 형식(JPEG·PNG·GIF·WebP·HEIC/HEIF)인지 본다 */
function looksLikePhoto(head: Buffer): boolean {
  const at = (i: number, s: string) => head.subarray(i, i + s.length).toString('latin1') === s
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) return true
  if (head.length >= 4 && head[0] === 0x89 && at(1, 'PNG')) return true
  if (at(0, 'GIF8')) return true
  if (at(0, 'RIFF') && at(8, 'WEBP')) return true
  return at(4, 'ftyp')
}

async function assertPhotoFile(path: string): Promise<void> {
  if (!PHOTO_EXTENSIONS.includes(extname(path).toLowerCase())) throw new Error(NOT_PHOTO(path))
  const size = (await stat(path)).size
  if (size > CLOUDINARY_MAX_BYTES) {
    throw new Error(`사진이 10MB 를 넘습니다(${(size / 1024 / 1024).toFixed(1)}MB): ${path} — 크기를 줄여 다시 시도하세요.`)
  }
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(16)
    const { bytesRead } = await fh.read(head, 0, 16, 0)
    if (!looksLikePhoto(head.subarray(0, bytesRead))) throw new Error(NOT_PHOTO(path))
  } finally {
    await fh.close()
  }
}

/** 서명 — file·cloud_name·resource_type·api_key 를 뺀 매개변수를 이름순으로 잇고 secret 을 붙여 SHA-1 */
export function cloudinarySignature(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return createHash('sha1').update(base + secret).digest('hex')
}

/** 배달 주소 — 품질 85, 확장자 .jpg 로 원본 형식과 상관없이 JPEG 를 받는다(인스타 조건) */
export function jpegDeliveryUrl(cloud: string, version: string, publicId: string): string {
  return `https://res.cloudinary.com/${cloud}/image/upload/q_85/v${version}/${publicId}.jpg`
}

/** 로컬 사진이나 다른 곳의 이미지를 Cloudinary 에 서명 업로드하고 JPEG 공개 주소를 돌려준다. */
export async function uploadToCloudinary(
  env: Env,
  source: { file: string } | { url: string },
  publicId: string,
  now: () => Date = () => new Date(),
): Promise<{ url: string; width: number; height: number }> {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = requireEnv(env, [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ])
  const form = new FormData()
  if ('file' in source) {
    await assertPhotoFile(source.file)
    form.append('file', new Blob([await readFile(source.file)]), basename(source.file))
  } else {
    form.append('file', source.url)
  }
  const signed = { folder: CLOUDINARY_FOLDER, overwrite: 'false', public_id: publicId, timestamp: String(Math.floor(now().getTime() / 1000)) }
  for (const [k, v] of Object.entries(signed)) form.append(k, v)
  form.append('api_key', key)
  form.append('signature', cloudinarySignature(signed, secret))

  let res: Response
  try {
    res = await fetch(`${CLOUDINARY_API}/${cloud}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) })
  } catch (e) {
    throw new Error(scrubEnvValues(`Cloudinary 에 연결하지 못했습니다: ${(e as Error).message}`, env))
  }
  const body = (await res.json().catch(() => ({}))) as { public_id?: unknown; version?: unknown; width?: unknown; height?: unknown; error?: { message?: unknown } }
  if (!res.ok) {
    const msg = typeof body.error?.message === 'string' ? body.error.message : ''
    throw new Error(scrubEnvValues(`Cloudinary 업로드 실패(HTTP ${res.status}): ${msg}`, env))
  }
  if (typeof body.public_id !== 'string' || (typeof body.version !== 'number' && typeof body.version !== 'string')) {
    throw new Error('Cloudinary 응답에 사진 정보가 없습니다.')
  }
  return {
    url: jpegDeliveryUrl(cloud, String(body.version), body.public_id),
    width: typeof body.width === 'number' ? body.width : 0,
    height: typeof body.height === 'number' ? body.height : 0,
  }
}

/** 연결 점검(읽기 전용) — Admin API 사용량 조회 */
export async function cloudinaryUsage(env: Env): Promise<{ usage: number; limit: number }> {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = requireEnv(env, [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ])
  let res: Response
  try {
    res = await fetch(`${CLOUDINARY_API}/${cloud}/usage`, {
      headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new Error(scrubEnvValues(`Cloudinary 에 연결하지 못했습니다: ${(e as Error).message}`, env))
  }
  const body = (await res.json().catch(() => ({}))) as { credits?: { usage?: unknown; limit?: unknown }; error?: { message?: unknown } }
  if (!res.ok) {
    const reason = typeof body.error?.message === 'string' ? body.error.message : ''
    // cloud_name mismatch: cloud name 이 API key 의 계정과 다르다 — 가장 흔한 입력 실수라 따로 안내한다.
    const hint = /cloud_name mismatch/i.test(reason)
      ? 'CLOUDINARY_CLOUD_NAME 이 API key 의 계정과 다릅니다. 대시보드의 Cloud name 값을 다시 확인하세요.'
      : 'cloud name·API key·API secret 을 확인하세요.'
    throw new Error(scrubEnvValues(`Cloudinary 가 키를 받지 않았습니다(HTTP ${res.status}${reason ? `: ${reason}` : ''}). ${hint}`, env))
  }
  return {
    usage: typeof body.credits?.usage === 'number' ? body.credits.usage : 0,
    limit: typeof body.credits?.limit === 'number' ? body.credits.limit : 0,
  }
}
