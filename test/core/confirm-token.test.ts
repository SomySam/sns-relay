import { beforeEach, describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { publishConfirm, publishConfirmToken } from '../../src/core/confirm-token.js'
import { setCell, updateState } from '../../src/core/state.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'

const ID = ARTICLE.id
let root: string
beforeEach(async () => {
  root = makeTempDir()
  await setupDrafts(root)
  writeBody(root, ID, 'threads', VALID_BODIES.threads)
  writeBody(root, ID, 'facebook', VALID_BODIES.facebook)
  await approveDrafts(root, ID, ['threads', 'facebook'])
})

describe('publishConfirmToken', () => {
  it('12자이고 같은 조건이면 같다(채널 순서 무관)', async () => {
    const a = await publishConfirmToken(root, ID, ['threads', 'facebook'])
    const b = await publishConfirmToken(root, ID, ['facebook', 'threads'])
    expect(a).toMatch(/^[0-9a-f]{12}$/)
    expect(a).toBe(b)
  })

  it('대상 채널이 다르면 다르다', async () => {
    expect(await publishConfirmToken(root, ID, ['threads'])).not.toBe(await publishConfirmToken(root, ID, ['threads', 'facebook']))
  })

  it('초안이 바뀌면 다르다', async () => {
    const before = await publishConfirmToken(root, ID, ['threads'])
    writeBody(root, ID, 'threads', VALID_BODIES.threads + '\n\n덧붙임')
    expect(await publishConfirmToken(root, ID, ['threads'])).not.toBe(before)
  })

  it('상태가 바뀌면 다르다', async () => {
    const before = await publishConfirmToken(root, ID, ['threads'])
    await updateState(root, (s) => {
      const hash = s[`${ID}:threads`]!.hash
      setCell(s, ID, 'threads', { status: 'published', hash, postUrl: 'https://x/1' }, new Date())
    })
    expect(await publishConfirmToken(root, ID, ['threads'])).not.toBe(before)
  })

  it('같은 해시로 failed 를 다시 기록해도(갱신 시각이 다르면) 다르다', async () => {
    const hash = (await publishConfirm(root, ID, ['threads'])).hashes.threads!
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'failed', hash, reason: 'x' }, new Date('2026-09-30T00:00:00Z'))
    })
    const t1 = await publishConfirmToken(root, ID, ['threads'])
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'failed', hash, reason: 'x' }, new Date('2026-09-30T00:05:00Z'))
    })
    expect(await publishConfirmToken(root, ID, ['threads'])).not.toBe(t1)
  })
})
