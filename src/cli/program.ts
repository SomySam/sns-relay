import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { Command, CommanderError } from 'commander'
import { approveDrafts } from '../core/approve.js'
import { countChars, parseChannelList } from '../core/channels/index.js'
import { initWorkspace, loadConfig } from '../core/config.js'
import { readDrafts } from '../core/draft-files.js'
import { articleImages } from '../core/drafts.js'
import { fetchArticle } from '../core/fetch-article.js'
import { runDoctor, type HealthReport } from '../core/health.js'
import { markPublished } from '../core/mark.js'
import { createFromNotes, rehostImage } from '../core/notes.js'
import { exportNaver } from '../core/naver.js'
import { publishArticle } from '../core/publish.js'
import { resolveUnknown } from '../core/resolve.js'
import { loadRules } from '../core/rules.js'
import { articleStatus, listArticleIds } from '../core/status.js'
import type { ChannelId, Problem } from '../core/types.js'
import { VERSION } from '../core/version.js'
import { assertPageTokenReady, issuePageToken } from '../core/fb-page-token.js'
import { refreshToken } from '../core/token-refresh.js'
import { createServer } from '../mcp/server.js'
import { openInDefaultApp } from '../os/open-file.js'

export interface Io {
  out(line: string): void
  err(line: string): void
  cwd: string
  sleep?: (ms: number) => Promise<void>
  /** 파일을 기본 앱으로 연다 — 테스트에서 바꿔 넣는다. */
  open?: (path: string) => Promise<void>
  /** 환경 변수 — 테스트에서 바꿔 넣는다. 없으면 빈 것으로 본다. */
  env?: Record<string, string | undefined>
  /** 화면에 보이지 않게 한 줄을 입력받는다(비밀용). 없으면 비대화형. */
  readSecret?: (prompt: string) => Promise<string>
}

const collect = (v: string, prev: string[]): string[] => [...prev, v]

export async function runCli(argv: string[], io: Io): Promise<number> {
  const program = new Command()
    .name('sns-relay')
    .description('블로그 글 → SNS 채널별 초안 → 승인 → 게시')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (s) => io.out(s.trimEnd()),
      writeErr: (s) => io.err(s.trimEnd()),
    })

  const rootOf = (opts: { dir?: string }) => resolve(io.cwd, opts.dir ?? '.')
  let exitCode = 0
  const rel = (path: string) => relative(io.cwd, path) || path
  const printProblems = (problems: Problem[]) => {
    for (const p of problems) io.out(`    ${p.level === 'error' ? '✖' : '⚠'} ${p.message}`)
  }
  const joinNames = (names: ChannelId[]) => names.join(', ')

  program
    .command('init')
    .description('작업 폴더에 config.json · .env · work/ 를 만든다')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (opts: { dir?: string }) => {
      const root = rootOf(opts)
      const { created, skipped, updated, added } = await initWorkspace(root)
      for (const name of created) io.out(`만듦: ${name}`)
      for (const name of updated) io.out(`갱신: ${name} (${added.join(', ')} 추가)`)
      for (const name of skipped) io.out(`이미 있음(그대로 둠): ${name}`)
      io.out('')
      io.out('다음 할 일:')
      io.out('  1. config.json 에서 쓸 채널과 UTM 규칙을 확인하세요.')
      io.out('  2. .env 에 채널 토큰을 채우세요 (게시 단계에서 필요).')
      io.out('  3. sns-relay fetch <블로그 글 주소>')
    })

  program
    .command('fetch')
    .description('블로그 글을 가져와 work/<id>/article.json 에 저장한다')
    .argument('<url>', '블로그 글 주소')
    .option('--id <id>', '작업 이름 직접 지정 (기본: 주소에서 만듦)')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (url: string, opts: { id?: string; dir?: string }) => {
      const root = rootOf(opts)
      const { article, path, reused, drafts } = await fetchArticle(root, url, { id: opts.id })
      io.out(`✔ ${article.id} — ${article.title}${reused ? ' (기존 작업 갱신)' : ''}`)
      io.out(
        `  본문 ${article.text.length.toLocaleString('ko-KR')}자 · 대표 이미지 ${article.image ? '있음' : '없음'}`,
      )
      io.out(`  저장: ${rel(path)}`)
      const notes = [
        drafts.created.length > 0 ? `새로 만듦: ${joinNames(drafts.created)}` : '',
        drafts.relinked.length > 0 ? `링크 갱신: ${joinNames(drafts.relinked)}` : '',
        drafts.reimaged.length > 0 ? `이미지 갱신: ${joinNames(drafts.reimaged)}` : '',
      ].filter(Boolean)
      io.out(`  초안: ${rel(join(root, 'work', article.id, 'drafts'))}/ (${notes.join(' · ') || '그대로'})`)
      io.out(`  다음: 초안 본문을 채운 뒤 sns-relay drafts ${article.id}`)
    })

  program
    .command('new')
    .description('글감(와 사진·링크)으로 작업을 만든다 — 블로그 주소가 없는 글')
    .requiredOption('--title <제목>', '작업 제목')
    .requiredOption('--text <파일>', '글감 텍스트 파일(UTF-8)')
    .option('--image <파일 또는 주소>', '사진 파일 경로 또는 공개 이미지 주소(여러 번 주면 여러 장, 첫 장이 대표, 최대 10장)', collect, [] as string[])
    .option('--link <주소>', '글에 붙일 링크(없으면 링크 없이 게시)')
    .option('--id <이름>', '작업 이름(기본: 제목에서 만든다)')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (opts: { title: string; text: string; image: string[]; link?: string; id?: string; dir?: string }) => {
      const root = rootOf(opts)
      let text: string
      try {
        text = readFileSync(resolve(io.cwd, opts.text), 'utf8')
      } catch {
        throw new Error(`글감 파일을 읽지 못했습니다: ${opts.text}`)
      }
      const images = opts.image.map((v) => (/^https?:\/\//i.test(v) ? { url: v } : { file: resolve(io.cwd, v) }))
      const r = await createFromNotes(root, { title: opts.title, text, images, link: opts.link, id: opts.id })
      const shown = articleImages(r.article)
      const photo = shown.length > 0 ? `사진 ${shown.length}장 ${r.uploaded ? '올림' : '주소'}` : '사진 없음'
      io.out(`✔ ${r.article.id} — ${r.article.title} (글감 ${r.article.text.length.toLocaleString('ko-KR')}자, ${r.article.canonicalUrl ? '링크 있음' : '링크 없음'}, ${photo})`)
      for (const [i, u] of shown.entries()) io.out(shown.length > 1 ? `  사진 ${i + 1}: ${u}` : `  사진: ${u}`)
      io.out(`  초안: ${rel(join(root, 'work', r.article.id, 'drafts'))}`)
      io.out(`  다음: 초안 본문을 채운 뒤 sns-relay drafts ${r.article.id}`)
    })

  program
    .command('image')
    .description('작업 사진을 Cloudinary 에 올려 JPEG 주소로 바꾼다(imageHost: cloudinary)')
    .argument('<id>', '작업 이름')
    .option('--file <경로>', '올릴 사진 파일(여러 번 주면 사진 전체를 그 순서로 바꾼다)', collect, [] as string[])
    .option('--url <주소>', '옮겨 올릴 이미지 주소(여러 번 가능)', collect, [] as string[])
    .option('--article', '작업의 지금 대표 이미지(첫 장)를 옮겨 올린다(예: WebP 대표 이미지)')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (id: string, opts: { file: string[]; url: string[]; article?: boolean; dir?: string }) => {
      const given = opts.file.length + opts.url.length
      if (opts.article ? given > 0 : given === 0) throw new Error('--file·--url(여러 번 가능) 과 --article 중 하나만 주세요.')
      const source = opts.article
        ? ({ article: true } as const)
        : [...opts.file.map((f) => ({ file: resolve(io.cwd, f) })), ...opts.url.map((u) => ({ url: u }))]
      const r = await rehostImage(rootOf(opts), id, source)
      io.out(r.urls.length > 1 ? `✔ 사진 ${r.urls.length}장을 Cloudinary 에 올렸습니다(첫 장이 대표):` : `✔ 사진을 Cloudinary 에 올렸습니다: ${r.url}`)
      if (r.urls.length > 1) for (const [i, u] of r.urls.entries()) io.out(`  사진 ${i + 1}: ${u}`)
      if (r.reimaged.length > 0) io.out(`  이미지 갱신: ${r.reimaged.join(', ')} (승인이 풀렸습니다 — 다시 확인 후 승인하세요)`)
    })

  program
    .command('rules')
    .description('초안 작성 규칙을 출력한다 (스킬·MCP 와 같은 규칙)')
    .argument('[channel]', '채널 하나만 (threads | instagram | facebook | naver)')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (channel: string | undefined, opts: { dir?: string }) => {
      const root = rootOf(opts)
      const config = existsSync(join(root, 'config.json')) ? await loadConfig(root) : undefined
      const channels = channel ? parseChannelList(channel) : config?.channels
      io.out(loadRules({ channels, notes: config?.notes }).trimEnd())
    })

  program
    .command('drafts')
    .description('작업의 채널별 초안 상태와 검증 결과를 보여 준다')
    .argument('<id>', '작업 이름')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (id: string, opts: { dir?: string }) => {
      const { article, views } = await readDrafts(rootOf(opts), id)
      io.out(`${article.id} — ${article.title}`)
      for (const v of views) {
        const chars = v.draft ? `${countChars(v.draft.body).toLocaleString('ko-KR')}자` : '-'
        io.out(`  ${v.channel.padEnd(10)}${v.approved ? '승인됨' : v.cellStatus === 'manual' ? '수동 발행 대기' : '미승인'}  ${chars}  ${rel(v.path)}`)
        if (v.draft?.title !== undefined) io.out(`    제목: ${v.draft.title}`)
        if (v.channel === 'naver') io.out(`    태그: ${v.draft?.tags?.length ? v.draft.tags.join(', ') : '(없음)'}`)
        if (v.draft) io.out(`    링크: ${v.draft.link || '(링크 없음)'}`)
        if (v.draft?.images) io.out(`    이미지: ${v.draft.images.length}장 (첫 장: ${v.draft.image})`)
        else if (v.draft?.image) io.out(`    이미지: ${v.draft.image}`)
        printProblems(v.problems)
      }
    })

  program
    .command('approve')
    .description('검증을 통과한 초안을 승인한다 (오너가 확인한 뒤에만)')
    .argument('<id>', '작업 이름')
    .option('--channels <list>', '승인할 채널, 쉼표로 구분 (기본: config 의 전체 채널)')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (id: string, opts: { channels?: string; dir?: string }) => {
      const channels = opts.channels !== undefined ? parseChannelList(opts.channels) : undefined
      if (channels && channels.length === 0) throw new Error('채널을 하나 이상 지정하세요.')
      const results = await approveDrafts(rootOf(opts), id, channels)
      for (const r of results) {
        io.out(r.approved ? `✔ ${r.channel} 승인` : `✖ ${r.channel} 승인 안 됨`)
        printProblems(r.problems)
      }
      if (results.some((r) => !r.approved)) exitCode = 1
    })

  program
    .command('publish')
    .description('승인된 초안을 게시한다 (먼저 --dry-run 으로 확인)')
    .argument('<id>', '작업 이름')
    .option('--channels <list>', '게시할 채널, 쉼표로 구분 (실제 게시에는 필수)')
    .option('--dry-run', '게시하지 않고 최종 문구·링크만 보여 준다')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (id: string, opts: { channels?: string; dryRun?: boolean; dir?: string }) => {
      const channels = opts.channels !== undefined ? parseChannelList(opts.channels) : undefined
      if (channels && channels.length === 0) throw new Error('채널을 하나 이상 지정하세요.')
      if (!opts.dryRun && channels === undefined) throw new Error('실제 게시는 --channels 로 올릴 채널을 지정하세요 (예: --channels threads).')
      const reports = await publishArticle(rootOf(opts), id, {
        channels,
        dryRun: opts.dryRun,
        sleep: io.sleep,
        progress: (channel, message) => io.err(`${channel}: ${message}`),
      })
      for (const r of reports) {
        switch (r.outcome) {
          case 'dry-run':
            io.out(`[미리보기] ${r.channel}`)
            io.out(`  링크: ${r.preview!.link || '(링크 없음)'}${r.channel === 'instagram' ? ' (인스타 본문에는 붙지 않음)' : ''}`)
            if (r.preview!.images) io.out(`  이미지: ${r.preview!.images.length}장 (첫 장: ${r.preview!.image})`)
            else if (r.preview!.image) io.out(`  이미지: ${r.preview!.image}`)
            io.out('  ---')
            for (const line of r.preview!.body.split('\n')) io.out(`  ${line}`)
            io.out('  ---')
            if (r.checks) {
              if (!r.checks.some((p) => p.level === 'error')) io.out('    ✔ 게시 전 확인 통과')
              printProblems(r.checks)
            }
            break
          case 'published':
            io.out(`✔ ${r.channel} 게시됨 ${r.postUrl ?? `(${r.reason ?? '주소 없음'})`}`)
            if (r.postUrl && r.reason) io.out(`    ⚠ ${r.reason}`)
            break
          case 'unknown':
            io.out(`? ${r.channel} 결과 불명 — ${r.reason}`)
            break
          case 'failed':
            io.out(`✖ ${r.channel} 실패 — ${r.reason}`)
            break
          case 'blocked':
            io.out(`✖ ${r.channel} 게시 안 함 — ${r.reason}`)
            break
        }
      }
      if (opts.dryRun && reports.some((r) => r.outcome === 'dry-run') && !reports.some((r) => r.checks?.some((p) => p.level === 'error'))) {
        io.out('게시하려면 --channels <채널> 을 붙여 --dry-run 없이 다시 실행하세요.')
      }
      if (reports.length === 0) {
        io.out('게시할 채널이 없습니다. config.json 의 channels 에 자동 게시를 지원하는 채널(threads, instagram, facebook)이 있는지 확인하세요.')
        exitCode = 1
      }
      if (reports.some((r) => r.checks?.some((p) => p.level === 'error'))) exitCode = 1
      if (reports.some((r) => (r.outcome !== 'published' && r.outcome !== 'dry-run') || r.recorded === false)) {
        exitCode = 1
      }
    })

  program
    .command('status')
    .description('글 × 채널 상태를 보여 준다')
    .argument('[id]', '작업 이름 (없으면 전체)')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (id: string | undefined, opts: { dir?: string }) => {
      const root = rootOf(opts)
      const ids = id ? [id] : await listArticleIds(root)
      if (ids.length === 0) {
        io.out('작업이 없습니다. sns-relay fetch <글 주소> 로 시작하세요.')
        return
      }
      for (const articleId of ids) {
        const row = await articleStatus(root, articleId)
        io.out(`${row.id} — ${row.title}`)
        for (const c of row.cells) io.out(`  ${c.channel.padEnd(10)} ${c.label}${c.detail ? `  ${c.detail}` : ''}`)
      }
    })

  program
    .command('resolve')
    .description('게시 결과를 모르는(unknown) 칸을 채널에서 확인한 대로 확정한다')
    .argument('<id>', '작업 이름')
    .argument('<channel>', '채널')
    .option('--published <url>', '게시된 것을 확인했다 — 게시물 주소')
    .option('--not-published', '게시되지 않은 것을 확인했다 — 다시 게시할 수 있게 한다')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (id: string, channel: string, opts: { published?: string; notPublished?: boolean; dir?: string }) => {
      if ((opts.published === undefined) === !opts.notPublished) {
        throw new Error('--published <주소> 와 --not-published 중 하나만 지정하세요.')
      }
      const [ch] = parseChannelList(channel)
      const how = opts.published !== undefined ? { postUrl: opts.published } : ({ notPublished: true } as const)
      const cell = await resolveUnknown(rootOf(opts), id, ch, how)
      io.out(`✔ ${id} ${ch} → ${cell.status}`)
    })

  program
    .command('naver')
    .description('승인된 네이버 초안으로 붙여 넣기용 원고(naver.md)를 만들고 기본 앱으로 연다')
    .argument('<id>', '작업 이름')
    .option('--no-open', '파일을 열지 않는다')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (id: string, opts: { open: boolean; dir?: string }) => {
      const { title, tags, path } = await exportNaver(rootOf(opts), id)
      io.out(`✔ 네이버 붙여 넣기용 원고를 만들었습니다: ${rel(path)}`)
      io.out(`  제목: ${title}`)
      io.out(tags.length > 0 ? `  태그(하나씩 입력 후 Enter): ${tags.join(' / ')}` : '  태그: 없음')
      if (opts.open) {
        try {
          await (io.open ?? openInDefaultApp)(path)
          io.out('  파일을 열었습니다. 칸별로 복사해 붙여 넣으세요.')
        } catch (e) {
          io.err(`파일을 열지 못했습니다(${(e as Error).message}). 직접 여세요: ${path}`)
        }
      }
      io.out(`  발행 후: sns-relay mark naver ${id} --url <발행 주소>`)
    })

  program
    .command('mark')
    .description('직접 발행한 글(네이버)의 주소를 기록한다')
    .argument('<channel>', '채널 (naver)')
    .argument('<id>', '작업 이름')
    .requiredOption('--url <url>', '발행한 글 주소')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (channel: string, id: string, opts: { url: string; dir?: string }) => {
      const channels = parseChannelList(channel)
      if (channels.length !== 1) throw new Error('채널을 하나만 지정하세요.')
      const cell = await markPublished(rootOf(opts), id, channels[0], opts.url)
      io.out(`✔ ${id} ${channels[0]} → ${cell.status} ${cell.postUrl}`)
    })

  const HEALTH_MARK: Record<HealthReport['level'], string> = { ok: '✔', warn: '⚠', error: '✖', skip: '-' }

  program
    .command('doctor')
    .description('채널별 토큰·권한·만료일을 점검한다 (읽기 전용)')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (opts: { dir?: string }) => {
      const reports = await runDoctor(rootOf(opts))
      for (const r of reports) {
        io.out(`${HEALTH_MARK[r.level]} ${r.channel}${r.account ? ` ${r.account}` : ''}`)
        for (const m of r.messages) io.out(`    ${m}`)
      }
      if (reports.some((r) => r.level === 'error')) exitCode = 1
    })

  const token = program.command('token').description('채널 토큰 관리')
  token
    .command('refresh')
    .description('Threads·Instagram 장기 토큰을 갱신해 .env 에 쓴다 (값은 화면에 내지 않는다)')
    .argument('<channel>', 'threads 또는 instagram')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (channel: string, opts: { dir?: string }) => {
      if (channel !== 'threads' && channel !== 'instagram') {
        throw new Error(`토큰 갱신은 threads, instagram 만 됩니다 (받은 값: ${channel}). 페이스북 페이지 토큰은 만료가 없고, 데이터 접근이 끝나면 다시 발급합니다.`)
      }
      const r = await refreshToken(rootOf(opts), channel)
      io.out(`✔ ${r.channel} 토큰을 갱신했습니다 — 만료 ${r.expiresAt}. .env 에 저장했습니다.`)
    })

  token
    .command('page')
    .description('Graph API 탐색기의 사용자 토큰으로 페이스북 페이지 토큰(만료 없음)을 발급해 .env 에 쓴다')
    .option('--dir <path>', '작업 폴더 (기본: 현재 폴더)')
    .action(async (opts: { dir?: string }) => {
      if (!io.readSecret) throw new Error('토큰 입력은 터미널에서만 할 수 있습니다. 터미널에서 sns-relay token page 를 실행하세요.')
      assertPageTokenReady(rootOf(opts))
      const short = await io.readSecret('Graph API 탐색기에서 받은 사용자 토큰을 붙여 넣으세요(화면에 보이지 않음): ')
      const r = await issuePageToken(rootOf(opts), short)
      io.out(`✔ 페이스북 페이지 「${r.pageName}」(${r.pageId}) 토큰을 .env 에 저장했습니다. sns-relay doctor 로 확인하세요.`)
    })

  program
    .command('mcp')
    .description('MCP 서버를 stdio 로 띄운다 (Claude Desktop·Claude Code 플러그인에서 사용)')
    .option('--dir <path>', '작업 폴더 (config.json 이 있는 곳). 없으면 환경 변수 SNS_RELAY_DIR')
    .action(async (opts: { dir?: string }) => {
      const dir = opts.dir ?? io.env?.SNS_RELAY_DIR
      if (!dir) {
        io.err('작업 폴더를 --dir <작업 폴더> 또는 환경 변수 SNS_RELAY_DIR 로 지정하세요.')
        exitCode = 1
        return
      }
      const root = rootOf({ dir })
      if (!existsSync(join(root, 'config.json'))) {
        io.err(`작업 폴더에 config.json 이 없습니다: ${root} — sns-relay init --dir <작업 폴더> 로 먼저 만드세요.`)
        exitCode = 1
        return
      }
      // stdio 모드: stdout 은 MCP 메시지 전용이다. 여기서 io.out 을 쓰지 않는다.
      serveStdio(() => createServer({ root }), { onerror: (e) => io.err(`mcp: ${e.message}`) })
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
    return exitCode
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode
    io.err(`오류: ${(e as Error).message}`)
    return 1
  }
}
