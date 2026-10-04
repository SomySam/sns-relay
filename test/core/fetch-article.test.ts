import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace } from '../../src/core/config.js'
import { fetchArticle } from '../../src/core/fetch-article.js'
import { installMockAgent, makeTempDir } from '../helpers.js'

const html = readFileSync(new URL('../fixtures/article.html', import.meta.url), 'utf8')
const URL_ = 'https://blog.example.com/blog/ai-task-brief'
const HTML_HEADERS = { headers: { 'content-type': 'text/html; charset=utf-8' } }

let root: string
let agent: MockAgent
let restore: () => Promise<void>

beforeEach(async () => {
  root = makeTempDir()
  await initWorkspace(root)
  ;({ agent, restore } = installMockAgent())
})
afterEach(() => restore())

const blog = () => agent.get('https://blog.example.com')

describe('fetchArticle', () => {
  it('article.json 에 본문과 채널별 UTM 링크를 저장한다', async () => {
    blog().intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS)
    const now = () => new Date('2026-09-29T00:00:00Z')

    const r = await fetchArticle(root, URL_, { now })

    expect(r.reused).toBe(false)
    expect(r.path).toBe(join(root, 'work', 'ai-task-brief', 'article.json'))
    const saved = JSON.parse(readFileSync(r.path, 'utf8'))
    expect(saved).toMatchObject({
      id: 'ai-task-brief',
      url: URL_,
      canonicalUrl: URL_,
      title: 'AI 업무 브리프 쓰는 법',
      image: 'https://blog.example.com/images/cover.jpg',
      fetchedAt: '2026-09-29T00:00:00.000Z',
    })
    expect(Object.keys(saved.links)).toEqual(['threads', 'instagram', 'facebook', 'naver'])
    expect(saved.links.threads).toBe(`${URL_}?utm_source=threads&utm_medium=social&utm_campaign=ai-task-brief`)
  })

  it('같은 글을 다시 가져오면 같은 폴더를 이어 쓴다', async () => {
    blog().intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS).times(2)
    await fetchArticle(root, URL_)
    const again = await fetchArticle(root, URL_)
    expect(again.reused).toBe(true)
  })

  it('채널별 빈 초안 파일을 만들고, 다시 가져와도 덮어쓰지 않는다', async () => {
    blog().intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS).times(2)
    const first = await fetchArticle(root, URL_)
    expect(first.drafts.created).toEqual(['threads', 'instagram', 'facebook', 'naver'])
    expect(existsSync(join(root, 'work', 'ai-task-brief', 'drafts', 'naver.md'))).toBe(true)

    const again = await fetchArticle(root, URL_)
    expect(again.drafts).toEqual({ created: [], relinked: [], reimaged: [] })
  })

  it('--id 가 다른 글과 겹치면 거부한다', async () => {
    blog().intercept({ path: '/blog/ai-task-brief', method: 'GET' }).reply(200, html, HTML_HEADERS)
    await fetchArticle(root, URL_, { id: 'shared' })

    const other = html.replace('https://blog.example.com/blog/ai-task-brief', 'https://blog.example.com/blog/other')
    blog().intercept({ path: '/blog/other', method: 'GET' }).reply(200, other, HTML_HEADERS)
    await expect(fetchArticle(root, 'https://blog.example.com/blog/other', { id: 'shared' })).rejects.toThrow(
      '이미 다른 글',
    )
  })

  it('canonical 이 대문인 사이트에서도 글마다 다른 작업 이름을 쓴다', async () => {
    const siteWide = html.replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="https://blog.example.com/">')
    blog().intercept({ path: '/blog/first', method: 'GET' }).reply(200, siteWide, HTML_HEADERS)
    blog().intercept({ path: '/blog/second', method: 'GET' }).reply(200, siteWide, HTML_HEADERS)

    const a = await fetchArticle(root, 'https://blog.example.com/blog/first')
    const b = await fetchArticle(root, 'https://blog.example.com/blog/second')

    expect([a.article.id, b.article.id]).toEqual(['first', 'second'])
    expect(b.reused).toBe(false)
    expect(a.article.canonicalUrl).toBe('https://blog.example.com/blog/first')
    expect(b.article.links.threads).toContain('https://blog.example.com/blog/second?utm_source=threads')
  })

  it('--id 가 올바르지 않으면 네트워크 요청 전에 거부한다', async () => {
    await expect(fetchArticle(root, URL_, { id: '../etc' })).rejects.toThrow('작업 이름')
  })

  it('HTTP 오류를 알려 준다', async () => {
    blog().intercept({ path: '/blog/missing', method: 'GET' }).reply(404, 'not found')
    await expect(fetchArticle(root, 'https://blog.example.com/blog/missing')).rejects.toThrow('HTTP 404')
  })

  it('HTML 이 아니면 거부한다', async () => {
    blog()
      .intercept({ path: '/feed.json', method: 'GET' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
    await expect(fetchArticle(root, 'https://blog.example.com/feed.json')).rejects.toThrow('HTML 페이지가 아닙니다')
  })

  it('init 하지 않은 폴더에서는 init 을 안내한다', async () => {
    await expect(fetchArticle(makeTempDir(), URL_)).rejects.toThrow('sns-relay init')
  })
})
