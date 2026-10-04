import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const launcher = fileURLToPath(new URL('../plugin/mcp-launcher.mjs', import.meta.url))
const tmp = () => mkdtempSync(join(tmpdir(), 'launcher-'))

describe('plugin/mcp-launcher.mjs', () => {
  it('설치가 없으면 안내를 stderr 로만 내고 1 로 끝난다', () => {
    const a = tmp()
    const b = tmp()
    try {
      const r = spawnSync(process.execPath, [launcher, '--version'], {
        encoding: 'utf8',
        env: { PATH: a, npm_config_prefix: b, SystemRoot: process.env.SystemRoot ?? '' },
      })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('설치되어 있지 않습니다')
      expect(r.stdout).toBe('')
    } finally {
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
    }
  })

  it('npm_config_prefix 아래 설치된 CLI 를 찾아 인자를 넘겨 실행한다', () => {
    const prefix = tmp()
    const empty = tmp()
    try {
      const dir = join(prefix, 'node_modules', 'sns-relay', 'dist', 'cli')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.js'), "process.stdout.write('FAKE ' + process.argv.slice(2).join(' '))\n")
      const r = spawnSync(process.execPath, [launcher, 'mcp'], {
        encoding: 'utf8',
        env: { PATH: empty, npm_config_prefix: prefix, SystemRoot: process.env.SystemRoot ?? '' },
      })
      expect(r.stdout).toBe('FAKE mcp')
      expect(r.status).toBe(0)
    } finally {
      rmSync(prefix, { recursive: true, force: true })
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
