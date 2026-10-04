import { checkPostImage } from '../image-check.js'
import type { Channel, Problem } from '../types.js'
import { commonProblems } from './common.js'
import { FACEBOOK_MULTI_PHOTO, publishToFacebook } from './facebook-api.js'

export const facebook: Channel = {
  id: 'facebook',
  mode: 'api',
  validate(draft) {
    return commonProblems(draft.body)
  },
  publish: (draft, _article, ctx) => publishToFacebook(draft, ctx),
  precheck: async (draft) => {
    if (!draft.image || draft.link) return []
    const urls = draft.images ?? [draft.image]
    if (urls.length < 2) return checkPostImage(draft.image)
    const problems: Problem[] = [
      {
        level: 'warn',
        message: FACEBOOK_MULTI_PHOTO
          ? '페이스북 여러 장 게시는 이번이 첫 실측입니다 — 게시 뒤 사진이 붙었는지 확인하세요.'
          : '페이스북은 첫 장만 올라갑니다.',
      },
    ]
    for (const [i, url] of urls.entries()) {
      for (const p of await checkPostImage(url)) problems.push({ ...p, message: `${i + 1}번째 사진: ${p.message}` })
    }
    return problems
  },
}
