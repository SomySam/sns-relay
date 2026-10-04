import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { runCli } from '../src/cli/program.js'
import { makeIo } from './helpers.js'

const skill = readFileSync(new URL('../skill/sns-relay/SKILL.md', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

describe('SKILL.md', () => {
  it('frontmatter 에 name 과 description 이 있다', () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---\n/)
    expect(fm).not.toBeNull()
    const meta = parseYaml(fm![1])
    expect(meta.name).toBe('sns-relay')
    expect(String(meta.description).length).toBeGreaterThan(50)
    expect(String(meta.description).length).toBeLessThanOrEqual(1024)
  })

  it('스킬이 부르는 명령은 모두 CLI 에 있다', async () => {
    const used = [...new Set([...skill.matchAll(/sns-relay (\w+)/g)].map((m) => m[1]))]
    expect(used.length).toBeGreaterThan(0)
    const t = makeIo()
    await runCli(['--help'], t.io)
    const help = t.out.join('\n')
    for (const cmd of used) expect(help, `sns-relay ${cmd}`).toContain(cmd)
  })

  it('승인은 오너 확인 뒤에만 한다고 적혀 있다', () => {
    expect(skill).toContain('오너')
    expect(skill).toContain('sns-relay approve')
  })
})
