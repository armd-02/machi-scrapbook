// @vitest-environment jsdom
/**
 * (#62) バリアフリー凡例の配置テスト（地図本体の「下」に描画されること）
 *
 * 凡例は地図ブロック側（固定領域）に配置され、本文のスクロールで流れて
 * いかない。地図コンテナ内（MapView の absolute 容器）のオーバーレイには
 * ならない（地図操作を妨げない）。
 * - PC幅（matches=false）とモバイル幅（matches=true）の両方で MobileSearchTab
 *   （従来フォーム view="form"・地図モード searchSource="map"）を描画し、
 *   凡例が地図ブロック（data-testid="map-block"）の内側であり、かつ
 *   地図コンテナ（MapView の absolute 容器の親 div）の外側・その後の
 *   ドキュメント順にあることを検証する。
 *   （旧PCレイアウトのSearchTabContentは廃止され、PCはモバイルと同じシェル
 *    を中央寄せmax-widthコンテナ内で表示するため、コンポーネントは共通。）
 * - 表示条件（barrier_free かつ結果1件以上）を満たさない場合は非表示。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { AppContext } from '../../context/AppContext'
import { createInitialState } from '../../state/appReducer'
import MobileSearchTab from '../mobile/MobileSearchTab'

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock({ autoLoad: false })
  return mockState.api
})

class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }

// バリアフリー結果1件（way / 点字ブロックあり）
const BF_RESULT = {
  id: 1, type: 'way',
  tags: { highway: 'footway', tactile_paving: 'yes' },
  lat: 34.6705, lon: 135.4805, name: null, osmId: 'way/1',
  bf: { kind: 'way', tactile: 'yes', lengthM: 120, kerb: null, hasSound: false, hasVibration: false,
    geometry: [[135.48, 34.67], [135.481, 34.6705], [135.482, 34.671]] }
}

const makeBfState = (over = {}) => ({
  ...createInitialState(),
  searchSource: 'map',
  resultKind: 'barrier_free',
  results: [BF_RESULT],
  ...over
})

// matchMediaスタブ（幅の切替を制御）
function setMatchMedia(matches) {
  window.matchMedia = () => ({
    matches,
    media: '(max-width: 1023.98px)',
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

// 凡例のルート要素（「凡例」テキストを含む div）
const legendRootOf = (view) => {
  const el = view.queryByText('凡例')
  return el ? el.closest('div') : null
}

// 地図コンテナを特定する（MapView の absolute 容器（.absolute.inset-0）の親 div）
const mapContainerOf = (view) => {
  const mapRoot = view.container.querySelector('.absolute.inset-0')
  return mapRoot ? mapRoot.parentElement : null
}

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver || MockResizeObserver
  if (mockState.api) mockState.api.resetState()
  // municipalities.json等のフェッチは空データで応答
  // 自治体モードの再レンダでMunicipalitySearchがmunicipalities.jsonをfetchする。
  // 空配列の妥当なpayloadを返すことで、data.municipalities未定義によるクラッシュを避ける。
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes('municipalities.json')) {
      return { ok: true, json: async () => ({ count: 0, source: 'test-fixture', municipalities: [] }) }
    }
    return { ok: true, json: async () => ({}) }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderInContext = (view, state) =>
  render(
    <AppContext.Provider value={{ state, dispatch: vi.fn() }}>
      {view}
    </AppContext.Provider>
  )

const legendPlacementTests = (label) => {
  it(`凡例は地図ブロックの内側・地図コンテナの外側・その後のドキュメント順にある（${label}）`, () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      makeBfState()
    )

    const mapContainer = mapContainerOf(view)
    expect(mapContainer).toBeTruthy()
    const legendRoot = legendRootOf(view)
    expect(legendRoot).toBeTruthy()

    // 地図ブロック（固定領域）の内側にある（本文のスクロールで流れていかない）
    expect(legendRoot.closest('[data-testid="map-block"]')).toBeTruthy()
    // 地図コンテナ内のオーバーレイになっていない（パン・ズーム操作にも影響しない）
    expect(mapContainer.contains(legendRoot)).toBe(false)
    // 地図コンテナの「後」に描画されている
    expect(mapContainer.compareDocumentPosition(legendRoot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 地図本体の高さは固定（凡例の表示・非表示で地図の高さが変わらない）
    expect(mapContainer.className).toMatch(/h-\[240px\]/)
  })

  it(`POI検索の結果では凡例を表示しない（${label}）`, () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      makeBfState({ resultKind: 'poi' })
    )
    expect(legendRootOf(view)).toBeNull()
  })

  it(`バリアフリー検索でも結果が0件なら凡例を表示しない（${label}）`, () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      makeBfState({ results: [] })
    )
    expect(legendRootOf(view)).toBeNull()
  })

  it(`凡例の表示・非表示の切替で地図コンテナに影響しない（高さ・クラス不変）（${label}）`, () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      makeBfState()
    )
    const mapContainer = mapContainerOf(view)
    const before = mapContainer.className
    expect(view.queryByText('凡例')).toBeTruthy()

    // バリアフリー → POI に切替（凡例が非表示になる）
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: makeBfState({ resultKind: 'poi' }), dispatch: vi.fn() }}>
          <MobileSearchTab view="form" onViewResults={vi.fn()} />
        </AppContext.Provider>
      )
    })
    expect(view.queryByText('凡例')).toBeNull()

    // 地図コンテナは変化していない（地図の高さ・操作に影響しない）
    expect(mapContainer.className).toBe(before)
    expect(mapContainer.className).toMatch(/h-\[240px\]/)
  })
}

describe('PC幅（>=1024px・matches=false）: MobileSearchTab・地図モード', () => {
  beforeEach(() => setMatchMedia(false))
  legendPlacementTests('PC')
})

describe('モバイル幅（<1024px・matches=true）: MobileSearchTab・地図モード', () => {
  beforeEach(() => setMatchMedia(true))
  legendPlacementTests('モバイル')
})
