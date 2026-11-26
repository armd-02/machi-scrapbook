// @vitest-environment jsdom
/**
 * (top) モバイル「検索」タブ 一般向けトップ表示: 「都道府県から探す」折りたたみセクション テスト
 *
 * 場所入力（QuickTopIntro）のすぐ下・地図（mapBlock）の上に配置された新しいセクションの検証:
 * - 既定で閉じた状態: 見出しボタンのみ表示され、MunicipalitySearch と「検索する」は描画されない
 * - 見出しタップで開き MunicipalitySearch（モバイル変種: 都道府県→市区町村→任意でカテゴリ）が
 *   表示され、再度タップで閉じる
 * - 開いたセクションで市区町村を選択し「検索する」を押すと、自治体モードの検索が実行される
 *   （#47 パターン: 状態スナップショット → buildSearchCriteria → search()）。
 *   クエリに市区町村のBBOXが含まれ、成功時に一覧タブへ自動切替（既存の挙動）
 *
 * MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする
 * （mobileLayout.test.jsx と同じパターン。vi.mockファクトリはファイル先頭にホイスされる
 * ため、共通モックは動的importで参照する）。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import App from '../../../App'
import { clearCache } from '../../../utils/overpass'

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

// ===== テスト用データ（mobileLayout.test.jsx と同じfixture） =====
const MUNI_DATA = {
  municipalities: [
    { code: '271000', prefCode: '27', prefecture: '大阪府', name: '東大阪市', adminLevel: 8, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 } },
    { code: '27109', prefCode: '27', prefecture: '大阪府', name: '大阪市', adminLevel: 7, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 }, displayName: '大阪市（都府県）' },
    { code: '27102', prefCode: '27', prefecture: '大阪府', name: '大阪市北区', adminLevel: 8, bbox: { south: 34.78051, west: 135.47011, north: 34.79045, east: 135.50012 } },
    { code: '27103', prefCode: '27', prefecture: '大阪府', name: '大阪市中央区', adminLevel: 8, bbox: { south: 34.66000, west: 135.47000, north: 34.69000, east: 135.50000 } },
  ]
}

const OVERPASS_ELEMENTS = [
  { type: 'node', id: 1001, lat: 34.695, lon: 135.495, tags: { name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee' } },
  { type: 'node', id: 1002, lat: 34.7, lon: 135.5, tags: { name: 'ラーメン屋テスト', amenity: 'restaurant', cuisine: 'ramen' } },
  { type: 'way', id: 2001, center: { lat: 34.705, lon: 135.505 }, tags: { name: 'テスト書店', shop: 'books' } },
]

// ===== フック =====
let overpassCalls = []

beforeEach(() => {
  // モバイルビューポート（幅 < 1024px）として固定
  window.matchMedia = (query) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  if (mockState.api) mockState.api.resetState()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  overpassCalls = []

  const mockFetch = vi.fn(async (url, options = {}) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, status: 200, headers: new Map(), json: async () => MUNI_DATA }
    }
    if (u.includes('interpreter') || u.includes('sakura') || u.includes('overpass')) {
      const body = options.body || ''
      const q = new URLSearchParams(body).get('data') || body
      overpassCalls.push(q)
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ version: 0.6, generator: 'Overpass API', osm3s: {}, elements: OVERPASS_ELEMENTS }),
      }
    }
    return { ok: false, status: 404, headers: new Map(), json: async () => ({}) }
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
  clearCache()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

function renderApp() {
  window.history.replaceState(null, '', '/')
  return render(<App />)
}

// 「都道府県から探す」セクション（<section aria-label="都道府県から探す">）
function getSection() {
  return screen.getByRole('region', { name: '都道府県から探す' })
}

// 見出しトグルボタン（「都道府県から探す ▾ 開く」 / 「都道府県から探す ▴ 閉じる」）
function getHeading(section) {
  return within(section).getByRole('button', { name: /都道府県から探す/ })
}

// 下部ナビのタブボタン群
function navButtons() {
  return within(screen.getByRole('navigation', { name: 'モバイルナビゲーション' }))
}

const IT_TIMEOUT = 15000

describe('(top) 「都道府県から探す」折りたたみセクション（モバイル検索タブトップ表示）', () => {
  it('並び順: 説明・場所入力 → 「都道府県から探す」セクション → 地図 → 目的タイル', () => {
    const { container } = renderApp()

    // a が b より文書順で先である（DOCUMENT_POSITION_FOLLOWING ビット）
    const precedes = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

    const placeSec = screen.getByRole('region', { name: 'どこで探すか' })
    const muniSec = getSection()
    // 地図ブロック: 高さドラッグハンドル（モバイルトップ画面で唯一の h-7・bg-slate-100・border-t 組み合わせ）の親要素
    const handle = container.querySelector('div[class*="h-7"][class*="bg-slate-100"][class*="border-t"]')
    expect(handle).toBeTruthy()
    const mapBlock = handle.parentElement
    const tilesSec = screen.getByRole('region', { name: '目的から探す' })

    expect(precedes(placeSec, muniSec)).toBe(true) // 場所入力 → 都道府県セクション
    expect(precedes(muniSec, mapBlock)).toBe(true) // 都道府県セクション → 地図
    expect(precedes(mapBlock, tilesSec)).toBe(true) // 地図 → 目的タイル
    // (ピースN) 共有ボタンは検索タブには置かれない（一覧タブの件数行へ移動）
    expect(screen.queryByRole('button', { name: /検索を共有/ })).toBeNull()
  })


  it('サジェストクリップ回避: セクションに overflow-hidden が無く、地図（mapBlock）より上側の重なり順を持つ', () => {
    renderApp()

    const section = getSection()

    // overflow-hidden が付くと、position:absolute な市区町村サジェスト一覧が
    // セクション下端で切れて地図の後ろに隠れる（実機で確認済みの不具合）。付いていないことを確認する
    expect(section.classList.contains('overflow-hidden')).toBe(false)

    // 地図との重なり順で負けないため、セクションは位置付け＋z-index を持つ
    // （mapBlock 側は position/z-index を持たない static・z-auto であることと合わせ、
    // 正の z-index が地図より上側を意味する）
    expect(section.className).toMatch(/(^|\s)relative(\s|$)/)
    expect(section.className).toMatch(/(^|\s)z-\d+(\s|$)/)

    // 見た目の角丸・影は維持される
    expect(section.classList.contains('rounded-xl')).toBe(true)
    expect(section.classList.contains('shadow-sm')).toBe(true)
  })

  it('既定で閉じた状態: 見出しボタンのみ表示され、MunicipalitySearch の要素と「検索する」は描画されない', () => {
    renderApp()

    const section = getSection()
    const heading = getHeading(section)
    expect(heading.getAttribute('aria-expanded')).toBe('false')

    // セクション本体（MunicipalitySearch＋「検索する」）は描画されない
    expect(within(section).queryByText('どの県で探す？')).toBeNull()
    expect(within(section).queryByRole('button', { name: '検索する' })).toBeNull()

    // 既存のトップ表示の要素は影響を受けていない
    expect(screen.getByRole('region', { name: 'どこで探すか' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '食べる' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()

    // (#xx) 検索ソース切替タブ（「地図から探す」/「自治体から探す」）は撤去済み。
    // トップ画面にもフォームにも描画されない
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '地図から探す' })).toBeNull()
  })

  it('見出しタップで開く: 都道府県グリッド・市区町村入力・「検索する」が表示され、再度タップで閉じる', async () => {
    renderApp()

    const section = getSection()
    const heading = getHeading(section)

    // 開く
    fireEvent.click(heading)
    expect(heading.getAttribute('aria-expanded')).toBe('true')
    // MunicipalitySearch（モバイル変種）が描画される
    // （自治体データのfetchはモックだが非同期。読み込み完了を待ってから検証する）
    await waitFor(() => {
      expect(within(section).getByText('どの県で探す？')).toBeTruthy()
    }, { timeout: 3000 })
    // 都道府県タイルグリッド（fixtureから大阪府）
    expect(within(section).getByRole('button', { name: '大阪府' })).toBeTruthy()
    // 「検索する」ボタンは表示されるが無効（市区町村未選択）
    const searchBtn = within(section).getByRole('button', { name: '検索する' })
    expect(searchBtn.hasAttribute('disabled')).toBe(true)

    // 閉じる
    fireEvent.click(heading)
    expect(heading.getAttribute('aria-expanded')).toBe('false')
    expect(within(section).queryByText('どの県で探す？')).toBeNull()
    expect(within(section).queryByRole('button', { name: '検索する' })).toBeNull()
  })

  it('開いたセクションで市区町村選択→「検索する」: 自治体BBOXのPOIクエリが送出され、成功で一覧タブへ自動切替', async () => {
    renderApp()

    // セクションを開く
    const section = getSection()
    fireEvent.click(getHeading(section))

    // 都道府県選択（sr-only select フォールバック。既存テストと同一パターン）
    const prefSelect = await waitFor(() => {
      const sel = within(section).getByLabelText('どの県で探す？')
      expect(sel).toBeTruthy()
      return sel
    }, { timeout: 3000 })
    const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === '大阪府')
    expect(prefOpt).toBeTruthy()
    fireEvent.change(prefSelect, { target: { value: prefOpt.value } })

    // 市区町村入力→候補クリック（大阪市・都府県レベル）
    const munInput = await waitFor(() => {
      const i = within(section).getByLabelText('どの市区町村で探す？')
      expect(i).toBeTruthy()
      return i
    }, { timeout: 3000 })
    fireEvent.change(munInput, { target: { value: '大阪市' } })
    const munOpt = await waitFor(() => {
      const lb = within(section).getByRole('listbox')
      const opt = within(lb).getByRole('option', { name: '大阪市（都府県）' })
      return opt
    }, { timeout: 3000 })
    fireEvent.click(munOpt)

    // 市区町村選択で「検索する」が有効化される
    const searchBtn = within(section).getByRole('button', { name: '検索する' })
    await waitFor(() => {
      expect(searchBtn.hasAttribute('disabled')).toBe(false)
    }, { timeout: 3000 })
    fireEvent.click(searchBtn)

    // Overpassクエリに自治体BBOXが含まれる（カテゴリ未選択=POIタグ制約クエリ）
    await waitFor(() => {
      expect(overpassCalls).toHaveLength(1)
    }, { timeout: 8000 })
    const q = overpassCalls[0]
    expect(q).toContain('34.560000,135.340000,34.720000,135.520000')
    expect(q).toContain('amenity')
    expect(q).toContain('shop')

    // 検索成功で一覧タブへ自動切替され、結果が表示される（既存の挙動）
    await waitFor(() => {
      expect(navButtons().getByRole('button', { name: '一覧' }).getAttribute('aria-current')).toBe('page')
    }, { timeout: 8000 })
    await waitFor(() => {
      expect(screen.getByText('3件の結果を取得しました')).toBeTruthy()
    }, { timeout: 8000 })
  }, IT_TIMEOUT)
})
