import type { Env } from './env.js'

export const CHANNEL_IDS = ['threads', 'instagram', 'facebook', 'naver'] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]

/** work/<id>/article.json */
export interface Article {
  id: string
  /** 출처 — blog: 블로그 글 주소, notes: 오너가 준 글감·사진. 없으면 blog(예전 작업). */
  source?: 'blog' | 'notes'
  url: string
  canonicalUrl: string
  title: string
  text: string
  image: string | null
  /** 사진 목록(2장 이상일 때) — 첫 장이 image(대표) */
  images?: string[]
  /** 옮겨 올린 사진의 원래 주소 — 블로그를 다시 가져올 때 같은 대표 이미지면 옮긴 사진을 유지한다. */
  imageOrigin?: string
  /** 채널별 UTM 링크 — 코드가 만든다. AI 는 손대지 않는다. */
  links: Partial<Record<ChannelId, string>>
  fetchedAt: string
}

/** work/<id>/drafts/<channel>.md 한 개 */
export interface ChannelDraft {
  channel: ChannelId
  approved: boolean
  /** 네이버만 쓴다 — 붙여 넣을 글 제목 */
  title?: string
  /** 네이버만 — 발행 설정 창의 태그 */
  tags?: string[]
  /** 코드가 만든 UTM 링크 — AI 는 손대지 않는다 */
  link: string
  image: string | null
  /** 사진이 2장 이상일 때만 — images[0] 은 image 와 같다 */
  images?: string[]
  /** 이 텍스트가 그대로 게시된다 */
  body: string
}

export interface Problem {
  level: 'error' | 'warn'
  message: string
}

export type CellStatus = 'draft' | 'approved' | 'published' | 'unknown' | 'failed' | 'skipped' | 'manual'

/** work/state.json 의 한 칸 — 키는 `<id>:<channel>` */
export interface CellState {
  status: CellStatus
  /** 승인한 초안의 해시 */
  hash?: string
  postUrl?: string
  postId?: string
  reason?: string
  updatedAt: string
}

export interface Channel {
  id: ChannelId
  /** api: 공식 API 로 자동 게시, manual: 붙여 넣기용 결과물만 만들고 사람이 발행(네이버) */
  mode: 'api' | 'manual'
  /** 게시 전에 길이·이미지 규격 등을 검사한다. 오류가 하나라도 있으면 승인할 수 없다. */
  validate(draft: ChannelDraft, article: Article): Problem[]
  /** 자동 게시를 지원하는 채널만 구현한다. */
  publish?(draft: ChannelDraft, article: Article, ctx: PublishContext): Promise<PublishOutcome>
  /** 게시 요청 전에 네트워크로 확인할 것(예: 인스타 이미지 규격). 읽기만 한다. */
  precheck?(draft: ChannelDraft): Promise<Problem[]>
}

export interface PublishContext {
  env: Env
  sleep: (ms: number) => Promise<void>
  /** 게시 요청(되돌릴 수 없는 단계)을 보내기 직전에 부른다 — 칸을 unknown 으로 먼저 기록한다. 되돌릴 수 없는 요청을 보내는 채널은 그 직전에 반드시 부른다. */
  onBeforePublish: () => Promise<void>
  progress?: (message: string) => void
}

export type PublishOutcome =
  | { status: 'published'; postId: string; postUrl?: string; note?: string }
  | { status: 'failed'; reason: string }
  | { status: 'unknown'; reason: string }
