import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getChannel } from './channels/index.js'
import { loadConfig, type Config } from './config.js'
import { draftImage, hashDraft, MAX_IMAGES, newDraft, parseDraft, serializeDraft } from './drafts.js'
import { writeFileAtomic } from './fs.js'
import { getCell, loadState, setCell, updateState } from './state.js'
import type { Article, CellStatus, ChannelDraft, ChannelId, Problem } from './types.js'
import { articleLink } from './utm.js'
import { articleDir, requireArticle } from './workspace.js'

/** 승인 기록으로 인정하는 칸 상태 — failed 는 원인을 고치면 같은 내용으로 다시 게시할 수 있다. */
const APPROVAL_STATUSES: CellStatus[] = ['approved', 'failed']
/** 게시했거나 결과를 확인 중이거나 조건 미달로 멈춘 칸 — 초안 파일의 approved 를 건드리지 않는다. */
const LOCKED_STATUSES: CellStatus[] = ['published', 'unknown', 'manual', 'skipped']

export function draftPath(root: string, id: string, channel: ChannelId): string {
  return join(articleDir(root, id), 'drafts', `${channel}.md`)
}

export async function ensureDraftFiles(
  root: string,
  article: Article,
  config: Config,
): Promise<{ created: ChannelId[]; relinked: ChannelId[]; reimaged: ChannelId[] }> {
  const created: ChannelId[] = []
  const relinked: ChannelId[] = []
  const reimaged: ChannelId[] = []
  await mkdir(join(articleDir(root, article.id), 'drafts'), { recursive: true })
  for (const channel of config.channels) {
    const path = draftPath(root, article.id, channel)
    const fresh = newDraft(article, channel, config)
    if (!existsSync(path)) {
      await writeFileAtomic(path, serializeDraft(fresh))
      created.push(channel)
      continue
    }
    let current: ChannelDraft
    try {
      current = parseDraft(await readFile(path, 'utf8'), channel)
    } catch {
      continue // 형식이 깨진 파일은 건드리지 않는다 — drafts 명령이 오류로 알려 준다
    }
    const linkChanged = current.link !== fresh.link
    const imageChanged =
      current.image !== fresh.image || JSON.stringify(current.images ?? []) !== JSON.stringify(fresh.images ?? [])
    if (linkChanged || imageChanged) {
      // 링크·사진은 늘 현재 글·설정을 따른다. 게시 내용이 바뀌었으니 승인도 푼다.
      const { images: _old, ...rest } = current
      await writeFileAtomic(
        path,
        serializeDraft({
          ...rest,
          link: fresh.link,
          image: imageChanged ? fresh.image : current.image,
          ...(imageChanged ? (fresh.images ? { images: fresh.images } : {}) : current.images ? { images: current.images } : {}),
          approved: false,
        }),
      )
      if (linkChanged) relinked.push(channel)
      if (imageChanged) reimaged.push(channel)
    }
  }
  const changed = [...new Set([...relinked, ...reimaged])]
  if (changed.length > 0) {
    await updateState(root, (s) => {
      for (const channel of changed) {
        if (getCell(s, article.id, channel)?.status === 'approved') {
          setCell(s, article.id, channel, { status: 'draft' }, new Date())
        }
      }
    })
  }
  return { created, relinked, reimaged }
}

export interface DraftView {
  channel: ChannelId
  path: string
  draft: ChannelDraft | null
  /** 실제 승인 여부 — 파일 approved + state 승인 칸 + 해시 일치 */
  approved: boolean
  /** state 칸의 상태 — 칸이 없으면 undefined */
  cellStatus?: CellStatus
  problems: Problem[]
}

export async function readDrafts(
  root: string,
  id: string,
  now: () => Date = () => new Date(),
): Promise<{ article: Article; views: DraftView[] }> {
  const config = await loadConfig(root)
  const article = await requireArticle(root, id)
  const state = await loadState(root)
  const downgrades: { channel: ChannelId; hash?: string }[] = []
  const views: DraftView[] = []

  for (const channel of config.channels) {
    const path = draftPath(root, id, channel)
    const cellStatus = getCell(state, id, channel)?.status
    if (!existsSync(path)) {
      views.push({
        channel,
        path,
        draft: null,
        approved: false,
        cellStatus,
        problems: [{ level: 'error', message: '초안 파일이 없습니다. `sns-relay fetch` 를 다시 실행하면 만들어집니다.' }],
      })
      continue
    }

    let draft: ChannelDraft
    try {
      draft = parseDraft(await readFile(path, 'utf8'), channel)
    } catch (e) {
      views.push({ channel, path, draft: null, approved: false, cellStatus, problems: [{ level: 'error', message: (e as Error).message }] })
      continue
    }

    const cell = getCell(state, id, channel)
    const locked = cell !== undefined && LOCKED_STATUSES.includes(cell.status)
    const stateApproved =
      cell !== undefined && APPROVAL_STATUSES.includes(cell.status) && cell.hash === hashDraft(draft)
    if (draft.approved && !stateApproved && !locked) {
      // 손으로 approved: true 를 썼거나, 승인 뒤 내용이 바뀌었다.
      draft = { ...draft, approved: false }
      await writeFileAtomic(path, serializeDraft(draft))
    }
    if (cell?.status === 'approved' && !(draft.approved && stateApproved)) {
      downgrades.push({ channel, hash: cell.hash })
    }

    const problems: Problem[] = []
    if (draft.link !== articleLink(article, channel, config.utm)) {
      problems.push({
        level: 'error',
        message: '링크가 현재 설정과 다릅니다. 링크는 프로그램이 만듭니다 — `sns-relay fetch <글 주소>` 를 다시 실행하면 맞춰집니다.',
      })
    }
    problems.push(...getChannel(channel).validate(draft, article))
    if (draft.images && draft.images[0] !== draft.image) {
      problems.push({
        level: 'error',
        message: '사진 목록의 첫 장과 대표 사진(image)이 다릅니다. sns-relay image 로 사진을 다시 정하세요.',
      })
    }
    if (draft.images && draft.images.length > MAX_IMAGES) {
      problems.push({ level: 'error', message: `사진은 ${MAX_IMAGES}장까지 올릴 수 있습니다(지금 ${draft.images.length}장).` })
    }
    if (channel === 'instagram' && draft.image !== article.image) {
      problems.push({ level: 'warn', message: '이미지가 글의 대표 이미지와 다릅니다.' })
    }
    if ((channel === 'threads' || channel === 'facebook') && article.canonicalUrl === '' && draft.image !== draftImage(article, channel)) {
      problems.push({ level: 'warn', message: '사진이 작업 사진과 다릅니다.' })
    }
    if (channel === 'naver' && draft.title?.trim() === article.title.trim()) {
      problems.push({ level: 'warn', message: '네이버 제목이 원문 제목 그대로입니다. 검색어가 들어간 제목으로 고치세요.' })
    }

    views.push({ channel, path, draft, approved: draft.approved && stateApproved, cellStatus, problems })
  }

  if (downgrades.length > 0) {
    await updateState(root, (s) => {
      for (const d of downgrades) {
        const current = getCell(s, id, d.channel)
        // 그사이 다른 작업이 칸을 바꿨으면 건드리지 않는다.
        if (current?.status === 'approved' && current.hash === d.hash) {
          setCell(s, id, d.channel, { status: 'draft' }, now())
        }
      }
    })
  }
  return { article, views }
}
