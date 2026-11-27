// @vitest-environment jsdom
/**
 * (#75) ヘッダーのハンバーガーメニュー（HeaderMenu）
 *
 * - ☰ ボタン（aria-label「メニュー」）でドロップダウンが開閉する
 * - 一覧を保存（CSV）: downloadCSV がフィルタ済み結果・fetchMeta・prefix で呼ばれる
 * - GeoJSON（高度な形式）: downloadGeoJSON が呼ばれる
 * - 件数表記: CSV/GeoJSON 各項目に「N件を保存します」／フィルタ有効時
 *   「全M件中、N件を保存します」（無効なときは「0件を保存します」）
 * - 結果なし・フィルタで0件のとき保存系は disabled（クリックしても出力されない）
 * - 自治体モードではファイル名 prefix が osm-<自治体名> になる
 * - まちメモ帳をすべて削除: 2段階確認。実行で store/localStorage が空に、
 *   成功メッセージ（role="status"）が出てメニューが閉じる。window.confirm を使わない
 * - メモ帳0件のとき全消去・書き出し系は disabled（読み込みは常に有効）
 * - メニュー外タップで閉じ、2段階確認の状態もリセットされる
 * - (#79) まちメモ帳の書き出し（JSON/CSV）・読み込みは MemochoSection の☰メニューから
 *   このメニューに集約された。書き出しは downloadFile（実物）＋serializeMemocho/toCSV
 *   （実物）で Blob の内容を検証。読み込みは parseMemochoJSON→importItems で合流し、
 *   結果・エラーメッセージ（role="status"）が出る
 * - グルーピング: [検索結果] と [まちメモ帳] の2グループ見出し＋区切り線で整理。
 *   全消去は危険操作として従来どおり赤字で区別表示
 * - 操作後のフィードバックはメニューの位置に role="status" のメッセージで表示。
 *   成功=✓・エラー=⚠️ アイコン付きで区別され、「メッセージを閉じる」（✕）で消せる。
 *   読み込みの結果・エラーもこのメッセージで通知される
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import HeaderMenu from '../HeaderMenu'
import { AppContext } from '../../context/AppContext'
import { appReducer, createInitialState } from '../../state/appReducer'
import * as exportUtils from '../../utils/export'
import { resetMemochoStore } from '../../hooks/useMemocho'
import { MEMOCHO_STORAGE_KEY } from '../../utils/memocho'
import { SCRAPBOOKS_STORAGE_KEY } from '../../utils/scrapbooks'
import { OVERPASS_PREFERENCE_KEY } from '../../utils/overpassPreference'

// downloadCSV / downloadGeoJSON はモック（呼び出し検証用）。
// toCSV / downloadFile は実物を使う（#79: まちメモ帳の書き出しで Blob 内容を
// 検証するため）。
vi.mock('../../utils/export', async () => {
  const actual = await vi.importActual('../../utils/export')
  return { ...actual, downloadCSV: vi.fn(), downloadGeoJSON: vi.fn() }
})

const RESULTS = [
  { type: 'node', id: 1, name: 'カフェA', lat: 34.85, lon: 135.5, tags: { amenity: 'cafe', name: 'カフェA' } },
  { type: 'node', id: 2, name: 'カフェB', lat: 34.86, lon: 135.5, tags: { amenity: 'cafe', name: 'カフェB' } },
]

const FETCH_META = { fetchedAt: '2026-01-02T00:00:00.000Z', endpoint: 'test' }

function makeMemoItem(overrides = {}) {
  return {
    type: 'node',
    id: 1001,
    name: 'テスト珈琲店',
    lat: 34.85,
    lon: 135.5,
    tags: { name: 'テスト珈琲店', amenity: 'cafe' },
    memo: '',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function Harness({ preActions = [], children }) {
  const [state] = React.useReducer(
    appReducer,
    preActions,
    (acts) => acts.reduce((s, a) => appReducer(s, a), createInitialState())
  )
  return (
    <AppContext.Provider value={{ state, dispatch: vi.fn() }}>
      {children}
    </AppContext.Provider>
  )
}

const SET_RESULTS = { type: 'SET_RESULTS', payload: RESULTS }
const SET_FETCH_META = { type: 'SET_FETCH_META', payload: FETCH_META }

function storedItems() {
  const raw = localStorage.getItem(MEMOCHO_STORAGE_KEY)
  return raw == null ? null : JSON.parse(raw)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetMemochoStore()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  resetMemochoStore()
  vi.restoreAllMocks()
})

describe('HeaderMenu: メニューの開閉', () => {
  it('☰ ボタンが表示され、閉じた状態ではメニュー項目が無い', () => {
    render(<Harness><HeaderMenu /></Harness>)
    const btn = screen.getByRole('button', { name: 'メニュー' })
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('☰ クリックでメニューが開き、検索結果系・まちメモ帳系・ごみ箱・全消去の7項目が表示される', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('button', { name: 'メニュー' }).getAttribute('aria-expanded')).toBe('true')
    // 検索結果系（旧ExportBar 由来）
    expect(screen.getByRole('menuitem', { name: /一覧を保存（CSV）/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /GeoJSON（高度な形式）/ })).toBeTruthy()
    // まちメモ帳系（#79: MemochoSection の☰メニューから集約）
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をJSONで書き出し/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をCSVで書き出し/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ })).toBeTruthy()
    // ごみ箱（論理削除されたアイテムの表示・復元へ）
    expect(screen.getByRole('menuitem', { name: /ごみ箱/ })).toBeTruthy()
    // 全消去
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ })).toBeTruthy()
  })

  it('再度 ☰ をクリックするとメニューが閉じる', () => {
    render(<Harness><HeaderMenu /></Harness>)
    const btn = screen.getByRole('button', { name: 'メニュー' })
    fireEvent.click(btn)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(7)
    fireEvent.click(btn)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })
})

describe('HeaderMenu: グルーピング（#80）', () => {
  it('検索結果・まちメモ帳の2つのグループ見出しがメニュー内に表示される', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByText('検索結果')).toBeTruthy()
    expect(screen.getByText('まちメモ帳')).toBeTruthy()
    // 見出しは menuitem にならない（7項目のまま）
    expect(screen.queryAllByRole('menuitem')).toHaveLength(7)
  })

  it('全消去は危険操作として従来どおり赤字で表示される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem()]))
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    const wipeBtn = screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ })
    expect(wipeBtn.className).toContain('text-red-600')
  })
})

describe('HeaderMenu: Overpass API 切替', () => {
  it('「標準」「海外」の2択がラジオとして表示され、既定は「標準」が選択済み', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('radiogroup', { name: 'Overpass API' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /標準/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /海外/ }).getAttribute('aria-checked')).toBe('false')
    // 接続先の固有名（armd-01 等）は表示しない。「標準」「海外」だけを示す
    expect(screen.getByRole('radio', { name: /標準/ }).textContent).not.toContain('armd-01')
    expect(screen.getByRole('radio', { name: /標準/ }).textContent).not.toContain('Overpass API')
    expect(screen.getByRole('radio', { name: /海外/ }).textContent).not.toContain('Overpass API')
  })

  it('「海外」を押すと localStorage に "public" が保存され、チェックが移動する（メニューは開いたまま）', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('radio', { name: /海外/ }))

    expect(localStorage.getItem(OVERPASS_PREFERENCE_KEY)).toBe('public')
    expect(screen.getByRole('radio', { name: /海外/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /標準/ }).getAttribute('aria-checked')).toBe('false')
    // 設定変更なので実行後もメニューを閉じない（選択状態がそのまま見える）
    expect(screen.queryAllByRole('menuitem')).toHaveLength(7)
  })

  it('「標準」に戻すと "custom" が保存される', () => {
    localStorage.setItem(OVERPASS_PREFERENCE_KEY, 'public')
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('radio', { name: /標準/ }))
    expect(localStorage.getItem(OVERPASS_PREFERENCE_KEY)).toBe('custom')
    expect(screen.getByRole('radio', { name: /標準/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('保存済みの "public" が新しいレンダリングで読み戻される（次回起動時の維持）', () => {
    localStorage.setItem(OVERPASS_PREFERENCE_KEY, 'public')
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('radio', { name: /海外/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /標準/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('ラジオ項目は menuitem として数えられない（従来7項目の構成が変わらない）', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.queryAllByRole('menuitem')).toHaveLength(7)
    expect(screen.queryAllByRole('radio')).toHaveLength(2)
  })
})

describe('HeaderMenu: 一覧の保存（CSV / GeoJSON）', () => {
  it('CSVクリックで downloadCSV がフィルタ済み結果・fetchMeta・既定prefixで呼ばれる', () => {
    render(<Harness preActions={[SET_RESULTS, SET_FETCH_META]}><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /一覧を保存（CSV）/ }))
    expect(exportUtils.downloadCSV).toHaveBeenCalledTimes(1)
    expect(exportUtils.downloadCSV).toHaveBeenCalledWith(RESULTS, FETCH_META, 'osm-results')
    expect(exportUtils.downloadGeoJSON).not.toHaveBeenCalled()
    // 成功メッセージが出てメニューが閉じる
    expect(screen.getByRole('status').textContent).toContain('CSVとして保存しました')
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('GeoJSONクリックで downloadGeoJSON が呼ばれる', () => {
    render(<Harness preActions={[SET_RESULTS, SET_FETCH_META]}><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /GeoJSON（高度な形式）/ }))
    expect(exportUtils.downloadGeoJSON).toHaveBeenCalledTimes(1)
    expect(exportUtils.downloadGeoJSON).toHaveBeenCalledWith(RESULTS, FETCH_META)
    expect(exportUtils.downloadCSV).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('GeoJSONとして保存しました')
  })

  it('件数表記: フィルタ無効で CSV/GeoJSON 各項目に「2件を保存します」', () => {
    render(<Harness preActions={[SET_RESULTS]}><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    // CSV と GeoJSON の両項目に件数表記が付いている
    expect(screen.getAllByText('2件を保存します')).toHaveLength(2)
  })

  it('フィルタで絞り込まれると「M件中、N件を保存します」', () => {
    const actions = [
      SET_RESULTS,
      { type: 'SET_RESULT_FILTERS', payload: { nameFilter: 'カフェA' } },
    ]
    render(<Harness preActions={actions}><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    // フィルタ時は「全M件中、N件を保存します」が両項目に表示される
    expect(screen.getAllByText('全2件中、1件を保存します')).toHaveLength(2)
    // 出力も絞り込み後の1件のみ
    fireEvent.click(screen.getByRole('menuitem', { name: /一覧を保存（CSV）/ }))
    const [passedResults] = exportUtils.downloadCSV.mock.calls[0]
    expect(passedResults).toHaveLength(1)
    expect(passedResults[0].name).toBe('カフェA')
  })

  it('結果が無いときは保存系が disabled になり、クリックでも出力されない', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    const csvBtn = screen.getByRole('menuitem', { name: /一覧を保存（CSV）/ })
    const geoBtn = screen.getByRole('menuitem', { name: /GeoJSON（高度な形式）/ })
    expect(csvBtn.disabled).toBe(true)
    expect(geoBtn.disabled).toBe(true)
    // 件数表記は「0件を保存します」（無効化の理由を表示）
    expect(screen.getAllByText('0件を保存します')).toHaveLength(2)
    fireEvent.click(csvBtn)
    fireEvent.click(geoBtn)
    expect(exportUtils.downloadCSV).not.toHaveBeenCalled()
    expect(exportUtils.downloadGeoJSON).not.toHaveBeenCalled()
  })

  it('フィルタで0件のときは保存系が disabled になる', () => {
    const actions = [
      SET_RESULTS,
      { type: 'SET_RESULT_FILTERS', payload: { nameFilter: '存在しない施設' } },
    ]
    render(<Harness preActions={actions}><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('menuitem', { name: /一覧を保存（CSV）/ }).disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: /GeoJSON（高度な形式）/ }).disabled).toBe(true)
    // 件数表記は「全2件中、0件を保存します」
    expect(screen.getAllByText('全2件中、0件を保存します')).toHaveLength(2)
  })

  it('自治体モードではファイル名 prefix に自治体名が含まれる', () => {
    const actions = [
      SET_RESULTS,
      SET_FETCH_META,
      { type: 'SET_SEARCH_SOURCE', payload: 'municipality' },
      {
        type: 'SET_MUNICIPALITY',
        payload: { name: '高槻市', displayName: '高槻市', code: '272078' },
      },
    ]
    render(<Harness preActions={actions}><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /一覧を保存（CSV）/ }))
    expect(exportUtils.downloadCSV).toHaveBeenCalledWith(RESULTS, FETCH_META, 'osm-高槻市')
  })

  it('結果があるとき ODbL 表記が表示される', () => {
    render(<Harness preActions={[SET_RESULTS]}><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByText(/ODbL /)).toBeTruthy()
  })
})

describe('HeaderMenu: まちメモ帳をすべて削除（2段階）', () => {
  it('1回目で確認表示に切り替わり、2回目の押下で実行される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem(), makeMemoItem({ id: 1002, name: 'パン屋B' })]))
    render(<Harness><HeaderMenu /></Harness>)

    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    const wipeBtn = screen.getByRole('menuitem', { name: 'まちメモ帳をすべて削除（2件）' })
    expect(wipeBtn).toBeTruthy()
    expect(wipeBtn.disabled).toBe(false)

    // 1回目: 確認表示に切り替わるだけ（store 不変）
    fireEvent.click(wipeBtn)
    expect(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /まちメモ帳をすべて削除/ })).toBeNull()
    expect(storedItems()).toHaveLength(2)

    // 2回目: 実行。store/localStorage が空になり、成功メッセージが出る
    fireEvent.click(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' }))
    expect(storedItems()).toEqual([])
    expect(screen.getByRole('status').textContent).toContain('すべて削除しました')
    // 実行後はメニューが閉じる（確認状態もリセット）
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('window.confirm を使っていない（confirm のスパイは呼ばれない）', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem()]))
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' }))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('メモ帳が空のときは全消去・書き出し系が disabled になる（読み込みは常に有効） (#79)', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ }).disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をJSONで書き出し/ }).disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をCSVで書き出し/ }).disabled).toBe(true)
    // 読み込みはメモ帳が空でも実行できる（空に読み込む操作）
    expect(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }).disabled).toBe(false)
    // 書き出し系の件数表記は「0件」（無効化の理由を表示）。
    // JSON・CSV・ごみ箱の3項目に表示される
    expect(screen.getAllByText('0件')).toHaveLength(3)
  })
})

describe('HeaderMenu: まちメモ帳の書き出し (#79)', () => {
  function mockUrl() {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  }

  it('JSON書き出し: Blob は serializeMemocho の内容（machi-memocho.json）', async () => {
    mockUrl()
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem({ memo: '訪問済み', rating: 2 })]))
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をJSONで書き出し/ }))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    // items を丸ごと出力するため、rating も自動的に含まれる
    // items は bookId を正規化（欠落 → 'default'）されて書き出され、
    // books（ブックリスト）も ID・名前で書き出される
    expect(JSON.parse(await blob.text())).toEqual({
      app: 'machi-memocho',
      version: 1,
      items: [{ ...makeMemoItem({ memo: '訪問済み', rating: 2 }), bookId: 'default' }],
      books: [{ id: 'default', name: 'デフォルト' }],
    })
    expect(screen.getByRole('status').textContent).toContain('JSONとして書き出しました')
    // 実行後はメニューが閉じる
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('CSV書き出し: 末尾に memo/rating/book 列が付いたCSVになる（通常 toCSV と列構成の違い）', async () => {
    mockUrl()
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem({ memo: 'メモ内容', rating: 3 })]))
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をCSVで書き出し/ }))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const csv = (await URL.createObjectURL.mock.calls[0][0].text())
    const lines = csv.replace(/^\uFEFF/, '').split('\n')
    const headers = lines[0].split(',')
    expect(headers[headers.length - 3]).toBe('memo')
    expect(headers[headers.length - 2]).toBe('rating')
    expect(headers[headers.length - 1]).toBe('book') // book 列は末尾
    const row = lines[1].split(',')
    expect(row[headers.length - 3]).toBe('メモ内容')
    expect(row[headers.length - 2]).toBe('3')
    expect(row[headers.length - 1]).toBe('デフォルト') // bookId 欠落 → デフォルトブック名
    expect(screen.getByRole('status').textContent).toContain('CSVとして書き出しました')
  })
})

describe('HeaderMenu: まちメモ帳の読み込み (#79)', () => {
  function jsonFile(text, name = 'machi-memocho.json') {
    return new File([text], name, { type: 'application/json' })
  }
  function fileInput() {
    return document.querySelector('input[type="file"]')
  }

  it('JSONファイルを渡すと合流し、追加/スキップ件数のメッセージが出る', async () => {
    const existing = makeMemoItem({ memo: '既存メモ' })
    const park = { ...makeMemoItem(), type: 'way', id: 77, name: 'みらい公園', tags: { name: 'みらい公園', leisure: 'park' } }
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([existing]))
    render(<Harness><HeaderMenu /></Harness>)

    const imported = JSON.stringify({
      app: 'machi-memocho',
      version: 1,
      items: [
        makeMemoItem({ memo: '取り込みメモ' }), // キー重複 → スキップ（既存優先）
        park, // 新規 → 追加
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), { target: { files: [jsonFile(imported)] } })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('1件を取り込みました（1件は登録済みのためスキップ）')
    }, { timeout: 5000 })

    const stored = storedItems()
    expect(stored).toHaveLength(2)
    // 既存が優先される（既存メモが上書きされない）
    expect(stored[0].memo).toBe('既存メモ')
    expect(stored[1].name).toBe('みらい公園')
  })

  it('ファイルに含まれるブックリスト（books）はブック保存へ合流される（同一IDは既存を優先）', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem({ memo: '既存メモ' })]))
    localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([
      { id: 'default', name: 'デフォルト', createdAt: null },
      { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z' },
    ]))
    render(<Harness><HeaderMenu /></Harness>)

    const imported = JSON.stringify({
      app: 'machi-memocho',
      version: 1,
      items: [
        { ...makeMemoItem({ id: 3001, name: '新規項目', tags: { name: '新規項目' } }), bookId: 'sb_001' },
      ],
      books: [
        { id: 'sb_001', name: 'カフェ（取り込み側）' }, // 同一ID → 既存の名前を優先
        { id: 'sb_002', name: '公園' }, // 新規 → 末尾に追加
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), { target: { files: [jsonFile(imported)] } })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('1件を取り込みました')
    }, { timeout: 5000 })

    // ブックリストが復元される: 同一IDは既存を優先し、新規は末尾に追加される
    // （正規化で public: false が付く）
    expect(JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))).toEqual([
      { id: 'default', name: 'デフォルト', createdAt: null, public: false },
      { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z', public: false },
      { id: 'sb_002', name: '公園', createdAt: null, public: false },
    ])
  })

  it('すべてが重複の場合は「新しい項目はありません」メッセージが出る', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem()]))
    render(<Harness><HeaderMenu /></Harness>)

    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), {
      target: { files: [jsonFile(JSON.stringify({ app: 'machi-memocho', version: 1, items: [makeMemoItem()] }))] },
    })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('新しい項目はありません（1件は登録済みのためスキップ）')
    }, { timeout: 5000 })
    // 内容が変わらない
    expect(storedItems()).toEqual([makeMemoItem()])
  })

  it('JSONでないファイルではエラーメッセージが出て内容が変わらない', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem()]))
    render(<Harness><HeaderMenu /></Harness>)

    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), { target: { files: [jsonFile('これはJSONではありません')] } })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('読み込みに失敗しました')
    }, { timeout: 5000 })
    expect(screen.getByRole('status').textContent).toContain('無効な JSON')
    // エラーは ⚠️ アイコン付きで表示される
    expect(screen.getByRole('status').textContent).toContain('⚠️')
    // 内容が変わらない
    expect(storedItems()).toEqual([makeMemoItem()])
  })

  it('読み込みの結果はメニューの位置に表示され、✕（メッセージを閉じる）で消せる (#80)', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem()]))
    render(<Harness><HeaderMenu /></Harness>)

    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), {
      target: { files: [jsonFile(JSON.stringify({ app: 'machi-memocho', version: 1, items: [makeMemoItem({ id: 2002, name: '新規項目' })] }))] },
    })

    // 結果メッセージがメニューの位置に表示される（メニューは閉じた状態）
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('1件を取り込みました')
    }, { timeout: 5000 })
    expect(screen.queryByRole('menuitem')).toBeNull()
    // 成功は ✓ アイコン付き
    expect(screen.getByRole('status').textContent).toContain('✓')
    // ✕ ボタンでメッセージを閉じられる
    fireEvent.click(screen.getByRole('button', { name: 'メッセージを閉じる' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('形式が一致しないファイル（app が違う）でもエラーで内容が変わらない', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem()]))
    render(<Harness><HeaderMenu /></Harness>)

    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), {
      target: { files: [jsonFile(JSON.stringify({ app: 'other-app', version: 1, items: [makeMemoItem()] }))] },
    })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('読み込みに失敗しました')
    }, { timeout: 5000 })
    expect(storedItems()).toEqual([makeMemoItem()])
  })

  // (ピースH) 上限（100冊）到達時のインポート
  it('上限（100冊）に達していると、ファイルの冊子は作られずそのメモは「デフォルト」に入る', async () => {
    // デフォルト＋99冊（合計100冊）をシード
    const books = [{ id: 'default', name: 'デフォルト', createdAt: null }]
    for (let i = 1; i < 100; i += 1) {
      books.push({ id: `sb_${String(i).padStart(3, '0')}`, name: `カテゴリ${i}`, createdAt: null })
    }
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([]))
    localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify(books))
    render(<Harness><HeaderMenu /></Harness>)

    const imported = JSON.stringify({
      app: 'machi-memocho',
      version: 1,
      items: [
        { ...makeMemoItem({ id: 3001, name: '博物館' }), bookId: 'sb_new1' },
        { ...makeMemoItem({ id: 3002, name: '観測所' }), bookId: 'sb_new2' },
      ],
      books: [
        { id: 'sb_new1', name: '新規1' },
        { id: 'sb_new2', name: '新規2' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), { target: { files: [jsonFile(imported)] } })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('2件を取り込みました')
    }, { timeout: 5000 })

    // 冊子は100冊のまま（ファイルの新しい冊子は作られない）
    expect(JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))).toHaveLength(100)
    // メモ自体は取り込まれ、bookId は「デフォルト」に落ちる
    const stored = storedItems()
    expect(stored).toHaveLength(2)
    expect(stored.every((item) => item.bookId === 'default')).toBe(true)
  })

  it('上限手前（99冊）ならファイルの冊子のうち1冊分までは作られる', async () => {
    // デフォルト＋98冊（合計99冊）をシード
    const books = [{ id: 'default', name: 'デフォルト', createdAt: null }]
    for (let i = 1; i < 99; i += 1) {
      books.push({ id: `sb_${String(i).padStart(3, '0')}`, name: `カテゴリ${i}`, createdAt: null })
    }
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([]))
    localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify(books))
    render(<Harness><HeaderMenu /></Harness>)

    const imported = JSON.stringify({
      app: 'machi-memocho',
      version: 1,
      items: [
        { ...makeMemoItem({ id: 3001, name: '博物館' }), bookId: 'sb_new1' },
        { ...makeMemoItem({ id: 3002, name: '観測所' }), bookId: 'sb_new2' },
      ],
      books: [
        { id: 'sb_new1', name: '新規1' },
        { id: 'sb_new2', name: '新規2' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳を読み込む/ }))
    fireEvent.change(fileInput(), { target: { files: [jsonFile(imported)] } })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('2件を取り込みました')
    }, { timeout: 5000 })

    // 100 冊目として sb_new1 だけが作成され、sb_new2 は作られない
    const storedBooks = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(storedBooks).toHaveLength(100)
    expect(storedBooks.some((b) => b.id === 'sb_new1')).toBe(true)
    expect(storedBooks.some((b) => b.id === 'sb_new2')).toBe(false)

    // sb_new1 のメモはそのまま、sb_new2 のメモは「デフォルト」に入る
    const stored = storedItems()
    expect(stored.find((item) => item.id === 3001).bookId).toBe('sb_new1')
    expect(stored.find((item) => item.id === 3002).bookId).toBe('default')
  })
})

describe('HeaderMenu: ごみ箱（論理削除）', () => {
  const TRASHED = () => makeMemoItem({ id: 1002, name: 'パン屋B', deletedAt: '2026-06-15T10:30:00.000Z' })

  it('「ごみ箱」を押すと SET_MEMOCHO_VIEW(trash) が dispatch され、メニューが閉じる', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem(), TRASHED()]))
    let dispatchMock
    render(
      <AppContext.Provider value={{ state: createInitialState(), dispatch: (dispatchMock = vi.fn()) }}>
        <HeaderMenu />
      </AppContext.Provider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    const trashBtn = screen.getByRole('menuitem', { name: /ごみ箱/ })
    // 件数表記はごみ箱の件数を反映する
    expect(trashBtn.textContent).toContain('1件')

    fireEvent.click(trashBtn)
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_MEMOCHO_VIEW', payload: 'trash' })
    // 操作後はメニューが閉じる（シェル側がメモ帳タブへ自動切替する）
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('CSV書き出し: ごみ箱のアイテム（deletedAt 付き）は除外される', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeMemoItem({ memo: 'アクティブ', rating: 3 }),
      TRASHED(),
    ]))
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をCSVで書き出し/ }))

    const csv = await URL.createObjectURL.mock.calls[0][0].text()
    expect(csv).toContain('テスト珈琲店')
    expect(csv).not.toContain('パン屋B') // ごみ箱のアイテムは除外
    // 件数表記はアクティブのみ（1件）
    expect(screen.getByRole('status').textContent).toContain('1件をCSVとして書き出しました')
  })

  it('JSON書き出し: ごみ箱のアイテムも含めて全件を含む', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeMemoItem({ memo: 'アクティブ' }),
      TRASHED(),
    ]))
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をJSONで書き出し/ }))

    const parsed = JSON.parse(await URL.createObjectURL.mock.calls[0][0].text())
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items.some((i) => i.deletedAt)).toBe(true) // ごみ箱も保持
  })

  it('すべて削除: ごみ箱のアイテムも含めて全件が完全削除される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem(), TRASHED()]))
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))

    // 件数表記はごみ箱を含んだ全件（2件）
    fireEvent.click(screen.getByRole('menuitem', { name: 'まちメモ帳をすべて削除（2件）' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' }))

    expect(storedItems()).toEqual([]) // ごみ箱のアイテムも消える
    expect(screen.getByRole('status').textContent).toContain('2件すべて削除しました')
  })

  it('メモ帳が空のとき「ごみ箱」は有効（件数表記は0件）', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    const trashBtn = screen.getByRole('menuitem', { name: /ごみ箱/ })
    expect(trashBtn.disabled).toBe(false) // 空でも開ける
    expect(trashBtn.textContent).toContain('0件')
  })
})

describe('HeaderMenu: 外タップでの閉幕', () => {
  it('メニュー外をタップすると閉じ、2段階確認の状態もリセットされる', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeMemoItem()]))
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ }))
    expect(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' })).toBeTruthy()

    // メニュー外（body）をタップ
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem')).toBeNull()

    // 再開すると確認状態はリセット済み（「すべて削除」が戻っている）
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '本当にすべて削除しますか？' })).toBeNull()
    expect(storedItems()).toHaveLength(1)
  })
})
