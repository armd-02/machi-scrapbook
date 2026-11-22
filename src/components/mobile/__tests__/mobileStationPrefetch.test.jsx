// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../../../App'
import { clearCache } from '../../../utils/overpass'

/**
 * 全国駅ファイル（stations.json）の読み込みタイミングの検証
 *
 * 前提（2026-11-22 検討）: 駅ファイルは自治体データ（municipalities.json）と同じく、
 * サイト（トップ）表示時に1回だけ読み込む。地名入力欄のフォーカス時に読み込む
 * 旧方式は廃止（フォーカス時の再変換・状態書き換えの無駄を避ける）。
 *
 * - 駅ファイルの読み込みはトップ表示時に開始される（入力欄のフォーカスなしで
 *   fetch が出る）
 * - 駅候補は入力だけで取得できる（フォーカス不要）。トップ表示時点でデータが
 *   準備済みであることの確認
 *
 * 失敗経路（通信エラーの表示）は mobileStationLoadError.test.jsx で検証する。
 * 別ファイルにするのは stationCandidates にモジュールレベルのキャッシュ
 * （cachePromise）があり、同一ファイル内で先行テストの fetch 結果が再利用
 * されて失敗経路を検証できなくなるため。
 *
 * MapLibre GL は WebGL が必要で jsdom では初期化できないためモジュール全体を
 * モックする（mobileLayout.test.jsx と同じ方式）。
 */
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
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

// stations.json の fetch が発行されたURLを記録する
let stationsFetchUrls = []
function setupFetchMock() {
  stationsFetchUrls = []
  const mockFetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => ({ municipalities: [] }) }
    }
    if (u.includes('stations.json')) {
      stationsFetchUrls.push(u)
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

describe('駅ファイルはトップ表示時に読み込まれる', () => {
  it('トップ表示時点で駅ファイルの読み込みが開始される（入力欄のフォーカスなしで fetch が出る）', async () => {
    renderApp()

    // 入力欄はフォーカスされていない
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText(PLACE_INPUT))

    // トップ表示（マウント）時点で stations.json の fetch が発行される
    await waitFor(() => {
      expect(stationsFetchUrls).toHaveLength(1)
    })
    expect(stationsFetchUrls[0]).toContain('data/stations.json')
  })

  it('駅候補は入力だけで取得できる（フォーカス不要）。トップ表示時点でデータが準備済み', async () => {
    renderApp()

    // フォーカスせずに入力する
    const input = screen.getByPlaceholderText(PLACE_INPUT)
    expect(document.activeElement).not.toBe(input)
    fireEvent.change(input, { target: { value: '梅田' } })

    // 駅ファイル由来の候補が出る（フォーカスなし・周辺 Overpass 取得なし）。
    // 入力時点で駅ファイルがまだ反映されていなくても、反映後にサジェストが
    // 再導出されるため候補が出る（waitFor で待機）
    await waitFor(() => {
      const opts = getSuggestOptions()
      expect(opts).toHaveLength(1)
      expect(opts[0].textContent).toContain('梅田駅')
    })
  })
})
