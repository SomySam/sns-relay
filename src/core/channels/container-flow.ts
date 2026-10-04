import { describeMetaError, isClearRejection } from '../meta-http.js'
import type { PublishContext, PublishOutcome } from '../types.js'

/** 캐러셀 항목(사진 한 장) 준비 실패 — 아직 아무것도 게시되지 않았다. index 는 0부터. */
export class CarouselItemError extends Error {
  constructor(
    readonly index: number,
    readonly detail: string,
  ) {
    super(`${index + 1}번째 사진: ${detail}`)
    this.name = 'CarouselItemError'
  }
}

export interface CarouselOptions {
  imageUrls: string[]
  createItem: (url: string) => Promise<Record<string, unknown>>
  getItemStatus: (id: string) => Promise<Record<string, unknown>>
  createCarousel: (childIds: string[]) => Promise<Record<string, unknown>>
  /** 항목 상태 값이 담긴 필드 — Threads 는 status, Instagram 은 status_code */
  statusField: 'status' | 'status_code'
  sleep: (ms: number) => Promise<void>
  progress?: (message: string) => void
  pollMs: number
  maxPolls: number
}

/** 사진마다 항목 컨테이너를 차례로 만들고 준비를 기다린 뒤 캐러셀 컨테이너를 만든다. 항목 실패는 CarouselItemError. */
export async function createCarouselContainer(o: CarouselOptions): Promise<Record<string, unknown>> {
  const ids: string[] = []
  const n = o.imageUrls.length
  for (let i = 0; i < n; i++) {
    o.progress?.(`사진 ${i + 1}/${n} 준비 중`)
    let id: string
    try {
      const r = await o.createItem(o.imageUrls[i])
      if (typeof r.id !== 'string' || r.id === '') throw new CarouselItemError(i, '항목 ID 를 받지 못했습니다')
      id = r.id
    } catch (e) {
      if (e instanceof CarouselItemError) throw e
      throw new CarouselItemError(i, describeMetaError(e))
    }
    for (let poll = 1; ; poll++) {
      let st: Record<string, unknown>
      try {
        st = await o.getItemStatus(id)
      } catch (e) {
        throw new CarouselItemError(i, `상태를 확인하지 못했습니다(${describeMetaError(e)})`)
      }
      const status = st[o.statusField]
      if (status === 'FINISHED') break
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new CarouselItemError(i, `${status}${st.error_message ? ` — ${String(st.error_message)}` : ''}`)
      }
      if (poll >= o.maxPolls) throw new CarouselItemError(i, '준비가 끝나지 않았습니다')
      await o.sleep(o.pollMs)
    }
    ids.push(id)
  }
  o.progress?.(`사진 ${n}장 준비 완료, 게시물을 만듭니다.`)
  return o.createCarousel(ids)
}

export interface ContainerFlow {
  ctx: PublishContext
  /** 사람에게 보이는 채널 이름 — "Threads", "인스타그램" */
  channelLabel: string
  createContainer: () => Promise<Record<string, unknown>>
  getStatus: (containerId: string) => Promise<Record<string, unknown>>
  /** 상태 값이 담긴 필드 — Threads 는 status, Instagram 은 status_code */
  statusField: 'status' | 'status_code'
  publishContainer: (containerId: string) => Promise<Record<string, unknown>>
  getPermalink: (mediaId: string) => Promise<Record<string, unknown>>
  firstWaitMs: number
  pollMs: number
  maxPolls: number
}

/** 컨테이너 생성 → 대기·상태 확인 → (게시 직전 기록) → 게시 → 주소. Threads 와 Instagram 이 함께 쓴다. */
export async function publishViaContainer(f: ContainerFlow): Promise<PublishOutcome> {
  const resolveHint = `${f.channelLabel} 에서 게시 여부를 확인한 뒤 sns-relay resolve 로 기록하세요.`
  const limitMinutes = Math.ceil((f.firstWaitMs + f.pollMs * (f.maxPolls - 1)) / 60_000)

  // 1. 컨테이너 — 아직 아무것도 게시되지 않는다.
  let containerId: string
  try {
    const r = await f.createContainer()
    if (typeof r.id !== 'string' || r.id === '') {
      return { status: 'failed', reason: '컨테이너 ID 를 받지 못했습니다. 잠시 뒤 다시 게시하세요.' }
    }
    containerId = r.id
  } catch (e) {
    if (e instanceof CarouselItemError) {
      return { status: 'failed', reason: `${e.index + 1}번째 사진을 준비하지 못했습니다(${f.channelLabel}): ${e.detail}` }
    }
    return { status: 'failed', reason: `컨테이너를 만들지 못했습니다: ${describeMetaError(e)}` }
  }

  // 2. 준비될 때까지 기다린다.
  f.ctx.progress?.(`컨테이너를 만들었습니다. 준비될 때까지 기다립니다(약 ${Math.round(f.firstWaitMs / 1000)}초).`)
  await f.ctx.sleep(f.firstWaitMs)
  for (let poll = 1; ; poll++) {
    let st: Record<string, unknown>
    try {
      st = await f.getStatus(containerId)
    } catch (e) {
      return { status: 'failed', reason: `컨테이너 상태를 확인하지 못했습니다: ${describeMetaError(e)}` }
    }
    const status = st[f.statusField]
    if (status === 'FINISHED') break
    if (status === 'ERROR' || status === 'EXPIRED') {
      const detail = st.error_message ?? (f.statusField === 'status_code' ? st.status : undefined) ?? '사유 없음'
      return { status: 'failed', reason: `컨테이너 ${status}: ${String(detail)}` }
    }
    if (status === 'PUBLISHED') {
      return { status: 'unknown', reason: `컨테이너가 이미 게시된 상태입니다. ${resolveHint}` }
    }
    if (poll >= f.maxPolls) {
      return { status: 'failed', reason: `컨테이너 준비가 ${limitMinutes}분 안에 끝나지 않았습니다. 잠시 뒤 다시 게시하세요.` }
    }
    await f.ctx.sleep(f.pollMs)
  }

  // 3. 게시 — 되돌릴 수 없다. 보내기 전에 칸을 unknown 으로 먼저 기록한다(던지면 요청하지 않는다).
  await f.ctx.onBeforePublish()
  let mediaId: string
  try {
    const r = await f.publishContainer(containerId)
    if (typeof r.id !== 'string' || r.id === '') {
      return { status: 'unknown', reason: `게시 응답에 게시물 ID 가 없습니다. ${resolveHint}` }
    }
    mediaId = r.id
  } catch (e) {
    if (isClearRejection(e)) return { status: 'failed', reason: `게시가 거절되었습니다: ${describeMetaError(e)}` }
    return { status: 'unknown', reason: `게시 결과를 확인하지 못했습니다(${describeMetaError(e)}). ${resolveHint}` }
  }

  // 4. 게시물 주소 — 실패해도 게시는 된 것이다.
  try {
    const r = await f.getPermalink(mediaId)
    if (typeof r.permalink === 'string') return { status: 'published', postId: mediaId, postUrl: r.permalink }
    return { status: 'published', postId: mediaId, note: '게시는 됐지만 게시물 주소를 받지 못했습니다.' }
  } catch (e) {
    return { status: 'published', postId: mediaId, note: `게시는 됐지만 게시물 주소를 가져오지 못했습니다: ${describeMetaError(e)}` }
  }
}
