// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useMemocho, resetMemochoStore } from '../useMemocho'
import { MEMOCHO_STORAGE_KEY, memochoKeyOf } from '../../utils/memocho'

/**
 * 第2ピース: まちメモ帳の状態管理フック
 * - 追加・削除・メモ更新が items と localStorage の両方に反映される
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

  it('toggle: 未登録なら追加（added）、登録済みなら削除（removed）', () => {
    const { result } = renderHook(() => useMemocho())
    let action
    act(() => { action = result.current.toggle(COFFEE) })
    expect(action).toBe('added')
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(true)

    act(() => { action = result.current.toggle(COFFEE) })
    expect(action).toBe('removed')
    expect(result.current.has(memochoKeyOf(COFFEE))).toBe(false)
    expect(result.current.items).toHaveLength(0)
    expect(storedItems()).toHaveLength(0)
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

  it('全件削除は remove を各アイテムに適用することで実現する（clearAll なし）', () => {
    const { result } = renderHook(() => useMemocho())
    act(() => { result.current.add(COFFEE) })
    act(() => { result.current.add(PARK) })
    expect(result.current.items).toHaveLength(2)

    // HeaderMenu / MemochoSection の全消去は items.forEach(item => remove(key))
    act(() => {
      const items = result.current.items
      items.forEach((item) => result.current.remove(memochoKeyOf(item)))
    })
    expect(result.current.items).toEqual([])
    expect(storedItems()).toEqual([])
  })
})
