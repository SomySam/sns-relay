import { describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/program.js'
import { makeIo, makeTempDir } from '../helpers.js'

describe('mcp 명령', () => {
  it('--dir 도 SNS_RELAY_DIR 도 없으면 1, stdout 에는 아무것도 쓰지 않는다', async () => {
    const t = makeIo(makeTempDir())
    const code = await runCli(['mcp'], { ...t.io, env: {} })
    expect(code).not.toBe(0)
    expect(t.out).toEqual([])
    expect(t.err.join('\n')).toContain('SNS_RELAY_DIR')
  })

  it('SNS_RELAY_DIR 가 config.json 없는 폴더면 1', async () => {
    const empty = makeTempDir()
    const t = makeIo(makeTempDir())
    const code = await runCli(['mcp'], { ...t.io, env: { SNS_RELAY_DIR: empty } })
    expect(code).toBe(1)
    expect(t.out).toEqual([])
    expect(t.err.join('\n')).toContain('config.json 이 없습니다')
  })

  it('config.json 이 없는 폴더는 서버를 띄우지 않고 1 로 끝난다', async () => {
    const dir = makeTempDir()
    const t = makeIo(makeTempDir())
    expect(await runCli(['mcp', '--dir', dir], t.io)).toBe(1)
    expect(t.err.join('\n')).toContain('config.json 이 없습니다')
    expect(t.out).toEqual([])
  })
})
