import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCell, loadState } from '../../src/core/state.js'
import { CHANNEL_IDS } from '../../src/core/types.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { installMockAgent, makeTempDir } from '../helpers.js'
import { connect } from '../mcp-helpers.js'
import { mockThreadsSuccess, noSleep, PERMALINK, TOKEN, UID } from '../threads-mock.js'

const ID = ARTICLE.id
let agent: MockAgent
let restore: () => Promise<void>
let root: string
let mcp: Awaited<ReturnType<typeof connect>>

beforeEach(async () => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  await setupDrafts(root)
  for (const ch of CHANNEL_IDS) writeBody(root, ID, ch, VALID_BODIES[ch])
  writeFileSync(join(root, '.env'), `THREADS_USER_ID=${UID}\nTHREADS_TOKEN=${TOKEN}\n`)
  mcp = await connect(root, { sleep: noSleep })
})
afterEach(async () => {
  await mcp.close()
  await restore()
})

describe('approve', () => {
  it('channels 가 필수다', async () => {
    expect((await mcp.call('approve', { id: ID })).isError).toBe(true)
    expect((await mcp.call('approve', { id: ID, channels: [] })).isError).toBe(true)
  })

  it('지정한 채널만 승인한다', async () => {
    const r = await mcp.call('approve', { id: ID, channels: ['threads'] })
    expect(r.isError).toBe(false)
    expect(r.data.results.map((x: { channel: string; approved: boolean }) => [x.channel, x.approved])).toEqual([['threads', true]])
    expect(r.text).toContain('threads 승인')
  })
})

describe('publish', () => {
  it('channels 가 필수다', async () => {
    expect((await mcp.call('publish', { id: ID, dry_run: true })).isError).toBe(true)
  })

  it('dry-run 없이(토큰 없이) 실제 게시는 거부한다', async () => {
    await mcp.call('approve', { id: ID, channels: ['threads'] })
    const r = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: false })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('dry_run')
    expect((await loadState(root))[`${ID}:threads`]?.status).toBe('approved')
  })

  it('dry-run 은 미리보기와 확인 토큰을 준다', async () => {
    await mcp.call('approve', { id: ID, channels: ['threads'] })
    const r = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: true })
    expect(r.isError).toBe(false)
    expect(r.data.confirm_token).toMatch(/^[0-9a-f]{12}$/)
    expect(r.data.reports[0].outcome).toBe('dry-run')
    expect(r.data.reports[0].preview.body).toBe(VALID_BODIES.threads)
  })

  it('승인 안 된 채널이 섞이면 토큰이 없다', async () => {
    await mcp.call('approve', { id: ID, channels: ['threads'] })
    const r = await mcp.call('publish', { id: ID, channels: ['threads', 'facebook'], dry_run: true })
    expect(r.data.confirm_token).toBeNull()
    expect(r.text).toContain('facebook')
  })

  it('토큰이 틀리면 거부한다', async () => {
    await mcp.call('approve', { id: ID, channels: ['threads'] })
    await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: true })
    const r = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: false, confirm_token: '000000000000' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('다시 dry_run')
  })

  it('dry-run 뒤 초안이 바뀌면 토큰이 맞지 않는다', async () => {
    await mcp.call('approve', { id: ID, channels: ['threads'] })
    const dry = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: true })
    writeBody(root, ID, 'threads', VALID_BODIES.threads + '\n\n덧붙임')
    const r = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: false, confirm_token: dry.data.confirm_token })
    expect(r.isError).toBe(true)
  })

  it('맞는 토큰이면 게시하고, 같은 토큰으로 두 번은 안 된다', async () => {
    mockThreadsSuccess(agent)
    await mcp.call('approve', { id: ID, channels: ['threads'] })
    const dry = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: true })
    const r = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: false, confirm_token: dry.data.confirm_token })
    expect(r.isError).toBe(false)
    expect(r.data.reports[0]).toMatchObject({ channel: 'threads', outcome: 'published', postUrl: PERMALINK })
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('published')
    expect(r.text).not.toContain(TOKEN)
    const again = await mcp.call('publish', { id: ID, channels: ['threads'], dry_run: false, confirm_token: dry.data.confirm_token })
    expect(again.isError).toBe(true)
  })
})
