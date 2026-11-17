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
 * - メモ帳0件のとき全消去は disabled
 * - メニュー外タップで閉じ、2段階確認の状態もリセットされる
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import HeaderMenu from '../HeaderMenu'
import { AppContext } from '../../context/AppContext'
import { appReducer, createInitialState } from '../../state/appReducer'
import * as exportUtils from '../../utils/export'
import { resetMemochoStore } from '../../hooks/useMemocho'
import { MEMOCHO_STORAGE_KEY } from '../../utils/memocho'

// downloadCSV / downloadGeoJSON をモック（ファイル生成・アンカー操作を回避）
vi.mock('../../utils/export', () => ({
  downloadCSV: vi.fn(),
  downloadGeoJSON: vi.fn(),
}))

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
})

describe('HeaderMenu: メニューの開閉', () => {
  it('☰ ボタンが表示され、閉じた状態ではメニュー項目が無い', () => {
    render(<Harness><HeaderMenu /></Harness>)
    const btn = screen.getByRole('button', { name: 'メニュー' })
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('☰ クリックでメニューが開き、保存系・全消去の3項目が表示される', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('button', { name: 'メニュー' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitem', { name: /一覧を保存（CSV）/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /GeoJSON（高度な形式）/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ })).toBeTruthy()
  })

  it('再度 ☰ をクリックするとメニューが閉じる', () => {
    render(<Harness><HeaderMenu /></Harness>)
    const btn = screen.getByRole('button', { name: 'メニュー' })
    fireEvent.click(btn)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(3)
    fireEvent.click(btn)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
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

  it('メモ帳が空のときは全消去が disabled になる', () => {
    render(<Harness><HeaderMenu /></Harness>)
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ }).disabled).toBe(true)
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
