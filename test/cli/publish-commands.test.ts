import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/program.js'
import { approveDrafts } from '../../src/core/approve.js'
import { cellKey, getCell, loadState, setCell, statePath, updateState } from '../../src/core/state.js'
import { CHANNEL_IDS } from '../../src/core/types.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { fakeJpeg } from '../jpeg-helpers.js'
import { installMockAgent, makeIo, makeTempDir } from '../helpers.js'
import { JSON_HEADERS, mockThreadsSuccess, noSleep, PERMALINK, THREADS_ORIGIN, TOKEN, UID } from '../threads-mock.js'

const ID = ARTICLE.id
let agent: MockAgent
let restore: () => Promise<void>
let root: string

beforeEach(async () => {
  ;({ agent, restore } = installMockAgent())
  root = makeTempDir()
  await setupDrafts(root)
  for (const ch of CHANNEL_IDS) writeBody(root, ID, ch, VALID_BODIES[ch])
  writeFileSync(join(root, '.env'), `THREADS_USER_ID=${UID}\nTHREADS_TOKEN=${TOKEN}\n`)
  await approveDrafts(root, ID, ['threads'])
})
afterEach(() => restore())

const run = async (args: string[]) => {
  const t = makeIo(root)
  const code = await runCli(args, { ...t.io, sleep: noSleep })
  return { code, out: t.out.join('\n'), err: t.err.join('\n') }
}

describe('publish', () => {
  it('--dry-run 은 미리보기만 보여 주고 0', async () => {
    const r = await run(['publish', ID, '--dry-run', '--channels', 'threads'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('[미리보기] threads')
    expect(r.out).toContain(VALID_BODIES.threads.split('\n')[0])
    expect(r.out).toContain('--channels <채널> 을 붙여 --dry-run 없이')
  })

  const IMG = 'https://blog.example.com'
  const serveImage = (body: Uint8Array, contentType: string) =>
    agent.get(IMG).intercept({ path: '/images/cover.jpg', method: 'GET' }).reply(200, Buffer.from(body), { headers: { 'content-type': contentType } })

  it('--dry-run 인스타: 이미지 확인 통과, 링크 표기, 안내 문구, 0', async () => {
    await approveDrafts(root, ID, ['instagram'])
    serveImage(fakeJpeg(1376, 768), 'image/jpeg')
    const r = await run(['publish', ID, '--dry-run', '--channels', 'instagram'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('✔ 게시 전 확인 통과')
    expect(r.out).toContain('(인스타 본문에는 붙지 않음)')
    expect(r.out).toContain('--channels <채널> 을 붙여 --dry-run 없이')
  })

  it('--dry-run 인스타: 이미지가 WebP 면 ✖ 와 1, 안내 문구 없음', async () => {
    await approveDrafts(root, ID, ['instagram'])
    serveImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'image/webp')
    const r = await run(['publish', ID, '--dry-run', '--channels', 'instagram'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('✖')
    expect(r.out).not.toContain('--dry-run 없이')
  })

  it('게시하면 주소를 출력하고 0, 토큰은 어디에도 없다', async () => {
    mockThreadsSuccess(agent)
    const r = await run(['publish', ID, '--channels', 'threads'])
    expect(r.code).toBe(0)
    expect(r.out).toContain(`✔ threads 게시됨 ${PERMALINK}`)
    expect(r.err).toContain('약 30초')
    expect(r.out + r.err).not.toContain(TOKEN)
  })

  it('막힌 채널이 있으면 1', async () => {
    const r = await run(['publish', ID, '--channels', 'instagram'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('✖ instagram 게시 안 함 — ')
  })

  it('게시 뒤 기록이 거절되면 주소와 경고를 함께 보이고 1', async () => {
    const hash = getCell(await loadState(root), ID, 'threads')!.hash
    const pool = agent.get(THREADS_ORIGIN)
    pool.intercept({ path: `/v1.0/${UID}/threads`, method: 'POST' }).reply(200, { id: 'c1' }, JSON_HEADERS)
    pool.intercept({ path: (p) => p.startsWith('/v1.0/c1?'), method: 'GET' }).reply(200, { status: 'FINISHED' }, JSON_HEADERS)
    pool
      .intercept({ path: `/v1.0/${UID}/threads_publish`, method: 'POST' })
      .reply(() => {
        const path = statePath(root)
        const st = JSON.parse(readFileSync(path, 'utf8'))
        st[cellKey(ID, 'threads')] = { status: 'published', hash, postId: 'owner', postUrl: 'https://www.threads.net/@x/post/OWNER', updatedAt: '2030-01-01T00:00:00.000Z' }
        writeFileSync(path, JSON.stringify(st))
        return { statusCode: 200, data: { id: 'm1' }, responseOptions: { headers: JSON_HEADERS } }
      })
    pool.intercept({ path: (p) => p.startsWith('/v1.0/m1?'), method: 'GET' }).reply(200, { id: 'm1', permalink: PERMALINK }, JSON_HEADERS)
    const r = await run(['publish', ID, '--channels', 'threads'])
    expect(r.code).toBe(1)
    expect(r.out).toContain(PERMALINK)
    expect(r.out).toContain('기록하지 않았습니다')
  })

  it('게시할 채널이 없으면 안내하고 1', async () => {
    const cfgPath = join(root, 'config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    cfg.channels = ['naver']
    writeFileSync(cfgPath, JSON.stringify(cfg))
    const r = await run(['publish', ID, '--dry-run'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('게시할 채널이 없습니다')
  })

  it('실제 게시는 --channels 가 필요하다', async () => {
    const r = await run(['publish', ID])
    expect(r.code).toBe(1)
    expect(r.err).toContain('--channels 로 올릴 채널을 지정하세요')
  })

  it('빈 --channels 는 거부', async () => {
    const r = await run(['publish', ID, '--channels', ''])
    expect(r.code).toBe(1)
    expect(r.err).toContain('채널을 하나 이상 지정하세요')
  })
})

describe('status', () => {
  it('글 × 채널 상태를 보여 준다', async () => {
    const r = await run(['status'])
    expect(r.code).toBe(0)
    expect(r.out).toContain(`${ID} — ${ARTICLE.title}`)
    expect(r.out).toMatch(/threads\s+승인됨/)
    expect(r.out).toMatch(/instagram\s+미승인/)
  })

  it('작업이 없으면 안내', async () => {
    const t = makeIo(makeTempDir())
    expect(await runCli(['status'], t.io)).toBe(0)
    expect(t.out.join('\n')).toContain('작업이 없습니다')
  })
})

describe('resolve', () => {
  beforeEach(async () => {
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'unknown', hash: 'h' }, new Date())
    })
  })

  it('--published <url> 로 확정', async () => {
    const r = await run(['resolve', ID, 'threads', '--published', PERMALINK])
    expect(r.code).toBe(0)
    expect(r.out).toContain('published')
    expect((await run(['status', ID])).out).toContain(`게시됨  ${PERMALINK}`)
  })

  it('둘 다 주거나 둘 다 없으면 1', async () => {
    expect((await run(['resolve', ID, 'threads'])).code).toBe(1)
    expect((await run(['resolve', ID, 'threads', '--published', PERMALINK, '--not-published'])).code).toBe(1)
  })
})
