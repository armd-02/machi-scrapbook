// @vitest-environment jsdom
/**
 * (#xx) 地名検索欄の「現在地付近」ボタン E2E テスト
 *
 * トップ画面の地名検索欄（QuickTopIntro「どこで探すか」セクション）には、
 * 「地名検索」ボタンの隣にアイコンのみ（🎯 ターゲット風・テキストラベルなし）
 * の「現在地付近」ボタンがある。aria-label / title は「現在地付近」。
 *
 * 押下時の挙動:
 * - 既存の現在位置取得機構（nearby.awaitPosition — サジェストや geocode の
 *   viewbox 付けと同一の Promise 共有・タイムアウト保証・再試行挙動）で
 *   現在位置を取得し、その位置を確定した場所として設定する（表示名
 *   「現在地付近」）。以前に確定した場所があれば上書きする。
 * - 検索範囲は当該点中心の1.5km角（searchAreaFromGeocode の既存ルール）。
 *   bbox は source: 'geocode' を持ち「確定した場所」として扱われる
 *   （resolveSearchBbox の確定優先・MapView fitBounds・AreaCard 表示）
 * - 施設検索は実行しない（「指定した場所と種別で検索」押下時まで待たせる）
 * - 位置情報が取得できない・拒否された場合は入力欄の下にエラーを提示
 *   （role="alert"）し、入力欄は緑にならない
 * - 現在位置取得中はボタンが無効化され、ボタン内にスピナーが表示される
 * - 「現在地付近」は地名履歴（placeHistory）に記録されない
 *
 * MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体を
 * モックする（mobileLayout.test.jsx と同じ方式）。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import App from '../../../App'
import { clearCache } from '../../../utils/overpass'
import { squareBboxAround } from '../../../utils/geo'

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

// ===== テスト用データ =====
// municipalities.json のフィクスチャ（トップ表示時の読み込み用。最小1件）
const MUNI_DATA = {
  municipalities: [
    { code: '271000', prefCode: '27', prefecture: '大阪府', name: '吹田市', adminLevel: 7, bbox: { south: 34.7, west: 135.4, north: 34.8, east: 135.6 }, displayName: '吹田市' },
  ]
}

// Geolocation API のモック（jsdom には実装が無い）。現在位置は固定値
// （34.7, 135.5）。geoMode: 'ok'（既定・即返す）| 'fail'（拒否）|
// 'deferred'（テストが geoOkCb を呼ぶまで未解決。位置取得進行中の再現）
const CURRENT_POS = { lat: 34.7, lon: 135.5 }

// ===== フック =====
let mediaMatches = true
let mediaListeners = []
let overpassCalls = []
let geoMode = 'ok'
let geoOkCb = null

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

function setupGeolocationMock() {
  geoMode = 'ok'
  geoOkCb = null
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok, err) => {
        if (geoMode === 'fail') {
          setTimeout(() => err(new Error('denied')), 0)
        } else if (geoMode === 'deferred') {
          geoOkCb = ok
        } else {
          setTimeout(() => ok({ coords: { latitude: CURRENT_POS.lat, longitude: CURRENT_POS.lon } }), 0)
        }
      },
      watchPosition: () => 0,
      clearWatch: () => {},
    },
  })
}

function setupFetchMock() {
  const mockFetch = vi.fn(async (url, options = {}) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => MUNI_DATA }
    }
    if (u.includes('stations.json')) {
      // 駅候補は本テストの対象外。空配列を返す（読み込み失敗のエラーを避ける）
      return { ok: true, status: 200, headers: new Map(), json: async () => [] }
    }
    if (u.includes('nominatim')) {
      // 本テストでは Nominatim への問い合わせは期待されない（空でよい）
      return { ok: true, status: 200, headers: new Map(), json: async () => [] }
    }
    if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
      const body = options.body || ''
      const q = new URLSearchParams(body).get('data') || body
      overpassCalls.push(q)
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: [] }),
      }
    }
    return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
}

function renderApp() {
  window.history.replaceState(null, '', '/')
  render(<App />)
}

// ===== 操作ヘルパー =====

const PLACE_INPUT = '地名・駅名（例: 大阪駅）'

function getPlaceInput() {
  return within(screen.getByRole('region', { name: 'どこで探すか' })).getByPlaceholderText(PLACE_INPUT)
}

function getCurrentLocationButton() {
  return screen.getByRole('button', { name: '現在地付近' })
}

// タイル下の「指定した場所と種別で検索」ボタン（「目的から探す」セクション内に
// スコープ: 下部ナビの「検索」タブや「都道府県から探す」セクションのボタンと区別する）
function getTopSearchButton() {
  return within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '指定した場所と種別で検索' })
}

// role=alert の要素のテキストから条件に合うものを探す（jest-dom不使用のため）
function findAlertText(pattern) {
  return screen.queryAllByRole('alert').some(
    (el) => el.textContent && pattern.test(el.textContent)
  )
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
  overpassCalls = []
  setupGeolocationMock()
  setupFetchMock()
  clearCache()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

const IT_TIMEOUT = 15000

describe('(#xx) 地名検索欄の「現在地付近」ボタン', () => {
  it('「地名検索」ボタンの隣にアイコンのみ（テキストラベルなし）のボタンが表示される', async () => {
    renderApp()
    const btn = getCurrentLocationButton()

    // アイコンのみ: 内容はターゲットアイコンそのもので、テキストラベルが無い
    expect(btn.textContent).toBe('🎯')
    expect(btn.title).toBe('現在地付近')
    expect(btn.getAttribute('aria-label')).toBe('現在地付近')

    // 「地名検索」と同一行（PlaceNameInput の入力行）に配置される
    const geocodeBtn = within(screen.getByRole('region', { name: 'どこで探すか' }))
      .getByRole('button', { name: '地名検索' })
    expect(geocodeBtn.parentElement).toBe(btn.parentElement)
  }, IT_TIMEOUT)

  it('押下で現在位置が確定した場所になる（緑＋「現在地付近（座標）」＋当該点中心の1.5km角bbox）', async () => {
    renderApp()
    fireEvent.click(getCurrentLocationButton())

    // エリア確定: 入力欄が緑＋「現在地付近（座標）」が入る
    await waitFor(() => {
      expect(getPlaceInput().className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(getPlaceInput().value).toBe('現在地付近（34.70000, 135.50000）')

    // 施設検索はまだ実行されていない（「指定した場所と種別で検索」時まで待つ）
    expect(overpassCalls).toHaveLength(0)

    // 「指定した場所と種別で検索」→ 現在位置中心の1.5km角の範囲で検索される
    const bbox = squareBboxAround(CURRENT_POS, 1.5)
    const bboxStr = [bbox.south, bbox.west, bbox.north, bbox.east].map((n) => n.toFixed(6)).join(',')
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain(bboxStr)
  }, IT_TIMEOUT)

  it('「現在地付近」は地名履歴（placeHistory）に記録されない', async () => {
    renderApp()
    fireEvent.click(getCurrentLocationButton())
    await waitFor(() => {
      expect(getPlaceInput().className).toContain('border-green-500')
    }, { timeout: 8000 })

    // 履歴のストレージに「現在地付近」が含まれない（範囲は押下時点に依存するため）
    const stored = localStorage.getItem('machi-place-history-v1')
    expect(stored ? stored.includes('現在地付近') : false).toBe(false)
  }, IT_TIMEOUT)

  it('位置情報が取得できない場合: エラーを提示し、入力欄は緑にならない', async () => {
    geoMode = 'fail'
    renderApp()
    fireEvent.click(getCurrentLocationButton())

    // 入力欄の下にエラー（role="alert"）
    await waitFor(() => {
      expect(findAlertText(/現在位置を取得できませんでした/)).toBe(true)
    }, { timeout: 8000 })
    expect(getPlaceInput().className).not.toContain('border-green-500')
    // 施設検索も実行されていない
    expect(overpassCalls).toHaveLength(0)
  }, IT_TIMEOUT)

  it('現在位置取得中はボタンが無効化されスピナーが表示され、取得完了でエリアが確定する', async () => {
    geoMode = 'deferred'
    renderApp()
    fireEvent.click(getCurrentLocationButton())
    const btn = getCurrentLocationButton()

    // 取得中: ボタンが無効化＋ボタン内にスピナー
    await waitFor(() => expect(btn.disabled).toBe(true), { timeout: 8000 })
    expect(btn.querySelector('.animate-spin')).toBeTruthy()

    // 位置が確定するとエリアが設定される
    await act(async () => {
      geoOkCb({ coords: { latitude: CURRENT_POS.lat, longitude: CURRENT_POS.lon } })
    })
    await waitFor(() => {
      expect(getPlaceInput().className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(getPlaceInput().value).toBe('現在地付近（34.70000, 135.50000）')
    expect(btn.disabled).toBe(false)
  }, IT_TIMEOUT)
})
