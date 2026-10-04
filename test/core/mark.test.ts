import { describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { markPublished } from '../../src/core/mark.js'
import { exportNaver } from '../../src/core/naver.js'
import { getCell, loadState } from '../../src/core/state.js'
import { articleStatus } from '../../src/core/status.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'

const ID = ARTICLE.id
const NOW = () => new Date('2026-09-30T00:00:00Z')
const URL_ = 'https://blog.naver.com/myblog/2240000000'

async function exported(): Promise<string> {
  const root = makeTempDir()
  await setupDrafts(root)
  writeBody(root, ID, 'naver', VALID_BODIES.naver)
  await approveDrafts(root, ID, ['naver'], NOW)
  await exportNaver(root, ID, NOW)
  return root
}

describe('markPublished', () => {
  it('manual 칸을 발행 주소와 함께 published 로', async () => {
    const root = await exported()
    const cell = await markPublished(root, ID, 'naver', URL_, NOW)
    expect(cell).toMatchObject({ status: 'published', postUrl: URL_ })
    expect(cell.hash).toBeTruthy()
    const row = await articleStatus(root, ID)
    expect(row.cells.find((c) => c.channel === 'naver')).toMatchObject({ label: '게시됨', detail: URL_ })
  })

  it('내보내기 전(approved)이면 거부한다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    await approveDrafts(root, ID, ['naver'], NOW)
    await expect(markPublished(root, ID, 'naver', URL_, NOW)).rejects.toThrow('수동 발행 대기(manual)가 아닙니다')
  })

  it('이미 published 인 칸은 거부하고 그대로 둔다', async () => {
    const root = await exported()
    await markPublished(root, ID, 'naver', URL_, NOW)
    await expect(markPublished(root, ID, 'naver', 'https://blog.naver.com/myblog/2', NOW)).rejects.toThrow('수동 발행 대기(manual)가 아닙니다')
    expect(getCell(await loadState(root), ID, 'naver')).toMatchObject({ status: 'published', postUrl: URL_ })
  })

  it.each(['blog.naver.com/x', 'ftp://blog.naver.com/x', 'https://'])('주소가 잘못되면 거부한다: %s', async (bad) => {
    const root = await exported()
    await expect(markPublished(root, ID, 'naver', bad, NOW)).rejects.toThrow('http(s) 주소')
    expect(getCell(await loadState(root), ID, 'naver')?.status).toBe('manual')
  })
})
