// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useMemocho, resetMemochoStore } from '../useMemocho'
import { MEMOCHO_STORAGE_KEY, memochoKeyOf } from '../../utils/memocho'
import { CMM_TOMBSTONE_KEY, loadCmmTombstones } from '../../utils/cmmTombstones'

/**
 * 第2ピース: まちメモ帳の状態管理フック
 * - 追加・削除（論理削除・完全削除）・メモ更新が items と localStorage の両方に反映される
 * - ごみ箱（deletedAt）: trash/restore/wipeAll/emptyTrash、active（アクティブのみ）
 * - 複数フックインスタンス間で状態が同期する（モジュールレベルストア＋購読）
 * - 変更のたびに localStorage へ保存される
 */

const COFFEE = {
  type: 'node', id: 1001, lat: 34.85, lon: 135.5,
  tags: { name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee' },
}
const PARK = {
  type: 'way', id: 77, lat: 34.8, lon: 135.5,
  tags: { name: 'みらい公園', leisure: 'park' },
}

beforeEach(() => {
  localStorage.clear()
  resetMemochoStore()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  resetMemochoStore()
})

function storedItems() {
  return JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
}

// add は bookId を受け付けない（新メモはデフォルト所属）ため、
// bookId 付きの初期状態は localStorage に直接置いて再現するヘルパー
function seeded(over) {
  return {
    ...COFFEE,
    memo: '',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('useMemocho', () => {
  it('初期状態は空配列（localStorage が空の場合）', () => {
    const { result } = renderHook(() => useMemocho())
    expect(result.current.items).toEqual([])
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(false)
  })

  it('マウント時に localStorage の保存データを復元する', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      { type: 'node', id: 1001, name: 'テスト珈琲店', lat: 34.85, lon: 135.5, tags: null, memo: '前回訪問済み', addedAt: null },
    ]))
    const { result } = renderHook(() => useMemocho())
    expect(result.current.items).toHaveLength(1)
    expect(result.current.has('node/1001')).toBe(true)
    expect(result.current.items[0].memo).toBe('前回訪問済み')
  })

  it('add: スナップショットが追加され、has() が true になる', () => {
    const { result } = renderHook(() => useMemocho())
    let added
    act(() => { added = result.current.add(COFFEE) })
    expect(added).toBe(true)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({
      type: 'node', id: 1001, name: 'テスト珈琲店', memo: '',
    })
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(true)
    expect(result.current.has(memochoKeyOf(PARK))).toBe(false)
  })

  it('add: localStorage に保存される（変更のたびに保存）', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    expect(storedItems()).toHaveLength(1)
    expect(storedItems()[0]).toMatchObject({ type: 'node', id: 1001, name: 'テスト珈琲店' })

    act(() => { result.current.add(PARK) })
    expect(storedItems()).toHaveLength(2)
  })

  it('add: 既に登録済みのキーは重複追加しない（false を返す）', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    let added
    act(() => { added = result.current.add(COFFEE) })
    expect(added).toBe(false)
    expect(result.current.items).toHaveLength(1)
    expect(storedItems()).toHaveLength(1)
  })

  it('remove: アイテムが削除され、localStorage にも反映される', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    let removed
    act(() => { removed = result.current.remove(memochoKeyOf(COFFEE)) })
    expect(removed).toBe(true)
    expect(result.current.items).toHaveLength(0)
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(false)
    expect(storedItems()).toHaveLength(0)
  })

  it('remove: 存在しないキーは削除せず（false を返す）', () => {
    const { result } = renderHook(() => useMemocho())
    let removed
    act(() => { removed = result.current.remove('way/999') })
    expect(removed).toBe(false)
    expect(result.current.items).toHaveLength(0)
  })

  it('setMemo: メモ文字列が更新され、localStorage にも反映される', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.setMemo(memochoKeyOf(COFFEE), 'Wi-Fiがあります') })
    expect(result.current.items[0].memo).toBe('Wi-Fiがあります')
    expect(storedItems()[0].memo).toBe('Wi-Fiがあります')
  })

  it('setRating: 評価が更新され、localStorage にも反映される', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.setRating(memochoKeyOf(COFFEE), 5) })
    expect(result.current.items[0].rating).toBe(5)
    expect(storedItems()[0].rating).toBe(5)
  })

  it('setRating に 0 を渡すと未評価に戻る（評価解除）', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.setRating(memochoKeyOf(COFFEE), 4) })
    act(() => { result.current.setRating(memochoKeyOf(COFFEE), 0) })
    expect(result.current.items[0].rating).toBe(0)
    expect(storedItems()[0].rating).toBe(0)
  })

  it('setRating は 0〜5 の整数以外の値では変更しない', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.setRating(memochoKeyOf(COFFEE), 9) })
    expect(result.current.items[0].rating).toBe(0) // 初期値（未評価）のまま
    expect(storedItems()[0].rating).toBe(0)
  })

  it('setRating: 複数フック間で評価が同期する', () => {
    const a = renderHook(() => useMemocho())
    const b = renderHook(() => useMemocho())
    act(() => { a.result.current.add(COFFEE) })
    act(() => { b.result.current.setRating(memochoKeyOf(COFFEE), 3) })
    expect(a.result.current.items[0].rating).toBe(3)
  })

  it('toggle: 未登録なら追加（added）、登録済みならごみ箱へ（removed）、ごみ箱なら復元（added）', () => {
    const { result } = renderHook(() => useMemocho())
    let action
    act(() => { action = result.current.toggle(COFFEE) })
    expect(action).toBe('added')
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(true)

    // 2回目: 論理削除（deletedAt を付けてごみ箱へ）。ストアには残り続ける
    act(() => { action = result.current.toggle(COFFEE) })
    expect(action).toBe('removed')
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(false)
    expect(result.current.active).toHaveLength(0)
    expect(result.current.items).toHaveLength(1) // ごみ箱のアイテムもストアに残る
    expect(result.current.items[0].deletedAt).toBeTruthy()

    // 3回目: ごみ箱から復元（deletedAt が除去される）
    act(() => { action = result.current.toggle(COFFEE) })
    expect(action).toBe('added')
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(true)
    expect(result.current.active).toHaveLength(1)
    expect(result.current.items[0].deletedAt).toBeUndefined()
  })

  it('複数フック間で状態が同期する（1つで追加すると他も即座に反映）', () => {
    const a = renderHook(() => useMemocho())
    const b = renderHook(() => useMemocho())
    expect(a.result.current.items).toHaveLength(0)
    expect(b.result.current.items).toHaveLength(0)

    act(() => { a.result.current.add(COFFEE) })
    // a・b 双方に同じアイテムが見える
    expect(a.result.current.items).toHaveLength(1)
    expect(b.result.current.items).toHaveLength(1)
    expect(b.result.current.has(memochoKeyOf(COFFEE))).toBe(true)

    act(() => { b.result.current.setMemo(memochoKeyOf(COFFEE), 'bから更新') })
    expect(a.result.current.items[0].memo).toBe('bから更新')

    act(() => { b.result.current.remove(memochoKeyOf(COFFEE)) })
    expect(a.result.current.items).toHaveLength(0)
    expect(b.result.current.items).toHaveLength(0)
  })

  it('add: 不正な source（type/id が不足）は追加しない（false を返す）', () => {
    const { result } = renderHook(() => useMemocho())
    let added
    act(() => { added = result.current.add({ tags: { name: '謎' } }) })
    expect(added).toBe(false)
    expect(result.current.items).toHaveLength(0)
    expect(storedItems()).toBe(null) // 何も保存されていない
  })

  it('wipeAll: アクティブ＋ごみ箱の全件を完全に削除し、消去した件数を返す', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.add(PARK) })
    expect(result.current.items).toHaveLength(2)

    // 1件を論理削除（ごみ箱）にする
    act(() => { result.current.trash(memochoKeyOf(COFFEE)) })
    expect(result.current.active).toHaveLength(1)
    expect(result.current.trashItems).toHaveLength(1)

    // wipeAll はごみ箱のアイテムも含めて全件を完全に削除する
    let count
    act(() => { count = result.current.wipeAll() })
    expect(count).toBe(2)
    expect(result.current.items).toEqual([])
    expect(storedItems()).toEqual([])
  })

  it('trash: 論理削除 — deletedAt が付き、has() が false になる', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(true)

    let trashed
    act(() => { trashed = result.current.trash(memochoKeyOf(COFFEE)) })
    expect(trashed).toBe(true)
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(false)
    expect(result.current.active).toHaveLength(0)
    expect(result.current.trashItems).toHaveLength(1)
    const stored = storedItems()
    expect(stored).toHaveLength(1)
    expect(stored[0].deletedAt).toBeTruthy()
  })

  it('trash: 存在しないキーは無変更（false を返す）', () => {
    const { result } = renderHook(() => useMemocho())
    let trashed
    act(() => { trashed = result.current.trash('node/999') })
    expect(trashed).toBe(false)
    expect(storedItems()).toBe(null)
  })

  it('restore: ごみ箱から復元（deletedAt が除去される）', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.trash(memochoKeyOf(COFFEE)) })
    expect(result.current.trashItems).toHaveLength(1)

    let restored
    act(() => { restored = result.current.restore(memochoKeyOf(COFFEE)) })
    expect(restored).toBe(true)
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(true)
    expect(result.current.active).toHaveLength(1)
    expect(result.current.trashItems).toHaveLength(0)
    expect(result.current.items[0].deletedAt).toBeUndefined()
  })

  it('add: 同じキーがごみ箱にある場合、復元する（重複作成しない）', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.trash(memochoKeyOf(COFFEE)) })
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(false)

    // 同じ検索結果を再度追加 → 復元される（新規重複にならない）
    let added
    act(() => { added = result.current.add(COFFEE) })
    expect(added).toBe(true)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(true)
  })

  it('emptyTrash: ごみ箱のみを完全に削除する（アクティブは影響しない）', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.add(PARK) })
    act(() => { result.current.trash(memochoKeyOf(COFFEE)) })
    expect(result.current.active).toHaveLength(1)
    expect(result.current.trashItems).toHaveLength(1)

    let removed
    act(() => { removed = result.current.emptyTrash() })
    expect(removed).toBe(1)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.active).toHaveLength(1)
    expect(result.current.trashItems).toHaveLength(0)
    expect(result.current.active[0].name).toBe('みらい公園')
  })

  it('remove: 完全削除はごみ箱のアイテムも削除できる', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.trash(memochoKeyOf(COFFEE)) })
    expect(result.current.items).toHaveLength(1)

    let removed
    act(() => { removed = result.current.remove(memochoKeyOf(COFFEE)) })
    expect(removed).toBe(true)
    expect(result.current.items).toEqual([])
    expect(storedItems()).toEqual([])
  })

  describe('moveBook（ブック削除時の所属移動）', () => {
    it('指定ブックの全アイテム（ごみ箱含む）を別のブックへ移す', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
        seeded({ bookId: 'sb_001' }),
        seeded({ type: 'way', id: 77, name: 'みらい公園', tags: { name: 'みらい公園', leisure: 'park' }, bookId: 'sb_001' }),
        seeded({ id: 55, name: 'デフォ店', tags: { name: 'デフォ店' }, bookId: 'sb_002' }),
      ]))
      const { result } = renderHook(() => useMemocho())

      let moved = false
      act(() => {
        moved = result.current.moveBook('sb_001', 'default')
      })
      expect(moved).toBe(true)
      const byId = Object.fromEntries(result.current.items.map((it) => [it.id, it]))
      expect(byId[1001].bookId).toBe('default')
      expect(byId[77].bookId).toBe('default')
      expect(byId[55].bookId).toBe('sb_002') // 別のブックは不変
      // localStorage にも反映される
      const stored = storedItems()
      expect(stored.filter((it) => it.bookId === 'default')).toHaveLength(2)
      expect(stored.filter((it) => it.bookId === 'sb_002')).toHaveLength(1)
    })

    it('ごみ箱のアイテムも移動する', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
        seeded({ bookId: 'sb_001', deletedAt: '2026-01-02T00:00:00.000Z' }),
      ]))
      const { result } = renderHook(() => useMemocho())
      expect(result.current.trashItems).toHaveLength(1)

      let moved = false
      act(() => { moved = result.current.moveBook('sb_001', 'default') })
      expect(moved).toBe(true)
      expect(result.current.trashItems[0].bookId).toBe('default')
    })

    it('該当アイテムが無ければ false を返し、状態は不変', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
        seeded({ bookId: 'sb_002' }),
      ]))
      const { result } = renderHook(() => useMemocho())

      let moved = true
      act(() => { moved = result.current.moveBook('sb_001', 'default') })
      expect(moved).toBe(false)
      expect(result.current.items[0].bookId).toBe('sb_002')
    })
  })

  describe('setBook（カテゴリ編集モード中の個別変更）', () => {
    it('アイテムの bookId が変更され、localStorage にも反映される', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
        seeded({ bookId: 'sb_001' }),
        seeded({ id: 77, bookId: 'sb_001' }),
      ]))
      const { result } = renderHook(() => useMemocho())
      expect(result.current.items[0].bookId).toBe('sb_001')

      act(() => { result.current.setBook(memochoKeyOf(COFFEE), 'sb_002') })
      // 指定したアイテムだけが変更され、他は不変
      expect(result.current.items[0].bookId).toBe('sb_002')
      expect(result.current.items[1].bookId).toBe('sb_001')
      const stored = storedItems()
      expect(stored.filter((it) => it.bookId === 'sb_002')).toHaveLength(1)
      expect(stored.filter((it) => it.bookId === 'sb_001')).toHaveLength(1)
    })

    it('存在しないキー・不正な bookId では何も変更しない', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([seeded({ bookId: 'sb_001' })]))
      const { result } = renderHook(() => useMemocho())

      act(() => { result.current.setBook('node/9999', 'sb_002') })
      act(() => { result.current.setBook(memochoKeyOf(COFFEE), '') })
      act(() => { result.current.setBook(memochoKeyOf(COFFEE), null) })
      expect(result.current.items[0].bookId).toBe('sb_001')
    })
  })

  describe('cmmId の墓碑（tombstone）記録', () => {
    it('remove: cmmId があるアイテムを完全削除すると墓碑に記録される', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([seeded({ cmmId: 'cmm_1001' })]))
      const { result } = renderHook(() => useMemocho())

      let removed
      act(() => { removed = result.current.remove(memochoKeyOf(COFFEE)) })
      expect(removed).toBe(true)
      expect(loadCmmTombstones()).toEqual(['cmm_1001'])
      // メモ自体は完全に削除される
      expect(result.current.items).toHaveLength(0)
      expect(storedItems()).toHaveLength(0)
    })

    it('remove: cmmId がないアイテムの完全削除では墓碑が記録されない', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([seeded()]))
      const { result } = renderHook(() => useMemocho())

      act(() => { result.current.remove(memochoKeyOf(COFFEE)) })
      expect(loadCmmTombstones()).toEqual([])
      expect(localStorage.getItem(CMM_TOMBSTONE_KEY)).toBeNull()
    })

    it('trash（論理削除）では墓碑が記録されない（復元可能なため）', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([seeded({ cmmId: 'cmm_1001' })]))
      const { result } = renderHook(() => useMemocho())

      let trashed
      act(() => { trashed = result.current.trash(memochoKeyOf(COFFEE)) })
      expect(trashed).toBe(true)
      // ごみ箱に入っただけで墓碑は記録しない
      expect(loadCmmTombstones()).toEqual([])
      // 復元しても墓碑は記録されない
      act(() => { result.current.restore(memochoKeyOf(COFFEE)) })
      expect(loadCmmTombstones()).toEqual([])
    })

    it('wipeAll: cmmId がある全アイテム（アクティブ＋ごみ箱）の ID が墓碑に記録される', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
        seeded({ cmmId: 'cmm_a' }),
        seeded({ id: 77, cmmId: 'cmm_b' }),
        seeded({ id: 88, cmmId: 'cmm_a', deletedAt: '2026-01-02T00:00:00.000Z' }), // 重複ID・ごみ箱
        seeded({ id: 99, deletedAt: '2026-01-02T00:00:00.000Z' }), // cmmId なし・ごみ箱
      ]))
      const { result } = renderHook(() => useMemocho())

      let count
      act(() => { count = result.current.wipeAll() })
      expect(count).toBe(4)
      // 重複除去された cmmId が記録される
      expect(loadCmmTombstones()).toEqual(['cmm_a', 'cmm_b'])
      expect(result.current.items).toHaveLength(0)
    })

    it('wipeAll: cmmId がない場合でもエラーにならず墓碑は空のまま', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([seeded()]))
      const { result } = renderHook(() => useMemocho())

      act(() => { result.current.wipeAll() })
      expect(loadCmmTombstones()).toEqual([])
    })

    it('emptyTrash: cmmId があるごみ箱アイテムの ID が墓碑に記録される', () => {
      localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
        seeded({ cmmId: 'cmm_a' }), // アクティブ（削除対象外）
        seeded({ id: 88, cmmId: 'cmm_b', deletedAt: '2026-01-02T00:00:00.000Z' }), // ごみ箱
        seeded({ id: 99, deletedAt: '2026-01-02T00:00:00.000Z' }), // cmmId なし・ごみ箱
      ]))
      const { result } = renderHook(() => useMemocho())

      let removed
      act(() => { removed = result.current.emptyTrash() })
      expect(removed).toBe(2)
      // ごみ箱の cmmId のみ記録される（アクティブの cmm_a は対象外）
      expect(loadCmmTombstones()).toEqual(['cmm_b'])
      expect(result.current.items).toHaveLength(1)
      expect(result.current.items[0].cmmId).toBe('cmm_a')
    })

    it('add / setBook / setMemo 等の非削除操作では墓碑が記録されない', () => {
      const { result } = renderHook(() => useMemocho())
      act(() => { result.current.add({ ...COFFEE, cmmId: 'cmm_a' }) })
      act(() => { result.current.setBook(memochoKeyOf(COFFEE), 'sb_001') })
      act(() => { result.current.setMemo(memochoKeyOf(COFFEE), 'メモ') })
      expect(loadCmmTombstones()).toEqual([])
    })
  })
})
