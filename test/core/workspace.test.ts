import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Article } from '../../src/core/types.js'
import { readArticle, requireArticle, saveArticle } from '../../src/core/workspace.js'
import { makeTempDir } from '../helpers.js'

const ARTICLE: Article = {
  id: 'post',
  url: 'https://a.com/post',
  canonicalUrl: 'https://a.com/post',
  title: '제목',
  text: '본문',
  image: null,
  links: { threads: 'https://a.com/post?utm_source=threads' },
  fetchedAt: '2026-09-29T00:00:00.000Z',
}

function writeRaw(root: string, content: string): void {
  mkdirSync(join(root, 'work', 'post'), { recursive: true })
  writeFileSync(join(root, 'work', 'post', 'article.json'), content)
}

describe('readArticle', () => {
  it('저장한 글을 그대로 읽는다', async () => {
    const root = makeTempDir()
    await saveArticle(root, ARTICLE)
    expect(await readArticle(root, 'post')).toEqual(ARTICLE)
  })

  it('없으면 null', async () => {
    expect(await readArticle(makeTempDir(), 'post')).toBeNull()
  })

  it('JSON 이 깨졌으면 한국어 오류와 경로를 알려 준다', async () => {
    const root = makeTempDir()
    writeRaw(root, '{ 깨짐')
    await expect(readArticle(root, 'post')).rejects.toThrow('article.json 형식 오류')
  })

  it('필드가 빠졌으면 형식 오류', async () => {
    const root = makeTempDir()
    const { title, ...rest } = ARTICLE
    writeRaw(root, JSON.stringify(rest))
    await expect(readArticle(root, 'post')).rejects.toThrow('article.json 형식 오류')
  })
})

describe('requireArticle', () => {
  it('없으면 fetch 를 안내한다', async () => {
    await expect(requireArticle(makeTempDir(), 'post')).rejects.toThrow('sns-relay fetch')
  })
})
