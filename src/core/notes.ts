import { createHash } from 'node:crypto'
import { articleIdFromTitle, assertValidId } from './article-id.js'
import { uploadToCloudinary } from './cloudinary.js'
import { loadConfig } from './config.js'
import { ensureDraftFiles } from './draft-files.js'
import { MAX_IMAGES } from './drafts.js'
import { loadEnv } from './env.js'
import type { Article, ChannelId } from './types.js'
import { buildLinks } from './utm.js'
import { readArticle, requireArticle, saveArticle } from './workspace.js'

export type ImageInput = { file: string } | { url: string }

/** Cloudinary 사진 이름 — 주소에 한글이 섞이지 않도록 작업 이름의 영문·숫자만 쓴다(없으면 notes) + 초 */
export function imagePublicId(id: string, now: () => Date, index?: number): string {
  const ascii = id.normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const hash = createHash('sha1').update(id).digest('hex').slice(0, 6)
  return `${ascii || 'notes'}-${hash}-${Math.floor(now().getTime() / 1000)}${index === undefined ? '' : `-${index + 1}`}`
}

const HOST_HINT =
  '로컬 사진을 쓰거나 사진을 옮겨 올리려면 config.json 의 imageHost 를 "cloudinary" 로 하고 .env 에 Cloudinary 키 3개를 넣으세요. 또는 공개 이미지 주소(https://…)를 쓰세요.'

function assertHttpUrl(url: string, what: string): string {
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`${what}는 http(s) 주소여야 합니다: ${url}`)
  return url
}

function assertImageCount(n: number): void {
  if (n > MAX_IMAGES) throw new Error(`사진은 ${MAX_IMAGES}장까지 올릴 수 있습니다(지금 ${n}장).`)
}

/** imageHost 에 따라 사진 주소들을 정한다 — cloudinary 면 차례대로(동시 요청 없이) 올려 JPEG 주소, url 이면 주소 그대로(로컬 파일은 거부). 하나라도 실패하면 오류. */
async function resolveImages(root: string, id: string, images: ImageInput[], now: () => Date): Promise<{ urls: string[]; uploaded: boolean }> {
  assertImageCount(images.length)
  const config = await loadConfig(root)
  for (const image of images) if ('url' in image) assertHttpUrl(image.url, '사진 주소')
  if (config.imageHost === 'cloudinary') {
    const env = loadEnv(root)
    const urls: string[] = []
    for (const [i, image] of images.entries()) {
      const r = await uploadToCloudinary(env, image, imagePublicId(id, now, images.length > 1 ? i : undefined), now)
      urls.push(r.url)
    }
    return { urls, uploaded: true }
  }
  if (images.some((image) => 'file' in image)) throw new Error(HOST_HINT)
  return { urls: images.map((image) => (image as { url: string }).url), uploaded: false }
}

/** 글감(와 사진·링크)으로 작업을 만든다. 링크가 없으면 링크 없이 게시하는 작업이다. */
export async function createFromNotes(
  root: string,
  input: { title: string; text: string; image?: ImageInput; images?: ImageInput[]; link?: string; id?: string },
  now: () => Date = () => new Date(),
): Promise<{ article: Article; drafts: { created: ChannelId[]; relinked: ChannelId[]; reimaged: ChannelId[] }; uploaded: boolean }> {
  const title = input.title.trim()
  const text = input.text.replace(/\r\n?/g, '\n').trim()
  if (!title) throw new Error('제목이 비어 있습니다.')
  if (!text) throw new Error('글감이 비어 있습니다.')
  const config = await loadConfig(root)
  const id = input.id ? assertValidId(input.id.normalize('NFC')) : articleIdFromTitle(title)
  if (await readArticle(root, id)) throw new Error(`작업 "${id}" 이 이미 있습니다. --id 로 다른 이름을 정하세요.`)
  const link = input.link ? assertHttpUrl(input.link.trim(), '링크') : ''
  const inputs = [...(input.image ? [input.image] : []), ...(input.images ?? [])]
  assertImageCount(inputs.length)
  const image = inputs.length > 0 ? await resolveImages(root, id, inputs, now) : null

  const article: Article = {
    id,
    source: 'notes',
    url: link,
    canonicalUrl: link,
    title,
    text,
    image: image?.urls[0] ?? null,
    ...(image && image.urls.length > 1 ? { images: image.urls } : {}),
    links: link ? buildLinks(link, config.channels, config.utm, id) : {},
    fetchedAt: now().toISOString(),
  }
  await saveArticle(root, article)
  const drafts = await ensureDraftFiles(root, article, config)
  return { article, drafts, uploaded: image?.uploaded ?? false }
}

/** 작업 사진을 Cloudinary 에 (다시) 올려 JPEG 주소로 바꾼다. 목록을 주면 사진 전체를 그 순서로 바꾼다. 초안 사진이 바뀌므로 해당 채널 승인이 풀린다. */
export async function rehostImage(
  root: string,
  id: string,
  source: ImageInput | ImageInput[] | { article: true },
  now: () => Date = () => new Date(),
): Promise<{ url: string; urls: string[]; reimaged: ChannelId[] }> {
  const config = await loadConfig(root)
  if (config.imageHost !== 'cloudinary') throw new Error(HOST_HINT)
  const article = await requireArticle(root, assertValidId(id))
  let list: ImageInput[]
  let keepRest: string[] = []
  let imageOrigin: string | undefined
  if (Array.isArray(source)) {
    if (source.length === 0) throw new Error('사진을 하나 이상 주세요.')
    assertImageCount(source.length)
    for (const s of source) if ('url' in s) assertHttpUrl(s.url, '사진 주소')
    list = source
    const first = source[0]!
    if (source.length === 1 && 'url' in first) imageOrigin = first.url
  } else if ('article' in source) {
    if (!article.image) throw new Error(`작업 "${id}" 에 대표 이미지가 없습니다. --file 이나 --url 로 사진을 주세요.`)
    list = [{ url: article.image }]
    keepRest = (article.images ?? []).slice(1)
    imageOrigin = article.image
  } else {
    if ('url' in source) assertHttpUrl(source.url, '사진 주소')
    list = [source]
    if ('url' in source) imageOrigin = source.url
  }
  const uploaded: string[] = []
  for (const [i, image] of list.entries()) {
    const r = await uploadToCloudinary(loadEnv(root), image, imagePublicId(article.id, now, list.length > 1 ? i : undefined), now)
    uploaded.push(r.url)
  }
  const urls = [...uploaded, ...keepRest]
  const { imageOrigin: _previous, images: _images, ...rest } = article
  const updated: Article = { ...rest, image: urls[0]!, ...(urls.length > 1 ? { images: urls } : {}), ...(imageOrigin ? { imageOrigin } : {}) }
  await saveArticle(root, updated)
  const drafts = await ensureDraftFiles(root, updated, config)
  return { url: urls[0]!, urls, reimaged: drafts.reimaged }
}
