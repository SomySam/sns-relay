import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace, loadConfig } from '../../src/core/config.js'
import { makeTempDir } from '../helpers.js'
import { connect } from '../mcp-helpers.js'

let root: string
let mcp: Awaited<ReturnType<typeof connect>>
beforeEach(async () => {
  root = makeTempDir()
  await initWorkspace(root)
})
afterEach(async () => {
  await mcp.close()
})

describe('도구·프롬프트 목록', () => {
  it('도구 10개와 프롬프트 2개', async () => {
    mcp = await connect(root)
    const tools = (await mcp.client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual(
      ['approve', 'create_from_notes', 'rehost_image', 'fetch_article', 'get_drafts', 'mark_published', 'naver_export', 'publish', 'doctor', 'resolve_unknown', 'save_drafts', 'status'].sort(),
    )
    const prompts = (await mcp.client.listPrompts()).prompts.map((p) => p.name)
    expect([...prompts].sort()).toEqual(['draft_sns_posts', 'rewrite_hooks'])
  })
})

describe('draft_sns_posts', () => {
  it('주소·절차·규칙·계정 말투 메모를 싣는다', async () => {
    const config = await loadConfig(root)
    writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, notes: { common: '짧은 호흡으로 쓴다' } }, null, 2))
    mcp = await connect(root)
    const r = await mcp.client.getPrompt({ name: 'draft_sns_posts', arguments: { url: 'https://blog.example.com/blog/x' } })
    const text = r.messages.map((m) => (m.content as { type: string; text: string }).text).join('\n')
    expect(text).toContain('https://blog.example.com/blog/x')
    expect(text).toContain('fetch_article')
    expect(text).toContain('confirm_token')
    expect(text).toContain('판매 문구를 쓰지 않는다')
    expect(text).toContain('짧은 호흡으로 쓴다')
  })
})

describe('rewrite_hooks', () => {
  const textOf = (r: { messages: { content: unknown }[] }) =>
    r.messages.map((m) => (m.content as { type: string; text: string }).text).join('\n')

  it('작업 이름·절차·규칙을 싣는다', async () => {
    mcp = await connect(root)
    const text = textOf(await mcp.client.getPrompt({ name: 'rewrite_hooks', arguments: { id: 'my-post' } }))
    expect(text).toContain('my-post')
    expect(text).toContain('get_drafts')
    expect(text).toContain('save_drafts')
    expect(text).toContain('3안')
    expect(text).toContain('판매 문구를 쓰지 않는다')
  })

  it('channels 를 주면 대상 채널을 밝힌다', async () => {
    mcp = await connect(root)
    const text = textOf(await mcp.client.getPrompt({ name: 'rewrite_hooks', arguments: { id: 'my-post', channels: 'threads,facebook' } }))
    expect(text).toContain('threads,facebook')
  })
})
