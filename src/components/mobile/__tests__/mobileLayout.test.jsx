// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import App from '../../../App'
import { getMapInstance } from '../../../hooks/useMapRef'
import { clearCache } from '../../../utils/overpass'
import { PLACE_HISTORY_KEY } from '../../../utils/placeHistory'
import { CATEGORY_GROUPS, getCategoriesForPurpose } from '../../../data/categories'

// (#59) モバイルレイアウト E2E テスト
//
// - ビューポート幅による PC/モバイル レイアウト切替（matchMedia スタブで制御）
// - モバイル3タブ（検索/一覧/その他）の遷移と状態保持（#60: 地図は検索タブ内に内蔵）
// - 検索タブ内の地図モード検索 → クエリに地図BBOXが反映される
// - 検索成功時の「一覧」タブ自動切替
// - 検索タブの「この表示範囲で検索」明示トリガー（地図移動だけでは検索しない）
// - 検索結果カードやサムネイルで地図上の施設を選択
// - マーカータップ → 詳細ボトムシート
// - 自治体モード検索
// - (#xx) フォームは常に地図モード（ソース切替タブは撤去済み）。地図モード検証
//   テストはフォームビューでフォーム要素の描画を待ってから操作する
// - エラー時: バannerがタブ切替をまたいで表示される
//
// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
// vi.mockファクトリはファイル先頭にホイスされるため、共通モックは動的importで参照。
// マップインスタンスの操作は mockState.api._state.maps から取得できる。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

vi.mock('../../../utils/resultThumbs', () => ({
  getCachedThumb: () => 'data:image/png;base64,AA==',
}))

// ===== テスト用データ =====
const MUNI_DATA = {
  municipalities: [
    { code: '271000', prefCode: '27', prefecture: '大阪府', name: '東大阪市', adminLevel: 8, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 } },
    { code: '27109', prefCode: '27', prefecture: '大阪府', name: '大阪市', adminLevel: 7, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 }, displayName: '大阪市（都府県）' },
    { code: '27102', prefCode: '27', prefecture: '大阪府', name: '大阪市北区', adminLevel: 8, bbox: { south: 34.78051, west: 135.47011, north: 34.79045, east: 135.50012 } },
    { code: '27103', prefCode: '27', prefecture: '大阪府', name: '大阪市中央区', adminLevel: 8, bbox: { south: 34.66000, west: 135.47000, north: 34.69000, east: 135.50000 } },
  ]
}

const OVERPASS_ELEMENTS = [
  { type: 'node', id: 1001, lat: 34.85, lon: 135.5, tags: { name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee', 'addr:city': '大阪市', 'addr:suburb': '梅田', 'addr:street': '1-1', phone: '+81-6-1234-5678', website: 'https://example.com/coffee', wheelchair: 'yes', 'wheelchair:description:ja': '段差なし' } },
  { type: 'node', id: 1002, lat: 34.86, lon: 135.51, tags: { name: 'ラーメン屋テスト', amenity: 'restaurant', cuisine: 'ramen' } },
  { type: 'way', id: 2001, center: { lat: 34.87, lon: 135.52 }, tags: { name: 'テスト書店', shop: 'books' } },
]

// (#63) 複合タイル「病院・薬局」検証用の要素（病院＋薬局＋グループ外の書店）
const MEDICAL_ELEMENTS = [
  { type: 'node', id: 4001, lat: 34.85, lon: 135.5, tags: { name: 'テスト病院', amenity: 'hospital' } },
  { type: 'node', id: 4002, lat: 34.86, lon: 135.51, tags: { name: 'テスト薬局', amenity: 'pharmacy' } },
  { type: 'way', id: 4003, center: { lat: 34.87, lon: 135.52 }, tags: { name: 'テスト書店', shop: 'books' } },
]

// (#63) 「梅田」ジオコード検索エリア（34.69–34.71 / 135.49–135.51）の内側にある
// POI要素。POI検索の結果はクライアント側で検索bboxによりフィルタされるため、
// ジオコード/自治体bboxで検索するテストでは要素を検索エリア内に置く。
const OVERPASS_ELEMENTS_UMEDA = [
  { type: 'node', id: 1001, lat: 34.695, lon: 135.495, tags: { name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee', 'addr:city': '大阪市', 'addr:suburb': '梅田', 'addr:street': '1-1', phone: '+81-6-1234-5678', website: 'https://example.com/coffee', wheelchair: 'yes', 'wheelchair:description:ja': '段差なし' } },
  { type: 'node', id: 1002, lat: 34.7, lon: 135.5, tags: { name: 'ラーメン屋テスト', amenity: 'restaurant', cuisine: 'ramen' } },
  { type: 'way', id: 2001, center: { lat: 34.705, lon: 135.505 }, tags: { name: 'テスト書店', shop: 'books' } },
]

const MEDICAL_ELEMENTS_UMEDA = [
  { type: 'node', id: 4001, lat: 34.695, lon: 135.495, tags: { name: 'テスト病院', amenity: 'hospital' } },
  { type: 'node', id: 4002, lat: 34.7, lon: 135.5, tags: { name: 'テスト薬局', amenity: 'pharmacy' } },
  { type: 'way', id: 4003, center: { lat: 34.705, lon: 135.505 }, tags: { name: 'テスト書店', shop: 'books' } },
]

// (修正) バリアフリー検索用の要素（歩道ウェイ＋縁石ノード）
const BF_ELEMENTS = [
  { type: 'way', id: 3001, tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' }, geometry: [ { lat: 34.8, lon: 135.4 }, { lat: 34.81, lon: 135.45 }, { lat: 34.82, lon: 135.5 } ] },
  { type: 'node', id: 3002, lat: 34.85, lon: 135.55, tags: { barrier: 'kerb' } },
]

// 東大阪市 bbox（34.56–34.72 / 135.34–135.52）の内側にある要素。
// 自治体モードは地図の表示範囲ではなく市町村のbboxで検索するため、
// 地図モード用（mock地図の既定範囲 34.8–34.9 / 135.4–135.6）の BF_ELEMENTS を
// そのまま使うと bboxフィルタで全て落ちる。
const BF_ELEMENTS_HIGASHIOSAKA = [
  { type: 'way', id: 3003, tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' }, geometry: [ { lat: 34.6, lon: 135.4 }, { lat: 34.61, lon: 135.45 }, { lat: 34.62, lon: 135.5 } ] },
  { type: 'node', id: 3004, lat: 34.65, lon: 135.48, tags: { barrier: 'kerb' } },
]

// (#63) 「梅田」ジオコード検索エリア（34.69–34.71 / 135.49–135.51）の内側にある
// バリアフリー要素。バリアフリー検索の結果はクライアント側で検索bboxにより
// フィルタされるため、タイル検索テストでは要素を検索エリア内に置く。
const BF_ELEMENTS_UMEDA = [
  { type: 'way', id: 3005, tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' }, geometry: [ { lat: 34.695, lon: 135.495 }, { lat: 34.7, lon: 135.5 }, { lat: 34.705, lon: 135.505 } ] },
  { type: 'node', id: 3006, lat: 34.7, lon: 135.5, tags: { barrier: 'kerb' } },
]

// 周辺地名候補（around:5000 クエリ）のレスポンス要素。
// ローカルサジェスト（端末内照合）の検証用。座標は geolocation モックの
// 固定現在位置（34.7, 135.5）と同じ領域に置く
// 駅は全国駅ファイル（stations.json）に一本化されたため周辺クエリには
// 含まれない（地区名・公園のみ）
const NEARBY_ELEMENTS = [
  { type: 'node', id: 2002, lat: 34.701, lon: 135.499, tags: { place: 'neighbourhood', name: '梅田' } },
  { type: 'node', id: 2003, lat: 34.706, lon: 135.496, tags: { place: 'neighbourhood', name: '大阪' } },
]

// 全国駅ファイル（stations.json）のフィクスチャ行（[名前, 緯度, 経度, 種別]）。
// 座標は従来の NEARBY_ELEMENTS の駅ノードと同じ
const STATION_ROWS = [
  ['梅田駅', 34.7, 135.5, 0],
  ['大阪駅', 34.706, 135.496, 0],
]

// Nominatim応答行（geocode / geocodeCandidates 検証用）。
// 既定では「梅田」の単一候補。複数候補の検証では nominatimRows を
// 「上本町」（鹿児島市＋大阪市）の2行に切り替える。
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
let nominatimRows = [UEDA_ROW]
// (place) Nominatim の fetch を「未解決」に保てる deferred（スピナー表示検証用）。
// null のときは従来どおり nominatimRows を即返す（既存テストへの影響なし）
let nominatimDeferred = null
// (place) Nominatim 問い合わせ回数（入力中に Nominatim を問い合わせない検証用）
let nominatimCalls = 0
// (place) 周辺候補取得の Overpass fetch を「未解決」に保てる deferred
// （通信中だった周辺結果が後から届いても候補リストが再表示されない検証用）
let nearbyDeferred = null

function createDeferred() {
  let resolveFn
  const promise = new Promise((r) => { resolveFn = r })
  return {
    promise,
    resolve: (v) => resolveFn(v),
  }
}

// ===== フック =====
let mediaMatches = true
let mediaListeners = []
let overpassCalls = []
let overpassStatus = 200
let overpassElements = OVERPASS_ELEMENTS

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

function fireMediaChange(matches) {
  mediaMatches = matches
  mediaListeners.forEach((cb) => cb({ matches }))
}

function setupFetchMock() {
  const mockFetch = vi.fn(async (url, options = {}) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => MUNI_DATA }
    }
    if (u.includes('stations.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => STATION_ROWS }
    }
    // (#63) Nominatimジオコード（QuickTopIntroの「検索」・地名入力サジェスト・
    // 複数候補提示の検証用）。テスト側が nominatimRows を切り替えられる
    if (u.includes('nominatim')) {
      nominatimCalls++
      if (nominatimDeferred) {
        // (place) リクエストを実際に Pending 状態に保ち、スピナー表示を検証する
        // （resolve するまで json() が解決しない）
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
      // (geocode-fb) 地名検索の補完: 全国名前検索（nwr["name"~ を含む）。実際の
      // Overpass は検索語に一致する name の要素のみ返すが、このファイルの施設
      // 要素（OVERPASS_ELEMENTS 等）は名前検索と無関係のため常に空を返す
      if (q.includes('nwr["name"~')) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: [] }),
        }
      }
      // 周辺候補取得クエリ（around:5000 を含む）と施設検索クエリで返す要素を変える
      const isNearby = q.includes('around:5000')
      if (isNearby && nearbyDeferred) {
        // (place) リクエストを実際に Pending 状態に保つ（通信中だった周辺
        // 結果が後から届いても候補リストが再表示されないことの検証用）
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: () => nearbyDeferred.promise,
        }
      }
      if (overpassStatus !== 200) {
        return { ok: false, status: overpassStatus, headers: new Map(), json: async () => ({}) }
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: isNearby ? NEARBY_ELEMENTS : overpassElements }),
      }
    }
    return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
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

function renderApp(query = '') {
  window.history.replaceState(null, '', query ? `?${query}` : '/')
  render(<App />)
}

const IT_TIMEOUT = 15000

// 一般向けトップの場所入力欄のplaceholder（地名・駅名入力）
const PLACE_INPUT = '地名・駅名（例: 大阪駅）'

// 下部ナビからタブを操作
function navButtons() {
  return within(screen.getByRole('navigation', { name: 'モバイルナビゲーション' }))
}
function clickTab(label) {
  fireEvent.click(navButtons().getByRole('button', { name: label }))
}
function clickCoffeeSearchMarker() {
  const map = getMapInstance()
  const feature = map._lastGeoJSON?.data?.features?.find((f) => f.properties.key === 'node/1001')
  expect(feature).toBeTruthy()
  act(() => {
    map.fire('click', 'point-circle', {
      features: [feature],
      lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
    })
  })
}
function tabIsCurrent(label) {
  const btn = navButtons().getByRole('button', { name: label })
  return btn.getAttribute('aria-current') === 'page'
}

// labelテキストから対応するselectを取得（municipalityFlow.test.jsx と同じパターン）
function getSelectByLabel(label) {
  const el = screen.getByText(label)
  let node = el
  while (node && node.tagName !== 'DIV') node = node.parentElement
  return node?.querySelector('select')
}

// labelテキストから対応する市区町村テキスト入力欄を取得
function getInputByLabel(label) {
  const el = screen.getByText(label)
  let node = el
  while (node && node.tagName !== 'DIV') node = node.parentElement
  return node?.querySelector('input')
}

// サジェストリスト内の候補（role=option）を取得
function getSuggestOptions() {
  return screen.getAllByRole('option').filter((o) => o.closest('[role="listbox"]'))
}

/**
 * (#44) 目的チップ→カテゴリチップ でカテゴリを選択する
 * 例: selectCategoryChip('カフェ') → 「食べる」をタップ → 「カフェ」をタップ
 */
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

// ヘッダーのタイトルボタン（アプリアイコン＋「まちのスクラップブック」。押下でトップ画面に戻る）
function getHeaderButton() {
  return screen.getByRole('button', { name: 'トップ画面に戻る' })
}

// (#63) 検索タブの初期表示は一般向けトップ（QuickTop）。
// 「くわしく探す」で従来の検索フォーム（目的チップ・検索実行ボタンがあるview）へ切替する
function openFormView() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
}

// (#xx) フォームは常に地図モード（ソース切替タブは撤去済み）。フォームビューで
// フォーム要素の描画を確認してから操作する。
async function switchToMapMode() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '＋ 条件を追加（詳細検索）' })).toBeTruthy()
  }, { timeout: 3000 })
}

// (#63) 「検索エリアが設定済み」状態をテスト上で再現する: 地名を入力して
// 「地名検索」を押す（fetchモックが「梅田」のNominatim結果を返す → 検索エリアに
// 設定される）。成功（緑＋入力欄に候補の表示名が入る）を待って返す。
// 後続でタイル選択+「指定した場所と種別で検索」で実際に検索するテストがこれを利用する。
// （トップ画面には地図を描画しないため、旧「ユーザーが地図を動かした」の
// 再現方法はなくなった。検索エリアは地名検索または自治体選択で設定される。）
async function setAreaByGeocode() {
  fireEvent.change(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）'), { target: { value: '梅田' } })
  fireEvent.click(getGeocodeButton())
  await waitFor(() => {
    expect(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）').className).toContain('border-green-500')
  }, { timeout: 8000 })
}

// (#63) タイル下の「指定した場所と種別で検索」ボタン（施設検索の実行入口）。
// 「目的から探す」セクション内にスコープする: 下部ナビの「検索」タブや
// 「都道府県から探す」セクションの「検索する」との混同を防ぐため。
// タイルタップは選択のみのため、施設検索はこのボタンで実行される。
function getTopSearchButton() {
  return within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '指定した場所と種別で検索' })
}

// (#63) 場所入力欄の右側の「地名検索」ボタン（ジオコードの入口）。
// 「どこで探すか」セクション内にスコープする。押下（または入力欄でEnter）で
// 入力テキストを Nominatim でジオコードし、検索エリアを設定する。
function getGeocodeButton() {
  return within(screen.getByRole('region', { name: 'どこで探すか' })).getByRole('button', { name: '地名検索' })
}

async function selectMunicipality(prefText, munText, prefLabel = '都道府県', munLabel = '市区町村') {
  await waitFor(() => {
    expect(screen.getByText(prefLabel)).toBeTruthy()
  }, { timeout: 3000 })
  const prefSelect = getSelectByLabel(prefLabel)
  expect(prefSelect).toBeTruthy()
  const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === prefText)
  expect(prefOpt).toBeTruthy()
  fireEvent.change(prefSelect, { target: { value: prefOpt.value } })

  // 市区町村入力欄の出現を待ってから名前の入力と候補クリック
  const input = await waitFor(() => {
    const i = getInputByLabel(munLabel)
    expect(i).toBeTruthy()
    return i
  }, { timeout: 3000 })
  fireEvent.change(input, { target: { value: munText } })
  const munOpt = await waitFor(() => {
    const opt = getSuggestOptions().find((o) => o.textContent.startsWith(munText))
    expect(opt).toBeTruthy()
    return opt
  }, { timeout: 3000 })
  fireEvent.click(munOpt)
}

beforeEach(() => {
  localStorage.removeItem(PLACE_HISTORY_KEY)
  mediaMatches = true
  setupMatchMedia()
  if (mockState.api) mockState.api.resetState()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  overpassCalls = []
  overpassStatus = 200
  overpassElements = OVERPASS_ELEMENTS
  nominatimRows = [UEDA_ROW]
  nominatimDeferred = null
  nominatimCalls = 0
  nearbyDeferred = null
  setupFetchMock()
  clearCache()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('(#59) レイアウト切替（ビューポート幅ベース）', () => {
  it('幅<1024px: モバイルシェル（下部ナビ4タブ）が表示され、PCレイアウトは出ない', async () => {
    mediaMatches = true
    renderApp()

    // 下部ナビが3タブで表示される（#60: 地図タブは廃止、地図は検索タブ内に内蔵）
    const nav = screen.getByRole('navigation', { name: 'モバイルナビゲーション' })
    for (const label of ['検索', '一覧', 'その他']) {
      expect(within(nav).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(tabIsCurrent('検索')).toBe(true)
    expect(within(nav).queryByRole('button', { name: '地図' })).toBeNull()

    // PCレイアウト固有の要素は存在しない
    expect(screen.queryByText('地図を隠す')).toBeNull()
    expect(screen.queryByText('施設検索')).toBeNull()
  }, IT_TIMEOUT)

  it('幅>=1024px: 専用2ペインシェル（PcShell）が表示される（PCレイアウト）', async () => {
    mediaMatches = false
    window.history.replaceState(null, '', '/')
    const view = render(<App />)
    const container = view.container

    // 旧構成の中央寄せmax-widthコンテナ（max-w-[520px]）は存在しない
    expect(container.querySelector('.max-w-\\[520px\\]')).toBeNull()

    // (#72) PCの2ペインレイアウト: 左ペイン（検索）+ 右ペイン（メモ帳）
    // + その他ペイン（hidden）
    const left = container.querySelector('[data-testid="pc-left-pane"]')
    const right = container.querySelector('[data-testid="pc-right-pane"]')
    const other = container.querySelector('[data-testid="pc-other-pane"]')
    expect(left).toBeTruthy()
    expect(left.hasAttribute('hidden')).toBe(false)
    expect(right).toBeTruthy()
    expect(right.hasAttribute('hidden')).toBe(false)
    expect(other).toBeTruthy()
    expect(other.hasAttribute('hidden')).toBe(true)

    // 下部ナビ（4タブ）は全幅で常時表示。activeは右ペインの内容（メモ帳）に従う
    const nav = screen.getByRole('navigation', { name: 'モバイルナビゲーション' })
    for (const label of ['検索', '一覧', 'メモ帳', 'その他']) {
      expect(within(nav).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(tabIsCurrent('メモ帳')).toBe(true)

    // 左ペイン: 一般向けトップ表示（「くわしく探す」ボタンが在席）
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()

    // (#63) トップ画面には地図を描画しない（マウントされたままhidden）
    const mapBlock = screen.queryByTestId('map-block')
    expect(mapBlock).toBeTruthy()
    expect(mapBlock.hasAttribute('hidden')).toBe(true)

    // 旧PCレイアウト固有の地図切替ボタン（「地図を隠す」）は存在しない
    expect(screen.queryByText('地図を隠す')).toBeNull()

    // (#75) ヘッダーにはハンバーガーメニューがある（PcShell のヘッダーにも入る）
    const header = container.querySelector('header')
    expect(within(header).getByRole('button', { name: 'メニュー' })).toBeTruthy()
  }, IT_TIMEOUT)

  it('matchMedia change でレイアウトが追従する（回転・キーボード表示に対応）: 2ペイン構造の出現・消滅', async () => {
    mediaMatches = false
    window.history.replaceState(null, '', '/')
    const view = render(<App />)
    const container = view.container

    // PC幅: 2ペインシェル（PcShell）
    expect(container.querySelector('[data-testid="pc-left-pane"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="pc-right-pane"]')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()

    // 横画面へ回転（幅が1024px未満になる）→ モバイル: 2ペインが消え、単一シェルに
    fireMediaChange(true)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="pc-left-pane"]')).toBeNull()
    }, { timeout: 3000 })
    // (#63) 検索タブの初期表示は一般向けトップ: トップ固有要素を確認
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // 元に戻る → PC: 2ペイン構造が復帰
    fireMediaChange(false)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="pc-left-pane"]')).toBeTruthy()
    }, { timeout: 3000 })
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()
  }, IT_TIMEOUT)
})

describe('(header) ヘッダー: アプリアイコン＋タイトルボタン', () => {
  it('ヘッダーにアプリアイコンと大きなタイトル（h1内のボタン）が表示される', () => {
    renderApp()

    // タイトルボタン（aria-label「トップ画面に戻る」）が存在し、h1 見出しに包まれる
    const btn = getHeaderButton()
    expect(btn.closest('h1')).toBeTruthy()

    // タイトル文字はボタン内でアイコーの隣に横並び（flex items-center gap-2.5）
    const title = screen.getByText('まちのスクラップブック')
    expect(title.closest('button')).toBe(btn)
    expect(btn.className).toContain('flex')
    expect(btn.className).toContain('items-center')
    expect(btn.className).toContain('gap-2.5')

    // タイトルは大きめ（text-xl font-bold）
    expect(title.className).toContain('text-xl')
    expect(title.className).toContain('font-bold')
    expect(title.className).toContain('text-slate-800')

    // アイコンは装飾的なSVG（aria-hidden）でボタン内に描画される
    const svg = btn.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    // 既定サイズ w-9 h-9（36px）が指定されている
    expect(svg.classList.contains('w-9')).toBe(true)
    expect(svg.classList.contains('h-9')).toBe(true)
  })

  it('一覧タブ（検索成功後）からボタンを押すとトップ画面（一般向けトップ）に戻る', async () => {
    renderApp()

    // 従来フォーム→地図モードで検索し、一覧タブへ自動切替させる
    openFormView()
    await switchToMapMode()
    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })

    // ヘッダーのタイトルボタンを押す
    fireEvent.click(getHeaderButton())

    // 検索タブがアクティブになり、トップ画面の要素が表示される
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // 従来フォームの要素は消える（view='top' でアンマウントされる）
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
  }, IT_TIMEOUT)

  it('従来フォーム表示からボタンを押すとトップ画面に戻る（searchViewが「top」に切替）', async () => {
    renderApp()

    // トップ → 従来フォーム
    openFormView()
    // (#xx) フォームは常に地図モード（ソース切替タブは撤去済み）
    expect(screen.getByRole('button', { name: /トップへ戻る/ })).toBeTruthy()
    expect(screen.queryByText('好きな場所で作る、わたしのまち')).toBeNull()

    // ヘッダーのタイトルボタンを押す
    fireEvent.click(getHeaderButton())

    // トップ画面の要素が戻り、フォームの要素は消える
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
    expect(screen.queryByRole('button', { name: /トップへ戻る/ })).toBeNull()
  }, IT_TIMEOUT)

  it('その他タブからボタンを押すとトップ画面に戻る', () => {
    renderApp()

    // 下部ナビから「その他」タブへ
    clickTab('その他')
    expect(tabIsCurrent('その他')).toBe(true)

    // ヘッダーのタイトルボタンを押す
    fireEvent.click(getHeaderButton())

    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('その他')).toBe(false)
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
  }, IT_TIMEOUT)

  it('詳細シートが開いている状態でボタンを押すと: シートが閉じてトップ画面に戻る', async () => {
    renderApp()

    // 検索し、検索タブの地図から詳細シートを開く
    openFormView()
    await switchToMapMode()
    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })
    clickTab('検索')
    clickCoffeeSearchMarker()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeTruthy()
    }, { timeout: 3000 })

    // ヘッダーのタイトルボタンを押す（selectTab と同じく詳細シートを閉じる）
    fireEvent.click(getHeaderButton())

    // シートが閉じられ、トップ画面に戻る
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, { timeout: 3000 })
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()
  }, IT_TIMEOUT)
})

describe('(#59) 検索タブ: 地図モード検索', () => {
  it('カテゴリ選択→検索する: クエリにカテゴリと地図BBOXが反映され、結果が表示される', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから目的チップでカテゴリ選択
    openFormView()
    await switchToMapMode()

    // カテゴリ=cafe を目的チップで選択（食べる → カフェ）
    expect(selectCategoryChip('カフェ')).toBe(true)

    // フッター（スロールームの外）の「この表示範囲で検索」を押す
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // カテゴリフィルタと地図の現在表示範囲（モックBBOX）がクエリに含まれる
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('34.800000,135.400000,34.900000,135.600000')

    await waitFor(() => {
      expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })
  }, IT_TIMEOUT)

  it('検索成功後は「一覧」タブへ自動切替され、施設カードが表示される', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから検索
    openFormView()
    await switchToMapMode()

    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })

    // (#44) 選択カテゴリ（カフェ）で結果が絞り込まれる: cafeカードのみ表示
    // （モックはクエリ非依存の3件を返すが、reducerのミラーでcatFilter=cafeが適用される）
    // 電話帳型カード: 施設名はh3（heading）で表示される
    expect(screen.getByRole('heading', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /ラーメン屋テスト/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: /テスト書店/ })).toBeNull()
    expect(screen.getByText(/3件中、\s*1\s*件を表示/)).toBeTruthy()
  }, IT_TIMEOUT)

  it('タブを離れても検索条件（キーワード入力）が保持される', async () => {
    renderApp()

    // (#63) キーワード入力欄は従来フォーム側。フォームへ切替してから入力
    openFormView()
    await switchToMapMode()

    // キーワード入力（検索タブ）
    const kwInput = screen.getByPlaceholderText('例: 珈琲、ラーメン')
    fireEvent.change(kwInput, { target: { value: 'テスト' } })

    // 一覧タブ→その他タブ→検索タブ と往復
    clickTab('一覧')
    clickTab('その他')
    clickTab('検索')

    // 入力が保持されている（コンポーネントがアンマウントされていない）
    const kwAfter = screen.getByPlaceholderText('例: 珈琲、ラーメン')
    expect(kwAfter.value).toBe('テスト')
  }, IT_TIMEOUT)
})

describe('(#59/#60) 検索タブ: 地図の明示的な検索トリガー', () => {
  it('「この表示範囲で検索」押下で地図BBOXを検索に使用する', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してからカテゴリを設定
    openFormView()
    await switchToMapMode()

    // 検索タブでカテゴリを設定（レストラン）
    selectCategoryChip('レストラン')
    expect(overpassCalls).toHaveLength(0)

    // 地図のmoveend（移動・拡大）だけでは検索が実行されない
    const map = getMapInstance()
    expect(map).toBeTruthy()
    act(() => {
      map.fire('moveend')
      map.fire('zoomend')
    })
    expect(overpassCalls).toHaveLength(0)

    // 明示的なボタン押下で検索が実行される（moveend後の再レンダリングで有効化される）
    const mapSearchBtn = screen.getByRole('button', { name: 'この表示範囲で検索' })
    await waitFor(() => {
      expect(mapSearchBtn.hasAttribute('disabled')).toBe(false)
    }, { timeout: 3000 })
    fireEvent.click(mapSearchBtn)
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('amenity=restaurant')
    expect(overpassCalls[0]).toContain('34.800000,135.400000,34.900000,135.600000')
  }, IT_TIMEOUT)

  it('マーカータップで施設詳細ボトムシートが開く', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから検索
    openFormView()
    await switchToMapMode()

    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // 検索成功後は一覧タブに自動切替される。検索タブに戻って地図のマーカーをタップ
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })
    clickTab('検索')

    // 結果が地図のクラスタリングGeoJSONに反映されるまで待つ
    await waitFor(() => {
      const map = getMapInstance()
      const features = map._lastGeoJSON?.data?.features || []
      expect(features.length).toBeGreaterThanOrEqual(3)
    }, { timeout: 8000 })

    // 最初のマーカー（テスト珈琲店 node/1001）をタップ → pointレイヤのclickイベントを発火
    const map = getMapInstance()
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/1001')
    expect(feature).toBeTruthy()
    act(() => {
      map.fire('click', 'point-circle', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /施設詳細: テスト珈琲店/ })).toBeTruthy()
    }, { timeout: 3000 })
  }, IT_TIMEOUT)
})

describe('(#59) 一覧タブ: 結果マップのピンタップ→カード選択（修正）', () => {
  it('一覧タブの結果マップでピンをタップすると一覧が対応する施設カードへスクロールして選択状態になる（詳細シートは開かない）', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから地図モード
    openFormView()
    await switchToMapMode()

    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // 検索成功後は一覧タブに自動切替される。結果マップは折りたたみ（非表示）
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })

    // 折りたたみの結果マップを展開（「地図を表示」で MobileResultsMap がマウントされる）
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))

    // 結果マップはグローバルレジストリ（getMapInstance）に登録されないため、
    // 検索タブの地図を除く MapLibre インスタンスを取得する
    const getResultsMap = () =>
      mockState.api._state.maps.find((m) => m !== getMapInstance())

    // 結果が結果マップのGeoJSONに反映されるまで待つ
    await waitFor(() => {
      const map = getResultsMap()
      expect(map).toBeTruthy()
      const features = map._lastGeoJSON?.data?.features || []
      expect(features.length).toBeGreaterThanOrEqual(1)
    }, { timeout: 8000 })

    // ピン（テスト珈琲店 node/1001）をタップ → アイコンレイヤのclickイベントを発火
    const map = getResultsMap()
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/1001')
    expect(feature).toBeTruthy()
    expect(feature.properties.icon).toBe('cafe.png')
    act(() => {
      map.fire('click', 'poi-icon', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    // 詳細シートは開かない
    expect(screen.queryByRole('dialog')).toBeNull()
    // 一覧が対応するカードへスクロールし、選択状態（ハイライト）になる
    const card = document.getElementById('facility-card-node/1001')
    expect(card).toBeTruthy()
    expect(card.className).toContain('ring-primary-500')
    expect(card.className).toContain('border-primary-400')
    expect(tabIsCurrent('一覧')).toBe(true)
  }, IT_TIMEOUT)
})

describe('(#59) 施設カードと詳細ボトムシート', () => {
  it('施設名とサムネイルで施設を選択し、検索タブの地図から詳細を開ける', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから検索
    openFormView()
    await switchToMapMode()

    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // 一覧タブがアクティブになりカードが表示される
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })

    const card = document.getElementById('facility-card-node/1001')
    const name = within(card).getByRole('heading', { name: 'テスト珈琲店' })
    expect(name.closest('button, [role="button"]')).toBeNull()
    expect(within(card).getAllByRole('button', { name: /選択/ })).toHaveLength(1)
    fireEvent.click(name)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(card.className).toContain('ring-primary-500')
    const thumb = card.querySelector('img[src^="data:image/"]')
    expect(thumb).toBeTruthy()
    expect(thumb.closest('button, [role="button"]')).toBeNull()
    fireEvent.click(thumb)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(card.className).not.toContain('ring-primary-500')

    clickTab('検索')
    await waitFor(() => {
      expect(screen.getByTestId('map-block').hasAttribute('hidden')).toBe(false)
    }, { timeout: 3000 })
    clickCoffeeSearchMarker()

    // ボトムシート（dialog）が開く: 名称・住所・カテゴリチップ・OSMリンク
    const dialog = await waitFor(() => {
      const d = screen.queryByRole('dialog', { name: /施設詳細: テスト珈琲店/ })
      expect(d).toBeTruthy()
      return d
    }, { timeout: 3000 })
    expect(within(dialog).getByText(/大阪市 梅田 1-1/)).toBeTruthy()
    // カテゴリチップ（amenity=cafe → カフェ。タグ一覧は廃止されたため生値は出ない）
    expect(within(dialog).getByText('カフェ')).toBeTruthy()
    // 固定高さシート（h-[85dvh]）は全項目を最初から表示するため、OSMリンク・
    // バリアフリー情報等は開いた時点で確認できる
    expect(within(dialog).getByText(/OSMで見る（node\/1001）/)).toBeTruthy()
    // (#61) バリアフリー情報: 車椅子対応バッジ + :ja説明
    expect(within(dialog).getByText(/バリアフリー情報/)).toBeTruthy()
    expect(within(dialog).getByText('車椅子対応')).toBeTruthy()
    // 説明はバリアフリーセクションのnoteに出る（タグ一覧廃止で1箇所のみ）
    expect(within(dialog).getAllByText('段差なし')).toHaveLength(1)
    const map = getMapInstance()
    await waitFor(() => {
      // MapLibreのpanToは[経度, 緯度]順
      expect(map._calls.some((c) => c.name === 'panTo' && Array.isArray(c.args[0]) && c.args[0][0] === 135.5 && c.args[0][1] === 34.85)).toBe(true)
    }, { timeout: 3000 })

    // 「閉じる」でシートが閉じられ、検索タブは維持される
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, { timeout: 3000 })
    expect(tabIsCurrent('検索')).toBe(true)
  }, IT_TIMEOUT)
})

describe('(#59) 一覧タブ: クライアント側フィルタ', () => {
  it('施設名フィルタでカードが絞られ、件数表示も更新される', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。キーワード入力欄は従来フォーム側
    openFormView()
    await switchToMapMode()

    // キーワード検索（カテゴリ未選択=汎用POIクエリ）→ 全3件がフィルタ対象になる
    const kwInput = screen.getByPlaceholderText('例: 珈琲、ラーメン')
    fireEvent.change(kwInput, { target: { value: 'テスト' } })
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })
    expect(screen.getByText(/3件中、3件を表示/)).toBeTruthy()

    // 施設名フィルタ: 「珈琲」→ テスト珈琲店の1件のみ
    const nameInput = screen.getByLabelText('名前・メモで絞り込む')
    fireEvent.change(nameInput, { target: { value: '珈琲' } })

    await waitFor(() => {
      expect(screen.getByText(/3件中、1件を表示/)).toBeTruthy()
    }, { timeout: 3000 })
    expect(screen.getByRole('heading', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /ラーメン屋テスト/ })).toBeNull()
  }, IT_TIMEOUT)

  it('検索0件時は専用のガイダンス（EditPanel）が表示される', async () => {
    renderApp()

    // 結果0件を返すようにする
    overpassCalls = []
    globalThis.fetch.mockImplementation(async (url, options = {}) => {
      const u = String(url)
      if (u.includes('municipalities.json')) {
        return { ok: true, status: 200, headers: new Map(), json: async () => MUNI_DATA }
      }
      if (u.includes('stations.json')) {
        return { ok: true, status: 200, headers: new Map(), json: async () => STATION_ROWS }
      }
      if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
        const body = (options.body) || ''
        overpassCalls.push(new URLSearchParams(body).get('data') || body)
        return {
          ok: true, status: 200, headers: new Map(),
          json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: [] }),
        }
      }
      return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
    })

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから検索
    openFormView()
    await switchToMapMode()

    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // 0件ガイダンスが表示され、一覧タブに自動切替される
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })
    await waitFor(() => {
      expect(screen.getByText(/検索結果が見つかりません/)).toBeTruthy()
    }, { timeout: 3000 })
  }, IT_TIMEOUT)
})

describe('(#59) 自治体モード検索', () => {
  it('トップ「都道府県から探す」セクション→市区町村選択→検索: 自治体BBOXのPOIクエリが送出される', async () => {
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    renderApp()

    // (#xx) 自治体検索はトップ画面の「都道府県から探す」セクションから
    fireEvent.click(screen.getByRole('button', { name: /都道府県から探す/ }))
    const sec = screen.getByRole('region', { name: '都道府県から探す' })

    // 大阪府→大阪市（都府県レベル）を選択（モバイルラベル）
    await selectMunicipality('大阪府', '大阪市（都府県）', 'どの県で探す？', 'どの市区町村で探す？')

    // 検索（カテゴリ未選択=POI検索）。トップ画面には同名ボタンが複数あるためセクション内に限定
    fireEvent.click(within(sec).getByRole('button', { name: '検索する' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    const q = overpassCalls[0]
    // 自治体BBOXが反映される
    expect(q).toContain('34.560000,135.340000,34.720000,135.520000')
    // カテゴリ未選択時はPOIタグ制約クエリになる
    expect(q).toContain('amenity')
    expect(q).toContain('shop')

    await waitFor(() => {
      expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })
  }, IT_TIMEOUT)
})

describe('(#44) 目的チップ', () => {
  it('目的チップ: 「買う」をタップすると具体カテゴリチップが展開し、選択すると解除ボタンが出る', async () => {
    renderApp()

    // (#63) 目的チップは従来フォーム側。まずフォームへ
    openFormView()
    await switchToMapMode()

    // 「買う」目的チップをタップ → 2つのカテゴリチップが展開
    fireEvent.click(screen.getByRole('button', { name: '買う' }))
    expect(screen.getByRole('button', { name: 'コンビニ・スーパー' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '小売店' })).toBeTruthy()

    // 「コンビニ・スーパー」を選択 → 選択中バッジと解除ボタン（チップ行は閉じる）
    fireEvent.click(screen.getByRole('button', { name: 'コンビニ・スーパー' }))
    expect(screen.getByText(/コンビニ・スーパー/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '解除' })).toBeTruthy()

    // 解除で選択がリセットされる（チップ行も閉じる）
    fireEvent.click(screen.getByRole('button', { name: '解除' }))
    expect(screen.queryByRole('button', { name: 'コンビニ・スーパー' })).toBeNull()
  }, IT_TIMEOUT)

  it('サンプル検索セクションは削除済み（「サンプル検索で試す」が存在しない）', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームの要素を確認するためフォームへ切替
    openFormView()
    await switchToMapMode()

    // セクション自体がレンダされない
    expect(screen.queryByRole('region', { name: 'サンプル検索' })).toBeNull()
    expect(screen.queryByText('サンプル検索で試す')).toBeNull()
    // サンプル用の即検索ボタン（アイコン付きラベル）が残存していない
    expect(screen.queryByRole('button', { name: /☕/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /💊/ })).toBeNull()

    // 残りの検索機能はそのまま動作する（地図モードの検索範囲カード等）
    expect(screen.getByText('どの街・エリアで探す？')).toBeTruthy()
  }, IT_TIMEOUT)
})

describe('(#59) エラー表示の継続性', () => {
  it('全エンドポイント失敗時もエラーbannerが表示され、タブ切替をまたいで残る', async () => {
    overpassStatus = 503
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから検索
    openFormView()
    await switchToMapMode()

    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // フォールバックチェーン（3エンドポイント）を順に試したあとエラーになる
    await waitFor(() => {
      expect(screen.getByText(/サーバーエラー/)).toBeTruthy()
    }, { timeout: 12000 })
    expect(overpassCalls.length).toBeGreaterThanOrEqual(2)

    // エラーのときも「検索」タブに自動切替される
    expect(tabIsCurrent('検索')).toBe(true)

    // 一覧タブへ移動してもエラーbannerは残る（全タブ共通表示）
    clickTab('一覧')
    expect(screen.getByText(/サーバーエラー/)).toBeTruthy()
  }, IT_TIMEOUT)
})

describe('StatusBanner: まちメモ帳タブ表示中は出さない', () => {
  // 仕様: メモ帳タブ表示中は StatusBanner を出さない（loading/error/success 全バリアント）。
  // 検索・一覧・その他の3タブでは従来どおり表示される。状態は reducer に保持される
  // ため、メモ帳を離れると再び表示される。
  it('成功バナー: メモ帳タブでは出ず、検索・一覧・その他タブでは従来どおり出る', async () => {
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから検索
    openFormView()
    await switchToMapMode()

    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // 成功で一覧タブへ自動切替され、成功バナーが表示される（一覧タブ ✓）
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    await waitFor(() => {
      expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })

    // 他タブでも従来どおりバナーが出る（状態が保持されるため）
    clickTab('検索')
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy() // 検索タブ ✓

    clickTab('その他')
    expect(tabIsCurrent('その他')).toBe(true)
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy() // その他タブ ✓

    // まちメモ帳タブへ → StatusBanner（成功バナー）は表示されない
    clickTab('メモ帳')
    expect(tabIsCurrent('メモ帳')).toBe(true)
    expect(screen.queryByText('3件の結果を取得しました')).toBeNull()

    // 一覧タブへ戻る → バナーが再び表示される
    clickTab('一覧')
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)

  it('エラーバナー: メモ帳タブでは出ず、検索・一覧・その他タブでは従来どおり出る（StatusBanner ごと非表示）', async () => {
    renderApp()

    // 検索エリア未設定のままタイル選択+「検索する」 → 検証エラーが StatusBanner で
    // 表示される（Overpass クエリは送出されない＝高速）。エラー時は検索タブのまま
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy()
    }, { timeout: 8000 })
    expect(tabIsCurrent('検索')).toBe(true) // 検索タブ ✓
    expect(overpassCalls).toHaveLength(0)

    // 他タブでも従来どおりバナーが出る（状態が保持されるため）
    clickTab('一覧')
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy() // 一覧タブ ✓

    clickTab('その他')
    expect(tabIsCurrent('その他')).toBe(true)
    expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy() // その他タブ ✓

    // まちメモ帳タブへ → エラーバナーも表示されない（loading/error/success 全バリアント）
    clickTab('メモ帳')
    expect(tabIsCurrent('メモ帳')).toBe(true)
    expect(screen.queryByText(/場所がまだ設定されていません/)).toBeNull()

    // 検索タブへ戻る → バナーが再び表示される
    clickTab('検索')
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy()
  }, IT_TIMEOUT)
})

describe('バリアフリー検索: 成功時は一覧タブへ自動切替（検索の種類によらず統一）', () => {
  it('地図モード: バリアフリー検索成功 → 「一覧」タブへ自動切替され、BFカード・結果マップ・凡例が表示される', async () => {
    renderApp()
    overpassElements = BF_ELEMENTS

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから目的チップを選択
    openFormView()
    await switchToMapMode()

    // 目的チップ「バリアフリー」でバリアフリー検索に
    fireEvent.click(screen.getByRole('button', { name: 'バリアフリー' }))
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // バリアフリークエリ（footway等）が送出される
    expect(overpassCalls[0]).toContain('footway')

    await waitFor(() => {
      expect(screen.getByText('2件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })

    // 成功時は通常のPOI検索と同様に「一覧」タブへ自動切替される
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(tabIsCurrent('検索')).toBe(false)

    // 一覧タブにBFカード（名称・表示名）・件数表示が表示される
    expect(screen.getByText('中央通り歩道')).toBeTruthy()
    // 名称が無い縁石: タイトルは種別ラベル「縁石」、バッジも「縁石」（カード内で計2件）
    const kerbCard = document.getElementById('barrier-free-card-node/3002')
    expect(within(kerbCard).getAllByText('縁石')).toHaveLength(2)
    expect(within(kerbCard).queryByText('縁石（未記録）')).toBeNull()
    expect(screen.getByText('2件中、2件を表示')).toBeTruthy()

    // 検索タブ・一覧タブの両方で凡例が描画される（hiddenタブはDOMに残る）
    expect(screen.getAllByText('凡例')).toHaveLength(2)
  }, IT_TIMEOUT)

  it('自治体モード: バリアフリー検索成功 → 「一覧」タブへ切替され、searchSourceは自治体モードのまま', async () => {
    renderApp()
    overpassElements = BF_ELEMENTS_HIGASHIOSAKA

    // (#xx) 自治体検索はトップ画面の「都道府県から探す」セクションから
    fireEvent.click(screen.getByRole('button', { name: /都道府県から探す/ }))
    const sec = screen.getByRole('region', { name: '都道府県から探す' })
    await selectMunicipality('大阪府', '東大阪市', 'どの県で探す？', 'どの市区町村で探す？')

    // 目的チップ「バリアフリー」でバリアフリー検索に（セクション内に限定）
    fireEvent.click(within(sec).getByRole('button', { name: 'バリアフリー' }))
    fireEvent.click(within(sec).getByRole('button', { name: '検索する' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('footway')

    await waitFor(() => {
      expect(screen.getByText('2件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })

    // 成功時は「一覧」タブへ切替される（旧の searchSource→'map' 切替の例外は無い）
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(tabIsCurrent('検索')).toBe(false)

    // 一覧タブにBFカード（名称・表示名）・件数表示が表示される
    expect(screen.getByText('中央通り歩道')).toBeTruthy()
    // 名称が無い縁石: タイトルは種別ラベル「縁石」、バッジも「縁石」（カード内で計2件）
    const kerbCard = document.getElementById('barrier-free-card-node/3004')
    expect(within(kerbCard).getAllByText('縁石')).toHaveLength(2)
    expect(within(kerbCard).queryByText('縁石（未記録）')).toBeNull()
    expect(screen.getByText('2件中、2件を表示')).toBeTruthy()

    // (#xx) セクション検索後に検索タブへ戻り、フォームを開くと、フォームは常に
    // 地図モード（ソースが自治体でも地図モードへ自動切替）。フッターは地図モードラベル
    clickTab('検索')
    expect(tabIsCurrent('検索')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()
    }, { timeout: 5000 })
  }, IT_TIMEOUT)

  it('バリアフリー検索エラー → 「検索」タブへ自動切替される', async () => {
    overpassStatus = 503
    overpassElements = BF_ELEMENTS
    renderApp()

    // (#63) 初期表示は一般向けトップ。従来フォームへ切替してから目的チップを選択
    openFormView()
    await switchToMapMode()

    // 目的チップ「バリアフリー」でバリアフリー検索に
    fireEvent.click(screen.getByRole('button', { name: 'バリアフリー' }))
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // フォールバックチェーン（3エンドポイント）を順に試したあとエラーになる
    await waitFor(() => {
      expect(screen.getByText(/サーバーエラー/)).toBeTruthy()
    }, { timeout: 12000 })
    expect(overpassCalls.length).toBeGreaterThanOrEqual(2)

    // エラー時は「検索」タブへ自動切替される
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
  }, IT_TIMEOUT)
})

describe('#63 一般向けトップ（QuickTop）: 初期表示とタイル検索', () => {
  it('初期表示は一般向けトップ: intro・場所指定・目的タイル・「くわしく探す」が表示され、従来フォーム要素は出ない', () => {
    renderApp()

    // introと場所指定
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'どこで探すか' })).toBeTruthy()

    // 目的（種別）タイル10種（バリアフリー含む）が揃って表示される
    for (const label of ['食べる', '買う', 'お出かけ', '学ぶ・仕事', '病院・薬局', '公共施設', '銀行・金融', '会社・事務所', '移動・交通', 'バリアフリー']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }

    // 従来フォームへの「くわしく探す」導線
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // タイル下の「指定した場所と種別で検索」ボタン（施設検索の実行入口）が表示される
    expect(getTopSearchButton()).toBeTruthy()
    // 場所入力欄の右にあった旧「検索する」ボタン（ジオコード入口）は
    // 「地名検索」ボタンに置き換わっている
    expect(within(screen.getByRole('region', { name: 'どこで探すか' })).getByRole('button', { name: '地名検索' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'どこで探すか' })).queryByRole('button', { name: '検索する' })).toBeNull()

    // 従来フォーム固有の要素はトップでは表示されない
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
    expect(screen.queryByPlaceholderText('例: 珈琲、ラーメン')).toBeNull()

    // (#63) トップ画面には地図を描画しない: 地図ブロックはマウントされたまま
    // hidden で非表示（フォーム表示・地図モードでのみ表示される）
    const mapBlock = screen.queryByTestId('map-block')
    expect(mapBlock).toBeTruthy()
    expect(mapBlock.hasAttribute('hidden')).toBe(true)
  }, IT_TIMEOUT)

  it('目的タイル（食べる）を選択して「検索する」を押す: 初期ソースが自治体でも検索エリアで検索される（no_bboxにならない）', async () => {
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    renderApp()
    // (#63) タイル検索には検索エリアの設定が必要: ジオコードで「梅田」を設定する
    await setAreaByGeocode()

    // 回帰テスト: 初期ソースがmunicipalityのとき、旧実装は mapBounds 読み取りの条件が
    // `state.searchSource === 'map'` だったため、dispatch で地図モードへ切替した直後の
    // ハンドラ内で切り替え前の古い state を見て mapBounds が null になり、
    // buildSearchCriteria が no_bbox で失敗していた（バナーは「接続エラー」と表示）。
    // 修正後は切り替え前のソースに関係なく更新後の状態からスナップショットを
    // 構築するため、トップのまま検索が実行される。
    // タイルタップは選択だけ（タップで検索しない）。検索は「検索する」で実行される
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    // Overpassクエリがジオコード結果の範囲（梅田）で送出される
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')
    // 「食べる」目的グループのunionがクエリに含まれる
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('amenity=restaurant')

    // 成功で一覧タブへ自動切替され、検証エラーのバナーは出ない
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    expect(screen.queryByText(/検索範囲が設定されていません/)).toBeNull()
  }, IT_TIMEOUT)

  it('検索エリアが大きすぎる場合: 国サイズのジオコード結果は地名検索段階で遮断され、検証エラーが表示される（「接続エラー」ラベルなし）', async () => {
    renderApp()

    // ジオコード結果のboundingboxが巨大（約230万km²、MAX_SEARCH_AREA_KM2 =
    // 1,000 km² のしきい値超）になるようfetchモックを上書きする
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const u = String(url)
      if (u.includes('nominatim')) {
        nominatimCalls++
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => [
            { lat: '38.0', lon: '137.5', display_name: '日本', name: '日本', class: 'place', type: 'country', boundingbox: ['31', '45', '129', '146'] },
          ],
        }
      }
      if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
        const body = options.body || ''
        const q = new URLSearchParams(body).get('data') || body
        overpassCalls.push(q)
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: overpassElements }),
        }
      }
      return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
    })

    // 地名を入力して「地名検索」を押す。旧仕様では巨大bboxが検索エリアに設定
    // され、後段のcriteria検証（checkBboxSize）で弾かれたが、新仕様では
    // BBOX面積ベースの「広すぎる」ガード（isSearchAreaTooLarge: 1,000 km²以上）が
    // 地名検索段階で遮断し、検索エリアは設定されない。
    // 検索語は「日本」にしている: Nominatim 候補の name（「日本」）が検索語を
    // 含むため Overpass 名前検索補完（geocode-fb）が発動せず、ガード単体の
    // 検証になる
    fireEvent.change(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）'), { target: { value: '日本' } })
    fireEvent.click(getGeocodeButton())

    // 検証エラー（統一エラー文）が表示され、検索エリアは設定されない
    await waitFor(() => {
      expect(screen.getByText(/『日本』の範囲が広すぎるため検索できません/)).toBeTruthy()
    }, { timeout: 8000 })
    // 入力欄は入力文字のまま（緑にならない）
    expect(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）').value).toBe('日本')
    expect(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）').className).not.toContain('border-green-500')

    // Overpassクエリは送出されない
    expect(overpassCalls).toHaveLength(0)

    // 検証エラーは通信エラーではない: 「接続エラー」ラベルが付かない
    expect(screen.queryByText(/接続エラー/)).toBeNull()

    // 一覧タブへ自動切替されず、「検索」タブのまま
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
  }, IT_TIMEOUT)

  it('目的タイル（食べる）: 目的グループの施設種類unionで検索が実行され、成功で一覧タブへ切替', async () => {
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    renderApp()
    // (#63) タイル選択前に検索エリアを設定（ジオコード）する
    await setAreaByGeocode()

    // タイルを選択して「検索する」で検索を実行
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 「食べる」目的グループ: 飲食系カテゴリのunionがクエリに反映される
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('amenity=restaurant')
    expect(overpassCalls[0]).toContain('fast_food|bar')
    // 検索範囲はジオコード結果の範囲（梅田）
    expect(overpassCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')

    // 成功で一覧タブへ自動切替され、目的で絞り込まれる（書店=「買う」グループ外は除外）
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    expect(screen.getByText(/3件中、\s*2\s*件を表示/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /ラーメン屋テスト/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /テスト書店/ })).toBeNull()
  }, IT_TIMEOUT)

  it('複合タイル（病院・薬局）: 病院＋薬局のunionクエリが送出され、両カテゴリのみ表示される', async () => {
    renderApp()
    overpassElements = MEDICAL_ELEMENTS_UMEDA
    // (#63) タイル選択前に検索エリアを設定（ジオコード）する
    await setAreaByGeocode()

    // タイルを選択して「検索する」で検索を実行
    fireEvent.click(screen.getByRole('button', { name: '病院・薬局' }))
    fireEvent.click(getTopSearchButton())

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 「病院・薬局」= 病院・クリニック＋薬局・ドラッグストア カテゴリのunion
    expect(overpassCalls[0]).toContain('amenity=pharmacy')
    expect(overpassCalls[0]).toContain('shop=drugstore')
    expect(overpassCalls[0]).toContain('hospital|clinic')

    // 成功で一覧タブへ自動切替され、目的の絞り込みで病院＋薬局のみが残る
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    expect(screen.getByText(/3件中、\s*2\s*件を表示/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /テスト病院/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /テスト薬局/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /テスト書店/ })).toBeNull()
  }, IT_TIMEOUT)

  it('バリアフリータイル: バリアフリー専用クエリ（footway等）が送出され、成功で一覧タブへ切替', async () => {
    renderApp()
    // バリアフリー結果はクライアント側で検索bboxによりフィルタされるため、
    // 「梅田」ジオコードエリア内の要素を使う
    overpassElements = BF_ELEMENTS_UMEDA
    // (#63) タイル選択前に検索エリアを設定（ジオコード）する
    await setAreaByGeocode()

    // タイルを選択して「検索する」で検索を実行
    fireEvent.click(screen.getByRole('button', { name: 'バリアフリー' }))
    fireEvent.click(getTopSearchButton())

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // バリアフリー専用クエリ（POIタグ指定ではなく歩道・縁石など）
    expect(overpassCalls[0]).toContain('footway')

    await waitFor(() => {
      expect(screen.getByText('2件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(screen.getByText('中央通り歩道')).toBeTruthy()
    // 名称が無い縁石: タイトルは種別ラベル「縁石」、バッジも「縁石」（カード内で計2件）
    const kerbCard = document.getElementById('barrier-free-card-node/3006')
    expect(within(kerbCard).getAllByText('縁石')).toHaveLength(2)
    expect(within(kerbCard).queryByText('縁石（未記録）')).toBeNull()
  }, IT_TIMEOUT)

  it('目的タイル（公共施設）: グループ内6カテゴリのunionで検索が実行される', async () => {
    renderApp()
    // (#63) タイル選択前に検索エリアを設定（ジオコード）する
    await setAreaByGeocode()

    // タイルを選択して「検索する」で検索を実行
    fireEvent.click(screen.getByRole('button', { name: '公共施設' }))
    fireEvent.click(getTopSearchButton())

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 目的タイル: グループ内カテゴリ（トイレ・公衆電話・水飲み場・AED・郵便ポスト・役所・公共機関）のunionで検索
    expect(overpassCalls[0]).toContain('amenity=toilets')
    expect(overpassCalls[0]).toContain('amenity=telephone')
    expect(overpassCalls[0]).toContain('amenity=drinking_water')
    expect(overpassCalls[0]).toContain('emergency=defibrillator')
    expect(overpassCalls[0]).toContain('amenity=post_box')
    expect(overpassCalls[0]).toContain('amenity~"^(townhall|post_office|police|fire_station|recycling|shelter|courthouse|public_building)$"')
    expect(overpassCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')
  }, IT_TIMEOUT)

  it('「くわしく探す」で従来フォームへ移り、「トップへ戻る」でトップへ戻れる（地図インスタンスは保持）', async () => {
    renderApp()

    const mapBefore = getMapInstance()
    expect(mapBefore).toBeTruthy()

    // トップ → 従来フォーム
    fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
    // (#xx) フォームは常に地図モード（ソース切替タブは撤去済み）
    await switchToMapMode()
    // フォーム要素が表示される（エリアカード・キーワード入力・フッターの地図モード検索ボタン）
    expect(screen.getByText('どの街・エリアで探す？')).toBeTruthy()
    expect(screen.getByPlaceholderText('例: 珈琲、ラーメン')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()
    // トップ固有要素が消える
    expect(screen.queryByText('好きな場所で作る、わたしのまち')).toBeNull()
    expect(screen.queryByRole('button', { name: /くわしく探す/ })).toBeNull()

    // 従来フォーム → トップ
    fireEvent.click(screen.getByRole('button', { name: /トップへ戻る/ }))
    expect(screen.getByText('好きな場所で作る、わたしのまち')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()

    // 切替で地図が再マウントされていない（単一インスタンス。位置・表示範囲が引き継がれる）
    expect(getMapInstance()).toBe(mapBefore)
  }, IT_TIMEOUT)
})

describe('(place) 検索エリア未設定ガード（state.bbox）: 「指定した場所と種別で検索」の制御', () => {
  it('開いた直後（検索エリア未設定）でタイル選択+「指定した場所と種別で検索」: 検索は実行されず（Overpass問い合わせなし）検証メッセージが表示される', async () => {
    renderApp()

    // 検索エリアの設定（地名検索・自治体選択）を何もしないまま
    // タイルを選択して「指定した場所と種別で検索」を押す
    // （旧の「検索する」は地名入力で即ジオコード+検索していたが、今はジオコードを
    // 行わないため、エリア未設定なら未設定ガードの案内が出る）
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    // 検証メッセージ（StatusBanner）が表示される（地図移動に言及しない文言）
    await waitFor(() => {
      expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy()
    }, { timeout: 8000 })

    // 検索は実行されない: Overpassクエリは送出されない
    expect(overpassCalls).toHaveLength(0)

    // 一覧タブへ自動切替されず、「検索」タブのまま
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)

    // 検証エラーであり通信エラーではない: 「接続エラー」ラベルが付かない
    expect(screen.queryByText(/接続エラー/)).toBeNull()

    // ガイダンス文言（地名の「地名検索」または自治体選択の案内）も表示される
    expect(screen.getByText(/「都道府県から探す」で自治体を選択してください/)).toBeTruthy()

    // (改行) 案内メッセージは文の区切りで改行され、3行で表示される。
    // 表示側は whitespace-pre-line により改行を保持する（文の途中で折り返さない）
    const banner = screen.getByText(/場所がまだ設定されていません/)
    const lines = banner.textContent.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('⚠️ 場所がまだ設定されていません。')
    expect(lines[1]).toBe('地名・駅名を入力して「地名検索」を押すか、')
    expect(lines[2]).toBe('「都道府県から探す」で自治体を選択してください。')
    expect(banner.className).toContain('whitespace-pre-line')
  }, IT_TIMEOUT)

  it('自治体選択（トップの「都道府県から探す」）の後、タイルでその自治体の範囲で検索が実行される', async () => {
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    renderApp()

    // トップの「都道府県から探す」セクションを開き、市区町村を選択する。
    // 選択でそのbboxが検索エリア（state.bbox）に設定される
    const section = screen.getByRole('region', { name: '都道府県から探す' })
    fireEvent.click(within(section).getByRole('button', { name: /都道府県から探す/ }))

    // 都道府県選択（sr-only select。MobileSearchTabMunicipality.test.jsx と同一パターン）
    const prefSelect = await waitFor(() => {
      const sel = within(section).getByLabelText('どの県で探す？')
      expect(sel).toBeTruthy()
      return sel
    }, { timeout: 3000 })
    const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === '大阪府')
    expect(prefOpt).toBeTruthy()
    fireEvent.change(prefSelect, { target: { value: prefOpt.value } })

    // 市区町村入力→候補クリック
    const munInput = await waitFor(() => {
      const i = within(section).getByLabelText('どの市区町村で探す？')
      expect(i).toBeTruthy()
      return i
    }, { timeout: 3000 })
    fireEvent.change(munInput, { target: { value: '東大阪市' } })
    const munOpt = await waitFor(() => {
      const lb = within(section).getByRole('listbox')
      const opt = within(lb).getByRole('option', { name: '東大阪市（区）' })
      return opt
    }, { timeout: 3000 })
    fireEvent.click(munOpt)

    // 目的タイルを選択し「検索する」を押す（入力が空なので自治体の検索エリアが
    // そのまま使われる。セクション内の目的チップと同名のボタンがあるため
    // 「目的から探す」リージョン内に絞る）
    fireEvent.click(
      within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '食べる' })
    )
    fireEvent.click(getTopSearchButton())

    // 検索が実行され、東大阪市（自治体のbbox）の範囲でクエリが送出される
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('amenity=restaurant')
    expect(overpassCalls[0]).toContain('34.560000,135.340000,34.720000,135.520000')

    // 検証メッセージは表示されず、成功で一覧タブへ自動切替
    expect(screen.queryByText(/場所がまだ設定されていません/)).toBeNull()
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)

  it('地名入力で「地名検索」（geocode）の後、タイル選択+「指定した場所と種別で検索」でその範囲で検索が実行される', async () => {
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    renderApp()

    // 地名を入力して「地名検索」を押す（fetchモックがNominatim結果を返す → 検索エリア設定）
    fireEvent.change(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）'), { target: { value: '梅田' } })
    fireEvent.click(getGeocodeButton())

    // 検索エリアが設定される（緑＋入力欄に候補の表示名が入る）
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })

    // タイルを選択してから「指定した場所と種別で検索」を押す
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    // ガードを通過して検索が実行される
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 「食べる」目的グループのunion＋ジオコード結果の範囲（梅田）
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('amenity=restaurant')
    expect(overpassCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')

    // 検証メッセージは表示されず、成功で一覧タブへ自動切替
    expect(screen.queryByText(/場所がまだ設定されていません/)).toBeNull()
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)

  it('確定した地名を保存し、再表示時に空の入力欄へフォーカスすると履歴から選べる', async () => {
    renderApp()
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '梅田' } })
    expect(localStorage.getItem(PLACE_HISTORY_KEY)).toBeNull()
    fireEvent.click(getGeocodeButton())
    await waitFor(() => expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe(UEDA_ROW.display_name))
    expect(nominatimCalls).toBe(1)
    expect(JSON.parse(localStorage.getItem(PLACE_HISTORY_KEY))[0]).toMatchObject({
      query: '梅田', displayName: UEDA_ROW.display_name, bbox: { source: 'geocode' }
    })

    cleanup()
    renderApp()
    const input = screen.getByPlaceholderText(PLACE_INPUT)
    expect(input.value).toBe('')
    expect(screen.queryByText('最近使った地名')).toBeNull()
    fireEvent.focus(input)
    expect(screen.getByText('最近使った地名')).toBeTruthy()
    fireEvent.blur(input, { relatedTarget: getTopSearchButton() })
    expect(screen.queryByText('最近使った地名')).toBeNull()
    fireEvent.focus(input)
    const entry = screen.getByRole('option', { name: /梅田.*大阪府大阪市北区梅田1丁目/ })
    fireEvent.blur(input, { relatedTarget: entry })
    fireEvent.click(entry)
    expect(input.value).toBe(UEDA_ROW.display_name)
    expect(nominatimCalls).toBe(1)
    expect(screen.queryByText('最近使った地名')).toBeNull()
    expect(JSON.parse(localStorage.getItem(PLACE_HISTORY_KEY))).toHaveLength(1)
  }, IT_TIMEOUT)
})

// (修正) トップ検索の「検索中…」が戻らない不具合: ローカル state `searching`
// は true にして setSearching(false) する経路が無く、検索完了後もボタンが
// 「検索中…」のままで固まり再検索ができなかった。`searching` を廃止し
// state.status === 'loading' から導出するよう直したので、検索の実状態
// （loading → success/error/idle）とボタン表示が常に一致することを確認する。
describe('(top) 検索完了後にボタンが通常表示へ戻る（「検索中…」で固まらない）', () => {
  it('トップ検索が成功した後も「指定した場所と種別で検索」ボタンは通常表示に戻り、再検索できる', async () => {
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    renderApp()
    await setAreaByGeocode()

    // タイルを選択して「指定した場所と種別で検索」を押す
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    // 成功で一覧タブへ自動切替
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()

    // 検索タブ（トップ画面）に戻るとボタンは通常表示に戻っている
    clickTab('検索')
    const btn = getTopSearchButton()
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('指定した場所と種別で検索')
    expect(btn.disabled).toBe(false)

    // 続けて再検索できる（2件目の検索が完了し一覧タブへ自動切替される）。
    // 同一クエリはOverpassメモリキャッシュにヒットするため2件目の通信は発生しない
    // が、検索フロー自体（status: loading→success）は実行される
    fireEvent.click(btn)
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)

  it('トップ検索が失敗した後もボタンは通常表示に戻り、再検索できる', async () => {
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    overpassStatus = 500
    renderApp()
    await setAreaByGeocode()

    // タイルを選択して「指定した場所と種別で検索」を押す
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    // 失敗でサーバーエラーのバナーが表示される（検索タブにとどまる）
    await waitFor(() => {
      expect(screen.getByText(/サーバーエラー/)).toBeTruthy()
    }, { timeout: 8000 })

    // ボタンは通常表示に戻っている（「検索中…」で固まっていない）
    const btn = getTopSearchButton()
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(false)

    // 再検索できる（サーバーが復旧すれば結果が取得できる）。
    // 1件目は失敗してキャッシュされていないため、2件目は実際に通信される
    overpassStatus = 200
    fireEvent.click(btn)
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)
})

// 検索エリア設定成功時に場所入力欄を緑色表示。入力編集で緑と検索エリアを
// 解除（未設定ガードが再び働く）、見つからなかった場合は緑にならない。
// 都道府県から探すでの自治体選択は緑の対象外（既存の地名入力欄のみが対象）。
describe('(place) 場所入力欄の緑色表示（検索エリア設定成功の視覚フィードバック）', () => {
  it('場所検索（geocode）に成功すると、場所入力欄に緑色のスタイル（緑枠・薄い緑背景）が当たる', async () => {
    renderApp()
    await setAreaByGeocode()

    const input = screen.getByPlaceholderText(PLACE_INPUT)
    // 緑色の枠線と薄い緑の背景
    expect(input.className).toContain('border-green-500')
    expect(input.className).toContain('bg-green-50')
    // 入力欄には候補の表示名（displayName）が入る（何が設定されたか欄から分かる）
    expect(input.value).toBe('大阪府大阪市北区梅田1丁目')
    // 成功フィードバックの「設定しました」文言は表示されない
    expect(screen.queryByText(/検索エリアに.*を設定しました/)).toBeNull()
  }, IT_TIMEOUT)

  it('成功後に場所入力欄を編集すると: 緑が解除され検索エリアは未設定に戻り、「指定した場所と種別で検索」で未設定ガード（案内メッセージ）が出る', async () => {
    renderApp()
    await setAreaByGeocode()

    // 入力内容を編集（編集すると緑と検索エリアが解除される）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '奈良' } })

    const input = screen.getByPlaceholderText(PLACE_INPUT)
    // 緑が解除される
    expect(input.className).not.toContain('border-green-500')
    expect(input.className).not.toContain('bg-green-50')
    // 入力欄には編集後の値が入る（候補の表示名は消える）
    expect(input.value).toBe('奈良')

    // 入力を空に戻す（= 入力が空で検索エリアも未設定）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '' } })

    // 検索エリアが未設定に戻った: タイル選択+「指定した場所と種別で検索」で未設定ガードが再び働く
    fireEvent.click(within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy()
    }, { timeout: 8000 })
    // 検索は実行されない
    expect(overpassCalls).toHaveLength(0)
    // 一覧タブへ切替されず、「検索」タブのまま
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
  }, IT_TIMEOUT)

  it('場所が見つからなかった場合（エラー表示時）: 場所入力欄は緑にならない', async () => {
    // Nominatimが空配列を返す（結果なし → 「場所が見つかりませんでした」）。
    // Nominatim 候補がゼロのため Overpass 名前検索補完（geocode-fb）が発動するが、
    // 実際の Overpass は「zzz見つからない」という名称の要素を持たないため、
    // 補完は空を返す（モックも同じく空を返す）
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const u = String(url)
      if (u.includes('nominatim')) {
        nominatimCalls++
        return { ok: true, status: 200, headers: new Map(), json: async () => [] }
      }
      if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
        const body = options.body || ''
        const q = new URLSearchParams(body).get('data') || body
        overpassCalls.push(q)
        if (q.includes('nwr["name"~')) {
          return {
            ok: true,
            status: 200,
            headers: new Map(),
            json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: [] }),
          }
        }
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: overpassElements }),
        }
      }
      return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
    })
    renderApp()

    // 場所が見つからない地名で「地名検索」
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: 'zzz見つからない' } })
    fireEvent.click(getGeocodeButton())

    // エラーが表示される
    await waitFor(() => {
      expect(screen.getByText(/場所が見つかりませんでした/)).toBeTruthy()
    }, { timeout: 8000 })

    const input = screen.getByPlaceholderText(PLACE_INPUT)
    // 緑にならない
    expect(input.className).not.toContain('border-green-500')
    expect(input.className).not.toContain('bg-green-50')
    // 入力欄は入力文字のまま
    expect(input.value).toBe('zzz見つからない')
    // 検索エリアも設定されていない: タイル選択+「指定した場所と種別で検索」で
    // 未設定ガードの案内が出る（ジオコードのエラーメッセージはそのまま残る）
    fireEvent.click(within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy()
    }, { timeout: 8000 })
    // ジオコードのエラーメッセージもそのまま残る（両方表示）
    expect(screen.getByText(/場所が見つかりませんでした/)).toBeTruthy()
    // 施設検索クエリは送出されない（地名検索補完の名前検索 nwr["name"~ は
    // 補完経路なのでカウントしない。補完は空返りして「見つからない」に戻る）
    expect(overpassCalls.filter((q) => !q.includes('nwr["name"~'))).toHaveLength(0)
  }, IT_TIMEOUT)

  it('都道府県から探すで自治体を選んだ場合: 場所入力欄は緑にならない（既存の地名入力の緑も解除）', async () => {
    renderApp()

    // まず地名検索でエリアを設定し、入力欄を緑にする
    await setAreaByGeocode()
    let input = screen.getByPlaceholderText(PLACE_INPUT)
    expect(input.className).toContain('border-green-500')

    // その後、「都道府県から探す」で自治体を選択
    const section = screen.getByRole('region', { name: '都道府県から探す' })
    fireEvent.click(within(section).getByRole('button', { name: /都道府県から探す/ }))
    const prefSelect = await waitFor(() => {
      const sel = within(section).getByLabelText('どの県で探す？')
      expect(sel).toBeTruthy()
      return sel
    }, { timeout: 3000 })
    const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === '大阪府')
    expect(prefOpt).toBeTruthy()
    fireEvent.change(prefSelect, { target: { value: prefOpt.value } })
    const munInput = await waitFor(() => {
      const i = within(section).getByLabelText('どの市区町村で探す？')
      expect(i).toBeTruthy()
      return i
    }, { timeout: 3000 })
    fireEvent.change(munInput, { target: { value: '東大阪市' } })
    const munOpt = await waitFor(() => {
      const lb = within(section).getByRole('listbox')
      const opt = within(lb).getByRole('option', { name: '東大阪市（区）' })
      return opt
    }, { timeout: 3000 })
    fireEvent.click(munOpt)

    // 場所入力欄は緑にならない（自治体選択は緑の対象外。既存の緑も解除され
    // 入力内容と検索エリアが食い違う状態にならない）
    await waitFor(() => {
      input = screen.getByPlaceholderText(PLACE_INPUT)
      expect(input.className).not.toContain('border-green-500')
    }, { timeout: 8000 })
  }, IT_TIMEOUT)
})

// (place) 地名入力のサジェストと複数候補の提示
//  - 2文字以上の入力で約400msのデバウンス後に geocodeCandidates が走り、
//    入力欄の下に候補リスト（ラベルは「名称（都道府県市区町村）」）が表示される
//  - 候補タップ → 検索エリアが設定される（入力欄が緑＋成功フィードバック）。
//    施設検索はまだ実行されない（従来どおり「検索する」で実行）
//  - 「検索する」で候補が2件以上 → 「候補が複数あります。選んでください。」の
//    案内付きで候補リストを表示し、施設検索は実行されない
//  - 候補を選んでから「検索する」を再度押すと、その候補の範囲で検索される
//    （同じ地名の geocode が再実行されず、提示がループしない）
describe('(place) 地名入力のローカルサジェスト（自治体＋周辺Overpassキャッシュ）と複数候補の提示', () => {
  // サジェストリスト（role=listbox）内の指定ラベルの候補を待って返す
  async function waitForSuggestOption(optionName, { timeout = 8000 } = {}) {
    return waitFor(() => {
      const lb = screen.getByRole('listbox')
      const opt = within(lb).queryByRole('option', { name: optionName })
      expect(opt).toBeTruthy()
      return opt
    }, { timeout })
  }

  // フォーカス（周辺候補の Overpass 取得を起動）＋ 入力
  function typeWithFocus(input, value) {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value } })
  }

  it('2文字以上の入力で周辺候補が端末内照合で表示される（ラベルは「名称（種別・距離）」）+ 入力中にNominatim問い合わせなし', async () => {
    setupGeolocationMock()
    renderApp()
    const input = screen.getByPlaceholderText(PLACE_INPUT)

    // 1文字: 候補なし（2文字以上が必要）。周辺取得はフォーカスで開始済み
    typeWithFocus(input, '梅')
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.queryByRole('listbox')).toBeNull()

    // 2文字以上: 端末内のローカル照合（デバウンスもネットワーク問い合わせもなし）。
    // 周辺候補の Overpass 応答が到着していれば即座に、でなければ応答到着後に
    // 表示される
    fireEvent.change(input, { target: { value: '梅田' } })
    await waitForSuggestOption(/梅田駅/)

    // ラベル形式: 名称（種別・距離）。距離が0mなら距離表記はない
    expect(screen.getByRole('option', { name: /梅田駅（駅）/ })).toBeTruthy()
    // 地区候補（距離表記付き: 約100〜199m 程度）
    expect(screen.getByRole('option', { name: /梅田（地区・約1\d\d?m）/ })).toBeTruthy()

    // 入力中に Nominatim への問い合わせは一切ない（公開 Nominatim 利用規約では
    // オートコンプリート用途の連続問い合わせが禁止のため）
    expect(nominatimCalls).toBe(0)
  }, IT_TIMEOUT)

  it('サジェスト候補タップで検索エリアが設定される（入力欄が緑＋フィードバック、施設検索は実行されない）', async () => {
    setupGeolocationMock()
    renderApp()
    const input = screen.getByPlaceholderText(PLACE_INPUT)
    typeWithFocus(input, '梅田')
    await waitForSuggestOption(/梅田駅/)
    fireEvent.click(screen.getByRole('option', { name: /梅田駅/ }))

    // エリア設定: 入力欄が緑＋候補の表示名（displayName）が入る
    // （「地名検索」で場所が見つかったときと同じ流れ。設定文言は廃止）。
    // 駅（点）→ 駅を中心とする1.5km四方の範囲が検索エリアになる
    await waitFor(() => {
      const input = screen.getByPlaceholderText(PLACE_INPUT)
      expect(input.className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('梅田駅')
    // リストは閉じる
    expect(screen.queryByRole('listbox')).toBeNull()
    // 施設検索はまだ実行されていない（around:5000 の周辺取得クエリは別物）
    expect(overpassCalls.filter((q) => !q.includes('around:5000'))).toHaveLength(0)
    expect(tabIsCurrent('一覧')).toBe(false)

    // タイル選択+「指定した場所と種別で検索」→ 設定済み範囲で検索が実行される
    overpassElements = OVERPASS_ELEMENTS_UMEDA
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    const facilityCall = overpassCalls.find((q) => !q.includes('around:5000'))
    // 梅田駅（34.7/135.5）中心の1.5km四方
    expect(facilityCall).toContain('34.693255,135.491796,34.706745,135.508204')
    expect(facilityCall).toContain('amenity=cafe')
    expect(facilityCall).toContain('amenity=restaurant')

    // 1.5km四方では3要素とも四方内に入るため、bboxフィルタ後は全て残る
    // （旧1km四方では珈琲店・書店はわずかに外側で1件のみだった）。
    // 表示一覧は「食べる」目的フィルタで書店（shop=books）が除外されるため2件
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /ラーメン屋テスト/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /テスト書店/ })).toBeNull()
  }, IT_TIMEOUT)

  it('「地名検索」で候補が複数（2件以上）だと候補リスト＋「候補が複数あります。選んでください。」を表示し、施設検索は実行されない', async () => {
    nominatimRows = [KAGOSHI_UEMACHI_ROW, OSAKA_UEMACHI_ROW]
    renderApp()
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '上本町' } })

    // 入力中に Nominatim 問い合わせはなく、ローカル候補も出ない（「上本町」は
    // 自治体・周辺候補のどちらにも一致しない）
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(nominatimCalls).toBe(0)

    // 「地名検索」: 1件目を勝手に選ばず、複数候補の提示にする
    fireEvent.click(getGeocodeButton())
    await waitFor(() => {
      expect(screen.getByText(/候補が複数あります/)).toBeTruthy()
    }, { timeout: 8000 })
    const lb = screen.getByRole('listbox')
    expect(within(lb).getByRole('option', { name: '上本町（鹿児島県鹿児島市）' })).toBeTruthy()
    expect(within(lb).getByRole('option', { name: '上本町（大阪府大阪市）' })).toBeTruthy()

    // エリアは設定されていない（緑にならない・入力欄は入力文字のまま）
    const input = screen.getByPlaceholderText(PLACE_INPUT)
    expect(input.className).not.toContain('border-green-500')
    expect(input.value).toBe('上本町')
    // 施設検索は実行されていない（トップ画面のまま）
    expect(overpassCalls.filter((q) => !q.includes('around:5000'))).toHaveLength(0)
    expect(tabIsCurrent('一覧')).toBe(false)
    expect(tabIsCurrent('検索')).toBe(true)
  }, IT_TIMEOUT)

  it('複数候補から候補を選ぶとエリアが設定され、「指定した場所と種別で検索」でその範囲の検索が実行される', async () => {
    nominatimRows = [KAGOSHI_UEMACHI_ROW, OSAKA_UEMACHI_ROW]
    renderApp()
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '上本町' } })

    // 「地名検索」→ 複数候補の提示 → 鹿児島市側の候補をタップ
    fireEvent.click(getGeocodeButton())
    await waitFor(() => {
      expect(screen.getByText(/候補が複数あります/)).toBeTruthy()
    }, { timeout: 8000 })
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '上本町（鹿児島県鹿児島市）' }))

    // エリアが設定される（緑＋入力欄に候補の表示名が入る）。まだ検索は実行されない
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('上本町, 鹿児島市, 鹿児島県, 日本')
    expect(overpassCalls.filter((q) => !q.includes('around:5000'))).toHaveLength(0)
    // リストは閉じる
    expect(screen.queryByRole('listbox')).toBeNull()

    // タイル選択+「指定した場所と種別で検索」→ 選んだ候補の範囲で検索が実行される
    // （同じ地名の geocode が再実行されず、複数候補の提示がループしない）
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    const facilityCall = overpassCalls.find((q) => !q.includes('around:5000'))
    expect(facilityCall).toContain('31.580000,130.680000,31.600000,130.710000')
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
  }, IT_TIMEOUT)

  it('「地名検索」の問い合わせ中に入力欄右端にスピナーが表示され、完了で消える（入力は無効化されない）', async () => {
    renderApp()
    // Nominatim の fetch を未解決に保つ（リクエストを実際に Pending 状態にする）
    nominatimDeferred = createDeferred()

    const input = screen.getByPlaceholderText(PLACE_INPUT)
    // 地名を入力して「地名検索」を押す → Nominatim リクエスト開始でスピナー表示
    fireEvent.change(input, { target: { value: '梅田' } })
    fireEvent.click(getGeocodeButton())

    // スピナーが現れるまで待つ
    await waitFor(() => {
      expect(screen.queryByTestId('place-input-spinner')).toBeTruthy()
    }, { timeout: 8000 })

    // スピナー表示中も入力は無効化されない（disabled にならない）
    const inputDuring = screen.getByPlaceholderText(PLACE_INPUT)
    expect(inputDuring.disabled).toBe(false)
    // 右パディングが広がっている（スピナーのスペース確保: pr-9）
    expect(inputDuring.className).toContain('pr-9')
    // 「地名検索」ボタン自体は問い合わせ中なので無効化される
    expect(getGeocodeButton().disabled).toBe(true)

    // リクエスト完了（1件返却）→ スピナー消滅 ＋ 検索エリア設定
    nominatimDeferred.resolve([UEDA_ROW])
    await waitFor(() => {
      expect(screen.queryByTestId('place-input-spinner')).toBeNull()
    }, { timeout: 8000 })
    // 検索エリアが設定される（入力欄に候補の表示名が入る）
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('大阪府大阪市北区梅田1丁目')
    }, { timeout: 8000 })
  }, IT_TIMEOUT)

  it('候補を選んだ後に通信中だった周辺候補の結果が届いても、候補リストは再表示されない', async () => {
    setupGeolocationMock()
    // 周辺候補取得の Overpass fetch を未解決に保つ（リクエスト中を再現）
    nearbyDeferred = createDeferred()
    renderApp()

    const input = screen.getByPlaceholderText(PLACE_INPUT)
    // 「大阪」: 自治体候補（ローカル計算）は即座に出る。周辺候補の
    // Overpass リクエストはフォーカスで発行され、応答待ちのままになる
    typeWithFocus(input, '大阪')
    await waitFor(() => {
      expect(getSuggestOptions().length).toBeGreaterThan(0)
    }, { timeout: 8000 })

    // 自治体候補をタップ → エリアが設定され（緑＋入力欄に候補の表示名が入る）、リストは閉じる
    fireEvent.click(getSuggestOptions()[0])
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.queryByRole('listbox')).toBeNull()

    // 通信中だった Overpass の応答（地区「大阪」など・「大阪」に一致する
    // 要素を含む）が後から届いても、候補リストは再表示されない
    nearbyDeferred.resolve({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: NEARBY_ELEMENTS })
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByRole('listbox')).toBeNull()
  }, IT_TIMEOUT)
})

describe('ヘッダーのハンバーガーメニュー (#75)', () => {
  it('ヘッダーに ☰ ボタンがあり、開くと保存系・全消去の3項目が並ぶ', () => {
    renderApp()

    // ヘッダー内に「メニュー」ボタンがある
    const header = document.querySelector('header')
    const menuBtn = within(header).getByRole('button', { name: 'メニュー' })
    expect(menuBtn).toBeTruthy()

    // 検索結果が無い段階では保存系・全消去は disabled（項目自体は表示される）
    fireEvent.click(menuBtn)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /一覧を保存（CSV）/ }).disabled).toBe(true)
    expect(within(menu).getByRole('menuitem', { name: /GeoJSON（高度な形式）/ }).disabled).toBe(true)
    expect(within(menu).getByRole('menuitem', { name: /まちメモ帳をすべて削除/ }).disabled).toBe(true)

    // 再度クリックで閉じる
    fireEvent.click(menuBtn)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('どのタブ（検索/一覧/その他）を表示していてもメニューが開け、3項目が表示される (#77-3)', () => {
    renderApp()

    for (const label of ['検索', '一覧', 'その他']) {
      clickTab(label)
      expect(tabIsCurrent(label)).toBe(true)

      // ヘッダー（タブ内容の外側・常時表示）に ☰ ボタンがあり、開くと3項目
      const menuBtn = within(document.querySelector('header')).getByRole('button', { name: 'メニュー' })
      fireEvent.click(menuBtn)
      const menu = screen.getByRole('menu')
      expect(within(menu).getByRole('menuitem', { name: /一覧を保存（CSV）/ })).toBeTruthy()
      expect(within(menu).getByRole('menuitem', { name: /GeoJSON（高度な形式）/ })).toBeTruthy()
      expect(within(menu).getByRole('menuitem', { name: /まちメモ帳をすべて削除/ })).toBeTruthy()

      // 閉じて次のタブへ
      fireEvent.click(menuBtn)
      expect(screen.queryByRole('menu')).toBeNull()
    }
  })
})
