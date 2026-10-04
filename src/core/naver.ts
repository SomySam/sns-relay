import { join } from 'node:path'
import { hasErrors } from './channels/index.js'
import { readDrafts } from './draft-files.js'
import { articleImages, hashDraft } from './drafts.js'
import { writeFileAtomic } from './fs.js'
import { getCell, loadState, setCell, updateState } from './state.js'
import { articleDir } from './workspace.js'

/** 마크다운 초안을 네이버 편집기에 붙여 넣기 좋은 평문으로 — 소제목 서식은 붙여 넣은 뒤 편집기에서 입힌다. */
export function toNaverText(body: string): string {
  return body
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^(\s*)[-*]\s+/, '$1• ')
        .replace(/\*\*(.+?)\*\*/g, '$1'),
    )
    .join('\n')
}

function renderNaverMd(id: string, title: string, text: string, subheadings: string[], tags: string[], images: string[]): string {
  const sections = [
    `# 네이버 붙여 넣기용 원고 — ${id}`,
    '각 칸의 제목 줄(## …)은 빼고, 그 아래 내용만 복사해 네이버 글쓰기에 붙여 넣으세요.',
    `## 제목\n\n${title}`,
    `## 본문\n\n${text}`,
  ]
  if (subheadings.length > 0) {
    sections.push(`## 소제목 (붙여 넣은 뒤 편집기에서 소제목 서식을 입히세요)\n\n${subheadings.join('\n')}`)
  }
  if (images.length > 0) {
    const heading = `## 사진 (글쓰기에서 직접 넣으세요)${images.length > 1 ? ' — 순서대로' : ''}`
    sections.push([heading, '', ...images].join('\n'))
  }
  sections.push(
    `## 태그 (발행 설정 창 「태그 편집」에 하나씩 입력하고 Enter)\n\n${
      tags.length > 0 ? tags.join('\n') : '(태그 없음 — 초안 tags 를 채우고 다시 승인하세요)'
    }`,
  )
  sections.push(`## 발행한 뒤\n\nsns-relay mark naver ${id} --url <발행 주소>`)
  return `${sections.join('\n\n')}\n`
}

export interface NaverExport {
  title: string
  text: string
  tags: string[]
  subheadings: string[]
  path: string
}

export async function exportNaver(root: string, id: string, now: () => Date = () => new Date()): Promise<NaverExport> {
  const { article, views } = await readDrafts(root, id, now)
  const view = views.find((v) => v.channel === 'naver')
  if (!view) throw new Error('config.json 의 channels 에 naver 가 없습니다.')
  const cell = getCell(await loadState(root), id, 'naver')
  if (cell?.status === 'published') {
    throw new Error(`네이버 칸은 이미 발행 기록이 있습니다: ${cell.postUrl ?? '주소 없음'}`)
  }
  const draft = view.draft
  const hash = draft ? hashDraft(draft) : undefined
  const reexport = cell?.status === 'manual' && cell.hash === hash
  if (!draft || (!view.approved && !reexport) || hasErrors(view.problems)) {
    throw new Error(`네이버 초안이 승인되지 않았습니다. 오너 확인 뒤 sns-relay approve ${id} --channels naver 로 승인하세요.`)
  }

  const title = (draft.title ?? '').trim()
  const tags = (draft.tags ?? []).map((t) => t.trim())
  const text = draft.link ? `${toNaverText(draft.body)}\n\n원문: ${draft.link}` : toNaverText(draft.body)
  const path = join(articleDir(root, id), 'naver.md')
  await updateState(root, (s) => {
    const current = getCell(s, id, 'naver')
    const ok =
      current !== undefined &&
      ['approved', 'failed', 'manual'].includes(current.status) &&
      current.hash === hash
    if (!ok) throw new Error('다른 작업이 네이버 칸을 먼저 바꿨습니다. sns-relay status 로 확인하세요.')
    setCell(s, id, 'naver', { status: 'manual', hash }, now())
  })
  const subheadings = draft.body
    .split('\n')
    .map((line) => /^#{1,6}\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((h): h is string => !!h)
  await writeFileAtomic(path, renderNaverMd(id, title, text, subheadings, tags, article.source === 'notes' ? articleImages(article) : []))
  return { title, text, tags, subheadings, path }
}
