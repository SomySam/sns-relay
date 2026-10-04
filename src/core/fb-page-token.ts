import { FACEBOOK_API_BASE } from './channels/facebook-api.js'
import { loadEnv, requireEnv, scrubEnvValues } from './env.js'
import { updateEnvFile } from './env-file.js'
import { describeMetaError, metaRequest } from './meta-http.js'

/** 토큰을 붙여 넣기 전에 필요한 .env 값이 있는지 확인한다. */
export function assertPageTokenReady(root: string): void {
  requireEnv(loadEnv(root), ['META_APP_ID', 'META_APP_SECRET', 'FB_PAGE_ID'])
}

/**
 * Graph API 탐색기에서 받은 단기 사용자 토큰으로 페이스북 페이지 토큰(만료 없음)을 발급해 .env 에 쓴다.
 * ① fb_exchange_token 으로 장기 사용자 토큰 → ② /me/accounts 에서 FB_PAGE_ID 의 페이지 토큰.
 * 토큰 값은 돌려주지도, 오류에 싣지도 않는다.
 */
export async function issuePageToken(root: string, shortUserToken: string): Promise<{ pageId: string; pageName: string }> {
  const short = shortUserToken.trim()
  if (!short) throw new Error('입력한 토큰이 비어 있습니다.')
  const env = loadEnv(root)
  const { META_APP_ID, META_APP_SECRET, FB_PAGE_ID } = requireEnv(env, ['META_APP_ID', 'META_APP_SECRET', 'FB_PAGE_ID'])
  const scrub = (text: string) => scrubEnvValues(scrubEnvValues(text, env), { FB_PAGE_TOKEN: short } as typeof env)

  let pages: { id?: unknown; name?: unknown; access_token?: unknown }[]
  try {
    const exchanged = await metaRequest({
      base: FACEBOOK_API_BASE,
      path: '/oauth/access_token',
      params: { grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: short },
      token: `${META_APP_ID}|${META_APP_SECRET}`,
    })
    const longUser = typeof exchanged.access_token === 'string' ? exchanged.access_token : ''
    if (!longUser) throw new Error('장기 사용자 토큰을 받지 못했습니다.')
    const accounts = await metaRequest({ base: FACEBOOK_API_BASE, path: '/me/accounts', params: { fields: 'id,name,access_token', limit: '100' }, token: longUser })
    pages = Array.isArray(accounts.data) ? (accounts.data as typeof pages) : []
  } catch (e) {
    throw new Error(`페이지 토큰을 발급하지 못했습니다: ${scrub(describeMetaError(e))} (탐색기 토큰은 약 1시간 뒤 만료됩니다. pages_manage_posts 권한을 포함해 다시 받아 보세요.)`)
  }

  const page = pages.find((p) => String(p.id) === FB_PAGE_ID)
  if (!page || typeof page.access_token !== 'string' || !page.access_token) {
    const seen = pages.map((p) => `${(typeof p.name === 'string' ? p.name : '(이름 없음)')}(${String(p.id)})`).join(', ') || '없음'
    throw new Error(`FB_PAGE_ID ${FB_PAGE_ID} 페이지의 토큰이 없습니다. 이 토큰으로 볼 수 있는 페이지: ${seen}. 탐색기에서 페이지를 선택했는지 확인하세요. .env 는 바꾸지 않았습니다.`)
  }
  await updateEnvFile(root, { FB_PAGE_TOKEN: page.access_token })
  return { pageId: FB_PAGE_ID, pageName: typeof page.name === 'string' ? page.name : FB_PAGE_ID }
}
