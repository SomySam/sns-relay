export type MetaErrorKind = 'auth' | 'permission' | 'rate' | 'duplicate' | 'transient' | 'invalid' | 'network'

export class MetaError extends Error {
  readonly kind: MetaErrorKind
  readonly status?: number
  readonly code?: number
  readonly subcode?: number
  readonly fbtraceId?: string

  constructor(
    message: string,
    kind: MetaErrorKind,
    info: { status?: number; code?: number; subcode?: number; fbtraceId?: string } = {},
  ) {
    super(message)
    this.name = 'MetaError'
    this.kind = kind
    this.status = info.status
    this.code = info.code
    this.subcode = info.subcode
    this.fbtraceId = info.fbtraceId
  }
}

const RATE_CODES = [4, 17, 32, 613, 80001, 80002]

export function classifyMetaError(status: number, code?: number): MetaErrorKind {
  if (code === 190 || status === 401) return 'auth'
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299) || status === 403) return 'permission'
  if (code !== undefined && RATE_CODES.includes(code)) return 'rate'
  if (code === 506) return 'duplicate'
  if (code === 1 || code === 2 || status >= 500) return 'transient'
  return 'invalid'
}

const HINTS: Record<MetaErrorKind, string> = {
  auth: '토큰이 만료되었거나 잘못되었습니다. 작업 폴더 .env 의 토큰을 새로 발급해 넣으세요.',
  permission: '앱 권한이나 테스터 등록을 확인하세요.',
  rate: '게시 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.',
  duplicate: '같은 내용이 이미 게시된 것으로 보입니다. 채널에서 확인하세요.',
  transient: 'Meta 쪽 일시 오류입니다. 잠시 뒤 다시 시도하세요.',
  invalid: '요청 내용이 거절되었습니다. 초안(길이·링크)을 확인하세요.',
  network: '인터넷 연결을 확인하세요.',
}

export function describeMetaError(e: unknown): string {
  if (e instanceof MetaError) return `${e.message} — ${HINTS[e.kind]}`
  return e instanceof Error ? e.message : String(e)
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text
}

const DEFAULT_TIMEOUT_MS = 30_000

export async function metaRequest(req: {
  base: string
  path: string
  method?: 'GET' | 'POST'
  params?: Record<string, string>
  token: string
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const method = req.method ?? 'GET'
  const url = new URL(req.base + req.path)
  const params = new URLSearchParams({ ...req.params, access_token: req.token })
  const signal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let res: Response
  try {
    if (method === 'GET') {
      url.search = params.toString()
      res = await fetch(url, { signal })
    } else {
      res = await fetch(url, { method: 'POST', body: params, signal })
    }
  } catch (e) {
    throw new MetaError(redact(`Meta 서버에 연결하지 못했습니다: ${(e as Error).message}`, req.token), 'network')
  }

  let text: string
  try {
    text = await res.text()
  } catch (e) {
    throw new MetaError(redact(`Meta 응답을 끝까지 받지 못했습니다: ${(e as Error).message}`, req.token), 'network', {
      status: res.status,
    })
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  const error = (body as { error?: Record<string, unknown> } | undefined)?.error
  if (res.ok && body && typeof body === 'object' && !error) {
    return body as Record<string, unknown>
  }

  const code = typeof error?.code === 'number' ? error.code : undefined
  const subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : undefined
  const base = typeof error?.message === 'string' ? error.message : `HTTP ${res.status}`
  const codeText = code !== undefined ? ` (code ${code}${subcode !== undefined ? `/${subcode}` : ''})` : ''
  throw new MetaError(redact(base + codeText, req.token), classifyMetaError(res.status, code), {
    status: res.status,
    code,
    subcode,
    fbtraceId: typeof error?.fbtrace_id === 'string' ? error.fbtrace_id : undefined,
  })
}

const CLEAR_REJECTION_KINDS: MetaErrorKind[] = ['auth', 'permission', 'rate', 'invalid']

/**
 * 되돌릴 수 없는 게시 요청 뒤에 쓴다. Meta 가 오류 코드와 함께 4xx 로 분명히 거절한 경우만 true —
 * 그 밖(5xx·시간 초과·깨진 응답·중복 오류)은 게시됐을 수 있으므로 false.
 */
export function isClearRejection(e: unknown): boolean {
  return (
    e instanceof MetaError &&
    e.code !== undefined &&
    e.status !== undefined &&
    e.status >= 400 &&
    e.status <= 499 &&
    CLEAR_REJECTION_KINDS.includes(e.kind)
  )
}
