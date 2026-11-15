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
// - 施設カードタップ → 詳細ボトムシート → 「地図で見る」
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

  it('幅>=1024px: 現行のPCレイアウトのまま（モバイルナビなし）', async () => {
    mediaMatches = false
    renderApp()

    // 廃止された上部タブバーは存在しない（nav要素がPCレイアウトに無い）
    expect(screen.queryByRole('navigation')).toBeNull()

    // タイトル行右端: ハンバーガーメニューボタン（旧タブバーの代替）
    const menuBtn = screen.getByRole('button', { name: 'メニュー' })
    expect(menuBtn).toBeTruthy()
    // デフォルト画面は施設検索で、画面の中身は既存構成のまま（地図切替ボタン等）
    expect(screen.getByText('地図を隠す')).toBeTruthy()

    // メニューからの画面切替（新仕様: PCでもタイトル行右端のハンバーガーメニューで切替）
    fireEvent.click(menuBtn)
    // メニューを開くと、3つの画面項目+フッター項目が揃って表示される
    const menu = await screen.findByRole('menu', { name: 'メニュー' })
    for (const label of ['施設検索', '店名→座標CSV', '集計・出力', 'まちデータ帳とは']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeTruthy()
    }
    // 「店名→座標CSV」を選択して切替
    fireEvent.click(within(menu).getByRole('menuitem', { name: '店名→座標CSV' }))
    // 店名→座標CSV画面（BatchMatch）に切り替わり、メニューは閉じる
    await screen.findByRole('button', { name: '照合' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })

    // モバイル下部ナビは存在しない
    expect(screen.queryByRole('navigation', { name: 'モバイルナビゲーション' })).toBeNull()
  }, IT_TIMEOUT)

  it('matchMedia change でレイアウトが追従する（回転・キーボード表示に対応）', async () => {
    mediaMatches = false
    renderApp()
    // PCレイアウト: タイトル行右端のハンバーガーメニューボタン + 施設検索画面（地図切替）
    expect(screen.getByRole('button', { name: 'メニュー' })).toBeTruthy()
    expect(screen.getByText('地図を隠す')).toBeTruthy()

    // 横画面へ回転（幅が1024px未満になる）→ モバイルシェル
    fireMediaChange(true)
    // 下部ナビが出現し、モバイルの検索タブが表示される
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()
    }, { timeout: 3000 })
    // (#63) 検索タブの初期表示は一般向けトップ: トップ固有要素（intro・「くわしく探す」）を確認
    expect(screen.getByText('近くの施設を、みんなの地図で探す')).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
    // PC固有の要素（メニューボタン・地図切替）は消える
    expect(screen.queryByRole('button', { name: 'メニュー' })).toBeNull()
    expect(screen.queryByText('地図を隠す')).toBeNull()

    // 元に戻る → PCレイアウト
    fireMediaChange(false)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'メニュー' })).toBeTruthy()
    }, { timeout: 3000 })
    // 施設検索画面が復帰し、モバイル下部ナビは消える
    expect(screen.getByText('地図を隠す')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'モバイルナビゲーション' })).toBeNull()
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
    expect(screen.getByRole('button', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ラーメン屋テスト/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /テスト書店/ })).toBeNull()
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

describe('(#59) 施設カード→詳細ボトムシート→地図で見る', () => {
  it('カードタップ→詳細表示→「地図で見る」で地図タブに移動する', async () => {
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

    // 施設カードをタップ
    fireEvent.click(screen.getByRole('button', { name: /テスト珈琲店/ }))

    // ボトムシート（dialog）が開く: 名称・住所・OSMリンク・タグ
    const dialog = await waitFor(() => {
      const d = screen.queryByRole('dialog', { name: /施設詳細: テスト珈琲店/ })
      expect(d).toBeTruthy()
      return d
    }, { timeout: 3000 })
    expect(within(dialog).getByText(/大阪市 梅田 1-1/)).toBeTruthy()
    expect(within(dialog).getByText(/OSMで見る（node\/1001）/)).toBeTruthy()
    expect(within(dialog).getByText('cafe')).toBeTruthy()
    // (#61) バリアフリー情報: 車椅子対応バッジ + :ja説明
    expect(within(dialog).getByText(/バリアフリー情報/)).toBeTruthy()
    expect(within(dialog).getByText('車椅子対応')).toBeTruthy()
    // 説明はnoteとタグ一覧の両方に出る（≥1）
    expect(within(dialog).getAllByText('段差なし').length).toBeGreaterThanOrEqual(1)

    // 「地図で見る」: シートが閉じられ検索タブ（地図モード）へ移動
    fireEvent.click(within(dialog).getByRole('button', { name: '地図で見る' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, { timeout: 3000 })
    expect(tabIsCurrent('検索')).toBe(true)

    // (#60) activeResultId経由で地図が施設（テスト珈琲店 34.85,135.5）へパンする
    const map0 = getMapInstance()
    await waitFor(() => {
      // MapLibreのpanToは[経度, 緯度]順
      expect(map0._calls.some((c) => c.name === 'panTo' && Array.isArray(c.args[0]) && c.args[0][0] === 135.5 && c.args[0][1] === 34.85)).toBe(true)
    }, { timeout: 3000 })

    // 「閉じる」でシートが閉じられる（再オープンして確認）
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
    fireEvent.click(within(dialog2).getByRole('button', { name: '閉じる' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, { timeout: 3000 })
    // 検索タブは維持される
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
    expect(screen.getByRole('button', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ラーメン屋テスト/ })).toBeNull()
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
    expect(screen.getByText('縁石（未記録）')).toBeTruthy()
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
    expect(screen.getByText('縁石（未記録）')).toBeTruthy()
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

    // 従来フォーム固有の要素はトップでは表示されない
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
    expect(screen.queryByPlaceholderText('例: 珈琲、ラーメン')).toBeNull()
  }, IT_TIMEOUT)

  it('目的タイル（食べる）: 目的グループの施設種類unionで検索が実行され、成功で一覧タブへ切替', async () => {
    renderApp()

    // (#66) 初期ソースが自治体のため、タイル検索（地図モード）を検証するため
    // フォーム経由で地図モードへ切替してからトップへ戻る
    openFormView()
    await switchToMapMode()
    fireEvent.click(screen.getByRole('button', { name: /トップへ戻る/ }))

    fireEvent.click(screen.getByRole('button', { name: '食べる' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 「食べる」目的グループ: 飲食系カテゴリのunionがクエリに反映される
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('amenity=restaurant')
    expect(overpassCalls[0]).toContain('fast_food|bar')
    // 検索範囲は地図の現在表示範囲
    expect(overpassCalls[0]).toContain('34.800000,135.400000,34.900000,135.600000')

    // 成功で一覧タブへ自動切替され、目的で絞り込まれる（書店=「買う」グループ外は除外）
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    expect(screen.getByText(/3件中、\s*2\s*件を表示/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /テスト珈琲店/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ラーメン屋テスト/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /テスト書店/ })).toBeNull()
  }, IT_TIMEOUT)

  it('複合タイル（病院・薬局）: 病院＋薬局のunionクエリが送出され、両カテゴリのみ表示される', async () => {
    renderApp()
    overpassElements = MEDICAL_ELEMENTS

    // (#66) 初期ソースが自治体のため、タイル検索（地図モード）を検証するため
    // フォーム経由で地図モードへ切替してからトップへ戻る
    openFormView()
    await switchToMapMode()
    fireEvent.click(screen.getByRole('button', { name: /トップへ戻る/ }))

    fireEvent.click(screen.getByRole('button', { name: '病院・薬局' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 「病院・薬局」= 病院・クリニック＋薬局・ドラッグストア カテゴリのunion
    expect(overpassCalls[0]).toContain('amenity=pharmacy')
    expect(overpassCalls[0]).toContain('shop=drugstore')
    expect(overpassCalls[0]).toContain('hospital|clinic')

    // 成功で一覧タブへ自動切替され、目的の絞り込みで病院＋薬局のみが残る
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    expect(screen.getByText(/3件中、\s*2\s*件を表示/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /テスト病院/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /テスト薬局/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /テスト書店/ })).toBeNull()
  }, IT_TIMEOUT)

  it('バリアフリータイル: バリアフリー専用クエリ（footway等）が送出され、成功で一覧タブへ切替', async () => {
    renderApp()
    overpassElements = BF_ELEMENTS

    // (#66) 初期ソースが自治体のため、タイル検索（地図モード）を検証するため
    // フォーム経由で地図モードへ切替してからトップへ戻る
    openFormView()
    await switchToMapMode()
    fireEvent.click(screen.getByRole('button', { name: /トップへ戻る/ }))

    fireEvent.click(screen.getByRole('button', { name: 'バリアフリー' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // バリアフリー専用クエリ（POIタグ指定ではなく歩道・縁石など）
    expect(overpassCalls[0]).toContain('footway')

    await waitFor(() => {
      expect(screen.getByText('2件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(screen.getByText('中央通り歩道')).toBeTruthy()
    expect(screen.getByText('縁石（未記録）')).toBeTruthy()
  }, IT_TIMEOUT)

  it('単一カテゴリタイル（トイレ）: そのカテゴリで検索が実行される', async () => {
    renderApp()

    // (#66) 初期ソースが自治体のため、タイル検索（地図モード）を検証するため
    // フォーム経由で地図モードへ切替してからトップへ戻る
    openFormView()
    await switchToMapMode()
    fireEvent.click(screen.getByRole('button', { name: /トップへ戻る/ }))

    fireEvent.click(screen.getByRole('button', { name: 'トイレ' }))

    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 単一カテゴリタイル: カテゴリのタグ条件（amenity=toilets）で地図範囲を検索
    expect(overpassCalls[0]).toContain('amenity=toilets')
    expect(overpassCalls[0]).toContain('34.800000,135.400000,34.900000,135.600000')
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
