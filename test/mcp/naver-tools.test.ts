import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { getCell, loadState, setCell, updateState } from '../../src/core/state.js'
import { ARTICLE, setupDrafts, VALID_BODIES, VALID_TAGS, writeBody, writeTags } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'
import { connect } from '../mcp-helpers.js'

const ID = ARTICLE.id
let root: string
let mcp: Awaited<ReturnType<typeof connect>>
let opened: string[]

beforeEach(async () => {
  root = makeTempDir()
  await setupDrafts(root)
  writeBody(root, ID, 'naver', VALID_BODIES.naver)
  writeTags(root, ID, VALID_TAGS)
  opened = []
  mcp = await connect(root, { openFile: async (p) => void opened.push(p) })
})
afterEach(async () => {
  await mcp.close()
})

describe('naver_export', () => {
  it('승인 전에는 오류', async () => {
    const r = await mcp.call('naver_export', { id: ID })
    expect(r.isError).toBe(true)
  })

  it('원고를 만들어 열고 제목·본문·태그를 돌려주며 수동 발행 대기로 둔다', async () => {
    await approveDrafts(root, ID, ['naver'])
    const r = await mcp.call('naver_export', { id: ID })
    expect(r.isError).toBe(false)
    expect(r.data.title).toBe(ARTICLE.title)
    expect(r.data.text).toContain('원문: https://blog.example.com/blog/ai-task-brief?utm_source=naver')
    expect(r.data.tags).toEqual(VALID_TAGS)
    expect(r.data.subheadings).toEqual(['왜 브리프가 필요한가', '세 가지 요소'])
    expect(r.data.opened).toBe(true)
    expect(opened).toEqual([r.data.path])
    expect(r.data.path.endsWith('naver.md')).toBe(true)
    expect(r.text).toContain('하나씩')
    expect(r.text).toContain('원고 파일을 열었습니다')
    expect(r.text).toContain('mark_published')
    expect(getCell(await loadState(root), ID, 'naver')?.status).toBe('manual')
  })

  it('open: false 이면 열지 않는다', async () => {
    await approveDrafts(root, ID, ['naver'])
    const r = await mcp.call('naver_export', { id: ID, open: false })
    expect(r.isError).toBe(false)
    expect(r.data.opened).toBe(false)
    expect(opened).toEqual([])
  })

  it('열기에 실패해도 원고는 남고 opened false 로 알린다', async () => {
    await mcp.close()
    mcp = await connect(root, {
      openFile: async () => {
        throw new Error('no app')
      },
    })
    await approveDrafts(root, ID, ['naver'])
    const r = await mcp.call('naver_export', { id: ID })
    expect(r.isError).toBe(false)
    expect(r.data.opened).toBe(false)
    expect(r.text).toContain('열지 못했습니다(no app)')
  })
})

describe('mark_published', () => {
  it('수동 발행 대기 칸에 주소를 기록한다', async () => {
    await approveDrafts(root, ID, ['naver'])
    await mcp.call('naver_export', { id: ID })
    const r = await mcp.call('mark_published', { id: ID, channel: 'naver', url: 'https://blog.naver.com/myinsta/1' })
    expect(r.isError).toBe(false)
    expect(getCell(await loadState(root), ID, 'naver')).toMatchObject({ status: 'published', postUrl: 'https://blog.naver.com/myinsta/1' })
  })

  it('수동 발행 대기가 아니면 오류', async () => {
    const r = await mcp.call('mark_published', { id: ID, channel: 'naver', url: 'https://blog.naver.com/myinsta/1' })
    expect(r.isError).toBe(true)
  })
})

describe('resolve_unknown', () => {
  beforeEach(async () => {
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'unknown', hash: 'h', reason: '응답 없음' }, new Date())
    })
  })

  it('게시됨으로 확정하려면 주소가 필요하다', async () => {
    const r = await mcp.call('resolve_unknown', { id: ID, channel: 'threads', result: 'published' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('post_url')
  })

  it('게시됨으로 확정한다', async () => {
    const r = await mcp.call('resolve_unknown', { id: ID, channel: 'threads', result: 'published', post_url: 'https://www.threads.com/@a/post/1' })
    expect(r.isError).toBe(false)
    expect(getCell(await loadState(root), ID, 'threads')).toMatchObject({ status: 'published', postUrl: 'https://www.threads.com/@a/post/1' })
  })

  it('게시되지 않음으로 확정한다', async () => {
    const r = await mcp.call('resolve_unknown', { id: ID, channel: 'threads', result: 'not_published' })
    expect(r.isError).toBe(false)
    expect(getCell(await loadState(root), ID, 'threads')?.status).not.toBe('unknown')
  })
})
