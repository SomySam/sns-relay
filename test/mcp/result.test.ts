import { describe, expect, it } from 'vitest'
import { toMcpWording } from '../../src/mcp/result.js'

describe('toMcpWording', () => {
  it.each([
    ['채널에서 확인한 뒤 sns-relay resolve 로 기록하세요.', '채널에서 확인한 뒤 `resolve_unknown` 로 기록하세요.'],
    ['오너 확인 뒤 sns-relay approve ai-task-brief --channels naver 로 승인', '오너 확인 뒤 `approve` 로 승인'],
    ['먼저 `sns-relay fetch <글 주소>` 를 실행하세요.', '먼저 `fetch_article` 를 실행하세요.'],
    ['sns-relay mark naver ai-task-brief --url <발행 주소>', '`mark_published`'],
    ['`sns-relay init` 을', '`sns-relay init` 을'],
  ])('%s', (input, expected) => {
    expect(toMcpWording(input)).toBe(expected)
  })
})
