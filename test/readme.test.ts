import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('README', () => {
  it('모든 json 블록이 JSON.parse 를 통과한다', () => {
    const blocks = [...readme.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => m[1]!)
    for (const b of blocks) expect(() => JSON.parse(b), b).not.toThrow()
    expect(blocks.length).toBeGreaterThanOrEqual(3)
  })

  it('개인 작업 경로나 저장소에 없는 문서를 가리키지 않는다', () => {
    expect(readme).not.toContain('sns-relay-work')
    expect(readme).not.toMatch(/\]\(docs\//)
  })
})
