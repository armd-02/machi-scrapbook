// @vitest-environment jsdom
/**
 * useScrapbooks フックのテスト
 *
 * 検証内容:
 * - 初期状態は「デフォルト」のみの配列。localStorage に保存があれば復元される
 * - create: 名前で作成（作成したブックが返される・localStorage に保存される）。
 *   名前が空（空白のみ含む）の場合は何もしない（null を返す）
 * - rename: 名前を変更できる（localStorage に保存される）。
 *   空名前・ID 不存在の場合は変更しない（false）
 * - remove: ブックを削除できる。「デフォルト」は削除できない（false）
 * - setPublic: 公開設定（public）を切り替えられる（「デフォルト」も含む）。
 *   ID 不存在の場合は変更しない（false）
 * - 複数フック間で状態が同期する
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useScrapbooks, resetScrapbooksStore } from '../useScrapbooks'
import { SCRAPBOOKS_STORAGE_KEY } from '../../utils/scrapbooks'

function seedBooks(books) {
  localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify(books))
}

describe('useScrapbooks', () => {
  beforeEach(() => {
    localStorage.clear()
    resetScrapbooksStore()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    resetScrapbooksStore()
  })

  it('初期状態は「デフォルト」のみの配列（public: false）', () => {
    const { result } = renderHook(() => useScrapbooks())
    expect(result.current.books).toEqual([
      { id: 'default', name: 'デフォルト', createdAt: null, public: false },
    ])
  })

  it('localStorage に保存があれば復元される（デフォルトが先頭）', () => {
    seedBooks([
      { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'default', name: '標準', createdAt: null },
    ])
    const { result } = renderHook(() => useScrapbooks())
    expect(result.current.books).toEqual([
      { id: 'default', name: '標準', createdAt: null, public: false },
      { id: 'sb_001', name: 'カフェ', createdAt: '2026-01-01T00:00:00.000Z', public: false },
    ])
  })

  it('create: 名前で作成でき、作成したブックが返され localStorage に保存される', () => {
    const { result } = renderHook(() => useScrapbooks())
    let created = null
    act(() => {
      created = result.current.create('  桜  ')
    })
    // 前後空白はトリムされる
    expect(created).toMatchObject({ id: expect.stringMatching(/^sb_/), name: '桜' })
    expect(result.current.books.map((b) => b.name)).toEqual(['デフォルト', '桜'])
    const stored = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(stored.some((b) => b.id === created.id && b.name === '桜')).toBe(true)
  })

  it('create: 名前が空（または空白のみ）の場合は何もしない（null を返す）', () => {
    const { result } = renderHook(() => useScrapbooks())
    for (const bad of ['', '   ']) {
      let created = {}
      act(() => {
        created = result.current.create(bad)
      })
      expect(created).toBeNull()
    }
    expect(result.current.books).toHaveLength(1)
    expect(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY)).toBeNull()
  })

  it('rename: 名前を変更でき、localStorage に保存される', () => {
    seedBooks([{ id: 'sb_001', name: 'カフェ' }])
    const { result } = renderHook(() => useScrapbooks())

    let ok = false
    act(() => {
      ok = result.current.rename('sb_001', 'コーヒー')
    })
    expect(ok).toBe(true)
    expect(result.current.books.find((b) => b.id === 'sb_001').name).toBe('コーヒー')
    const stored = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(stored.find((b) => b.id === 'sb_001').name).toBe('コーヒー')
  })

  it('rename: 空名前・ID 不存在の場合は変更しない（false）', () => {
    seedBooks([{ id: 'sb_001', name: 'カフェ' }])
    const { result } = renderHook(() => useScrapbooks())

    let ok = true
    act(() => {
      ok = result.current.rename('sb_001', '   ')
    })
    expect(ok).toBe(false)
    act(() => {
      ok = result.current.rename('sb_gone', 'テスト')
    })
    expect(ok).toBe(false)
    // 名前も保存も不変
    expect(result.current.books.find((b) => b.id === 'sb_001').name).toBe('カフェ')
    const stored = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(stored.find((b) => b.id === 'sb_001').name).toBe('カフェ')
  })

  it('remove: 作成したブックを削除できる', () => {
    seedBooks([{ id: 'sb_001', name: 'カフェ' }])
    const { result } = renderHook(() => useScrapbooks())

    let ok = false
    act(() => {
      ok = result.current.remove('sb_001')
    })
    expect(ok).toBe(true)
    expect(result.current.books).toHaveLength(1)
    const stored = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(stored.some((b) => b.id === 'sb_001')).toBe(false)
  })

  it('remove: 「デフォルト」は削除できない（false・リスト不変）', () => {
    seedBooks([{ id: 'sb_001', name: 'カフェ' }])
    const { result } = renderHook(() => useScrapbooks())

    let ok = true
    act(() => {
      ok = result.current.remove('default')
    })
    expect(ok).toBe(false)
    expect(result.current.books).toHaveLength(2)
  })

  it('setPublic: 公開設定を切り替えられ、localStorage に保存される', () => {
    seedBooks([{ id: 'sb_001', name: 'カフェ' }])
    const { result } = renderHook(() => useScrapbooks())

    let ok = false
    act(() => {
      ok = result.current.setPublic('sb_001', true)
    })
    expect(ok).toBe(true)
    expect(result.current.books.find((b) => b.id === 'sb_001').public).toBe(true)
    const stored = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(stored.find((b) => b.id === 'sb_001').public).toBe(true)

    // 逆方向（非公開へ）も切替できる
    act(() => {
      ok = result.current.setPublic('sb_001', false)
    })
    expect(ok).toBe(true)
    expect(result.current.books.find((b) => b.id === 'sb_001').public).toBe(false)
    const stored2 = JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))
    expect(stored2.find((b) => b.id === 'sb_001').public).toBe(false)
  })

  it('setPublic: 「デフォルト」ブックも公開設定を変更できる', () => {
    const { result } = renderHook(() => useScrapbooks())

    let ok = false
    act(() => {
      ok = result.current.setPublic('default', true)
    })
    expect(ok).toBe(true)
    expect(result.current.books[0].public).toBe(true)
  })

  it('setPublic: ID 不存在の場合は変更しない（false・保存不変）', () => {
    const seed = [{ id: 'sb_001', name: 'カフェ' }]
    seedBooks(seed)
    const { result } = renderHook(() => useScrapbooks())

    let ok = true
    act(() => {
      ok = result.current.setPublic('sb_gone', true)
    })
    expect(ok).toBe(false)
    // フック側の状態は正規化済み（public: false）だが変更は無い
    expect(result.current.books.find((b) => b.id === 'sb_001').public).toBe(false)
    // 変更がないので localStorage は書き直されない（seed のまま）
    expect(JSON.parse(localStorage.getItem(SCRAPBOOKS_STORAGE_KEY))).toEqual(seed)
  })

  it('複数フック間で状態が同期する', () => {
    const a = renderHook(() => useScrapbooks())
    const b = renderHook(() => useScrapbooks())

    let created = null
    act(() => {
      created = b.result.current.create('公園')
    })

    // a 側にも新しいブックが見える
    expect(a.result.current.books.map((b) => b.name)).toEqual(['デフォルト', '公園'])
    expect(created.id).toBe(b.result.current.books[1].id)
  })
})
