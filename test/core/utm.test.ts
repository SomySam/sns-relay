import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../../src/core/config.js'
import { buildLink, buildLinks } from '../../src/core/utm.js'

const utm = defaultConfig().utm

describe('buildLink', () => {
  it('설계 문서의 예시와 같은 링크를 만든다', () => {
    expect(buildLink('https://blog.example.com/blog/ai-task-brief', 'threads', utm, 'ai-task-brief')).toBe(
      'https://blog.example.com/blog/ai-task-brief?utm_source=threads&utm_medium=social&utm_campaign=ai-task-brief',
    )
  })

  it('기존 utm_* 와 #해시는 지우고 다른 쿼리는 남긴다', () => {
    expect(buildLink('https://x.com/a?ref=1&utm_source=old#top', 'facebook', utm, 'a')).toBe(
      'https://x.com/a?ref=1&utm_source=facebook&utm_medium=social&utm_campaign=a',
    )
  })

  it('config 의 채널별 source 이름을 따른다', () => {
    const custom = { ...utm, source: { ...utm.source, instagram: 'ig' } }
    expect(buildLink('https://x.com/a', 'instagram', custom, 'a')).toContain('utm_source=ig&')
  })
})

describe('buildLinks', () => {
  it('지정한 채널만 만든다', () => {
    const links = buildLinks('https://x.com/a', ['threads', 'naver'], utm, 'a')
    expect(Object.keys(links)).toEqual(['threads', 'naver'])
  })
})
