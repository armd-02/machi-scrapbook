// @vitest-environment jsdom
/**
 * (スクラップブック) ピース2: メモ帳画面のスクラップブックバーとブック絞り込みのテスト
 *
 * 検証内容:
 * - バーの表示: スクラップブックセレクト（「すべて」＋「デフォルト」の選択肢）、
 *   「カテゴリ管理」ドロップダウンボタン。ごみ箱ビューにはバーを出さない
 * - ブック絞り込み: ブックの選択でリストがそのブックのメモだけに絞られ、
 *   件数表示は「全n件中、m件を表示」になる。従来のフィルタ条件と AND 結合される
 *   - bookId 無いアイテムは「デフォルト」への所属とみなす
 *   - 選択は localStorage（machi-memocho-book-filter）に保存され次回も維持される
 *   - stale な選択（存在しないブック）は「すべて」にフォールバック
 *   - 「フィルタをクリア」（✕）はブック選択も「すべて」に戻す
 *   - メモマップのピンも同じブック絞り込みの対象になる
 * - カテゴリ管理（「カテゴリ管理」ボタン）:
 *   - 新規作成: 名前を入力して作成。作られたブックが選択状態になり、セレクトの選択肢に現れる
 *   - 名前を変更: 選択中のブックの名前が変わる（「すべて」選択中は不可）
 *   - 削除: 2段階確認。そのブックのメモ（ごみ箱含む）はすべて「デフォルト」へ移動し、
 *     ブックと選択肢が消える。「デフォルト」は削除できない
 *   - 公開設定: 選択中ブックの public を切り替える（「すべて」選択中は不可）。
 *     ボタンラベルは現在状態を示す（公開なら「非公開にする」、非公開なら「公開にする」）。
 *     タップで即座に保存されメニューが閉じる。「デフォルト」ブックも対象
 *   - 公開ブックはセレクトのラベルに「（公開）」が付く
 *   - メニュー外をタップするとメニューが閉じる
 * - カテゴリ編集モード: 「カテゴリ管理」メニュー末尾の「メモのカテゴリを変更」で
 *   モード ON にできる（メニューは閉じる）。モード ON のとき「カテゴリ管理」ボタンの
 *   ラベルは「カテゴリ編集中」になり、ボタンを押すとモードを終了する（メニューは開かない）
 * - カテゴリ編集モード（ピース3・カード側）:
 *   - モード OFF のときはカードにカテゴリセレクトは出ない
 *   - モード ON のときは各カードに「カテゴリ」ラベル＋セレクトが出て、
 *     現在のブック名が表示される（bookId 無い・不明なものはデフォルト）
 *   - 変更は即座に保存される（localStorage に反映され、表示も更新）
 *   - 特定ブック表示中に別のブックへ移すとカードはその場で一覧から消える
 *   - 「すべて」表示中は消えず、所属表示だけが変わる
 *   - ブックの改名でカード側の表示も更新される
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import MemochoSection from '../MemochoSection'
import { resetMemochoStore } from '../../../hooks/useMemocho'
import { resetScrapbooksStore } from '../../../hooks/useScrapbooks'
import { MEMOCHO_STORAGE_KEY } from '../../../utils/memocho'
import { SCRAPBOOKS_STORAGE_KEY } from '../../../utils/scrapbooks'
import { AppContext } from '../../../context/AppContext'
import { appReducer, createInitialState } from '../../../state/appReducer'

// (スクラップブックバー) 選択中のブックを保存するキー（MemochoSection.jsx 内で定義）
const BOOK_FILTER_KEY = 'machi-memocho-book-filter'

vi.mock('../../../utils/mapCapture', () => ({
  captureMapImage: vi.fn(async () => 'data:image/jpeg;base64,QUJD'),
}))

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

function makeItem(overrides = {}) {
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

function seedBooks(books) {
  localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify(books))
}

function seedMemos(items) {
  localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify(items))
}

function SectionHarness(props) {
  const [state, dispatch] = React.useReducer(appReducer, createInitialState())
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <MemochoSection {...props} />
    </AppContext.Provider>
  )
}

function renderSection(overrides = {}) {
  return render(<SectionHarness {...overrides} />)
}

const getMemoMap = () => mockState.api._state.maps.at(-1)

// (スクラップブックバー) ブック切替セレクト（aria-label「スクラップブック」）
const bookSelect = () => screen.getByRole('combobox', { name: 'スクラップブック' })
const selectBook = (id) => fireEvent.change(bookSelect(), { target: { value: id } })
const optionTexts = () => [...bookSelect().options].map((o) => o.textContent)

beforeEach(() => {
  localStorage.clear()
  resetMemochoStore()
  resetScrapbooksStore()
  if (mockState.api) mockState.api.resetState()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  resetMemochoStore()
  resetScrapbooksStore()
  vi.restoreAllMocks()
})

describe('バーの表示', () => {
  it('一覧ビューにはセレクト（「すべて」「デフォルト」の選択肢）と「カテゴリ管理」ボタンが表示される', () => {
    seedMemos([makeItem()])
    renderSection()

    expect(optionTexts()).toEqual(['すべて', 'デフォルト'])
    expect(bookSelect().value).toBe('all')
    expect(screen.getByRole('button', { name: 'カテゴリ管理' })).toBeTruthy()
    expect(screen.getByText('カテゴリ管理▾')).toBeTruthy()
  })

  it('作成したブックはセレクトの選択肢に現れる（デフォルトを先頭に並ぶ）', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }, { id: 'sb_park', name: '公園' }])
    seedMemos([makeItem()])
    renderSection()

    expect(optionTexts()).toEqual(['すべて', 'デフォルト', 'カフェ', '公園'])
  })

  it('ごみ箱ビューにはバーは出ない', () => {
    seedMemos([makeItem({ deletedAt: '2026-01-02T00:00:00.000Z' })])
    renderSection({ view: 'trash', onViewChange: vi.fn() })

    expect(screen.queryByRole('combobox', { name: 'スクラップブック' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'カテゴリ管理' })).toBeNull()
  })

  // (ピースI) 2行構成: 1行目はセレクト＋「カテゴリ管理」ボタン、2行目は同期ボタン＋
  // 最終同期表示。セレクトと同期ボタンが別の行（別のコンテナ）にあることを確認
  it('セレクトと同期ボタンは別の行（別のコンテナ）にある（2行構成）', () => {
    seedMemos([makeItem()])
    renderSection()

    const select = bookSelect()
    const syncBtn = screen.getByRole('button', { name: '公開地図へ反映' })

    // 1行目: セレクト＋カテゴリ管理（ドロップダウン）
    const row1 = select.closest('div.flex')
    expect(row1).toBeTruthy()
    expect(row1.contains(screen.getByRole('button', { name: 'カテゴリ管理' }))).toBe(true)
    expect(row1.contains(syncBtn)).toBe(false)

    // 2行目: 同期ボタン＋未同期表示。セレクトは入らない
    const row2 = syncBtn.closest('div.flex')
    expect(row2).toBeTruthy()
    expect(row2).not.toBe(row1)
    expect(row2.contains(screen.getByText('未同期'))).toBe(true)
    expect(row2.contains(select)).toBe(false)
  })
})

describe('ブック絞り込み', () => {
  it('ブックを選択するとそのブックのメモだけ表示される（件数表示・bookId 無いものはデフォルト扱い）', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([
      makeItem({ bookId: 'sb_cafe' }),
      makeItem({ id: 1002, name: 'デフォメモ店', tags: { name: 'デフォメモ店' } }),
    ])
    renderSection()

    // 初期は「すべて」: 両方表示
    expect(bookSelect().value).toBe('all')
    expect(screen.getByText('2件')).toBeTruthy()

    // 「カフェ」を選択
    selectBook('sb_cafe')
    expect(bookSelect().value).toBe('sb_cafe')
    expect(screen.getByText('全2件中、1件を表示')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'テスト珈琲店' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'デフォメモ店' })).toBeNull()

    // 「すべて」に戻すと両方表示される
    selectBook('all')
    expect(screen.getByText('2件')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'デフォメモ店' })).toBeTruthy()
  })

  it('選択は localStorage に保存され、次回開いたときも維持される', async () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([
      makeItem({ bookId: 'sb_cafe' }),
      makeItem({ id: 1002, name: 'デフォメモ店', tags: { name: 'デフォメモ店' } }),
    ])
    renderSection()

    selectBook('sb_cafe')
    expect(localStorage.getItem(BOOK_FILTER_KEY)).toBe('sb_cafe')

    cleanup()

    // 再レンダリング: 保存された選択が復元される
    renderSection()
    expect(bookSelect().value).toBe('sb_cafe')
    expect(screen.getByText('全2件中、1件を表示')).toBeTruthy()
  })

  it('stale な選択（存在しないブック）は「すべて」にフォールバックする', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    localStorage.setItem(BOOK_FILTER_KEY, 'sb_gone')
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    expect(bookSelect().value).toBe('all')
    expect(screen.getByText('1件')).toBeTruthy()
  })

  it('ブック絞り込みと従来のフィルタは AND 結合される', () => {
    seedBooks([{ id: 'sb_park', name: '公園' }])
    seedMemos([
      makeItem({
        id: 2001,
        name: 'みらい公園',
        tags: { name: 'みらい公園', leisure: 'park' },
        bookId: 'sb_park',
      }),
      makeItem({
        id: 2002,
        name: 'ちゅうでん公園',
        tags: { name: 'ちゅうでん公園', leisure: 'park' },
        bookId: 'sb_park',
      }),
    ])
    renderSection()

    // 「公園」ブックを選択 → 2件
    selectBook('sb_park')
    expect(screen.getByText('全2件中、2件を表示')).toBeTruthy()

    // キーワードで「みらい」に絞り込む → 1件のみ
    fireEvent.change(screen.getByRole('textbox', { name: '名前・メモで絞り込む' }), {
      target: { value: 'みらい' },
    })
    expect(screen.getByText('全2件中、1件を表示')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'みらい公園' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'ちゅうでん公園' })).toBeNull()
  })

  it('「フィルタをクリア」（✕）はブック選択も「すべて」に戻す', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([
      makeItem({ bookId: 'sb_cafe' }),
      makeItem({ id: 1002, name: 'デフォメモ店', tags: { name: 'デフォメモ店' } }),
    ])
    renderSection()

    selectBook('sb_cafe')
    // ブック選択だけでも「絞り込み中」なのでクリアシンボルが出る
    fireEvent.click(screen.getByRole('button', { name: 'フィルタをクリア' }))

    expect(screen.getByText('2件')).toBeTruthy()
    expect(bookSelect().value).toBe('all')
    expect(localStorage.getItem(BOOK_FILTER_KEY)).toBe('all')
  })

  it('ブック選択中はメモマップのピンもそのブック分だけになる', async () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([
      makeItem({ bookId: 'sb_cafe' }),
      makeItem({
        id: 1002,
        name: 'みらい公園',
        tags: { name: 'みらい公園', leisure: 'park' },
      }),
    ])
    renderSection()

    // 「カフェ」を選択して地図を開く
    selectBook('sb_cafe')
    fireEvent.click(screen.getByRole('button', { name: /メモマップ.*地図を表示/ }))
    const map = getMemoMap()

    await waitFor(() => {
      expect(map._lastGeoJSON.data.features).toHaveLength(1)
    })
    expect(map._lastGeoJSON.data.features[0].properties.key).toBe('node/1001')
  })
})

describe('カテゴリ管理（新規作成・名前を変更・削除）', () => {
  it('新規作成: 名前を入力して作成すると、新ブックが選択肢に現れ選択状態になる', () => {
    seedMemos([makeItem()])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    expect(screen.getByRole('menu', { name: 'カテゴリ管理' })).toBeTruthy()

    // 名前が空だと「作成」は disabled
    const createBtn = screen.getByRole('menuitem', { name: '作成' })
    expect(createBtn.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('新規カテゴリの名前'), { target: { value: '  桜  ' } })
    expect(createBtn.disabled).toBe(false)
    fireEvent.click(createBtn)

    // 新ブック「桜」が選択肢に現れ選択状態に（前後空白はトリムされる）
    expect(optionTexts()).toEqual(['すべて', 'デフォルト', '桜'])
    // localStorage に保存される
    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.some((b) => b.name === '桜' && b.id !== 'default')).toBe(true)
    // 選択も保存され、メニューは閉じる
    expect(localStorage.getItem(BOOK_FILTER_KEY)).toBe(books.find((b) => b.name === '桜').id)
    expect(screen.queryByRole('menu')).toBeNull()
    // リストは新ブックに絞られる（該当メモがまだ無いので 0 件）
    expect(screen.getByText('全1件中、0件を表示')).toBeTruthy()
  })

  // (ピースH) ブック数の上限（デフォルト含む 100 冊）
  it('上限（100冊）に達しているとき、作成はできず上限の案内が出る', () => {
    // デフォルト＋99冊のブックをシード（合計100冊）
    const books = [{ id: 'default', name: 'デフォルト', createdAt: null }]
    for (let i = 1; i < 100; i += 1) {
      books.push({ id: `sb_${String(i).padStart(3, '0')}`, name: `カテゴリ${i}`, createdAt: null })
    }
    seedBooks(books)
    seedMemos([makeItem()])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    // 作成の入力欄・ボタンが disabled
    const createInput = screen.getByLabelText('新規カテゴリの名前')
    expect(createInput.disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: '作成' }).disabled).toBe(true)

    // 上限の案内が表示される
    expect(screen.getByText(/冊子の上限（100冊）に達しているため/)).toBeTruthy()

    // 作成できない（ブック数は100冊のまま）
    fireEvent.change(createInput, { target: { value: 'もう一冊' } })
    expect(JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))).toHaveLength(100)
  })

  it('名前を変更: 選択中のブックの名前が変更され、選択状態はそのまま維持される', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    // 「カフェ」を選択してからメニューを開く（入力欄に現行名が入る）
    selectBook('sb_cafe')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    const renameInput = screen.getByLabelText('カテゴリの名前')
    expect(renameInput.value).toBe('カフェ')

    fireEvent.change(renameInput, { target: { value: 'コーヒー' } })
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))

    // 名前が変わり、選択状態（sb_cafe）は維持される
    expect(optionTexts()).toEqual(['すべて', 'デフォルト', 'コーヒー'])
    expect(bookSelect().value).toBe('sb_cafe')
    // localStorage に反映される
    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.find((b) => b.id === 'sb_cafe').name).toBe('コーヒー')
  })

  it('名前を変更: 「すべて」選択中は入力欄と変更ボタンが disabled になる', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    expect(screen.getByLabelText('カテゴリの名前').disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: '変更' }).disabled).toBe(true)
    expect(screen.getByText('変更するブックを選択してください。')).toBeTruthy()
  })

  it('削除: 2段階确认后、そのブックのメモは「デフォルト」へ移動しブックが消える', async () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([
      makeItem({ bookId: 'sb_cafe' }),
      makeItem({ id: 1002, bookId: 'sb_cafe', name: 'カフェ二号店', tags: { name: 'カフェ二号店', amenity: 'cafe' } }),
      makeItem({ id: 1003, name: 'デフォメモ店', tags: { name: 'デフォメモ店' } }),
    ])
    renderSection()

    // 「カフェ」を選択してメニューを開く
    selectBook('sb_cafe')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    // 1回目: 確認メッセージが出る（まだ削除されない）
    fireEvent.click(screen.getByRole('menuitem', { name: '「カフェ」を削除' }))
    expect(screen.getByText('「カフェ」を削除しますか？メモ2件が「デフォルト」へ移動します。')).toBeTruthy()
    expect(bookSelect().value).toBe('sb_cafe')

    // 2回目: 実行
    fireEvent.click(screen.getByRole('menuitem', { name: '削除する' }))
    await waitFor(() => {
      expect(optionTexts()).toEqual(['すべて', 'デフォルト'])
    })

    // メモは「デフォルト」へ移動された（localStorage を直接検証）
    const items = JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
    const moved = items.filter((it) => [1001, 1002].includes(it.id))
    expect(moved).toHaveLength(2)
    for (const it of moved) {
      expect(it.bookId).toBe('default')
    }
    // ブックは削除され、選択は「すべて」に戻っている
    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.some((b) => b.id === 'sb_cafe')).toBe(false)
    expect(localStorage.getItem(BOOK_FILTER_KEY)).toBe('all')
    // 3件とも表示される
    expect(screen.getByText('3件')).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('削除: 「キャンセル」で確認を解除でき、何も削除されない', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    selectBook('sb_cafe')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '「カフェ」を削除' }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'キャンセル' }))

    // 確認メッセージが消え、ブックと選択はそのまま
    expect(screen.queryByText(/を削除しますか？/)).toBeNull()
    expect(bookSelect().value).toBe('sb_cafe')
    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.some((b) => b.id === 'sb_cafe')).toBe(true)
  })

  it('削除: 「デフォルト」は削除できない（案内文が表示される）', () => {
    seedMemos([makeItem()])
    renderSection()

    // 「デフォルト」を選択してメニューを開く
    selectBook('default')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    expect(screen.getByText('「デフォルト」は削除できません（名前変更はできます）。')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /を削除/ })).toBeNull()
  })

  it('削除: 「すべて」選択中は削除できない（案内文が表示される）', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    expect(screen.getByText('削除するブックを選択してください。')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /を削除/ })).toBeNull()
  })

  it('メニュー外をタップするとメニューが閉じる', () => {
    seedMemos([makeItem()])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('公開設定（CMM への公開）', () => {
  it('公開ブックはセレクトのラベルに「（公開）」が付く', () => {
    seedBooks([
      { id: 'sb_cafe', name: 'カフェ', public: true },
      { id: 'sb_park', name: '公園' },
    ])
    seedMemos([makeItem()])
    renderSection()

    expect(optionTexts()).toEqual(['すべて', 'デフォルト', 'カフェ（公開）', '公園'])
  })

  it('公開設定: 非公開ブックは「公開にする」ボタンが現れ、タップで公開される', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    selectBook('sb_cafe')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    // 現在非公開なので「公開にする」が出る
    expect(screen.getByRole('menuitem', { name: '公開にする' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '非公開にする' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '公開にする' }))

    // public: true が保存され、ラベルに「（公開）」が付く、メニューは閉じる
    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.find((b) => b.id === 'sb_cafe').public).toBe(true)
    expect(optionTexts()).toEqual(['すべて', 'デフォルト', 'カフェ（公開）'])
    expect(bookSelect().value).toBe('sb_cafe') // 選択状態は維持される
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('公開設定: 公開ブックは「非公開にする」ボタンが現れ、タップで非公開になる', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ', public: true }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    selectBook('sb_cafe')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    expect(screen.getByRole('menuitem', { name: '非公開にする' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '公開にする' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '非公開にする' }))

    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.find((b) => b.id === 'sb_cafe').public).toBe(false)
    expect(optionTexts()).toEqual(['すべて', 'デフォルト', 'カフェ'])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('公開設定: 「デフォルト」ブックも公開設定を変更できる', () => {
    seedMemos([makeItem()])
    renderSection()

    selectBook('default')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    fireEvent.click(screen.getByRole('menuitem', { name: '公開にする' }))

    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.find((b) => b.id === 'default').public).toBe(true)
    expect(optionTexts()).toEqual(['すべて', 'デフォルト（公開）'])
    expect(bookSelect().value).toBe('default')
  })

  it('公開設定: 「すべて」選択中は変更できない（案内文が表示される）', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))

    expect(screen.getByText('公開設定を変更するブックを選択してください。')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '公開にする' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '非公開にする' })).toBeNull()
  })

  it('新規作成したブックは非公開（public: false）で作られる', () => {
    seedMemos([makeItem()])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    fireEvent.change(screen.getByLabelText('新規カテゴリの名前'), { target: { value: '桜' } })
    fireEvent.click(screen.getByRole('menuitem', { name: '作成' }))

    const books = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(books.find((b) => b.name === '桜').public).toBe(false)
    expect(optionTexts()).toEqual(['すべて', 'デフォルト', '桜'])
  })
})

describe('カテゴリ管理（カテゴリ編集モード）', () => {
  it('メニュー末尾の「メモのカテゴリを変更」でモード ON にでき、メニューは閉じる', () => {
    seedMemos([makeItem()])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    expect(screen.getByRole('menu', { name: 'カテゴリ管理' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'メモのカテゴリを変更' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: 'メモのカテゴリを変更' }))

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'カテゴリ編集中' })).toBeTruthy()
  })

  it('編集モード OFF のときはボタンを押すとメニューが開く', () => {
    seedMemos([makeItem()])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    expect(screen.getByRole('menu', { name: 'カテゴリ管理' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('モード ON のときはボタンを押すとモードを終了し、メニューは開かない', () => {
    seedMemos([makeItem()])
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'メモのカテゴリを変更' }))

    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ編集中' }))

    expect(screen.getByRole('button', { name: 'カテゴリ管理' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'カテゴリ編集中' })).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('カテゴリ編集モード（ピース3・カード側のブック変更）', () => {
  // カードのカテゴリセレクトは aria-label「{施設名}のカテゴリを変更」
  const cardSelect = (name) => screen.getByRole('combobox', { name: `${name}のカテゴリを変更` })
  const selectedText = (select) => select.options[select.selectedIndex].text

  // 「カテゴリ管理」メニューから「メモのカテゴリを変更」で編集モード ON
  const enterEditMode = () => {
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'メモのカテゴリを変更' }))
  }

  it('モード OFF のときはカードにカテゴリセレクトは出ない', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    expect(screen.queryByRole('combobox', { name: /のカテゴリを変更/ })).toBeNull()
  })

  it('モード ON のときは各カードに現在のブック名が表示されたセレクトが出る', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([
      makeItem({ bookId: 'sb_cafe' }),
      makeItem({ id: 1002, name: 'デフォメモ店', tags: { name: 'デフォメモ店' } }),
    ])
    renderSection()

    enterEditMode()

    const selects = screen.getAllByRole('combobox', { name: /のカテゴリを変更/ })
    expect(selects).toHaveLength(2)
    // 1件目（bookId: sb_cafe）は「カフェ」、2件目（bookId 無し）は「デフォルト」
    expect(selects.map(selectedText)).toEqual(['カフェ', 'デフォルト'])
  })

  it('bookId が books に無い（例: 読み込みデータ）ものはセレクトでデフォルトになる', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_gone' })])
    renderSection()

    enterEditMode()
    expect(selectedText(cardSelect('テスト珈琲店'))).toBe('デフォルト')
  })

  it('変更は即座に保存され（localStorage 反映）、表示も更新される', () => {
    seedBooks([
      { id: 'sb_cafe', name: 'カフェ' },
      { id: 'sb_park', name: '公園' },
    ])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    enterEditMode()
    fireEvent.change(cardSelect('テスト珈琲店'), { target: { value: 'sb_park' } })

    // localStorage に反映される
    const items = JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
    expect(items[0].bookId).toBe('sb_park')
    // セレクトの表示も「公園」に更新される
    expect(selectedText(cardSelect('テスト珈琲店'))).toBe('公園')
  })

  it('特定ブック表示中に別のブックへ移すと、カードはその場で一覧から消える', () => {
    seedBooks([
      { id: 'sb_cafe', name: 'カフェ' },
      { id: 'sb_park', name: '公園' },
    ])
    seedMemos([
      makeItem({ bookId: 'sb_cafe' }),
      makeItem({ id: 1002, bookId: 'sb_cafe', name: 'カフェ二号店', tags: { name: 'カフェ二号店', amenity: 'cafe' } }),
    ])
    renderSection()

    // 「カフェ」表示中にモードを ON
    selectBook('sb_cafe')
    enterEditMode()

    // 1件目を「公園」へ移動
    fireEvent.change(cardSelect('テスト珈琲店'), { target: { value: 'sb_park' } })

    // 移動したカードは消え、残りのカードは表示される
    expect(screen.queryByRole('heading', { name: 'テスト珈琲店' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'カフェ二号店' })).toBeTruthy()
    expect(screen.getByText('全2件中、1件を表示')).toBeTruthy()
  })

  it('「すべて」表示中は移動してもカードは消えず、所属表示だけが変わる', () => {
    seedBooks([
      { id: 'sb_cafe', name: 'カフェ' },
      { id: 'sb_park', name: '公園' },
    ])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    // 「すべて」表示（初期状態）でモードを ON
    enterEditMode()
    fireEvent.change(cardSelect('テスト珈琲店'), { target: { value: 'sb_park' } })

    // カードは表示され続け、セレクトの表示だけ「公園」になる
    expect(screen.getByRole('heading', { name: 'テスト珈琲店' })).toBeTruthy()
    expect(selectedText(cardSelect('テスト珈琲店'))).toBe('公園')
    expect(screen.getByText('1件')).toBeTruthy()
  })

  it('ブックの改名でカード側のセレクト表示も更新される', () => {
    seedBooks([{ id: 'sb_cafe', name: 'カフェ' }])
    seedMemos([makeItem({ bookId: 'sb_cafe' })])
    renderSection()

    // ブックを改名（「カフェ」を選択 → メニュー → 名前を変更）
    selectBook('sb_cafe')
    fireEvent.click(screen.getByRole('button', { name: 'カテゴリ管理' }))
    fireEvent.change(screen.getByLabelText('カテゴリの名前'), { target: { value: 'コーヒー' } })
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))

    // 編集モード ON → カード側のセレクト表示も新名に更新される（bookId 自体は不変）
    enterEditMode()
    expect(selectedText(cardSelect('テスト珈琲店'))).toBe('コーヒー')
    expect(JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))[0].bookId).toBe('sb_cafe')
  })
})
