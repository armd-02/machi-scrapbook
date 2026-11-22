// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from '../../../App'
import { clearCache } from '../../../utils/overpass'

/**
 * 全国駅ファイル（stations.json）の読み込み失敗時の挙動の検証
 *
 * 前提（2026-11-22 検討）: 駅ファイルはトップ表示時に1回だけ読み込む。
 * 読み込みに失敗した場合は、無言で「駅候補なし」に化けさせず、通信エラーとして
 * 利用者に分かる形で表示する。その回の候補提示はエラーとして終える。
 * 再試行はページの再読み込みのみ（フォーカスでの再試行はしない）。
 *
 * - 駅ファイルの読み込み失敗（HTTP 404）で、場所入力まわりに通信エラーが
 *   表示される（role="alert"）
 * - 駅候補は出ない（駅名を入力しても候補は出ない）
 *
 * mobileStationPrefetch.test.jsx と別ファイルなのは、stationCandidates に
 * モジュールレベルのキャッシュ（cachePromise）があり、同一ファイル内で先行
 * テストの成功結果が再利用されて失敗経路を検証できなくなるため。
 *
 * MapLibre GL は WebGL が必要で jsdom では初期化できないためモジュール全体を
 * モックする（mobileLayout.test.jsx と同じ方式）。
 */
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return { default: mockState.api }
})

// 駅ファイルのフィクスチャ行（[名前, 緯度, 経度, 種別]。種別: 0=駅）
const STATION_ROWS = [
  ['梅田駅', 34.7, 135.5, 0],
  ['東京駅', 35.688, 139.766, 0],
]

let mediaListeners = []
let mediaMatches = true
function setupMatchMedia() {
  mediaListeners = []
  window.matchMedia = (query) => ({
    matches: mediaMatches,
    media: query,
    addEventListener: (type, cb) => {
      if (type === 'change') mediaListeners.push(cb)
    },
    removeEventListener: (type, cb) => {
      mediaListeners = mediaListeners.filter((l) => l !== cb)
    },
  })
}

// stationMode: 'ok'（既定・stations.json を返す）| 'fail-404'（取得失敗）
let stationMode = 'ok'
function setupFetchMock() {
  stationMode = 'ok'
  const mockFetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => ({ municipalities: [] }) }
    }
    if (u.includes('stations.json')) {
      if (stationMode === 'fail-404') {
        return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
      }
      return { ok: true, status: 200, headers: new Map(), json: async () => STATION_ROWS }
    }
    // Nominatim / Overpass 等: 空結果（このテストでは使わない）
    return { ok: true, status: 200, headers: new Map(), json: async () => [] }
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
}

function renderApp() {
  window.history.replaceState(null, '', '/')
  render(<App />)
}

const PLACE_INPUT = '地名・駅名（例: 大阪駅）'

function getSuggestOptions() {
  return screen.queryAllByRole('option').filter((o) => o.closest('[role="listbox"]'))
}

beforeEach(() => {
  mediaMatches = true
  setupMatchMedia()
  if (mockState.api) mockState.api.resetState()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  setupFetchMock()
  clearCache()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '')
})

describe('駅ファイルの読み込み失敗時は通信エラーとして示す', () => {
  it('読み込み失敗（404）で場所入力まわりにエラーが表示され、駅候補は出ない', async () => {
    stationMode = 'fail-404'
    renderApp()

    // 通信エラーが表示される（無言で空に落とさない）
    const alert = await screen.findByText(/駅データの読み込みに失敗しました/)
    expect(alert.getAttribute('role')).toBe('alert')

    // 駅名を入力しても駅候補は出ない（候補リスト自体が表示されない）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '梅田' } })
    expect(getSuggestOptions()).toHaveLength(0)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
