import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cellKey, getCell, loadState, saveState, setCell, statePath, updateState } from '../../src/core/state.js'
import { makeTempDir } from '../helpers.js'

const NOW = new Date('2026-09-29T01:00:00Z')

describe('state', () => {
  it('파일이 없으면 빈 상태', async () => {
    expect(await loadState(makeTempDir())).toEqual({})
  })

  it('저장한 상태를 다시 읽는다', async () => {
    const root = makeTempDir()
    const state = {}
    setCell(state, 'post', 'threads', { status: 'approved', hash: 'abc' }, NOW)
    await saveState(root, state)
    expect(statePath(root)).toBe(join(root, 'work', 'state.json'))
    expect(JSON.parse(readFileSync(statePath(root), 'utf8'))).toEqual({
      'post:threads': { status: 'approved', hash: 'abc', updatedAt: '2026-09-29T01:00:00.000Z' },
    })
    expect(getCell(await loadState(root), 'post', 'threads')?.hash).toBe('abc')
  })

  it('setCell 은 칸을 통째로 바꾼다', () => {
    const state = {}
    setCell(state, 'post', 'threads', { status: 'approved', hash: 'abc' }, NOW)
    setCell(state, 'post', 'threads', { status: 'draft' }, NOW)
    expect(getCell(state, 'post', 'threads')).toEqual({ status: 'draft', updatedAt: NOW.toISOString() })
  })

  it('cellKey 는 <id>:<channel>', () => {
    expect(cellKey('post', 'naver')).toBe('post:naver')
  })

  it('형식이 틀리면 한국어 오류', async () => {
    const root = makeTempDir()
    mkdirSync(join(root, 'work'), { recursive: true })
    writeFileSync(statePath(root), JSON.stringify({ 'post:threads': { status: 'done' } }))
    await expect(loadState(root)).rejects.toThrow('state.json 형식 오류')
  })
})

describe('updateState', () => {
  it('동시에 여러 번 불러도 변경이 하나도 사라지지 않는다', async () => {
    const root = makeTempDir()
    const channels = ['threads', 'instagram', 'facebook', 'naver'] as const
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        updateState(root, (s) => {
          setCell(s, `post${i}`, channels[i % 4], { status: 'approved', hash: String(i) }, NOW)
        }),
      ),
    )
    expect(Object.keys(await loadState(root))).toHaveLength(12)
    expect(existsSync(statePath(root) + '.lock')).toBe(false)
  })

  it('fn 이 던지면 저장하지 않고 잠금을 푼다', async () => {
    const root = makeTempDir()
    await expect(
      updateState(root, (s) => {
        setCell(s, 'post', 'threads', { status: 'approved' }, NOW)
        throw new Error('중단')
      }),
    ).rejects.toThrow('중단')
    expect(await loadState(root)).toEqual({})
    expect(existsSync(statePath(root) + '.lock')).toBe(false)
  })

  it('fn 의 반환값을 돌려준다', async () => {
    expect(await updateState(makeTempDir(), () => 7)).toBe(7)
  })

  it('30초보다 오래된 잠금은 버려진 것으로 보고 지운다', async () => {
    const root = makeTempDir()
    mkdirSync(join(root, 'work'), { recursive: true })
    const lock = statePath(root) + '.lock'
    writeFileSync(lock, '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    await updateState(root, (s) => {
      setCell(s, 'post', 'threads', { status: 'draft' }, NOW)
    })
    expect(getCell(await loadState(root), 'post', 'threads')?.status).toBe('draft')
  })
})
