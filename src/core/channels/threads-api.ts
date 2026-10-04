import { requireEnv } from '../env.js'
import { metaRequest } from '../meta-http.js'
import { createCarouselContainer, publishViaContainer } from './container-flow.js'
import type { ChannelDraft, PublishContext, PublishOutcome } from '../types.js'

export const THREADS_API_BASE = 'https://graph.threads.net/v1.0'
export const THREADS_FIRST_WAIT_MS = 30_000
export const THREADS_POLL_MS = 60_000
export const THREADS_MAX_POLLS = 5
/** 캐러셀 사진 한 장(항목)의 준비 확인 간격·횟수 */
export const THREADS_ITEM_POLL_MS = 5_000
export const THREADS_ITEM_MAX_POLLS = 24

export async function publishToThreads(draft: ChannelDraft, ctx: PublishContext): Promise<PublishOutcome> {
  let uid: string
  let token: string
  try {
    const creds = requireEnv(ctx.env, ['THREADS_USER_ID', 'THREADS_TOKEN'])
    uid = creds.THREADS_USER_ID
    token = creds.THREADS_TOKEN
  } catch (e) {
    return { status: 'failed', reason: (e as Error).message }
  }
  const call = (path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET') =>
    metaRequest({ base: THREADS_API_BASE, path, params, method, token })

  return publishViaContainer({
    ctx,
    channelLabel: 'Threads',
    statusField: 'status',
    createContainer: () =>
      draft.images && draft.images.length > 1 && !draft.link
        ? createCarouselContainer({
            imageUrls: draft.images,
            createItem: (url) => call(`/${uid}/threads`, { media_type: 'IMAGE', image_url: url, is_carousel_item: 'true' }, 'POST'),
            getItemStatus: (id) => call(`/${id}`, { fields: 'status,error_message' }),
            createCarousel: (ids) =>
              call(`/${uid}/threads`, { media_type: 'CAROUSEL', children: ids.join(','), text: draft.body }, 'POST'),
            statusField: 'status',
            sleep: ctx.sleep,
            progress: ctx.progress,
            pollMs: THREADS_ITEM_POLL_MS,
            maxPolls: THREADS_ITEM_MAX_POLLS,
          })
        : call(
        `/${uid}/threads`,
        draft.image && !draft.link
          ? { media_type: 'IMAGE', image_url: draft.image, text: draft.body }
          : { media_type: 'TEXT', text: draft.body, ...(draft.link ? { link_attachment: draft.link } : {}) },
        'POST',
      ),
    getStatus: (cid) => call(`/${cid}`, { fields: 'status,error_message' }),
    publishContainer: (cid) => call(`/${uid}/threads_publish`, { creation_id: cid }, 'POST'),
    getPermalink: (mid) => call(`/${mid}`, { fields: 'permalink' }),
    firstWaitMs: THREADS_FIRST_WAIT_MS,
    pollMs: THREADS_POLL_MS,
    maxPolls: THREADS_MAX_POLLS,
  })
}
