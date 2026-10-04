import { readFileSync, writeFileSync } from 'node:fs'
import { initWorkspace, loadConfig } from '../src/core/config.js'
import { draftPath, ensureDraftFiles } from '../src/core/draft-files.js'
import { parseDraft, serializeDraft } from '../src/core/drafts.js'
import type { Article, ChannelId } from '../src/core/types.js'
import { saveArticle } from '../src/core/workspace.js'

export const ARTICLE: Article = {
  id: 'ai-task-brief',
  url: 'https://blog.example.com/blog/ai-task-brief',
  canonicalUrl: 'https://blog.example.com/blog/ai-task-brief',
  title: 'AI 업무 브리프 쓰는 법',
  text: 'AI 에게 일을 맡길 때 가장 흔한 실패는 요청에서 시작된다.',
  image: 'https://blog.example.com/images/cover.jpg',
  links: {},
  fetchedAt: '2026-09-29T00:00:00.000Z',
}

/** 글감으로 만든 작업 — 원문 주소가 없다 */
export const NOTES_ARTICLE: Article = {
  id: 'cafe-notes',
  source: 'notes',
  url: '',
  canonicalUrl: '',
  title: '동네 카페 창가 자리',
  text: '오후 세 시 창가 자리에 앉으면 햇빛이 책상 위로 길게 든다.',
  image: 'https://res.cloudinary.com/demo/image/upload/q_85/v1/sns-relay/cafe-notes-1.jpg',
  links: {},
  fetchedAt: '2026-10-01T00:00:00.000Z',
}

const PHOTO = (n: number) => `https://res.cloudinary.com/demo/image/upload/q_85/v1/sns-relay/cafe-notes-${n}.jpg`

/** 글감으로 만든 작업 — 사진 세 장(첫 장이 대표) */
export const NOTES_ARTICLE_MULTI: Article = {
  ...NOTES_ARTICLE,
  image: PHOTO(1),
  images: [PHOTO(1), PHOTO(2), PHOTO(3)],
}

/** 모든 채널 검증을 오류 없이 통과하는 본문 (네이버는 짧아서 경고만) */
export const VALID_BODIES: Record<ChannelId, string> = {
  threads: 'AI 에게 일을 맡겼는데 엉뚱한 답이 온 적 있나요?\n\n- 목적\n- 맥락\n- 형식\n\n전체 과정은 블로그에 정리했어요.',
  instagram:
    'AI 에게 일을 맡기기 전에 주문서 한 장.\n\n목적·맥락·형식만 적어도 첫 답이 달라집니다.\n\n전체 과정은 프로필 링크에서 볼 수 있어요.\n\n#AI활용 #업무자동화 #프롬프트',
  facebook:
    '석 달 동안 AI 에게 일을 맡기며 기록해 보니, 실패는 요청에서 시작됐습니다. 목적·맥락·형식을 적은 브리프 한 장이 재요청을 줄였습니다. 전체 과정은 블로그에 정리했습니다.',
  naver:
    '## 왜 브리프가 필요한가\n\nAI 에게 일을 맡길 때 가장 흔한 실패는 요청에서 시작됩니다.\n\n## 세 가지 요소\n\n목적, 맥락, 형식입니다.\n\n원문에서 템플릿과 전체 과정을 볼 수 있어요.',
}

export async function setupDrafts(root: string, article: Article = ARTICLE): Promise<void> {
  await initWorkspace(root)
  await saveArticle(root, article)
  await ensureDraftFiles(root, article, await loadConfig(root))
}

export const VALID_TAGS = ['AI업무자동화', '업무자동화', 'AI활용법', '프롬프트작성법', 'AI주문서']

/** 네이버 초안의 tags 만 바꾼다. */
export function writeTags(root: string, id: string, tags: string[]): void {
  const path = draftPath(root, id, 'naver')
  const draft = parseDraft(readFileSync(path, 'utf8'), 'naver')
  writeFileSync(path, serializeDraft({ ...draft, tags }))
}

/** 사람이 편집기로 본문을 고친 것처럼 본문만 바꾼다 (frontmatter 는 그대로). */
export function writeBody(root: string, id: string, channel: ChannelId, body: string): void {
  const path = draftPath(root, id, channel)
  const draft = parseDraft(readFileSync(path, 'utf8'), channel)
  writeFileSync(path, serializeDraft({ ...draft, body }))
}
