// @vitest-environment jsdom
/**
 * まちメモ帳 データ層（memocho.js）のテスト
 * - loadMemocho: 未保存・壊れたJSON・不正要素
 * - addMemocho: スナップショット生成・name優先順位・tagsコピーの独立性・重複防止
 * - removeMemocho / updateMemo / updateRating / hasMemocho
 * - mergeMemocho: added/skipped 件数、既存優先
 * - ごみ箱（論理削除）: isDeletedItem / activeItems / trashItems /
 *   trashMemocho / restoreMemocho。hasMemocho はごみ箱を未登録扱い、
 *   addMemocho はごみ箱の同キーを復元、parseMemochoJSON は deletedAt を保持
 * - serializeMemocho → parseMemochoJSON の往復
 * - parseMemochoJSON: 素の配列・全体が不正な場合
 * - bookId（スクラップブックの所属）: 読み取り時の正規化（欠落・不正 → 'default'）、
 *   updateBook、serialize/parse での往復・ブックリスト（books）の復元
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  MEMOCHO_STORAGE_KEY,
  loadMemocho,
  saveMemocho,
  memochoKeyOf,
  hasMemocho,
  addMemocho,
  removeMemocho,
  updateMemo,
  updateMapImage,
  updateRating,
  updateBook,
  moveBookItems,
  mergeMemocho,
  serializeMemocho,
  parseMemochoJSON,
  isDeletedItem,
  activeItems,
  trashItems,
  trashMemocho,
  restoreMemocho,
} from '../memocho'

/** localStorage のインメモリスタブ */
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

function makeResult(overrides = {}) {
  return {
    type: 'node',
    id: 123,
    lat: 35.68,
    lon: 139.77,
    tags: { name: 'テスト施設', cuisine: 'coffee' },
    ...overrides,
  }
}

function makeItem(overrides = {}) {
  return {
    type: 'way',
    id: 456,
    name: '既存施設',
    lat: 35.69,
    lon: 139.78,
    tags: { name: '既存施設' },
    memo: '元のメモ',
    rating: 0,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('memocho', () => {
  beforeEach(() => {
    // jsdom の localStorage は getter のみなので defineProperty で差し替える
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageStub(),
      writable: true,
      configurable: true,
    })
  })

  describe('loadMemocho', () => {
    it('未保存なら [] を返す', () => {
      expect(loadMemocho()).toEqual([])
    })

    it('壊れたJSONなら [] を返す', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, '{oops')
      expect(loadMemocho()).toEqual([])
    })

    it('配列でなければ [] を返す', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify({ items: [] }))
      expect(loadMemocho()).toEqual([])
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify('ただの文字列'))
      expect(loadMemocho()).toEqual([])
    })

    it('type/id が不正な要素を落として読む', () => {
      const valid = makeItem()
      localStorage.setItem(
        MEMOCHO_STORAGE_KEY,
        JSON.stringify([
          valid,
          { ...valid, type: 'planet' }, // type が不正
          { ...valid, id: '456' }, // id が数値でない
          null, // オブジェクトでない
        ])
      )
      // 読み取り時に bookId が正規化される（欠落 → 'default'）
      expect(loadMemocho()).toEqual([{ ...valid, bookId: 'default' }])
    })

    it('saveMemocho → loadMemocho で往復する', () => {
      const items = [makeItem(), makeItem({ type: 'node', id: 789 })]
      saveMemocho(items)
      // 読み取り時に bookId が正規化される（欠落 → 'default'）
      expect(loadMemocho()).toEqual(items.map((item) => ({ ...item, bookId: 'default' })))
    })
  })

  describe('memochoKeyOf / hasMemocho', () => {
    it('一意キーを "type/id" 形式で返す', () => {
      expect(memochoKeyOf({ type: 'node', id: 123 })).toBe('node/123')
      expect(memochoKeyOf({ type: 'way', id: 456 })).toBe('way/456')
      expect(memochoKeyOf({ type: 'relation', id: 789 })).toBe('relation/789')
    })

    it('登録済みかどうかを正しく判定する', () => {
      const items = [makeItem()]
      expect(hasMemocho(items, 'way/456')).toBe(true)
      expect(hasMemocho(items, 'node/456')).toBe(false)
      expect(hasMemocho(items, 'way/999')).toBe(false)
      expect(hasMemocho([], 'way/456')).toBe(false)
    })
  })

  describe('addMemocho', () => {
    it('検索結果からスナップショットを作って追加する', () => {
      const result = makeResult()
      const items = addMemocho([], result)

      expect(items).toHaveLength(1)
      const item = items[0]
      expect(item.type).toBe('node')
      expect(item.id).toBe(123)
      expect(item.name).toBe('テスト施設')
      expect(item.lat).toBe(35.68)
      expect(item.lon).toBe(139.77)
      expect(item.memo).toBe('')
      expect(item.rating).toBe(0) // 未評価で初期化
      expect(item.addedAt).toBeTypeOf('string')
      expect(new Date(item.addedAt).toISOString()).toBe(item.addedAt) // ISO形式
    })

    it('name は tags.name → tags["name:ja"] → "名称なし" の優先順', () => {
      // 両方ある場合は tags.name が優先
      let items = addMemocho([], makeResult({ tags: { name: '英語名', 'name:ja': '日本語名' } }))
      expect(items[0].name).toBe('英語名')

      // name がない場合は name:ja
      items = addMemocho([], makeResult({ tags: { 'name:ja': '日本語名' } }))
      expect(items[0].name).toBe('日本語名')

      // どちらもなければ "名称なし"
      items = addMemocho([], makeResult({ tags: { cuisine: 'coffee' } }))
      expect(items[0].name).toBe('名称なし')

      // tags 自体がない場合も "名称なし"
      items = addMemocho([], makeResult({ tags: undefined }))
      expect(items[0].name).toBe('名称なし')
      expect(items[0].tags).toBeNull()
    })

    it('tags は浅いコピーで、元のオブジェクトと独立', () => {
      const result = makeResult()
      const items = addMemocho([], result)

      result.tags.cuisine = 'source-mutated'
      expect(items[0].tags.cuisine).toBe('coffee') // 元を変える側: コピーは不変
      expect(items[0].tags).not.toBe(result.tags) // 別オブジェクト

      items[0].tags.cuisine = 'item-mutated'
      expect(result.tags.cuisine).toBe('source-mutated') // アイテムを変える側: 元は不変
    })

    it('既に同じキーが登録済みなら配列をそのまま返す', () => {
      const items = [makeItem({ type: 'node', id: 123, name: '既存', tags: null, addedAt: '2026-01-01T00:00:00.000Z' })]
      const next = addMemocho(items, makeResult())

      expect(next).toBe(items) // 同じ配列を返す（重複追加しない）
      expect(next).toHaveLength(1)
      expect(next[0].name).toBe('既存')
    })

    it('result が不正なら配列をそのまま返す', () => {
      expect(addMemocho([], { type: 'planet', id: 1 })).toEqual([])
      expect(addMemocho([], { type: 'node', id: '1' })).toEqual([])
      expect(addMemocho([], null)).toEqual([])
    })
  })

  describe('removeMemocho / updateMemo / updateRating', () => {
    const items = () => [
      makeItem({ type: 'node', id: 1, name: 'A', memo: 'aメモ' }),
      makeItem({ type: 'node', id: 2, name: 'B', memo: 'bメモ' }),
    ]

    it('removeMemocho は該当キーを除いた新しい配列を返す', () => {
      const next = removeMemocho(items(), 'node/1')
      expect(next).toHaveLength(1)
      expect(next[0].name).toBe('B')
      expect(items()).toHaveLength(2) // 元の配列は不変
    })

    it('removeMemocho で無いキーを指定したらそのまま返す', () => {
      const src = items()
      expect(removeMemocho(src, 'node/999')).toEqual(src)
    })

    it('updateMemo は該当キーの memo を差し替える', () => {
      const next = updateMemo(items(), 'node/1', '新しいメモ')
      expect(next[0].memo).toBe('新しいメモ')
      expect(next[1].memo).toBe('bメモ') // 他は不変
      expect(items()[0].memo).toBe('aメモ') // 元の配列は不変
      expect(next[0]).not.toBe(items()[0]) // 新しいオブジェクト
    })

    it('updateMemo で無いキーを指定したら内容が変わらない', () => {
      const src = items()
      expect(updateMemo(src, 'way/999', 'x')).toEqual(src)
    })

    it('updateRating は該当キーの rating を差し替える', () => {
      const next = updateRating(items(), 'node/1', 5)
      expect(next[0].rating).toBe(5)
      expect(next[1].rating).toBe(0) // 他は不変（未評価のまま）
      expect(items()[0].rating).toBe(0) // 元の配列は不変
      expect(next[0]).not.toBe(items()[0]) // 新しいオブジェクト
    })

    it('updateRating で無いキーを指定したら内容が変わらない', () => {
      const src = items()
      expect(updateRating(src, 'way/999', 3)).toEqual(src)
    })

    it('updateBook は該当キーの bookId を差し替える（他のアイテムは不変）', () => {
      const next = updateBook(items(), 'node/1', 'sb_001')
      expect(next[0].bookId).toBe('sb_001')
      expect('bookId' in next[1]).toBe(false) // 他は不変
      expect(next[0]).not.toBe(items()[0]) // 新しいオブジェクト
    })

    it('updateBook で無いキーを指定したら内容が変わらない', () => {
      const src = items()
      expect(updateBook(src, 'way/999', 'sb_001')).toEqual(src)
    })

    it('updateBook は空でない文字列以外の bookId では変更しない', () => {
      const src = items()
      for (const bad of ['', 42, null, undefined, {}]) {
        expect(updateBook(src, 'node/1', bad)).toEqual(src)
      }
    })
  })

  describe('moveBookItems（ブック削除時の所属移動）', () => {
    it('fromBookId の全アイテム（ごみ箱含む）の bookId を toBookId に置き換える', () => {
      const src = [
        makeItem({ bookId: 'sb_001' }),
        makeItem({ type: 'way', id: 2, bookId: 'sb_001', deletedAt: '2026-01-02T00:00:00.000Z' }),
        makeItem({ type: 'node', id: 3, bookId: 'sb_002' }),
        makeItem({ type: 'node', id: 4 }),
      ]
      const next = moveBookItems(src, 'sb_001', 'default')
      expect(next[0].bookId).toBe('default')
      expect(next[1].bookId).toBe('default') // ごみ箱のアイテムも移動する
      expect(next[1].deletedAt).toBe('2026-01-02T00:00:00.000Z') // 他のフィールドは不変
      expect(next[2].bookId).toBe('sb_002') // 別のブックは不変
      expect('bookId' in next[3]).toBe(false) // bookId 無いアイテムは不変
    })

    it('該当アイテムが無ければ元の配列をそのまま返す（同じ参照）', () => {
      const src = [makeItem({ bookId: 'sb_002' }), makeItem({ type: 'node', id: 2 })]
      expect(moveBookItems(src, 'sb_001', 'default')).toBe(src)
    })

    it('引数が空でない文字列以外なら変更しない', () => {
      const src = [makeItem({ bookId: 'sb_001' })]
      expect(moveBookItems(src, '', 'default')).toBe(src)
      expect(moveBookItems(src, 'sb_001', '')).toBe(src)
      expect(moveBookItems(src, 42, 'default')).toBe(src)
      expect(moveBookItems(src, 'sb_001', null)).toBe(src)
    })
  })

  describe('mergeMemocho', () => {
    it('キー重複は既存を優先して合流し、added/skipped を返す', () => {
      const current = [
        makeItem({ type: 'node', id: 1, name: '既存A', memo: '既存メモ', tags: { name: '既存A' } }),
        makeItem({ type: 'node', id: 2, name: '既存B', memo: '', tags: null }),
      ]
      const imported = [
        makeItem({ type: 'node', id: 1, name: '取り込みA', memo: '取り込みメモ', tags: { name: '取り込みA' } }), // 重複
        makeItem({ type: 'way', id: 3, name: '新着C', memo: '', tags: null }), // 新規
      ]

      const { items, added, skipped } = mergeMemocho(current, imported)

      expect(items).toHaveLength(3)
      expect(added).toHaveLength(1)
      expect(skipped).toBe(1)
      // 既存が優先される
      expect(items[0].name).toBe('既存A')
      expect(items[0].memo).toBe('既存メモ')
      expect(added[0].name).toBe('新着C')
      // 元の配列は不変
      expect(current).toHaveLength(2)
    })

    it('imported 内の重複もスキップされる', () => {
      const imported = [
        makeItem({ type: 'way', id: 3, name: 'C', memo: '', tags: null }),
        makeItem({ type: 'way', id: 3, name: 'C2', memo: '', tags: null }),
      ]
      const { items, added, skipped } = mergeMemocho([], imported)
      expect(items).toHaveLength(1)
      expect(added).toHaveLength(1)
      expect(skipped).toBe(1)
      expect(items[0].name).toBe('C')
    })

    it('空の imported / current でも動く', () => {
      const { items, added, skipped } = mergeMemocho([], [])
      expect(items).toEqual([])
      expect(added).toEqual([])
      expect(skipped).toBe(0)
    })
  })

  describe('ごみ箱（論理削除）', () => {
    const trashed = (overrides = {}) => ({ ...makeItem({ ...overrides, deletedAt: '2026-06-15T10:30:00.000Z' }) })

    it('isDeletedItem: deletedAt が非空の文字列なら true', () => {
      expect(isDeletedItem(trashed())).toBe(true)
      expect(isDeletedItem(makeItem())).toBe(false)
      expect(isDeletedItem({ ...makeItem(), deletedAt: '' })).toBe(false)
      expect(isDeletedItem({ ...makeItem(), deletedAt: 123 })).toBe(false)
      expect(isDeletedItem(null)).toBe(false)
    })

    it('activeItems / trashItems: deletedAt で分割する', () => {
      const items = [makeItem(), trashed({ type: 'node', id: 789, name: 'ごみ箱店' })]
      expect(activeItems(items)).toEqual([items[0]])
      expect(trashItems(items)).toEqual([items[1]])
      expect(activeItems([])).toEqual([])
      expect(trashItems([])).toEqual([])
    })

    it('hasMemocho: ごみ箱のアイテムは未登録として扱う', () => {
      expect(hasMemocho([trashed()], 'way/456')).toBe(false) // ごみ箱＝未登録
      expect(hasMemocho([makeItem()], 'way/456')).toBe(true)
    })

    it('trashMemocho: 該当キーに deletedAt（ISO）を付けて論理削除する', () => {
      const items = [makeItem({ type: 'node', id: 1 }), makeItem({ type: 'node', id: 2 })]
      const next = trashMemocho(items, 'node/1')
      expect(next).toHaveLength(2)
      expect(next[0].deletedAt).toBeTypeOf('string')
      expect(new Date(next[0].deletedAt).toISOString()).toBe(next[0].deletedAt) // ISO形式
      expect(next[1].deletedAt).toBeUndefined() // 他は不変
      expect(items[0].deletedAt).toBeUndefined() // 元の配列は不変
      expect(next[0]).not.toBe(items[0]) // 新しいオブジェクト
    })

    it('trashMemocho: 既にゴミ箱にある・存在しないキーならそのまま返す', () => {
      const src = [trashed()]
      expect(trashMemocho(src, 'way/456')).toBe(src) // 既にゴミ箱
      const src2 = [makeItem()]
      expect(trashMemocho(src2, 'node/999')).toBe(src2) // 存在しない
    })

    it('restoreMemocho: deletedAt を除去して復元する', () => {
      const items = [trashed(), makeItem({ type: 'node', id: 2 })]
      const next = restoreMemocho(items, 'way/456')
      expect(next[0].deletedAt).toBeUndefined()
      expect(next[0]).not.toBe(items[0])
      expect(next[0]).toEqual(makeItem()) // 他のフィールドは保持
      expect(next[1]).toBe(items[1]) // 他は不変（同じ参照）
    })

    it('restoreMemocho: ごみ箱に該当キーが無ければそのまま返す', () => {
      const src = [makeItem()]
      expect(restoreMemocho(src, 'way/456')).toBe(src)
    })

    it('addMemocho: 同じキーがごみ箱にあるなら復元する（重複作成しない）', () => {
      const result = makeResult() // node/123
      const items = [trashed({ type: 'node', id: 123, name: 'ごみ箱店', tags: { name: 'ごみ箱店' } })]
      const next = addMemocho(items, result)
      expect(next).toHaveLength(1) // 重複作成されない
      expect(next[0].deletedAt).toBeUndefined()
      expect(next[0].name).toBe('ごみ箱店') // 既存条目のデータ（メモ・評価等）を保持
    })

    it('parseMemochoJSON: 妥当な deletedAt を保持する（ごみ箱も復元できる）', () => {
      const { items } = parseMemochoJSON(JSON.stringify({
        app: 'machi-memocho', version: 1,
        items: [{ ...makeItem(), deletedAt: '2026-06-15T10:30:00.000Z' }],
      }))
      expect(items[0].deletedAt).toBe('2026-06-15T10:30:00.000Z')
    })

    it('parseMemochoJSON: 不正な deletedAt は落とす（寛容な方式）', () => {
      for (const bad of [123, '', null, { at: 'x' }]) {
        const { items } = parseMemochoJSON(JSON.stringify({
          app: 'machi-memocho', version: 1,
          items: [{ ...makeItem(), deletedAt: bad }],
        }))
        expect('deletedAt' in items[0]).toBe(false)
      }
    })

    it('serialize → parse で deletedAt が往復する', () => {
      const items = [makeItem(), trashed({ type: 'node', id: 789, name: 'ごみ箱店' })]
      const { items: round } = parseMemochoJSON(serializeMemocho(items))
      expect(round[0].deletedAt).toBeUndefined()
      expect(round[1].deletedAt).toBe('2026-06-15T10:30:00.000Z')
    })

    it('mergeMemocho: 既存がゴミ箱・読み込みがアクティブなら復元（読み込み側で差し替え）', () => {
      const current = [trashed({ type: 'node', id: 1, name: '既存A', memo: '既存メモ', tags: { name: '既存A' } })]
      const imported = [makeItem({ type: 'node', id: 1, name: '取り込みA', memo: '取り込みメモ', tags: { name: '取り込みA' } })]
      const { items, added, skipped } = mergeMemocho(current, imported)
      expect(items).toHaveLength(1)
      expect(added).toHaveLength(1)
      expect(skipped).toBe(0)
      expect(items[0].name).toBe('取り込みA') // 読み込み側で差し替え（復元）
      expect(items[0].deletedAt).toBeUndefined()
    })

    it('mergeMemocho: 既存と読み込みの両方がゴミ箱ならスキップ', () => {
      const current = [trashed({ type: 'node', id: 1, name: '既存A', memo: '既存メモ', tags: { name: '既存A' } })]
      const imported = [trashed({ type: 'node', id: 1, name: '取り込みA', memo: '取り込みメモ', tags: { name: '取り込みA' } })]
      const { items, added, skipped } = mergeMemocho(current, imported)
      expect(items).toHaveLength(1)
      expect(items[0].name).toBe('既存A') // 既存優先
      expect(added).toHaveLength(0)
      expect(skipped).toBe(1)
    })
  })

  describe('serializeMemocho / parseMemochoJSON の往復', () => {
    it('serializeMemocho は { app, version, items, books } 形式の文字列を返す', () => {
      const items = [makeItem()]
      const parsed = JSON.parse(serializeMemocho(items))
      expect(parsed.app).toBe('machi-memocho')
      expect(parsed.version).toBe(1)
      // bookId は正規化（欠落 → 'default'）されて出力される
      expect(parsed.items).toEqual([{ ...items[0], bookId: 'default' }])
      // books は指定しなければ空配列
      expect(parsed.books).toEqual([])
    })

    it('serialize → parse で内容が一致する（往復）', () => {
      const items = [
        makeItem(),
        makeItem({ type: 'node', id: 789, name: '名称なし', lat: null, lon: null, tags: null, memo: 'メモ', addedAt: '2026-02-01T00:00:00.000Z' }),
      ]
      const { items: roundTripped } = parseMemochoJSON(serializeMemocho(items))
      expect(roundTripped).toEqual(items.map((item) => ({ ...item, bookId: 'default' })))
    })

    it('addMemocho で作ったスナップショットも往復で一致する', () => {
      const items = addMemocho([], makeResult())
      const { items: roundTripped } = parseMemochoJSON(serializeMemocho(items))
      // addMemocho のスナップショットには bookId が無い → 正規化で 'default'
      expect(roundTripped).toEqual(items.map((item) => ({ ...item, bookId: 'default' })))
    })
  })

  describe('parseMemochoJSON', () => {
    it('形式付きオブジェクトを受け付ける（{ items, books } を返す）', () => {
      const items = [makeItem()]
      const text = JSON.stringify({ app: 'machi-memocho', version: 1, items })
      expect(parseMemochoJSON(text)).toEqual({
        items: [{ ...items[0], bookId: 'default' }],
        books: [],
      })
    })

    it('素の配列も受け付ける', () => {
      const items = [
        { type: 'node', id: 1, name: 'A' }, // memo 無ければ ''
        { type: 'way', id: 2, memo: 'm', lat: 35.7, lon: 139.8, tags: { name: 'B' } },
        { type: 'relation', id: 3 }, // name 無ければ '名称なし'、lat/lon は null
      ]
      const { items: normalized } = parseMemochoJSON(JSON.stringify(items))
      expect(normalized).toEqual([
        { type: 'node', id: 1, name: 'A', lat: null, lon: null, tags: null, memo: '', rating: 0, addedAt: null, bookId: 'default' },
        { type: 'way', id: 2, name: '名称なし', lat: 35.7, lon: 139.8, tags: { name: 'B' }, memo: 'm', rating: 0, addedAt: null, bookId: 'default' },
        { type: 'relation', id: 3, name: '名称なし', lat: null, lon: null, tags: null, memo: '', rating: 0, addedAt: null, bookId: 'default' },
      ])
    })

    it('不正な全体形式では throw する', () => {
      expect(() => parseMemochoJSON('not json')).toThrow()
      expect(() => parseMemochoJSON(JSON.stringify({ app: 'machi-memocho' }))).toThrow() // items なし
      expect(() => parseMemochoJSON(JSON.stringify({ app: 'machi-memocho', items: 'nope' }))).toThrow()
      expect(() => parseMemochoJSON(JSON.stringify({ app: 'other-app', version: 1, items: [] }))).toThrow() // app が違う
      expect(() => parseMemochoJSON(JSON.stringify('配列でない素の値'))).toThrow()
      expect(() => parseMemochoJSON(JSON.stringify(42))).toThrow()
    })

    it('要素が不正なら throw する', () => {
      const wrap = (items) => JSON.stringify({ app: 'machi-memocho', version: 1, items })
      expect(() => parseMemochoJSON(wrap([{ type: 'planet', id: 1 }]))).toThrow(/type/)
      expect(() => parseMemochoJSON(wrap([{ type: 'node', id: '1' }]))).toThrow(/id/)
      expect(() => parseMemochoJSON(wrap([{ type: 'node', id: 1, lat: '35.7' }]))).toThrow(/lat/)
      expect(() => parseMemochoJSON(wrap([null]))).toThrow()
    })
  })

  describe('bookId（スクラップブックの所属）', () => {
    const wrap = (items) => JSON.stringify({ app: 'machi-memocho', version: 1, items })

    it('loadMemocho: bookId が無いアイテムは default として正規化される', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
      expect(loadMemocho()[0].bookId).toBe('default')
    })

    it('loadMemocho: 不正な bookId は default に落とす（寛容な方式）', () => {
      for (const bad of ['', 42, null, {}]) {
        localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([{ ...makeItem(), bookId: bad }]))
        expect(loadMemocho()[0].bookId).toBe('default')
      }
    })

    it('loadMemocho: 有効な bookId はそのまま保持される', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([{ ...makeItem(), bookId: 'sb_001' }]))
      expect(loadMemocho()[0].bookId).toBe('sb_001')
    })

    it('parseMemochoJSON: bookId が無い・不正なアイテムは default に正規化される', () => {
      const { items } = parseMemochoJSON(wrap([makeItem(), { ...makeItem({ id: 2 }), bookId: 42 }]))
      expect(items[0].bookId).toBe('default')
      expect(items[1].bookId).toBe('default')
    })

    it('parseMemochoJSON: 有効な bookId は保持される', () => {
      const { items } = parseMemochoJSON(wrap([{ ...makeItem(), bookId: 'sb_001' }]))
      expect(items[0].bookId).toBe('sb_001')
    })

    it('serializeMemocho: bookId が無いアイテムは default として出力される', () => {
      const parsed = JSON.parse(serializeMemocho([makeItem()]))
      expect(parsed.items[0].bookId).toBe('default')
    })

    it('serialize → parse で bookId が往復する', () => {
      const items = [{ ...makeItem(), bookId: 'sb_001' }]
      const { items: round } = parseMemochoJSON(serializeMemocho(items))
      expect(round[0].bookId).toBe('sb_001')
    })

    it('serialize → parse でブックリスト（books）が復元される', () => {
      const books = [
        { id: 'default', name: 'デフォルト', createdAt: null },
        { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z' },
      ]
      const { items, books: roundBooks } = parseMemochoJSON(serializeMemocho([{ ...makeItem(), bookId: 'sb_001' }], books))
      // アイテムの所属は保持される
      expect(items[0].bookId).toBe('sb_001')
      // ブックリストは ID・名前で復元される（createdAt は書き出されない → null）
      expect(roundBooks).toEqual([
        { id: 'default', name: 'デフォルト', createdAt: null, public: false },
        { id: 'sb_001', name: 'カフェ', createdAt: null, public: false },
      ])
    })

    it('旧形式（books なし）のファイルは books: [] として読める', () => {
      const { items, books } = parseMemochoJSON(wrap([makeItem()]))
      expect(books).toEqual([])
      expect(items[0].bookId).toBe('default')
    })
  })

  describe('cmmId / cmmUpdatedAt（CMM 同期フィールド）', () => {
    const wrap = (items) => JSON.stringify({ app: 'machi-memocho', version: 1, items })

    it('parseMemochoJSON: 空でない文字列の cmmId / cmmUpdatedAt は保持される', () => {
      const { items } = parseMemochoJSON(wrap([
        { ...makeItem(), cmmId: 'cmm_abc123', cmmUpdatedAt: '2026-03-01T12:00:00.000Z' },
      ]))
      expect(items[0].cmmId).toBe('cmm_abc123')
      expect(items[0].cmmUpdatedAt).toBe('2026-03-01T12:00:00.000Z')
    })

    it('parseMemochoJSON: 欠落・空文字・型違いの cmmId / cmmUpdatedAt は落とされる', () => {
      const { items } = parseMemochoJSON(wrap([
        makeItem(), // 欠落
        { ...makeItem({ id: 2 }), cmmId: '' }, // 空文字
        { ...makeItem({ id: 3 }), cmmId: 42 }, // 型違い
        { ...makeItem({ id: 4 }), cmmUpdatedAt: null }, // null
      ]))
      for (const item of items) {
        expect('cmmId' in item).toBe(false)
        expect('cmmUpdatedAt' in item).toBe(false)
      }
    })

    it('cmmId だけ、cmmUpdatedAt だけを個別に保持できる', () => {
      const { items } = parseMemochoJSON(wrap([
        { ...makeItem({ id: 1 }), cmmId: 'cmm_1' },
        { ...makeItem({ id: 2 }), cmmUpdatedAt: '2026-03-02T00:00:00.000Z' },
      ]))
      expect(items[0].cmmId).toBe('cmm_1')
      expect('cmmUpdatedAt' in items[0]).toBe(false)
      expect('cmmId' in items[1]).toBe(false)
      expect(items[1].cmmUpdatedAt).toBe('2026-03-02T00:00:00.000Z')
    })

    it('serializeMemocho: cmmId / cmmUpdatedAt は出力に含まれる', () => {
      const parsed = JSON.parse(serializeMemocho([
        { ...makeItem(), cmmId: 'cmm_abc123', cmmUpdatedAt: '2026-03-01T12:00:00.000Z' },
      ]))
      expect(parsed.items[0].cmmId).toBe('cmm_abc123')
      expect(parsed.items[0].cmmUpdatedAt).toBe('2026-03-01T12:00:00.000Z')
    })

    it('serialize → parse で cmmId / cmmUpdatedAt が往復する', () => {
      const items = [{ ...makeItem(), cmmId: 'cmm_abc123', cmmUpdatedAt: '2026-03-01T12:00:00.000Z' }]
      const { items: round } = parseMemochoJSON(serializeMemocho(items))
      expect(round[0].cmmId).toBe('cmm_abc123')
      expect(round[0].cmmUpdatedAt).toBe('2026-03-01T12:00:00.000Z')
    })

    it('loadMemocho: 保存済みの cmmId / cmmUpdatedAt は保持される', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
        { ...makeItem(), cmmId: 'cmm_abc123', cmmUpdatedAt: '2026-03-01T12:00:00.000Z' },
      ]))
      const loaded = loadMemocho()[0]
      expect(loaded.cmmId).toBe('cmm_abc123')
      expect(loaded.cmmUpdatedAt).toBe('2026-03-01T12:00:00.000Z')
      expect(loaded.bookId).toBe('default') // bookId 正規化と併存する
    })

    it('ごみ箱・復元操作で cmmId は保持される', () => {
      const items = [{ ...makeItem(), cmmId: 'cmm_abc123' }]
      const trashed = trashMemocho(items, 'way/456')
      expect(trashed[0].cmmId).toBe('cmm_abc123')
      const restored = restoreMemocho(trashed, 'way/456')
      expect(restored[0].cmmId).toBe('cmm_abc123')
    })
  })
})

describe('mapImage（地図サムネイル）', () => {
  const base = {
    type: 'node', id: 55, name: 'サムネイル店', lat: 34.7, lon: 135.5,
    tags: { name: 'サムネイル店', amenity: 'cafe' }, memo: '', addedAt: '2026-01-01T00:00:00.000Z',
  }
  const wrap = (items) => JSON.stringify({ app: 'machi-memocho', version: 1, items })

  it('updateMapImage で対象アイテムにだけ付く', () => {
    const next = updateMapImage([base], 'node/55', 'data:image/jpeg;base64,QUJD')
    expect(next[0].mapImage).toBe('data:image/jpeg;base64,QUJD')
    expect(base.mapImage).toBeUndefined()
  })

  it('parseMemochoJSON は正しい mapImage を保持する', () => {
    const { items } = parseMemochoJSON(wrap([{ ...base, mapImage: 'data:image/jpeg;base64,QUJD' }]))
    expect(items[0].mapImage).toBe('data:image/jpeg;base64,QUJD')
  })

  it('parseMemochoJSON は画像でない文字列を落とす', () => {
    const { items } = parseMemochoJSON(wrap([{ ...base, mapImage: 'https://example.com/x.png' }]))
    expect(items[0].mapImage).toBeUndefined()
  })

  it('mapImage が無いアイテムにはフィールド自体が付かない', () => {
    const { items } = parseMemochoJSON(wrap([base]))
    expect('mapImage' in items[0]).toBe(false)
  })
})

describe('rating（0〜5の評価、0＝未評価）', () => {
  const base = {
    type: 'node', id: 66, name: '評価店', lat: 34.7, lon: 135.5,
    tags: { name: '評価店', amenity: 'cafe' }, memo: '', addedAt: '2026-01-01T00:00:00.000Z',
  }
  const wrap = (items) => JSON.stringify({ app: 'machi-memocho', version: 1, items })

  it('updateRating で対象アイテムにだけ rating が付く', () => {
    const next = updateRating([base], 'node/66', 4)
    expect(next[0].rating).toBe(4)
    expect(base.rating).toBeUndefined()
  })

  it('updateRating に 0 を渡すと未評価に戻る（評価解除）', () => {
    const next = updateRating([{ ...base, rating: 4 }], 'node/66', 0)
    expect(next[0].rating).toBe(0)
  })

  it('updateRating は 0〜5 の整数以外の値では変更しない', () => {
    const src = [{ ...base, rating: 4 }]
    for (const bad of [6, -1, 3.5, '3', true, null, undefined]) {
      expect(updateRating(src, 'node/66', bad)).toEqual(src)
    }
    expect(src[0].rating).toBe(4) // 元は不変
  })

  it('parseMemochoJSON は正しい rating（0〜5 の整数）を保持する', () => {
    for (const good of [0, 1, 2, 3, 4, 5]) {
      const { items } = parseMemochoJSON(wrap([{ ...base, rating: good }]))
      expect(items[0].rating).toBe(good)
    }
  })

  it('parseMemochoJSON は不正な rating を 0（未評価）に落とす（寛容な方式）', () => {
    for (const bad of [6, -1, 3.5, '3', true, null, undefined]) {
      const { items } = parseMemochoJSON(wrap([{ ...base, rating: bad }]))
      expect(items[0].rating).toBe(0)
    }
  })

  it('rating が無いアイテムは 0（未評価）として正規化される', () => {
    const { items } = parseMemochoJSON(wrap([base]))
    expect(items[0].rating).toBe(0)
  })

  it('serializeMemocho → parseMemochoJSON で rating が往復する', () => {
    const items = [{ ...base, rating: 2, mapImage: 'data:image/jpeg;base64,QUJD' }]
    const { items: round } = parseMemochoJSON(serializeMemocho(items))
    expect(round[0].rating).toBe(2)
    expect(round[0].mapImage).toBe('data:image/jpeg;base64,QUJD')
  })
})
