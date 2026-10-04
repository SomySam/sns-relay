import { resolve } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { assertValidId } from '../core/article-id.js'
import { loadConfig } from '../core/config.js'
import { readDrafts } from '../core/draft-files.js'
import { articleImages } from '../core/drafts.js'
import { fetchArticle } from '../core/fetch-article.js'
import { createFromNotes, rehostImage, type ImageInput } from '../core/notes.js'
import { loadRules } from '../core/rules.js'
import { saveDrafts } from '../core/save-drafts.js'
import { CHANNEL_IDS } from '../core/types.js'
import { runTool } from './result.js'
import type { ServerOptions } from './server.js'

/** image_paths 다음 image_urls 순서로 사진 목록을 만든다(상대 경로는 작업 폴더 기준) */
function multiImages(root: string, paths?: string[], urls?: string[]): ImageInput[] {
  return [...(paths ?? []).map((p) => ({ file: resolve(root, p) })), ...(urls ?? []).map((u) => ({ url: u }))]
}

export function registerDraftTools(server: McpServer, opts: ServerOptions): void {
  const { root } = opts

  server.registerTool(
    'fetch_article',
    {
      title: '블로그 글 가져오기',
      description:
        '블로그 글 주소에서 본문을 추출해 작업 폴더에 저장하고, 채널별 빈 초안 파일을 만든다. 본문(text)과 초안 작성 규칙(rules)을 돌려준다. 같은 글을 다시 가져와도 이미 쓴 초안은 지우지 않는다.',
      inputSchema: z.object({
        url: z.string().describe('블로그 글 주소 (http/https)'),
        id: z.string().optional().describe('작업 이름을 직접 정할 때만. 보통은 빼면 주소에서 만든다'),
      }),
    },
    ({ url, id }) =>
      runTool(root, async () => {
        const r = await fetchArticle(root, url, { id, now: opts.now })
        const config = await loadConfig(root)
        const rules = loadRules({ channels: config.channels, notes: config.notes })
        const next = `다음: rules 에 맞춰 채널별 본문을 쓰고 save_drafts 로 저장하세요(네이버는 title·tags 도). 저장 뒤 get_drafts 로 검증 결과를 확인하고 오너에게 보여 주세요.`
        const summary = [
          `✔ ${r.article.id} — ${r.article.title} (본문 ${r.article.text.length.toLocaleString('ko-KR')}자${r.reused ? ', 기존 작업 갱신' : ''})`,
          r.drafts.relinked.length > 0 ? `링크 갱신: ${r.drafts.relinked.join(', ')} (승인이 풀렸습니다)` : '',
          r.drafts.reimaged.length > 0 ? `이미지 갱신: ${r.drafts.reimaged.join(', ')} (승인이 풀렸습니다)` : '',
          next,
        ]
          .filter(Boolean)
          .join('\n')
        return {
          summary,
          data: {
            id: r.article.id,
            title: r.article.title,
            url: r.article.url,
            image: r.article.image,
            text: r.article.text,
            reused: r.reused,
            drafts: r.drafts,
            rules,
          },
        }
      }),
  )

  server.registerTool(
    'create_from_notes',
    {
      title: '글감으로 작업 만들기',
      description:
        '블로그 주소 없이 오너가 준 글감(과 사진·링크)으로 작업을 만든다. 사진은 image_path(로컬 파일) 또는 image_url(공개 주소) 하나, 여러 장이면 image_paths·image_urls 배열(순서대로, 첫 장이 대표, 최대 10장). 링크가 없으면 링크 없이 게시하고, 사진이 있으면 Threads·페이스북은 사진 글로 올린다. 글감에 없는 사실은 쓰지 않는다. 돌려받은 rules 에 맞춰 save_drafts 로 초안을 쓴다.',
      inputSchema: z.object({
        title: z.string().describe('작업 제목'),
        text: z.string().describe('글감 — 오너가 준 내용 그대로'),
        image_path: z.string().optional().describe('사진 파일 경로(imageHost: cloudinary 필요)'),
        image_url: z.string().optional().describe('공개 이미지 주소'),
        image_paths: z.array(z.string()).optional().describe('사진 파일 경로 여러 장(올린 순서, 첫 장이 대표)'),
        image_urls: z.array(z.string()).optional().describe('공개 이미지 주소 여러 장(image_paths 다음 순서)'),
        link: z.string().optional().describe('글에 붙일 링크'),
        id: z.string().optional().describe('작업 이름(기본: 제목에서)'),
      }),
    },
    ({ title, text, image_path, image_url, image_paths, image_urls, link, id }) =>
      runTool(root, async () => {
        if (image_path && image_url) throw new Error('image_path 와 image_url 중 하나만 주세요.')
        if ((image_path || image_url) && ((image_paths?.length ?? 0) > 0 || (image_urls?.length ?? 0) > 0)) throw new Error('사진은 image_path·image_url 하나, 또는 image_paths·image_urls 목록으로 주세요(섞지 않음).')
        const image = image_path ? { file: resolve(root, image_path) } : image_url ? { url: image_url } : undefined
        const images = multiImages(root, image_paths, image_urls)
        const r = await createFromNotes(root, { title, text, image, images, link, id }, opts.now)
        const config = await loadConfig(root)
        const rules = loadRules({ channels: config.channels, notes: config.notes })
        const summary = [
          `✔ ${r.article.id} — ${r.article.title} (${r.article.canonicalUrl ? '링크 있음' : '링크 없음'}, ${articleImages(r.article).length > 0 ? `사진 ${articleImages(r.article).length}장 ${r.uploaded ? '올림' : '주소'}` : '사진 없음'})`,
          '다음: rules 에 맞춰 채널별 본문을 쓰고 save_drafts 로 저장하세요(네이버는 title·tags 도). 링크가 없으면 블로그·프로필 링크 안내 문장을 넣지 마세요.',
        ].join('\n')
        return {
          summary,
          data: { id: r.article.id, title: r.article.title, text: r.article.text, image: r.article.image, images: articleImages(r.article), link: r.article.canonicalUrl || null, drafts: r.drafts, rules },
        }
      }),
  )

  server.registerTool(
    'rehost_image',
    {
      title: '사진 옮겨 올리기',
      description:
        '작업 사진을 Cloudinary 에 올려 JPEG 주소로 바꾼다(imageHost: cloudinary). image_path, image_url, image_paths·image_urls(여러 장이면 사진 전체를 그 순서로 바꿈), from_article(지금 대표 이미지) 중 하나. 초안 사진이 바뀌어 해당 채널 승인이 풀리므로 오너에게 다시 확인받는다.',
      inputSchema: z.object({
        id: z.string().describe('작업 이름'),
        image_path: z.string().optional(),
        image_url: z.string().optional(),
        image_paths: z.array(z.string()).optional(),
        image_urls: z.array(z.string()).optional(),
        from_article: z.boolean().optional(),
      }),
    },
    ({ id, image_path, image_url, image_paths, image_urls, from_article }) =>
      runTool(root, async () => {
        const list = multiImages(root, image_paths, image_urls)
        if ((image_path !== undefined || image_url !== undefined) && list.length > 0) throw new Error('사진은 image_path·image_url 하나, 또는 image_paths·image_urls 목록으로 주세요(섞지 않음).')
        const picked = [image_path !== undefined, image_url !== undefined, list.length > 0, from_article === true].filter(Boolean).length
        if (picked !== 1) throw new Error('image_path, image_url, image_paths·image_urls, from_article 중 하나만 주세요.')
        const source = list.length > 0 ? list : image_path ? { file: resolve(root, image_path) } : image_url ? { url: image_url } : ({ article: true } as const)
        const r = await rehostImage(root, id, source, opts.now)
        return {
          summary: `✔ ${r.urls.length > 1 ? `사진 ${r.urls.length}장을 올렸습니다(첫 장이 대표): ${r.urls.join(' ')}` : `사진을 올렸습니다: ${r.url}`}${r.reimaged.length > 0 ? `\n이미지 갱신: ${r.reimaged.join(', ')} (승인이 풀렸습니다)` : ''}`,
          data: { url: r.url, urls: r.urls, reimaged: r.reimaged },
        }
      }),
  )

  server.registerTool(
    'save_drafts',
    {
      title: '초안 저장',
      description:
        '채널별 초안 본문을 저장한다. 네이버만 title·tags 를 함께 줄 수 있다. 링크·이미지·승인 여부는 바꿀 수 없다(내용이 바뀌면 승인이 풀린다). 게시된 칸은 고치지 않는다. 저장 뒤 검증 결과를 돌려준다.',
      inputSchema: z.object({
        id: z.string().describe('작업 이름'),
        drafts: z
          .array(
            z.object({
              channel: z.enum(CHANNEL_IDS),
              body: z.string().describe('본문. 주소(URL)는 쓰지 않는다 — 링크는 프로그램이 붙인다'),
              title: z.string().optional().describe('네이버만: 검색어가 들어간 제목'),
              tags: z.array(z.string()).optional().describe('네이버만: 검색어 중심 태그 5~10개, # 과 쉼표 없이'),
            }),
          )
          .min(1),
      }),
    },
    ({ id, drafts }) =>
      runTool(root, async () => {
        const safeId = assertValidId(id)
        const results = await saveDrafts(root, safeId, drafts)
        const { views } = await readDrafts(root, safeId, opts.now)
        const touched = new Set(drafts.map((d) => d.channel))
        const checked = views
          .filter((v) => touched.has(v.channel))
          .map((v) => ({ channel: v.channel, approved: v.approved, problems: v.problems }))
        const summary = results
          .map((r) => {
            const problems = checked.find((c) => c.channel === r.channel)?.problems ?? []
            const errors = problems.filter((p) => p.level === 'error').length
            const warns = problems.filter((p) => p.level === 'warn').length
            return r.saved
              ? `${r.channel} 저장${r.reason ? ` (${r.reason})` : ''} · 오류 ${errors} · 경고 ${warns}`
              : `${r.channel} 저장 안 함: ${r.reason}`
          })
          .join('\n')
        return { summary, data: { results, drafts: checked } }
      }),
  )
}
