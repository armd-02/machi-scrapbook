// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor, cleanup, act } from '@testing-library/react'
import App from '../../App'
import { useApp } from '../../context/AppContext'
import { getCategoriesForPurpose, CATEGORY_GROUPS } from '../../data/categories'
import { MEMOCHO_STORAGE_KEY } from '../../utils/memocho'
import { resetMemochoStore } from '../../hooks/useMemocho'
import { getMapInstance } from '../../hooks/useMapRef'
import { clearCache } from '../../utils/overpass'

/**
 * (#72) PCレイアウト（幅 >= 1024px）: 2ペインレイアウトのテスト
 *
 * - 左ペイン（幅600px）: 「検索」（MobileSearchTab: 一般トップ／くわしく探す）
 * - 右ペイン（残り幅）: 「一覧」（MobileListTab）または「メモ帳」（MemochoSection）
 * - 「その他」選択時: 左ペインが消えて「その他」（MobileOtherTab）が全幅になる
 * - ヘッダー・ステータス・下フッターは全幅で常時表示
 * - 幅 <1024px では従来のモバイルシェル（MobileShell）が表示される
 */

let mediaMatches = false // PC幅をデフォルトでシミュレート
let mediaListeners = [] // matchMedia 'change'リスナー（モックが保持）

// 検索結果のテストフィクスチャ（カフェ1件 + 他2件）
// 座標はモック地図の初期表示範囲（34.8,135.4,34.9,135.6）内に置く。
// 検索結果は表示範囲（bbox）で切り詰められる（filterByBbox）ため、
// 範囲外だと結果が0件になる。
const OVERPASS_ELEMENTS = [
  { type: 'node', id: 1, lat: 34.85, lon: 135.5, tags: { amenity: 'cafe', name: 'テスト珈琲店' } },
  { type: 'node', id: 2, lat: 34.86, lon: 135.51, tags: { amenity: 'restaurant', name: 'レストランA' } },
  { type: 'node', id: 3, lat: 34.87, lon: 135.52, tags: { shop: 'bakery', name: 'ベーカリーB' } }
]

// municipalities.json フィクスチャ（モバイル側テストと同一形式）
const MUNI_DATA = {
  count: 4,
  source: 'test-fixture',
  municipalities: [
    { name: '高槻市', code: '272078', prefecture: '大阪府', prefCode: '27', adminLevel: 8, osmId: 101, bbox: { south: 34.78051, west: 135.55719, north: 34.97667, east: 135.67264 }, displayName: '高槻市' },
    { name: '吹田市', code: '272051', prefecture: '大阪府', prefCode: '27', adminLevel: 8, osmId: 102, bbox: { south: 34.73111, west: 135.45811, north: 34.83111, east: 135.55811 }, displayName: '吹田市' },
    { name: '大阪市', code: '271004', prefecture: '大阪府', prefCode: '27', adminLevel: 7, osmId: 103, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 }, displayName: '大阪市' },
    { name: '豊中市', code: '272035', prefecture: '大阪府', prefCode: '27', adminLevel: 8, osmId: 104, bbox: { south: 34.75, west: 135.4, north: 34.8, east: 135.47 }, displayName: '豊中市' }
  ]
}

// Overpassクエリを記録するfetchモック
const overpassCalls = []
const mockFetch = vi.fn(async (url, options) => {
  const u = String(url)
  if (u.includes('municipalities.json')) {
    return { ok: true, json: async () => MUNI_DATA }
  }
  if (u.includes('interpreter')) {
    const body = options?.body || ''
    const query = String(body).replace(/^data=/, '').replace(/\+/g, ' ')
    overpassCalls.push(decodeURIComponent(query))
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({ version: 0.6, elements: OVERPASS_ELEMENTS })
    }
  }
  return { ok: true, json: async () => ({}) }
})

// maplibre-glをモック（useMapRef経由でgetMapInstance()が使える）
// マーカークリックをシミュレートするため _lastClickPoint / _markerClickHandler を持つ
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

// jsdomにResizeObserverがないためスタブ（MapViewが使用）
class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }
global.ResizeObserver = MockResizeObserver

function setMediaMatches(v) {
  mediaMatches = v
}

function renderApp(query = '') {
  window.history.replaceState(null, '', query ? `?${query}` : '/')
  return render(<App />)
}

function fireMediaChange(mobile) {
  mediaMatches = mobile
  mediaListeners.forEach((cb) => cb({ matches: mobile }))
}

// ---- ヘルパー ----

const IT_TIMEOUT = 15000 // waitFor(5000ms)に余裕を持たせる

// 2ペインのペイン要素取得（data-testidベース）
function getLeftPane() {
  return document.querySelector('[data-testid="pc-left-pane"]')
}
function getRightPane() {
  return document.querySelector('[data-testid="pc-right-pane"]')
}
function getOtherPane() {
  return document.querySelector('[data-testid="pc-other-pane"]')
}

function navButtons() {
  return within(screen.getByRole('navigation', { name: 'モバイルナビゲーション' }))
}
function clickTab(label) {
  fireEvent.click(navButtons().getByRole('button', { name: label }))
}
function tabIsCurrent(label) {
  return navButtons().getByRole('button', { name: label }).getAttribute('aria-current') === 'page'
}

// 一般トップ → くわしく探す（フォーム）表示へ
function openFormView() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
}

// (#xx) フォームは常に地図モード（ソース切替タブは撤去済み・初期ソースもmap）。
// 旧「地図から探すタブ切替」の残骸として残すno-op（呼び出し箇所はそのまま動作）
function switchToMapMode() {}

// (#44) 目的チップ→カテゴリチップ でカテゴリを選択する
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

// 地図モードで「この表示範囲で検索」を実行し、検索完了（Overpass発火+成功）を待つ
async function runMapSearch() {
  fireEvent.click(screen.getByRole('button', { name: 'この表示範囲で検索' }))
  await waitFor(() => expect(overpassCalls.length).toBeGreaterThanOrEqual(1), { timeout: 5000 })
  await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 5000 })
}

// 右ペインの一覧でカテゴリ=カフェの検索結果（1件: テスト珈琲店）が表示されるのを待つ
async function expectRightListVisible() {
  await waitFor(() => {
    expect(within(getRightPane()).getByRole('heading', { name: 'テスト珈琲店' })).toBeTruthy()
  }, { timeout: 5000 })
}

beforeEach(() => {
  mediaMatches = false
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
    addListener: () => {},
    removeListener: () => {}
  })
  // 検索・地理コード・municipalities.json などのfetchをモックする。
  // vi.restoreAllMocks()が afterEach で spy を回復するため毎テスト再インストールする
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
  // 同一クエリのOverpassレスポンスキャッシュをクリア（モバイルテストと同じ機構）。
  // クリアしないと、ファイル内の2件目以降の検索がキャッシュヒットしてfetchが呼ばれない
  clearCache()
  overpassCalls.length = 0
  localStorage.clear()
  resetMemochoStore()
  window.history.replaceState(null, '', '/')
  if (mockState.api) mockState.api.resetState()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// メモ帳のテストフィクスチャをlocalStorageに植える
function seedMemocho() {
  localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
    {
      type: 'node', id: 999, name: 'メモ珈琲店',
      lat: 35.75, lon: 139.75,
      tags: { amenity: 'cafe', name: 'メモ珈琲店' },
      memo: '静かでいい店', addedAt: '2026-01-01T00:00:00.000Z'
    }
  ]))
}

describe('PC 2ペインレイアウト（幅 >= 1024px）', () => {
  it('初期表示: 左ペイン（幅600px）＝検索（一般トップ）、右ペイン＝まちメモ帳', async () => {
    renderApp()

    // 中央max-widthコンテナ（旧PC構成）は存在しない
    expect(document.querySelector('.max-w-\\[520px\\]')).toBeNull()

    // 3ペイン要素が揃っている
    const left = getLeftPane()
    const right = getRightPane()
    const other = getOtherPane()
    expect(left).toBeTruthy()
    expect(right).toBeTruthy()
    expect(other).toBeTruthy()

    // 左ペイン: 幅600px固定、非hidden（検索トップ表示）
    expect(left.className).toContain('w-[600px]')
    expect(left.hasAttribute('hidden')).toBe(false)
    expect(within(left).getByText('まちを探す。集める。共有する。')).toBeTruthy()
    expect(within(left).getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
    // 一般トップのため地図はhidden
    expect(within(left).getByTestId('map-block').hasAttribute('hidden')).toBe(true)

    // 右ペイン: 非hidden、初期表示はまちメモ帳
    expect(right.hasAttribute('hidden')).toBe(false)
    expect(within(right).getByRole('heading', { name: 'まちメモ帳' })).toBeTruthy()
    expect(within(right).getByText('まだ登録がありません。施設のカードや詳細の「メモ帳に追加」から登録できます。')).toBeTruthy()

    // その他ペイン: hidden（未選択）
    expect(other.hasAttribute('hidden')).toBe(true)

    // ヘッダー・下フッターは全幅で常時表示
    expect(screen.getByRole('heading', { name: 'まちのスクラップブック' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()

    // フッターの active は右ペインの内容（メモ帳）に従う
    expect(tabIsCurrent('メモ帳')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
    expect(tabIsCurrent('検索')).toBe(false)
    expect(tabIsCurrent('その他')).toBe(false)
  })

  it('検索成功で右ペインが自動的に一覧へ切替され、左ペインは検索のまま', async () => {
    renderApp()
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()
    await expectRightListVisible()

    // 右ペイン: 一覧。モックはクエリ問わず3件返すが、選択したカテゴリ（カフェ）が
    // reducerによってcatFilterにミラーされるため、表示は該当1件のみ（3件中、1件）。
    // フィルタ適用中のとき「（フィルタ適用中）」が末尾に付くため正規表現で照合
    expect(within(getRightPane()).getByText(/3件中、1件を表示/)).toBeTruthy()
    // 左ペイン: 検索フォームがそのまま（地図モードの検索ボタンが在席）
    expect(getLeftPane().hasAttribute('hidden')).toBe(false)
    expect(within(getLeftPane()).getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()

    // フッターの active が「一覧」へ
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(tabIsCurrent('メモ帳')).toBe(false)
  }, IT_TIMEOUT)

  it('フッター「一覧」「メモ帳」で右ペインの内容が切替され、一覧フィルタ状態は保持される', async () => {
    renderApp()
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()
    await expectRightListVisible()

    // 一覧で名前フィルタを設定
    const nameInput = within(getRightPane()).getByPlaceholderText('名前・メモで絞り込む')
    fireEvent.change(nameInput, { target: { value: '珈琲' } })
    await waitFor(() => {
      expect(within(getRightPane()).getByText(/3件中、1件を表示/)).toBeTruthy()
    })

    // フッター「メモ帳」→ 右ペインがメモ帳へ
    clickTab('メモ帳')
    await waitFor(() => {
      expect(within(getRightPane()).getByText('まだ登録がありません。施設のカードや詳細の「メモ帳に追加」から登録できます。')).toBeTruthy()
    })
    expect(tabIsCurrent('メモ帳')).toBe(true)
    expect(tabIsCurrent('一覧')).toBe(false)
    // 一覧パネルはアンマウントされず hidden 属性で保持されている
    expect(document.querySelector('[data-testid="pc-right-list"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="pc-right-list"]').hasAttribute('hidden')).toBe(true)

    // フッター「一覧」→ 右ペインが一覧へ戻り、フィルタ状態が保持される
    clickTab('一覧')
    await waitFor(() => {
      expect(within(getRightPane()).getByRole('heading', { name: 'テスト珈琲店' })).toBeTruthy()
    })
    expect(within(getRightPane()).getByPlaceholderText('名前・メモで絞り込む').value).toBe('珈琲')
    expect(tabIsCurrent('一覧')).toBe(true)
  }, IT_TIMEOUT)

  it('フッター「その他」: 左ペインが消えて「その他」が全幅に。フッター「検索」で検索レイアウトへ戻る（地図状態は保持）', async () => {
    renderApp()
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()
    await expectRightListVisible()

    const mapBefore = getMapInstance()
    expect(mapBefore).toBeTruthy()

    // フッター「その他」→ 左・右ペインhidden、その他ペイン全幅
    clickTab('その他')
    await waitFor(() => {
      expect(getOtherPane().hasAttribute('hidden')).toBe(false)
    })
    expect(getLeftPane().hasAttribute('hidden')).toBe(true)
    expect(getRightPane().hasAttribute('hidden')).toBe(true)
    expect(tabIsCurrent('その他')).toBe(true)
    // 左ペインはアンマウントされず hidden 属性で保持（検索状態・地図が維持される）。
    // ※byRole系クエリはhiddenサブツリーを除外するため、テキスト照合で確認する
    expect(within(getLeftPane()).queryByText(/トップへ戻る/)).toBeTruthy()

    // フッター「検索」→ 2ペインレイアウトへ復帰（右ペインの内容は直前のまま＝一覧）
    clickTab('検索')
    await waitFor(() => {
      expect(getLeftPane().hasAttribute('hidden')).toBe(false)
    })
    expect(getOtherPane().hasAttribute('hidden')).toBe(true)
    expect(getRightPane().hasAttribute('hidden')).toBe(false)
    // 右ペインは一覧のまま（結果カードが在席）
    expect(within(getRightPane()).getByRole('heading', { name: 'テスト珈琲店' })).toBeTruthy()
    expect(tabIsCurrent('一覧')).toBe(true)
    expect(tabIsCurrent('その他')).toBe(false)

    // 地図インスタンスは同一（hiddenによるマウント維持）で、復帰時にresize()が呼ばれる
    expect(getMapInstance()).toBe(mapBefore)
    expect(mapBefore._calls.some((c) => c.name === 'resize')).toBe(true)
  }, IT_TIMEOUT)

  it('ヘッダーのタイトルボタン: 左ペインが一般トップ表示に戻る（右ペインの内容はそのまま）', async () => {
    renderApp()
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()
    await expectRightListVisible()

    // フォーム表示・一覧表示の状態からタイトルボタンをクリック
    fireEvent.click(screen.getByRole('button', { name: 'トップ画面に戻る' }))

    // 左ペイン: 一般トップへ戻る
    await waitFor(() => {
      expect(within(getLeftPane()).getByText('まちを探す。集める。共有する。')).toBeTruthy()
    })
    // 右ペイン: 一覧のまま（内容は保持）
    expect(within(getRightPane()).getByRole('heading', { name: 'テスト珈琲店' })).toBeTruthy()
    expect(tabIsCurrent('一覧')).toBe(true)
  }, IT_TIMEOUT)

  it('施設詳細シートは左ペインの地図マーカーから開ける', async () => {
    renderApp()
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()
    await expectRightListVisible()

    // 左ペインの地図でマーカークリックをシミュレート
    // （pointレイヤのclickイベントを発火。mobileLayout.test と同じ機構）
    const map = getMapInstance()

    // 結果が地図のGeoJSONに反映されるまで待つ
    await waitFor(() => {
      const features = map._lastGeoJSON?.data?.features || []
      expect(features.length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/1')
    expect(feature).toBeTruthy()
    act(() => {
      map.fire('click', 'point-circle', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    // オーバーレイで詳細シートが開く
    const dialog = await screen.findByRole('dialog', { name: /施設詳細: テスト珈琲店/ })
    expect(dialog).toBeTruthy()
  }, IT_TIMEOUT)

  it('メモ帳と検索結果で施設を選ぶと、それぞれの地図が開く', async () => {
    seedMemocho()
    renderApp()

    fireEvent.click(within(getRightPane()).getByRole('button', { name: 'メモ珈琲店を地図で選択' }))
    expect(within(getRightPane()).getByRole('button', { name: /メモマップ.*地図を隠す/ })).toBeTruthy()
    expect(document.getElementById('memocho-card-node/999').className).toContain('ring-primary-500')
    expect(screen.queryByRole('dialog')).toBeNull()

    // 検索結果の施設名を押すと、施設カードが選択される
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()
    await expectRightListVisible()
    fireEvent.click(within(getRightPane()).getByRole('button', { name: 'テスト珈琲店を地図で選択' }))
    expect(document.getElementById('facility-card-node/1').className).toContain('ring-primary-500')
    expect(screen.queryByRole('dialog')).toBeNull()
  }, IT_TIMEOUT)

  it('幅<1024px: 従来のモバイルシェル（MobileShell）が表示される', async () => {
    setMediaMatches(true)
    renderApp()

    // PCの2ペイン要素は存在しない
    expect(getLeftPane()).toBeNull()
    expect(getRightPane()).toBeNull()
    expect(getOtherPane()).toBeNull()
    expect(document.querySelector('.max-w-\\[520px\\]')).toBeNull()

    // モバイルシェル: 下フッター（4タブ）+ 単一main領域
    const nav = screen.getByRole('navigation', { name: 'モバイルナビゲーション' })
    expect(nav).toBeTruthy()
    expect(tabIsCurrent('検索')).toBe(true)
    // 初期表示は検索タブ（一般トップ）
    expect(screen.getByText('まちを探す。集める。共有する。')).toBeTruthy()
    setMediaMatches(false)
  })
})

describe('matchMedia 変更でレイアウトが追従する', () => {
  it('PC(2ペイン) → モバイル(単一シェル) → PC(2ペイン) と切替される', async () => {
    setMediaMatches(false)
    renderApp()
    expect(getLeftPane()).toBeTruthy()

    // モバイルへ
    fireMediaChange(true)
    await waitFor(() => {
      expect(getLeftPane()).toBeNull()
    })
    expect(screen.getByText('まちを探す。集める。共有する。')).toBeTruthy()

    // PCへ
    fireMediaChange(false)
    await waitFor(() => {
      expect(getLeftPane()).toBeTruthy()
    })
    expect(getOtherPane()).toBeTruthy()
  })
})

describe('PC「その他」タブ機能（2ペインレイアウト下）', () => {
  // 一括照合は検索結果（state.results）と照合するため、先に検索が必要
  it('「店名→座標」CSV一括照合: 全幅で照合実行でき、結果とCSV出力ボタンが表示される', async () => {
    renderApp()
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()

    clickTab('その他')
    const other = getOtherPane()
    expect(other.hasAttribute('hidden')).toBe(false)
    expect(tabIsCurrent('その他')).toBe(true)

    // サブタブ「店名→座標」がデフォルトで有効
    expect(within(other).getByRole('tab', { name: '店名→座標' }).getAttribute('aria-selected')).toBe('true')

    // 施設名を入力 → 照合実行
    const textarea = within(other).getByRole('textbox', { name: '店名リスト（1行1件）' })
    fireEvent.change(textarea, { target: { value: 'テスト珈琲店' } })
    fireEvent.click(within(other).getByRole('button', { name: '照合実行' }))

    // 照合結果: 1件・完全一致は自動確定される（BatchMatchContext）ため「確認済 1」
    await waitFor(() => {
      expect(within(other).getByText(/確認済 1/)).toBeTruthy()
    })

    // CSV出力ボタン
    expect(within(other).getByRole('button', { name: /地図用CSV/ })).toBeTruthy()
    expect(within(other).getByRole('button', { name: '照合CSV' })).toBeTruthy()

    // フッター「検索」で2ペインレイアウトへ復帰でき、下フッターは常時表示される
    clickTab('検索')
    await waitFor(() => {
      expect(getLeftPane().hasAttribute('hidden')).toBe(false)
    })
    expect(screen.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeTruthy()
  }, IT_TIMEOUT)

  it('「統計」サブタブ: 検索結果の集計が表示される（総件数・種別詳細別）', async () => {
    renderApp()
    openFormView()
    switchToMapMode()
    expect(selectCategoryChip('カフェ')).toBe(true)
    await runMapSearch()

    clickTab('その他')
    const other = getOtherPane()
    // 「その他」タブのサブタブ名は「集計・出力」（MobileOtherTabのSUBTABS）
    fireEvent.click(within(other).getByRole('tab', { name: '集計・出力' }))

    // 概要（デフォルト）: 総件数が表示される（モックは3件返す）
    expect(within(other).getByText('総件数')).toBeTruthy()

    // 「種別詳細別」タブ: 集計表（カフェの行）が表示される
    fireEvent.click(within(other).getByText('種別詳細別'))
    await waitFor(() => {
      expect(within(other).getByText('カフェ')).toBeTruthy()
    })
  }, IT_TIMEOUT)

  it('「使い方」サブタブ: AboutPanel（概要・データ品質・出典・API制約）が表示される', () => {
    renderApp()

    clickTab('その他')
    const other = getOtherPane()
    fireEvent.click(within(other).getByRole('tab', { name: '使い方' }))

    // 概要（デフォルト）が表示される
    expect(within(other).getByText('概要')).toBeTruthy()

    // 「データ品質」セクションへ切替
    fireEvent.click(within(other).getByText('データ品質'))
    expect(within(other).getByText('データ品質について')).toBeTruthy()
  })
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

  it('どのタブ（検索/一覧/メモ帳/その他）を表示していてもメニューが開け、3項目が表示される (#77-3)', () => {
    renderApp()

    // PCレイアウトではフッターnavのactiveは右ペイン内容（一覧/メモ帳）または「その他」に従う。
    // 「検索」は左ペインが常に検索を表示する構成のため active にならない（modeがmainへ）。各タブで
    // そのタブの表示内容を確認してから、ヘッダーのメニューが開けることを検証する。
    const steps = [
      { label: '検索', check: () => expect(document.querySelector('[data-testid="pc-left-pane"]').hasAttribute('hidden')).toBe(false) },
      { label: '一覧', check: () => expect(tabIsCurrent('一覧')).toBe(true) },
      { label: 'メモ帳', check: () => expect(tabIsCurrent('メモ帳')).toBe(true) },
      { label: 'その他', check: () => expect(tabIsCurrent('その他')).toBe(true) },
    ]

    for (const { label, check } of steps) {
      clickTab(label)
      check()

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
