import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/program.js'
import { approveDrafts } from '../../src/core/approve.js'
import { draftPath } from '../../src/core/draft-files.js'
import { exportNaver } from '../../src/core/naver.js'
import { CHANNEL_IDS } from '../../src/core/types.js'
import { ARTICLE, setupDrafts, VALID_BODIES, writeBody, writeTags } from '../draft-helpers.js'
import { makeIo, makeTempDir } from '../helpers.js'

const ID = ARTICLE.id

describe('rules', () => {
  it('규칙 전체를 출력한다', async () => {
    const t = makeIo(makeTempDir())
    expect(await runCli(['rules'], t.io)).toBe(0)
    const out = t.out.join('\n')
    expect(out).toContain('# 공통 규칙')
    expect(out).toContain('# 네이버 블로그')
  })

  it('채널 하나만 출력한다', async () => {
    const t = makeIo(makeTempDir())
    expect(await runCli(['rules', 'threads'], t.io)).toBe(0)
    expect(t.out.join('\n')).not.toContain('# Instagram')
  })

  it('모르는 채널이면 1', async () => {
    const t = makeIo(makeTempDir())
    expect(await runCli(['rules', 'tiktok'], t.io)).toBe(1)
    expect(t.err.join('\n')).toContain('모르는 채널: tiktok')
  })
})

describe('drafts', () => {
  it('네이버 태그를 보여 준다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const t1 = makeIo(root)
    await runCli(['drafts', ID], t1.io)
    expect(t1.out.join('\n')).toContain('태그: (없음)')
    writeTags(root, ID, ['가', '나'])
    const t2 = makeIo(root)
    await runCli(['drafts', ID], t2.io)
    expect(t2.out.join('\n')).toContain('태그: 가, 나')
  })

  it('tags 키가 없는 네이버 초안도 태그: (없음) 을 보여 준다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const path = draftPath(root, ID, 'naver')
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^tags:.*\n(?:  - .*\n)*/m, ''))
    expect(readFileSync(path, 'utf8')).not.toContain('tags')
    const t = makeIo(root)
    await runCli(['drafts', ID], t.io)
    expect(t.out.join('\n')).toContain('태그: (없음)')
  })

  it('채널별 상태와 문제를 보여 준다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    const t = makeIo(root)
    expect(await runCli(['drafts', ID], t.io)).toBe(0)
    const out = t.out.join('\n')
    expect(out).toContain(`${ID} — ${ARTICLE.title}`)
    expect(out).toMatch(/threads\s+미승인\s+\d+자\s+/)
    expect(out).toContain(join('work', ID, 'drafts', 'instagram.md'))
    expect(out).toContain('✖ 본문이 비어 있습니다.')
  })

  it('채널별로 제목(네이버)·링크·이미지를 보여 준다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const t = makeIo(root)
    expect(await runCli(['drafts', ID], t.io)).toBe(0)
    expect(t.out).toContain(`    제목: ${ARTICLE.title}`)
    expect(t.out).toContain(`    링크: ${ARTICLE.canonicalUrl}?utm_source=threads&utm_medium=social&utm_campaign=${ID}`)
    expect(t.out.filter((l) => l.startsWith('    링크: '))).toHaveLength(4)
    expect(t.out.filter((l) => l.startsWith('    제목: '))).toHaveLength(1)
    expect(t.out).toContain(`    이미지: ${ARTICLE.image}`)
    const i = t.out.findIndex((l) => l.includes('threads.md'))
    expect(t.out[i + 1]).toMatch(/^ {4}링크: /)
  })

  it('없는 작업이면 1 과 fetch 안내', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const t = makeIo(root)
    expect(await runCli(['drafts', 'nope'], t.io)).toBe(1)
    expect(t.err.join('\n')).toContain('sns-relay fetch')
  })
})

describe('approve', () => {
  it('모두 통과하면 0 과 채널별 ✔', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    for (const ch of CHANNEL_IDS) writeBody(root, ID, ch, VALID_BODIES[ch])
    const t = makeIo(root)
    expect(await runCli(['approve', ID], t.io)).toBe(0)
    expect(t.out).toContain('✔ threads 승인')
    expect(t.out).toContain('✔ naver 승인')

    const view = makeIo(root)
    await runCli(['drafts', ID], view.io)
    expect(view.out.join('\n')).toMatch(/threads\s+승인됨/)
  })

  it('내보낸 네이버 칸은 수동 발행 대기로 보여 준다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    await approveDrafts(root, ID, ['naver'])
    await exportNaver(root, ID)
    const t = makeIo(root)
    expect(await runCli(['drafts', ID], t.io)).toBe(0)
    const out = t.out.join('\n')
    expect(out).toMatch(/naver\s+수동 발행 대기/)
    expect(out).not.toMatch(/naver\s+미승인/)
  })

  it('하나라도 안 되면 1 과 이유', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'threads', VALID_BODIES.threads)
    const t = makeIo(root)
    expect(await runCli(['approve', ID, '--channels', 'threads,facebook'], t.io)).toBe(1)
    expect(t.out).toContain('✔ threads 승인')
    expect(t.out).toContain('✖ facebook 승인 안 됨')
    expect(t.out).toContain('    ✖ 본문이 비어 있습니다.')
  })

  it('모르는 채널이면 1', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const t = makeIo(root)
    expect(await runCli(['approve', ID, '--channels', 'x'], t.io)).toBe(1)
    expect(t.err.join('\n')).toContain('모르는 채널: x')
  })

  it.each(['', ','])('--channels %j 이면 1 이고 아무것도 승인하지 않는다', async (value) => {
    const root = makeTempDir()
    await setupDrafts(root)
    for (const ch of CHANNEL_IDS) writeBody(root, ID, ch, VALID_BODIES[ch])
    const t = makeIo(root)
    expect(await runCli(['approve', ID, '--channels', value], t.io)).toBe(1)
    expect(t.err.join('\n')).toContain('채널을 하나 이상 지정하세요')
    const view = makeIo(root)
    await runCli(['drafts', ID], view.io)
    expect(view.out.join('\n')).not.toContain('승인됨')
  })
})
