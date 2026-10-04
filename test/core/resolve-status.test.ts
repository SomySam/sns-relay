import { describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { readDrafts } from '../../src/core/draft-files.js'
import { resolveUnknown } from '../../src/core/resolve.js'
import { getCell, loadState, setCell, updateState } from '../../src/core/state.js'
import { articleStatus, listArticleIds } from '../../src/core/status.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'

const ID = ARTICLE.id
const NOW = () => new Date('2026-09-30T00:00:00Z')

async function unknownThreads(): Promise<string> {
  const root = makeTempDir()
  await setupDrafts(root)
  writeBody(root, ID, 'threads', VALID_BODIES.threads)
  await approveDrafts(root, ID, ['threads'], NOW)
  const hash = getCell(await loadState(root), ID, 'threads')!.hash
  await updateState(root, (s) => {
    setCell(s, ID, 'threads', { status: 'unknown', hash, reason: '응답 없음' }, NOW())
  })
  return root
}

describe('resolveUnknown', () => {
  it('게시된 것을 확인했으면 주소와 함께 published', async () => {
    const root = await unknownThreads()
    const cell = await resolveUnknown(root, ID, 'threads', { postUrl: 'https://www.threads.net/@a/post/1' }, NOW)
    expect(cell).toMatchObject({ status: 'published', postUrl: 'https://www.threads.net/@a/post/1' })
    expect(cell.hash).toBeTruthy()
  })

  it('게시되지 않았으면 승인 상태로 돌려 다시 게시할 수 있다', async () => {
    const root = await unknownThreads()
    await resolveUnknown(root, ID, 'threads', { notPublished: true }, NOW)
    expect((await readDrafts(root, ID, NOW)).views[0].approved).toBe(true)
  })

  it('unknown 이 아니면 거부한다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    await expect(resolveUnknown(root, ID, 'threads', { notPublished: true }, NOW)).rejects.toThrow('unknown')
  })

  it('주소가 http(s) 가 아니면 거부한다', async () => {
    const root = await unknownThreads()
    await expect(resolveUnknown(root, ID, 'threads', { postUrl: 'threads.net/x' }, NOW)).rejects.toThrow('주소')
  })
})

describe('status', () => {
  it('작업 목록과 채널별 라벨', async () => {
    const root = await unknownThreads()
    writeBody(root, ID, 'facebook', VALID_BODIES.facebook)
    await approveDrafts(root, ID, ['facebook'], NOW)
    expect(await listArticleIds(root)).toEqual([ID])
    const row = await articleStatus(root, ID)
    expect(row.title).toBe(ARTICLE.title)
    expect(row.cells.map((c) => [c.channel, c.label])).toEqual([
      ['threads', '결과 불명'],
      ['instagram', '미승인'],
      ['facebook', '승인됨'],
      ['naver', '미승인'],
    ])
    expect(row.cells[0].detail).toBe('응답 없음')
  })
})
