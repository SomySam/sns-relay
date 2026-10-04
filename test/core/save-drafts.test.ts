import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportNaver } from '../../src/core/naver.js'
import { approveDrafts } from '../../src/core/approve.js'
import { draftPath, readDrafts } from '../../src/core/draft-files.js'
import { parseDraft } from '../../src/core/drafts.js'
import { saveDrafts } from '../../src/core/save-drafts.js'
import { setCell, updateState } from '../../src/core/state.js'
import { ARTICLE, setupDrafts, VALID_BODIES, VALID_TAGS, writeBody, writeTags } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'

const ID = ARTICLE.id
let root: string
beforeEach(async () => {
  root = makeTempDir()
  await setupDrafts(root)
})
const read = (ch: 'threads' | 'naver') => parseDraft(readFileSync(draftPath(root, ID, ch), 'utf8'), ch)

describe('saveDrafts', () => {
  it('본문만 바꾸고 link·image 는 그대로 둔다', async () => {
    const before = read('threads')
    const r = await saveDrafts(root, ID, [{ channel: 'threads', body: '\n새 본문\r\n둘째 줄  \n' }])
    expect(r).toEqual([{ channel: 'threads', saved: true }])
    const after = read('threads')
    expect(after.body).toBe('새 본문\n둘째 줄')
    expect(after.link).toBe(before.link)
    expect(after.image).toBe(before.image)
    expect(after.approved).toBe(false)
  })

  it('승인된 초안의 내용이 바뀌면 승인이 풀린다', async () => {
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await approveDrafts(root, ID, ['threads'])
    await saveDrafts(root, ID, [{ channel: 'threads', body: VALID_BODIES.threads + '\n\n덧붙임' }])
    const { views } = await readDrafts(root, ID)
    expect(views.find((v) => v.channel === 'threads')!.approved).toBe(false)
  })

  it('내용이 같으면 파일을 건드리지 않아 승인이 유지된다', async () => {
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    await approveDrafts(root, ID, ['threads'])
    const r = await saveDrafts(root, ID, [{ channel: 'threads', body: VALID_BODIES.threads }])
    expect(r[0]).toEqual({ channel: 'threads', saved: true, reason: '내용이 같아 그대로 둡니다.' })
    const { views } = await readDrafts(root, ID)
    expect(views.find((v) => v.channel === 'threads')!.approved).toBe(true)
  })

  it('네이버는 title·tags 도 저장한다', async () => {
    await saveDrafts(root, ID, [{ channel: 'naver', body: VALID_BODIES.naver, title: '새 제목', tags: VALID_TAGS }])
    const d = read('naver')
    expect(d.title).toBe('새 제목')
    expect(d.tags).toEqual(VALID_TAGS)
  })

  it('네이버가 아닌 채널의 title·tags 는 거부한다', async () => {
    const r = await saveDrafts(root, ID, [{ channel: 'threads', body: '본문', title: '제목' }])
    expect(r[0].saved).toBe(false)
    expect(r[0].reason).toContain('네이버 초안만')
  })

  it('게시된 칸은 고치지 않는다', async () => {
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', { status: 'published', postUrl: 'https://x/1' }, new Date())
    })
    const r = await saveDrafts(root, ID, [{ channel: 'threads', body: '새 본문' }])
    expect(r[0]).toEqual({ channel: 'threads', saved: false, reason: '이미 published 상태라 고치지 않습니다.' })
  })

  it('빈 본문과 같은 채널 두 번은 거부한다', async () => {
    const r = await saveDrafts(root, ID, [
      { channel: 'facebook', body: '   ' },
      { channel: 'threads', body: '하나' },
      { channel: 'threads', body: '둘' },
    ])
    expect(r.map((x) => x.saved)).toEqual([false, true, false])
    expect(r[0].reason).toBe('본문이 비어 있습니다.')
    expect(r[2].reason).toBe('같은 채널이 두 번 들어왔습니다.')
    expect(read('threads').body).toBe('하나')
  })

  it('깨진 파일은 그 채널만 건너뛴다', async () => {
    writeFileSync(draftPath(root, ID, 'threads'), 'no frontmatter')
    const r = await saveDrafts(root, ID, [
      { channel: 'threads', body: '가' },
      { channel: 'facebook', body: '나' },
    ])
    expect(r[0].saved).toBe(false)
    expect(r[0].reason).toContain('초안 형식 오류')
    expect(r[1]).toEqual({ channel: 'facebook', saved: true })
  })

  it('수동 발행 대기(manual) 칸은 고칠 수 있고, 고치면 다시 승인해야 내보낼 수 있다', async () => {
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    writeTags(root, ID, VALID_TAGS)
    await saveDrafts(root, ID, [{ channel: 'naver', body: VALID_BODIES.naver, title: '제목' }])
    await approveDrafts(root, ID, ['naver'])
    await exportNaver(root, ID)
    const r = await saveDrafts(root, ID, [{ channel: 'naver', body: VALID_BODIES.naver + '\n\n덧붙임' }])
    expect(r[0]).toEqual({ channel: 'naver', saved: true })
    await expect(exportNaver(root, ID)).rejects.toThrow('승인되지 않았습니다')
  })

  it.each(['unknown', 'skipped'] as const)('%s 칸은 고치지 않는다', async (status) => {
    await updateState(root, (s) => {
      setCell(s, ID, 'threads', status === 'unknown' ? { status, reason: 'x' } : { status }, new Date())
    })
    const r = await saveDrafts(root, ID, [{ channel: 'threads', body: '새 본문' }])
    expect(r[0]).toEqual({ channel: 'threads', saved: false, reason: `이미 ${status} 상태라 고치지 않습니다.` })
  })

  it('config 에 없는 채널은 거부한다', async () => {
    const cfgPath = join(root, 'config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, channels: ['threads'] }))
    const r = await saveDrafts(root, ID, [{ channel: 'facebook', body: '가' }])
    expect(r[0].saved).toBe(false)
    expect(r[0].reason).toContain('channels 에 없습니다')
  })

  it('없는 작업은 예외', async () => {
    await expect(saveDrafts(root, 'no-such', [{ channel: 'threads', body: '가' }])).rejects.toThrow('이 없습니다')
  })
})
