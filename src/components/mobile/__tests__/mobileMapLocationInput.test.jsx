// @vitest-environment jsdom
/**
 * (#xx) 地図モード（フォーム表示）の場所入力 E2E テスト
 *
 * 検索タブのフォーム表示・地図モードでは「どの街・エリアで探す？」セクションに
 * 場所入力欄を置く（トップの QuickTopIntro「どのあたりの場所？」と同様の挙動）。
 * 本テストはその統合挙動を検証する:
 *
 * - 地図モードの「どの街・エリアで探す？」セクションに場所入力欄＋検索範囲カード
 *   ＋「地名検索」ボタン
 * - 地名入力でサジェスト（自治体ローカル計算＋Overpass 周辺キャッシュの
 *   端末内照合。Nominatim は入力中に叩かない）→ 候補タップで検索エリアを設定
 *   （入力が緑＋「検索エリアに「○○」を設定しました」＋ state.bbox に
 *    bboxSource: geocode で設定）
 * - 「地名検索」ボタン（または Enter）で Nominatim ジオコード → 単一候補で
 *   エリアが設定される（viewbox 付き。現在位置 mock が有効なら）
 * - 自治体の完全一致名は source: municipality で設定される
 * - 複数候補はリストを提示し、タップで選択（1件を勝手に選ばない）
 * - 確定場所（geocode/municipality）は MapView に渡り、地図上に青い矩形
 *   （BBOXオーバーレイ）が描画され、fitBounds でその範囲にfitする
 * - 検索は確定した範囲で実行される（地図の現在表示範囲ではなく確定bbox。
 *    resolveSearchBbox の source 優先判定の統合検証）
 * - 入力をクリアすると矩形が消え、検索範囲は地図の現在表示範囲に戻る
 *
 * MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体を
 * モックする（mobileLayout.test.jsx と同じパターン）。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import App from '../../../App'
import { getMapInstance } from '../../../hooks/useMapRef'
import { clearCache } from '../../../utils/overpass'
import { loadMunicipalities } from '../../../utils/municipalities'
import { squareBboxAround } from '../../../utils/geo'
import { CATEGORY_GROUPS, getCategoriesForPurpose } from '../../../data/categories'

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return { default: mockState.api }
})

// ===== テスト用データ =====
const MUNI_DATA = {
  municipalities: [
    { code: '271000', prefCode: '27', prefecture: '大阪府', name: '東大阪市', adminLevel: 8, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 } },
  ]
}

// 「梅田」ジオコード候補（searchAreaFromGeocode による約1km²未満拡大の対象外:
// 範囲が約4.3km²のためそのまま採用される）
const UEDA_ROW = {
  lat: '34.700000',
  lon: '135.500000',
  display_name: '大阪府大阪市北区梅田1丁目',
  name: '梅田',
  type: 'suburb',
  boundingbox: ['34.69', '34.71', '135.49', '135.51'],
  address: { state: '大阪府', county: '北区', city: '大阪市' },
}

const KAGOSHI_UEMACHI_ROW = {
  lat: '31.591600',
  lon: '130.697500',
  display_name: '上本町, 鹿児島市, 鹿児島県, 日本',
  name: '上本町',
  type: 'suburb',
  boundingbox: ['31.58', '31.60', '130.68', '130.71'],
  address: { state: '鹿児島県', city: '鹿児島市' },
}
const OSAKA_UEMACHI_ROW = {
  lat: '34.700000',
  lon: '135.500000',
  display_name: '上本町, 大阪市北区, 大阪府, 日本',
  name: '上本町',
  type: 'suburb',
  boundingbox: ['34.69', '34.71', '135.49', '135.51'],
  address: { state: '大阪府', county: '北区', city: '大阪市' },
}

// 「大阪府」（都道府県レベル・広すぎる）ジオコード候補
const OSAKA_PREFECTURE_ROW = {
  lat: '34.600000',
  lon: '135.500000',
  display_name: '大阪府, 日本',
  name: '大阪府',
  type: 'administrative_area',
  addresstype: 'province',
  boundingbox: ['34.20', '35.40', '135.00', '136.50'],
  address: { state: '大阪府' },
}

// 梅田エリア（34.69–34.71 / 135.49–135.51）の内側にあるカフェ。
// 検索結果はクライアント側で検索bboxによりフィルタされるため、要素はこの
// 範囲内に置く（mock地図の既定表示範囲 34.8–34.9 / 135.4–135.6 の外）。
const OVERPASS_ELEMENTS = [
  { type: 'node', id: 1001, lat: 34.695, lon: 135.495, tags: { name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee', 'addr:suburb': '梅田' } },
]

// 周辺地名候補（around:5000 クエリ）のレスポンス用要素。
// 現在位置 mock（34.7, 135.5）の周囲に置く
const NEARBY_ELEMENTS = [
  { type: 'node', id: 2001, lat: 34.7, lon: 135.5, tags: { railway: 'station', name: '梅田駅' } },
  { type: 'node', id: 2002, lat: 34.701, lon: 135.499, tags: { place: 'neighbourhood', name: '梅田' } },
]

let nominatimRows = [UEDA_ROW]
// (place) Nominatim の fetch を「未解決」に保てる deferred（スピナー表示検証用）。
// null のときは従来どおり nominatimRows を即返す（既存テストへの影響なし）
let nominatimDeferred = null

function createDeferred() {
  let resolveFn
  const promise = new Promise((r) => { resolveFn = r })
  return {
    promise,
    resolve: (v) => resolveFn(v),
  }
}
let overpassCalls = []

// ===== フック =====
let mediaMatches = true
let mediaListeners = []

function setupMatchMedia() {
  mediaListeners = []
  window.matchMedia = (query) => ({
    matches: mediaMatches,
    media: query,
    addEventListener: (type, cb) => {
      if (type === 'change') mediaListeners.push(cb)
    },
    removeEventListener: (type, cb) => {
      mediaListeners = mediaListeners.filter((l) => l !== cb)
    },
  })
}

// Geolocation API のモック（jsdom には実装が無い）。現在位置は固定値
// （34.7, 135.5）。周辺候補の取得と「地名検索」の viewbox 付けに使う
function setupGeolocationMock() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok) => {
        setTimeout(() => ok({ coords: { latitude: 34.7, longitude: 135.5 } }), 0)
      },
      watchPosition: () => 0,
      clearWatch: () => {},
    },
  })
}

function setupFetchMock() {
  const mockFetch = vi.fn(async (url, options = {}) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => MUNI_DATA }
    }
    if (u.includes('nominatim')) {
      if (nominatimDeferred) {
        // (place) リクエストを実際に Pending 状態に保ち、スピナー表示を検証する
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: () => nominatimDeferred.promise,
        }
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => nominatimRows,
      }
    }
    if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
      const body = options.body || ''
      const q = new URLSearchParams(body).get('data') || body
      overpassCalls.push(q)
      // 周辺候補取得クエリ（around:5000 を含む）と施設検索クエリで返す要素を変える
      const isNearby = q.includes('around:5000')
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: isNearby ? NEARBY_ELEMENTS : OVERPASS_ELEMENTS }),
      }
    }
    return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
}

function renderApp() {
  window.history.replaceState(null, '', '/')
  render(<App />)
}

// ===== 操作ヘルパー =====

// (#xx) フォームは常に地図モード（ソース切替タブは撤去済み）。フォームへ
// 切替して地図モードの操作を行う
async function openMapMode() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()
  }, { timeout: 4000 })
}

// 地図モードの場所入力欄（「どの街・エリアで探す？」セクション内）
function getLocationInput() {
  return within(screen.getByRole('region', { name: '検索範囲' }))
    .getByPlaceholderText('地名・駅名（例: 大阪駅）')
}

// サジェスト候補（role=option）を取得（空配列を返す安全版: 空のときはthrowしない）
function getSuggestOptions() {
  return screen.queryAllByRole('option').filter((o) => o.closest('[role="listbox"]'))
}

// role=alert の要素のテキストから条件に合うものを探す（jest-dom不使用のため）
function findAlertText(pattern) {
  return screen.queryAllByRole('alert').some(
    (el) => el.textContent && pattern.test(el.textContent)
  )
}

// 「地名」を入力してサジェスト候補の表示を待つ。
// 先にフォーカスすることで周辺候補の取得（現在位置→Overpass）が起動し、
// 入力は「自治体＋周辺キャッシュ」の端末内照合候補を即座に表示する
async function typeAndAwaitSuggest(query, { optionCount = 1 } = {}) {
  fireEvent.focus(getLocationInput())
  fireEvent.change(getLocationInput(), { target: { value: query } })
  await waitFor(() => {
    expect(getSuggestOptions().length).toBeGreaterThanOrEqual(optionCount)
  }, { timeout: 8000 })
}

// 候補タップ → 検索エリア設定成功（緑＋フィードバック）を待つ
async function selectAndAwaitArea(option) {
  fireEvent.click(option)
  await waitFor(() => {
    expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
  }, { timeout: 8000 })
}

// 入力欄で Enter を押して確定し、成功フィードバックを待つ
async function confirmAndAwaitArea() {
  fireEvent.keyDown(getLocationInput(), { key: 'Enter' })
  await waitFor(() => {
    expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
  }, { timeout: 8000 })
}

// (#44) 目的チップ→カテゴリチップ でカテゴリを選択する（mobileLayout と同じ）
function selectCategoryChip(catLabel) {
  for (const g of CATEGORY_GROUPS) {
    const cats = getCategoriesForPurpose(g.name) || []
    const cat = cats.find((c) => c.label === catLabel)
    if (!cat) continue
    fireEvent.click(screen.getByRole('button', { name: g.name }))
    fireEvent.click(screen.getByRole('button', { name: catLabel }))
    return true
  }
  throw new Error(`カテゴリチップが見つからない: ${catLabel}`)
}

// jsdomではgetBoundingClientRectが常に0を返すため、fitBounds系テストでは
// コンテナのサイズをパッチして「表示中」を再現する（MapView.test.jsx と同じ）
function mockVisibleContainer() {
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  spy.mockReturnValue({
    width: 300, height: 300, top: 0, left: 0, right: 300, bottom: 300, x: 0, y: 0,
    toJSON: () => ({}),
  })
  return spy
}

// 現在の共有地図モックの fitBounds 呼び出し列
function fitCalls() {
  const map = getMapInstance()
  return (map?._calls || []).filter((c) => c.name === 'fitBounds')
}

// BBOXオーバーレイ矩形GeoJSONの座標列（閉じたLineString）
function overlayCoords() {
  const map = getMapInstance()
  const src = map?.getSource?.('bbox-overlay')
  return src?._data?.features?.[0]?.geometry?.coordinates || null
}

beforeEach(() => {
  mediaMatches = true
  setupMatchMedia()
  if (mockState.api) mockState.api.resetState()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  overpassCalls = []
  nominatimRows = [UEDA_ROW]
  nominatimDeferred = null
  setupGeolocationMock()
  setupFetchMock()
  clearCache()
})

afterEach(() => {
  cleanup()
})

// ===== テスト =====

describe('(#xx) 地図モードの場所入力（「どの街・エリアで探す？」セクション）', () => {
  it('地図モードでは場所入力欄と「地図の現在表示範囲」のカードが表示される', async () => {
    renderApp()
    await openMapMode()

    const section = screen.getByRole('region', { name: '検索範囲' })
    expect(within(section).getByText('どの街・エリアで探す？')).toBeTruthy()
    // 場所入力欄（トップの QuickTopIntro と同じplaceholder）
    expect(within(section).getByPlaceholderText('地名・駅名（例: 大阪駅）')).toBeTruthy()
    // 未確定時は地図の現在表示範囲を表示
    expect(within(section).getByText('地図の現在表示範囲')).toBeTruthy()
    // 検索ボタンラベルは「この表示範囲で検索」
    expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()
  })

  it('地名入力でサジェストが表示され、候補タップで検索エリアが設定される', async () => {
    renderApp()
    await openMapMode()
    // サジェストは端末内照合（自治体＋周辺 Overpass キャッシュ）。
    // Nominatim は入力中に叩かない
    await typeAndAwaitSuggest('梅田')
    // 梅田駅（駅・距離0）＋梅田（地区・約140m）の2件が距離順で出る
    const options = getSuggestOptions()
    expect(options).toHaveLength(2)
    expect(options[0].textContent).toContain('梅田駅')
    expect(options[0].textContent).toContain('駅')
    expect(options[1].textContent).toContain('地区')

    // 駅候補をタップ（点候補: BBOXなし → 約1km正方形に拡大される）
    await selectAndAwaitArea(options[0])

    // 緑＋成功フィードバック（周辺候補の displayName は名称）
    const input = getLocationInput()
    expect(input.className).toContain('border-green-500')
    expect(screen.getByText('検索エリアに「梅田駅」を設定しました')).toBeTruthy()

    // 検索ボタンラベルが「この範囲で検索」に変わり、AreaCardは確定場所を表示
    expect(screen.getByRole('button', { name: 'この範囲で検索' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
    const section = screen.getByRole('region', { name: '検索範囲' })
    expect(within(section).getByText(/検索範囲: 梅田駅/)).toBeTruthy()

    // state.bbox（source: geocode）は MapView に渡り、地図上に矩形が描画される。
    // 駅（点）候補は約1km正方形に拡大される
    const map = getMapInstance()
    expect(map.getSource('bbox-overlay')).toBeTruthy()
    expect(map._layers.some((l) => l.id === 'bbox-overlay-line')).toBe(true)
    const sq = squareBboxAround({ lat: 34.7, lon: 135.5 })
    expect(overlayCoords()).toEqual([
      [sq.west, sq.south],
      [sq.east, sq.south],
      [sq.east, sq.north],
      [sq.west, sq.north],
      [sq.west, sq.south],
    ])
  })

  it('入力欄でEnterを押すと「地名検索」が実行され、単一候補で検索エリアが確定される', async () => {
    renderApp()
    await openMapMode()

    await typeAndAwaitSuggest('梅田')
    await confirmAndAwaitArea()

    // Enter は Nominatim ジオコード（「地名検索」と同じ）。
    // 単一候補（梅田: 範囲約4.3km²で拡大対象外）の範囲がそのまま採用される
    expect(getLocationInput().className).toContain('border-green-500')
    expect(screen.getByText('検索エリアに「大阪府大阪市北区梅田1丁目」を設定しました')).toBeTruthy()
    expect(getMapInstance().getSource('bbox-overlay')).toBeTruthy()
  }, 15000)

  it('確定場所（geocode）ではfitBoundsが確定範囲で呼ばれる', async () => {
    renderApp()
    await openMapMode()
    expect(fitCalls()).toHaveLength(0)

    const spy = mockVisibleContainer()
    try {
      await typeAndAwaitSuggest('梅田')
      await confirmAndAwaitArea()

      const fits = fitCalls()
      expect(fits).toHaveLength(1)
      expect(fits[0].args[0]).toEqual([[135.49, 34.69], [135.51, 34.71]])
      expect(fits[0].args[1]).toEqual({ padding: 40, maxZoom: 17, duration: 800 })
    } finally {
      spy.mockRestore()
    }
  }, 15000)

  it('自治体の完全一致名はEnterで確定され、source: municipality として矩形が描画される', async () => {
    renderApp()
    // 自治体データ（municipalities.json）はトップ表示中に読み込まれる。ビュー切替
    // （act 内の同期コミット）が先に進むと loadMunicipalities の .then がキャンセル
    // されて state に入らないため、切替前に読み込み完了を待つ
    await act(async () => { await loadMunicipalities() })
    await openMapMode()

    // 自治体サジェストは静的データのローカル計算（デバウンス・Nominatim待ちなし）
    await typeAndAwaitSuggest('東大阪市')
    const option = getSuggestOptions()[0]
    expect(option.textContent).toContain('東大阪市')

    const spy = mockVisibleContainer()
    try {
      fireEvent.keyDown(getLocationInput(), { key: 'Enter' })
      await waitFor(() => {
        expect(screen.getByText('検索エリアに「東大阪市」を設定しました')).toBeTruthy()
      }, { timeout: 8000 })

      // 矩形は東大阪市の範囲で描画され、fitBounds もその範囲で呼ばれる
      expect(overlayCoords()).toEqual([
        [135.34, 34.56],
        [135.52, 34.56],
        [135.52, 34.72],
        [135.34, 34.72],
        [135.34, 34.56],
      ])
      const fits = fitCalls()
      expect(fits).toHaveLength(1)
      expect(fits[0].args[0]).toEqual([[135.34, 34.56], [135.52, 34.72]])
    } finally {
      spy.mockRestore()
    }
  }, 15000)

  it('「地名検索」で候補が複数の場合はリストを提示し、タップした候補のエリアが設定される', async () => {
    nominatimRows = [KAGOSHI_UEMACHI_ROW, OSAKA_UEMACHI_ROW]
    renderApp()
    await openMapMode()

    fireEvent.change(getLocationInput(), { target: { value: '上本町' } })
    // Enter で「地名検索」を実行。Nominatim に候補が2件ある場合は
    // リストを提示する（1件目を勝手に選ばない）
    fireEvent.keyDown(getLocationInput(), { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByText('候補が複数あります。選んでください。')).toBeTruthy()
    }, { timeout: 8000 })

    // 大阪側の候補を選ぶ（鹿児島側は選ばない）
    const osakaOption = getSuggestOptions().find((o) => o.textContent.includes('大阪府'))
    await selectAndAwaitArea(osakaOption)

    expect(screen.getByText('検索エリアに「上本町, 大阪市北区, 大阪府, 日本」を設定しました')).toBeTruthy()
    expect(overlayCoords()).toEqual([
      [135.49, 34.69],
      [135.51, 34.69],
      [135.51, 34.71],
      [135.49, 34.71],
      [135.49, 34.69],
    ])
  }, 15000)

  it('場所が見つからない場合はエラーが表示され、エリアは設定されない', async () => {
    nominatimRows = []
    renderApp()
    await openMapMode()

    fireEvent.change(getLocationInput(), { target: { value: '存在しない町' } })
    // Enter で「地名検索」を試みる（実行中のローカルサジェストは自動でクリアされる）
    fireEvent.keyDown(getLocationInput(), { key: 'Enter' })

    await waitFor(() => {
      expect(findAlertText(/場所が見つかりませんでした/)).toBe(true)
    }, { timeout: 8000 })
    // エリアは設定されない（緑にならない・矩形は描画されない）
    expect(getLocationInput().className).not.toContain('border-green-500')
    expect(getMapInstance().getSource('bbox-overlay')).toBeNull()
  }, 15000)

  it('広すぎる候補（都道府県レベル）は「地名検索」でエリアに設定されずエラーが表示される', async () => {
    nominatimRows = [OSAKA_PREFECTURE_ROW]
    renderApp()
    await openMapMode()

    fireEvent.change(getLocationInput(), { target: { value: '大阪府' } })
    // Enter で「地名検索」を実行。単一候補でも広すぎる場合は設定されず、
    // エラーが案内される
    fireEvent.keyDown(getLocationInput(), { key: 'Enter' })

    await waitFor(() => {
      expect(findAlertText(/範囲が広すぎるため検索できません/)).toBe(true)
    }, { timeout: 8000 })
    expect(getLocationInput().className).not.toContain('border-green-500')
    expect(screen.queryByText(/検索エリアに.*を設定しました/)).toBeNull()
    expect(getMapInstance().getSource('bbox-overlay')).toBeNull()
  }, 15000)

  it('検索は確定した範囲で実行される（地図の現在表示範囲ではなく確定bbox）', async () => {
    renderApp()
    await openMapMode()

    // 確定場所を設定（Enter→「地名検索」: 梅田 34.69–34.71 / 135.49–135.51）
    await typeAndAwaitSuggest('梅田')
    await confirmAndAwaitArea()

    // カフェを検索（mock地図の既定表示範囲は 34.8–34.9 / 135.4–135.6）
    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この範囲で検索' }))

    // Overpass クエリに確定範囲（梅田）が含まれ、地図表示範囲は含まれない。
    // overpassCalls には周辺候補取得クエリ（around:5000）も混入するため、
    // 施設検索クエリ（around 無し）だけを見る
    const facilityCalls = overpassCalls.filter((q) => !q.includes('around:5000'))
    await waitFor(() => {
      expect(facilityCalls.length).toBeGreaterThanOrEqual(1)
    }, { timeout: 8000 })
    expect(facilityCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')
    expect(facilityCalls[0]).not.toContain('34.800000,135.400000,34.900000,135.600000')

    // 結果は確定範囲内の施設のみ（検索bboxでクライアントフィルタ）
    await waitFor(() => {
      expect(screen.getByText('テスト珈琲店')).toBeTruthy()
    }, { timeout: 8000 })
  }, 15000)

  it('入力をクリアすると矩形が消え、検索範囲は地図の現在表示範囲に戻る', async () => {
    renderApp()
    await openMapMode()

    // 確定場所を設定（Enter→「地名検索」）
    await typeAndAwaitSuggest('梅田')
    await confirmAndAwaitArea()
    expect(getMapInstance().getSource('bbox-overlay')).toBeTruthy()

    // 入力をクリア（handlePlaceQueryChange('') が SET_BBOX null をdispatch）
    fireEvent.change(getLocationInput(), { target: { value: '' } })

    // 矩形ソース・レイヤが削除される
    await waitFor(() => {
      expect(getMapInstance().getSource('bbox-overlay')).toBeNull()
    }, { timeout: 4000 })
    const map = getMapInstance()
    expect(map._layers.some((l) => l.id === 'bbox-overlay-line')).toBe(false)

    // 緑が解除され、カード・ボタンラベルが地図表示範囲に戻る
    expect(getLocationInput().className).not.toContain('border-green-500')
    expect(screen.queryByText(/検索エリアに.*を設定しました/)).toBeNull()
    const section = screen.getByRole('region', { name: '検索範囲' })
    expect(within(section).getByText('地図の現在表示範囲')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()

    // クリア後の検索は地図の表示範囲で実行される（周辺候補クエリを除く）
    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))
    await waitFor(() => {
      expect(overpassCalls.some((q) => !q.includes('around:5000') &&
        q.includes('34.800000,135.400000,34.900000,135.600000'))).toBe(true)
    }, { timeout: 8000 })
  }, 15000)

  it('「地名検索」実行中に入力欄右端にスピナーが表示され、完了で消える（入力は無効化されない）', async () => {
    renderApp()
    await openMapMode()
    // Nominatim の fetch を未解決に保つ（リクエストを実際に Pending 状態にする）
    nominatimDeferred = createDeferred()

    const input = getLocationInput()
    fireEvent.change(input, { target: { value: '梅田' } })

    // 「地名検索」ボタンを押下 → geocodeCandidates が走り、
    // リクエスト開始でスピナーが表示される
    const section = screen.getByRole('region', { name: '検索範囲' })
    fireEvent.click(within(section).getByRole('button', { name: '地名検索' }))

    // スピナーが現れるまで待つ（率制限待ちを含む）
    await waitFor(() => {
      expect(screen.queryByTestId('place-input-spinner')).toBeTruthy()
    }, { timeout: 8000 })

    // スピナー表示中も入力は無効化されない（disabled にならない）
    expect(getLocationInput().disabled).toBe(false)
    // 右パディングが広がっている（スピナーのスペース確保: pr-9）
    expect(getLocationInput().className).toContain('pr-9')
    // 「地名検索」ボタン自身も実行中は無効化される
    expect(within(section).getByRole('button', { name: '地名検索' }).disabled).toBe(true)

    // リクエスト完了（単一候補返却）→ スピナー消滅 ＋ エリア設定
    nominatimDeferred.resolve([UEDA_ROW])
    await waitFor(() => {
      expect(screen.queryByTestId('place-input-spinner')).toBeNull()
    }, { timeout: 8000 })
    await waitFor(() => {
      expect(screen.getByText('検索エリアに「大阪府大阪市北区梅田1丁目」を設定しました')).toBeTruthy()
    }, { timeout: 8000 })
  }, 15000)
})
