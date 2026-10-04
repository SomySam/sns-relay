import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CHANNEL_IDS, type ChannelId } from './types.js'

const perChannel = <T extends z.ZodType>(t: T) =>
  z.object({ threads: t, instagram: t, facebook: t, naver: t })

const ConfigSchema = z.object({
  channels: z
    .array(z.enum(CHANNEL_IDS))
    .min(1)
    .refine((list) => new Set(list).size === list.length, { message: '같은 채널이 두 번 들어 있습니다.' }),
  utm: z.object({
    medium: z.string().min(1),
    source: perChannel(z.string().min(1)),
  }),
  notes: z
    .object({
      common: z.string().optional(),
      threads: z.string().optional(),
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      naver: z.string().optional(),
    })
    .default({}),
  imageHost: z.enum(['url', 'cloudinary']).default('url'),
})

export type Config = {
  channels: ChannelId[]
  utm: { medium: string; source: Record<ChannelId, string> }
  notes: Partial<Record<ChannelId | 'common', string>>
  /** 사진 올릴 곳 — url: 공개 주소 그대로, cloudinary: Cloudinary 에 올려 JPEG 주소로 */
  imageHost: 'url' | 'cloudinary'
}

export function defaultConfig(): Config {
  return {
    channels: [...CHANNEL_IDS],
    utm: {
      medium: 'social',
      source: { threads: 'threads', instagram: 'instagram', facebook: 'facebook', naver: 'naver' },
    },
    notes: {},
    imageHost: 'url',
  }
}

export async function loadConfig(root: string): Promise<Config> {
  const path = join(root, 'config.json')
  if (!existsSync(path)) {
    throw new Error(`config.json 이 없습니다 (${root}). 먼저 \`sns-relay init\` 을 실행하세요.`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch (e) {
    throw new Error(`config.json 형식 오류: JSON 을 읽을 수 없습니다 (${(e as Error).message})`)
  }
  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`config.json 형식 오류:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data as Config
}

const ENV_TEMPLATE = `# sns-relay 비밀 설정 — 이 파일은 저장소에 올리지 마세요.
# 값을 채우는 방법은 README 의 "계정 준비" 를 보세요.

# Meta 앱 (앱 대시보드 > 앱 설정 > 기본 설정)
META_APP_ID=
META_APP_SECRET=

# Threads (이용 사례 > Threads API 액세스 > 설정)
THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_USER_ID=
THREADS_TOKEN=
# 토큰 만료일(YYYY-MM-DD) — sns-relay token refresh 가 적는다
THREADS_TOKEN_EXPIRES_AT=

# Instagram (이용 사례 > Instagram 로그인이 포함된 API 설정)
IG_APP_ID=
IG_APP_SECRET=
IG_USER_ID=
IG_TOKEN=
# 토큰 만료일(YYYY-MM-DD) — sns-relay token refresh 가 적는다
IG_TOKEN_EXPIRES_AT=

# Facebook 페이지
FB_PAGE_ID=
FB_PAGE_TOKEN=

# Cloudinary (사진 자동 업로드, 선택 — config.json 의 imageHost 를 cloudinary 로)
# https://console.cloudinary.com 대시보드의 Product Environment Credentials
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
`

const GITIGNORE_ENTRIES = ['.env', 'work/']
const GITIGNORE_TEMPLATE = GITIGNORE_ENTRIES.join('\n') + '\n'

export async function initWorkspace(root: string): Promise<{
  created: string[]
  skipped: string[]
  /** 이미 있어서 내용을 덧붙인 파일 */
  updated: string[]
  /** .gitignore 에 새로 덧붙인 항목 */
  added: string[]
}> {
  const created: string[] = []
  const skipped: string[] = []
  const updated: string[] = []
  const added: string[] = []

  await mkdir(root, { recursive: true })

  const files: [string, string][] = [
    ['config.json', JSON.stringify(defaultConfig(), null, 2) + '\n'],
    ['.env', ENV_TEMPLATE],
    ['.gitignore', GITIGNORE_TEMPLATE],
  ]
  for (const [name, content] of files) {
    const path = join(root, name)
    if (existsSync(path)) {
      if (name === '.gitignore') {
        // 비밀(.env)과 작업 결과(work/)가 저장소에 올라가지 않도록 빠진 줄만 덧붙인다.
        const current = await readFile(path, 'utf8')
        const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()))
        const missing = GITIGNORE_ENTRIES.filter((e) => !lines.has(e))
        if (missing.length > 0) {
          const prefix = current === '' || current.endsWith('\n') ? '' : '\n'
          await appendFile(path, prefix + missing.join('\n') + '\n', 'utf8')
          updated.push(name)
          added.push(...missing)
          continue
        }
      }
      skipped.push(name)
    } else {
      await writeFile(path, content, 'utf8')
      created.push(name)
    }
  }

  const work = join(root, 'work')
  if (existsSync(work)) {
    skipped.push('work/')
  } else {
    await mkdir(work, { recursive: true })
    created.push('work/')
  }
  return { created, skipped, updated, added }
}
