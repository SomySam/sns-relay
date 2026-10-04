import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { draftPath, readDrafts } from '../../src/core/draft-files.js'
import { hashDraft, parseDraft } from '../../src/core/drafts.js'
import { markPublished } from '../../src/core/mark.js'
import { exportNaver } from '../../src/core/naver.js'
import { getCell, loadState, saveState, setCell } from '../../src/core/state.js'
import { CHANNEL_IDS } from '../../src/core/types.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'

const ID = ARTICLE.id
const NOW = () => new Date('2026-09-29T03:00:00Z')

async function filledWorkspace(): Promise<string> {
  const root = makeTempDir()
  await setupDrafts(root)
  for (const ch of CHANNEL_IDS) writeBody(root, ID, ch, VALID_BODIES[ch])
  return root
}

describe('approveDrafts', () => {
  it('검증을 통과한 초안을 모두 승인한다 (네이버는 경고가 있어도 승인)', async () => {
    const root = await filledWorkspace()
    const results = await approveDrafts(root, ID, undefined, NOW)
    expect(results.map((r) => [r.channel, r.approved])).toEqual([
      ['threads', true],
      ['instagram', true],
      ['facebook', true],
      ['naver', true],
    ])
    expect(results.find((r) => r.channel === 'naver')!.problems.map((p) => p.level)).toEqual(['warn', 'warn', 'warn']) // 짧은 본문 + 원문 제목 그대로 + 태그 없음

    const draft = parseDraft(readFileSync(draftPath(root, ID, 'threads'), 'utf8'), 'threads')
    expect(draft.approved).toBe(true)
    expect(getCell(await loadState(root), ID, 'threads')).toEqual({
      status: 'approved',
      hash: hashDraft(draft),
      updatedAt: '2026-09-29T03:00:00.000Z',
    })
    expect((await readDrafts(root, ID, NOW)).views.every((v) => v.approved)).toBe(true)
  })

  it('오류가 있는 초안은 승인하지 않는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root) // 본문이 비어 있다
    const [threads] = await approveDrafts(root, ID, ['threads'], NOW)
    expect(threads.approved).toBe(false)
    expect(threads.problems.map((p) => p.message)).toContain('본문이 비어 있습니다.')
    expect(parseDraft(readFileSync(draftPath(root, ID, 'threads'), 'utf8'), 'threads').approved).toBe(false)
    expect(getCell(await loadState(root), ID, 'threads')).toBeUndefined()
  })

  it('지정한 채널만 승인한다', async () => {
    const root = await filledWorkspace()
    const results = await approveDrafts(root, ID, ['facebook'], NOW)
    expect(results.map((r) => r.channel)).toEqual(['facebook'])
    const { views } = await readDrafts(root, ID, NOW)
    expect(views.filter((v) => v.approved).map((v) => v.channel)).toEqual(['facebook'])
  })

  it('승인 뒤 본문을 고치면 다시 미승인', async () => {
    const root = await filledWorkspace()
    await approveDrafts(root, ID, ['threads'], NOW)
    writeBody(root, ID, 'threads', VALID_BODIES.threads + '!')
    const { views } = await readDrafts(root, ID, NOW)
    expect(views[0].approved).toBe(false)
  })

  it('이미 게시된 칸은 다시 승인하지 않는다', async () => {
    const root = await filledWorkspace()
    const state = await loadState(root)
    setCell(state, ID, 'threads', { status: 'published', postUrl: 'https://threads.net/p/1' }, NOW())
    await saveState(root, state)

    const [threads] = await approveDrafts(root, ID, ['threads'], NOW)
    expect(threads.approved).toBe(false)
    expect(threads.problems[0].message).toContain('published')
    expect(getCell(await loadState(root), ID, 'threads')?.status).toBe('published')
  })

  it('config 에 없는 채널은 거부한다', async () => {
    const root = await filledWorkspace()
    const configPath = join(root, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.channels = ['threads']
    writeFileSync(configPath, JSON.stringify(config))
    await expect(approveDrafts(root, ID, ['naver'], NOW)).rejects.toThrow('config.json 의 channels 에 없습니다')
  })

  it('manual(수동 발행 대기) 칸은 다시 승인할 수 있다', async () => {
    const root = await filledWorkspace()
    const state = await loadState(root)
    setCell(state, ID, 'naver', { status: 'manual', hash: 'old' }, NOW())
    await saveState(root, state)
    const [naver] = await approveDrafts(root, ID, ['naver'], NOW)
    expect(naver.approved).toBe(true)
  })

  it('이미 내보낸(manual, 해시 일치) 네이버 초안은 다시 승인해도 칸을 되돌리지 않고 안내한다', async () => {
    const root = await filledWorkspace()
    await approveDrafts(root, ID, ['naver'], NOW)
    await exportNaver(root, ID, NOW)
    const [naver] = await approveDrafts(root, ID, undefined, NOW).then((rs) => rs.filter((r) => r.channel === 'naver'))
    expect(naver.approved).toBe(true)
    expect(naver.problems).toContainEqual({
      level: 'warn',
      message: `이미 네이버용으로 내보낸 초안입니다(수동 발행 대기). 발행했다면 sns-relay mark naver ${ID} --url <주소> 로 기록하세요.`,
    })
    expect(getCell(await loadState(root), ID, 'naver')?.status).toBe('manual')
    await expect(markPublished(root, ID, 'naver', 'https://blog.naver.com/myblog/1', NOW)).resolves.toMatchObject({ status: 'published' })
  })
})
