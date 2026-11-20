// @vitest-environment jsdom
/**
 * (#62) useSearch — バリアフリー検索フローの統合テスト
 *
 * - バリアフリー検索（queryKind: barrier_free）は executeOverpassQuery に
 *   parseBarrierFreeResponse を渡す（既定の parseOverpassResponse では
 *   out geom のウェイが center 参照で落ちるため）
 * - バリアフリー検索では filterByKeyword を適用しない
 *   （歩道・縁石・音声案内ノードは name が無く、絞り込むと結果が消える）
 * - POI 検索は従来どおりキーワード絞り込みを適用（後方互換）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({
  app: { state: null, dispatch: () => {} },
  actions: [],
  overpassCalls: [],
  overpassResults: [],
  overpassError: null // 設定されていると executeOverpassQuery がそれをthrowする（通信エラー擬制）
}))

vi.mock('../../context/AppContext', () => ({
  useApp: () => h.app
}))

vi.mock('../../utils/overpass', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    executeOverpassQuery: async (query, options = {}) => {
      h.overpassCalls.push({ query, options })
      if (h.overpassError) throw h.overpassError
      return {
        results: h.overpassResults,
        meta: {
          elementCount: h.overpassResults.length,
          cached: false,
          fallback: false,
          endpoint: 'mock',
          elapsedMs: 1,
          fetchedAt: new Date().toISOString(),
          attempts: []
        }
      }
    }
  }
})

import { useSearch } from '../useSearch'
import { parseBarrierFreeResponse } from '../../utils/barrierFreeResults'
import { buildBarrierFreeQuery } from '../../utils/barrierFree'

const SMALL_BBOX = { south: 34.7, west: 135.5, north: 34.72, east: 135.52 }

/** name タグが無い要素（バリアフリー要素の大多数） */
const unnamedFootway = {
  type: 'way',
  id: 100,
  lat: 34.703,
  lon: 135.505,
  tags: { highway: 'footway', tactile_paving: 'yes' },
  name: null,
  osmId: 'way/100',
  // 検索BBOX（SMALL_BBOX: 34.7–34.72 / 135.5–135.52）の内側に置く（bboxフィルタ対策）
  bf: { kind: 'way', tactile: 'yes', lengthM: 152, kerb: null, hasSound: false, hasVibration: false, geometry: [[135.5, 34.7], [135.51, 34.71]] }
}

/** キーワードと完全一致する名称を持つ要素 */
const namedFootway = {
  type: 'way',
  id: 101,
  lat: 34.71,
  lon: 135.515,
  tags: { highway: 'footway', name: '駅前通り' },
  name: '駅前通り',
  osmId: 'way/101',
  // 検索BBOX（SMALL_BBOX: 34.7–34.72 / 135.5–135.52）の内側に置く（bboxフィルタ対策）
  bf: { kind: 'way', tactile: null, lengthM: 80, kerb: null, hasSound: false, hasVibration: false, geometry: [[135.51, 34.71], [135.52, 34.71]] }
}

function makeState(overrides = {}) {
  return {
    searchSource: 'map',
    searchMode: 'simple',
    bbox: SMALL_BBOX,
    simpleSearch: { category: '', keyword: '', cuisine: '', purpose: '' },
    municipalitySearch: { category: '', cuisine: '', purpose: '' },
    advancedSearch: { tags: [], keyword: '', useAnd: true },
    ...overrides
  }
}

async function runSearch(criteria = null) {
  const { result } = renderHook(() => useSearch())
  await act(async () => {
    await result.current.search(criteria)
  })
}

beforeEach(() => {
  h.actions.length = 0
  h.overpassCalls.length = 0
  h.overpassResults.length = 0
  h.overpassError = null
  h.app.dispatch = (action) => { h.actions.push(action) }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const dispatched = (type) => h.actions.filter((a) => a.type === type)
const resultsPayload = () => dispatched('SET_RESULTS')[0]?.payload

describe('useSearch: バリアフリー検索 (#62)', () => {
  it('legacy経路: barrier_free カテゴリ → parseBarrierFreeResponse を渡し、キーワード絞り込みをしない', async () => {
    h.app.state = makeState({
      simpleSearch: { category: 'barrier_free', keyword: '駅前通り', cuisine: '', purpose: '' }
    })
    h.overpassResults = [unnamedFootway, namedFootway]

    // legacy方式: 裸のBBOXオブジェクトを渡すと最新のstateからクエリを生成する
    await runSearch({ ...SMALL_BBOX })

    // バリアフリー専用クエリ（buildBarrierFreeQuery の出力と一致）を生成している
    expect(h.overpassCalls[0].query).toBe(buildBarrierFreeQuery(SMALL_BBOX))
    // バリアフリーパーサを渡している
    expect(h.overpassCalls[0].options.parse).toBe(parseBarrierFreeResponse)
    // (#63) バリアフリー検索のみ: タイムアウト延長オプションを渡す
    expect(h.overpassCalls[0].options.perAttemptTimeout).toBe(60000)
    expect(h.overpassCalls[0].options.timeout).toBe(150000)
    // キーワード絞り込みをしないため、name の無い要素も残る
    expect(resultsPayload()).toHaveLength(2)
    expect(dispatched('SET_RESULT_KIND')[0].payload).toBe('barrier_free')
    expect(dispatched('SET_STATUS').at(-1).payload).toBe('success')
  })

  it('legacy経路: 自治体モード + barrier_free カテゴリ → 専用バリアフリークエリを使い、絞り込みしない', async () => {
    h.app.state = makeState({
      searchSource: 'municipality',
      municipalitySearch: { category: 'barrier_free', cuisine: '', purpose: '' }
    })
    h.overpassResults = [unnamedFootway, namedFootway]

    await runSearch({ ...SMALL_BBOX })

    expect(h.overpassCalls[0].query).toBe(buildBarrierFreeQuery(SMALL_BBOX))
    expect(h.overpassCalls[0].options.parse).toBe(parseBarrierFreeResponse)
    expect(resultsPayload()).toHaveLength(2)
    expect(dispatched('SET_RESULT_KIND')[0].payload).toBe('barrier_free')
  })

  it('legacy経路: 目的「バリアフリー」（カテゴリ未選択）でも専用バリアフリークエリを使う', async () => {
    h.app.state = makeState({
      simpleSearch: { category: '', keyword: '', cuisine: '', purpose: 'バリアフリー' }
    })
    h.overpassResults = [unnamedFootway, namedFootway]

    await runSearch({ ...SMALL_BBOX })

    expect(h.overpassCalls[0].query).toBe(buildBarrierFreeQuery(SMALL_BBOX))
    expect(h.overpassCalls[0].options.parse).toBe(parseBarrierFreeResponse)
    expect(resultsPayload()).toHaveLength(2)
    expect(dispatched('SET_RESULT_KIND')[0].payload).toBe('barrier_free')
  })

  it('criteria経路: バリアフリーの criteria（queryKind）→ 同様に絞り込みしない', async () => {
    h.app.state = makeState()
    h.overpassResults = [unnamedFootway, namedFootway]
    const criteria = {
      ok: true,
      bbox: SMALL_BBOX,
      searchSource: 'map',
      searchMode: 'simple',
      category: 'barrier_free',
      keyword: '駅前通り',
      queryKind: 'barrier_free',
      query: 'MOCK_BARRIER_FREE_QUERY'
    }

    await runSearch(criteria)

    expect(h.overpassCalls[0].query).toBe('MOCK_BARRIER_FREE_QUERY')
    expect(h.overpassCalls[0].options.parse).toBe(parseBarrierFreeResponse)
    // (#63) criteria経路でもバリアフリー検索はタイムアウト延長オプションを渡す
    expect(h.overpassCalls[0].options.perAttemptTimeout).toBe(60000)
    expect(h.overpassCalls[0].options.timeout).toBe(150000)
    expect(resultsPayload()).toHaveLength(2)
    expect(dispatched('SET_RESULT_KIND')[0].payload).toBe('barrier_free')
  })

  it('POI検索は従来どおりキーワード絞り込みを適用する（後方互換）', async () => {
    h.app.state = makeState({
      simpleSearch: { category: 'cafe', keyword: '駅前通り', cuisine: '', purpose: '' }
    })
    h.overpassResults = [unnamedFootway, namedFootway]

    await runSearch({ ...SMALL_BBOX })

    // parseオプションなし（既定の parseOverpassResponse）
    expect(h.overpassCalls[0].options.parse).toBeUndefined()
    // (#63) バリアフリー以外（POI）の検索では延長オプションを渡さない（config の既定を使う）
    expect(h.overpassCalls[0].options.perAttemptTimeout).toBeUndefined()
    expect(h.overpassCalls[0].options.timeout).toBeUndefined()
    // name の無い要素は絞り込みで除外される
    expect(resultsPayload()).toHaveLength(1)
    expect(resultsPayload()[0].osmId).toBe('way/101')
    expect(dispatched('SET_RESULT_KIND')[0].payload).toBe('poi')
  })

  it('POI検索では検索範囲外の結果が落ちる（armd-01のグリッド拡張対策）', async () => {
    h.app.state = makeState({
      simpleSearch: { category: 'cafe', keyword: '', cuisine: '', purpose: '' }
    })
    const poiIn = { type: 'node', id: 401, lat: 34.71, lon: 135.51, tags: { amenity: 'cafe', name: '範囲内' }, name: '範囲内', osmId: 'node/401' }
    const poiOut = { type: 'node', id: 402, lat: 34.9, lon: 135.7, tags: { amenity: 'cafe', name: '範囲外' }, name: '範囲外', osmId: 'node/402' }
    h.overpassResults = [poiIn, poiOut]

    await runSearch({ ...SMALL_BBOX })

    expect(resultsPayload()).toHaveLength(1)
    expect(resultsPayload()[0].osmId).toBe('node/401')
  })

  it('キーワード未入力のバリアフリー検索 → 全結果が残る', async () => {
    h.app.state = makeState({
      simpleSearch: { category: 'barrier_free', keyword: '', cuisine: '', purpose: '' }
    })
    h.overpassResults = [unnamedFootway, namedFootway]

    await runSearch({ ...SMALL_BBOX })

    expect(resultsPayload()).toHaveLength(2)
  })
})

describe('useSearch: 検証エラーは接続エラー（network）として扱わない', () => {
  it('BBOX未設定: errorTypeはvalidation（networkではない）でクエリは送出されない', async () => {
    h.app.state = makeState({ bbox: null })
    await runSearch({ ok: true, bbox: null, searchSource: 'map', searchMode: 'simple', keyword: '', query: 'MOCK_QUERY' })

    // クエリは送出されない
    expect(h.overpassCalls).toHaveLength(0)

    const err = dispatched('SET_ERROR')[0]
    expect(err.payload).toBe('検索範囲が設定されていません。')
    expect(err.errorType).toBe('validation')
    expect(err.errorType).not.toBe('network')
    // 案内文は「検索する」ボタンの押下を前提にしない（一般向けトップでも通用する）
    expect(err.errorSuggestion).toBe('地図を移動・拡大して検索したい範囲を表示してください。')
    expect(err.errorSuggestion).not.toContain('検索する」を押して')
    expect(dispatched('SET_STATUS').at(-1).payload).toBe('error')
  })

  it('縮退・逆順BBOX: 同様にvalidationの検証エラーになる', async () => {
    // south > north の逆順BBOX（isValidBbox で無効扱い）
    const reversed = { south: 34.72, west: 135.5, north: 34.7, east: 135.52 }
    h.app.state = makeState()
    await runSearch({ ok: true, bbox: reversed, searchSource: 'map', searchMode: 'simple', keyword: '', query: 'MOCK_QUERY' })

    expect(h.overpassCalls).toHaveLength(0)
    const err = dispatched('SET_ERROR')[0]
    expect(err.payload).toBe('検索範囲が設定されていません。')
    expect(err.errorType).toBe('validation')
    expect(err.errorType).not.toBe('network')
  })

  it('範囲が広すぎる（40000km²超）: 同様にvalidationの検証エラーになる', async () => {
    const HUGE = { south: -30, west: 100, north: 50, east: 200 }
    h.app.state = makeState()
    await runSearch({ ok: true, bbox: HUGE, searchSource: 'map', searchMode: 'simple', keyword: '', query: 'MOCK_QUERY' })

    expect(h.overpassCalls).toHaveLength(0)
    const err = dispatched('SET_ERROR')[0]
    // checkBboxSize は面積>2500km²の時点で「広すぎます」メッセージを返す（>40000km²の
    // 「大きすぎます」分岐は到達しない既存挙動）。useSearch はそのmessageをそのまま使う
    expect(err.payload).toMatch(/検索範囲が広すぎます/)
    expect(err.errorType).toBe('validation')
    expect(err.errorType).not.toBe('network')
    expect(err.errorSuggestion).toBe('地図をズームインして範囲を狭めてください。')
  })

  it('本物の通信エラー（fetch失敗）: errorTypeは従来どおりnetworkのまま', async () => {
    const { OverpassError } = await import('../../utils/overpass')
    h.app.state = makeState()
    h.overpassError = new OverpassError('Overpass APIに接続できませんでした', 'network', '時間をおいて再試行してください。')

    await runSearch({ ok: true, bbox: SMALL_BBOX, searchSource: 'map', searchMode: 'simple', keyword: '', queryKind: 'poi', query: 'MOCK_QUERY' })

    // 検索開始時に SET_ERROR(payload: null) で旧エラーをクリアするため、
    // 実際のエラーは最後の SET_ERROR dispatch
    const err = dispatched('SET_ERROR').at(-1)
    expect(err.payload).toBe('Overpass APIに接続できませんでした')
    expect(err.errorType).toBe('network')
    expect(err.errorSuggestion).toBe('時間をおいて再試行してください。')
    expect(dispatched('SET_STATUS').at(-1).payload).toBe('error')
  })
})
