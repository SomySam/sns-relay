import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { assertValidId } from '../core/article-id.js'
import { countChars } from '../core/channels/index.js'
import { readDrafts } from '../core/draft-files.js'
import { runDoctor } from '../core/health.js'
import { articleStatus, listArticleIds } from '../core/status.js'
import { runTool } from './result.js'
import type { CellStatus } from '../core/types.js'
import type { ServerOptions } from './server.js'

const STATUS_LABEL: Record<CellStatus, string> = {
  draft: '미승인',
  approved: '미승인',
  published: '게시됨',
  unknown: '결과 불명',
  failed: '실패',
  skipped: '건너뜀',
  manual: '수동 발행 대기',
}

export function registerReadTools(server: McpServer, opts: ServerOptions): void {
  const { root } = opts

  server.registerTool(
    'status',
    {
      title: '상태 보기',
      description:
        '글 × 채널 상태(미승인·승인됨·게시됨·결과 불명·실패·수동 발행 대기)를 보여 준다. id 를 빼면 모든 글을 보여 준다. 게시 응답이 시간 초과됐을 때도 먼저 이것으로 확인한다.',
      inputSchema: z.object({ id: z.string().optional().describe('작업 이름(글 주소의 슬러그). 빼면 모든 글') }),
    },
    ({ id }) =>
      runTool(root, async () => {
        const ids = id !== undefined ? [assertValidId(id)] : await listArticleIds(root)
        const articles = []
        for (const i of ids) articles.push(await articleStatus(root, i))
        const summary =
          articles.length === 0
            ? '작업한 글이 없습니다. fetch_article 로 시작하세요.'
            : articles
                .map((a) => [`${a.id} — ${a.title}`, ...a.cells.map((c) => `  ${c.channel} ${c.label}${c.detail ? ` ${c.detail}` : ''}`)].join('\n'))
                .join('\n\n')
        return { summary, data: { articles } }
      }),
  )

  server.registerTool(
    'get_drafts',
    {
      title: '초안 보기',
      description:
        '채널별 초안 본문, 링크, 이미지, 네이버 제목·태그, 글자 수, 검증 결과(error·warn), 실제 승인 여부를 돌려준다. 초안을 저장한 뒤와 오너에게 보여 주기 전에 쓴다.',
      inputSchema: z.object({ id: z.string().describe('작업 이름') }),
    },
    ({ id }) =>
      runTool(root, async () => {
        const { article, views } = await readDrafts(root, assertValidId(id), opts.now)
        const drafts = views.map((v) => ({
          channel: v.channel,
          approved: v.approved,
          cellStatus: v.cellStatus ?? null,
          path: v.path,
          title: v.draft?.title ?? null,
          tags: v.draft?.tags ?? null,
          link: v.draft?.link ?? null,
          image: v.draft?.image ?? null,
          chars: v.draft ? countChars(v.draft.body) : 0,
          body: v.draft?.body ?? null,
          problems: v.problems,
        }))
        const summary = [
          `${article.id} — ${article.title}`,
          ...drafts.map((d) => {
            const errors = d.problems.filter((p) => p.level === 'error').length
            const warns = d.problems.filter((p) => p.level === 'warn').length
            const state = d.approved ? '승인됨' : d.cellStatus ? STATUS_LABEL[d.cellStatus] : '미승인'
            return `  ${d.channel} ${state} ${d.chars}자 · 오류 ${errors} · 경고 ${warns}`
          }),
        ].join('\n')
        return { summary, data: { id: article.id, title: article.title, drafts } }
      }),
  )

  server.registerTool(
    'doctor',
    {
      title: '토큰 점검',
      description:
        '채널별 토큰이 살아 있는지, 어느 계정인지, 언제 만료되는지 점검한다(읽기 전용). 게시가 권한·토큰 문제로 실패했을 때나 만료가 가까울 때 쓴다. 토큰 갱신은 오너가 터미널에서 sns-relay token refresh 로 한다.',
      inputSchema: z.object({}),
    },
    () =>
      runTool(root, async () => {
        const reports = await runDoctor(root, opts.now)
        const mark = { ok: '✔', warn: '⚠', error: '✖', skip: '-' } as const
        const summary = reports
          .map((r) => [`${mark[r.level]} ${r.channel}${r.account ? ` ${r.account}` : ''}`, ...r.messages.map((m) => `    ${m}`)].join('\n'))
          .join('\n')
        return { summary, data: { reports } }
      }),
  )
}
