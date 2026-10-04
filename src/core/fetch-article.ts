import { articleIdFromUrl, assertValidId } from './article-id.js'
import { loadConfig } from './config.js'
import { extractArticle } from './extract.js'
import { fetchHtml } from './fetch-page.js'
import { ensureDraftFiles } from './draft-files.js'
import type { Article, ChannelId } from './types.js'
import { buildLinks } from './utm.js'
import { readArticle, saveArticle } from './workspace.js'

export interface FetchOptions {
  /** 작업 이름을 직접 정할 때 */
  id?: string
  now?: () => Date
}

export async function fetchArticle(
  root: string,
  url: string,
  opts: FetchOptions = {},
): Promise<{
  article: Article
  path: string
  reused: boolean
  drafts: { created: ChannelId[]; relinked: ChannelId[]; reimaged: ChannelId[] }
}> {
  const config = await loadConfig(root)
  articleIdFromUrl(url) // 주소 형식을 네트워크 요청 전에 검사한다
  const explicitId = opts.id ? assertValidId(opts.id.normalize('NFC')) : undefined
  const { html, finalUrl } = await fetchHtml(url)
  const page = extractArticle(html, finalUrl)

  const id = explicitId ?? articleIdFromUrl(page.canonicalUrl)
  const existing = await readArticle(root, id)
  if (existing?.source === 'notes') {
    throw new Error(`작업 "${id}" 은 글감으로 만든 작업입니다. --id 로 다른 이름을 지정하세요.`)
  }
  if (existing && existing.canonicalUrl !== page.canonicalUrl) {
    throw new Error(
      `작업 이름 "${id}" 은 이미 다른 글(${existing.canonicalUrl})이 쓰고 있습니다. --id 로 다른 이름을 지정하세요.`,
    )
  }

  const keepImage = existing?.imageOrigin !== undefined && existing.imageOrigin === page.image
  const article: Article = {
    id,
    source: 'blog',
    url,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    text: page.text,
    image: keepImage ? existing.image : page.image,
    ...(keepImage ? { imageOrigin: existing.imageOrigin } : {}),
    links: buildLinks(page.canonicalUrl, config.channels, config.utm, id),
    fetchedAt: (opts.now?.() ?? new Date()).toISOString(),
  }
  const path = await saveArticle(root, article)
  const drafts = await ensureDraftFiles(root, article, config)
  return { article, path, reused: existing !== null, drafts }
}
