import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from './fs.js'
import type { Article } from './types.js'

const optionalLink = z.string().optional()

const ArticleSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['blog', 'notes']).optional(),
  url: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  text: z.string(),
  image: z.string().nullable(),
  images: z.array(z.string()).optional(),
  imageOrigin: z.string().optional(),
  links: z.object({
    threads: optionalLink,
    instagram: optionalLink,
    facebook: optionalLink,
    naver: optionalLink,
  }),
  fetchedAt: z.string(),
})

export function articleDir(root: string, id: string): string {
  return join(root, 'work', id)
}

export async function readArticle(root: string, id: string): Promise<Article | null> {
  const path = join(articleDir(root, id), 'article.json')
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`article.json 형식 오류 (${path}): JSON 을 읽을 수 없습니다. \`sns-relay fetch\` 로 다시 가져오세요.`)
  }
  const parsed = ArticleSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`article.json 형식 오류 (${path}):\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export async function requireArticle(root: string, id: string): Promise<Article> {
  const article = await readArticle(root, id)
  if (!article) {
    throw new Error(`작업 "${id}" 이 없습니다. 먼저 \`sns-relay fetch <글 주소>\` 를 실행하세요.`)
  }
  return article
}

export async function saveArticle(root: string, article: Article): Promise<string> {
  const dir = articleDir(root, article.id)
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'article.json')
  await writeFileAtomic(path, JSON.stringify(article, null, 2) + '\n')
  return path
}
