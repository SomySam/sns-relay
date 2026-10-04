import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { assertValidId } from '../core/article-id.js'
import { markPublished } from '../core/mark.js'
import { exportNaver } from '../core/naver.js'
import { resolveUnknown } from '../core/resolve.js'
import { CHANNEL_IDS } from '../core/types.js'
import { openInDefaultApp } from '../os/open-file.js'
import { runTool } from './result.js'
import type { ServerOptions } from './server.js'

export function registerNaverTools(server: McpServer, opts: ServerOptions): void {
  const { root } = opts

  server.registerTool(
    'naver_export',
    {
      title: '네이버 붙여 넣기용 원고',
      description: [
        '승인된 네이버 초안으로 붙여 넣기용 원고 파일(work/<id>/naver.md)을 만들고 기본 앱으로 연다. 네이버는 자동 게시하지 않는다(약관).',
        '클립보드에 아무것도 복사하지 않는다. 오너에게 제목과 태그 목록을 보여 준다.',
        '오너가 파일에서 칸별로 복사해 제목 → 본문 순으로 붙여 넣고, 소제목 서식을 입힌 뒤, 발행 버튼을 누르면 뜨는 발행 설정 창의 「태그 편집」에 tags 를 하나씩 입력하고 Enter 로 확정한 뒤 발행한다.',
        '오너가 발행 주소를 알려 주면 mark_published 로 기록한다.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().describe('작업 이름'),
        open: z.boolean().optional().describe('원고 파일을 기본 앱으로 열지 (기본 true)'),
      }),
    },
    ({ id, open }) =>
      runTool(root, async () => {
        const safeId = assertValidId(id)
        const { title, text, tags, subheadings, path } = await exportNaver(root, safeId, opts.now)
        let opened = false
        let openError: string | undefined
        if (open ?? true) {
          try {
            await (opts.openFile ?? openInDefaultApp)(path)
            opened = true
          } catch (e) {
            openError = (e as Error).message
          }
        }
        const summary = [
          `✔ 네이버 붙여 넣기용 원고를 만들었습니다: ${path}`,
          `제목: ${title}`,
          tags.length > 0 ? `태그(하나씩 입력 후 Enter): ${tags.join(' / ')}` : '태그: (없음)',
          opened
            ? '원고 파일을 열었습니다 — 칸별로 복사해 붙여 넣으세요.'
            : openError !== undefined
              ? `원고 파일을 열지 못했습니다(${openError}). 오너가 위 경로의 파일을 직접 열게 안내하세요.`
              : '원고 파일을 열지 않았습니다. 위 경로의 파일에서 칸별로 복사해 붙여 넣으세요.',
          '다음: 제목 → 본문을 붙여 넣고 소제목 서식을 입힌 뒤, 발행 설정 창의 「태그 편집」에 태그를 하나씩 입력하고 Enter 로 확정한 뒤 발행하세요. 발행 후 주소를 알려 주면 mark_published 로 기록합니다.',
        ].join('\n')
        return {
          summary,
          data: { title, text, tags, subheadings, path, opened, ...(openError !== undefined ? { open_error: openError } : {}) },
        }
      }),
  )

  server.registerTool(
    'mark_published',
    {
      title: '직접 발행한 주소 기록',
      description: '오너가 직접 발행한 글(네이버)의 주소를 기록한다. naver_export 뒤 "수동 발행 대기" 칸에만 쓸 수 있다. 주소는 오너가 알려 준 것만 쓴다.',
      inputSchema: z.object({
        id: z.string().describe('작업 이름'),
        channel: z.enum(CHANNEL_IDS).describe('보통 naver'),
        url: z.string().describe('발행한 글 주소 (http/https)'),
      }),
    },
    ({ id, channel, url }) =>
      runTool(root, async () => {
        const cell = await markPublished(root, assertValidId(id), channel, url, opts.now)
        return { summary: `✔ ${channel} 게시됨으로 기록했습니다: ${cell.postUrl}`, data: { channel, cell } }
      }),
  )

  server.registerTool(
    'resolve_unknown',
    {
      title: '결과 불명 칸 확정',
      description:
        '게시 요청 뒤 결과를 모르는(결과 불명) 칸을, 오너가 채널에서 직접 확인한 대로 확정한다. 오너 확인 없이 추측해서 부르지 않는다. not_published 로 확정하면 다시 게시할 수 있게 되므로, 채널에 글이 정말 없는지 오너가 확인한 경우에만 쓴다. 게시됨으로 확정할 때 post_url 은 반드시 오너에게 물어서 받는다.',
      inputSchema: z.object({
        id: z.string().describe('작업 이름'),
        channel: z.enum(CHANNEL_IDS),
        result: z.enum(['published', 'not_published']).describe('오너가 채널에서 확인한 결과'),
        post_url: z.string().optional().describe('result 가 published 일 때 게시물 주소'),
      }),
    },
    ({ id, channel, result, post_url }) =>
      runTool(root, async () => {
        if (result === 'published' && !post_url) {
          throw new Error('게시됨으로 확정하려면 post_url(게시물 주소)이 필요합니다.')
        }
        const how = result === 'published' ? { postUrl: post_url! } : ({ notPublished: true } as const)
        const cell = await resolveUnknown(root, assertValidId(id), channel, how, opts.now)
        const summary =
          result === 'published'
            ? `✔ ${channel} 게시됨으로 확정했습니다: ${cell.postUrl}`
            : `✔ ${channel} 게시되지 않음으로 확정했습니다 (현재: ${cell.status}). 다시 게시하려면 dry_run 부터 합니다.`
        return { summary, data: { channel, cell } }
      }),
  )
}
