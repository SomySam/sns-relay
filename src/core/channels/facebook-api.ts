import { requireEnv } from '../env.js'
import { describeMetaError, isClearRejection, metaRequest } from '../meta-http.js'
import type { ChannelDraft, PublishContext, PublishOutcome } from '../types.js'

export const FACEBOOK_API_BASE = 'https://graph.facebook.com/v26.0'

/** false 로 바꾸면 2장 이상 링크 없는 글도 첫 장 한 장만 올린다(안전 스위치). */
export const FACEBOOK_MULTI_PHOTO = true

const RESOLVE_HINT = '페이스북 페이지에서 게시 여부를 확인한 뒤 sns-relay resolve 로 기록하세요.'

/** 페이지 게시는 한 번의 요청이다 — 요청 직전에 칸을 unknown 으로 먼저 기록한다. */
export async function publishToFacebook(draft: ChannelDraft, ctx: PublishContext): Promise<PublishOutcome> {
  let pageId: string
  let token: string
  try {
    const creds = requireEnv(ctx.env, ['FB_PAGE_ID', 'FB_PAGE_TOKEN'])
    pageId = creds.FB_PAGE_ID
    token = creds.FB_PAGE_TOKEN
  } catch (e) {
    return { status: 'failed', reason: (e as Error).message }
  }
  const call = (path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET') =>
    metaRequest({ base: FACEBOOK_API_BASE, path, params, method, token })

  const allPhotos = !draft.link ? (draft.images ?? (draft.image ? [draft.image] : [])) : []
  const photos = FACEBOOK_MULTI_PHOTO ? allPhotos : allPhotos.slice(0, 1)
  let request: () => Promise<Record<string, unknown>>
  if (photos.length > 1) {
    // 되돌릴 수 있는 준비: 사진을 게시하지 않은 상태로 올려 ID 를 받는다(피드에 보이지 않음).
    const mediaIds: string[] = []
    for (const [i, url] of photos.entries()) {
      try {
        const up = await call(`/${pageId}/photos`, { url, published: 'false' }, 'POST')
        if (typeof up.id !== 'string' || up.id === '') {
          return { status: 'failed', reason: `${i + 1}번째 사진을 올리지 못했습니다(ID 없음).` }
        }
        mediaIds.push(up.id)
      } catch (e) {
        return { status: 'failed', reason: `${i + 1}번째 사진을 올리지 못했습니다: ${describeMetaError(e)}` }
      }
    }
    const params: Record<string, string> = { message: draft.body }
    mediaIds.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })))
    request = () => call(`/${pageId}/feed`, params, 'POST')
  } else {
    // 링크가 없고 사진이 있으면 사진 글, 아니면 글(링크가 있으면 링크 미리보기)
    request = () =>
      !draft.link && draft.image
        ? call(`/${pageId}/photos`, { url: draft.image, message: draft.body }, 'POST')
        : call(`/${pageId}/feed`, { message: draft.body, ...(draft.link ? { link: draft.link } : {}) }, 'POST')
  }

  ctx.progress?.('페이지에 게시합니다.')
  await ctx.onBeforePublish()
  let postId: string
  try {
    const r = await request()
    const id = typeof r.post_id === 'string' && r.post_id !== '' ? r.post_id : r.id
    if (typeof id !== 'string' || id === '') {
      return { status: 'unknown', reason: `게시 응답에 게시물 ID 가 없습니다. ${RESOLVE_HINT}` }
    }
    postId = id
  } catch (e) {
    if (isClearRejection(e)) return { status: 'failed', reason: `게시가 거절되었습니다: ${describeMetaError(e)}` }
    return { status: 'unknown', reason: `게시 요청 뒤 응답을 받지 못했습니다(${describeMetaError(e)}). ${RESOLVE_HINT}` }
  }

  // 여러 장이면 사진이 실제로 붙었는지 확인한다 — 게시 결과는 바꾸지 않고 note 만 더한다.
  let attachNote: string | undefined
  if (photos.length > 1) attachNote = await checkAttachments(call, postId, photos.length)
  const join = (a: string | undefined, b: string | undefined) => [a, b].filter(Boolean).join(' ') || undefined

  const fallback = `https://www.facebook.com/${postId}`
  try {
    const r = await call(`/${postId}`, { fields: 'permalink_url' })
    if (typeof r.permalink_url === 'string') {
      return { status: 'published', postId, postUrl: r.permalink_url, ...(attachNote ? { note: attachNote } : {}) }
    }
    return {
      status: 'published',
      postId,
      postUrl: fallback,
      note: join('게시는 됐지만 주소를 받지 못해 기본 형식 주소를 기록했습니다.', attachNote),
    }
  } catch (e) {
    return {
      status: 'published',
      postId,
      postUrl: fallback,
      note: join(`게시는 됐지만 주소를 가져오지 못해 기본 형식 주소를 기록했습니다: ${describeMetaError(e)}`, attachNote),
    }
  }
}

async function checkAttachments(
  call: (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>,
  postId: string,
  expected: number,
): Promise<string | undefined> {
  try {
    const r = await call(`/${postId}`, { fields: 'attachments{subattachments.limit(20)}' })
    const attachments = r.attachments as { data?: { subattachments?: { data?: unknown[] } }[] } | undefined
    const count = attachments?.data?.[0]?.subattachments?.data?.length ?? 0
    if (count < expected) {
      return `게시는 됐지만 사진이 모두 붙지 않았을 수 있습니다(붙은 사진 ${count}/${expected}장). 페이지에서 확인하세요.`
    }
    return undefined
  } catch {
    return '사진 첨부 여부를 확인하지 못했습니다. 페이지에서 확인하세요.'
  }
}
