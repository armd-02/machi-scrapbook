// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import StatusBanner from '../StatusBanner'
import { AppContext } from '../../context/AppContext'
import { createInitialState } from '../../state/appReducer'

/**
 * StatusBanner テスト
 *
 * - loading: スピナー付きバナー（常時表示・従来どおり）
 * - error: 赤バナー（常時表示・従来どおり）
 * - success かつ 0件: 案内バナー（常時表示・従来どおり）
 * - success かつ 1件以上: 取得報告がトースト化されていること
 *   - fixed 配置・pointer-events: none（操作を妨げない）
 *   - 約3秒で自動的に消える（fake timers で検証）
 *   - 新しい検索の成功（fetchedAt の変化）で再表示される
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function bannerWrapper(state) {
  return (
    <AppContext.Provider value={{ state, dispatch: vi.fn() }}>
      <StatusBanner />
    </AppContext.Provider>
  )
}

function successState(count = 3, fetchedAt = 1763000000000, meta = {}) {
  return {
    status: 'success',
    results: Array.from({ length: count }, (_, i) => ({
      type: 'node',
      id: i + 1,
      tags: { amenity: 'cafe', name: `カフェ${i + 1}` }
    })),
    fetchMeta: { fetchedAt, endpoint: 'armd-01', ...meta }
  }
}

describe('StatusBanner — 従来どおりの常時表示（loading・error・0件）', () => {
  it('loading: スピナー付きバナーを表示する', () => {
    render(bannerWrapper({ ...createInitialState(), status: 'loading' }))
    expect(screen.getByText('Overpass APIにクエリ実行中...')).toBeTruthy()
  })

  it('error: 赤バナーを表示する（エラー種別のラベル付き）', () => {
    render(bannerWrapper({
      ...createInitialState(),
      status: 'error',
      error: '応答がタイムアウトしました',
      errorType: 'timeout'
    }))
    expect(screen.getByText(/タイムアウト/)).toBeTruthy()
  })

  it('success かつ 0件: 「該当する結果がありません」バナーを表示する', () => {
    render(bannerWrapper({
      ...createInitialState(),
      status: 'success',
      results: [],
      fetchMeta: { fetchedAt: 1763000000000 }
    }))
    expect(screen.getByText('該当する結果がありません。')).toBeTruthy()
  })
})

describe('StatusBanner — 取得成功報のトースト（success かつ 1件以上）', () => {
  it('fixed 配置・pointer-events: none のトーストで件数・取得時刻・エンドポイントを表示する', () => {
    vi.useFakeTimers()
    render(bannerWrapper(successState(3)))
    const text = screen.getByText('3件の結果を取得しました')
    // 外側が fixed 配置のトースト（画面に重ねて表示）
    const fixed = text.closest('.fixed')
    expect(fixed).toBeTruthy()
    expect(fixed.className).toContain('pointer-events-none')
    // 内容は現行バナーと同じ（件数＋取得時刻＋エンドポイント）
    expect(screen.getByText(/取得: /)).toBeTruthy()
    expect(screen.getByText(/armd-01/)).toBeTruthy()
  })

  it('約3秒で自動的に消える', async () => {
    vi.useFakeTimers()
    render(bannerWrapper(successState(3)))
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(2999) })
    // まだ表示中
    expect(screen.queryByText('3件の結果を取得しました')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(1) })
    // 3秒経過で消える
    expect(screen.queryByText('3件の結果を取得しました')).toBeNull()
  })

  it('消えた後もフロー上のスペースが残らない（fixed 要素のためバナー枠自体が存在しない）', async () => {
    vi.useFakeTimers()
    const { container } = render(bannerWrapper(successState(3)))
    expect(container.querySelector('.fixed')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(3000) })
    // トーストも常時バナーもDOMに残らない
    expect(container.querySelector('.fixed')).toBeNull()
    expect(container.firstElementChild).toBeNull()
  })

  it('新しい検索が成功すると再表示する（fetchedAt の変化でタイマーがリセット）', async () => {
    vi.useFakeTimers()
    const { rerender } = render(bannerWrapper(successState(3, 1763000000000)))
    await act(async () => { vi.advanceTimersByTime(3000) })
    // 最初のトーストは消えた
    expect(screen.queryByText('3件の結果を取得しました')).toBeNull()
    // 新しい検索の成功（fetchedAt が変わる）→ 再表示
    rerender(bannerWrapper(successState(3, 1763000060000)))
    expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    // 再表示からまた約3秒で消える
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(screen.queryByText('3件の結果を取得しました')).toBeNull()
  })

  it('キャッシュ・フォールバックの注記も表示する', () => {
    vi.useFakeTimers()
    render(bannerWrapper(successState(2, 1763000000000, { cached: true, fallback: true })))
    expect(screen.getByText(/（キャッシュ）/)).toBeTruthy()
    expect(screen.getByText(/（フォールバック利用）/)).toBeTruthy()
  })
})
