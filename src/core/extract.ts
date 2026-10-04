import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

export interface ExtractedPage {
  title: string
  text: string
  image: string | null
  canonicalUrl: string
}

export function extractArticle(html: string, pageUrl: string): ExtractedPage {
  const { document } = parseHTML(html)
  const meta = (selector: string): string | null =>
    document.querySelector(selector)?.getAttribute('content')?.trim() || null

  // Readability 가 document 를 고치므로 메타 정보는 먼저 읽는다.
  const canonicalHref =
    document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? meta('meta[property="og:url"]')
  const canonicalUrl = pickCanonical(canonicalHref, pageUrl)
  const image = absolute(meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]'), pageUrl)
  const ogTitle = meta('meta[property="og:title"]')
  const docTitle = document.title

  const parsed = new Readability(document as unknown as Document, { charThreshold: 100 }).parse()
  const text = parsed?.content ? htmlToText(parsed.content) : ''
  if (!text) {
    throw new Error('본문을 찾지 못했습니다. 글 페이지 주소가 맞는지 확인하세요.')
  }
  const title = (ogTitle || parsed?.title || docTitle || '').trim()
  return { title, text, image, canonicalUrl }
}

export function htmlToText(html: string): string {
  // CRLF·CR 로 내려오는 페이지도 있으므로 줄바꿈을 먼저 \n 으로 통일한다(pre 안에 \r 이 남지 않게).
  const normalized = html.replace(/\r\n?/g, '\n')
  // <pre> 는 줄 구조를 지켜야 하므로 먼저 꺼내 자리표시자로 바꾸고, 마지막에 ``` 블록으로 되돌린다.
  const codeBlocks: string[] = []
  const withoutPre = normalized.replace(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => {
    codeBlocks.push(tagsToText(inner.replace(/<br\s*\/?>/gi, '\n')).replace(/^\n+|\n+$/g, ''))
    return `\n\n\u0000PRE${codeBlocks.length - 1}\u0000\n\n`
  })

  const marked = withoutPre
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n## ')
    .replace(/<li(\s[^>]*)?>/gi, '\n- ')
    .replace(/<\/(td|th)>\s*(?=<t[dh][\s>])/gi, ' | ')
    .replace(/<\/tr>\s*/gi, '\n')
    .replace(/<\/?table[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|section|article|figure)>/gi, '\n\n')
  const text = tagsToText(marked)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.replace(/\u0000PRE(\d+)\u0000/g, (_m, i: string) => '```\n' + codeBlocks[Number(i)] + '\n```')
}

// 태그를 벗기고 HTML 엔티티를 푼 텍스트를 돌려준다.
function tagsToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  return document.body.textContent ?? ''
}

// canonical 이 http(s) 가 아니거나, 깊은 페이지인데 사이트 대문을 가리키면(모든 글이 같은 canonical 을 다는 사이트)
// 믿지 않고 페이지 주소(쿼리·해시 제외)를 쓴다.
function pickCanonical(href: string | null | undefined, pageUrl: string): string {
  const fallback = new URL(pageUrl)
  fallback.search = ''
  fallback.hash = ''
  const candidate = absolute(href, pageUrl)
  if (candidate) {
    const c = new URL(candidate)
    const isSiteRoot = c.pathname === '/' || c.pathname === ''
    const pageIsDeep = fallback.pathname !== '/' && fallback.pathname !== ''
    if ((c.protocol === 'http:' || c.protocol === 'https:') && !(isSiteRoot && pageIsDeep)) return candidate
  }
  return fallback.toString()
}

function absolute(href: string | null | undefined, base: string): string | null {
  if (!href) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}
