import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/program.js'
import { installMockAgent, makeIo, makeTempDir } from '../helpers.js'

describe('runCli', () => {
  it('--version 은 package.json 의 버전을 출력하고 0 으로 끝난다', async () => {
    const t = makeIo()
    const code = await runCli(['--version'], t.io)
    expect(code).toBe(0)
    expect(t.out.join('\n')).toBe('0.2.0')
  })
})

describe('명령 해석', () => {
  it('모르는 명령은 0 이 아닌 코드로 끝난다', async () => {
    const t = makeIo()
    expect(await runCli(['nope'], t.io)).not.toBe(0)
  })
})

describe('init', () => {
  it('작업 폴더를 만들고 다음 할 일을 알려 준다', async () => {
    const root = makeTempDir()
    const t = makeIo(root)
    expect(await runCli(['init'], t.io)).toBe(0)
    expect(existsSync(join(root, 'config.json'))).toBe(true)
    expect(t.out.join('\n')).toContain('만듦: config.json')
    expect(t.out.join('\n')).toContain('.env')
  })

  it('이미 있는 .gitignore 에 항목을 덧붙이면 갱신으로 알린다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
    const t = makeIo(root)
    expect(await runCli(['init'], t.io)).toBe(0)
    expect(t.out).toContain('갱신: .gitignore (.env, work/ 추가)')
  })

  it('--dir 가 없는 폴더여도 만들어 준다', async () => {
    const root = join(makeTempDir(), 'new-folder')
    const t = makeIo(makeTempDir())
    expect(await runCli(['init', '--dir', root], t.io)).toBe(0)
    expect(existsSync(join(root, 'config.json'))).toBe(true)
  })

  it('--dir 로 다른 폴더를 지정할 수 있다', async () => {
    const root = makeTempDir()
    const t = makeIo(makeTempDir())
    expect(await runCli(['init', '--dir', root], t.io)).toBe(0)
    expect(existsSync(join(root, 'config.json'))).toBe(true)
  })
})

describe('fetch', () => {
  const html = readFileSync(new URL('../fixtures/article.html', import.meta.url), 'utf8')
  let restore: () => Promise<void>
  let root: string

  beforeEach(async () => {
    root = makeTempDir()
    await runCli(['init'], makeIo(root).io)
    const m = installMockAgent()
    restore = m.restore
    m.agent
      .get('https://blog.example.com')
      .intercept({ path: '/blog/ai-task-brief', method: 'GET' })
      .reply(200, html, { headers: { 'content-type': 'text/html' } })
  })
  afterEach(() => restore())

  it('작업 이름·제목·저장 위치를 출력한다', async () => {
    const t = makeIo(root)
    expect(await runCli(['fetch', 'https://blog.example.com/blog/ai-task-brief'], t.io)).toBe(0)
    const out = t.out.join('\n')
    expect(out).toContain('ai-task-brief — AI 업무 브리프 쓰는 법')
    expect(out).toContain('대표 이미지 있음')
    expect(out).toContain(join('work', 'ai-task-brief', 'article.json'))
    expect(out).toContain('(새로 만듦: threads, instagram, facebook, naver)')
    expect(out).toContain('다음: 초안 본문을 채운 뒤 sns-relay drafts ai-task-brief')
  })

  it('실패하면 오류를 stderr 로 내고 1 로 끝난다', async () => {
    const t = makeIo(makeTempDir()) // init 하지 않은 폴더
    expect(await runCli(['fetch', 'https://blog.example.com/blog/ai-task-brief'], t.io)).toBe(1)
    expect(t.err.join('\n')).toContain('sns-relay init')
  })
})
