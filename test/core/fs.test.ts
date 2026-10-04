import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../../src/core/fs.js'
import { makeTempDir } from '../helpers.js'

describe('writeFileAtomic', () => {
  it('새 파일을 쓰고 임시 파일을 남기지 않는다', async () => {
    const dir = makeTempDir()
    await writeFileAtomic(join(dir, 'a.json'), '{"a":1}\n')
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('{"a":1}\n')
    expect(readdirSync(dir)).toEqual(['a.json'])
  })

  it('기존 파일을 덮어쓴다', async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'a.txt'), 'old')
    await writeFileAtomic(join(dir, 'a.txt'), 'new')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('new')
    expect(readdirSync(dir)).toEqual(['a.txt'])
  })

  it('이름 바꾸기가 끝내 실패하면 오류를 내고 임시 파일을 남기지 않는다', async () => {
    const dir = makeTempDir()
    const target = join(dir, 'target')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'x') // 비어 있지 않은 폴더 자리에는 파일로 이름을 바꿀 수 없다
    await expect(writeFileAtomic(target, 'new')).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['target'])
  })

  it.skipIf(process.platform === 'win32')('기존 파일 권한을 유지한다', async () => {
    const dir = makeTempDir()
    const path = join(dir, '.env')
    writeFileSync(path, 'A=1\n')
    chmodSync(path, 0o600)
    await writeFileAtomic(path, 'A=2\n')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})
