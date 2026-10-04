import type { CallToolResult } from '@modelcontextprotocol/server'
import { loadEnv } from '../core/env.js'

/** 이보다 짧은 값은 가리지 않는다(관계없는 글까지 망가진다). */
const MIN_SECRET_LENGTH = 8

/** .env 의 토큰·시크릿 값 — ID(FB_PAGE_ID 등)는 게시물 주소에 들어가는 공개 값이라 빼 둔다. */
export function secretValues(root: string): string[] {
  const env = loadEnv(root)
  return Object.entries(env)
    .filter(([key, value]) => /_(TOKEN|SECRET)$/.test(key) && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value as string)
    .filter((value) => value.length >= MIN_SECRET_LENGTH)
}

export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(secret).join('***')
  return out
}

const TOOL_OF_COMMAND: Record<string, string> = {
  fetch: 'fetch_article',
  drafts: 'get_drafts',
  approve: 'approve',
  publish: 'publish',
  status: 'status',
  resolve: 'resolve_unknown',
  naver: 'naver_export',
  mark: 'mark_published',
}

/** core 문구의 CLI 명령 안내(`sns-relay approve ...`)를 MCP 도구 이름으로 바꾼다. */
export function toMcpWording(text: string): string {
  return text.replace(
    /`?sns-relay (fetch|drafts|approve|publish|status|resolve|naver|mark)\b(?: (?:--[\w-]+|<[^>]+>|[\w-]+(?=[ `])))*`?/g,
    (_m, cmd: string) => `\`${TOOL_OF_COMMAND[cmd]}\``,
  )
}

/** 구조화 결과의 모든 문자열 값에서 비밀을 가린다(직렬화 전에 값 단위로 — JSON 이스케이프에 안 걸리게). */
function scrubValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return scrubSecrets(toMcpWording(value), secrets)
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, secrets))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v, secrets)]))
  }
  return value
}

/**
 * 모든 MCP 도구는 이 함수를 지난다.
 * - 응답 글과 구조화 결과에서 비밀 값을 가린다(MCP 응답은 AI 에게 그대로 보인다).
 * - 예외는 isError 응답으로 바꾼다. SDK 에 맡기면 메시지가 가려지지 않은 채 나간다.
 */
export async function runTool(
  root: string,
  fn: () => Promise<{ summary: string; data: Record<string, unknown> }>,
): Promise<CallToolResult> {
  // SDK 의 입력 검증 오류는 runTool 에 오기 전에 난다. 가리지 않지만 AI 가 넣은 입력만 되풀이한다.
  let secrets: string[] = []
  try {
    secrets = secretValues(root)
    const { summary, data } = await fn()
    const data2 = scrubValue(data, secrets) as Record<string, unknown>
    return {
      content: [{ type: 'text', text: `${scrubSecrets(toMcpWording(summary), secrets)}\n\n${JSON.stringify(data2, null, 2)}` }],
      structuredContent: data2,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text', text: scrubSecrets(toMcpWording(message), secrets) }], isError: true }
  }
}
