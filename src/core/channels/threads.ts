import { checkPostImage } from '../image-check.js'
import type { Channel, Problem } from '../types.js'
import { commonProblems, countChars } from './common.js'
import { publishToThreads } from './threads-api.js'

export const THREADS_MAX_CHARS = 500

export const threads: Channel = {
  id: 'threads',
  mode: 'api',
  validate(draft) {
    const problems = commonProblems(draft.body)
    const n = countChars(draft.body)
    if (n > THREADS_MAX_CHARS) {
      problems.push({ level: 'error', message: `${n}자입니다. Threads 는 ${THREADS_MAX_CHARS}자까지입니다.` })
    }
    return problems
  },
  publish: (draft, _article, ctx) => publishToThreads(draft, ctx),
  precheck: async (draft) => {
    if (!draft.image || draft.link) return []
    const urls = draft.images ?? [draft.image]
    if (urls.length < 2) return checkPostImage(draft.image)
    const problems: Problem[] = []
    for (const [i, url] of urls.entries()) {
      for (const p of await checkPostImage(url)) problems.push({ ...p, message: `${i + 1}번째 사진: ${p.message}` })
    }
    return problems
  },
}
