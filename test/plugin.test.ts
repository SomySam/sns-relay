import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))
const pkg = read('package.json')

describe('Claude Code 플러그인', () => {
  it('plugin.json — 이름·버전이 package.json 과 같고 스킬 폴더를 가리킨다', () => {
    const plugin = read('.claude-plugin/plugin.json')
    expect(plugin.name).toBe('sns-relay')
    expect(plugin.version).toBe(pkg.version)
    expect(plugin.skills).toEqual(['./skill/'])
    expect(existsSync(new URL('../skill/sns-relay/SKILL.md', import.meta.url))).toBe(true)
  })

  it('marketplace.json — 저장소 자체를 플러그인으로 싣는다', () => {
    const market = read('.claude-plugin/marketplace.json')
    expect(market.name).toBe('sns-relay')
    expect(market.owner.name).toBe('SomySam')
    expect(market.plugins).toEqual([expect.objectContaining({ name: 'sns-relay', source: './', version: pkg.version })])
  })

  it('루트 .mcp.json 이 없고 plugin.json 이 실행기로 MCP 를 띄운다', () => {
    expect(existsSync(new URL('../.mcp.json', import.meta.url))).toBe(false)
    const plugin = read('.claude-plugin/plugin.json')
    expect(plugin.mcpServers).toEqual({
      'sns-relay': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/plugin/mcp-launcher.mjs', 'mcp'] },
    })
    expect(existsSync(new URL('../plugin/mcp-launcher.mjs', import.meta.url))).toBe(true)
    expect(pkg.files).toContain('plugin')
    expect(pkg.files).not.toContain('.mcp.json')
  })
})
