import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Io } from '../src/cli/program.js'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'

export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sns-relay-'))
}

export function makeIo(cwd: string = process.cwd()): { io: Io; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s), cwd }, out, err }
}

/** 전역 fetch 를 가로챈다. 등록하지 않은 요청은 실패한다(실제 네트워크 차단). */
export function installMockAgent(): { agent: MockAgent; restore(): Promise<void> } {
  const original = getGlobalDispatcher()
  const agent = new MockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  return {
    agent,
    async restore() {
      setGlobalDispatcher(original)
      await agent.close()
    },
  }
}
