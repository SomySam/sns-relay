import { describe, expect, it } from 'vitest'
import { articleIdFromUrl, assertValidId } from '../../src/core/article-id.js'

describe('articleIdFromUrl', () => {
  it.each([
    ['https://blog.example.com/blog/ai-task-brief', 'ai-task-brief'],
    ['https://blog.example.com/blog/ai-task-brief/?utm_source=x#top', 'ai-task-brief'],
    ['https://example.com/posts/My_Post.html', 'my-post'],
    ['https://blog.example.com/%EC%9E%90%EB%8F%99%ED%99%94-%EC%9D%BC%EC%A7%80', '자동화-일지'],
    ['https://www.example.com/', 'example-com'],
  ])('%s → %s', (url, id) => {
    expect(articleIdFromUrl(url)).toBe(id)
  })

  it('60자를 넘으면 자르고 끝의 하이픈을 없앤다', () => {
    const id = articleIdFromUrl(`https://a.com/${'ab-'.repeat(30)}`)
    expect(id.length).toBeLessThanOrEqual(60)
    expect(id.endsWith('-')).toBe(false)
  })

  it('60 코드포인트 경계에서 대리쌍을 자르지 않는다', () => {
    const id = articleIdFromUrl(`https://a.com/${'a'.repeat(59)}${String.fromCodePoint(0x20000)}bcd`)
    expect(() => assertValidId(id)).not.toThrow()
    expect(Array.from(id).length).toBeLessThanOrEqual(60)
  })

  it('http(s) 가 아니면 거부한다', () => {
    expect(() => articleIdFromUrl('ftp://a.com/x')).toThrow('http')
    expect(() => articleIdFromUrl('그냥 글자')).toThrow('주소')
  })
})

describe('assertValidId', () => {
  it('영문·숫자·한글·하이픈만 허용한다', () => {
    expect(assertValidId('my-post-2')).toBe('my-post-2')
    expect(assertValidId('자동화-일지')).toBe('자동화-일지')
    expect(() => assertValidId('../etc')).toThrow('작업 이름')
    expect(() => assertValidId('-x')).toThrow('작업 이름')
    expect(() => assertValidId('')).toThrow('작업 이름')
  })
})
