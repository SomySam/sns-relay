import { checkInstagramImage } from '../image-check.js'
import type { Channel, Problem } from '../types.js'
import { publishToInstagram } from './instagram-api.js'
import { commonProblems, countChars } from './common.js'

export const INSTAGRAM_MAX_CHARS = 2200
export const INSTAGRAM_MAX_HASHTAGS = 30
export const INSTAGRAM_MAX_MENTIONS = 20

const HASHTAG = /(?:^|\s)#[\p{L}\p{N}_]+/gu
const MENTION = /(?:^|\s)@[\p{L}\p{N}_.]+/gu

export const instagram: Channel = {
  id: 'instagram',
  mode: 'api',
  validate(draft) {
    const problems = commonProblems(draft.body)
    const n = countChars(draft.body)
    if (n > INSTAGRAM_MAX_CHARS) {
      problems.push({ level: 'error', message: `${n}자입니다. 인스타그램 캡션은 ${INSTAGRAM_MAX_CHARS}자까지입니다.` })
    }
    const tags = draft.body.match(HASHTAG)?.length ?? 0
    if (tags > INSTAGRAM_MAX_HASHTAGS) {
      problems.push({ level: 'error', message: `해시태그가 ${tags}개입니다. ${INSTAGRAM_MAX_HASHTAGS}개까지입니다.` })
    }
    const mentions = draft.body.match(MENTION)?.length ?? 0
    if (mentions > INSTAGRAM_MAX_MENTIONS) {
      problems.push({ level: 'error', message: `@언급이 ${mentions}개입니다. ${INSTAGRAM_MAX_MENTIONS}개까지입니다.` })
    }
    if (!draft.image) {
      problems.push({ level: 'error', message: '인스타그램은 이미지가 필요합니다. 초안의 image 에 공개 이미지 주소가 있어야 합니다.' })
    }
    return problems
  },
  publish: (draft, _article, ctx) => publishToInstagram(draft, ctx),
  precheck: async (draft) => {
    const urls = draft.images ?? [draft.image]
    if (urls.length < 2) return (await checkInstagramImage(draft.image)).problems
    const problems: Problem[] = []
    let firstRatio: number | undefined
    for (const [i, url] of urls.entries()) {
      const r = await checkInstagramImage(url)
      for (const p of r.problems) problems.push({ ...p, message: `${i + 1}번째 사진: ${p.message}` })
      if (r.width && r.height) {
        const ratio = r.width / r.height
        if (i === 0) firstRatio = ratio
        else if (firstRatio !== undefined && Math.abs(ratio - firstRatio) >= 0.1) {
          problems.push({ level: 'warn', message: `${i + 1}번째 사진은 첫 장 비율로 잘립니다.` })
        }
      }
    }
    return problems
  },
}
