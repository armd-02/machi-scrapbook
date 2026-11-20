// @vitest-environment jsdom
/**
 * 回帰テスト: 一般向けトップで「食べる」などの目的タイルを選んでから
 * 「都道府県から探す」で自治体を選ぶと、タイル下の「指定した場所と種別で検索」では
 * 種別が効くのに、セクション内の「検索する」では種別が引き継がれず全件検索に
 * なっていた（ユーザー報告 2026-11-16）。
 *
 * 修正: 自治体選択時／タイルタップ時に、タイルの種別を自治体モードの
 * 検索条件（municipalitySearch）へ引き継ぐ。順序が逆（自治体→タイル）
 * でもセクション内検索に種別が効くことを含め、3ケースを検証する。
 *
 * MapLibre GL は jsdom で初期化できないためモジュール全体をモックする
 * （MobileSearchTabMunicipality.test.jsx と同じ方式・fixture）。
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
  return { default: mockState.api }
})

const MUNI_DATA = {
  municipalities: [
    { code: '271000', prefCode: '27', prefecture: '大阪府', name: '東大阪市', adminLevel: 8, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 } },
    { code: '27109', prefCode: '27', prefecture: '大阪府', name: '大阪市', adminLevel: 7, bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 }, displayName: '大阪市（都府県）' },
    { code: '27102', prefCode: '27', prefecture: '大阪府', name: '大阪市北区', adminLevel: 8, bbox: { south: 34.78051, west: 135.47011, north: 34.79045, east: 135.50012 } },
  ]
}

const OVERPASS_ELEMENTS = [
  { type: 'node', id: 1001, lat: 34.65, lon: 135.5, tags: { name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee' } },
  { type: 'node', id: 1002, lat: 34.66, lon: 135.51, tags: { name: 'ラーメン屋テスト', amenity: 'restaurant', cuisine: 'ramen' } },
]

let overpassCalls = []

beforeEach(() => {
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

describe('再現: タイル選択 → 都道府県・市区町村選択', () => {
  it('食べるタイルの選択が自治体選択後も維持され、トップの検索で使われる', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)

    // 1. 先に「食べる」タイルを選ぶ（目的タイル側にスコープ: 自治体セクション内にも
    //    同名の目的ボタンがあるため）
    const tilesRegion = () => screen.getByRole('region', { name: '目的から探す' })
    const eatTile = within(tilesRegion()).getByRole('button', { name: /食べる/ })
    fireEvent.click(eatTile)
    expect(eatTile.getAttribute('aria-pressed')).toBe('true')

    // 2. 「都道府県から探す」を開く
    const section = screen.getByRole('region', { name: '都道府県から探す' })
    fireEvent.click(within(section).getByRole('button', { name: /都道府県から探す/ }))

    // 3. 都道府県=大阪府 を選択
    const prefSelect = await waitFor(() => within(section).getByLabelText('どの県で探す？'), { timeout: 3000 })
    const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === '大阪府')
    fireEvent.change(prefSelect, { target: { value: prefOpt.value } })

    // 4. 市区町村=大阪市 を選択
    const munInput = await waitFor(() => within(section).getByLabelText('どの市区町村で探す？'), { timeout: 3000 })
    fireEvent.change(munInput, { target: { value: '大阪市' } })
    const munOpt = await waitFor(() => {
      const lb = within(section).getByRole('listbox')
      return within(lb).getByRole('option', { name: '大阪市（都府県）' })
    }, { timeout: 3000 })
    fireEvent.click(munOpt)

    // 5. タイルの選択が維持されているか
    expect(within(tilesRegion()).getByRole('button', { name: /食べる/ }).getAttribute('aria-pressed')).toBe('true')

    // 6. タイル下の「指定した場所と種別で検索」で検索が実行される（種別エラーにならない）
    const topSearch = within(screen.getByRole('region', { name: '目的から探す' })).getByRole('button', { name: '指定した場所と種別で検索' })
    fireEvent.click(topSearch)
    await waitFor(() => {
      expect(overpassCalls.length).toBeGreaterThan(0)
    }, { timeout: 5000 })
    expect(screen.queryByText(/種別を選んでください/)).toBeNull()
    // 食べる（飲食）のクエリになっている
    expect(overpassCalls[0]).toMatch(/amenity/)
  }, 15000)

  it('セクション内の「検索する」でもタイルの種類が効くか', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    const tilesRegion = () => screen.getByRole('region', { name: '目的から探す' })
    fireEvent.click(within(tilesRegion()).getByRole('button', { name: /食べる/ }))
    const section = screen.getByRole('region', { name: '都道府県から探す' })
    fireEvent.click(within(section).getByRole('button', { name: /都道府県から探す/ }))
    const prefSelect = await waitFor(() => within(section).getByLabelText('どの県で探す？'), { timeout: 3000 })
    const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === '大阪府')
    fireEvent.change(prefSelect, { target: { value: prefOpt.value } })
    const munInput = await waitFor(() => within(section).getByLabelText('どの市区町村で探す？'), { timeout: 3000 })
    fireEvent.change(munInput, { target: { value: '大阪市' } })
    const munOpt = await waitFor(() => {
      const lb = within(section).getByRole('listbox')
      return within(lb).getByRole('option', { name: '大阪市（都府県）' })
    }, { timeout: 3000 })
    fireEvent.click(munOpt)
    const sectionSearch = within(section).getByRole('button', { name: '検索する' })
    fireEvent.click(sectionSearch)
    await waitFor(() => {
      expect(overpassCalls.length).toBeGreaterThan(0)
    }, { timeout: 5000 })
    // 食べる（飲食店系）に絞られているか: クエリに restaurant/cafe 等が含まれるはず
    expect(overpassCalls[0]).toMatch(/restaurant|cafe|fast_food/)
  }, 15000)

  it('自治体を選んでからタイルをタップしても、セクション内の「検索する」に種別が効く', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    const section = screen.getByRole('region', { name: '都道府県から探す' })
    fireEvent.click(within(section).getByRole('button', { name: /都道府県から探す/ }))
    const prefSelect = await waitFor(() => within(section).getByLabelText('どの県で探す？'), { timeout: 3000 })
    const prefOpt = [...prefSelect.querySelectorAll('option')].find((o) => o.textContent === '大阪府')
    fireEvent.change(prefSelect, { target: { value: prefOpt.value } })
    const munInput = await waitFor(() => within(section).getByLabelText('どの市区町村で探す？'), { timeout: 3000 })
    fireEvent.change(munInput, { target: { value: '大阪市' } })
    const munOpt = await waitFor(() => {
      const lb = within(section).getByRole('listbox')
      return within(lb).getByRole('option', { name: '大阪市（都府県）' })
    }, { timeout: 3000 })
    fireEvent.click(munOpt)
    // 後からタイルを選ぶ
    const tilesRegion = () => screen.getByRole('region', { name: '目的から探す' })
    fireEvent.click(within(tilesRegion()).getByRole('button', { name: /食べる/ }))
    fireEvent.click(within(section).getByRole('button', { name: '検索する' }))
    await waitFor(() => {
      expect(overpassCalls.length).toBeGreaterThan(0)
    }, { timeout: 5000 })
    expect(overpassCalls[0]).toMatch(/restaurant|cafe|fast_food/)
  }, 15000)
})
