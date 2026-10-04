import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { describe, expect, it } from 'vitest'
import { initWorkspace } from '../../src/core/config.js'
import { makeTempDir } from '../helpers.js'

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url))

describe.skipIf(!existsSync(CLI))('sns-relay mcp (stdio)', () => {
  it('stdout 에 MCP 메시지만 쓰고 도구 목록에 답한다', async () => {
    const root = makeTempDir()
    await initWorkspace(root)
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', '--dir', root], stderr: 'pipe' })
    const client = new Client({ name: 'stdio-test', version: '0.0.0' })
    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.length).toBe(12)
    const r = await client.callTool({ name: 'status', arguments: {} })
    expect(JSON.stringify(r.content)).toContain('작업한 글이 없습니다')
    await client.close()
  }, 20_000)
})
