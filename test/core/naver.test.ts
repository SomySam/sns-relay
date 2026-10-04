import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveDrafts } from '../../src/core/approve.js'
import { exportNaver, toNaverText } from '../../src/core/naver.js'
import { getCell, loadState, setCell, updateState } from '../../src/core/state.js'
import { ARTICLE, NOTES_ARTICLE, NOTES_ARTICLE_MULTI, setupDrafts, VALID_BODIES, VALID_TAGS, writeBody, writeTags } from '../draft-helpers.js'
import { makeTempDir } from '../helpers.js'

const ID = ARTICLE.id
const NOW = () => new Date('2026-09-30T00:00:00Z')
const LINK = 'https://blog.example.com/blog/ai-task-brief?utm_source=naver&utm_medium=social&utm_campaign=ai-task-brief'

async function approvedNaver(): Promise<string> {
  const root = makeTempDir()
  await setupDrafts(root)
  writeBody(root, ID, 'naver', VALID_BODIES.naver)
  await approveDrafts(root, ID, ['naver'], NOW)
  return root
}

describe('toNaverText', () => {
  it('소제목 기호를 떼고, 목록은 •, 굵게 기호는 뗀다', () => {
    expect(toNaverText('도입 **중요**\n\n## 첫 소제목\n\n- 하나\n- 둘\n\n### 작은 제목\n끝')).toBe(
      '도입 중요\n\n첫 소제목\n\n• 하나\n• 둘\n\n작은 제목\n끝',
    )
  })
})

describe('exportNaver', () => {
  it('링크 없는 작업은 원문 줄이 없고, 사진 칸이 있다', async () => {
    const root = makeTempDir()
    await setupDrafts(root, NOTES_ARTICLE)
    writeBody(root, NOTES_ARTICLE.id, 'naver', VALID_BODIES.naver)
    writeTags(root, NOTES_ARTICLE.id, VALID_TAGS)
    await approveDrafts(root, NOTES_ARTICLE.id, ['naver'], NOW)
    const r = await exportNaver(root, NOTES_ARTICLE.id, NOW)
    const md = readFileSync(r.path, 'utf8')
    expect(r.text).not.toContain('원문:')
    expect(md).toContain(`## 사진 (글쓰기에서 직접 넣으세요)

${NOTES_ARTICLE.image}
`)
  })

  it('여러 장 작업 원고의 사진 칸에 주소가 순서대로 있다', async () => {
    const root = makeTempDir()
    const a = NOTES_ARTICLE_MULTI
    await setupDrafts(root, a)
    writeBody(root, a.id, 'naver', VALID_BODIES.naver)
    writeTags(root, a.id, VALID_TAGS)
    await approveDrafts(root, a.id, ['naver'], NOW)
    const r = await exportNaver(root, a.id, NOW)
    const md = readFileSync(r.path, 'utf8')
    expect(md).toContain(['## 사진 (글쓰기에서 직접 넣으세요) — 순서대로', '', ...a.images!].join('\n'))
  })

  it('블로그 작업 원고에는 사진 칸이 없다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    await approveDrafts(root, ID, ['naver'], NOW)
    const r = await exportNaver(root, ID, NOW)
    expect(readFileSync(r.path, 'utf8')).not.toContain('## 사진')
    expect(r.text).toContain('원문: https://blog.example.com/blog/ai-task-brief?utm_source=naver')
  })

  it('승인된 초안을 붙여 넣기용으로 저장하고 칸을 manual 로 둔다', async () => {
    const root = await approvedNaver()
    const r = await exportNaver(root, ID, NOW)
    expect(r.title).toBe(ARTICLE.title)
    expect(r.text.endsWith(`\n\n원문: ${LINK}`)).toBe(true)
    expect(r.text).not.toContain('## ')
    expect(r.path).toBe(join(root, 'work', ID, 'naver.md'))
    expect(r.subheadings).toEqual(['왜 브리프가 필요한가', '세 가지 요소'])
    expect(getCell(await loadState(root), ID, 'naver')?.status).toBe('manual')
  })

  it('같은 내용이면 다시 내보낼 수 있다', async () => {
    const root = await approvedNaver()
    await exportNaver(root, ID, NOW)
    await expect(exportNaver(root, ID, NOW)).resolves.toMatchObject({ title: ARTICLE.title })
  })

  it('칸이 그사이 unknown 이면 거부하고 naver.md 를 쓰지 않는다', async () => {
    const root = await approvedNaver()
    await updateState(root, (s) => {
      const c = getCell(s, ID, 'naver')!
      setCell(s, ID, 'naver', { status: 'unknown', hash: c.hash }, NOW())
    })
    await expect(exportNaver(root, ID, NOW)).rejects.toThrow()
    expect(existsSync(join(root, 'work', ID, 'naver.md'))).toBe(false)
    expect(getCell(await loadState(root), ID, 'naver')?.status).toBe('unknown')
  })

  it('승인되지 않았으면 거부한다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    await expect(exportNaver(root, ID, NOW)).rejects.toThrow('승인되지 않았습니다')
  })

  it('내보낸 뒤 초안을 고치면 다시 승인해야 내보낼 수 있다', async () => {
    const root = await approvedNaver()
    await exportNaver(root, ID, NOW)
    writeBody(root, ID, 'naver', VALID_BODIES.naver + '\n\n덧붙임')
    await expect(exportNaver(root, ID, NOW)).rejects.toThrow('승인되지 않았습니다')
    const [r] = await approveDrafts(root, ID, ['naver'], NOW)
    expect(r.approved).toBe(true)
    await expect(exportNaver(root, ID, NOW)).resolves.toMatchObject({ text: expect.stringContaining('덧붙임') })
  })

  it('이미 발행 기록이 있으면 거부한다', async () => {
    const root = await approvedNaver()
    await updateState(root, (s) => {
      setCell(s, ID, 'naver', { status: 'published', postUrl: 'https://blog.naver.com/x/1' }, NOW())
    })
    await expect(exportNaver(root, ID, NOW)).rejects.toThrow('이미 발행 기록')
  })

  it('naver.md 는 정해진 형식으로 제목·본문·소제목·태그를 담는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    writeTags(root, ID, VALID_TAGS)
    await approveDrafts(root, ID, ['naver'], NOW)
    const r = await exportNaver(root, ID, NOW)
    expect(r.tags).toEqual(VALID_TAGS)
    expect(r.path.endsWith('naver.md')).toBe(true)
    expect(readFileSync(r.path, 'utf8')).toBe(
      [
        `# 네이버 붙여 넣기용 원고 — ${ID}`,
        '',
        '각 칸의 제목 줄(## …)은 빼고, 그 아래 내용만 복사해 네이버 글쓰기에 붙여 넣으세요.',
        '',
        '## 제목',
        '',
        r.title,
        '',
        '## 본문',
        '',
        r.text,
        '',
        '## 소제목 (붙여 넣은 뒤 편집기에서 소제목 서식을 입히세요)',
        '',
        '왜 브리프가 필요한가',
        '세 가지 요소',
        '',
        '## 태그 (발행 설정 창 「태그 편집」에 하나씩 입력하고 Enter)',
        '',
        ...VALID_TAGS,
        '',
        '## 발행한 뒤',
        '',
        `sns-relay mark naver ${ID} --url <발행 주소>`,
        '',
      ].join('\n'),
    )
  })

  it('소제목이 없으면 소제목 칸을 빼고, 태그가 없으면 안내 문구를 넣는다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', '소제목 없이 이어지는 본문입니다.\n\n원문에서 더 볼 수 있어요.')
    await approveDrafts(root, ID, ['naver'], NOW)
    const r = await exportNaver(root, ID, NOW)
    expect(r.subheadings).toEqual([])
    const md = readFileSync(r.path, 'utf8')
    expect(md).not.toContain('## 소제목')
    expect(md).toContain('## 태그 (발행 설정 창 「태그 편집」에 하나씩 입력하고 Enter)\n\n(태그 없음 — 초안 tags 를 채우고 다시 승인하세요)\n')
  })

  it('태그의 앞뒤 공백을 떼어 돌려주고 저장한다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    writeTags(root, ID, [' 가 ', '나', '다', '라', '마 '])
    await approveDrafts(root, ID, ['naver'], NOW)
    const r = await exportNaver(root, ID, NOW)
    expect(r.tags).toEqual(['가', '나', '다', '라', '마'])
    expect(readFileSync(r.path, 'utf8')).toContain('\n\n가\n나\n다\n라\n마\n\n## 발행한 뒤')
  })

  it('manual 칸에서 태그를 고치면 다시 승인해야 내보내지고 manual 로 돌아온다', async () => {
    const root = makeTempDir()
    await setupDrafts(root)
    writeBody(root, ID, 'naver', VALID_BODIES.naver)
    writeTags(root, ID, VALID_TAGS)
    await approveDrafts(root, ID, ['naver'], NOW)
    await exportNaver(root, ID, NOW)
    expect(getCell(await loadState(root), ID, 'naver')?.status).toBe('manual')
    const newTags = ['새태그1', '새태그2', '새태그3', '새태그4', '새태그5']
    writeTags(root, ID, newTags)
    await expect(exportNaver(root, ID, NOW)).rejects.toThrow('승인되지 않았습니다')
    await approveDrafts(root, ID, ['naver'], NOW)
    const r = await exportNaver(root, ID, NOW)
    expect(r.tags).toEqual(newTags)
    expect(getCell(await loadState(root), ID, 'naver')?.status).toBe('manual')
  })
})
