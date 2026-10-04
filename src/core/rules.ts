import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Config } from './config.js'
import { CHANNEL_IDS, type ChannelId } from './types.js'

// src/core 와 dist/core 모두 패키지 루트에서 두 단계 아래라 같은 경로로 찾는다.
const RULES_DIR = fileURLToPath(new URL('../../rules/', import.meta.url))

function read(name: string): string {
  return readFileSync(RULES_DIR + name, 'utf8').replace(/\r\n?/g, '\n').trim()
}

/** 스킬·MCP 프롬프트·CLI 가 모두 이 함수로 같은 규칙을 얻는다. */
export function loadRules(opts: { channels?: ChannelId[]; notes?: Config['notes'] } = {}): string {
  const channels = opts.channels ?? [...CHANNEL_IDS]
  const parts = [read('common.md'), ...channels.map((c) => read(`${c}.md`))]

  const noteKeys: (ChannelId | 'common')[] = ['common', ...channels]
  const notes = noteKeys.flatMap((key) => {
    const note = opts.notes?.[key]?.trim()
    return note ? [`## ${key === 'common' ? '공통' : key}\n\n${note}`] : []
  })
  if (notes.length > 0) {
    parts.push(
      [
        '# 이 계정의 말투 메모 (config.json 의 notes)',
        '아래는 이 계정의 말투다. 사실에 관한 규칙(원문에 있는 사실만, 판매 문구·과장 금지, 본문에 주소 금지)을 뺀 나머지는 이 메모가 위 규칙보다 우선한다.',
        ...notes,
      ].join('\n\n'),
    )
  }
  return parts.join('\n\n---\n\n') + '\n'
}
