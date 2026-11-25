import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  CMM_APP_KEY,
  CmmError,
  cmmToMs,
  cmmToRfc3339Z,
  cmmNameOf,
  parseCmmRating,
  memoToActivity,
  activityToMemoPatch,
  fetchActivities,
  saveBatch,
  syncMemos,
} from '../cmmSync.js'

/* ---------------------------------------------------------------------------
 * テスト補助
 * ------------------------------------------------------------------------- */

const CREDENTIALS = { username: 'user1', password: 'pass1' }

const BOOKS = [
  { id: 'default', name: 'デフォルト', createdAt: '2026-01-01T00:00:00Z', public: false },
  { id: 'b-park', name: '公園', createdAt: '2026-01-01T00:00:00Z', public: true },
  { id: 'b-shop', name: '商店', createdAt: '2026-01-01T00:00:00Z', public: false },
]

function makeMemo(overrides = {}) {
  return {
    type: 'node',
    id: 100,
    name: 'テスト施設',
    lat: 35.0,
    lon: 139.0,
    tags: { name: 'テスト施設' },
    memo: '',
    rating: 0,
    bookId: 'b-park',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeActivity(overrides = {}) {
  return {
    id: 'machi-scrapbook/20261101T000000-aaaa',
    osmid: 'node/100',
    latitude: 35.0,
    longitude: 139.0,
    created_at: '2026-11-01 00:00:00',
    updated_at: '2026-11-01 00:00:00',
    // （マルチユーザー対応）デフォルトは自分の投稿（CREDENTIALS.username と一致）。
    // 他人の投稿を模擬したい場合は updated_by_userid を上書きする。
    updated_by_userid: 'user1',
    name: 'テスト施設',
    memo: '',
    rating: '',
    book: '公園',
    ...overrides,
  }
}

function makeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

/**
 * CMM 後端の fetch をモックする。
 * activities.php → 一覧、activities-batch.php → バッチ書き込み。
 */
function mockCmm({
  activities = [],
  listStatus = 200,
  listBody,
  batchStatus = 200,
  batchBody,
  batchStatuses = null, // バッチごとに異なるステータスを順に返したいとき
  batchBodies = null,
  networkError = null,
} = {}) {
  const calls = []
  let batchCallIndex = 0
  const mock = vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (networkError) throw networkError
    const u = String(url)
    if (u.includes('/api/activities-batch.php')) {
      const status = batchStatuses ? batchStatuses[Math.min(batchCallIndex, batchStatuses.length - 1)] : batchStatus
      const body =
        batchBodies && batchBodies[batchCallIndex] !== undefined
          ? batchBodies[batchCallIndex]
          : (batchBody ??
            (status === 200 ? { status: 'ok', created: [], updated: [], deleted: [] } : { status: 'error', code: 'validation_failed' }))
      batchCallIndex += 1
      return makeResponse(status, body)
    }
    if (u.includes('/api/activities.php')) {
      const body = listBody ?? (listStatus === 200 ? activities : { status: 'error', code: 'project_not_found' })
      return makeResponse(listStatus, body)
    }
    throw new Error(`unexpected url: ${u}`)
  })
  vi.stubGlobal('fetch', mock)
  return { calls, mock }
}

/** 呼び出しの URL 配列 */
function urlsOf(calls) {
  return calls.map((c) => c.url)
}

/** activities-batch.php への POST ボディ配列 */
function batchBodiesOf(calls) {
  return calls
    .filter((c) => c.url.includes('/api/activities-batch.php'))
    .map((c) => JSON.parse(c.options.body))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ---------------------------------------------------------------------------
 * 日付ヘルパー
 * ------------------------------------------------------------------------- */

describe('cmmToMs', () => {
  it('スペース区切りの UTC 日時を解析する', () => {
    expect(cmmToMs('2026-11-01 00:00:00')).toBe(Date.parse('2026-11-01T00:00:00Z'))
  })

  it('RFC3339（Z 付き）を解析する', () => {
    expect(cmmToMs('2026-11-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z'))
  })

  it('オフセット付き RFC3339 を解析する', () => {
    expect(cmmToMs('2026-11-03T05:00:00+09:00')).toBe(Date.parse('2026-11-03T05:00:00+09:00'))
  })

  it('空・null・不正値は null', () => {
    expect(cmmToMs('')).toBeNull()
    expect(cmmToMs(null)).toBeNull()
    expect(cmmToMs('garbage')).toBeNull()
    expect(cmmToMs(123)).toBeNull()
  })
})

describe('cmmToRfc3339Z', () => {
  it('ミリ秒を RFC3339（Z 付き、毫秒ゼロなら省略）へ変換する', () => {
    expect(cmmToRfc3339Z(Date.parse('2026-11-01T00:00:00Z'))).toBe('2026-11-01T00:00:00Z')
  })
})

/* ---------------------------------------------------------------------------
 * 変換関数
 * ------------------------------------------------------------------------- */

describe('cmmNameOf', () => {
  it('保存名をそのまま返す', () => {
    expect(cmmNameOf({ name: 'テスト施設' })).toBe('テスト施設')
  })

  it('フォールバック名称「名称なし」は空文字列にする', () => {
    expect(cmmNameOf({ name: '名称なし' })).toBe('')
  })

  it('name 欠落・空は空文字列', () => {
    expect(cmmNameOf({})).toBe('')
    expect(cmmNameOf({ name: '' })).toBe('')
    expect(cmmNameOf(null)).toBe('')
  })
})

describe('parseCmmRating', () => {
  it('文字列 "1".."5" を整数にする', () => {
    expect(parseCmmRating('3')).toBe(3)
  })

  it('整数 1..5 をそのまま返す', () => {
    expect(parseCmmRating(4)).toBe(4)
  })

  it('未設定・不正値は 0', () => {
    expect(parseCmmRating('')).toBe(0)
    expect(parseCmmRating(null)).toBe(0)
    expect(parseCmmRating(undefined)).toBe(0)
    expect(parseCmmRating('0')).toBe(0)
    expect(parseCmmRating('7')).toBe(0)
    expect(parseCmmRating('x')).toBe(0)
    expect(parseCmmRating(0)).toBe(0)
  })
})

describe('memoToActivity', () => {
  it('メモを Activity 入力値に変換する', () => {
    expect(memoToActivity(makeMemo({ rating: 3 }), BOOKS)).toEqual({
      osmid: 'node/100',
      name: 'テスト施設',
      memo: '',
      book: '公園',
      rating: '3',
      latitude: 35.0,
      longitude: 139.0,
      // (ピースG0) OSM タグは JSON 文字列で送る
      tags: '{"name":"テスト施設"}',
    })
  })

  it('rating 0 なら rating キーを出さない', () => {
    const activity = memoToActivity(makeMemo(), BOOKS)
    expect(activity).not.toHaveProperty('rating')
  })

  it('(ピースG0) tags が空・未定義なら tags キーを出さない', () => {
    expect(memoToActivity(makeMemo({ tags: {} }), BOOKS)).not.toHaveProperty('tags')
    expect(memoToActivity(makeMemo({ tags: null }), BOOKS)).not.toHaveProperty('tags')
    expect(memoToActivity(makeMemo({ tags: undefined }), BOOKS)).not.toHaveProperty('tags')
  })

  it('「名称なし」のメモは name を空文字列で送る', () => {
    const activity = memoToActivity(makeMemo({ name: '名称なし', tags: null }), BOOKS)
    expect(activity.name).toBe('')
  })

  it('座標が片方だけなら含めない', () => {
    const activity = memoToActivity(makeMemo({ lon: null }), BOOKS)
    expect(activity).not.toHaveProperty('latitude')
    expect(activity).not.toHaveProperty('longitude')
  })

  it('way / relation の osmid 形式を作る', () => {
    expect(memoToActivity(makeMemo({ type: 'way', id: 5 }), BOOKS).osmid).toBe('way/5')
    expect(memoToActivity(makeMemo({ type: 'relation', id: 7 }), BOOKS).osmid).toBe('relation/7')
  })

  it('未知の bookId はデフォルトブック名で送る', () => {
    const activity = memoToActivity(makeMemo({ bookId: 'unknown' }), BOOKS)
    expect(activity.book).toBe('デフォルト')
  })
})

describe('activityToMemoPatch', () => {
  it('Activity をメモ更新パッチに変換する', () => {
    expect(activityToMemoPatch(makeActivity({ memo: '楽しい', rating: '4' }))).toEqual({
      name: 'テスト施設',
      memo: '楽しい',
      rating: 4,
      book: '公園',
    })
  })

  it('name が空・null なら「名称なし」', () => {
    expect(activityToMemoPatch(makeActivity({ name: '' })).name).toBe('名称なし')
    expect(activityToMemoPatch(makeActivity({ name: null })).name).toBe('名称なし')
  })

  it('memo が null なら空文字列', () => {
    expect(activityToMemoPatch(makeActivity({ memo: null })).memo).toBe('')
  })

  it('rating 未設定は 0', () => {
    expect(activityToMemoPatch(makeActivity({ rating: null })).rating).toBe(0)
  })

  it('book 欠落は空文字列', () => {
    const { book } = activityToMemoPatch({ id: 'x', osmid: 'node/1' })
    expect(book).toBe('')
  })

  it('(ピースG0) tags が JSON 文字列ならオブジェクトとしてパッチに含む', () => {
    const patch = activityToMemoPatch(makeActivity({ tags: '{"amenity":"cafe","name":"X"}' }))
    expect(patch.tags).toEqual({ amenity: 'cafe', name: 'X' })
  })

  it('(ピースG0) tags が不正な JSON・オブジェクト以外なら空オブジェクト', () => {
    expect(activityToMemoPatch(makeActivity({ tags: '{oops' })).tags).toEqual({})
    expect(activityToMemoPatch(makeActivity({ tags: '[1,2]' })).tags).toEqual({})
    expect(activityToMemoPatch(makeActivity({ tags: '"cafe"' })).tags).toEqual({})
  })

  it('(ピースG0) tags が文字列でないなら空オブジェクト', () => {
    expect(activityToMemoPatch(makeActivity({ tags: { amenity: 'cafe' } })).tags).toEqual({})
    expect(activityToMemoPatch(makeActivity({ tags: 42 })).tags).toEqual({})
  })

  it('(ピースG0) tags 項目が無いならパッチに含めない（従来どおり）', () => {
    expect(activityToMemoPatch(makeActivity())).not.toHaveProperty('tags')
    expect(activityToMemoPatch(makeActivity({ tags: null }))).not.toHaveProperty('tags')
  })

  it('null 入力で安全に動作する', () => {
    expect(activityToMemoPatch(null)).toEqual({ name: '名称なし', memo: '', rating: 0, book: '' })
  })
})

describe('(ピースG0) tags の往復変換', () => {
  it('tags を含むメモ → Activity → メモ で tags が一致する', () => {
    const memo = makeMemo({ tags: { amenity: 'cafe', 'name:ja': 'カフェ', wheelchair: 'yes' } })
    const activity = memoToActivity(memo, BOOKS)
    expect(activity.tags).toBe(JSON.stringify(memo.tags))
    expect(activityToMemoPatch(activity).tags).toEqual(memo.tags)
  })

  it('tags が空のメモは往復で tags を送らず・パッチにも含めない', () => {
    const memo = makeMemo({ tags: {} })
    const activity = memoToActivity(memo, BOOKS)
    expect(activity).not.toHaveProperty('tags')
    expect(activityToMemoPatch(activity)).not.toHaveProperty('tags')
  })
})

/* ---------------------------------------------------------------------------
 * API クライアント
 * ------------------------------------------------------------------------- */

describe('fetchActivities', () => {
  it('app パラメータ付きで一覧を取得する', async () => {
    const { calls } = mockCmm({ activities: [makeActivity()] })
    const list = await fetchActivities()
    expect(list).toEqual([makeActivity()])
    expect(urlsOf(calls)).toEqual([
      `https://cmapmaker.openacrossbase.net/api/activities.php?app=${CMM_APP_KEY}`,
    ])
  })

  it('since がある場合は updated_since を付加する（RFC3339・URL エンコード）', async () => {
    const { calls } = mockCmm({ activities: [] })
    await fetchActivities({ since: '2026-11-01T00:00:00Z' })
    expect(urlsOf(calls)[0]).toBe(
      'https://cmapmaker.openacrossbase.net/api/activities.php?app=machi-scrapbook&updated_since=2026-11-01T00%3A00%3A00Z'
    )
  })

  it('解析不能な since は無視して全件取得する', async () => {
    const { calls } = mockCmm({ activities: [] })
    await fetchActivities({ since: 'not-a-date' })
    expect(urlsOf(calls)[0]).toBe(`https://cmapmaker.openacrossbase.net/api/activities.php?app=${CMM_APP_KEY}`)
  })

  it('認証ヘッダは付けない', async () => {
    const { calls } = mockCmm({ activities: [] })
    await fetchActivities()
    expect(calls[0].options.headers.Authorization).toBeUndefined()
  })

  it('project_not_found（404）は network 種のエラー', async () => {
    mockCmm({ listStatus: 404 })
    await expect(fetchActivities()).rejects.toMatchObject({
      kind: 'network',
      status: 404,
      code: 'project_not_found',
    })
  })

  it('422 は validation 種のエラー', async () => {
    mockCmm({ listStatus: 422, listBody: { status: 'error', code: 'validation_failed', errors: { updated_since: 'bad' } } })
    await expect(fetchActivities({ since: 'bad' })).rejects.toBeInstanceOf(CmmError)
    await expect(fetchActivities()).rejects.toMatchObject({ kind: 'validation' })
  })

  it('ネットワーク失敗は network 種のエラー', async () => {
    mockCmm({ networkError: new TypeError('fetch failed') })
    await expect(fetchActivities()).rejects.toMatchObject({ kind: 'network' })
  })

  it('配列以外の応答はエラー', async () => {
    mockCmm({ listBody: { status: 'ok' } })
    await expect(fetchActivities()).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('saveBatch', () => {
  it('変更が空なら通信せず空の結果を返す', async () => {
    const { calls } = mockCmm()
    const result = await saveBatch({ creates: [], updates: [], deletes: [] }, CREDENTIALS)
    expect(result).toEqual({ created: [], updated: [], deleted: [], errors: [] })
    expect(calls).toHaveLength(0)
  })

  it('認証情報が無いと auth エラーを返して通信しない', async () => {
    const { calls } = mockCmm()
    const result = await saveBatch({ creates: [makeActivity()] }, null)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].kind).toBe('auth')
    expect(calls).toHaveLength(0)
  })

  it('Basic 認証ヘッダと app を付けて POST する', async () => {
    const { calls } = mockCmm()
    await saveBatch({ creates: [makeActivity()] }, CREDENTIALS)
    const post = calls[0]
    expect(post.url).toBe('https://cmapmaker.openacrossbase.net/api/activities-batch.php')
    expect(post.options.method).toBe('POST')
    expect(post.options.headers.Authorization).toBe(`Basic ${btoa('user1:pass1')}`)
    expect(JSON.parse(post.options.body)).toEqual({
      app: CMM_APP_KEY,
      creates: [makeActivity()],
      updates: [],
      deletes: [],
    })
  })

  it('成功時は created/updated/deleted を返す', async () => {
    const created = makeActivity({ id: 'NEW-1' })
    const updated = makeActivity({ id: 'UPD-1', osmid: 'way/5' })
    mockCmm({ batchBody: { status: 'ok', created: [created], updated: [updated], deleted: ['DEL-1'] } })
    const result = await saveBatch({ creates: [created], updates: [updated], deletes: ['DEL-1'] }, CREDENTIALS)
    expect(result.created).toEqual([created])
    expect(result.updated).toEqual([updated])
    expect(result.deleted).toEqual(['DEL-1'])
    expect(result.errors).toHaveLength(0)
  })

  it('1000 件を超える場合は分割して順次送信する', async () => {
    const creates = Array.from({ length: 1001 }, (_, i) => makeActivity({ osmid: `node/${i}` }))
    const { calls } = mockCmm()
    await saveBatch({ creates }, CREDENTIALS)
    const posts = batchBodiesOf(calls)
    expect(posts).toHaveLength(2)
    expect(posts[0].creates).toHaveLength(1000)
    expect(posts[1].creates).toHaveLength(1)
  })

  it('混合変更の分割も 1000 件以下に収まる', async () => {
    const creates = Array.from({ length: 600 }, (_, i) => makeActivity({ osmid: `node/${i}` }))
    const updates = Array.from({ length: 500 }, (_, i) => ({ ...makeActivity({ osmid: `way/${i}` }), id: `ID-${i}` }))
    const deletes = Array.from({ length: 50 }, (_, i) => `DEL-${i}`)
    const { calls } = mockCmm()
    await saveBatch({ creates, updates, deletes }, CREDENTIALS)
    const posts = batchBodiesOf(calls)
    expect(posts).toHaveLength(2)
    const count = (p) => p.creates.length + p.updates.length + p.deletes.length
    expect(count(posts[0])).toBeLessThanOrEqual(1000)
    expect(count(posts[1])).toBeLessThanOrEqual(1000)
    expect(posts[0].creates).toHaveLength(600)
    expect(posts[0].updates).toHaveLength(400)
    expect(posts[1].updates).toHaveLength(100)
    expect(posts[1].deletes).toHaveLength(50)
  })

  it('バッチごとに成功/失敗を区別して返す（422 の後も次のバッチを送る）', async () => {
    const creates = Array.from({ length: 1001 }, (_, i) => makeActivity({ osmid: `node/${i}` }))
    const okCreated = makeActivity({ id: 'OK-1' })
    mockCmm({
      batchStatuses: [422, 200],
      batchBodies: [
        { status: 'error', code: 'validation_failed', errors: { osmid: 'bad' } },
        { status: 'ok', created: [okCreated], updated: [], deleted: [] },
      ],
    })
    const result = await saveBatch({ creates }, CREDENTIALS)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ kind: 'validation', status: 422, code: 'validation_failed' })
    expect(result.created).toEqual([okCreated])
  })

  it('認証エラー（401）の後はその後のバッチを送らない', async () => {
    const creates = Array.from({ length: 1001 }, (_, i) => makeActivity({ osmid: `node/${i}` }))
    const { calls } = mockCmm({
      batchStatuses: [401, 200],
      batchBodies: [
        { status: 'error', code: 'authentication_required' },
        { status: 'ok', created: [], updated: [], deleted: [] },
      ],
    })
    const result = await saveBatch({ creates }, CREDENTIALS)
    expect(result.errors[0].kind).toBe('auth')
    expect(batchBodiesOf(calls)).toHaveLength(1)
  })

  it('403 は permission 種', async () => {
    mockCmm({ batchStatus: 403, batchBody: { status: 'error', code: 'project_access_denied' } })
    const result = await saveBatch({ deletes: ['X'] }, CREDENTIALS)
    expect(result.errors[0]).toMatchObject({ kind: 'permission', status: 403, code: 'project_access_denied' })
  })
})

/* ---------------------------------------------------------------------------
 * syncMemos
 * ------------------------------------------------------------------------- */

const SYNC_DEFAULTS = { books: BOOKS, tombstones: [], credentials: CREDENTIALS, lastSyncAt: null }

function batchCall(calls) {
  return calls.find((c) => c.url.includes('/api/activities-batch.php'))
}

describe('syncMemos', () => {
  it('初回同期で cmmId 無しの公開メモを created として送る', async () => {
    const memo = makeMemo()
    const created = makeActivity({ id: 'NEW-1' })
    const { calls } = mockCmm({ activities: [], batchBody: { status: 'ok', created: [created], updated: [], deleted: [] } })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })

    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.app).toBe(CMM_APP_KEY)
    expect(body.creates).toEqual([memoToActivity(memo, BOOKS)])
    expect(body.updates).toEqual([])
    expect(body.deletes).toEqual([])
    expect(result.created).toEqual([created])
    expect(result.imported).toEqual([])
    expect(result.errors).toEqual([])
    // 取得が空なら lastSyncAt は現在時刻（RFC3339 Z）
    expect(result.lastSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })

  it('リモートが新しい場合は取り込み（imported）して書き込まない', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-01T00:00:00Z' })
    const activity = makeActivity({
      id: 'ACT-1',
      updated_at: '2026-11-02 00:00:00',
      name: 'リモート名',
      memo: 'リモートメモ',
      rating: '5',
    })
    const { calls } = mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })

    expect(batchCall(calls)).toBeUndefined()
    expect(result.imported).toEqual([
      {
        type: 'update-memo',
        key: 'node/100',
        cmmId: 'ACT-1',
        cmmUpdatedAt: '2026-11-02T00:00:00Z',
        name: 'リモート名',
        memo: 'リモートメモ',
        rating: 5,
        bookName: '公園',
        bookId: 'b-park',
        createBook: false,
      },
    ])
    expect(result.created).toEqual([])
    expect(result.updated).toEqual([])
    expect(result.lastSyncAt).toBe('2026-11-02T00:00:00Z')
  })

  it('ローカルが新しく内容が異なる場合は updated として送る', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-02T00:00:00Z', memo: 'ローカルメモ' })
    const activity = makeActivity({ id: 'ACT-1', updated_at: '2026-11-01 00:00:00' })
    const updated = makeActivity({ id: 'ACT-1', updated_at: '2026-11-03 00:00:00', memo: 'ローカルメモ' })
    const { calls } = mockCmm({ activities: [activity], batchBody: { status: 'ok', created: [], updated: [updated], deleted: [] } })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })

    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.updates).toEqual([{ ...memoToActivity(memo, BOOKS), id: 'ACT-1' }])
    expect(body.creates).toEqual([])
    expect(result.updated).toEqual([updated])
    expect(result.imported).toEqual([])
  })

  it('内容が同じなら書き込まない', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-02T00:00:00Z' })
    const activity = makeActivity({ id: 'ACT-1', updated_at: '2026-11-01 00:00:00' })
    const { calls } = mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(batchCall(calls)).toBeUndefined()
    expect(result.imported).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('rating の差を検出して更新する', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-02T00:00:00Z', rating: 3 })
    const activity = makeActivity({ id: 'ACT-1', updated_at: '2026-11-01 00:00:00', rating: '' })
    const { calls } = mockCmm({ activities: [activity] })
    await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.updates).toEqual([{ ...memoToActivity(memo, BOOKS), id: 'ACT-1' }])
    expect(body.updates[0].rating).toBe('3')
  })

  it('book の差を検出して更新する', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-02T00:00:00Z' })
    const activity = makeActivity({ id: 'ACT-1', updated_at: '2026-11-01 00:00:00', book: '商店' })
    const { calls } = mockCmm({ activities: [activity] })
    await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.updates[0].book).toBe('公園')
  })

  it('座標の差を検出して更新する', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-02T00:00:00Z' })
    const activity = makeActivity({ id: 'ACT-1', updated_at: '2026-11-01 00:00:00', latitude: 35.1 })
    const { calls } = mockCmm({ activities: [activity] })
    await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.updates[0].latitude).toBe(35.0)
  })

  it('cmmId が取得セットに無い場合はローカル内容を送る（比較不能・冪等）', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-01T00:00:00Z' })
    const { calls } = mockCmm({ activities: [], lastSyncAt: '2026-11-01T00:00:00Z' })
    await syncMemos({ memos: [memo], books: BOOKS, tombstones: [], credentials: CREDENTIALS, lastSyncAt: '2026-11-01T00:00:00Z' })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.updates).toEqual([{ ...memoToActivity(memo, BOOKS), id: 'ACT-1' }])
  })

  it('cmmId 無しの公開メモがリモートの osmid と一致すると取り込む（cmmId を引き継ぐ）', async () => {
    const memo = makeMemo()
    const activity = makeActivity({ id: 'ACT-9', updated_at: '2026-11-05 00:00:00', name: '共有名' })
    const { calls } = mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(batchCall(calls)).toBeUndefined()
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({ type: 'update-memo', key: 'node/100', cmmId: 'ACT-9', name: '共有名' })
  })

  it('osmid 一致だがローカルが新しい場合は更新として送る（id を引き継ぐ）', async () => {
    const memo = makeMemo({ cmmUpdatedAt: '2026-11-06T00:00:00Z', memo: '新メモ' })
    const activity = makeActivity({ id: 'ACT-9', updated_at: '2026-11-05 00:00:00' })
    const { calls } = mockCmm({ activities: [activity] })
    await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.updates).toEqual([{ ...memoToActivity(memo, BOOKS), id: 'ACT-9' }])
  })

  it('リモートにだけ存在する Activity を新規メモ（new-memo）として返す', async () => {
    const activity = makeActivity({ id: 'ACT-2', osmid: 'node/200', latitude: 35.5, longitude: 139.5, memo: '発見' })
    const { calls } = mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
    expect(batchCall(calls)).toBeUndefined()
    expect(result.imported).toEqual([
      {
        type: 'new-memo',
        key: 'node/200',
        cmmId: 'ACT-2',
        cmmUpdatedAt: '2026-11-01T00:00:00Z',
        name: 'テスト施設',
        memo: '発見',
        rating: 0,
        bookName: '公園',
        bookId: 'b-park',
        createBook: false,
        lat: 35.5,
        lon: 139.5,
        // (ピースG0) tags 項目が無い既存の投稿は従来どおり（tags は null）
        tags: null,
      },
    ])
  })

  it('(ピースG0) tags 付きの Activity を新規メモとして取り込む（tags がエントリに残る）', async () => {
    const activity = makeActivity({
      id: 'ACT-2',
      osmid: 'node/200',
      memo: '発見',
      tags: '{"amenity":"cafe","name":"遠くの喫茶店"}',
    })
    mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
    expect(result.errors).toEqual([])
    expect(result.imported[0]).toMatchObject({
      type: 'new-memo',
      key: 'node/200',
      tags: { amenity: 'cafe', name: '遠くの喫茶店' },
    })
  })

  it('(ピースG0) tags が不正な JSON でも空オブジェクトとして取り込み、同期全体は失敗しない', async () => {
    const activity = makeActivity({ id: 'ACT-2', osmid: 'node/200', tags: '{oops' })
    mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
    expect(result.errors).toEqual([])
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({ type: 'new-memo', key: 'node/200', tags: {} })
  })

  it('(ピースG0) update-memo の取り込みエントリにも tags が入る', async () => {
    const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-01T00:00:00Z' })
    const activity = makeActivity({
      id: 'ACT-1',
      updated_at: '2026-11-02 00:00:00',
      tags: '{"amenity":"cafe"}',
    })
    mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({ type: 'update-memo', key: 'node/100', tags: { amenity: 'cafe' } })
  })

  it('リモートの book がローカルに無い場合は createBook: true で返す', async () => {
    const activity = makeActivity({ id: 'ACT-2', osmid: 'node/200', book: '新しいブック' })
    mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
    expect(result.imported[0]).toMatchObject({ bookName: '新しいブック', bookId: null, createBook: true })
  })

  it('リモートの book が空ならデフォルトブックに入る', async () => {
    const activity = makeActivity({ id: 'ACT-2', osmid: 'node/200', book: '' })
    mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
    expect(result.imported[0]).toMatchObject({ bookName: '', bookId: 'default', createBook: false })
  })

  it('非公開ブックの cmmId 付きメモはリモートから削除する', async () => {
    const memo = makeMemo({ bookId: 'b-shop', cmmId: 'ACT-3' })
    const { calls } = mockCmm({ activities: [] })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.deletes).toEqual(['ACT-3'])
    expect(body.creates).toEqual([])
    expect(body.updates).toEqual([])
    expect(result.deleted).toEqual(['ACT-3'])
  })

  it('ごみ箱の cmmId 付きメモはリモートから削除する', async () => {
    const memo = makeMemo({ cmmId: 'ACT-4', deletedAt: '2026-11-01T00:00:00Z' })
    const { calls } = mockCmm({ activities: [] })
    await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.deletes).toEqual(['ACT-4'])
  })

  it('トンブストーンは削除される', async () => {
    const { calls } = mockCmm({ activities: [] })
    const result = await syncMemos({ memos: [], books: BOOKS, tombstones: ['TOMB-1'], credentials: CREDENTIALS, lastSyncAt: null })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.deletes).toEqual(['TOMB-1'])
    expect(result.deleted).toEqual(['TOMB-1'])
  })

  it('トンブストーンと cmmId が一致するメモは stale 扱いで作成に降格する', async () => {
    const memo = makeMemo({ cmmId: 'ACT-5' })
    const created = makeActivity({ id: 'NEW-5' })
    const { calls } = mockCmm({ activities: [], batchBody: { status: 'ok', created: [created], updated: [], deleted: [] } })
    const result = await syncMemos({ memos: [memo], books: BOOKS, tombstones: ['ACT-5'], credentials: CREDENTIALS, lastSyncAt: null })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.deletes).toEqual(['ACT-5'])
    expect(body.creates).toEqual([memoToActivity(memo, BOOKS)])
    expect(result.created).toEqual([created])
  })

  it('osmid が一致する非公開メモを持つ Activity は取り込まない', async () => {
    const localMemo = makeMemo({ id: 300, bookId: 'b-shop' })
    const activity = makeActivity({ id: 'ACT-6', osmid: 'node/300' })
    const { calls } = mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [localMemo], ...SYNC_DEFAULTS })
    expect(result.imported).toEqual([])
    expect(batchCall(calls)).toBeUndefined()
  })

  it('ごみ箱のメモの osmid と一致する Activity も取り込まない', async () => {
    const localMemo = makeMemo({ id: 300, deletedAt: '2026-11-01T00:00:00Z' })
    const activity = makeActivity({ id: 'ACT-6', osmid: 'node/300' })
    const { calls } = mockCmm({ activities: [activity] })
    const result = await syncMemos({ memos: [localMemo], ...SYNC_DEFAULTS })
    expect(result.imported).toEqual([])
  })

  it('cmmId が指向する Activity が既に別のメモに対応付け済みの場合は stale 扱いする', async () => {
    // memoB（key node/100・cmmId なし）が osmid 経由で ACT-1 を先に取得し、
    // memoA（key node/101・cmmId=ACT-1）は stale → 新規作成に降格する
    const memoA = makeMemo({ id: 101, cmmId: 'ACT-1' })
    const memoB = makeMemo({ id: 100 })
    const activity = makeActivity({ id: 'ACT-1', osmid: 'node/100' })
    const created = makeActivity({ id: 'NEW-1', osmid: 'node/101' })
    const { calls } = mockCmm({ activities: [activity], batchBody: { status: 'ok', created: [created], updated: [], deleted: [] } })
    const result = await syncMemos({ memos: [memoB, memoA], ...SYNC_DEFAULTS })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.creates).toEqual([memoToActivity(memoA, BOOKS)])
    expect(body.updates).toEqual([])
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({ type: 'update-memo', key: 'node/100', cmmId: 'ACT-1' })
    expect(result.created).toEqual([created])
  })

  it('削除セットに入っている Activity には osmid で対応付けない', async () => {
    const memo = makeMemo()
    const activity = makeActivity({ id: 'ACT-7' })
    const created = makeActivity({ id: 'NEW-7' })
    const { calls } = mockCmm({ activities: [activity], batchBody: { status: 'ok', created: [created], updated: [], deleted: [] } })
    const result = await syncMemos({ memos: [memo], books: BOOKS, tombstones: ['ACT-7'], credentials: CREDENTIALS, lastSyncAt: null })
    const body = JSON.parse(batchCall(calls).options.body)
    expect(body.deletes).toEqual(['ACT-7'])
    expect(body.creates).toEqual([memoToActivity(memo, BOOKS)])
    expect(result.imported).toEqual([])
  })

  it('非公開ブックの cmmId 無しメモは何もしない', async () => {
    const memo = makeMemo({ bookId: 'b-shop' })
    const { calls } = mockCmm({ activities: [] })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(batchCall(calls)).toBeUndefined()
    expect(result.imported).toEqual([])
  })

  it('ごみ箱の cmmId 無しメモは何もしない', async () => {
    const memo = makeMemo({ deletedAt: '2026-11-01T00:00:00Z' })
    const { calls } = mockCmm({ activities: [] })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(batchCall(calls)).toBeUndefined()
  })

  it('取得失敗の場合はエラーを返して書き込まない（lastSyncAt は null）', async () => {
    const memo = makeMemo()
    mockCmm({ listStatus: 404 })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ kind: 'network', status: 404, code: 'project_not_found' })
    expect(result.created).toEqual([])
    expect(result.lastSyncAt).toBeNull()
  })

  it('バッチの認証エラー（401）は auth 種で返る', async () => {
    const memo = makeMemo()
    mockCmm({ activities: [], batchStatus: 401, batchBody: { status: 'error', code: 'authentication_required' } })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(result.errors[0]).toMatchObject({ kind: 'auth', status: 401, code: 'authentication_required' })
    expect(result.created).toEqual([])
    // 取得は成功しているので lastSyncAt は設定される
    expect(result.lastSyncAt).toMatch(/Z$/)
  })

  it('バッチの検証エラー（422）は validation 種で返る', async () => {
    const memo = makeMemo()
    mockCmm({ activities: [], batchStatus: 422, batchBody: { status: 'error', code: 'validation_failed', errors: { name: 'too long' } } })
    const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(result.errors[0]).toMatchObject({ kind: 'validation', status: 422, code: 'validation_failed' })
    expect(result.errors[0].details).toEqual({ name: 'too long' })
  })

  it('lastSyncAt は取得済み Activity の最新の updated_at になる', async () => {
    mockCmm({
      activities: [
        makeActivity({ id: 'A', updated_at: '2026-11-02 00:00:00' }),
        makeActivity({ id: 'B', osmid: 'node/201', updated_at: '2026-11-03 00:00:00' }),
      ],
    })
    const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
    expect(result.lastSyncAt).toBe('2026-11-03T00:00:00Z')
  })

  it('増分同期では updated_since と userid を付けて取得する', async () => {
    const { calls } = mockCmm({ activities: [] })
    await syncMemos({ memos: [], books: BOOKS, tombstones: [], credentials: CREDENTIALS, lastSyncAt: '2026-11-01T00:00:00Z' })
    expect(calls[0].url).toBe(
      'https://cmapmaker.openacrossbase.net/api/activities.php?app=machi-scrapbook&updated_since=2026-11-01T00%3A00%3A00Z&userid=user1'
    )
  })

  it('多数の変更でバッチが分割され、成功/失敗が区別されて返る', async () => {
    const memos = Array.from({ length: 1001 }, (_, i) => makeMemo({ id: 1000 + i }))
    const okCreated = makeActivity({ id: 'OK-1' })
    mockCmm({
      activities: [],
      batchStatuses: [422, 200],
      batchBodies: [
        { status: 'error', code: 'validation_failed' },
        { status: 'ok', created: [okCreated], updated: [], deleted: [] },
      ],
    })
    const result = await syncMemos({ memos, ...SYNC_DEFAULTS })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].kind).toBe('validation')
    expect(result.created).toEqual([okCreated])
  })

  it('入力を mutate しない', async () => {
    const memo = makeMemo()
    const before = JSON.parse(JSON.stringify(memo))
    mockCmm({ activities: [] })
    await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
    expect(memo).toEqual(before)
  })

  it('不正形のメモ・Activity は安全にスキップされる', async () => {
    const activity = makeActivity({ id: 'ACT-2', osmid: 'node/200' })
    mockCmm({ activities: [null, 'x', 42, activity] })
    const result = await syncMemos({ memos: [null, { type: 'node' }, { id: 5 }, makeMemo({ id: 999, name: '別施設' })], ...SYNC_DEFAULTS })
    // node/200 の Activity は取り込まれ、node/999 のメモは created になる
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0].key).toBe('node/200')
    expect(result.errors).toEqual([])
  })
})

/* ---------------------------------------------------------------------------
 * マルチユーザー対応（ピースE）: 所有判定
 *
 * 所有の基準は「作成者」。通常経路（ログインIDがユーザーID形式）は
 * userid=<ログインID> でサーバ側に取り込みを絞り、取得できた投稿は最終
 * 更新者が別人でも自分のものとして扱う（手元の updated_by_userid 除外は
 * しない）。フォールバック経路（ログインIDがメールアドレス形式）は
 * userid を使わず、全件取得＋手元で updated_by_userid の完全一致と
 * cmmId 結び付きで判定する（推測で他人の投稿を取り込まない）。
 * ------------------------------------------------------------------------- */

describe('syncMemos（マルチユーザー: 所有判定）', () => {
  const EMAIL_CREDENTIALS = { username: 'user1@example.com', password: 'pass1' }

  /** 一覧取得リクエスト（activities.php）のクエリパラメータを返す。 */
  function listParams(calls) {
    const call = calls.find((c) => c.url.includes('/api/activities.php'))
    return new URLSearchParams(call.url.split('?')[1])
  }

  describe('通常経路（サーバ側 userid フィルタ）', () => {
    it('取得リクエストに userid パラメータ（ログインID）が付く', async () => {
      const { calls } = mockCmm({ activities: [] })
      await syncMemos({ memos: [], ...SYNC_DEFAULTS })
      expect(listParams(calls).get('userid')).toBe('user1')
    })

    it('userid は増分取得（updated_since）と併用される', async () => {
      const { calls } = mockCmm({ activities: [] })
      await syncMemos({ memos: [], ...SYNC_DEFAULTS, lastSyncAt: '2026-11-01T00:00:00Z' })
      const params = listParams(calls)
      expect(params.get('userid')).toBe('user1')
      expect(params.get('updated_since')).toBe('2026-11-01T00:00:00Z')
    })

    it('作成者が自分だが最終更新者が別人の投稿も取り込む（new-memo）', async () => {
      const activity = makeActivity({ id: 'MINE-1', osmid: 'way/999', updated_by_userid: 'other1' })
      mockCmm({ activities: [activity] })
      const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
      expect(result.imported).toHaveLength(1)
      expect(result.imported[0].cmmId).toBe('MINE-1')
    })

    it('作成者が自分だが最終更新者が別人の投稿も更新の対象にする（cmmId 対応付け）', async () => {
      const memo = makeMemo({ cmmId: 'MINE-1', cmmUpdatedAt: '2026-11-02T00:00:00Z', memo: 'ローカル新メモ' })
      const activity = makeActivity({ id: 'MINE-1', updated_at: '2026-11-01 00:00:00', updated_by_userid: 'other1', memo: '古い' })
      const updated = makeActivity({ id: 'MINE-1' })
      const { calls } = mockCmm({ activities: [activity], batchBody: { status: 'ok', created: [], updated: [updated], deleted: [] } })
      const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
      const body = JSON.parse(batchCall(calls).options.body)
      // ローカル（11-02）がリモート（11-01）より新しく内容が異なる → update
      expect(body.updates).toEqual([expect.objectContaining({ id: 'MINE-1', memo: 'ローカル新メモ' })])
      expect(body.creates).toEqual([])
      expect(result.imported).toEqual([])
      expect(result.updated).toEqual([updated])
    })

    it('自分の投稿は従来どおり取り込まれる（new-memo）', async () => {
      const mine = makeActivity({ id: 'MINE-1', osmid: 'way/999' })
      mockCmm({ activities: [mine] })
      const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS })
      expect(result.imported).toHaveLength(1)
      expect(result.imported[0].cmmId).toBe('MINE-1')
    })

    it('cmmId 無しの公開メモは、同一 osmid の自分の投稿と対応付いて取り込む', async () => {
      const memo = makeMemo()
      const mine = makeActivity({ id: 'MINE-1', updated_at: '2026-11-02 00:00:00', name: 'リモート名' })
      mockCmm({ activities: [mine] })
      const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
      expect(result.imported).toHaveLength(1)
      expect(result.imported[0].cmmId).toBe('MINE-1')
      expect(result.imported[0].key).toBe('node/100')
    })

    it('最終更新者が別人でもリモートが新しい場合は取り込む（updated_at 比較は従来どおり）', async () => {
      const memo = makeMemo({ cmmId: 'MINE-1', cmmUpdatedAt: '2026-11-01T00:00:00Z' })
      const activity = makeActivity({ id: 'MINE-1', updated_at: '2026-11-02 00:00:00', updated_by_userid: 'other1', name: 'リモート名' })
      mockCmm({ activities: [activity] })
      const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS })
      expect(result.imported).toHaveLength(1)
      expect(result.imported[0].key).toBe('node/100')
      expect(result.imported[0].name).toBe('リモート名')
      expect(result.updated).toEqual([])
    })

    it('他人の投稿は削除候補（deleteSet）に入らない', async () => {
      const other = makeActivity({ id: 'OTHER-1', updated_by_userid: 'other1' })
      const { calls } = mockCmm({ activities: [other] })
      const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS, tombstones: ['ACT-MINE'] })
      const body = JSON.parse(batchCall(calls).options.body)
      expect(body.deletes).toEqual(['ACT-MINE'])
      expect(result.deleted).toEqual(['ACT-MINE'])
    })
  })

  describe('フォールバック経路（メールアドレス形式のログインID）', () => {
    it('userid パラメータを使わず全件取得する', async () => {
      const { calls } = mockCmm({ activities: [] })
      await syncMemos({ memos: [], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      expect(listParams(calls).get('userid')).toBeNull()
    })

    it('他人の投稿は取り込まない（取り込み・作成・更新・削除に影響しない）', async () => {
      const other = makeActivity({ id: 'OTHER-1', osmid: 'way/999', updated_by_userid: 'other1' })
      mockCmm({ activities: [other] })
      const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      expect(result.imported).toEqual([])
      expect(result.created).toEqual([])
      expect(result.updated).toEqual([])
      expect(result.deleted).toEqual([])
    })

    it('メールアドレスのローカルパート一致では所有権を推測しない（完全一致のみ）', async () => {
      const activity = makeActivity({ id: 'ACT-1', osmid: 'way/999', updated_by_userid: 'user1' })
      mockCmm({ activities: [activity] })
      const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      // 'user1' != 'user1@example.com' → 他人扱い（取り込まない）
      expect(result.imported).toEqual([])
    })

    it('メールアドレス形式のログインIDが updated_by_userid と完全一致すれば自分の投稿として扱う', async () => {
      const mine = makeActivity({ id: 'MINE-1', osmid: 'way/999', updated_by_userid: 'user1@example.com' })
      mockCmm({ activities: [mine] })
      const result = await syncMemos({ memos: [], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      expect(result.imported).toHaveLength(1)
    })

    it('osmid 対応付けを行わず新規作成とする（推測しない）', async () => {
      const memo = makeMemo() // cmmId なし、osmid node/100
      const activity = makeActivity({ id: 'ACT-1', updated_by_userid: 'user1' }) // osmid node/100
      const created = makeActivity({ id: 'NEW-1' })
      const { calls } = mockCmm({ activities: [activity], batchBody: { status: 'ok', created: [created], updated: [], deleted: [] } })
      const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      const body = JSON.parse(batchCall(calls).options.body)
      expect(body.creates).toEqual([memoToActivity(memo, BOOKS)])
      expect(body.updates).toEqual([])
      expect(result.imported).toEqual([])
    })

    it('cmmId 連結による判定は有効（更新）', async () => {
      const memo = makeMemo({ cmmId: 'ACT-1', cmmUpdatedAt: '2026-11-02T00:00:00Z', memo: 'ローカル新メモ' })
      const activity = makeActivity({ id: 'ACT-1', updated_at: '2026-11-01 00:00:00', updated_by_userid: 'user1', memo: '古い' })
      const updated = makeActivity({ id: 'ACT-1' })
      const { calls } = mockCmm({ activities: [activity], batchBody: { status: 'ok', created: [], updated: [updated], deleted: [] } })
      const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      const body = JSON.parse(batchCall(calls).options.body)
      expect(body.updates).toHaveLength(1)
      expect(body.updates[0].id).toBe('ACT-1')
      expect(result.imported).toEqual([])
    })

    it('他人の投稿は取り込み・作成・更新・削除の件数に影響しない', async () => {
      const memo = makeMemo({ cmmId: 'MINE-1', cmmUpdatedAt: '2026-11-01T00:00:00Z' })
      const mine = makeActivity({ id: 'MINE-1', updated_at: '2026-11-02 00:00:00' }) // 自分の投稿（新しい）→ import
      const otherNew = makeActivity({ id: 'OTHER-1', osmid: 'way/777', updated_by_userid: 'other1' }) // 他人・新規
      const otherSame = makeActivity({ id: 'OTHER-2', osmid: 'node/100', updated_by_userid: 'other1' }) // 他人・同一 osmid
      mockCmm({ activities: [otherNew, otherSame, mine] })
      const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      expect(result.imported).toHaveLength(1)
      expect(result.imported[0].cmmId).toBe('MINE-1')
      expect(result.created).toEqual([])
      expect(result.updated).toEqual([])
      expect(result.deleted).toEqual([])
    })

    it('同一 osmid に複数 Activity がある場合、自分の投稿を対応付けに優先する', async () => {
      const memo = makeMemo() // cmmId なし、osmid node/100
      const other = makeActivity({ id: 'OTHER-1', updated_by_userid: 'other1' }) // 先に一覧へ
      // 自分の投稿はログインID（メールアドレス）と完全一致する必要がある
      const mine = makeActivity({ id: 'MINE-1', updated_at: '2026-11-02 00:00:00', name: 'リモート名', updated_by_userid: 'user1@example.com' }) // 後へ
      mockCmm({ activities: [other, mine] })
      const result = await syncMemos({ memos: [memo], ...SYNC_DEFAULTS, credentials: EMAIL_CREDENTIALS })
      expect(result.imported).toHaveLength(1)
      expect(result.imported[0].cmmId).toBe('MINE-1')
      expect(result.created).toEqual([])
    })
  })
})
