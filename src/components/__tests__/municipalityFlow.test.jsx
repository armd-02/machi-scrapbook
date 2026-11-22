// @vitest-environment jsdom
/**
 * (#xx) 自治体検索 E2E 統合テスト — トップ画面「都道府県から探す」セクション
 *
 * 背景: 「くわしく探す」フォームは常に地図モード（「地図から探す」）となり、
 * 「自治体から探す」タブとフォーム内蔵 MunicipalitySearch は廃止された。
 * 自治体検索はトップ画面の折りたたみセクション「都道府県から探す」から
 * 実行する単一導線になった。本テストはセクション経由のフローを検証する。
 *
 * (#47 追跡) ユーザー報告: 「カテゴリが全く変わってない」— 自治体検索でカテゴリ
 * を変更しても検索クエリに反映されない、という報告に対する回帰防止検証を
 * セクションフローで継続する。
 *
 * 検証内容:
 * 1. 市区町村選択 → カテゴリ変更 → 検索: 選択カテゴリがクエリに反映される
 * 2. 検索後のカテゴリ変更 → 再検索: クエリが更新カテゴリで再発行される
 * 3. ディスパッチ競合: カテゴリ変更dispatchと検索クリックが連続しても
 *    buildSearchCriteriaのスナップショットで最新値が使える（#47）
 * 4. URL復元: 旧自治体モード共有URL（src=m&mun=..&c=..&b=..）は地図モードとして
 *    復元され、都道府県セクション・フォームの双方で地域と条件が使えて検索できる
 * 5. ハンドオフ: 都道府県セクション検索後にフォームを開くと、セクションの条件
 *    （カテゴリ+料理）が地図モードへ引き継がれ、フォームから検索できる（#49）
 * 6. 地図モードURL（src=map&c=..）のカテゴリ復元とフォーム検索
 * 7. 目的のみ選択（カテゴリ未選択）→ 検索: クエリは該当目的の施設種別で
 *    限定される（#44）
 *
 * 補足: トップ画面では「何する？」クイックタイルとセクションが同居し、同名の
 * ボタンが複数存在する（例: 「食べる」タイルと「食べる」目的チップ）。
 * セクション内のチップ・ボタン操作はセクションを scope に指定する。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import App from '../../App'
import { clearCache } from '../../utils/overpass'
import { CATEGORY_GROUPS, getCategoriesForPurpose } from '../../data/categories'

// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
// vi.mockファクトリはファイル先頭にホイスされるため、共通モックは動的importで参照。
// マップインスタンスの操作は mockState.api._state.maps から取得できる。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

// jsdomにないAPIのスタブ
class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver || MockResizeObserver
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
  if (mockState.api) mockState.api.resetState()
})

/**
 * municipalities.json フィクスチャ
 * 実データの形式（municipalitiesエントリに prefecture/prefCode が含まれ、
 * 独立した prefectures キーはない）に合わせる。
 */
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

const overpassCalls = []

let mockFetch
beforeEach(() => {
  overpassCalls.length = 0
  // Overpassキャッシュをクリア（キャッシュ命中でfetchがスキップされるのを防ぐ）
  clearCache()

  mockFetch = vi.fn(async (url, options) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, json: async () => MUNI_DATA }
    }
    if (u.includes('interpreter')) {
      // Overpass API: POST bodyは data=<urlencoded query> 形式
      const body = options?.body || ''
      const query = String(body).replace(/^data=/, '').replace(/\+/g, ' ')
      overpassCalls.push(decodeURIComponent(query))
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ version: 0.6, elements: [
          { type: 'node', id: 1, lat: 34.8, lon: 135.5, tags: { amenity: 'cafe', name: 'Test Cafe' } },
          { type: 'node', id: 2, lat: 34.81, lon: 135.51, tags: { shop: 'convenience', name: 'Test Shop' } }
        ] })
      }
    }
    return { ok: true, json: async () => ({}) }
  })
  global.fetch = mockFetch
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // URLをリセット（テスト間で漏れないように）
  window.history.replaceState(null, '', '/')
})

// ---- ヘルパー ----------------------------------------------------------

// ラベルベースのselect取得（ResultsPanel等のselectと混同しない）
const getSelectByLabel = (label) => {
  const el = screen.getByText(label)
  let node = el
  while (node && node.tagName !== 'DIV') node = node.parentElement
  return node?.querySelector('select')
}

// ラベルベースの市区町村テキスト入力取得
const getInputByLabel = (label) => {
  const el = screen.getByText(label)
  let node = el
  while (node && node.tagName !== 'DIV') node = node.parentElement
  return node?.querySelector('input')
}

// サジェストリスト内の候補（role=option）を取得
const getSuggestOptions = () =>
  screen.getAllByRole('option').filter(o => o.closest('[role="listbox"]'))

// (#68) PCはモバイルと同じシェル（MobileShell）を使う。検索成功で「一覧」タブへ
// 自動切替されるため、フォーム操作（カテゴリ変更・再検索）の前の「検索」タブ復帰を使う。
function navButtons() {
  return within(screen.getByRole('navigation', { name: 'モバイルナビゲーション' }))
}
function clickTab(label) {
  fireEvent.click(navButtons().getByRole('button', { name: label }))
}

/**
 * (#44) 目的チップ→カテゴリチップ でカテゴリを選択する
 * 例: selectCategoryChip('カフェ') → 「食べる」をタップ → 「カフェ」をタップ
 *
 * scope を渡すとセクション内に限定する（トップ画面のクイックタイルに同名ボタン
 * が存在するため、セクションフローでは必須）。
 */
function selectCategoryChip(catLabel, scope = null) {
  const q = scope ? within(scope) : screen
  for (const g of CATEGORY_GROUPS) {
    const cats = getCategoriesForPurpose(g.name) || []
    const cat = cats.find((c) => c.label === catLabel)
    if (!cat) continue
    fireEvent.click(q.getByRole('button', { name: g.name }))
    fireEvent.click(q.getByRole('button', { name: catLabel }))
    return true
  }
  throw new Error(`カテゴリチップが見つからない: ${catLabel}`)
}

// 選択中カテゴリが表示される（「解除」ボタン出現）ことを待つ
async function expectCategorySelected(scope = null, timeout = 3000) {
  const q = scope ? within(scope) : screen
  await waitFor(() => {
    expect(q.getByText('解除')).toBeTruthy()
  }, { timeout })
}

/**
 * 選択中カテゴリが指定ラベルであることを待つ。
 * 「解除」ボタンの隣接spanで確認する（getByText(/ラベル/)は結果パネルの
 * フィルタselect内のoptionと衝突するため使用しない）。
 */
async function expectCategoryLabel(label, scope = null, timeout = 3000) {
  const q = scope ? within(scope) : screen
  await waitFor(() => {
    const btn = q.queryByText('解除')
    expect(btn).toBeTruthy()
    expect(btn.parentElement.textContent).toContain(label)
  }, { timeout })
}

// URL設定 + Appレンダリング
function renderApp(query = '') {
  window.history.replaceState(null, '', query ? `?${query}` : '/')
  render(<App />)
}

// (#63) 初期表示は一般向けトップ。フォーム要素は「くわしく探す」で表示される
function openFormView() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
}

// (#xx) トップ画面の「都道府県から探す」セクションを開く（既定は閉じた状態）
function openMuniSection() {
  fireEvent.click(screen.getByRole('button', { name: /都道府県から探す/ }))
}

// 「都道府県から探す」セクション要素（scope 用）
const muniSection = () => screen.getByRole('region', { name: '都道府県から探す' })

// セクション内の「検索する」ボタン（トップ画面には同名ボタンが複数あるため必ずscope指定）
const sectionSearchBtn = (scope) => within(scope).getByRole('button', { name: '検索する' })

const IT_TIMEOUT = 15000 // waitFor(5000ms)に余裕を持たせる

// 都道府県→市区町村を選択（テキスト入力＋サジェスト）
async function selectMunicipality(prefText, munText) {
  // MunicipalitySearch（variant="mobile"）のラベルで取得する。都道府県は
  // タイルグリッド＋sr-only select で、select への変更も同一の更新処理
  // （handlePrefChange）に通る。
  await waitFor(() => {
    expect(screen.getByText('どの県で探す？')).toBeTruthy()
  }, { timeout: 3000 })
  const prefSelect = getSelectByLabel('どの県で探す？')
  expect(prefSelect).toBeTruthy()

  // プリフェクチャコードをテキストから逆算
  const options = [...prefSelect.querySelectorAll('option')]
  const prefOpt = options.find(o => o.textContent === prefText)
  expect(prefOpt).toBeTruthy()
  fireEvent.change(prefSelect, { target: { value: prefOpt.value } })

  // 市区町村入力欄の出現を待ってから名前の入力と候補クリック
  const input = await waitFor(() => {
    const i = getInputByLabel('どの市区町村で探す？')
    expect(i).toBeTruthy()
    return i
  }, { timeout: 3000 })
  fireEvent.change(input, { target: { value: munText } })
  const munOpt = await waitFor(() => {
    const opt = getSuggestOptions().find(o => o.textContent.startsWith(munText))
    expect(opt).toBeTruthy()
    return opt
  }, { timeout: 3000 })
  fireEvent.click(munOpt)
}

describe('自治体検索 E2E（トップ画面「都道府県から探す」セクション）', () => {
  it('市区町村選択→カテゴリ変更→検索: クエリに選択カテゴリが反映される', async () => {
    renderApp()

    // (#xx) 自治体検索はトップ画面のセクションから（タブ・フォーム内蔵は廃止）
    openMuniSection()
    const sec = muniSection()

    // 大阪府 → 高槻市 を選択
    await selectMunicipality('大阪府', '高槻市')

    // 初期状態: カテゴリ未選択（「解除」ボタンなし）
    await waitFor(() => {
      expect(within(sec).queryByText('解除')).toBeNull()
    }, { timeout: 3000 })

    // カテゴリを「カフェ」に変更（目的チップ→カテゴリチップ、セクション内に限定）
    expect(selectCategoryChip('カフェ', sec)).toBe(true)
    await expectCategorySelected(sec)

    // セクション内の「検索する」をクリック
    fireEvent.click(sectionSearchBtn(sec))

    // Overpassクエリが amenity=cafe を含むことを確認
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('amenity=cafe')
    // 高槻市のBBOX范围内使用
    expect(overpassCalls[0]).toContain('34.78051')
    expect(overpassCalls[0]).toContain('135.67264')
  }, IT_TIMEOUT)

  it('検索後のカテゴリ変更→再検索: クエリが更新カテゴリで再発行される', async () => {
    renderApp()
    openMuniSection()
    const sec = muniSection()
    await selectMunicipality('大阪府', '高槻市')

    // 1回目: カフェで検索（目的チップ→カテゴリチップ）
    expect(selectCategoryChip('カフェ', sec)).toBe(true)
    await expectCategorySelected(sec)
    fireEvent.click(sectionSearchBtn(sec))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('amenity=cafe')

    // 検索完了（ボタンが再有効化）を待つ
    await waitFor(() => {
      expect(sectionSearchBtn(sec).disabled).toBe(false)
    }, { timeout: 5000 })
    // 検索成功で「一覧」タブへ自動切替されるため、検索タブに戻ってカテゴリを変更
    clickTab('検索')

    // 2回目: カテゴリを「レストラン」に変えて再検索
    const sec2 = muniSection()
    expect(selectCategoryChip('レストラン', sec2)).toBe(true)
    await expectCategorySelected(sec2)
    fireEvent.click(sectionSearchBtn(sec2))

    await waitFor(() => expect(overpassCalls.length).toBe(2), { timeout: 5000 })
    // 2番目のクエリは restaurant を含み、cafe を含まない
    expect(overpassCalls[1]).toContain('amenity=restaurant')
    expect(overpassCalls[1]).not.toContain('amenity=cafe')
  }, IT_TIMEOUT)

  it('カテゴリ変更のdispatchと検索クリックが連続しても最新カテゴリが使える（dispatch競合の回帰テスト）', async () => {
    renderApp()
    openMuniSection()
    const sec = muniSection()
    await selectMunicipality('大阪府', '高槻市')

    // 旧バグのシナリオ: カテゴリ変更のdispatchが未commitの状態で検索が呼ばれる
    // （React 18のbatching下で、同一タスク内のカテゴリチップタップ+検索クリック）
    expect(selectCategoryChip('薬局・ドラッグストア', sec)).toBe(true)
    // 再レンダリングを待たずに即座に検索クリック
    fireEvent.click(sectionSearchBtn(sec))

    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    // 最新カテゴリ(pharmacy)がクエリに使われていなければ旧バグの回帰
    expect(overpassCalls[0]).toContain('amenity=pharmacy')
  }, IT_TIMEOUT)

  it('URL復元: 旧自治体モード共有URLは地図モードとして復元され、セクション・フォーム双方で地域と条件が使えて検索できる', async () => {
    // 高槻市のbbox + カテゴリ=cafe をエンコードした旧自治体モード共有URL
    renderApp('src=m&mun=272078&c=cafe&b=34.780510,135.557190,34.976670,135.672640')

    // (#xx) 旧自治体モードURLは地図モード（searchSource=map）として復元される。
    // 地域・条件はセクション（都道府県から探す）でもフォーム（地図モード）でも使える。
    openMuniSection()
    const sec = muniSection()

    // 市区町村・県がセクションの入力欄に復元される（stale closure対策の確認）
    await waitFor(() => {
      expect(getSelectByLabel('どの県で探す？').value).toBe('27')
      expect(getInputByLabel('どの市区町村で探す？').value).toBe('高槻市')
    }, { timeout: 5000 })

    // カテゴリ「カフェ」がセクションのカテゴリピッカーに復元される
    await expectCategoryLabel('カフェ', sec, 5000)

    // セクションで検索 → cafeクエリ（高槻市BBOX）が発行される
    fireEvent.click(sectionSearchBtn(sec))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('34.78051')

    // 地図モード（フォーム）にも条件が復元される
    await waitFor(() => {
      expect(sectionSearchBtn(sec).disabled).toBe(false)
    }, { timeout: 5000 })
    clickTab('検索')
    openFormView()
    await expectCategoryLabel('カフェ', null, 5000)
  }, IT_TIMEOUT)

  it('ハンドオフ: 都道府県セクション検索後にフォームを開くと、セクションの条件（カテゴリ+料理）が地図モードへ引き継がれる（#49）', async () => {
    renderApp()
    openMuniSection()
    const sec = muniSection()
    await selectMunicipality('大阪府', '高槻市')

    // セクションで カフェ+寿司 を設定して検索
    expect(selectCategoryChip('カフェ', sec)).toBe(true)
    await expectCategorySelected(sec)
    const cuisineSelect = await waitFor(() => {
      const s = getSelectByLabel('料理（任意）')
      expect(s).toBeTruthy()
      return s
    }, { timeout: 3000 })
    fireEvent.change(cuisineSelect, { target: { value: 'sushi' } })
    await waitFor(() => expect(cuisineSelect.value).toBe('sushi'))

    fireEvent.click(sectionSearchBtn(sec))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('amenity=cafe')
    expect(overpassCalls[0]).toContain('cuisine=sushi')

    // 検索完了を待ち、検索タブに戻ってフォームを開く
    await waitFor(() => {
      expect(sectionSearchBtn(sec).disabled).toBe(false)
    }, { timeout: 5000 })
    clickTab('検索')
    openFormView()

    // (#xx) フォームは常に地図モード。開いた時点でソースが自治体の場合は
    // 地図モードへ自動切替され、セクションの条件がフォームへ引き継がれる
    await expectCategoryLabel('カフェ', null, 5000)
    const formCuisine = await waitFor(() => {
      const s = getSelectByLabel('料理（任意）')
      expect(s).toBeTruthy()
      expect(s.value).toBe('sushi')
      return s
    }, { timeout: 5000 })
    expect(formCuisine).toBeTruthy()

    // フォーム（地図モード）で検索 → cafe+sushi クエリが発行される
    fireEvent.click(screen.getByText('この表示範囲で検索'))
    await waitFor(() => expect(overpassCalls.length).toBe(2), { timeout: 5000 })
    expect(overpassCalls[1]).toContain('amenity=cafe')
    expect(overpassCalls[1]).toContain('cuisine=sushi')
  }, IT_TIMEOUT)

  it('地図モードURL（src=map&c=cafe）からカテゴリが復元され検索に使える（dispatch順序）', async () => {
    renderApp('?src=map&c=cafe&b=35.0,139.0,35.1,139.1')

    // (#63) 初期表示はトップ。カテゴリチップは従来フォーム側に表示される
    openFormView()

    // 地図モードでカテゴリチップが「カフェ」に復元される（選択中ボックス表示）
    // （SET_SEARCH_SOURCE が SET_SIMPLE_SEARCH より後にdispatchされると、
    //   last-wins引き継ぎがURLのカテゴリを空で上書きする → 順序が重要）
    await expectCategoryLabel('カフェ', null, 5000)

    // 検索してクエリがcafeになる（地図モード: ラベルは「この表示範囲で検索」）
    fireEvent.click(screen.getByText('この表示範囲で検索'))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('amenity=cafe')
  }, IT_TIMEOUT)

  it('目的のみ選択（カテゴリ未選択）→検索: クエリがその目的の施設種類に限定される (#44)', async () => {
    renderApp()
    openMuniSection()
    const sec = muniSection()
    await selectMunicipality('大阪府', '高槻市')

    // 「遊ぶ・公園」目的チップのみタップ（カテゴリチップは押さない。セクション内に限定）
    fireEvent.click(within(sec).getByRole('button', { name: '遊ぶ・公園' }))

    fireEvent.click(sectionSearchBtn(sec))

    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    const q = overpassCalls[0]
    // 遊ぶ・公園グループのタグ条件が含まれる
    expect(q).toContain('[leisure~"^(park|playground|garden|pitch)$"]')
    expect(q).toContain('[amenity=plaza]')
    expect(q).toContain('[amenity=place_of_worship]')
    // 遊ぶに無関係なカテゴリ・汎用POIブランチは含まれない
    expect(q).not.toContain('[amenity=cafe]')
    expect(q).not.toContain('node[shop]')
  }, IT_TIMEOUT)
})

describe('#54 料理（cuisine）フィルタ E2E', () => {
  it('地図モード: レストラン+ラーメン → クエリに [amenity=restaurant][cuisine=ramen] がAND連結される', async () => {
    // BBOXをURLで設定（srcパラメータなし → 地図モードがデフォルトに復元される）
    renderApp('b=34.800000,135.400000,34.900000,135.600000')

    // (#63) カテゴリチップ・料理selectは従来フォーム側に表示される
    openFormView()

    // カテゴリを「レストラン」にすると料理selectが出現
    expect(selectCategoryChip('レストラン')).toBe(true)
    const cuisineSelect = await waitFor(() => {
      const s = getSelectByLabel('料理（任意）')
      expect(s).toBeTruthy()
      return s
    }, { timeout: 3000 })

    // 料理を「ラーメン」に選択
    fireEvent.change(cuisineSelect, { target: { value: 'ramen' } })
    await waitFor(() => expect(cuisineSelect.value).toBe('ramen'))

    // 検索 → クエリに両条件がAND連結される（地図モード: ラベルは「この表示範囲で検索」）
    fireEvent.click(screen.getByText('この表示範囲で検索'))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('[amenity=restaurant][cuisine=ramen]')
  }, IT_TIMEOUT)

  it('旧共有URL c=ramen: 「レストラン+ラーメン」に自動マッピングされ検索に使える', async () => {
    renderApp('c=ramen&b=34.800000,135.400000,34.900000,135.600000')

    // (#63) 初期表示はトップ。カテゴリチップ・料理selectは従来フォーム側
    openFormView()

    // カテゴリチップが「レストラン」、料理selectが「ラーメン」に復元される
    await expectCategoryLabel('レストラン', null, 3000)
    const cuisineSelect = await waitFor(() => {
      const s = getSelectByLabel('料理（任意）')
      expect(s).toBeTruthy()
      expect(s.value).toBe('ramen')
      return s
    }, { timeout: 3000 })

    // 検索 → 旧ラーメンカテゴリと同等のクエリ（地図モード: ラベルは「この表示範囲で検索」）
    fireEvent.click(screen.getByText('この表示範囲で検索'))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('[amenity=restaurant][cuisine=ramen]')
  }, IT_TIMEOUT)

  it('非飲食カテゴリに切り替えると料理selectが消え、cuisineは自動クリアされる', async () => {
    renderApp('b=34.800000,135.400000,34.900000,135.600000')

    // (#63) 従来フォーム側でカテゴリ・料理selectが操作される
    openFormView()

    // レストラン+ラーメンを設定
    expect(selectCategoryChip('レストラン')).toBe(true)
    await expectCategorySelected()
    const cuisineSelect = await waitFor(() => {
      const s = getSelectByLabel('料理（任意）')
      expect(s).toBeTruthy()
      return s
    }, { timeout: 3000 })
    fireEvent.change(cuisineSelect, { target: { value: 'ramen' } })
    await waitFor(() => expect(cuisineSelect.value).toBe('ramen'))

    // 薬局に切り替え → 料理selectが非表示に
    selectCategoryChip('薬局・ドラッグストア')
    await waitFor(() => {
      expect(screen.queryByText('料理（任意）')).toBeNull()
    }, { timeout: 3000 })

    // 検索 → cuisineはクエリに含まれない（自動クリア+クエリ側ガード）（地図モード: ラベルは「この表示範囲で検索」）
    fireEvent.click(screen.getByText('この表示範囲で検索'))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('[amenity=pharmacy]')
    expect(overpassCalls[0]).not.toContain('cuisine')
  }, IT_TIMEOUT)

  it('セクション: 飲食店+寿司 → 各unionブランチに[cuisine=sushi]が連結される', async () => {
    renderApp()
    openMuniSection()
    const sec = muniSection()
    await selectMunicipality('大阪府', '高槻市')

    // 飲食店（すべて）を選択 → 料理selectが出現
    expect(selectCategoryChip('飲食店（すべて）', sec)).toBe(true)
    await expectCategorySelected(sec)
    const cuisineSelect = await waitFor(() => {
      const s = getSelectByLabel('料理（任意）')
      expect(s).toBeTruthy()
      return s
    }, { timeout: 3000 })
    fireEvent.change(cuisineSelect, { target: { value: 'sushi' } })
    await waitFor(() => expect(cuisineSelect.value).toBe('sushi'))

    // 検索 → 8値unionの各ブランチにcuisineがAND連結
    fireEvent.click(sectionSearchBtn(sec))
    await waitFor(() => expect(overpassCalls.length).toBe(1), { timeout: 5000 })
    expect(overpassCalls[0]).toContain('[cuisine=sushi]')
    expect(overpassCalls[0]).toContain('amenity~"^(cafe|restaurant|fast_food|bar|pub|izakaya|sushi|food_court)$"')
  }, IT_TIMEOUT)
})
