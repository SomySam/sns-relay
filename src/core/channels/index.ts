import { CHANNEL_IDS, type Channel, type ChannelId, type Problem } from '../types.js'
import { facebook } from './facebook.js'
import { instagram } from './instagram.js'
import { naver } from './naver.js'
import { threads } from './threads.js'

export { countChars } from './common.js'

const CHANNELS: Record<ChannelId, Channel> = { threads, instagram, facebook, naver }

export function getChannel(id: ChannelId): Channel {
  return CHANNELS[id]
}

export function hasErrors(problems: Problem[]): boolean {
  return problems.some((p) => p.level === 'error')
}

export function parseChannelList(input: string): ChannelId[] {
  const names = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const name of names) {
    if (!(CHANNEL_IDS as readonly string[]).includes(name)) {
      throw new Error(`모르는 채널: ${name} (${CHANNEL_IDS.join(', ')} 중에서 고르세요)`)
    }
  }
  return names as ChannelId[]
}
