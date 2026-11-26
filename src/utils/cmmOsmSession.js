import { CMM_APP_KEY, CMM_BASE_URL, CmmError } from './cmmSync.js'

const APP_ORIGIN = 'https://machi-scrapbook.openacrossbase.net'
const CALLBACK_PATH = '/oauth/callback/'
const REDIRECT_URI = APP_ORIGIN + CALLBACK_PATH
const PENDING_KEY = 'machi-cmm-oauth-v1'
const FLOW_TIMEOUT_MS = 10 * 60 * 1000
const SYNC_SCOPES = ['batch:create', 'batch:update', 'batch:delete']
const AUTH_EXPIRED = '認証を確認できませんでした。OpenStreetMap で再度ログインしてください。'

let returnedSession = null
let activeSession = null

export function getCmmOsmSession() {
  if (activeSession && Date.now() >= activeSession.expiresAt) activeSession = null
  return activeSession?.session ?? null
}

function randomHex(length) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

function authError(message = AUTH_EXPIRED) {
  return new CmmError({ kind: 'auth', message })
}

export async function startCmmOsmLogin() {
  if (window.location.origin !== APP_ORIGIN) {
    throw authError('現在のURLでは同期できません。公開サイトからお試しください。')
  }
  const verifier = randomHex(32)
  const state = randomHex(24)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

  const authorize = new URL('/external-authorize.php', CMM_BASE_URL)
  authorize.search = new URLSearchParams({
    client_id: CMM_APP_KEY,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({
    verifier, state, startedAt: Date.now(), search: window.location.search,
  }))
  window.location.assign(authorize.href)
}

async function apiRequest(path, options = {}) {
  let response
  let body
  try {
    response = await fetch(new URL(path, CMM_BASE_URL).href, {
      ...options,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', ...options.headers },
    })
    body = await response.json()
  } catch {
    throw new CmmError({ message: 'コミュニティマップメーカーに接続できませんでした。再度お試しください。' })
  }
  if (response.ok) return body

  const code = body?.code ?? body?.error
  const kind = { 401: 'auth', 403: 'permission', 422: 'validation' }[response.status] ?? 'network'
  throw new CmmError({
    kind: code === 'invalid_grant' ? 'auth' : kind,
    status: response.status,
    code,
    message: code === 'invalid_grant' || kind === 'auth' ? AUTH_EXPIRED
      : kind === 'permission' ? 'コミュニティマップメーカーでプロジェクトへの参加状況と連携設定を確認してください。'
        : body?.message ?? '同期APIでエラーが発生しました。',
    details: body?.errors,
  })
}

async function finishLogin(callback, pending) {
  const age = Date.now() - pending?.startedAt
  if (!pending || !(age >= 0 && age <= FLOW_TIMEOUT_MS)
    || !/^[a-f0-9]{64}$/.test(pending.verifier) || !/^[a-f0-9]{48}$/.test(pending.state)
    || callback.getAll('state').length !== 1 || callback.get('state') !== pending.state) {
    throw authError()
  }
  if (callback.has('error')) {
    if (callback.get('error') === 'access_denied') throw authError('OpenStreetMap のログインまたは連携がキャンセルされました。')
    throw authError()
  }
  const code = callback.get('code')
  if (!code || callback.getAll('code').length !== 1) throw authError()

  const requestedAt = Date.now()
  const token = await apiRequest('/api/external-token.php', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CMM_APP_KEY,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: pending.verifier,
    }),
  })
  if (token?.token_type !== 'Bearer' || !/^[a-f0-9]{64}$/.test(token.access_token ?? '')) throw authError()
  const headers = { Authorization: `Bearer ${token.access_token}` }
  const profile = await apiRequest('/api/external-me.php', { headers })
  if (profile?.app_key !== CMM_APP_KEY || typeof profile.userid !== 'string'
    || !profile.userid.trim() || profile.userid.includes('@')) throw authError()
  if (!Array.isArray(profile.scopes) || !SYNC_SCOPES.every((scope) => profile.scopes.includes(scope))) {
    throw new CmmError({ kind: 'permission', message: '一括同期に必要な操作が許可されていません。連携設定を確認してください。' })
  }

  const session = {
    userid: profile.userid,
    async writeBatch(changes) {
      const result = await apiRequest('/api/activities-batch.php', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...changes, app: CMM_APP_KEY }),
      }).catch((error) => {
        if (error.kind === 'auth' && activeSession?.session === session) activeSession = null
        throw error
      })
      if (result?.status !== 'ok' || !Array.isArray(result.created) || !Array.isArray(result.updated)
        || !Array.isArray(result.deleted)) {
        throw new CmmError({ message: '一括同期の応答形式が不正です。' })
      }
      return result
    },
  }
  const ttl = Number.isFinite(token.expires_in) ? token.expires_in * 1000 : 0
  activeSession = { session, expiresAt: requestedAt + ttl }
  return session
}

/** Start exchanging the callback before React mounts, and immediately remove its parameters. */
export function resumeCmmOsmSync() {
  if (window.location.pathname !== CALLBACK_PATH) return
  const callback = new URLSearchParams(window.location.search)
  let pending = null
  try {
    const saved = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    pending = JSON.parse(saved)
  } catch {
    // An unreadable or already consumed flow is handled like an invalid callback.
  }
  const search = new URLSearchParams(typeof pending?.search === 'string' ? pending.search : '')
  search.set('view', 'memo')
  window.history.replaceState(null, '', `/?${search}`)
  returnedSession = finishLogin(callback, pending).then(
    (session) => ({ session }),
    (error) => ({ error }),
  )
}

export function takeCmmOsmReturn() {
  const result = returnedSession
  returnedSession = null
  return result
}
