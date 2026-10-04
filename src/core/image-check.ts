import type { Problem } from './types.js'

export const IG_MAX_BYTES = 8 * 1024 * 1024
export const IG_MIN_RATIO = 0.8
export const IG_MAX_RATIO = 1.91
export const IG_MIN_WIDTH = 320
export const IG_MAX_WIDTH = 1440
const TIMEOUT_MS = 30_000

/** JPEG 의 SOF 마커에서 가로·세로를 읽는다. JPEG 가 아니거나 찾지 못하면 null. */
export function readJpegSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += marker === 0xff ? 1 : 2
      continue
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const height = (buf[i + 5] << 8) | buf[i + 6]
      const width = (buf[i + 7] << 8) | buf[i + 8]
      return width === 0 || height === 0 ? null : { height, width }
    }
    const length = (buf[i + 2] << 8) | buf[i + 3]
    if (length < 2) return null
    i += 2 + length
  }
  return null
}

export interface ImageCheck {
  problems: Problem[]
  width?: number
  height?: number
  bytes?: number
}

const error = (message: string): ImageCheck => ({ problems: [{ level: 'error', message }] })

type Fetched = { bytes: Uint8Array } | { problem: Problem }
const fail = (message: string): Fetched => ({ problem: { level: 'error', message } })

/** 이미지를 받아 8MB 이하인지까지 확인한다(형식은 보지 않는다). */
async function fetchImageBytes(url: string): Promise<Fetched> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    return fail(`이미지를 가져오지 못했습니다(${(e as Error).message}).`)
  }
  if (!res.ok) return fail(`이미지를 가져오지 못했습니다(HTTP ${res.status}).`)
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > IG_MAX_BYTES) {
    await res.body?.cancel()
    return fail(`이미지가 8MB 를 넘습니다(${(declared / 1024 / 1024).toFixed(1)}MB).`)
  }
  let buf: Uint8Array
  try {
    buf = new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    return fail(`이미지를 끝까지 받지 못했습니다(${(e as Error).message}).`)
  }
  if (buf.length > IG_MAX_BYTES) return fail(`이미지가 8MB 를 넘습니다(${(buf.length / 1024 / 1024).toFixed(1)}MB).`)
  return { bytes: buf }
}

/** 인스타그램 게시 전에 이미지를 실제로 받아 조건(JPEG·비율·용량)을 확인한다. */
export async function checkInstagramImage(url: string | null): Promise<ImageCheck> {
  if (!url) return error('인스타그램은 이미지가 필요합니다.')
  const got = await fetchImageBytes(url)
  if ('problem' in got) return { problems: [got.problem] }
  const buf = got.bytes
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) {
    return { ...error('JPEG 가 아닙니다. 인스타그램 API 는 JPEG 만 받습니다.'), bytes: buf.length }
  }
  const size = readJpegSize(buf)
  if (!size) return { ...error('JPEG 크기를 읽지 못했습니다.'), bytes: buf.length }

  const problems: Problem[] = []
  const ratio = size.width / size.height
  if (ratio < IG_MIN_RATIO || ratio > IG_MAX_RATIO) {
    problems.push({ level: 'error', message: `가로:세로 비율 ${ratio.toFixed(2)} 는 인스타그램 허용 범위(0.8~1.91) 밖입니다.` })
  }
  if (size.width < IG_MIN_WIDTH || size.width > IG_MAX_WIDTH) {
    problems.push({ level: 'warn', message: `가로 ${size.width}px — 인스타그램이 320~1440px 로 크기를 조정합니다.` })
  }
  return { problems, width: size.width, height: size.height, bytes: buf.length }
}

/** Threads·페이스북 이미지 글용 — 가져올 수 있는지, JPEG/PNG 인지, 8MB 이하인지만 본다(비율 조건 없음). */
export async function checkPostImage(url: string): Promise<Problem[]> {
  const got = await fetchImageBytes(url)
  if ('problem' in got) return [got.problem]
  const b = got.bytes
  const isJpeg = b[0] === 0xff && b[1] === 0xd8
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  if (!isJpeg && !isPng) {
    return [{ level: 'error', message: `JPEG·PNG 이미지만 올릴 수 있습니다: ${url} — Cloudinary 를 쓰면 JPEG 로 바꿔 올립니다(sns-relay image).` }]
  }
  return []
}
