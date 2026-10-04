import { VERSION } from './version.js'

const USER_AGENT = `sns-relay/${VERSION} (+https://github.com/SomySam/sns-relay)`
const TIMEOUT_MS = 20_000

export async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`페이지를 가져오지 못했습니다 (HTTP ${res.status}): ${url}`)
  }
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('html')) {
    throw new Error(`HTML 페이지가 아닙니다 (${type || '형식 불명'}): ${url}`)
  }
  return { html: await res.text(), finalUrl: res.url || url }
}
