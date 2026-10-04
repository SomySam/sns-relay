import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from './fs.js'
import type { CellState, ChannelId } from './types.js'

export type State = Record<string, CellState>

const CellSchema = z.object({
  status: z.enum(['draft', 'approved', 'published', 'unknown', 'failed', 'skipped', 'manual']),
  hash: z.string().optional(),
  postUrl: z.string().optional(),
  postId: z.string().optional(),
  reason: z.string().optional(),
  updatedAt: z.string(),
})

const StateSchema = z.record(z.string(), CellSchema)

export function statePath(root: string): string {
  return join(root, 'work', 'state.json')
}

export function cellKey(id: string, channel: ChannelId): string {
  return `${id}:${channel}`
}

export async function loadState(root: string): Promise<State> {
  const path = statePath(root)
  if (!existsSync(path)) return {}
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`state.json 형식 오류 (${path}): JSON 을 읽을 수 없습니다.`)
  }
  const parsed = StateSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`state.json 형식 오류 (${path}):\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export async function saveState(root: string, state: State): Promise<void> {
  const path = statePath(root)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n')
}

export function getCell(state: State, id: string, channel: ChannelId): CellState | undefined {
  return state[cellKey(id, channel)]
}

export function setCell(
  state: State,
  id: string,
  channel: ChannelId,
  cell: Omit<CellState, 'updatedAt'>,
  now: Date,
): CellState {
  const next: CellState = { ...cell, updatedAt: now.toISOString() }
  state[cellKey(id, channel)] = next
  return next
}

const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 40_000
const STALE_LOCK_MS = 30_000

/** state.json 을 잠그고 새로 읽어 바꾼 뒤 저장한다. state 변경은 모두 이 함수로 한다. */
export async function updateState<T>(root: string, fn: (state: State) => T | Promise<T>): Promise<T> {
  const path = statePath(root)
  await mkdir(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  await acquireLock(lock)
  try {
    const state = await loadState(root)
    const result = await fn(state)
    await saveState(root, state)
    return result
  } finally {
    await rm(lock, { force: true })
  }
}

async function acquireLock(lock: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    try {
      const handle = await open(lock, 'wx')
      await handle.close()
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      // EPERM: Windows 에서 지워지는 중인 잠금 파일을 열 때도 난다.
      if (code !== 'EEXIST' && code !== 'EPERM') throw e
      const modified = await stat(lock).then((s) => s.mtimeMs, () => Date.now())
      if (Date.now() - modified > STALE_LOCK_MS) {
        await rm(lock, { force: true })
        continue
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error(`state.json 을 다른 작업이 쓰고 있습니다. 잠시 뒤 다시 실행하세요. 계속되면 ${lock} 을 지우세요.`)
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}
