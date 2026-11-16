// @vitest-environment jsdom
/**
 * まちメモ帳 データ層（memocho.js）のテスト
 * - loadMemocho: 未保存・壊れたJSON・不正要素
 * - addMemocho: スナップショット生成・name優先順位・tagsコピーの独立性・重複防止
 * - removeMemocho / updateMemo / hasMemocho
 * - mergeMemocho: added/skipped 件数、既存優先
 * - serializeMemocho → parseMemochoJSON の往復
 * - parseMemochoJSON: 素の配列・全体が不正な場合
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
  mergeMemocho,
  serializeMemocho,
  parseMemochoJSON,
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
      expect(loadMemocho()).toEqual([valid])
    })

    it('saveMemocho → loadMemocho で往復する', () => {
      const items = [makeItem(), makeItem({ type: 'node', id: 789 })]
      saveMemocho(items)
      expect(loadMemocho()).toEqual(items)
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

  describe('removeMemocho / updateMemo', () => {
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

  describe('serializeMemocho / parseMemochoJSON の往復', () => {
    it('serializeMemocho は { app, version, items } 形式の文字列を返す', () => {
      const items = [makeItem()]
      const parsed = JSON.parse(serializeMemocho(items))
      expect(parsed.app).toBe('machi-memocho')
      expect(parsed.version).toBe(1)
      expect(parsed.items).toEqual(items)
    })

    it('serialize → parse で内容が一致する（往復）', () => {
      const items = [
        makeItem(),
        makeItem({ type: 'node', id: 789, name: '名称なし', lat: null, lon: null, tags: null, memo: 'メモ', addedAt: '2026-02-01T00:00:00.000Z' }),
      ]
      const roundTripped = parseMemochoJSON(serializeMemocho(items))
      expect(roundTripped).toEqual(items)
    })

    it('addMemocho で作ったスナップショットも往復で一致する', () => {
      const items = addMemocho([], makeResult())
      const roundTripped = parseMemochoJSON(serializeMemocho(items))
      expect(roundTripped).toEqual(items)
    })
  })

  describe('parseMemochoJSON', () => {
    it('形式付きオブジェクトを受け付ける', () => {
      const items = [makeItem()]
      const text = JSON.stringify({ app: 'machi-memocho', version: 1, items })
      expect(parseMemochoJSON(text)).toEqual(items)
    })

    it('素の配列も受け付ける', () => {
      const items = [
        { type: 'node', id: 1, name: 'A' }, // memo 無ければ ''
        { type: 'way', id: 2, memo: 'm', lat: 35.7, lon: 139.8, tags: { name: 'B' } },
        { type: 'relation', id: 3 }, // name 無ければ '名称なし'、lat/lon は null
      ]
      const normalized = parseMemochoJSON(JSON.stringify(items))
      expect(normalized).toEqual([
        { type: 'node', id: 1, name: 'A', lat: null, lon: null, tags: null, memo: '', addedAt: null },
        { type: 'way', id: 2, name: '名称なし', lat: 35.7, lon: 139.8, tags: { name: 'B' }, memo: 'm', addedAt: null },
        { type: 'relation', id: 3, name: '名称なし', lat: null, lon: null, tags: null, memo: '', addedAt: null },
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
})
