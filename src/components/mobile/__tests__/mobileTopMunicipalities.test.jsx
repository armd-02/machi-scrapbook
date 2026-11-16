// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import App from '../../../App'
import { clearCache } from '../../../utils/overpass'

/**
 * (#68) 一般向けトップの地名入力サジェストに自治体データを組み込んだ検証
 *
 * - 「宇治」と入力すると、自治体候補「宇治市（自治体・京都府）」が候補の先頭に
 *   出る（ローカル計算なので Nominatim の応答を待たず即座に表示。
 *   Nominatim 候補が届いたらその後に追加される）
 * - 候補を選ぶと自治体の bbox が検索エリアになる（既存の handleCandidateSelect
 *   の流れ: 入力欄が緑＋「検索エリアに「○○」を設定しました」。施設検索は実行されない）
 * - 「宇治市」で「検索する」と、自治体の完全一致で範囲が確定し、Nominatim を
 *   経由せずに自治体の範囲で施設検索が進む
 * - 同名自治体（伊達市×2）の完全一致が2件 → 自治体候補だけを複数候補として
 *   提示し、施設検索は実行されない（Nominatim も呼ばない）
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

// ===== テスト用データ =====
// 実際の public/data/municipalities.json と同じ形のfixture（宇治市・宇治田原町・
// 同名の伊達市×2）。宇治市のbboxは実データ値。
const MUNI_DATA = {
  municipalities: [
    { code: '262048', prefCode: '26', prefecture: '京都府', name: '宇治市', adminLevel: 7, bbox: { south: 34.85793, west: 135.75965, north: 34.95709, east: 135.87992 }, displayName: '宇治市' },
    { code: '263443', prefCode: '26', prefecture: '京都府', name: '宇治田原町', adminLevel: 7, bbox: { south: 34.81365, west: 135.82944, north: 34.89238, east: 135.94703 }, displayName: '宇治田原町' },
    { code: '012335', prefCode: '01', prefecture: '北海道', name: '伊達市', adminLevel: 7, bbox: { south: 42.32789, west: 140.5784, north: 42.82731, east: 141.19908 }, displayName: '伊達市' },
    { code: '072133', prefCode: '07', prefecture: '福島県', name: '伊達市', adminLevel: 7, bbox: { south: 37.68924, west: 140.48632, north: 37.91517, east: 140.73663 }, displayName: '伊達市' },
  ]
}

// 宇治市の bbox（34.85793–34.95709 / 135.75965–135.87992）の内側にある要素。
// 検索結果はクライアント側で検索bboxによりフィルタされるため、要素はエリア内に置く。
const OVERPASS_ELEMENTS_UJI = [
  { type: 'node', id: 5001, lat: 34.9, lon: 135.82, tags: { name: '宇治テスト珈琲店', amenity: 'cafe', cuisine: 'coffee' } },
  { type: 'node', id: 5002, lat: 34.88, lon: 135.8, tags: { name: '宇治ラーメン', amenity: 'restaurant', cuisine: 'ramen' } },
]

// Nominatim応答行。「宇治」のサジェスト検証で「宇治駅」（駅）を返す。
const UJI_STATION_ROW = {
  lat: '34.917400',
  lon: '135.842900',
  display_name: '宇治駅, 宇治市, 京都府, 日本',
  name: '宇治駅',
  class: 'railway',
  type: 'station',
  boundingbox: ['34.916400', '34.918400', '135.841900', '135.843900'],
  address: { state: '京都府', city: '宇治市' },
}

// ===== フック =====
let mediaMatches = true
let mediaListeners = []
let overpassCalls = []
let overpassElements = OVERPASS_ELEMENTS_UJI
let nominatimRows = [UJI_STATION_ROW]
// Nominatim応答の遅延（ms）。サジェストがNominatimを待たず自治体候補を
// 即座に出すことを検証するため、応答を遅らせてから同期で候補を確認できる
let nominatimDelayMs = 0
let nominatimCalls = 0

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

function setupFetchMock() {
  const mockFetch = vi.fn(async (url, options = {}) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => MUNI_DATA }
    }
    if (u.includes('nominatim')) {
      nominatimCalls += 1
      if (nominatimDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, nominatimDelayMs))
      }
      return { ok: true, status: 200, headers: new Map(), json: async () => nominatimRows }
    }
    if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
      const body = options.body || ''
      const q = new URLSearchParams(body).get('data') || body
      overpassCalls.push(q)
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: overpassElements }),
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

const IT_TIMEOUT = 15000

const PLACE_INPUT = '地名・駅名（例: 大阪駅）'

function navButtons() {
  return within(screen.getByRole('navigation', { name: 'モバイルナビゲーション' }))
}
function tabIsCurrent(label) {
  return navButtons().getByRole('button', { name: label }).getAttribute('aria-current') === 'page'
}

// タイル下の「検索する」ボタン（「目的から探す」セクション内にスコープ:
// 下部ナビの「検索」タブや「都道府県から探す」セクションの同名ボタンと区別する）
function getTopSearchButton() {
  return within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '検索する' })
}

// 自治体データ（loadMunicipalities）の読み込み完了を待つ。
// 入力の直前にデータが準備されていることを保証し、「入力→即候補」の
// 同期検証が安定するようにする。
async function waitForMuniDataLoaded() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
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
  overpassElements = OVERPASS_ELEMENTS_UJI
  nominatimRows = [UJI_STATION_ROW]
  nominatimDelayMs = 0
  nominatimCalls = 0
  setupFetchMock()
  clearCache()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('(#68) トップの地名入力サジェストに自治体候補を組み込む', () => {
  it('「宇治」と入力すると「宇治市（自治体・京都府）」が候補の先頭に即座に出る（Nominatimを待たない）。Nominatim候補が届いたらその後に追加される', async () => {
    // Nominatim応答を遅らせる（600ms）: 入力直後の候補がNominatim由来でない
    // こと（ローカル計算の自治体候補であること）を同期で確認できる
    nominatimDelayMs = 600
    renderApp()
    await waitForMuniDataLoaded()

    // 「宇治」と入力した直後（デバウンス・Nominatim応答を待たずに）
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '宇治' } })

    // 同期で候補リストが存在し、先頭が自治体候補「宇治市（自治体・京都府）」
    const lb = screen.getByRole('listbox')
    const opts = within(lb).getAllByRole('option')
    expect(opts).toHaveLength(2)
    expect(opts[0].textContent).toBe('宇治市（自治体・京都府）')
    expect(opts[1].textContent).toBe('宇治田原町（自治体・京都府）')
    // Nominatimはまだ応答していない（600ms遅延）
    expect(nominatimCalls).toBe(0)

    // Nominatim候補（デバウンス400ms＋応答600ms後）が届いたら、自治体候補の
    // 後ろに追加される
    await waitFor(() => {
      expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(3)
    }, { timeout: 8000 })
    const finalOpts = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(finalOpts.map((o) => o.textContent)).toEqual([
      '宇治市（自治体・京都府）',
      '宇治田原町（自治体・京都府）',
      '宇治駅（駅・京都府宇治市）',
    ])
  }, IT_TIMEOUT)

  it('サジェストで自治体候補を選ぶと、自治体のbboxが検索エリアになる（緑＋フィードバック、施設検索は実行されない）', async () => {
    renderApp()
    await waitForMuniDataLoaded()
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '宇治' } })

    // 候補の先頭（自治体候補）をタップ
    const opt = await waitFor(() => {
      const o = within(screen.getByRole('listbox')).queryByRole('option', { name: '宇治市（自治体・京都府）' })
      expect(o).toBeTruthy()
      return o
    }, { timeout: 8000 })
    fireEvent.click(opt)

    // エリア設定: 入力欄が緑＋成功フィードバック（既存の「地名が見つかった」流れと同じ）
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByText(/検索エリアに「宇治市」を設定しました/)).toBeTruthy()
    // リストは閉じる。施設検索はまだ実行されていない
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(overpassCalls).toHaveLength(0)
    expect(tabIsCurrent('一覧')).toBe(false)

    // タイル選択+「検索する」→ 自治体のbbox範囲で検索が実行される
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    // 宇治市のbbox（34.85793, 135.75965, 34.95709, 135.87992）がそのまま検索範囲になる
    expect(overpassCalls[0]).toContain('34.857930,135.759650,34.957090,135.879920')
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('2件の結果を取得しました')).toBeTruthy()
  }, IT_TIMEOUT)

  it('「宇治市」で「検索する」→ 自治体の完全一致で範囲が確定し、Nominatimを経由せずに自治体の範囲で施設検索が進む', async () => {
    renderApp()
    await waitForMuniDataLoaded()

    // タイル選択 → 地名入力 → 「検索する」（すべて同期: デバウンス前の操作で
    // 保留中のサジェストリクエストもキャンセルされる）
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '宇治市' } })
    fireEvent.click(getTopSearchButton())

    // エリアが自治体のbboxで確定（緑＋フィードバック）
    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACE_INPUT).className).toContain('border-green-500')
    }, { timeout: 8000 })
    expect(screen.getByText(/検索エリアに「宇治市」を設定しました/)).toBeTruthy()

    // 施設検索が自治体の範囲で実行された
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('34.857930,135.759650,34.957090,135.879920')
    expect(overpassCalls[0]).toContain('amenity=cafe')
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
    expect(screen.getByText('2件の結果を取得しました')).toBeTruthy()

    // Nominatim は一度も呼ばれていない
    expect(nominatimCalls).toBe(0)
  }, IT_TIMEOUT)

  it('同名自治体（伊達市×2）の「検索する」→ 自治体候補だけを複数候補として提示し、施設検索もNominatimも実行されない', async () => {
    // 完全一致が2件以上: Nominatim候補は混ざらず、自治体候補だけが表示される
    nominatimRows = [UJI_STATION_ROW]
    renderApp()
    await waitForMuniDataLoaded()

    // 「伊達市」と入力した直後（同期で）完全一致の2件が候補として出る
    fireEvent.change(screen.getByPlaceholderText(PLACE_INPUT), { target: { value: '伊達市' } })
    let opts = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(opts.map((o) => o.textContent)).toEqual([
      '伊達市（自治体・北海道）',
      '伊達市（自治体・福島県）',
    ])

    // 「検索する」: 1件目を勝手に選ばず、自治体候補だけを複数候補として提示。
    // 施設検索は実行されない
    fireEvent.click(getTopSearchButton())
    expect(screen.getByText(/候補が複数あります/)).toBeTruthy()
    opts = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(opts.map((o) => o.textContent)).toEqual([
      '伊達市（自治体・北海道）',
      '伊達市（自治体・福島県）',
    ])
    expect(overpassCalls).toHaveLength(0)
    expect(nominatimCalls).toBe(0)
    expect(tabIsCurrent('検索')).toBe(true)

    // 北海道側の候補を選ぶ → その自治体のbboxが検索エリアになる
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '伊達市（自治体・北海道）' }))
    await waitFor(() => {
      expect(screen.getByText(/検索エリアに「伊達市」を設定しました/)).toBeTruthy()
    }, { timeout: 8000 })
    expect(overpassCalls).toHaveLength(0)

    // タイル選択+「検索する」→ 選んだ自治体（北海道伊達市）の範囲で検索される
    fireEvent.click(screen.getByRole('button', { name: '食べる' }))
    fireEvent.click(getTopSearchButton())
    await waitFor(() => expect(overpassCalls).toHaveLength(1), { timeout: 8000 })
    expect(overpassCalls[0]).toContain('42.327890,140.578400,42.827310,141.199080')
    await waitFor(() => expect(tabIsCurrent('一覧')).toBe(true), { timeout: 8000 })
  }, IT_TIMEOUT)
})
