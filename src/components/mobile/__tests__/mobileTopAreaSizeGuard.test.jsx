// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import App from '../../../App'
import { clearCache } from '../../../utils/overpass'
import { calculateBboxAreaKm2, MAX_SEARCH_AREA_KM2 } from '../../../utils/geo'

/**
 * 一般向けトップの「広すぎる」ガード（BBOX面積ベース判定）の検証
 *
 * 旧都道府県ガード（isPrefectureCandidate の名称ベース判定）を廃止し、
 * 候補の元のBBOXの面積（searchAreaFromGeocode の約1.5km拡大前の値）で
 * 判定する方式に置き換えた。面積が MAX_SEARCH_AREA_KM2 = 1,000 km²
 * 以上で「広すぎる」とし、国・外国の州・都道府県などの広すぎる範囲を
 * すべてこの判定でカバーする。
 *
 * - 都道府県サイズの候補（大阪府・約25,800 km²）: 「地名検索」でエラー表示され、
 *   検索エリアは設定されず Overpass へのリクエストが行かない
 * - 国サイズの候補（日本・約263万 km²）: 「地名検索」で同様にエラー表示、
 *   Overpass へのリクエストなし
 * - 市サイズの候補（約225 km²）: 「地名検索」で検索エリアが通常どおり設定され、
 *   「指定した場所と種別で検索」で施設検索が実行される
 *
 * 市区町村の例外: 市区町村レベルの行政区域は大きさによらずガードの対象外
 * （大きな市（例: 高山市・約2,178 km²）は最小の県（香川県・約1,876 km²）より
 * 大きく、面積だけでは市区町村と都道府県を区別できないため）。
 * - 自治体データ由来の候補（kind='自治体'）: 「都道府県から探す」等の自治体
 *   検索経路で大きな市も検索できる現行仕様を維持
 *   （その検証は mobileTopMunicipalities.test.jsx にある）
 * - Nominatim 由来の候補: addresstype が市区町村レベル（city/town/village 等）
 *   の場合は市区町村と判定する（実 Nominatim で高山市→city・揖斐川町→town・
 *   香川県→province・日本→country を確認）。大きな市（高山市相当）が
 *   エラーにならず検索クエリが発行されることを検証する
 *
 * MapLibre GL は WebGL が必要で jsdom では初期化できないためモジュール全体を
 * モックする（旧 mobileTopPrefectureGuard.test.jsx と同じ方式・fixture）。
 */
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

// ===== テスト用データ =====
// 実際の public/data/municipalities.json と同じ形のfixture。「大阪府」「日本」
// との完全一致（exactMatchMunicipalities）が成立しない市区町村だけを含める。
const MUNI_DATA = {
  municipalities: [
    { code: '262048', prefCode: '26', prefecture: '京都府', name: '宇治市', adminLevel: 7, bbox: { south: 34.85793, west: 135.75965, north: 34.95709, east: 135.87992 }, displayName: '宇治市' },
  ]
}

// Nominatim 応答行。「大阪府」のクエリに対して都道府県そのもの（boundary
// relation: class=boundary, type=administrative）を返す。実 Nominatim と同じ
// 形で address.state に都道府県名が入る（市区町村キーはない）。
// 面积约25,800 km² → しきい値（1,000 km²）を超える
const OSAKA_PREFECTURE_ROW = {
  lat: '34.55',
  lon: '135.55',
  display_name: '大阪府, 日本',
  name: '大阪府',
  class: 'boundary',
  type: 'administrative',
  boundingbox: ['33.4342', '35.0240', '135.2802', '136.8672'],
  address: { state: '大阪府', country: '日本' },
}

// Nominatim 応答行。「日本」のクエリに対して国（place/country）を返す。
// 面积约263万 km² → しきい値を大きく超える
const JAPAN_ROW = {
  lat: '36.0',
  lon: '138.0',
  display_name: '日本',
  name: '日本',
  class: 'place',
  type: 'country',
  boundingbox: ['30.5', '45.5', '128.0', '146.0'],
  address: { country: '日本' },
}

// Nominatim 応答行。「高山市」のクエリに対して高山市そのもの（boundary
// relation）を返す。boundingbox は実 Nominatim の値（面積の概算式では
// 約4,400 km² としきい値 1,000 km² を大きく超える。実面積は約2,178 km²）。
// addresstype='city'（市区町村レベルの行政区域）のため「広すぎる」ガードの
// 例外に該当し、通常どおり検索できる
const TAKAYAMA_CITY_ROW = {
  lat: '36.1452425',
  lon: '137.2035105',
  display_name: '高山市, 岐阜県, 日本',
  name: '高山市',
  class: 'boundary',
  type: 'administrative',
  addresstype: 'city',
  boundingbox: ['35.8974890', '36.3929960', '136.7539670', '137.6530540'],
}

// 市サイズ（約225 km² = 15km × 15km）の候補。calculateBboxAreaKm2 と同じ式
// （地球半径6371km・経度方向をcos(緯度)で補正）でBBOXを構成するため、
// 面積は正確に225 km² になる（しきい値未満）。
const TEST_KM_PER_DEG = (Math.PI / 180) * 6371
const CITY_LAT_MID = 35
const CITY_HALF_LAT = 15 / 2 / TEST_KM_PER_DEG
const CITY_HALF_LON = 15 / 2 / (TEST_KM_PER_DEG * Math.cos((CITY_LAT_MID * Math.PI) / 180))
const CITY_BBOX = {
  south: CITY_LAT_MID - CITY_HALF_LAT,
  north: CITY_LAT_MID + CITY_HALF_LAT,
  west: 135 - CITY_HALF_LON,
  east: 135 + CITY_HALF_LON,
}

// Nominatim 応答行。「テスト市」のクエリに対して市（boundary relation）を返す。
const CITY_ROW = {
  lat: '35.0',
  lon: '135.0',
  display_name: 'テスト市',
  name: 'テスト市',
  class: 'boundary',
  type: 'administrative',
  boundingbox: [String(CITY_BBOX.south), String(CITY_BBOX.north), String(CITY_BBOX.west), String(CITY_BBOX.east)],
  address: { state: 'テスト県' },
}

// 市サイズ候補の bbox の内側にある要素（成功ケースの検索結果）
const OVERPASS_ELEMENTS_CITY = [
  { type: 'node', id: 6001, lat: 35.0, lon: 135.0, tags: { name: 'テスト市珈琲店', amenity: 'cafe' } },
]

// ===== フック =====
let mediaMatches = true
let mediaListeners = []
let overpassCalls = []
let overpassElements = OVERPASS_ELEMENTS_CITY
let nominatimRows = [OSAKA_PREFECTURE_ROW]
let nominatimCalls = 0

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

function setupFetchMock() {
  const mockFetch = vi.fn(async (url, options = {}) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => MUNI_DATA }
    }
    if (u.includes('stations.json')) {
      // 駅ファイルはトップ表示時に読み込まれる（空配列＝駅候補なし・エラーなし）
      return { ok: true, status: 200, headers: new Map(), json: async () => [] }
    }
    if (u.includes('nominatim')) {
      nominatimCalls += 1
      return { ok: true, status: 200, headers: new Map(), json: async () => nominatimRows }
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
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
}

function renderApp() {
  window.history.replaceState(null, '', '/')
  render(<App />)
}

const IT_TIMEOUT = 15000

const PLACE_INPUT = '地名・駅名（例: 大阪駅）'

function navButtons() {
  return within(screen.getByRole('navigation', { name: 'モバイルナビゲーション' }))
}
function tabIsCurrent(label) {
  return navButtons().getByRole('button', { name: label }).getAttribute('aria-current') === 'page'
}

// タイル下の「指定した場所と種別で検索」ボタン（「目的から探す」セクション内に
// スコープ: 下部ナビの「検索」タブや「都道府県から探す」セクションのボタンと区別する）。
// 施設検索のみ実行する（地名のジオコードはしない）
function getTopSearchButton() {
  return within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '指定した場所と種別で検索' })
}

// 地名入力欄の右の「地名検索」ボタン（「どこで探すか」セクション内にスコープ）
function getGeocodeButton() {
  return within(screen.getByRole('region', { name: 'どこで探すか' })).getByRole('button', { name: '地名検索' })
}

// 自治体データ（loadMunicipalities）の読み込み完了を待つ
async function waitForMuniDataLoaded() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

// 統一エラー文（geo.js の isBboxTooLarge ガードの文面）
const TOO_LARGE_ERROR = (name) =>
  `『${name}』の範囲が広すぎるため検索できません。市区町村や駅・地名を指定してください。`

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
  overpassElements = OVERPASS_ELEMENTS_CITY
  nominatimRows = [OSAKA_PREFECTURE_ROW]
  nominatimCalls = 0
  setupFetchMock()
  clearCache()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('トップの「広すぎる」ガード（BBOX面積ベース判定）', () => {
  it('fixtureのBBOXが想定通りのサイズである（都道府県>しきい値>市）', () => {
    expect(MAX_SEARCH_AREA_KM2).toBe(1000)
    expect(calculateBboxAreaKm2({ south: 33.4342, north: 35.0240, west: 135.2802, east: 136.8672 }))
      .toBeGreaterThan(MAX_SEARCH_AREA_KM2)
    expect(calculateBboxAreaKm2(CITY_BBOX)).toBeCloseTo(225, 1)
    expect(calculateBboxAreaKm2(CITY_BBOX)).toBeLessThan(MAX_SEARCH_AREA_KM2)
  })

  it('都道府県サイズの候補（大阪府）で「地名検索」を押すとエラーが表示され、検索エリアが設定されず Overpass へリクエストが行かない', async () => {
    renderApp()
    await waitForMuniDataLoaded()

    // 「大阪府」と入力 → 「地名検索」（Nominatim ジオコード）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '大阪府' } })
    fireEvent.click(getGeocodeButton())

    // 単一候補でも広すぎる: 場所入力欄の下にエラー表示（searchError: role=alert）
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(TOO_LARGE_ERROR('大阪府'))
    }, { timeout: 8000 })

    // 検索エリアは設定されていない（緑にならない。入力欄は入力文字のまま）
    expect(screen.getByPlaceholderText(PLACE_INPUT).className).not.toContain('border-green-500')
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('大阪府')
    // サジェストリストは出ない（入力中はローカル照合のみ。大阪府に一致する候補なし）
    expect(screen.queryByRole('listbox')).toBeNull()

    // Overpass へリクエストは行っていない
    expect(overpassCalls).toHaveLength(0)
    // 検索タブを離れていない
    expect(tabIsCurrent('検索')).toBe(true)
  }, IT_TIMEOUT)

  it('都道府県サイズの候補（大阪府）で「地名検索」すると「広すぎる」エラーになり、続けて「指定した場所と種別で検索」を押しても施設検索のクエリは発行されない', async () => {
    renderApp()
    await waitForMuniDataLoaded()

    // タイル選択 → 地名入力 → 「地名検索」
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '大阪府' } })
    fireEvent.click(getGeocodeButton())

    // 「広すぎる」エラー（searchError）
    await waitFor(() => {
      expect(screen.getByText(/『大阪府』の範囲が広すぎるため検索できません/)).toBeTruthy()
    }, { timeout: 8000 })

    // 施設検索のクエリは発行されていない
    expect(overpassCalls).toHaveLength(0)
    // 検索エリアも設定されていない（緑にならない。入力欄は入力文字のまま）
    expect(screen.getByPlaceholderText(PLACE_INPUT).className).not.toContain('border-green-500')
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('大阪府')
    // 一覧タブには切替されていない
    expect(tabIsCurrent('検索')).toBe(true)

    // そのまま「指定した場所と種別で検索」→ エリア未設定の案内（施設検索は実行されない）
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy()
    }, { timeout: 8000 })
    expect(overpassCalls).toHaveLength(0)
  }, IT_TIMEOUT)

  it('国サイズの候補（日本）で「地名検索」を押しても施設検索のクエリは発行されず、「広すぎる」エラーになる', async () => {
    nominatimRows = [JAPAN_ROW]
    renderApp()
    await waitForMuniDataLoaded()

    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '日本' } })
    fireEvent.click(getGeocodeButton())

    // 「広すぎる」エラー（searchError）
    await waitFor(() => {
      expect(screen.getByText(/『日本』の範囲が広すぎるため検索できません/)).toBeTruthy()
    }, { timeout: 8000 })

    // 施設検索のクエリは発行されていない
    expect(overpassCalls).toHaveLength(0)
    // 検索エリアも設定されていない（緑にならない。入力欄は入力文字のまま）
    expect(screen.getByPlaceholderText(PLACE_INPUT).className).not.toContain('border-green-500')
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('日本')
    // 一覧タブには切替されていない
    expect(tabIsCurrent('検索')).toBe(true)
  }, IT_TIMEOUT)

  it('市区町村の例外: 大きな市（高山市相当・面積1,000 km²超）で「地名検索」するとエラーにならず検索エリアが設定され、施設検索のクエリが発行される', async () => {
    nominatimRows = [TAKAYAMA_CITY_ROW]
    // 高山市のBBOX内にある検索結果要素（filterByBbox で範囲内のみ表示される）
    overpassElements = [{ type: 'node', id: 6001, lat: 36.15, lon: 137.2, tags: { name: '高山市珈琲店', amenity: 'cafe' } }]
    renderApp()
    await waitForMuniDataLoaded()

    // タイル選択 → 「高山市」と入力 → 「地名検索」
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '高山市' } })
    fireEvent.click(getGeocodeButton())

    // addresstype='city' のためガードの例外: エラーにならず
    // 通常どおり検索エリアが設定される
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    // 入力欄には候補の表示名（displayName「高山市, 岐阜県, 日本」）が入る
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('高山市, 岐阜県, 日本')
    // エラー表示は出ない
    expect(screen.queryByText(/広すぎるため検索できません/)).toBeNull()

    // 「指定した場所と種別で検索」で施設検索のクエリが発行される
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 高山市の元のBBOXがそのまま検索エリアになる（面積が1km²以上）
    const bboxStr = ['35.897489', '136.753967', '36.392996', '137.653054'].join(',')
    expect(overpassCalls[0]).toContain(bboxStr)
    expect(overpassCalls[0]).toContain('amenity=cafe')
    // 一覧タブに切替され、結果が表示される
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('1件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)

  it('市区町村の例外: 大きな市（高山市相当・面積1,000 km²超）で「地名検索」を押してもエラーにならず施設検索のクエリが発行される', async () => {
    nominatimRows = [TAKAYAMA_CITY_ROW]
    // 高山市のBBOX内にある検索結果要素（filterByBbox で範囲内のみ表示される）
    overpassElements = [{ type: 'node', id: 6001, lat: 36.15, lon: 137.2, tags: { name: '高山市珈琲店', amenity: 'cafe' } }]
    renderApp()
    await waitForMuniDataLoaded()

    // タイル選択 → 地名入力 → 「地名検索」
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '高山市' } })
    fireEvent.click(getGeocodeButton())

    // 検索エリアが設定される（緑＋入力欄に候補の表示名が入る）
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('高山市, 岐阜県, 日本')

    // 「広すぎる」エラーは出ない（市区町村レベルの行政区域はガードの対象外）
    expect(screen.queryByText(/『高山市』の範囲が広すぎるため検索できません/)).toBeNull()

    // 「指定した場所と種別で検索」で施設検索のクエリが発行される
    // （高山市の元のBBOXがそのまま検索エリアに）
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    const bboxStr = ['35.897489', '136.753967', '36.392996', '137.653054'].join(',')
    expect(overpassCalls[0]).toContain(bboxStr)
    expect(overpassCalls[0]).toContain('amenity=cafe')
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('1件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)

  it('市区町村の例外: 「地名検索」の複数候補のうち大きな市（高山市相当）を選んでもエラーにならず検索エリアが設定される', async () => {
    // 高山市と大阪府の2候補。大阪府はガードの対象（province）、
    // 高山市はガードの例外（city）
    nominatimRows = [TAKAYAMA_CITY_ROW, OSAKA_PREFECTURE_ROW]
    renderApp()
    await waitForMuniDataLoaded()

    // 「高山市」と入力 → 「地名検索」: 2候補 → リストを提示（1件目を勝手に選ばない）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '高山市' } })
    fireEvent.click(getGeocodeButton())

    // 「候補が複数あります」の提示で高山市・大阪府の2件が表示される
    const listbox = await waitFor(() => {
      const lb = screen.queryByRole('listbox')
      if (lb && within(lb).queryByRole('option', { name: /高山市/ })) return lb
      throw new Error('候補リストが表示されない')
    }, { timeout: 8000 })

    // 高山市の候補を選ぶ → ガードの例外として通常どおりエリアが設定される
    fireEvent.click(within(listbox).getByRole('option', { name: /高山市/ }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('高山市, 岐阜県, 日本')
    expect(screen.queryByText(/広すぎるため検索できません/)).toBeNull()
    // 候補選択だけでは施設検索は実行されない（「指定した場所と種別で検索」で実行）
    expect(overpassCalls).toHaveLength(0)

    // タイルを選択して「指定した場所と種別で検索」→ クエリが発行される
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    const bboxStr = ['35.897489', '136.753967', '36.392996', '137.653054'].join(',')
    expect(overpassCalls[0]).toContain(bboxStr)
  }, IT_TIMEOUT)

  it('市サイズの候補（約225 km²）では通常どおり検索エリアが設定され、施設検索が実行される', async () => {
    nominatimRows = [CITY_ROW]
    renderApp()
    await waitForMuniDataLoaded()

    // タイル選択 → 地名入力 → 「地名検索」
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: 'テスト市' } })
    fireEvent.click(getGeocodeButton())

    // 検索エリアが設定される（緑＋入力欄に候補の表示名「テスト市」が入る）
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByPlaceholderText(PLACE_INPUT).value).toBe('テスト市')

    // 「指定した場所と種別で検索」で、市サイズの範囲（元のBBOXがそのまま検索エリアになる）で施設検索が実行された
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    const bboxStr = [CITY_BBOX.south, CITY_BBOX.west, CITY_BBOX.north, CITY_BBOX.east]
      .map((n) => n.toFixed(6)).join(',')
    expect(overpassCalls[0]).toContain(bboxStr)
    expect(overpassCalls[0]).toContain('amenity=cafe')
    // 一覧タブに切替され、結果が表示される
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('1件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)
})
