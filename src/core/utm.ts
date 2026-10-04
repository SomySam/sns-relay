import type { Article } from './types.js'
import type { Config } from './config.js'
import type { ChannelId } from './types.js'

export function buildLink(baseUrl: string, channel: ChannelId, utm: Config['utm'], campaign: string): string {
  const url = new URL(baseUrl)
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_')) url.searchParams.delete(key)
  }
  url.searchParams.set('utm_source', utm.source[channel])
  url.searchParams.set('utm_medium', utm.medium)
  url.searchParams.set('utm_campaign', campaign)
  url.hash = ''
  return url.toString()
}

export function buildLinks(
  baseUrl: string,
  channels: ChannelId[],
  utm: Config['utm'],
  campaign: string,
): Partial<Record<ChannelId, string>> {
  return Object.fromEntries(channels.map((c) => [c, buildLink(baseUrl, c, utm, campaign)]))
}

/** 작업의 채널 링크 — 원문 주소가 없는 작업(글감)은 빈 문자열이다. 빈 링크는 "링크 없이 게시"를 뜻한다. */
export function articleLink(article: Pick<Article, 'canonicalUrl' | 'id'>, channel: ChannelId, utm: Config['utm']): string {
  return article.canonicalUrl ? buildLink(article.canonicalUrl, channel, utm, article.id) : ''
}
