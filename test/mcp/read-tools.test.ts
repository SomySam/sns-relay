import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { initWorkspace } from '../../src/core/config.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'
import { runTool } from '../../src/mcp/result.js'
import { connect } from '../mcp-helpers.js'

const ID = ARTICLE.id
let root: string
let mcp: Awaited<ReturnType<typeof connect>>

beforeEach(async () => {
  root = makeTempDir()
})
afterEach(async () => {
  await mcp?.close()
})

describe('status', () => {
  it('작업이 없으면 안내한다', async () => {
    await initWorkspace(root)
    mcp = await connect(root)
    const r = await mcp.call('status')
    expect(r.isError).toBe(false)
    expect(r.text).toContain('작업한 글이 없습니다')
    expect(r.data.articles).toEqual([])
  })

  it('글 × 채널 상태를 돌려준다', async () => {
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await approveDrafts(root, ID, ['threads'])
    mcp = await connect(root)
    const r = await mcp.call('status', { id: ID })
    expect(r.data.articles[0].cells).toHaveLength(4)
    expect(r.data.articles[0].cells[0]).toEqual({ channel: 'threads', label: '승인됨' })
    expect(r.text).toContain('threads 승인됨')
  })

  it('잘못된 작업 이름은 오류', async () => {
    await initWorkspace(root)
    mcp = await connect(root)
    const r = await mcp.call('status', { id: '../밖' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('작업 이름은')
  })
})

describe('get_drafts', () => {
  it('본문·검증 결과·승인 여부를 돌려준다', async () => {
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await approveDrafts(root, ID, ['threads'])
    mcp = await connect(root)
    const r = await mcp.call('get_drafts', { id: ID })
    expect(r.isError).toBe(false)
    const threads = r.data.drafts.find((d: { channel: string }) => d.channel === 'threads')
    expect(threads.approved).toBe(true)
    expect(threads.body).toBe(VALID_BODIES.threads)
    expect(threads.link).toContain('utm_source=threads')
    const naver = r.data.drafts.find((d: { channel: string }) => d.channel === 'naver')
    expect(naver.approved).toBe(false)
    expect(naver.title).toBe(ARTICLE.title)
    expect(naver.tags).toEqual([])
    expect(r.text).toContain('threads')
  })

  it('없는 작업은 오류', async () => {
    await initWorkspace(root)
    mcp = await connect(root)
    const r = await mcp.call('get_drafts', { id: 'no-such' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('이 없습니다')
    expect(r.text).toContain('`fetch_article`')
    expect(r.text).not.toContain('sns-relay fetch')
  })
})

describe('비밀 가리기', () => {
  it('토큰 값은 응답 어디에도 나오지 않고, ID 값은 그대로 둔다', async () => {
    await setupDrafts(root)
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=SECRETVALUE123\nFB_PAGE_ID=1334\n')
    writeBody(root, ID, 'threads', '토큰 SECRETVALUE123 과 페이지 1334')
    mcp = await connect(root)
    const r = await mcp.call('get_drafts', { id: ID })
    expect(r.text).not.toContain('SECRETVALUE123')
    expect(JSON.stringify(r.data)).not.toContain('SECRETVALUE123')
    expect(r.text).toContain('***')
    expect(r.text).toContain('1334')
  })

  it('오류 메시지에서도 가린다', async () => {
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=SECRETVALUE123\n')
    const r = await runTool(root, async () => {
      throw new Error('실패 SECRETVALUE123')
    })
    expect(r.isError).toBe(true)
    const text = (r.content[0] as { text: string }).text
    expect(text).toContain('***')
    expect(text).not.toContain('SECRETVALUE123')
  })

  it('중첩된 구조화 결과도 가린다', async () => {
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=SECRETVALUE123\n')
    const r = await runTool(root, async () => ({ summary: '요약', data: { nested: { list: ['x SECRETVALUE123'] } } }))
    expect(JSON.stringify(r.structuredContent)).not.toContain('SECRETVALUE123')
    expect(JSON.stringify(r.structuredContent)).toContain('x ***')
  })

  it('META_APP_SECRET 도 가린다', async () => {
    await setupDrafts(root)
    writeFileSync(join(root, '.env'), 'META_APP_SECRET=APPSECRET98765\n')
    writeBody(root, ID, 'threads', '시크릿 APPSECRET98765')
    mcp = await connect(root)
    const r = await mcp.call('get_drafts', { id: ID })
    expect(r.text).not.toContain('APPSECRET98765')
    expect(JSON.stringify(r.data)).not.toContain('APPSECRET98765')
  })

  it('큰따옴표가 든 비밀도 텍스트·구조화 결과에서 가린다', async () => {
    await setupDrafts(root)
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=abc"def12345\n')
    writeBody(root, ID, 'threads', '토큰 abc"def12345 끝')
    mcp = await connect(root)
    const r = await mcp.call('get_drafts', { id: ID })
    expect(r.text).not.toContain('def12345')
    expect(JSON.stringify(r.data)).not.toContain('def12345')
    expect(r.text).toContain('***')
  })

  it('8자보다 짧은 값은 가리지 않는다', async () => {
    await setupDrafts(root)
    writeFileSync(join(root, '.env'), 'FB_PAGE_TOKEN=ab123\n')
    writeBody(root, ID, 'threads', '값 ab123 그대로')
    mcp = await connect(root)
    const r = await mcp.call('get_drafts', { id: ID })
    expect(r.text).toContain('ab123')
  })
})

describe('doctor', () => {
  it('점검 결과를 돌려주고 토큰 값은 싣지 않는다', async () => {
    await initWorkspace(root)
    const { loadConfig } = await import('../../src/core/config.js')
    const config = await loadConfig(root)
    writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, channels: ['naver'] }, null, 2))
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=SECRETVALUE123\n')
    mcp = await connect(root)
    const r = await mcp.call('doctor')
    expect(r.isError).toBe(false)
    expect(r.data.reports).toEqual([{ channel: 'naver', level: 'skip', messages: ['수동 발행 채널 — 점검할 토큰이 없습니다.'] }])
    expect(r.text).not.toContain('SECRETVALUE123')
  })
})
