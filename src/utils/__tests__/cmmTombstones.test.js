// @vitest-environment jsdom
/**
 * CMM 同期の墓碑（tombstone）リスト（cmmTombstones.js）のテスト
 *
 * 検証内容:
 * - loadCmmTombstones: 未保存・壊れたJSON・配列でない・不正な要素 → []、重複除去
 * - saveCmmTombstones
 * - addCmmTombstones: 新規追加・既存スキップ・不正値無視・戻り値（追加されたID）
 * - clearCmmTombstones: 全消去
 * - cmmIdsOf: アイテム群から cmmId を重複除去して抽出
 * - isValidCmmId
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CMM_TOMBSTONE_KEY,
  isValidCmmId,
  loadCmmTombstones,
  saveCmmTombstones,
  addCmmTombstones,
  clearCmmTombstones,
  cmmIdsOf,
} from '../cmmTombstones'

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

describe('cmmTombstones', () => {
  beforeEach(() => {
    // jsdom の localStorage は getter のみなので defineProperty で差し替える
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageStub(),
      writable: true,
      configurable: true,
    })
  })

  describe('isValidCmmId', () => {
    it('空でない文字列のみ有効', () => {
      expect(isValidCmmId('cmm_123')).toBe(true)
      expect(isValidCmmId('')).toBe(false)
      for (const bad of [undefined, null, 42, {}, []]) {
        expect(isValidCmmId(bad)).toBe(false)
      }
    })
  })

  describe('loadCmmTombstones', () => {
    it('未保存なら [] を返す', () => {
      expect(loadCmmTombstones()).toEqual([])
    })

    it('壊れた JSON・配列でなければ [] を返す', () => {
      localStorage.setItem(CMM_TOMBSTONE_KEY, '{oops')
      expect(loadCmmTombstones()).toEqual([])
      localStorage.setItem(CMM_TOMBSTONE_KEY, JSON.stringify('nope'))
      expect(loadCmmTombstones()).toEqual([])
      localStorage.setItem(CMM_TOMBSTONE_KEY, JSON.stringify({ ids: [] }))
      expect(loadCmmTombstones()).toEqual([])
    })

    it('保存されたリストを読み、不正な要素を除外して重複除去する', () => {
      localStorage.setItem(CMM_TOMBSTONE_KEY, JSON.stringify([
        'cmm_a', 'cmm_b', 'cmm_a', '', 42, null, 'cmm_c',
      ]))
      expect(loadCmmTombstones()).toEqual(['cmm_a', 'cmm_b', 'cmm_c'])
    })

    it('save → load で往復する', () => {
      saveCmmTombstones(['cmm_a', 'cmm_b'])
      expect(loadCmmTombstones()).toEqual(['cmm_a', 'cmm_b'])
    })
  })

  describe('saveCmmTombstones', () => {
    it('配列を JSON 配列として保存する', () => {
      saveCmmTombstones(['cmm_a'])
      expect(localStorage.getItem(CMM_TOMBSTONE_KEY)).toBe(JSON.stringify(['cmm_a']))
    })

    it('配列以外を渡しても空配列として保存する', () => {
      saveCmmTombstones('nope')
      expect(localStorage.getItem(CMM_TOMBSTONE_KEY)).toBe('[]')
    })
  })

  describe('addCmmTombstones', () => {
    it('新規の ID を追加し、追加された ID の配列を返す', () => {
      const added = addCmmTombstones(['cmm_a', 'cmm_b'])
      expect(added).toEqual(['cmm_a', 'cmm_b'])
      expect(loadCmmTombstones()).toEqual(['cmm_a', 'cmm_b'])
    })

    it('既存の ID はスキップされる（重複記録されない）', () => {
      saveCmmTombstones(['cmm_a'])
      const added = addCmmTombstones(['cmm_a', 'cmm_b'])
      expect(added).toEqual(['cmm_b'])
      expect(loadCmmTombstones()).toEqual(['cmm_a', 'cmm_b'])
    })

    it('すべて既存なら何も保存されず [] を返す', () => {
      saveCmmTombstones(['cmm_a'])
      const added = addCmmTombstones(['cmm_a'])
      expect(added).toEqual([])
      expect(loadCmmTombstones()).toEqual(['cmm_a'])
    })

    it('不正な値（空でない文字列でない）は無視される', () => {
      const added = addCmmTombstones(['cmm_a', '', 42, null])
      expect(added).toEqual(['cmm_a'])
    })

    it('配列以外を渡してもエラーにならず [] を返す', () => {
      expect(addCmmTombstones(undefined)).toEqual([])
      expect(addCmmTombstones('nope')).toEqual([])
    })
  })

  describe('clearCmmTombstones', () => {
    it('墓碑リストをすべて消去する', () => {
      saveCmmTombstones(['cmm_a', 'cmm_b'])
      clearCmmTombstones()
      expect(loadCmmTombstones()).toEqual([])
    })

    it('空リストでもエラーにならない', () => {
      expect(() => clearCmmTombstones()).not.toThrow()
      expect(loadCmmTombstones()).toEqual([])
    })
  })

  describe('cmmIdsOf', () => {
    it('cmmId が空でない文字列のアイテムから重複除去して抽出する', () => {
      const items = [
        { cmmId: 'cmm_a' },
        { cmmId: 'cmm_b' },
        { cmmId: 'cmm_a' }, // 重複
        { cmmId: '' }, // 空文字 → 対象外
        { cmmId: 42 }, // 型違い → 対象外
        { cmmId: null }, // null → 対象外
        {}, // 欠落 → 対象外
        null,
      ]
      expect(cmmIdsOf(items)).toEqual(['cmm_a', 'cmm_b'])
    })

    it('cmmId が無いアイテム群なら [] を返す', () => {
      expect(cmmIdsOf([{}, { cmmId: '' }])).toEqual([])
    })

    it('配列以外を渡しても [] を返す', () => {
      expect(cmmIdsOf(undefined)).toEqual([])
      expect(cmmIdsOf('nope')).toEqual([])
    })
  })
})
