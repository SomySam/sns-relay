import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../../src/core/config.js'
import { hashDraft, newDraft, parseDraft, serializeDraft } from '../../src/core/drafts.js'
import type { Article, ChannelDraft } from '../../src/core/types.js'
import { NOTES_ARTICLE, NOTES_ARTICLE_MULTI } from '../draft-helpers.js'

const ARTICLE: Article = {
  id: 'ai-task-brief',
  url: 'https://blog.example.com/blog/ai-task-brief',
  canonicalUrl: 'https://blog.example.com/blog/ai-task-brief',
  title: 'AI 업무 브리프 쓰는 법',
  text: '본문',
  image: 'https://blog.example.com/images/cover.jpg',
  links: {},
  fetchedAt: '2026-09-29T00:00:00.000Z',
}
const LINK = 'https://blog.example.com/blog/ai-task-brief?utm_source=naver&utm_medium=social&utm_campaign=ai-task-brief'

describe('newDraft', () => {
  it('네이버는 글 제목을 title 로, 링크는 현재 설정으로 만든다', () => {
    expect(newDraft(ARTICLE, 'naver', defaultConfig())).toEqual({
      channel: 'naver',
      approved: false,
      title: 'AI 업무 브리프 쓰는 법',
      tags: [],
      link: LINK,
      image: null,
      body: '',
    })
  })

  it('인스타그램은 대표 이미지를 쓰고 title 이 없다', () => {
    const d = newDraft(ARTICLE, 'instagram', defaultConfig())
    expect(d.image).toBe('https://blog.example.com/images/cover.jpg')
    expect('title' in d).toBe(false)
  })
})

describe('serializeDraft / parseDraft', () => {
  const draft: ChannelDraft = { ...newDraft(ARTICLE, 'naver', defaultConfig()), body: '## 소제목\n\n첫 문단' }

  it('설계 문서의 형식으로 쓴다', () => {
    expect(serializeDraft(draft)).toBe(
      `---\nchannel: naver\napproved: false\ntitle: AI 업무 브리프 쓰는 법\ntags: []\nlink: ${LINK}\nimage: null\n---\n\n## 소제목\n\n첫 문단\n`,
    )
  })

  it('쓴 것을 그대로 읽는다', () => {
    expect(parseDraft(serializeDraft(draft), 'naver')).toEqual(draft)
  })

  it('빈 본문도 왕복한다', () => {
    const empty = { ...draft, body: '' }
    expect(parseDraft(serializeDraft(empty), 'naver')).toEqual(empty)
  })

  it('CRLF 파일도 읽는다', () => {
    expect(parseDraft(serializeDraft(draft).replace(/\n/g, '\r\n'), 'naver')).toEqual(draft)
  })

  it('frontmatter 가 없으면 형식 오류', () => {
    expect(() => parseDraft('그냥 본문', 'naver')).toThrow('초안 형식 오류')
  })

  it('approved 가 참/거짓이 아니면 형식 오류', () => {
    const text = serializeDraft(draft).replace('approved: false', 'approved: "네"')
    expect(() => parseDraft(text, 'naver')).toThrow('초안 형식 오류')
  })

  it('파일 이름과 channel 이 다르면 형식 오류', () => {
    expect(() => parseDraft(serializeDraft(draft), 'threads')).toThrow('threads 초안인데 channel 이 naver')
  })
})

describe('hashDraft', () => {
  const draft: ChannelDraft = { ...newDraft(ARTICLE, 'threads', defaultConfig()), body: '본문' }

  it('approved 는 해시에 들어가지 않는다', () => {
    expect(hashDraft({ ...draft, approved: true })).toBe(hashDraft(draft))
  })

  it('본문·링크·이미지가 바뀌면 해시가 바뀐다', () => {
    const h = hashDraft(draft)
    expect(hashDraft({ ...draft, body: '본문!' })).not.toBe(h)
    expect(hashDraft({ ...draft, link: draft.link + 'x' })).not.toBe(h)
    expect(hashDraft({ ...draft, image: 'https://a.com/x.jpg' })).not.toBe(h)
  })

  it('16자 16진수', () => {
    expect(hashDraft(draft)).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('tags', () => {
  const base = { ...newDraft(ARTICLE, 'naver', defaultConfig()), body: '본문' }

  it('YAML 목록으로 쓰고 읽는다', () => {
    const d = { ...base, tags: ['AI업무자동화', '업무자동화'] }
    const text = serializeDraft(d)
    expect(text).toContain('tags:\n  - AI업무자동화\n  - 업무자동화\n')
    expect(parseDraft(text, 'naver')).toEqual(d)
  })

  it('태그가 없거나 비어 있으면 해시는 태그 도입 전과 같다(하위 호환)', () => {
    const legacy = (x: typeof base) =>
      createHash('sha256')
        .update(JSON.stringify([x.channel, x.title ?? null, x.link, x.image, x.body]))
        .digest('hex')
        .slice(0, 16)
    const { tags, ...noTags } = base
    expect(hashDraft(noTags)).toBe(legacy(base))
    expect(hashDraft({ ...base, tags: [] })).toBe(legacy(base))
  })

  it('태그가 바뀌면 해시가 바뀐다', () => {
    expect(hashDraft({ ...base, tags: ['가'] })).not.toBe(hashDraft({ ...base, tags: ['나'] }))
    expect(hashDraft({ ...base, tags: ['가'] })).not.toBe(hashDraft(base))
  })

  it('숫자 태그는 문자열로 바꿔 읽는다', () => {
    const text = serializeDraft(base).replace('tags: []', 'tags: [2026, AI주문서]')
    expect(parseDraft(text, 'naver').tags).toEqual(['2026', 'AI주문서'])
  })

  it('한 줄 목록 tags 를 읽는다', () => {
    const text = serializeDraft(base).replace('tags: []', 'tags: [가, 나]')
    expect(parseDraft(text, 'naver').tags).toEqual(['가', '나'])
  })

  it('tags 가 목록이 아니면 형식 오류', () => {
    const text = serializeDraft(base).replace('tags: []', 'tags: 문자열')
    expect(() => parseDraft(text, 'naver')).toThrow('초안 형식 오류')
  })
})

describe('링크 없는 작업(글감)', () => {
  it('모든 채널 link 가 빈 문자열이고, 네이버를 뺀 채널에 사진이 들어간다', () => {
    const config = defaultConfig()
    for (const ch of ['threads', 'instagram', 'facebook'] as const) {
      const d = newDraft(NOTES_ARTICLE, ch, config)
      expect(d.link).toBe('')
      expect(d.image).toBe(NOTES_ARTICLE.image)
    }
    const naver = newDraft(NOTES_ARTICLE, 'naver', config)
    expect(naver.link).toBe('')
    expect(naver.image).toBeNull()
  })

  it('빈 link 도 쓰고 읽는다', () => {
    const d = { ...newDraft(NOTES_ARTICLE, 'threads', defaultConfig()), body: '본문' }
    expect(parseDraft(serializeDraft(d), 'threads')).toEqual(d)
  })

  it('블로그 작업은 지금과 같다 — 스레드·페이스북에는 사진을 넣지 않는다', () => {
    const config = defaultConfig()
    expect(newDraft(ARTICLE, 'threads', config).image).toBeNull()
    expect(newDraft(ARTICLE, 'facebook', config).image).toBeNull()
    expect(newDraft(ARTICLE, 'instagram', config).image).toBe(ARTICLE.image)
    expect(newDraft(ARTICLE, 'threads', config).link).toContain('utm_source=threads')
  })
})

describe('사진 여러 장', () => {
  it('2장 이상이면 초안에 images 가 있고 첫 장이 image 다', () => {
    const d = newDraft(NOTES_ARTICLE_MULTI, 'threads', defaultConfig())
    expect(d.image).toBe(NOTES_ARTICLE_MULTI.images![0])
    expect(d.images).toEqual(NOTES_ARTICLE_MULTI.images)
  })
  it('한 장이면 images 를 쓰지 않는다(기존과 같은 파일)', () => {
    const d = newDraft(NOTES_ARTICLE, 'threads', defaultConfig())
    expect(d.images).toBeUndefined()
    expect(serializeDraft({ ...d, body: '가' })).not.toContain('images:')
  })
  it('해시는 한 장이면 예전 공식 그대로, 여러 장이면 목록을 넣는다', () => {
    const one = { ...newDraft(NOTES_ARTICLE, 'threads', defaultConfig()), body: '가' }
    const legacy = createHash('sha256').update(JSON.stringify([one.channel, one.title ?? null, one.link, one.image, one.body])).digest('hex').slice(0, 16)
    expect(hashDraft(one)).toBe(legacy)
    const multi = { ...newDraft(NOTES_ARTICLE_MULTI, 'threads', defaultConfig()), body: '가' }
    const reordered = { ...multi, images: [...multi.images!].reverse(), image: multi.images![2] }
    expect(hashDraft(multi)).not.toBe(hashDraft(reordered))
  })
  it('images 를 쓰고 읽는다', () => {
    const d = { ...newDraft(NOTES_ARTICLE_MULTI, 'instagram', defaultConfig()), body: '가' }
    expect(parseDraft(serializeDraft(d), 'instagram')).toEqual(d)
  })
  it('블로그 작업의 Threads 는 사진이 없다', () => {
    expect(newDraft(ARTICLE, 'threads', defaultConfig()).images).toBeUndefined()
  })
})
