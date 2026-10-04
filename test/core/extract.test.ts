import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractArticle, htmlToText } from '../../src/core/extract.js'

const html = readFileSync(new URL('../fixtures/article.html', import.meta.url), 'utf8')
const PAGE = 'https://blog.example.com/blog/ai-task-brief?utm_source=x#top'
const PAGE_CLEAN = 'https://blog.example.com/blog/ai-task-brief'

describe('extractArticle', () => {
  const page = extractArticle(html, PAGE)

  it('og:title 을 제목으로 쓴다', () => {
    expect(page.title).toBe('AI 업무 브리프 쓰는 법')
  })

  it('canonical 주소와 절대경로 대표 이미지를 찾는다', () => {
    expect(page.canonicalUrl).toBe('https://blog.example.com/blog/ai-task-brief')
    expect(page.image).toBe('https://blog.example.com/images/cover.jpg')
  })

  it('본문의 소제목·목록을 살리고 머리말·꼬리말은 뺀다', () => {
    expect(page.text).toContain('## 왜 브리프가 필요한가')
    expect(page.text).toContain('- 목적: 이 결과물로 무엇을 결정하려는가')
    expect(page.text).toContain('석 달 동안 기록으로 확인했다.')
    expect(page.text).not.toContain('로그인')
    expect(page.text).not.toContain('모든 권리 보유')
  })

  it('canonical 이 없으면 페이지 주소, og:image 가 없으면 null', () => {
    const bare = html
      .replace(/<link rel="canonical"[^>]*>/, '')
      .replace(/<meta property="og:image"[^>]*>/, '')
    const p = extractArticle(bare, PAGE)
    expect(p.canonicalUrl).toBe(PAGE_CLEAN)
    expect(p.image).toBeNull()
  })

  it('canonical 이 사이트 대문이면 페이지 주소(쿼리·해시 제외)를 쓴다', () => {
    const site = html.replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="https://blog.example.com/">')
    expect(extractArticle(site, PAGE).canonicalUrl).toBe(PAGE_CLEAN)
  })

  it('canonical 이 http(s) 가 아니면 페이지 주소를 쓴다', () => {
    const ftp = html.replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="ftp://blog.example.com/blog/x">')
    expect(extractArticle(ftp, PAGE).canonicalUrl).toBe(PAGE_CLEAN)
  })

  it('본문이 없으면 알려 준다', () => {
    expect(() => extractArticle('<html><body></body></html>', PAGE)).toThrow('본문을 찾지 못했습니다')
  })
})

describe('htmlToText', () => {
  it('문단·소제목·목록을 줄 단위 텍스트로 바꾼다', () => {
    expect(htmlToText('<p>가&nbsp;나</p><h2>제목</h2><ul><li>하나</li><li>둘</li></ul>')).toBe(
      '가 나\n\n## 제목\n\n- 하나\n- 둘',
    )
  })
  it('CRLF 줄바꿈 페이지도 pre 블록 안에 \\r 을 남기지 않는다', () => {
    expect(htmlToText('<p>앞</p>\r\n<pre>첫 줄\r\n  둘째 줄\r\n</pre>')).toBe('앞\n\n```\n첫 줄\n  둘째 줄\n```')
  })
  it('표는 행마다 한 줄, 칸은 " | " 로 구분한다', () => {
    const html =
      '<p>앞</p><table><thead><tr><th>칸</th><th>묻는 것</th></tr></thead>' +
      '<tbody><tr><td>목적</td><td>무엇을 결정하나</td></tr></tbody></table><p>뒤</p>'
    expect(htmlToText(html)).toBe('앞\n\n칸 | 묻는 것\n목적 | 무엇을 결정하나\n\n뒤')
  })

  it('pre 블록은 줄과 들여쓰기를 살려 ``` 로 감싼다', () => {
    const html = '<p>예시:</p><pre><code>역할: 편집자\n  - 목적: &lt;결정&gt;\n\n끝</code></pre><p>다음</p>'
    expect(htmlToText(html)).toBe('예시:\n\n```\n역할: 편집자\n  - 목적: <결정>\n\n끝\n```\n\n다음')
  })

  it('<link> 같은 li 로 시작하는 태그를 목록으로 보지 않는다', () => {
    expect(htmlToText('<p>a<link rel="x">b</p>')).toBe('ab')
  })
})

describe('실제 글: 표와 코드가 있는 블로그 글', () => {
  const real = readFileSync(new URL('../fixtures/blog-tables-code.html', import.meta.url), 'utf8')
  const { text } = extractArticle(real, 'https://blog.example.com/blog/ai-task-brief')

  it('표 머리 행이 " | " 로 구분된 한 줄이다', () => {
    expect(text).toContain('칸 | 묻는 것 | 도윤 씨의 답')
    expect(text).toContain('입력 | 내가 뭘 주면 | 주제 한 줄')
  })

  it('표 칸이 붙지 않는다', () => {
    expect(text).not.toContain('칸묻는 것')
    expect(text).not.toContain('증상원인')
  })

  it('pre 블록은 ``` 로 감싸고 여러 줄 구조를 유지한다', () => {
    expect(text).toContain('```\n입력    : 내가 무엇을 주면\n결과    : 무엇을 받고 싶은가')
    expect(text).toContain('한 번에 질문 하나씩, 세 칸을 차례로 물어봐 주세요.')
    expect(text).toMatch(/이 일을 "입력 → 결과 → 기준" 세 칸으로 정리하고 싶습니다\.\n\n한 번에/)
  })
})
