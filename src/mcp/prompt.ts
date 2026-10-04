import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { loadConfig } from '../core/config.js'
import { loadRules } from '../core/rules.js'
import type { ServerOptions } from './server.js'

/** 스킬(skill/sns-relay/SKILL.md)의 MCP 판 — 같은 절차를 MCP 도구 이름으로 쓴다. */
export const MCP_PROCEDURE = `# sns-relay 작업 절차 (MCP)

1. fetch_article 로 글을 가져온다. 돌려받은 text(본문)와 rules(작성 규칙)만 읽는다. 블로그 페이지를 따로 열지 않는다.
   - 블로그 주소가 없으면 create_from_notes 로 글감(과 사진·링크)으로 시작한다. 사진은 공개 주소(image_url)나 파일 경로(image_path, Cloudinary 필요). 입력창에 올린 사진이 여러 장이면 올린 순서대로 image_paths(주소면 image_urls)에 넣는다. 첫 장이 대표, 최대 10장.
2. rules 에 맞춰 config 의 채널별 본문을 쓰고 save_drafts 로 저장한다.
   - 네이버만 title(검색어가 들어간 제목)과 tags(검색어 중심 5~10개)를 함께 준다.
   - 본문에 주소(URL)를 쓰지 않는다. 링크는 프로그램이 붙인다.
3. get_drafts 로 검증한다. error 가 있으면 고쳐 다시 저장한다. warn 은 오너에게 알린다.
4. 오너 검토: 채널별 본문과 링크·이미지(네이버는 제목·태그)를 그대로 보여 준다. 수정 요청이 오면 save_drafts 부터 다시 한다.
5. 승인: 오너가 명시적으로 승인한 채널만 approve 에 빠짐없이 적는다. 승인 여부를 추측하지 않는다. "좋아요"처럼 모호하면 어느 채널인지 되묻는다.
6. 게시(threads·instagram·facebook):
   - publish 를 dry_run: true 로 불러 미리보기·게시 전 확인·confirm_token 을 받고 오너에게 보여 준다.
   - 오너가 "올려"처럼 명시적으로 허락한 뒤에만 dry_run: false, 같은 channels, 그 confirm_token 으로 부른다.
   - 게시는 되돌릴 수 없다.
   - ✖ 실패는 사유를 오너에게 전하고, 원인을 고친 뒤 dry_run 부터 다시 한다.
   - 한 번에 한 채널을 권한다. 응답이 없거나 끊겨도 다시 게시하지 말고, 1~2분 뒤 status 로 확인한다. "결과 불명"이 계속되면 오너가 채널에서 직접 확인한 뒤에만 resolve_unknown 으로 기록한다.
   - 사진 여러 장(캐러셀)은 준비에 몇 분 걸릴 수 있다. 응답이 늦거나 status 가 아직 승인됨으로 보여도 다시 게시하지 말고 몇 분 뒤 status 로 확인한다.
   - 오너가 채널에서 확인한 뒤 resolve_unknown 으로 기록할 때, 게시물 주소는 오너에게 물어서 받는다.
7. 네이버(반자동, 자동 게시 금지):
   - naver_export 로 붙여 넣기용 원고(naver.md)를 만들어 열고, 제목과 태그 목록을 오너에게 보여 준다. 클립보드에는 복사하지 않는다.
   - 오너가 파일에서 칸별로 복사해 제목 → 본문을 붙여 넣고 소제목 서식을 입힌 뒤, 발행 설정 창의 「태그 편집」에 태그를 하나씩 입력하고 Enter 로 확정한 뒤 발행한다.
   - 오너가 알려 준 발행 주소를 mark_published 로 기록한다.
8. 마무리: status 로 채널별 상태를 보여 준다.

로그인·권한·토큰 오류가 나면 doctor 로 점검해 결과를 오너에게 보여 준다.
토큰·비밀번호를 묻거나 보여 주지 않는다. 로그인·권한 문제는 멈추고 오너에게 알린다.`

const REWRITE_HOOKS_PROCEDURE = (id: string, channels: string | undefined) => `작업 ${id} 의 SNS 초안에서 첫 문장(후킹)만 다시 써 주세요. 대상 채널: ${channels?.trim() ? channels : '게시 전인 모든 채널'}.

1. get_drafts(${id}) 로 현재 초안을 읽는다.
2. 대상 채널마다 첫 문장(후킹) 3안을 만든다. 계정 말투 메모와 아래 규칙을 지키고, 원문에 없는 사실·과장·낚시성 문구는 쓰지 않으며, 채널의 글자 수 제한 안에서 쓴다.
3. 채널별로 현재 첫 문장과 3안을 표로 보여 주고 오너가 고르게 한다.
4. 오너가 고른 안으로 첫 문장만 바꿔 save_drafts 로 저장한다. 내용이 바뀌면 승인이 풀리므로, 다시 오너 승인을 받은 뒤 approve 한다.
5. 이미 게시된 칸은 고치지 않는다.`

// 이 프롬프트는 config.json·rules 만 읽고 .env 는 읽지 않으므로 runTool(비밀 가리기)을 거치지 않는다.
export function registerPrompt(server: McpServer, opts: ServerOptions): void {
  server.registerPrompt(
    'draft_sns_posts',
    {
      title: '블로그 글로 SNS 초안 만들기',
      description: '블로그 글 주소 하나로 채널별 초안 작성 → 오너 승인 → 게시까지 진행하는 절차와 작성 규칙',
      argsSchema: z.object({ url: z.string().describe('블로그 글 주소') }),
    },
    async ({ url }) => {
      const config = await loadConfig(opts.root)
      const rules = loadRules({ channels: config.channels, notes: config.notes })
      const text = `블로그 글 ${url} 로 SNS 채널별 초안을 만들어 주세요.\n\n${MCP_PROCEDURE}\n\n---\n\n# 작성 규칙\n\n${rules}`
      return { messages: [{ role: 'user', content: { type: 'text', text } }] }
    },
  )

  server.registerPrompt(
    'rewrite_hooks',
    {
      title: '채널별 첫 문장(후킹) 다시 쓰기',
      description: '이미 만든 초안의 채널별 첫 문장 3안을 제안하고, 오너가 고른 안으로 고쳐 다시 승인받는 절차',
      argsSchema: z.object({
        id: z.string().describe('작업 이름'),
        channels: z.string().optional().describe('쉼표로 구분한 채널, 빼면 게시 전인 모든 채널'),
      }),
    },
    async ({ id, channels }) => {
      const config = await loadConfig(opts.root)
      const rules = loadRules({ channels: config.channels, notes: config.notes })
      const text = `${REWRITE_HOOKS_PROCEDURE(id, channels)}

---

# 작성 규칙

${rules}`
      return { messages: [{ role: 'user', content: { type: 'text', text } }] }
    },
  )
}
