// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://machi-scrapbook.openacrossbase.net/"}
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resumeCmmOsmSync, startCmmOsmLogin, takeCmmOsmReturn } from '../cmmOsmSession.js'
import { CMM_BASE_URL } from '../cmmSync.js'

const origin = 'https://machi-scrapbook.openacrossbase.net'
const callbackPath = '/oauth/callback/'
const storageKey = 'machi-cmm-oauth-v1'
const verifier = '1'.repeat(64)
const state = '2'.repeat(48)
const token = '3'.repeat(64)
const scopes = ['batch:create', 'batch:update', 'batch:delete']

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => vi.unstubAllGlobals())

function setCallback(params, saved = { verifier, state, startedAt: Date.now(), search: '?keyword=park' }) {
  if (saved) sessionStorage.setItem(storageKey, JSON.stringify(saved))
  window.history.replaceState(null, '', callbackPath + '?' + new URLSearchParams(params))
  resumeCmmOsmSync()
  return takeCmmOsmReturn()
}

it('PKCE と state を作ってから登録済みの認可開始ページへ遷移する', async () => {
  const realWindow = window
  const assign = vi.fn()
  vi.stubGlobal('window', { ...realWindow, location: { origin, search: '?view=memo', assign } })
  await startCmmOsmLogin()
  const pending = JSON.parse(sessionStorage.getItem(storageKey))
  const url = new URL(assign.mock.calls[0][0])
  const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier))

  expect(url.origin + url.pathname).toBe(CMM_BASE_URL + '/external-authorize.php')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'machi-scrapbook',
    redirect_uri: origin + callbackPath,
    response_type: 'code',
    code_challenge: Buffer.from(hash).toString('base64url'),
    code_challenge_method: 'S256',
    state: pending.state,
  })
  expect(pending.verifier).toMatch(/^[a-f0-9]{64}$/)
  expect(pending.state).toMatch(/^[a-f0-9]{48}$/)
  expect(pending.search).toBe('?view=memo')
})

it('認可コードを一度だけ交換し、取得と一括保存に Bearer トークンを使う', async () => {
  const batch = { status: 'ok', created: [{ id: 'machi-scrapbook/test' }], updated: [], deleted: [] }
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: token, token_type: 'Bearer' }))
    .mockResolvedValueOnce(Response.json({ userid: 'public-id', app_key: 'machi-scrapbook', scopes }))
    .mockResolvedValueOnce(Response.json(batch))
  vi.stubGlobal('fetch', fetch)

  const pending = setCallback({ code: 'valid-code', state })
  expect(window.location.pathname + window.location.search).toBe('/?keyword=park&view=memo')
  expect(sessionStorage.getItem(storageKey)).toBeNull()
  expect(takeCmmOsmReturn()).toBeNull()

  const { session } = await pending
  expect(session.userid).toBe('public-id')
  const changes = { creates: [{ name: 'テスト施設' }], updates: [], deletes: [] }
  await expect(session.writeBatch(changes)).resolves.toEqual(batch)

  const [[exchange, options], [me, meOptions], [write, writeOptions]] = fetch.mock.calls
  expect(exchange).toBe(CMM_BASE_URL + '/api/external-token.php')
  expect(options.credentials).toBe('omit')
  expect(Object.fromEntries(options.body)).toEqual({
    grant_type: 'authorization_code',
    client_id: 'machi-scrapbook',
    redirect_uri: origin + callbackPath,
    code: 'valid-code',
    code_verifier: verifier,
  })
  expect(me).toBe(CMM_BASE_URL + '/api/external-me.php')
  expect(write).toBe(CMM_BASE_URL + '/api/activities-batch.php')
  expect([meOptions, writeOptions]).toEqual(Array(2).fill(expect.objectContaining({
    credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer ' + token }),
  })))
  expect(JSON.parse(writeOptions.body)).toEqual({ ...changes, app: 'machi-scrapbook' })
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

it.each([
  ['state 不一致', { state: 'wrong', code: 'test' }, undefined],
  ['同意拒否', { state, error: 'access_denied' }, undefined],
  ['再読み込み・保存済みフローなし', { state, code: 'test' }, null],
  ['期限切れ', { state, code: 'test' }, { verifier, state, startedAt: 0 }],
])('%s では通信せず、コールバックのパラメーターを消す', async (_, params, saved) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const result = await setCallback(params, saved)
  expect(result.error.kind).toBe('auth')
  expect(fetch).not.toHaveBeenCalled()
  expect(window.location.search).not.toMatch(/(code|state|error)=/)
  expect(sessionStorage.getItem(storageKey)).toBeNull()
})
