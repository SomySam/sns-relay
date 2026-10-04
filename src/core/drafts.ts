import { createHash } from 'node:crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import type { Config } from './config.js'
import { CHANNEL_IDS, type Article, type ChannelDraft, type ChannelId } from './types.js'
import { articleLink } from './utm.js'

const MetaSchema = z.object({
  channel: z.enum(CHANNEL_IDS),
  approved: z.boolean(),
  title: z.string().optional(),
  tags: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
  link: z.string(),
  image: z.string().nullable(),
  images: z.array(z.string()).optional(),
})

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/

export function parseDraft(text: string, channel: ChannelId): ChannelDraft {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const match = normalized.match(FRONTMATTER)
  if (!match) {
    throw new Error('초안 형식 오류: 파일 맨 위에 --- 로 감싼 설정(frontmatter)이 없습니다.')
  }
  let raw: unknown
  try {
    raw = parseYaml(match[1])
  } catch (e) {
    throw new Error(`초안 형식 오류: frontmatter 를 읽을 수 없습니다 (${(e as Error).message})`)
  }
  const meta = MetaSchema.safeParse(raw)
  if (!meta.success) {
    throw new Error(`초안 형식 오류:\n${z.prettifyError(meta.error)}`)
  }
  if (meta.data.channel !== channel) {
    throw new Error(`초안 형식 오류: 이 파일은 ${channel} 초안인데 channel 이 ${meta.data.channel} 입니다.`)
  }
  const body = match[2].replace(/^\n+/, '').replace(/\s+$/, '')
  return { ...meta.data, body }
}

export function serializeDraft(draft: ChannelDraft): string {
  const meta: Record<string, unknown> = { channel: draft.channel, approved: draft.approved }
  if (draft.title !== undefined) meta.title = draft.title
  if (draft.tags !== undefined) meta.tags = draft.tags
  meta.link = draft.link
  meta.image = draft.image
  if (draft.images) meta.images = draft.images
  return `---\n${stringifyYaml(meta, { lineWidth: 0 })}---\n\n${draft.body}\n`
}

/** 게시될 내용의 지문. approved 는 넣지 않는다 — 내용이 같으면 승인 여부와 상관없이 같은 해시. */
export function hashDraft(draft: ChannelDraft): string {
  const parts: unknown[] = [draft.channel, draft.title ?? null, draft.link, draft.image, draft.body]
  // 사진 목록은 2장 이상일 때만 넣는다 — 한 장·없음이면 예전 공식 그대로다.
  if (draft.images && draft.images.length > 1) parts.push(draft.images)
  // 태그는 나중에 생긴 항목이다 — 비어 있으면 넣지 않아 기존 승인·발행 기록의 해시를 지킨다.
  if (draft.tags && draft.tags.length > 0) parts.push(draft.tags)
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)
}

export const MAX_IMAGES = 10

/** 작업의 사진 목록 — 첫 장이 대표(image). */
export function articleImages(article: Article): string[] {
  return article.images ?? (article.image ? [article.image] : [])
}

/** 초안의 사진 — 인스타는 전부, 링크 없는 작업이면 스레드·페이스북도 전부(네이버는 원고에 따로 싣는다). */
export function draftImages(article: Article, channel: ChannelId): string[] {
  if (channel === 'instagram') return articleImages(article)
  if (channel === 'naver') return []
  return article.canonicalUrl === '' ? articleImages(article) : []
}

export function draftImage(article: Article, channel: ChannelId): string | null {
  return draftImages(article, channel)[0] ?? null
}

export function newDraft(article: Article, channel: ChannelId, config: Config): ChannelDraft {
  const imgs = draftImages(article, channel)
  return {
    channel,
    approved: false,
    ...(channel === 'naver' ? { title: article.title, tags: [] } : {}),
    link: articleLink(article, channel, config.utm),
    image: imgs[0] ?? null,
    ...(imgs.length > 1 ? { images: imgs } : {}),
    body: '',
  }
}
