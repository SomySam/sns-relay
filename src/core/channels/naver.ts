import type { Channel } from '../types.js'
import { commonProblems, countChars } from './common.js'

export const NAVER_MIN_RECOMMENDED_CHARS = 1500
export const NAVER_MAX_TAGS = 30
export const NAVER_RECOMMENDED_TAGS = [5, 10] as const

export const naver: Channel = {
  id: 'naver',
  mode: 'manual',
  validate(draft, article) {
    const problems = commonProblems(draft.body)
    if (!draft.title?.trim()) {
      problems.push({ level: 'error', message: '네이버 초안은 제목(title)이 필요합니다.' })
    }
    const n = countChars(draft.body.trim())
    // 글감 작업은 규칙상 짧아도 되므로 검색 유입용 분량 경고를 내지 않는다.
    if (article.source !== 'notes' && n > 0 && n < NAVER_MIN_RECOMMENDED_CHARS) {
      problems.push({
        level: 'warn',
        message: `본문이 ${n}자입니다. 검색 유입용으로 ${NAVER_MIN_RECOMMENDED_CHARS.toLocaleString('ko-KR')}자 이상을 권합니다.`,
      })
    }
    const tags = draft.tags ?? []
    if (tags.length === 0) {
      problems.push({ level: 'warn', message: '태그가 없습니다. frontmatter 의 tags 에 검색어 중심 5~10개를 권합니다.' })
    }
    if (tags.length > NAVER_MAX_TAGS) {
      problems.push({ level: 'error', message: `태그가 ${tags.length}개입니다. 네이버는 ${NAVER_MAX_TAGS}개까지입니다.` })
    } else if (tags.length > 0 && (tags.length < NAVER_RECOMMENDED_TAGS[0] || tags.length > NAVER_RECOMMENDED_TAGS[1])) {
      problems.push({ level: 'warn', message: `태그가 ${tags.length}개입니다. ${NAVER_RECOMMENDED_TAGS[0]}~${NAVER_RECOMMENDED_TAGS[1]}개를 권합니다.` })
    }
    const bad = tags.filter((t) => t.trim() === '' || t.includes('#') || t.includes(','))
    if (bad.length > 0) {
      problems.push({ level: 'error', message: `형식이 틀린 태그가 있습니다: ${bad.map((t) => `"${t}"`).join(', ')} — # 과 쉼표 없이 한 단어씩 쓰세요.` })
    }
    const trimmed = tags.map((t) => t.trim())
    const dup = [...new Set(trimmed.filter((t, i) => t !== '' && trimmed.indexOf(t) !== i))]
    if (dup.length > 0) {
      problems.push({ level: 'warn', message: `중복된 태그가 있습니다: ${dup.join(', ')}` })
    }
    if (tags.some((t) => t !== t.trim())) {
      problems.push({ level: 'warn', message: '앞뒤 공백이 있는 태그가 있습니다 — 복사할 때 공백을 뗍니다.' })
    }
    const spaced = tags.filter((t) => t.trim() !== '' && /\s/.test(t.trim()))
    if (spaced.length > 0) {
      problems.push({ level: 'warn', message: `띄어쓰기가 있는 태그가 있습니다: ${spaced.join(', ')} — 붙여 쓰기를 권합니다.` })
    }
    return problems
  },
}
