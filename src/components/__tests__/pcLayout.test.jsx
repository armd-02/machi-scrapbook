// @vitest-environment jsdom
/**
 * PCレイアウト（>=1024px）テスト
 *
 * 従来のPC専用レイアウト（検索フォーム+地図+結果パネルの3分割、
 * ハンバーガーメニューによる画面切替）は廃止された。
 * PCはモバイルと同じシェル（MobileShell: 下部ナビ3タブ 検索/一覧/その他）を
 * 中央寄せのmax-widthコンテナ内で表示する。
 *
 * 本ファイルが固定する契約:
 * - PCはモバイルと同一のコンポーネント・ロジック（MobileShell）を使う
 * - 中央寄せmax-widthコンテナ（max-w-[520px]）で表示される
 * - ハンバーガーメニュー・旧PC固有要素（検索条件カード・地図切替）は存在しない
 * - 初期表示は一般向けトップ（QuickTop）。地図・検索ボタンは出ない
 * - タイル検索の挙動はモバイルと同一（未設定→ガイダンス、設定済み→検索→カード一覧）
 * - 地図の表示タイミングはモバイルと同一（トップでは非表示・地図モードのみ表示）
 * - 結果はカード式一覧＋施設詳細。詳細→地図の流れも同一
 * - 詳細検索・バリアフリー・CSV一括照合・CSVダウンロードはアクセス可能
 * - matchMedia追従: 幅の切替でコンテナの出現・消滅
 *
 * モバイル側の対応テストは mobileLayout.test.jsx を参照。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import App from '../../App'
import { getMapInstance } from '../../hooks/useMapRef'
import { CATEGORY_GROUPS, getCategoriesForPurpose } from '../../data/categories'

// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return { default: mockState.api }
})

class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }

// ===== テスト用データ（mobileLayout.test.jsx と同一） =====
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

// 東大阪市 bbox（34.56–34.72 / 135.34–135.52）の内側にあるバリアフリー要素。
// 自治体モードは地図の表示範囲ではなく市町村のbboxで検索するため、
// 地図モード用（mock地図の既定範囲 34.8–34.9 / 135.4–135.6）の要素は使えない。
const BF_ELEMENTS_HIGASHIOSAKA = [
  { type: 'way', id: 3003, tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' }, geometry: [ { lat: 34.6, lon: 135.4 }, { lat: 34.61, lon: 135.45 }, { lat: 34.62, lon: 135.5 } ] },
  { type: 'node', id: 3004, lat: 34.65, lon: 135.48, tags: { barrier: 'kerb' } },
]

// ===== フック =====
let mediaMatches = false
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
    // Nominatimジオコード（QuickTopIntroの「検索」検証用）
    if (u.includes('nominatim')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            lat: '34.700000',
            lon: '135.500000',
            display_name: '大阪府大阪市北区梅田1丁目',
            type: 'suburb',
            boundingbox: ['34.69', '34.71', '135.49', '135.51'],
          },
        ],
      }
    }
    if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
      const body = options.body || ''
      const q = new URLSearchParams(body).get('data') || body
      overpassCalls.push(q)
      if (overpassStatus !== 200) {
        return { ok: false, status: overpassStatus, headers: new Map(), json: async () => ({}) }
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
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
}

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver || MockResizeObserver
  mediaMatches = false
  setupMatchMedia()
  setupFetchMock()
  if (mockState.api) mockState.api.resetState()
  overpassCalls.length = 0
  overpassStatus = 200
  overpassElements = OVERPASS_ELEMENTS
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

const IT_TIMEOUT = 15000

// PCのmax-widthコンテナを取得
function getPCWrapper(container) {
  return container.querySelector('.mx-auto')
}

// 下部ナビからタブを操作
function navButtons() {
  return within(screen.getByRole('navigation', { name: 'モバイルナビゲーション' }))
}
function clickTab(label) {
  fireEvent.click(navButtons().getByRole('button', { name: label }))
}
function tabIsCurrent(label) {
  return navButtons().getByRole('button', { name: label }).getAttribute('aria-current') === 'page'
}

// 「くわしく探す」で従来の検索フォーム（目的チップ・検索実行ボタンがあるview）へ切替する
function openFormView() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
}

// フォームビューで「地図から探す」へ切替する
async function switchToMapMode() {
  fireEvent.click(screen.getByRole('tab', { name: '地図から探す' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '＋ 条件を追加（詳細検索）' })).toBeTruthy()
  }, { timeout: 3000 })
}

// 「検索エリアが設定済み」状態を再現する（ジオコードで「梅田」を設定）。
// トップの「検索する」（タイル下）で地名のgeocodeが走り state.bbox が設定される。
// ※この時点では目的タイルが未選択なので「種別を選んでください」の案内も出るが、
//   検索エリア（state.bbox）の設定自体は成功している（後続のタイル検索は通る）
async function setAreaByGeocode() {
  fireEvent.change(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）'), { target: { value: '梅田' } })
  const button = getTopSearchButton()
  fireEvent.click(button)
  await waitFor(() => {
    expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
  }, { timeout: 8000 })
}

// タイル下（「目的から探す」セクション）の「検索する」ボタン。
// 「検索する」はフォームフッターのボタンと同名のため、リージョン内に絞る。
function getTopSearchButton() {
  return within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '検索する' })
}

// labelテキストから対応するselect/inputを取得（モバイルvariantのラベル使用）
function getSelectByLabel(label) {
  const el = screen.getByText(label)
  let node = el
  while (node && node.tagName !== 'DIV') node = node.parentElement
  return node?.querySelector('select')
}
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

// 都道府県→市区町村を選択（テキスト入力＋サジェスト。モバイルvariantラベル）
async function selectMunicipality(prefText, munText) {
  await waitFor(() => {
    expect(screen.getByText('どの県で探す？')).toBeTruthy()
  }, { timeout: 3000 })
  const prefSelect = getSelectByLabel('どの県で探す？')
  expect(prefSelect).toBeTruthy()
  const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === prefText)
  expect(prefOpt).toBeTruthy()
  fireEvent.change(prefSelect, { target: { value: prefOpt.value } })

  const input = await waitFor(() => {
    const i = getInputByLabel('どの市区町村で探す？')
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

// 目的チップ→カテゴリチップ でカテゴリを選択する
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

function renderApp(query = '') {
  window.history.replaceState(null, '', query ? `?${query}` : '/')
  return render(<App />)
}

describe('PCレイアウト（>=1024px）: 中央寄せmax-widthコンテナ内のモバイルシェル', () => {
  it('PC幅: モバイルと同じシェルがmax-w-[520px]の中央寄せコンテナ内に表示される', async () => {
    const view = renderApp()
    const container = view.container

    // 中央寄せmax-widthコンテナ
    const wrapper = getPCWrapper(container)
    expect(wrapper).toBeTruthy()
    expect(wrapper.className).toContain('max-w-[520px]')
    expect(wrapper.className).toContain('mx-auto')
    expect(wrapper.className).toContain('w-full')
    // 周辺は背景色（画面全体を埋める外枠）
    expect(wrapper.parentElement.className).toContain('min-h-dvh')

    // コンテナ内はモバイルと同じシェル（下部ナビ3タブ＋トップ表示）
    const nav = screen.getByRole('navigation', { name: 'モバイルナビゲーション' })
    for (const label of ['検索', '一覧', 'その他']) {
      expect(within(nav).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // 旧PCレイアウト固有の要素は存在しない
    expect(screen.queryByRole('button', { name: 'メニュー' })).toBeNull()
    expect(screen.queryByText('検索条件')).toBeNull()
    expect(screen.queryByRole('button', { name: '地図を隠す' })).toBeNull()
  }, IT_TIMEOUT)

  it('初期表示は一般向けトップ（モバイルと同一）: 地図は出ず、タイル下に「検索する」ボタンがある', async () => {
    renderApp()

    // introと場所指定
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'どこで探すか' })).toBeTruthy()

    // 目的タイル10種が揃って表示される
    for (const label of ['食べる', '買う', '病院・薬局', '役所・手続き', '遊ぶ・公園', '泊まる', '駅・交通', 'トイレ', '学ぶ', 'バリアフリー']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }

    // タイル下（「目的から探す」セクション）に「検索する」ボタンがある
    expect(getTopSearchButton()).toBeTruthy()

    // 従来フォームへの「くわしく探す」導線
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // トップではフォーム固有要素が出ない
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
    // 地名入力欄の右には「検索」ボタンが出ない（検索はタイル下の「検索する」で実行）
    expect(within(screen.getByRole('region', { name: 'どこで探すか' })).queryByRole('button', { name: '検索' })).toBeNull()

    // (#63) トップ画面には地図を描画しない（マウントされたままhidden）
    const mapBlock = screen.queryByTestId('map-block')
    expect(mapBlock).toBeTruthy()
    expect(mapBlock.hasAttribute('hidden')).toBe(true)
  }, IT_TIMEOUT)

  it('matchMedia change: 幅の切替でmax-widthコンテナが出現・消滅する（シェルは共通のまま）', async () => {
    mediaMatches = false
    const view = renderApp()
    const container = view.container

    // PC: 中央寄せコンテナあり
    expect(getPCWrapper(container)).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // モバイル幅へ（1024px未満）: コンテナが消え、シェルがビューポート全体に
    fireMediaChange(true)
    await waitFor(() => {
      expect(getPCWrapper(container)).toBeNull()
    }, { timeout: 3000 })
    // シェル自体は同じコンポーネントがそのまま表示され続ける
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // 元に戻る: コンテナが復帰
    fireMediaChange(false)
    await waitFor(() => {
      expect(getPCWrapper(container)).toBeTruthy()
    }, { timeout: 3000 })
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
  }, IT_TIMEOUT)
})

describe('PC: タイル検索の挙動はモバイルと同一', () => {
  it('検索エリア未設定: タイル選択+「検索する」→ガイダンス表示、クエリは送出されない', async () => {
    renderApp()

    // 場所を何も設定せずにタイルを選択し「検索する」を押す
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    // 検証メッセージがStatusBannerで表示される（モバイルと同一文言）
    await waitFor(() => {
      expect(screen.getByText(/場所がまだ設定されていません/)).toBeTruthy()
    }, { timeout: 3000 })

    // クエリは送出されない
    expect(overpassCalls).toHaveLength(0)
    // 「一覧」タブへ自動切替されず、「検索」タブのまま
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
  }, IT_TIMEOUT)

  it('検索エリア設定済み（ジオコード）: タイル選択+「検索する」→目的unionクエリ、成功で一覧タブへカード一覧', async () => {
    renderApp()
    await setAreaByGeocode()

    // タイルを選択してから「検索する」を押す
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 「食べる」目的グループ: 飲食系カテゴリのunionがクエリに反映される
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('amenity=restaurant')
    // 検索範囲はジオコード結果の範囲（梅田）
    expect(overpassCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')

    // 成功で一覧タブへ自動切替され、カード一覧が表示される
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    // 目的で絞り込まれる（書店=「買う」グループ外は除外）
    expect(screen.getByText(/3件中、\s*2\s*件を表示/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /ラーメン屋テスト/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /テスト書店/ })).toBeNull()
  }, IT_TIMEOUT)
})

describe('PC: 地図の表示タイミングはモバイルと同一', () => {
  it('トップでは非表示→地図モードのみ表示（自治体モードでは非表示のまま）', async () => {
    renderApp()
    const getMapBlock = () => screen.getByTestId('map-block')

    // 初期（トップ表示）: 地図はマウントされたままhidden
    expect(getMapBlock().hasAttribute('hidden')).toBe(true)

    // フォーム表示・自治体モード: 地図は出ない（モバイルと同一）
    openFormView()
    fireEvent.click(screen.getByRole('tab', { name: '自治体から探す' }))
    await waitFor(() => {
      expect(screen.getByText('どの県で探す？')).toBeTruthy()
    }, { timeout: 3000 })
    expect(getMapBlock().hasAttribute('hidden')).toBe(true)

    // フォーム表示・地図モード: 地図が表示される
    await switchToMapMode()
    expect(getMapBlock().hasAttribute('hidden')).toBe(false)
  }, IT_TIMEOUT)

  it('カードタップ→詳細表示→「閉じる」→検索タブの地図へ（モバイルと同一の流れ）', async () => {
    renderApp()

    // フォーム表示→地図モード→カテゴリ=cafeで検索
    openFormView()
    await switchToMapMode()
    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))

    // 一覧タブがアクティブになりカードが表示される
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })

    // 施設カードをタップ（カード内の施設名h3をクリック。onClickはカードdivへ伝播する）
    fireEvent.click(screen.getByRole('heading', { name: /テスト珈琲店/ }))

    // ボトムシート（dialog）が開く: 名称・住所・OSMリンク・タグ
    const dialog = await waitFor(() => {
      const d = screen.queryByRole('dialog', { name: /施設詳細: テスト珈琲店/ })
      expect(d).toBeTruthy()
      return d
    }, { timeout: 3000 })
    expect(within(dialog).getByText(/大阪市 梅田 1-1/)).toBeTruthy()
    expect(within(dialog).getByText(/OSMで見る（node\/1001）/)).toBeTruthy()
    expect(within(dialog).getByText('cafe')).toBeTruthy()

    // 「閉じる」でシートが閉じられる
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, { timeout: 3000 })

    // 下部ナビから検索タブ（地図モード）へ切替。状態は保持されるため地図が表示される
    clickTab('検索')
    await waitFor(() => {
      expect(screen.getByTestId('map-block').hasAttribute('hidden')).toBe(false)
    }, { timeout: 3000 })

    // マーカータップ: シートが再オープンし、activeResultId経由で地図が施設（テスト珈琲店 34.85,135.5）へパンする
    const map = getMapInstance()
    const feature2 = map._lastGeoJSON?.data?.features?.find((f) => f.properties.key === 'node/1001')
    expect(feature2).toBeTruthy()
    act(() => {
      map.fire('click', 'point-circle', {
        features: [feature2],
        lngLat: { lat: feature2.geometry.coordinates[1], lng: feature2.geometry.coordinates[0] }
      })
    })
    const dialog2 = await waitFor(() => {
      const d = screen.queryByRole('dialog')
      expect(d).toBeTruthy()
      return d
    }, { timeout: 3000 })
    await waitFor(() => {
      expect(map._calls.some((c) => c.name === 'panTo' && Array.isArray(c.args[0]) && c.args[0][0] === 135.5 && c.args[0][1] === 34.85)).toBe(true)
    }, { timeout: 3000 })

    // 「閉じる」でシートが閉じられ、検索タブは維持される
    fireEvent.click(within(dialog2).getByRole('button', { name: '閉じる' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, { timeout: 3000 })
    expect(tabIsCurrent('検索')).toBe(true)
  }, IT_TIMEOUT)
})

describe('PC: 自治体モード検索（モバイルと同一）', () => {
  it('「自治体から探す」→市区町村選択→検索: 自治体BBOXのPOIクエリが送出される', async () => {
    renderApp()

    openFormView()
    fireEvent.click(screen.getByRole('tab', { name: '自治体から探す' }))

    // 大阪府→大阪市（都府県レベル）を選択
    await selectMunicipality('大阪府', '大阪市（都府県）')

    // 検索（カテゴリ未選択=POI検索）
    fireEvent.click(screen.getByRole('button', { name: '検索する' }))

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
    expect(tabIsCurrent('一覧')).toBe(true)
  }, IT_TIMEOUT)
})

describe('PC: バリアフリー検索（モバイルと同一）', () => {
  it('自治体モード: バリアフリー検索成功 → 「一覧」タブへ切替され、BFカード・凡例が表示される', async () => {
    renderApp()
    overpassElements = BF_ELEMENTS_HIGASHIOSAKA

    openFormView()
    fireEvent.click(screen.getByRole('tab', { name: '自治体から探す' }))
    await selectMunicipality('大阪府', '東大阪市')

    // 目的チップ「バリアフリー」（MunicipalitySearch内のCategoryPicker）
    fireEvent.click(screen.getByRole('button', { name: 'バリアフリー' }))
    fireEvent.click(screen.getByRole('button', { name: '検索する' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('footway')

    await waitFor(() => {
      expect(screen.getByText('2件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })

    // 成功時は「一覧」タブへ切替される
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(tabIsCurrent('検索')).toBe(false)

    // 一覧タブにBFカード（名称・表示名）・件数表示が表示される
    expect(screen.getByText('中央通り歩道')).toBeTruthy()
    expect(screen.getByText('縁石（未記録）')).toBeTruthy()
    expect(screen.getByText('2件中、2件を表示')).toBeTruthy()

    // 凡例が表示される（自治体モードでは一覧タブ側のみ。モバイルと同一）
    expect(screen.getAllByText('凡例').length).toBeGreaterThanOrEqual(1)

    // 検索タブに戻ってもソースは「自治体から探す」のまま（searchSourceが地図へ変遷しない）
    clickTab('検索')
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByRole('tab', { name: '自治体から探す' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: '検索する' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
  }, IT_TIMEOUT)
})

describe('PC: 「その他」タブ（CSV一括照合・集計・出力・説明）', () => {
  it('店名→座標CSV: 一括照合画面（textarea・CSV取込・照合実行）が表示される', async () => {
    renderApp()

    clickTab('その他')
    fireEvent.click(screen.getByRole('tab', { name: '店名→座標' }))

    // MobileBatchMatchの主要UI
    expect(await screen.findByRole('button', { name: '照合実行' })).toBeTruthy()
    // CSV取込はラベル（中身のfile inputはhidden）なので、テキストで取得する
    expect(screen.getByText(/CSV取込/)).toBeTruthy()
    expect(screen.getByPlaceholderText(/施設名を1行に1件入力/)).toBeTruthy()
  }, IT_TIMEOUT)

  it('集計・出力: 検索結果があるときStatisticsPanelとCSVダウンロードボタンが表示される', async () => {
    renderApp()

    // まず地図モードで検索して結果を作る
    openFormView()
    await switchToMapMode()
    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })

    // 「その他」タブ→集計・出力
    clickTab('その他')
    fireEvent.click(screen.getByRole('tab', { name: '集計・出力' }))

    // StatisticsPanelのセクションタブ
    expect(await screen.findByRole('button', { name: 'カテゴリ別' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'タグ別' })).toBeTruthy()

    // ExportBar: CSVダウンロードボタン
    expect(screen.getByRole('button', { name: /一覧を保存（CSV）/ })).toBeTruthy()
  }, IT_TIMEOUT)

  it('使い方: AboutPanelが表示される（セクションタブ・概要）', async () => {
    renderApp()

    clickTab('その他')
    fireEvent.click(screen.getByRole('tab', { name: '使い方' }))

    // AboutPanelのセクションタブ
    expect(await screen.findByRole('button', { name: 'データ品質' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '出典・ライセンス' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'API制約' })).toBeTruthy()

    // 概要セクションの内容
    expect(screen.getByText('まちデータ帳とは')).toBeTruthy()
  }, IT_TIMEOUT)
})
