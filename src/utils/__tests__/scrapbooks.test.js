// @vitest-environment jsdom
/**
 * スクラップブック（メモの分類）データ層（scrapbooks.js）のテスト（Piece 1: データ層）
 * - loadScrapbooks: 未保存・壊れたJSON・デフォルトブック常時先頭・改名defaultの保持
 * - saveScrapbooks
 * - createBook: 前後空白トリム・空名拒否・重複名の許可
 * - renameBook / deleteBook: デフォルト削除不可・空名・未知ID
 * - normalizeBookId: 欠落・不正 → 'default'
 * - bookNameOf: 解決・デフォルトフォールバック
 * - normalizeBookEntries / mergeScrapbooks: 検証・合流（既存優先）
 * - public（公開設定）: 正規化（欠落・型違い → false）・setBookPublic の切替
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  SCRAPBOOKS_STORAGE_KEY,
  DEFAULT_BOOK_ID,
  DEFAULT_BOOK_NAME,
  defaultBook,
  normalizeBookId,
  generateBookId,
  loadScrapbooks,
  saveScrapbooks,
  createBook,
  renameBook,
  deleteBook,
  bookNameOf,
  normalizeBookEntries,
  mergeScrapbooks,
  setBookPublic,
} from '../scrapbooks'

/** localStorage のインメモリスタブ（memocho.test.js と同じ方式） */
function createLocalStorageStub() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
}

function makeBook(overrides = {}) {
  return {
    id: 'sb_001',
    name: 'カフェ',
    createdAt: '2026-01-01T00:00:00.000Z',
    public: false,
    ...overrides,
  }
}

describe('scrapbooks', () => {
  beforeEach(() => {
    // jsdom の localStorage は getter のみなので defineProperty で差し替える
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageStub(),
      writable: true,
      configurable: true,
    })
  })

  describe('defaultBook / normalizeBookId', () => {
    it('defaultBook は固定ID・デフォルト名・createdAt: null・public: false を返す', () => {
      const book = defaultBook()
      expect(book).toEqual({ id: 'default', name: 'デフォルト', createdAt: null, public: false })
      // 毎回新しいオブジェクト（呼び出し間で共有されない）
      expect(defaultBook()).not.toBe(book)
    })

    it('normalizeBookId: 空でない文字列はそのまま採用する', () => {
      expect(normalizeBookId('default')).toBe('default')
      expect(normalizeBookId('sb_001')).toBe('sb_001')
    })

    it('normalizeBookId: 欠落・空文字・型違いは default に落とす（寛容な方式）', () => {
      for (const bad of [undefined, null, '', 123, true, {}, []]) {
        expect(normalizeBookId(bad)).toBe(DEFAULT_BOOK_ID)
      }
    })
  })

  describe('generateBookId', () => {
    it('sb_ 接頭辞の非空文字列を返す', () => {
      const id = generateBookId()
      expect(typeof id).toBe('string')
      expect(id.startsWith('sb_')).toBe(true)
      expect(id.length).toBeGreaterThan(3)
    })

    it('連続呼び出しで同じIDにならない', () => {
      const ids = new Set(Array.from({ length: 50 }, () => generateBookId()))
      expect(ids.size).toBe(50)
    })
  })

  describe('loadScrapbooks', () => {
    it('未保存ならデフォルトブックのみのリストを返す', () => {
      expect(loadScrapbooks()).toEqual([{ id: 'default', name: 'デフォルト', createdAt: null, public: false }])
    })

    it('壊れたJSONならデフォルトブックのみ', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, '{oops')
      expect(loadScrapbooks()).toEqual([defaultBook()])
    })

    it('配列でなければデフォルトブックのみ', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify({ books: [] }))
      expect(loadScrapbooks()).toEqual([defaultBook()])
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify('ただの文字列'))
      expect(loadScrapbooks()).toEqual([defaultBook()])
    })

    it('有効なエントリはデフォルトブックの後に来る', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([
        makeBook(),
        makeBook({ id: 'sb_002', name: '公園' }),
      ]))
      expect(loadScrapbooks()).toEqual([
        { id: 'default', name: 'デフォルト', createdAt: null, public: false },
        { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z', public: false },
        { id: 'sb_002', name: '公園', createdAt: '2026-01-01T00:00:00.000Z', public: false },
      ])
    })

    it('保存データに改名された default エントリがあれば、その名前で先頭に来る', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([
        makeBook(),
        { id: 'default', name: 'お気に入り', createdAt: null },
      ]))
      const books = loadScrapbooks()
      expect(books[0]).toEqual({ id: 'default', name: 'お気に入り', createdAt: null, public: false })
      expect(books).toHaveLength(2)
    })

    it('id/name が空でない文字列でないエントリを落とす', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([
        makeBook(),
        { id: '', name: '無ID' },
        { id: 'sb_x', name: '' },
        { id: 42, name: '数値ID' },
        null,
        '文字列',
      ]))
      expect(loadScrapbooks()).toEqual([
        { id: 'default', name: 'デフォルト', createdAt: null, public: false },
        { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z', public: false },
      ])
    })

    it('id が重複する場合は先頭のエントリを採用する', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([
        makeBook({ id: 'sb_001', name: '最初' }),
        makeBook({ id: 'sb_001', name: '二番目' }),
      ]))
      const books = loadScrapbooks()
      expect(books.filter((b) => b.id === 'sb_001')).toEqual([
        { id: 'sb_001', name: '最初', createdAt: '2026-01-01T00:00:00.000Z', public: false },
      ])
    })

    it('createdAt が文字列でなければ null に正規化される', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([
        makeBook({ createdAt: 12345 }),
        makeBook({ id: 'sb_002', createdAt: null }),
      ]))
      const books = loadScrapbooks()
      expect(books[1].createdAt).toBe(null)
      expect(books[2].createdAt).toBe(null)
    })

    it('public が無い（または true 以外）ブックは false に正規化され、true は保持される', () => {
      localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([
        makeBook(), // public 欠落 → false
        makeBook({ id: 'sb_002', public: true }), // true は保持
        makeBook({ id: 'sb_003', public: 'yes' }), // 型違い → false
        makeBook({ id: 'sb_004', public: false }), // false はそのまま
      ]))
      const books = loadScrapbooks()
      expect(books[1].public).toBe(false)
      expect(books[2].public).toBe(true)
      expect(books[3].public).toBe(false)
      expect(books[4].public).toBe(false)
    })
  })

  describe('saveScrapbooks', () => {
    it('保存したリストが loadScrapbooks で読める（往復）', () => {
      const books = [defaultBook(), makeBook()]
      saveScrapbooks(books)
      expect(loadScrapbooks()).toEqual(books)
    })

    it('配列以外を渡しても空配列として保存する', () => {
      saveScrapbooks('nope')
      expect(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY)).toBe('[]')
    })
  })

  describe('createBook', () => {
    const books = [defaultBook()]

    it('名前を前後空白トリムして末尾に追加する', () => {
      const next = createBook(books, '  カフェ  ')
      expect(next).toHaveLength(2)
      expect(next[0]).toEqual(books[0]) // 既存はそのまま
      expect(next[1].name).toBe('カフェ')
      expect(next[1].id).not.toBe('default')
      expect(next[1].id.startsWith('sb_')).toBe(true)
      expect(next[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO 文字列
      expect(next[1].public).toBe(false) // 新規ブックは非公開が既定
      expect(next).not.toBe(books) // 新しい配列
    })

    it('空・空白のみの名前は拒否する（リストをそのまま返す）', () => {
      expect(createBook(books, '')).toBe(books)
      expect(createBook(books, '   ')).toBe(books)
    })

    it('名前が文字列以外なら拒否する', () => {
      expect(createBook(books, 42)).toBe(books)
      expect(createBook(books, null)).toBe(books)
    })

    it('同じ名前のブックを複数作れる（IDで区別される）', () => {
      let next = createBook(books, 'カフェ')
      next = createBook(next, 'カフェ')
      expect(next).toHaveLength(3)
      expect(next[1].id).not.toBe(next[2].id)
      expect(next[1].name).toBe('カフェ')
      expect(next[2].name).toBe('カフェ')
    })
  })

  describe('renameBook', () => {
    const books = [defaultBook(), makeBook(), makeBook({ id: 'sb_002', name: '公園' })]

    it('該当IDのブックの名前を（トリムして）差し替える', () => {
      const next = renameBook(books, 'sb_001', '  喫茶  ')
      expect(next[1].name).toBe('喫茶')
      expect(next[0]).toEqual(defaultBook()) // 他は不変
      expect(next[2].name).toBe('公園')
    })

    it('デフォルトブックも改名できる', () => {
      const next = renameBook(books, 'default', 'お気に入り')
      expect(next[0].name).toBe('お気に入り')
      expect(next[0].id).toBe('default')
    })

    it('空・空白の名前では変更しない', () => {
      expect(renameBook(books, 'sb_001', '')).toBe(books)
      expect(renameBook(books, 'sb_001', '  ')).toBe(books)
      expect(renameBook(books, 'sb_001', null)).toBe(books)
    })

    it('ID が存在しなければ何も起きない', () => {
      expect(renameBook(books, 'sb_404', '名前')).toBe(books)
      expect(renameBook(books, '', '名前')).toBe(books)
    })
  })

  describe('deleteBook', () => {
    const books = [defaultBook(), makeBook(), makeBook({ id: 'sb_002', name: '公園' })]

    it('デフォルトブックは削除できない', () => {
      expect(deleteBook(books, 'default')).toBe(books)
    })

    it('該当IDのブックを取り除く', () => {
      const next = deleteBook(books, 'sb_001')
      expect(next).toHaveLength(2)
      expect(next.map((b) => b.id)).toEqual(['default', 'sb_002'])
    })

    it('ID が存在しなければ何も起きない', () => {
      expect(deleteBook(books, 'sb_404')).toBe(books)
      expect(deleteBook(books, '')).toBe(books)
    })
  })

  describe('bookNameOf', () => {
    const books = [
      { id: 'default', name: 'デフォルト', createdAt: null },
      { id: 'sb_001', name: 'カフェ', createdAt: null },
    ]

    it('bookId に対応するブック名を返す', () => {
      expect(bookNameOf(books, 'sb_001')).toBe('カフェ')
    })

    it('bookId が欠落・不正ならデフォルトブック名を返す', () => {
      expect(bookNameOf(books, undefined)).toBe(DEFAULT_BOOK_NAME)
      expect(bookNameOf(books, null)).toBe(DEFAULT_BOOK_NAME)
      expect(bookNameOf(books, '')).toBe(DEFAULT_BOOK_NAME)
      expect(bookNameOf(books, 42)).toBe(DEFAULT_BOOK_NAME)
    })

    it('デフォルトブックが改名されていれば改名後の名前を返す', () => {
      const renamed = [{ id: 'default', name: 'お気に入り', createdAt: null }, books[1]]
      expect(bookNameOf(renamed, undefined)).toBe('お気に入り')
      expect(bookNameOf(renamed, 'default')).toBe('お気に入り')
    })

    it('リストに無いブックID（削除済みなど）はデフォルトブック名にフォールバックする', () => {
      expect(bookNameOf(books, 'sb_404')).toBe(DEFAULT_BOOK_NAME)
    })

    it('books が undefined でもデフォルトブック名を返す', () => {
      expect(bookNameOf(undefined, 'sb_001')).toBe(DEFAULT_BOOK_NAME)
    })
  })

  describe('normalizeBookEntries', () => {
    it('有効なエントリを { id, name, createdAt } に正規化する', () => {
      const out = normalizeBookEntries([
        { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z', extra: 1 },
        { id: 'sb_002', name: '公園', createdAt: 999 },
      ])
      expect(out).toEqual([
        { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z', public: false },
        { id: 'sb_002', name: '公園', createdAt: null, public: false },
      ])
    })

    it('public が true なら true として保持される', () => {
      const out = normalizeBookEntries([
        { id: 'sb_001', name: 'カフェ', public: true },
        { id: 'sb_002', name: '公園', public: 'yes' },
      ])
      expect(out).toEqual([
        { id: 'sb_001', name: 'カフェ', createdAt: null, public: true },
        { id: 'sb_002', name: '公園', createdAt: null, public: false },
      ])
    })

    it('id/name が空でない文字列でないエントリを落とす', () => {
      const out = normalizeBookEntries([
        { id: 'sb_001', name: 'カフェ' },
        { id: '', name: '無ID' },
        { id: 'sb_x', name: '' },
        { id: 42, name: '数値ID' },
        null,
        '文字列',
        [{ id: 'sb_a', name: '配列' }],
      ])
      expect(out).toEqual([{ id: 'sb_001', name: 'カフェ', createdAt: null, public: false }])
    })

    it('id の重複は先頭のエントリだけ採用する', () => {
      const out = normalizeBookEntries([
        { id: 'sb_001', name: '最初' },
        { id: 'sb_001', name: '二番目' },
      ])
      expect(out).toEqual([{ id: 'sb_001', name: '最初', createdAt: null, public: false }])
    })

    it('配列でなければ [] を返す', () => {
      expect(normalizeBookEntries(undefined)).toEqual([])
      expect(normalizeBookEntries('nope')).toEqual([])
      expect(normalizeBookEntries({ books: [] })).toEqual([])
    })
  })

  describe('mergeScrapbooks', () => {
    const current = [
      { id: 'default', name: 'デフォルト', createdAt: null },
      { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z' },
    ]

    it('新しいブックは末尾に追加され、同一IDは既存を優先してスキップする', () => {
      const imported = [
        { id: 'sb_001', name: 'カフェ（取り込み）', createdAt: null },
        { id: 'sb_002', name: '公園', createdAt: null },
      ]
      const { books, added, skipped } = mergeScrapbooks(current, imported)
      expect(books).toEqual([
        { id: 'default', name: 'デフォルト', createdAt: null, public: false },
        { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z', public: false },
        { id: 'sb_002', name: '公園', createdAt: null, public: false },
      ])
      expect(added).toEqual([{ id: 'sb_002', name: '公園', createdAt: null, public: false }])
      expect(skipped).toBe(1)
    })

    it('取り込み側の public: true は正規化されて保持される（同一IDは既存優先）', () => {
      const imported = [{ id: 'sb_002', name: '公園', createdAt: null, public: true }]
      const { books, added } = mergeScrapbooks(current, imported)
      expect(books.find((b) => b.id === 'sb_002')).toEqual({ id: 'sb_002', name: '公園', createdAt: null, public: true })
      expect(added).toEqual([{ id: 'sb_002', name: '公園', createdAt: null, public: true }])
    })

    it('取り込み側だけがデフォルトブックを含んでも既存が優先される', () => {
      const imported = [{ id: 'default', name: 'お気に入り', createdAt: null }]
      const { books, added, skipped } = mergeScrapbooks(current, imported)
      expect(books[0].name).toBe('デフォルト') // 既存の名前のまま
      expect(added).toEqual([])
      expect(skipped).toBe(1)
    })

    it('imported が空なら何も追加されない', () => {
      const { books, added, skipped } = mergeScrapbooks(current, [])
      expect(books).toHaveLength(2)
      expect(added).toEqual([])
      expect(skipped).toBe(0)
    })

    it('不正なエントリは落とされる（added/skipped に入らない）', () => {
      const imported = [{ id: '', name: '無ID' }, { id: 'sb_002', name: '公園' }]
      const { added, skipped } = mergeScrapbooks(current, imported)
      expect(added).toHaveLength(1)
      expect(skipped).toBe(0)
    })
  })

  describe('setBookPublic', () => {
    const books = [
      defaultBook(),
      makeBook(), // public: false
      makeBook({ id: 'sb_002', name: '公園', public: true }),
    ]

    it('該当IDのブックの public を切り替える（他は不変）', () => {
      const next = setBookPublic(books, 'sb_001', true)
      expect(next[1].public).toBe(true)
      expect(next[0]).toEqual(defaultBook()) // 他は不変
      expect(next[2].public).toBe(true)
      expect(next).not.toBe(books) // 新しい配列
    })

    it('public: true のブックを非公開（false）にできる', () => {
      const next = setBookPublic(books, 'sb_002', false)
      expect(next[2].public).toBe(false)
    })

    it('デフォルトブックも公開設定を変更できる', () => {
      const next = setBookPublic(books, 'default', true)
      expect(next[0].public).toBe(true)
      expect(next[0].id).toBe('default')
    })

    it('isPublic が true 以外（欠落・型違い）の場合は false になる', () => {
      const next = setBookPublic(books, 'sb_002', undefined)
      expect(next[2].public).toBe(false)
      const next2 = setBookPublic(books, 'sb_002', 'yes')
      expect(next2[2].public).toBe(false)
    })

    it('ID が存在しなければ何も起きない（元の配列をそのまま返す）', () => {
      expect(setBookPublic(books, 'sb_404', true)).toBe(books)
      expect(setBookPublic(books, '', true)).toBe(books)
      expect(setBookPublic(books, 42, true)).toBe(books)
    })

    it('books が配列でなければ何も起きない', () => {
      expect(setBookPublic(undefined, 'sb_001', true)).toBe(undefined)
      expect(setBookPublic('nope', 'sb_001', true)).toBe('nope')
    })
  })
})
