import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadRules } from '../../src/core/rules.js'

describe('loadRules', () => {
  it('기본은 공통 규칙과 네 채널 규칙을 순서대로 싣는다', () => {
    const text = loadRules()
    const order = ['# 공통 규칙', '# Threads', '# Instagram', '# Facebook 페이지', '# 네이버 블로그'].map((h) =>
      text.indexOf(h),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('지정한 채널만 싣는다', () => {
    const text = loadRules({ channels: ['naver'] })
    expect(text).toContain('# 공통 규칙')
    expect(text).toContain('# 네이버 블로그')
    expect(text).not.toContain('# Threads')
  })

  it('공통 메모를 먼저, 그다음 지정 채널의 메모를 끝에 덧붙인다', () => {
    const text = loadRules({
      channels: ['threads'],
      notes: { common: '짧은 호흡', threads: '반말 금지', naver: '안 보여야 함' },
    })
    const section = text.slice(text.indexOf('# 이 계정의 말투 메모'))
    expect(section).toContain('위 규칙보다 우선한다')
    expect(section.indexOf('## 공통\n\n짧은 호흡')).toBeGreaterThan(0)
    expect(section.indexOf('## threads\n\n반말 금지')).toBeGreaterThan(section.indexOf('## 공통'))
    expect(text).not.toContain('안 보여야 함')
    expect(text.trimEnd().endsWith('반말 금지')).toBe(true)
  })

  it('여러 줄 메모도 그대로 싣는다', () => {
    const text = loadRules({ channels: ['naver'], notes: { common: '첫 줄\n둘째 줄' } })
    expect(text).toContain('## 공통\n\n첫 줄\n둘째 줄')
  })

  it('기본 규칙에 톤 원칙이 들어 있다', () => {
    const text = loadRules()
    for (const phrase of ['홍보로 시작하지 않는다', '고민이나 문제 상황으로 연다', '아주 쉽게', '설명하지 않는다']) {
      expect(text, phrase).toContain(phrase)
    }
  })

  it('메모가 없으면 메모 절도 없다', () => {
    expect(loadRules({ notes: {} })).not.toContain('# 이 계정의 말투 메모')
    expect(loadRules({ notes: { common: 'x' } })).toContain('# 이 계정의 말투 메모')
  })

  it('rules/ 는 npm 패키지에 포함된다', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.files).toContain('rules')
  })
})
