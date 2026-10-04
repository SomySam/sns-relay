import { describe, expect, it } from 'vitest'
import { countChars, getChannel, hasErrors, parseChannelList } from '../../src/core/channels/index.js'
import type { Article, ChannelDraft, ChannelId } from '../../src/core/types.js'

const ARTICLE: Article = {
  id: 'post',
  url: 'https://a.com/post',
  canonicalUrl: 'https://a.com/post',
  title: '제목',
  text: '본문',
  image: 'https://a.com/cover.jpg',
  links: {},
  fetchedAt: '2026-09-29T00:00:00.000Z',
}

function draft(channel: ChannelId, over: Partial<ChannelDraft> = {}): ChannelDraft {
  return { channel, approved: false, link: 'https://a.com/post?utm_source=x', image: null, body: '짧은 본문', ...over }
}

const messages = (channel: ChannelId, d: ChannelDraft) =>
  getChannel(channel).validate(d, ARTICLE).map((p) => `${p.level}:${p.message}`)

describe('공통 검사', () => {
  it.each(['threads', 'instagram', 'facebook', 'naver'] as const)('%s: 빈 본문은 오류', (ch) => {
    const d = draft(ch, { body: '  \n', title: '제목', image: 'https://a.com/c.jpg' })
    expect(messages(ch, d)).toContain('error:본문이 비어 있습니다.')
  })

  it.each(['https://x.com', 'http://x.com', 'www.x.com'])('본문에 주소(%s)가 있으면 오류', (url) => {
    expect(messages('facebook', draft('facebook', { body: `자세히는 ${url} 에서` })).join()).toContain('주소(URL)')
  })
})

describe('Threads', () => {
  it('500자는 통과, 501자는 오류', () => {
    expect(hasErrors(getChannel('threads').validate(draft('threads', { body: '가'.repeat(500) }), ARTICLE))).toBe(false)
    expect(messages('threads', draft('threads', { body: '가'.repeat(501) })).join()).toContain('501자')
  })

  it('글자 수는 코드 포인트로 센다', () => {
    expect(countChars('😀가')).toBe(2)
  })
})

describe('Instagram', () => {
  const ok = { image: 'https://a.com/c.jpg' }

  it('이미지가 없으면 오류', () => {
    expect(messages('instagram', draft('instagram')).join()).toContain('이미지가 필요합니다')
  })

  it('해시태그 30개는 통과, 31개는 오류', () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `#태그${i}`).join(' ')
    expect(hasErrors(getChannel('instagram').validate(draft('instagram', { ...ok, body: `요약\n${tags(30)}` }), ARTICLE))).toBe(false)
    expect(messages('instagram', draft('instagram', { ...ok, body: `요약\n${tags(31)}` })).join()).toContain('해시태그가 31개')
  })

  it('@언급 21개는 오류', () => {
    const mentions = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(' ')
    expect(messages('instagram', draft('instagram', { ...ok, body: mentions })).join()).toContain('@언급이 21개')
  })

  it('2,201자는 오류', () => {
    expect(messages('instagram', draft('instagram', { ...ok, body: '가'.repeat(2201) })).join()).toContain('2201자')
  })
})

describe('네이버', () => {
  it('제목이 없으면 오류', () => {
    expect(messages('naver', draft('naver', { title: ' ' })).join()).toContain('제목(title)')
  })

  it('짧은 본문은 경고일 뿐 오류가 아니다', () => {
    const problems = getChannel('naver').validate(draft('naver', { title: '제목', body: '짧다' }), ARTICLE)
    expect(hasErrors(problems)).toBe(false)
    expect(problems.map((p) => p.level)).toEqual(['warn', 'warn'])
  })

  const naverDraft = (tags?: string[]) => draft('naver', { title: '제목', body: '가'.repeat(1600), tags })

  it('태그가 없으면 경고', () => {
    expect(messages('naver', naverDraft()).join()).toContain('warn:태그가 없습니다')
  })

  it('5~10개면 태그 관련 문제가 없다', () => {
    const tags = ['하나', '둘', '셋', '넷', '다섯']
    expect(getChannel('naver').validate(naverDraft(tags), ARTICLE)).toEqual([])
  })

  it('30개 초과는 오류, 11개는 경고', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `태그${i}`)
    expect(hasErrors(getChannel('naver').validate(naverDraft(many(31)), ARTICLE))).toBe(true)
    const eleven = getChannel('naver').validate(naverDraft(many(11)), ARTICLE)
    expect(hasErrors(eleven)).toBe(false)
    expect(eleven.map((p) => p.level)).toEqual(['warn'])
  })

  it.each([['#AI'], ['AI,자동화'], ['  ']])('형식이 틀린 태그 %s 는 오류', (bad) => {
    expect(hasErrors(getChannel('naver').validate(naverDraft(['하나', '둘', '셋', '넷', bad]), ARTICLE))).toBe(true)
  })

  it('중복 태그는 경고', () => {
    const p = getChannel('naver').validate(naverDraft(['하나', '둘', '셋', '넷', '하나 ']), ARTICLE)
    expect(p.map((x) => x.message)).toContain('중복된 태그가 있습니다: 하나')
  })

  it('앞뒤 공백이 있는 태그는 경고', () => {
    const p = getChannel('naver').validate(naverDraft(['하나 ', '둘', '셋', '넷', '다섯']), ARTICLE)
    expect(p).toEqual([{ level: 'warn', message: '앞뒤 공백이 있는 태그가 있습니다 — 복사할 때 공백을 뗍니다.' }])
  })

  it('띄어쓰기가 있는 태그는 경고', () => {
    const p = getChannel('naver').validate(naverDraft(['업무 자동화', '둘', '셋', '넷', '다섯']), ARTICLE)
    expect(p.map((x) => x.level)).toEqual(['warn'])
  })
})

describe('parseChannelList', () => {
  it('쉼표로 나눈 채널을 읽는다', () => {
    expect(parseChannelList('threads, naver')).toEqual(['threads', 'naver'])
  })

  it('모르는 채널은 거부한다', () => {
    expect(() => parseChannelList('threads,tiktok')).toThrow('모르는 채널: tiktok')
  })
})

describe('mode', () => {
  it('네이버만 수동, 나머지는 API', () => {
    expect(['threads', 'instagram', 'facebook', 'naver'].map((c) => getChannel(c as ChannelId).mode)).toEqual([
      'api',
      'api',
      'api',
      'manual',
    ])
  })
})

describe('네이버 짧은 본문 경고', () => {
  const d = draft('naver', { title: '제목', tags: ['가나', '다라', '마바', '사아', '자차'] })
  it('글감 작업에는 1,500자 경고가 없다', () => {
    const out = getChannel('naver').validate(d, { ...ARTICLE, source: 'notes', canonicalUrl: '' }).map((p) => p.message)
    expect(out.some((m) => m.includes('1,500자'))).toBe(false)
  })
  it('블로그 작업에는 경고가 있다', () => {
    expect(messages('naver', d).some((m) => m.includes('1,500자'))).toBe(true)
  })
})
