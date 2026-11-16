// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import App from '../../../App'
import { getMapInstance } from '../../../hooks/useMapRef'
import { clearCache } from '../../../utils/overpass'
import { CATEGORY_GROUPS, getCategoriesForPurpose } from '../../../data/categories'

// (#59) モバイルレイアウト E2E テスト
//
// - ビューポート幅による PC/モバイル レイアウト切替（matchMedia スタブで制御）
// - モバイル3タブ（検索/一覧/その他）の遷移と状態保持（#60: 地図は検索タブ内に内蔵）
// - 検索タブ内の地図モード検索 → クエリに地図BBOXが反映される
// - 検索成功時の「一覧」タブ自動切替
// - 検索タブの「この表示範囲で検索」明示トリガー（地図移動だけでは検索しない）
// - 施設カードタップ → 詳細ボトムシート → 「閉じる」→ 地図タブ → マーカータップで再オープン
// - マーカータップ → 詳細ボトムシート
// - 自治体モード検索
// - (#66) 初期検索ソースがmunicipalityになったため、地図モード検証テストは
//   フォームビューで「地図から探す」へ明示切替してから操作する
// - エラー時: バannerがタブ切替をまたいで表示される
//
// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
// vi.mockファクトリはファイル先頭にホイスされるため、共通モックは動的importで参照。
// マップインスタンスの操作は mockState.api._state.maps から取得できる。
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
    // (#63) Nominatimジオコード（QuickTopIntroの「検索」・地名入力サジェスト・
    // 複数候補提示の検証用）。テスト側が nominatimRows を切り替えられる
    if (u.includes('nominatim')) {
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

// ヘッダーのタイトルボタン（アプリアイコン＋「まちデータ帳」。押下でトップ画面に戻る）
function getHeaderButton() {
  return screen.getByRole('button', { name: 'トップ画面に戻る' })
}

// (#63) 検索タブの初期表示は一般向けトップ（QuickTop）。
// 「くわしく探す」で従来の検索フォーム（目的チップ・検索実行ボタンがあるview）へ切替する
function openFormView() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
}

// (#66) 初期検索ソースが自治体（municipality）になったため、地図モードの挙動を
// 検証するテストではフォームビューで「地図から探す」へ明示切替してから操作する。
async function switchToMapMode() {
  fireEvent.click(screen.getByRole('tab', { name: '地図から探す' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '＋ 条件を追加（詳細検索）' })).toBeTruthy()
  }, { timeout: 3000 })
}

// (#63) 「検索エリアが設定済み」状態をテスト上で再現する: 地名を入力して
// タイル下の「検索する」を押す（fetchモックが「梅田」のNominatim結果を返す →
// 検索エリアに設定される）。成功フィードバックの表示を待って返す。
// この時点ではタイル未選択なので「種別を選んでください」の案内も同時に現れる。
// 後続でタイル選択+「検索する」で実際に検索するテストがこれを利用する。
// （トップ画面には地図を描画しないため、旧「ユーザーが地図を動かした」の
// 再現方法はなくなった。検索エリアはジオコードまたは自治体選択で設定される。）
async function setAreaByGeocode() {
  fireEvent.change(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）'), { target: { value: '梅田' } })
  fireEvent.click(getTopSearchButton())
  await waitFor(() => {
    expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
  }, { timeout: 8000 })
}

// (#63) タイル下の「検索する」ボタン。「目的から探す」セクション内にスコープする:
// 下部ナビの「検索」タブや「都道府県から探す」セクションの「検索する」と同名のため。
// タイルタップは選択のみのため、施設検索はこのボタン（または場所入力でEnter）で実行される。
function getTopSearchButton() {
  return within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '検索する' })
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

  it('幅>=1024px: モバイルと同じシェルが中央寄せmax-widthコンテナ内で表示される（PC・モバイル共通レイアウト）', async () => {
    mediaMatches = false
    window.history.replaceState(null, '', '/')
    const view = render(<App />)
    const container = view.container

    // 中央寄せmax-widthコンテナ（max-w-[520px]）
    const wrapper = container.querySelector('.mx-auto')
    expect(wrapper).toBeTruthy()
    expect(wrapper.className).toContain('max-w-[520px]')

    // コンテナ内はモバイルと同じシェル: 下部ナビ3タブ＋一般向けトップ表示
    const nav = screen.getByRole('navigation', { name: 'モバイルナビゲーション' })
    for (const label of ['検索', '一覧', 'その他']) {
      expect(within(nav).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // (#63) トップ画面には地図を描画しない（マウントされたままhidden）
    const mapBlock = screen.queryByTestId('map-block')
    expect(mapBlock).toBeTruthy()
    expect(mapBlock.hasAttribute('hidden')).toBe(true)

    // 旧PCレイアウト固有の要素（ハンバーガーメニュー・地図切替）は存在しない
    expect(screen.queryByRole('button', { name: 'メニュー' })).toBeNull()
    expect(screen.queryByText('地図を隠す')).toBeNull()
  }, IT_TIMEOUT)

  it('matchMedia change でレイアウトが追従する（回転・キーボード表示に対応）: コンテナの出現・消滅', async () => {
    mediaMatches = false
    window.history.replaceState(null, '', '/')
    const view = render(<App />)
    const container = view.container

    // PC幅: 中央寄せコンテナ＋モバイルシェル
    expect(container.querySelector('.mx-auto')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // 横画面へ回転（幅が1024px未満になる）→ モバイル: コンテナが消え、シェルがビューポート全体に
    fireMediaChange(true)
    await waitFor(() => {
      expect(container.querySelector('.mx-auto')).toBeNull()
    }, { timeout: 3000 })
    // シェル自体は同じコンポーネントがそのまま表示され続ける
    // (#63) 検索タブの初期表示は一般向けトップ: トップ固有要素を確認
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // 元に戻る → PC: コンテナが復帰
    fireMediaChange(false)
    await waitFor(() => {
      expect(container.querySelector('.mx-auto')).toBeTruthy()
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
    const title = screen.getByText('まちデータ帳')
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
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // 従来フォームの要素は消える（view='top' でアンマウントされる）
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
  }, IT_TIMEOUT)

  it('従来フォーム表示からボタンを押すとトップ画面に戻る（searchViewが「top」に切替）', async () => {
    renderApp()

    // トップ → 従来フォーム
    openFormView()
    expect(screen.getByRole('tab', { name: '自治体から探す' })).toBeTruthy()
    expect(screen.queryByText('近くの施設を、みんなの地図で探す')).toBeNull()

    // ヘッダーのタイトルボタンを押す
    fireEvent.click(getHeaderButton())

    // トップ画面の要素が戻り、フォームの要素は消える
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
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
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
  }, IT_TIMEOUT)

  it('詳細シートが開いている状態でボタンを押すと: シートが閉じてトップ画面に戻る', async () => {
    renderApp()

    // 従来フォーム→地図モードで検索し、一覧タブのカードをタップして詳細シートを開く
    openFormView()
    await switchToMapMode()
    selectCategoryChip('カフェ')
    fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))
    await waitFor(() => {
      expect(tabIsCurrent('一覧')).toBe(true)
    }, { timeout: 8000 })
    fireEvent.click(screen.getByRole('heading', { name: /テスト珈琲店/ }))
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
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
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

describe('(#59) 一覧タブ: 結果マップのマーカータップ→詳細シート（修正）', () => {
  it('一覧タブの結果マップでマーカーをタップすると施設詳細ボトムシートが開き、「閉じる」で一覧タブに戻る', async () => {
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

    // マーカー（テスト珈琲店 node/1001）をタップ → pointレイヤのclickイベントを発火
    const map = getResultsMap()
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/1001')
    expect(feature).toBeTruthy()
    act(() => {
      map.fire('click', 'point-circle', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    // 施設詳細ボトムシートが開く
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /施設詳細: テスト珈琲店/ })).toBeTruthy()
    }, { timeout: 3000 })

    // 「閉じる」でシートが閉じられ、一覧タブの表示が維持される（MobileShellの既存仕組み）
    const dialog = screen.getByRole('dialog', { name: /施設詳細: テスト珈琲店/ })
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, { timeout: 3000 })
    expect(tabIsCurrent('一覧')).toBe(true)
  }, IT_TIMEOUT)
})

describe('(#59) 施設カード→詳細ボトムシート→地図', () => {
  it('カードタップ→詳細表示→「閉じる」→地図へ→マーカータップで再オープン', async () => {
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

    // 施設カードをタップ（カード内の施設名h3をクリック。onClickはカードdivへ伝播する）
    fireEvent.click(screen.getByRole('heading', { name: /テスト珈琲店/ }))

    // ボトムシート（dialog）が開く: 名称・住所・カテゴリチップ・OSMリンク
    const dialog = await waitFor(() => {
      const d = screen.queryByRole('dialog', { name: /施設詳細: テスト珈琲店/ })
      expect(d).toBeTruthy()
      return d
    }, { timeout: 3000 })
    expect(within(dialog).getByText(/大阪市 梅田 1-1/)).toBeTruthy()
    expect(within(dialog).getByText(/OSMで見る（node\/1001）/)).toBeTruthy()
    // カテゴリチップ（amenity=cafe → カフェ。タグ一覧は廃止されたため生値は出ない）
    expect(within(dialog).getByText('カフェ')).toBeTruthy()
    // (#61) バリアフリー情報: 車椅子対応バッジ + :ja説明
    expect(within(dialog).getByText(/バリアフリー情報/)).toBeTruthy()
    expect(within(dialog).getByText('車椅子対応')).toBeTruthy()
    // 説明はバリアフリーセクションのnoteに出る（タグ一覧廃止で1箇所のみ）
    expect(within(dialog).getAllByText('段差なし')).toHaveLength(1)

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
      // MapLibreのpanToは[経度, 緯度]順
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
    const nameInput = screen.getByLabelText('施設名で絞り込む')
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
  it('「自治体から探す」→市区町村選択→検索: 自治体BBOXのPOIクエリが送出される', async () => {
    renderApp()

    // (#63) ソース切替タブは従来フォーム側。まずフォームへ
    openFormView()

    // ソース切替（検索タブ内のタブボタン）
    fireEvent.click(screen.getByRole('tab', { name: '自治体から探す' }))

    // 大阪府→大阪市（都府県レベル）を選択（モバイルラベル）
    await selectMunicipality('大阪府', '大阪市（都府県）', 'どの県で探す？', 'どの市区町村で探す？')

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
    const kerbCard = screen.getByText('node/3002').closest('.shadow-sm')
    expect(within(kerbCard).getAllByText('縁石')).toHaveLength(2)
    expect(within(kerbCard).queryByText('縁石（未記録）')).toBeNull()
    expect(screen.getByText('2件中、2件を表示')).toBeTruthy()

    // 検索タブ・一覧タブの両方で凡例が描画される（hiddenタブはDOMに残る）
    expect(screen.getAllByText('凡例')).toHaveLength(2)
  }, IT_TIMEOUT)

  it('自治体モード: バリアフリー検索成功 → 「一覧」タブへ切替され、searchSourceは自治体モードのまま', async () => {
    renderApp()
    overpassElements = BF_ELEMENTS_HIGASHIOSAKA

    // (#63) 初期表示は一般向けトップ。ソース切替タブは従来フォーム側
    openFormView()

    // 「自治体から探す」へ切替（searchSource='municipality'）
    fireEvent.click(screen.getByRole('tab', { name: '自治体から探す' }))
    await selectMunicipality('大阪府', '東大阪市', 'どの県で探す？', 'どの市区町村で探す？')

    // 目的チップ「バリアフリー」でバリアフリー検索に
    fireEvent.click(screen.getByRole('button', { name: 'バリアフリー' }))
    fireEvent.click(screen.getByRole('button', { name: '検索する' }))

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
    const kerbCard = screen.getByText('node/3004').closest('.shadow-sm')
    expect(within(kerbCard).getAllByText('縁石')).toHaveLength(2)
    expect(within(kerbCard).queryByText('縁石（未記録）')).toBeNull()
    expect(screen.getByText('2件中、2件を表示')).toBeTruthy()

    // 検索タブに戻ってもソースは「自治体から探す」のまま（searchSourceが地図へ変遷しない）
    clickTab('検索')
    expect(tabIsCurrent('検索')).toBe(true)
    expect(screen.getByRole('tab', { name: '自治体から探す' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: '検索する' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
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
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'どこで探すか' })).toBeTruthy()

    // 目的タイル10種が揃って表示される
    for (const label of ['食べる', '買う', '病院・薬局', '役所・手続き', '遊ぶ・公園', '泊まる', '駅・交通', 'トイレ', '学ぶ', 'バリアフリー']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }

    // 従来フォームへの「くわしく探す」導線
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // タイル下の「検索する」ボタン（施設検索の実行入口）が表示される
    expect(getTopSearchButton()).toBeTruthy()
    // 場所入力欄の右にあった旧「検索」ボタンはなくなった（検索は「検索する」で実行）
    expect(within(screen.getByRole('region', { name: 'どこで探すか' })).queryByRole('button')).toBeNull()

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

  it('検索エリアが大きすぎる場合のタイル検索: 壊れたcriteriaをsearch()に渡さず検証エラーを表示（「接続エラー」ラベルなし）', async () => {
    renderApp()

    // ジオコード結果のboundingboxが巨大（約230万km²、40000km²の閾値超）になるよう
    // fetchモックを上書きする（searchAreaFromGeocodeは面積が1km²以上ならそのまま使う）
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const u = String(url)
      if (u.includes('nominatim')) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => [
            { lat: '38.0', lon: '137.5', display_name: '日本', type: 'country', boundingbox: ['31', '45', '129', '146'] },
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

    // 地名を入力して「検索する」を押す（巨大bboxが検索エリアに設定される。
    // タイル未選択のため同時に「種別を選んでください」の案内が出る）
    fireEvent.change(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）'), { target: { value: '梅田' } })
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
    }, { timeout: 8000 })

    // タイルを選択してから「検索する」を押す（検索が実行されcriteria検証が走る）
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())

    // criteria自身のmessage（「検索範囲が広すぎます」）が検証エラーとして表示される
    await waitFor(() => {
      expect(screen.getByText(/検索範囲が広すぎます/)).toBeTruthy()
    }, { timeout: 8000 })

    // 壊れたcriteriaをsearch()に渡さない: Overpassクエリは送出されない
    expect(overpassCalls).toHaveLength(0)

    // 検証エラーは通信エラーではない: 「接続エラー」ラベルが付かない
    expect(screen.queryByText(/接続エラー/)).toBeNull()

    // 一覧タブへ自動切替されず、「検索」タブのまま
    expect(tabIsCurrent('検索')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
  }, IT_TIMEOUT)

  it('目的タイル（食べる）: 目的グループの施設種類unionで検索が実行され、成功で一覧タブへ切替', async () => {
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
    overpassElements = MEDICAL_ELEMENTS
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
    const kerbCard = screen.getByText('node/3006').closest('.shadow-sm')
    expect(within(kerbCard).getAllByText('縁石')).toHaveLength(2)
    expect(within(kerbCard).queryByText('縁石（未記録）')).toBeNull()
  }, IT_TIMEOUT)

  it('単一カテゴリタイル（トイレ）: そのカテゴリで検索が実行される', async () => {
    renderApp()
    // (#63) タイル選択前に検索エリアを設定（ジオコード）する
    await setAreaByGeocode()

    // タイルを選択して「検索する」で検索を実行
    fireEvent.click(screen.getByRole('button', { name: 'トイレ' }))
    fireEvent.click(getTopSearchButton())

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 単一カテゴリタイル: カテゴリのタグ条件（amenity=toilets）で検索エリアを検索
    expect(overpassCalls[0]).toContain('amenity=toilets')
    expect(overpassCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')
  }, IT_TIMEOUT)

  it('「くわしく探す」で従来フォームへ移り、「トップへ戻る」でトップへ戻れる（地図インスタンスは保持）', async () => {
    renderApp()

    const mapBefore = getMapInstance()
    expect(mapBefore).toBeTruthy()

    // トップ → 従来フォーム
    fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
    // (#66) 初期ソースが自治体のため、地図モードのフォーム要素を検証するには切替が必要
    await switchToMapMode()
    // フォーム要素が表示される（ソース切替・エリアカード・キーワード入力・フッターの検索ボタン）
    expect(screen.getByRole('tab', { name: '地図から探す' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '自治体から探す' })).toBeTruthy()
    expect(screen.getByText('どの街・エリアで探す？')).toBeTruthy()
    expect(screen.getByPlaceholderText('例: 珈琲、ラーメン')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()
    // トップ固有要素が消える
    expect(screen.queryByText('近くの施設を、みんなの地図で探す')).toBeNull()
    expect(screen.queryByRole('button', { name: /くわしく探す/ })).toBeNull()

    // 従来フォーム → トップ
    fireEvent.click(screen.getByRole('button', { name: /トップへ戻る/ }))
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()

    // 切替で地図が再マウントされていない（単一インスタンス。位置・表示範囲が引き継がれる）
    expect(getMapInstance()).toBe(mapBefore)
  }, IT_TIMEOUT)
})

describe('(place) 検索エリア未設定ガード（state.bbox）: 「検索する」の制御', () => {
  it('開いた直後（検索エリア未設定）でタイル選択+「検索する」: 検索は実行されず（Overpass問い合わせなし）検証メッセージが表示される', async () => {
    renderApp()

    // 検索エリアの設定（地名のgeocode・自治体選択）を何もしないまま
    // タイルを選択して「検索する」を押す
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

    // ガイダンス文言（地名の「検索する」または自治体選択の案内）も表示される
    expect(screen.getByText(/「都道府県から探す」で自治体を選択してください/)).toBeTruthy()

    // (改行) 案内メッセージは文の区切りで改行され、3行で表示される。
    // 表示側は whitespace-pre-line により改行を保持する（文の途中で折り返さない）
    const banner = screen.getByText(/場所がまだ設定されていません/)
    const lines = banner.textContent.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('⚠️ 場所がまだ設定されていません。')
    expect(lines[1]).toBe('地名・駅名を入力して「検索する」を押すか、')
    expect(lines[2]).toBe('「都道府県から探す」で自治体を選択してください。')
    expect(banner.className).toContain('whitespace-pre-line')
  }, IT_TIMEOUT)

  it('自治体選択（トップの「都道府県から探す」）の後、タイルでその自治体の範囲で検索が実行される', async () => {
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

  it('地名入力で「検索する」（geocode）の後、タイル選択+「検索する」でその範囲で検索が実行される', async () => {
    renderApp()

    // 地名を入力して「検索する」を押す（fetchモックがNominatim結果を返す → 検索エリア設定）
    // この時点ではタイル未選択なので「種別を選んでください」の案内も出る
    fireEvent.change(screen.getByPlaceholderText('地名・駅名（例: 大阪駅）'), { target: { value: '梅田' } })
    fireEvent.click(getTopSearchButton())

    // 検索エリア設定の成功フィードバックが表示される
    await waitFor(() => {
      expect(screen.getByText(/検索エリアに「.*」を設定しました/)).toBeTruthy()
    }, { timeout: 8000 })

    // タイルを選択してから「検索する」を押す
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
    // 入力値は残る（決まった場所が欄内に緑で見える）
    expect(input.value).toBe('梅田')
    // 既存の成功フィードバック文はそのまま残る
    expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
  }, IT_TIMEOUT)

  it('成功後に場所入力欄を編集すると: 緑が解除され検索エリアは未設定に戻り、「検索する」で未設定ガード（案内メッセージ）が出る', async () => {
    renderApp()
    await setAreaByGeocode()

    // 入力内容を編集（編集すると緑と検索エリアが解除される）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '奈良' } })

    const input = screen.getByPlaceholderText(PLACE_INPUT)
    // 緑が解除される
    expect(input.className).not.toContain('border-green-500')
    expect(input.className).not.toContain('bg-green-50')
    // 成功フィードバックも消える（食い違う状態にならない）
    expect(screen.queryByText(/検索エリアに.*を設定しました/)).toBeNull()

    // 入力を空に戻す（= 入力が空で検索エリアも未設定）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '' } })

    // 検索エリアが未設定に戻った: タイル選択+「検索する」で未設定ガードが再び働く
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
    // Nominatimが空配列を返す（結果なし → 「場所が見つかりませんでした」）
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const u = String(url)
      if (u.includes('nominatim')) {
        return { ok: true, status: 200, headers: new Map(), json: async () => [] }
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
    renderApp()

    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: 'zzz見つからない' } })
    fireEvent.click(getTopSearchButton())

    // エラーが表示される
    await waitFor(() => {
      expect(screen.getByText(/場所が見つかりませんでした/)).toBeTruthy()
    }, { timeout: 8000 })

    const input = screen.getByPlaceholderText(PLACE_INPUT)
    // 緑にならない
    expect(input.className).not.toContain('border-green-500')
    expect(input.className).not.toContain('bg-green-50')
    // 成功フィードバックは出ない
    expect(screen.queryByText(/検索エリアに.*を設定しました/)).toBeNull()
    // 検索エリアも設定されていない: タイル選択+「検索する」で検索は実行されず、
    // geocodeエラー（場所が見つかりませんでした）が表示され続ける
    fireEvent.click(within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/場所が見つかりませんでした/)).toBeTruthy()
    }, { timeout: 8000 })
    expect(screen.queryByText(/場所がまだ設定されていません/)).toBeNull()
    expect(overpassCalls).toHaveLength(0)
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
describe('(place) 地名入力のサジェストと複数候補の提示', () => {
  // サジェストリスト（role=listbox）内の指定ラベルの候補を待って返す
  async function waitForSuggestOption(optionName, { timeout = 8000 } = {}) {
    return waitFor(() => {
      const lb = screen.getByRole('listbox')
      const opt = within(lb).queryByRole('option', { name: optionName })
      expect(opt).toBeTruthy()
      return opt
    }, { timeout })
  }

  it('2文字以上の入力でデバウンス後にサジェスト候補が表示される（ラベルは「名称（都道府県市区町村）」）', async () => {
    renderApp()
    const input = screen.getByPlaceholderText(PLACE_INPUT)

    // 1文字: サジェストなし（2文字以上が必要）
    fireEvent.change(input, { target: { value: '上' } })
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.queryByRole('listbox')).toBeNull()

    // 2文字以上: デバウンス（400ms）+ リクエスト後にリストが表示される
    fireEvent.change(input, { target: { value: '梅田' } })
    // デバウンスが切れる前は出ない
    expect(screen.queryByRole('listbox')).toBeNull()
    const opt = await waitForSuggestOption('梅田（大阪府大阪市）')
    expect(opt).toBeTruthy()
  }, IT_TIMEOUT)

  it('サジェスト候補タップで検索エリアが設定される（入力欄が緑＋フィードバック、施設検索は実行されない）', async () => {
    renderApp()
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '梅田' } })
    await waitForSuggestOption('梅田（大阪府大阪市）')
    fireEvent.click(screen.getByRole('option', { name: '梅田（大阪府大阪市）' }))

    // エリア設定: 入力欄が緑＋成功フィードバック（「地名が見つかった」ときと同じ流れ）
    await waitFor(() => {
      const input = screen.getByPlaceholderText(PLACE_INPUT)
      expect(input.className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
    // リストは閉じる
    expect(screen.queryByRole('listbox')).toBeNull()
    // 施設検索はまだ実行されていない
    expect(overpassCalls).toHaveLength(0)
    expect(tabIsCurrent('一覧')).toBe(false)

    // タイル選択+「検索する」→ 設定済み範囲で検索が実行される
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('34.690000,135.490000,34.710000,135.510000')
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
  }, IT_TIMEOUT)

  it('候補が複数（2件以上）だと「検索する」は候補リスト＋「候補が複数あります。選んでください。」を表示し、施設検索は実行されない', async () => {
    nominatimRows = [KAGOSHI_UEMACHI_ROW, OSAKA_UEMACHI_ROW]
    renderApp()
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '上本町' } })

    // サジェストで両候補が表示される
    await waitFor(() => {
      expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2)
    }, { timeout: 8000 })

    // 「検索する」: 1件目を勝手に選ばず、複数候補の提示にする
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/候補が複数あります/)).toBeTruthy()
    }, { timeout: 8000 })
    const lb = screen.getByRole('listbox')
    expect(within(lb).getByRole('option', { name: '上本町（鹿児島県鹿児島市）' })).toBeTruthy()
    expect(within(lb).getByRole('option', { name: '上本町（大阪府大阪市）' })).toBeTruthy()

    // エリアは設定されていない（緑もフィードバックも出ない）
    const input = screen.getByPlaceholderText(PLACE_INPUT)
    expect(input.className).not.toContain('border-green-500')
    expect(screen.queryByText(/検索エリアに.*を設定しました/)).toBeNull()
    // 施設検索は実行されていない（トップ画面のまま）
    expect(overpassCalls).toHaveLength(0)
    expect(tabIsCurrent('一覧')).toBe(false)
    expect(tabIsCurrent('検索')).toBe(true)
  }, IT_TIMEOUT)

  it('複数候補から候補を選ぶとエリアが設定され、再度「検索する」でその範囲の検索が実行される', async () => {
    nominatimRows = [KAGOSHI_UEMACHI_ROW, OSAKA_UEMACHI_ROW]
    renderApp()
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '上本町' } })

    // 「検索する」→ 複数候補の提示 → 鹿児島市側の候補をタップ
    fireEvent.click(getTopSearchButton())
    await waitFor(() => {
      expect(screen.getByText(/候補が複数あります/)).toBeTruthy()
    }, { timeout: 8000 })
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '上本町（鹿児島県鹿児島市）' }))

    // エリアが設定される（緑＋フィードバック）。まだ検索は実行されない
    await waitFor(() => {
      expect(screen.getByText(/検索エリアに.*を設定しました/)).toBeTruthy()
    }, { timeout: 8000 })
    expect(overpassCalls).toHaveLength(0)
    // リストは閉じる
    expect(screen.queryByRole('listbox')).toBeNull()

    // タイル選択+「検索する」→ 選んだ候補の範囲で検索が実行される
    // （同じ地名の geocode が再実行されず、複数候補の提示がループしない）
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('31.580000,130.680000,31.600000,130.710000')
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
  }, IT_TIMEOUT)
})
