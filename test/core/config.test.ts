import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultConfig, initWorkspace, loadConfig } from '../../src/core/config.js'
import { ENV_KEYS } from '../../src/core/env.js'
import { makeTempDir } from '../helpers.js'

describe('initWorkspace', () => {
  it('없는 폴더(중첩 포함)도 만든다', async () => {
    const root = join(makeTempDir(), 'new', 'nested')
    const r = await initWorkspace(root)
    expect(existsSync(join(root, 'config.json'))).toBe(true)
    expect(r.created).toContain('config.json')
    const env = readFileSync(join(root, '.env'), 'utf8')
    for (const key of ENV_KEYS) expect(env).toContain(`${key}=`)
  })

  it('config.json · .env · .gitignore · work/ 를 만든다', async () => {
    const root = makeTempDir()
    const r = await initWorkspace(root)
    expect(r.created.sort()).toEqual(['.env', '.gitignore', 'config.json', 'work/'])
    expect(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))).toEqual(defaultConfig())
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain('THREADS_TOKEN=')
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.env')
    expect(existsSync(join(root, 'work'))).toBe(true)
  })

  it('이미 있는 파일은 건드리지 않는다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=keep\n')
    const r = await initWorkspace(root)
    expect(r.skipped).toContain('.env')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('THREADS_TOKEN=keep\n')
  })

  it('.gitignore 가 있으면 빠진 .env · work/ 만 덧붙이고 원래 내용은 그대로 둔다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.gitignore'), 'node_modules/')
    const r = await initWorkspace(root)
    expect(r.updated).toEqual(['.gitignore'])
    expect(r.added).toEqual(['.env', 'work/'])
    expect(r.skipped).not.toContain('.gitignore')
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n.env\nwork/\n')
  })

  it('.gitignore 에 둘 다 있으면 건드리지 않는다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.gitignore'), 'work/\n.env\n')
    const r = await initWorkspace(root)
    expect(r.skipped).toContain('.gitignore')
    expect(r.updated).toEqual([])
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('work/\n.env\n')
  })
})

describe('loadConfig', () => {
  it('notes.common(채널 공통 말투 메모)을 받는다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'config.json'), JSON.stringify({ ...defaultConfig(), notes: { common: '짧게', naver: '쉽게' } }))
    expect((await loadConfig(root)).notes).toEqual({ common: '짧게', naver: '쉽게' })
  })

  it('같은 채널이 두 번 있으면 거부한다', async () => {
    const root = makeTempDir()
    const bad = { ...defaultConfig(), channels: ['threads', 'threads'] }
    writeFileSync(join(root, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(root)).rejects.toThrow('같은 채널이 두 번')
  })

  it('init 한 설정을 읽는다', async () => {
    const root = makeTempDir()
    await initWorkspace(root)
    const c = await loadConfig(root)
    expect(c.channels).toEqual(['threads', 'instagram', 'facebook', 'naver'])
    expect(c.utm.medium).toBe('social')
  })

  it('기본 config 의 imageHost 는 url 이고, 없는 예전 config.json 도 url 로 읽힌다', async () => {
    expect(defaultConfig().imageHost).toBe('url')
    const root = makeTempDir()
    const { imageHost: _omit, ...old } = defaultConfig()
    writeFileSync(join(root, 'config.json'), JSON.stringify(old))
    expect((await loadConfig(root)).imageHost).toBe('url')
  })

  it('config.json 이 없으면 init 을 안내한다', async () => {
    await expect(loadConfig(makeTempDir())).rejects.toThrow('sns-relay init')
  })

  it('모르는 채널이 있으면 형식 오류를 낸다', async () => {
    const root = makeTempDir()
    const bad = { ...defaultConfig(), channels: ['threads', 'tiktok'] }
    writeFileSync(join(root, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(root)).rejects.toThrow('config.json 형식 오류')
  })

  it('notes 를 생략해도 된다', async () => {
    const root = makeTempDir()
    const { notes, ...rest } = defaultConfig()
    writeFileSync(join(root, 'config.json'), JSON.stringify(rest))
    expect((await loadConfig(root)).notes).toEqual({})
  })
})
