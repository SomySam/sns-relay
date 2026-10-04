const MAX_LENGTH = 60
const VALID_ID = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,59}$/u

export function articleIdFromUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`올바른 주소가 아닙니다: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`http(s) 주소만 쓸 수 있습니다: ${input}`)
  }

  const last = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
  const fromPath = slugify(safeDecode(last).replace(/\.(html?|php|aspx?)$/i, ''))
  return assertValidId(fromPath || slugify(url.hostname.replace(/^www\./, '')))
}

/** 글감 작업의 이름 — 제목을 슬러그로. 제목에 글자·숫자가 없으면 notes */
export function articleIdFromTitle(title: string): string {
  return assertValidId(slugify(title) || 'notes')
}

export function assertValidId(id: string): string {
  if (!VALID_ID.test(id)) {
    throw new Error(`작업 이름은 글자·숫자로 시작하고 글자·숫자·하이픈만 60자까지 쓸 수 있습니다: "${id}"`)
  }
  return id
}

function slugify(s: string): string {
  const cleaned = s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+/, '')
  // UTF-16 단위로 자르면 대리쌍이 깨지므로 코드포인트 단위로 자른다.
  return Array.from(cleaned).slice(0, MAX_LENGTH).join('').replace(/-+$/, '')
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
