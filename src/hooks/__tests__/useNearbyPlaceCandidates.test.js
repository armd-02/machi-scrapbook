// @vitest-environment jsdom
/**
 * useNearbyPlaceCandidates — 現在位置取得の「ハング・再試行」修正テスト
 *
 * 背景（ユーザー報告 2026-11-22）:
 * - Geolocation が成功・エラーのどちらのコールバックも呼ばない（ハング）と、
 *   Promise が永久に未確定になり status が 'locating' のまま詰まる。busyRef も
 *   解放されないため、その後のフォーカスはすべて即 return で再試行できない
 * - 取得が失敗すると failedRef が立ち、awaitPosition（「地名検索」の viewbox
 *   付け用）が以後ずっと即 null を返し、一時的な失敗でもセッション内では
 *   回復しない
 *
 * 検証するもの:
 * 1. コールバックを呼ばない Geolocation（ハング）でも request はアプリ側
 *    タイムアウトで確定し status が進む。その後の再フォーカスで再試行される
 * 2. 失敗 → 再試行成功で center が設定される
 * 3. awaitPosition は過去の失敗だけで恒久的に諦めない（「地名検索」押下で再試行）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useNearbyPlaceCandidates } from '../useNearbyPlaceCandidates'

const h = vi.hoisted(() => ({
  nearbyResults: [],
  nearbyError: null,
  geoCalls: 0,
}))

vi.mock('../../utils/nearbyCandidates', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchNearbyCandidates: async () => {
      if (h.nearbyError) return { candidates: [], error: h.nearbyError }
      return { candidates: h.nearbyResults, error: null }
    },
  }
})

// アプリ側タイムアウト（フック内の GEO_TIMEOUT_MS = 10000ms）
const GEO_TIMEOUT_MS = 10000

// Geolocation モック。mode:
//   'ok'   — 成功位置（34.7, 135.5）を即返す
//   'fail' — 拒否（err）を返す
//   'hang' — どちらのコールバックも呼ばない（ハングの再現）
function setupGeolocation(mode) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok, err) => {
        h.geoCalls++
        if (mode === 'ok') {
          setTimeout(() => ok({ coords: { latitude: 34.7, longitude: 135.5 } }), 0)
        } else if (mode === 'fail') {
          setTimeout(() => err(new Error('denied')), 0)
        }
        // 'hang': どちらのコールバックも呼ばない
      },
      watchPosition: () => 0,
      clearWatch: () => {},
    },
  })
}

beforeEach(() => {
  h.nearbyResults = []
  h.nearbyError = null
  h.geoCalls = 0
  setupGeolocation('ok')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useNearbyPlaceCandidates: 現在位置取得のハング・再試行', () => {
  it('ハング（コールバックなし）: request はアプリ側タイムアウトで確定し status が進む。再フォーカスで再試行される', async () => {
    vi.useFakeTimers()
    setupGeolocation('hang')
    const { result } = renderHook(() => useNearbyPlaceCandidates())

    // 位置取得開始（ハング: コールバックなし）
    act(() => {
      result.current.request()
    })
    expect(result.current.status).toBe('locating')
    expect(h.geoCalls).toBe(1)

    // アプリ側タイマー（10秒）が発火 → 確定（'locating' に詰まったままにならない）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GEO_TIMEOUT_MS)
    })
    expect(result.current.status).toBe('denied')

    // 再フォーカス → 再試行（新しい getCurrentPosition が呼ばれる）
    act(() => {
      result.current.request()
    })
    expect(h.geoCalls).toBe(2)
    expect(result.current.status).toBe('locating')
  })

  it('失敗 → 再試行成功: center が設定される', async () => {
    vi.useFakeTimers()
    setupGeolocation('fail')
    const { result } = renderHook(() => useNearbyPlaceCandidates())

    // 初回フォーカス → 失敗（拒否）
    await act(async () => {
      result.current.request()
      await vi.runAllTimersAsync()
    })
    expect(result.current.status).toBe('denied')
    expect(result.current.center).toBeNull()

    // 成功モードにして再フォーカス → 再試行が成功
    setupGeolocation('ok')
    await act(async () => {
      result.current.request()
      await vi.runAllTimersAsync()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.center).toEqual({ lat: 34.7, lon: 135.5 })
  })

  it('awaitPosition: 過去の失敗だけで恒久的に諦めない（「地名検索」押下で再試行）', async () => {
    vi.useFakeTimers()
    setupGeolocation('fail')
    const { result } = renderHook(() => useNearbyPlaceCandidates())

    // 初回取得が失敗
    await act(async () => {
      result.current.request()
      await vi.runAllTimersAsync()
    })
    expect(result.current.center).toBeNull()

    // 成功モードにして awaitPosition を呼ぶ（「地名検索」押下の再現）
    setupGeolocation('ok')
    let posPromise
    await act(async () => {
      posPromise = result.current.awaitPosition()
      await vi.runAllTimersAsync()
    })
    // 新しい getCurrentPosition が呼ばれ（再試行）、位置が返る
    expect(h.geoCalls).toBe(2)
    const pos = await posPromise
    expect(pos).toEqual({ lat: 34.7, lon: 135.5 })
  })
})
