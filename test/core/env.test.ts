import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENV_KEYS, loadEnv, requireEnv, scrubEnvValues } from '../../src/core/env.js'
import { makeTempDir } from '../helpers.js'

describe('loadEnv', () => {
  it('.env 가 없으면 빈 객체', () => {
    expect(loadEnv(makeTempDir())).toEqual({})
  })

  it('알려진 키의 값만 읽고, 빈 값·모르는 키·주석은 버린다', () => {
    const root = makeTempDir()
    writeFileSync(
      join(root, '.env'),
      '# 주석\nTHREADS_USER_ID=42\nTHREADS_TOKEN= abc \nIG_TOKEN=\nOTHER=x\nFB_PAGE_ID="123"\n',
    )
    expect(loadEnv(root)).toEqual({ THREADS_USER_ID: '42', THREADS_TOKEN: 'abc', FB_PAGE_ID: '123' })
  })

  it('CRLF 파일도 읽는다', () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), 'THREADS_USER_ID=42\r\nTHREADS_TOKEN=abc\r\n')
    expect(loadEnv(root)).toEqual({ THREADS_USER_ID: '42', THREADS_TOKEN: 'abc' })
  })
})

describe('loadEnv — BOM', () => {
  it('맨 앞 BOM 이 있어도 첫 키를 읽는다', () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env'), '\uFEFFTHREADS_USER_ID=42\n')
    expect(loadEnv(root).THREADS_USER_ID).toBe('42')
  })
})

describe('scrubEnvValues', () => {
  it('긴 값부터 가린다', () => {
    expect(scrubEnvValues('x ab1234cd99 y 1234', { META_APP_ID: '1234', META_APP_SECRET: 'ab1234cd99' })).toBe('x *** y ***')
  })
})

describe('requireEnv', () => {
  it('빠진 키 이름만 알려 주고 값은 싣지 않는다', () => {
    expect(() => requireEnv({ THREADS_TOKEN: 'SECRET' }, ['THREADS_USER_ID', 'THREADS_TOKEN'])).toThrow(
      /THREADS_USER_ID/,
    )
    try {
      requireEnv({ THREADS_TOKEN: 'SECRET' }, ['THREADS_USER_ID', 'THREADS_TOKEN'])
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRET')
    }
  })

  it('모두 있으면 값을 돌려준다', () => {
    expect(requireEnv({ THREADS_USER_ID: '1', THREADS_TOKEN: 't' }, ['THREADS_USER_ID', 'THREADS_TOKEN'])).toEqual({
      THREADS_USER_ID: '1',
      THREADS_TOKEN: 't',
    })
  })

  it('키는 17개', () => {
    expect(ENV_KEYS).toHaveLength(17)
  })
})
