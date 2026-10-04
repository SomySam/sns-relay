import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadEnv } from '../../src/core/env.js'
import { updateEnvFile } from '../../src/core/env-file.js'
import { makeTempDir } from '../helpers.js'

describe('updateEnvFile', () => {
  it('지정한 키만 바꾸고 주석·다른 줄·순서는 그대로 둔다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), '# 주석\nTHREADS_USER_ID=42\nTHREADS_TOKEN=old\n\n# IG\nIG_TOKEN=keep\n')
    await updateEnvFile(root, { THREADS_TOKEN: 'new' })
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('# 주석\nTHREADS_USER_ID=42\nTHREADS_TOKEN=new\n\n# IG\nIG_TOKEN=keep\n')
  })

  it('없는 키는 끝에 덧붙인다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), 'THREADS_TOKEN=old')
    await updateEnvFile(root, { THREADS_TOKEN_EXPIRES_AT: '2026-11-29' })
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('THREADS_TOKEN=old\nTHREADS_TOKEN_EXPIRES_AT=2026-11-29\n')
  })

  it('CRLF 파일은 CRLF 로 유지하고, 따옴표·공백이 있던 줄도 바꾼다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), 'IG_TOKEN = "old"\r\nIG_USER_ID=1\r\n')
    await updateEnvFile(root, { IG_TOKEN: 'new' })
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('IG_TOKEN=new\r\nIG_USER_ID=1\r\n')
    expect(loadEnv(root).IG_TOKEN).toBe('new')
  })

  it('같은 키가 여러 줄이면 마지막 줄만 새 값, 앞 줄은 값 없는 주석으로 바꾼다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), 'A=1\nTHREADS_TOKEN=old1\nB=2\nTHREADS_TOKEN=old2\n')
    await updateEnvFile(root, { THREADS_TOKEN: 'new' })
    const text = readFileSync(join(root, '.env'), 'utf8')
    expect(text).not.toContain('old1')
    expect(text).not.toContain('old2')
    expect(text).toBe('A=1\n# (sns-relay: 아래 줄로 대체됨) THREADS_TOKEN=***\nB=2\nTHREADS_TOKEN=new\n')
    expect(loadEnv(root).THREADS_TOKEN).toBe('new')
  })

  it('export 접두어는 유지하고 줄을 덧붙이지 않는다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), 'export IG_TOKEN=old\n')
    await updateEnvFile(root, { IG_TOKEN: 'new' })
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('export IG_TOKEN=new\n')
    expect(loadEnv(root).IG_TOKEN).toBe('new')
  })

  it('.env 가 없으면 오류', async () => {
    await expect(updateEnvFile(makeTempDir(), { IG_TOKEN: 'x' })).rejects.toThrow('.env 가 없습니다')
  })

  it('값에 줄바꿈이 있으면 거부한다', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), 'IG_TOKEN=old\n')
    await expect(updateEnvFile(root, { IG_TOKEN: 'a\nb' })).rejects.toThrow('줄바꿈')
  })
})
