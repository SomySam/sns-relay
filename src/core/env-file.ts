import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EnvKey } from './env.js'
import { writeFileAtomic } from './fs.js'

/**
 * .env 에서 지정한 키의 줄만 바꾼다(없으면 끝에 덧붙인다). 주석·다른 줄·순서·줄바꿈 방식(CRLF/LF)은 그대로 둔다.
 * 값은 호출한 쪽이 화면에 내지 않는다 — 이 함수도 오류 메시지에 값을 싣지 않는다.
 */
export async function updateEnvFile(root: string, updates: Partial<Record<EnvKey, string>>): Promise<void> {
  const path = join(root, '.env')
  if (!existsSync(path)) throw new Error(`.env 가 없습니다 (${root}). 먼저 sns-relay init 을 실행하세요.`)
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && /[\r\n]/.test(value)) throw new Error(`${key} 값에 줄바꿈이 있어 쓸 수 없습니다.`)
  }
  const text = await readFile(path, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const remaining = new Map(Object.entries(updates).filter(([, v]) => v !== undefined) as [string, string][])
  const LINE = /^\s*(?:(export)\s+)?([A-Z0-9_]+)\s*=/
  // 같은 키가 여러 줄이면 마지막 줄만 새 값으로 쓰고(parseEnv 가 마지막 값을 쓴다), 앞 줄은 값 없는 주석으로 바꾼다.
  const lastIndex = new Map<string, number>()
  lines.forEach((line, i) => {
    const m = line.match(LINE)
    if (m && remaining.has(m[2])) lastIndex.set(m[2], i)
  })
  const written = new Set<string>()
  const out = lines.map((line, i) => {
    const m = line.match(LINE)
    if (!m || !remaining.has(m[2])) return line
    const key = m[2]
    if (lastIndex.get(key) !== i) return `# (sns-relay: 아래 줄로 대체됨) ${key}=***`
    written.add(key)
    return `${m[1] ? 'export ' : ''}${key}=${remaining.get(key)!}`
  })
  for (const [key, value] of remaining) if (!written.has(key)) out.push(`${key}=${value}`)
  await writeFileAtomic(path, out.join(eol) + eol)
}
