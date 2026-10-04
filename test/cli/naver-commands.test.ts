import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/program.js'
import { approveDrafts } from '../../src/core/approve.js'
import { ARTICLE, setupDrafts, VALID_BODIES, VALID_TAGS, writeBody, writeTags } from '../draft-helpers.js'
import { makeIo, makeTempDir } from '../helpers.js'

const ID = ARTICLE.id

async function approvedRoot(): Promise<string> {
  const root = makeTempDir()
  await setupDrafts(root)
  writeBody(root, ID, 'naver', VALID_BODIES.naver)
  await approveDrafts(root, ID, ['naver'])
  return root
}

async function taggedRoot(): Promise<string> {
  const root = makeTempDir()
  await setupDrafts(root)
  writeBody(root, ID, 'naver', VALID_BODIES.naver)
  writeTags(root, ID, VALID_TAGS)
  await approveDrafts(root, ID, ['naver'])
  return root
}

function run(root: string, args: string[], open?: (p: string) => Promise<void>) {
  const t = makeIo(root)
  return runCli(args, { ...t.io, open: open ?? (async () => {}) }).then((code) => ({ code, out: t.out.join('\n'), err: t.err.join('\n') }))
}

describe('naver', () => {
  it('원고 파일을 만들고 열고 태그 목록을 보여 준다', async () => {
    const root = await taggedRoot()
    const opened: string[] = []
    const r = await run(root, ['naver', ID], async (p) => void opened.push(p))
    expect(r.code).toBe(0)
    expect(r.out).toContain(`제목: ${ARTICLE.title}`)
    expect(r.out).toContain(`태그(하나씩 입력 후 Enter): ${VALID_TAGS.join(' / ')}`)
    expect(r.out).toContain('파일을 열었습니다. 칸별로 복사해 붙여 넣으세요.')
    expect(r.out).toContain(`발행 후: sns-relay mark naver ${ID} --url <발행 주소>`)
    expect(opened).toEqual([join(root, 'work', ID, 'naver.md')])
    expect(readFileSync(opened[0]!, 'utf8')).toContain('## 제목')
  })

  it('태그가 없으면 없음으로 표시한다', async () => {
    const r = await run(await approvedRoot(), ['naver', ID])
    expect(r.code).toBe(0)
    expect(r.out).toContain('태그: 없음')
  })

  it('--no-open 이면 열지 않는다', async () => {
    const root = await approvedRoot()
    const opened: string[] = []
    const r = await run(root, ['naver', ID, '--no-open'], async (p) => void opened.push(p))
    expect(r.code).toBe(0)
    expect(opened).toEqual([])
    expect(existsSync(join(root, 'work', ID, 'naver.md'))).toBe(true)
    expect(r.out).not.toContain('파일을 열었습니다')
  })

  it('열기에 실패해도 원고는 남고 0, 직접 열 경로를 알려 준다', async () => {
    const root = await approvedRoot()
    const r = await run(root, ['naver', ID], async () => {
      throw new Error('no app')
    })
    expect(r.code).toBe(0)
    expect(r.err).toContain('직접 여세요')
    expect(r.err).toContain(join(root, 'work', ID, 'naver.md'))
  })

  it.each([['--tags'], ['--title'], ['--tag', '1']])('옛 옵션 %s 는 알 수 없는 옵션으로 거부한다', async (...flag) => {
    const opened: string[] = []
    const r = await run(await taggedRoot(), ['naver', ID, ...flag], async (p) => void opened.push(p))
    expect(r.code).not.toBe(0)
    expect(r.err).toContain('unknown option')
    expect(opened).toEqual([])
  })

  it('승인되지 않았으면 1', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    const r = await run(root, ['naver', ID])
    expect(r.code).toBe(1)
    expect(r.err).toContain('승인되지 않았습니다')
  })
})

describe('mark', () => {
  it('내보낸 네이버 글의 발행 주소를 기록한다', async () => {
    const root = await approvedRoot()
    await run(root, ['naver', ID])
    const r = await run(root, ['mark', 'naver', ID, '--url', 'https://blog.naver.com/myblog/1'])
    expect(r.code).toBe(0)
    expect(r.out).toContain(`✔ ${ID} naver → published https://blog.naver.com/myblog/1`)
  })

  it.each([[''], ['threads,naver']])('채널 인자가 하나가 아니면 1: "%s"', async (ch) => {
    const root = await approvedRoot()
    const r = await run(root, ['mark', ch, ID, '--url', 'https://blog.naver.com/myblog/1'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('채널을 하나만')
  })
})
