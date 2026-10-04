import { requireEnv } from '../env.js'
import { metaRequest } from '../meta-http.js'
import type { ChannelDraft, PublishContext, PublishOutcome } from '../types.js'
import { createCarouselContainer, publishViaContainer } from './container-flow.js'

export const INSTAGRAM_API_BASE = 'https://graph.instagram.com/v25.0'
export const INSTAGRAM_FIRST_WAIT_MS = 5_000
export const INSTAGRAM_POLL_MS = 15_000
export const INSTAGRAM_MAX_POLLS = 8
/** 캐러셀 사진 한 장(항목)의 준비 확인 간격·횟수 */
export const IG_ITEM_POLL_MS = 3_000
export const IG_ITEM_MAX_POLLS = 20

export async function publishToInstagram(draft: ChannelDraft, ctx: PublishContext): Promise<PublishOutcome> {
  let uid: string
  let token: string
  try {
    const creds = requireEnv(ctx.env, ['IG_USER_ID', 'IG_TOKEN'])
    uid = creds.IG_USER_ID
    token = creds.IG_TOKEN
  } catch (e) {
    return { status: 'failed', reason: (e as Error).message }
  }
  const image = draft.image
  if (!image) return { status: 'failed', reason: '인스타그램은 이미지가 필요합니다. 초안의 image 가 비어 있습니다.' }

  const call = (path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET') =>
    metaRequest({ base: INSTAGRAM_API_BASE, path, params, method, token })

  return publishViaContainer({
    ctx,
    channelLabel: '인스타그램',
    statusField: 'status_code',
    createContainer:
      draft.images && draft.images.length > 1
        ? () =>
            createCarouselContainer({
              imageUrls: draft.images!,
              createItem: (url) => call(`/${uid}/media`, { image_url: url, is_carousel_item: 'true' }, 'POST'),
              getItemStatus: (id) => call(`/${id}`, { fields: 'status_code,status' }),
              createCarousel: (ids) =>
                call(`/${uid}/media`, { media_type: 'CAROUSEL', children: ids.join(','), caption: draft.body }, 'POST'),
              statusField: 'status_code',
              sleep: ctx.sleep,
              progress: ctx.progress,
              pollMs: IG_ITEM_POLL_MS,
              maxPolls: IG_ITEM_MAX_POLLS,
            })
        : () => call(`/${uid}/media`, { image_url: image, caption: draft.body }, 'POST'),
    getStatus: (cid) => call(`/${cid}`, { fields: 'status_code,status' }),
    publishContainer: (cid) => call(`/${uid}/media_publish`, { creation_id: cid }, 'POST'),
    getPermalink: (mid) => call(`/${mid}`, { fields: 'permalink' }),
    firstWaitMs: INSTAGRAM_FIRST_WAIT_MS,
    pollMs: INSTAGRAM_POLL_MS,
    maxPolls: INSTAGRAM_MAX_POLLS,
  })
}
