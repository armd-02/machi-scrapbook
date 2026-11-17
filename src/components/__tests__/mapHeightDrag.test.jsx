// @vitest-environment jsdom
/**
 * 地図高さドラッグハンドル（useDraggableHeight）の統合テスト
 *
 * 旧PC専用レイアウト（SearchTabContent）は廃止され、PCはモバイルと同じシェル
 * （MobileShell / MobileSearchTab）を中央寄せmax-widthコンテナ内で表示する。
 * 地図の描画・高さドラッグはモバイル・PC共通の MobileSearchTab 内の実装になる。
 *
 * - PC幅（matchMedia matches=false）とモバイル幅（matches=true）の両方で
 *   MobileSearchTab（地図モード）を描画し、共通の挙動を検証する:
 *   - ハンドル（role=separator）は地図コンテナの直後に描画され、
 *     地図コンテナは既定の高さクラス（h-[240px]）のまま
 *   - ハンドルをドラッグすると、地図コンテナの高さがインラインstyleで
 *     上書きされる（既定クラスは維持）
 *   - 初期状態からコンテナのインラインstyleに明示的なpx（既定高さ240px）が入る
 *     （既定クラス h-[240px] とdefaultHeightが一致しているため初期表示は不変）
 * - 地図の表示/非表示は view・searchSource で制御される（モバイルと同一タイミング）:
 *   トップ表示では非表示、フォーム＋地図モードのみ表示、自治体モードでは非表示
 *   （いずれもマウントは維持され、hidden 属性で切替）
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { AppContext } from '../../context/AppContext'
import { createInitialState } from '../../state/appReducer'
import MobileSearchTab from '../mobile/MobileSearchTab'

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock({ autoLoad: false })
  return { default: mockState.api }
})

class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }

// このファイルは地図高さドラッグのテストなので、searchSource を 'map' に固定する
const mapState = () => ({ ...createInitialState(), searchSource: 'map' })

// matchMediaスタブ（幅の切替を制御）
function setMatchMedia(matches) {
  window.matchMedia = () => ({
    matches,
    media: '(max-width: 1023.98px)',
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver || MockResizeObserver
  setMatchMedia(false)
  if (mockState.api) mockState.api.resetState()
  // 自治体モードの再レンダでMunicipalitySearchがmunicipalities.jsonをfetchする。
  // 空配列の妥当なpayloadを返すことで、data.municipalities未定義によるクラッシュを避ける。
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes('municipalities.json')) {
      return { ok: true, json: async () => ({ count: 0, source: 'test-fixture', municipalities: [] }) }
    }
    return { ok: true, json: async () => ({}) }
  })
  // ドラッグで高さの保存（localStorage）が起きるため、テスト間で隔離する
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

const renderInContext = (view, state) =>
  render(
    <AppContext.Provider value={{ state, dispatch: vi.fn() }}>
      {view}
    </AppContext.Provider>
  )

// 地図コンテナを特定する（MapViewのabsolute容器の親div＝高さクラスを持つコンテナ）
const mapContainerOf = (view) => {
  const mapRoot = view.container.querySelector('.absolute.inset-0')
  return mapRoot ? mapRoot.parentElement : null
}

// 地図ブロック（hidden 属性で表示切替される外側コンテナ）
const mapBlockOf = (view) => view.container.querySelector('[data-testid="map-block"]')

describe('PC幅（>=1024px・matches=false）: 共通コンポーネントの地図高さドラッグ', () => {
  it('地図コンテナの直後にドラッグハンドルが描画され、既定の高さクラスは維持される', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState()
    )
    const mapContainer = mapContainerOf(view)
    expect(mapContainer).toBeTruthy()
    expect(mapContainer.className).toMatch(/h-\[240px\]/)

    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')
    expect(handle).toBeTruthy()
    // 地図コンテナの直後の兄弟要素
    expect(handle.previousElementSibling).toBe(mapContainer)
  })

  it('ハンドル当たり判定の高さは28px以上（h-7）。中央のつかみ線は細いままでよい', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState()
    )
    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')
    expect(handle.className).toContain('h-7') // 当たり判定 28px 以上
    // 中央のつかみ線（グリップバー）は細いままでよい（h-1）
    expect(handle.firstElementChild.className).toContain('h-1')
  })

  it('ハンドルをドラッグすると地図コンテナの高さがインラインstyleで上書きされる', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState()
    )
    const mapContainer = mapContainerOf(view)
    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')
    // 初期状態から明示的なpx（既定240px）が入る
    expect(mapContainer.style.height).toBe('240px')

    act(() => {
      fireEvent.pointerDown(handle, { clientY: 300 })
      fireEvent.pointerMove(handle, { clientY: 400 }) // 100px下（ハンドル＝地図下端なので増大）
      fireEvent.pointerUp(handle)
    })
    expect(mapContainer.style.height).toBe('340px')
    // 既定クラスは維持（上書きはstyleのみ）
    expect(mapContainer.className).toMatch(/h-\[240px\]/)
    // MapLibreの描画が追随（map.resize() が呼ばれる）
    const map = mockState.api._state.maps[0]
    expect(map).toBeTruthy()
    expect(map._calls.some((c) => c.name === 'resize')).toBe(true)
  })

  it('地図の表示タイミングはモバイルと同一（トップ・自治体モードではhidden、フォーム＋地図モードのみ表示）', () => {
    // トップ表示: 地図ブロックは hidden（マウントは維持）
    const view = renderInContext(
      <MobileSearchTab view="top" onViewResults={vi.fn()} />,
      mapState()
    )
    expect(mapBlockOf(view)).toBeTruthy()
    expect(mapBlockOf(view).hasAttribute('hidden')).toBe(true)

    // フォーム＋地図モード: 地図が表示される（ハンドルも現れる）
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: mapState(), dispatch: vi.fn() }}>
          <MobileSearchTab view="form" onViewResults={vi.fn()} />
        </AppContext.Provider>
      )
    })
    expect(mapBlockOf(view).hasAttribute('hidden')).toBe(false)
    expect(view.container.querySelector('[role="separator"]')).toBeTruthy()

    // フォーム＋自治体モード: 地図は hidden で非表示（マウントは維持）
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: { ...mapState(), searchSource: 'municipality' }, dispatch: vi.fn() }}>
          <MobileSearchTab view="form" onViewResults={vi.fn()} />
        </AppContext.Provider>
      )
    })
    expect(mapBlockOf(view).hasAttribute('hidden')).toBe(true)
  })

  it('共通の 160px〜480px の範囲にクランプされる', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState()
    )
    const mapContainer = mapContainerOf(view)
    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')

    // 上限: 240 + 241 = 481 → 480 に丸めクランプ（下方向ドラッグで増大）
    act(() => {
      fireEvent.pointerDown(handle, { clientY: 259 })
      fireEvent.pointerMove(handle, { clientY: 500 })
      fireEvent.pointerUp(handle)
    })
    expect(mapContainer.style.height).toBe('480px')

    // 下限: 480 - 321 = 159 → 160 に丸めクランプ（上方向ドラッグで減少）
    act(() => {
      fireEvent.pointerDown(handle, { clientY: 421 })
      fireEvent.pointerMove(handle, { clientY: 100 })
      fireEvent.pointerUp(handle)
    })
    expect(mapContainer.style.height).toBe('160px')
  })
})

describe('モバイル幅（<1024px・matches=true）: MobileSearchTab・地図モード', () => {
  beforeEach(() => {
    setMatchMedia(true)
  })

  it('地図コンテナの直後にドラッグハンドルが描画され、既定の高さクラスは維持される', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState() // searchSource: 'map'（地図モード）
    )
    const mapContainer = mapContainerOf(view)
    expect(mapContainer).toBeTruthy()
    expect(mapContainer.className).toMatch(/h-\[240px\]/)

    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')
    expect(handle).toBeTruthy()
    expect(handle.previousElementSibling).toBe(mapContainer)
  })

  it('ハンドル当たり判定の高さは28px以上（h-7）。中央のつかみ線は細いままでよい', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState()
    )
    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')
    expect(handle.className).toContain('h-7') // 当たり判定 28px 以上
    // 中央のつかみ線（グリップバー）は細いままでよい（h-1）
    expect(handle.firstElementChild.className).toContain('h-1')
  })

  it('ハンドルをドラッグすると地図コンテナの高さがインラインstyleで上書きされる', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState()
    )
    const mapContainer = mapContainerOf(view)
    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')
    // 初期状態から明示的なpx（既定240px）が入る
    expect(mapContainer.style.height).toBe('240px')

    act(() => {
      fireEvent.pointerDown(handle, { clientY: 200 })
      fireEvent.pointerMove(handle, { clientY: 300 }) // 100px下（ハンドル＝地図下端なので増大）
      fireEvent.pointerUp(handle)
    })
    expect(mapContainer.style.height).toBe('340px')
    expect(mapContainer.className).toMatch(/h-\[240px\]/)
    // MapLibreの描画が追随（map.resize() が呼ばれる）
    const map = mockState.api._state.maps[0]
    expect(map).toBeTruthy()
    expect(map._calls.some((c) => c.name === 'resize')).toBe(true)
  })

  it('モバイルは 160px〜480px の範囲にクランプされる', () => {
    const view = renderInContext(
      <MobileSearchTab view="form" onViewResults={vi.fn()} />,
      mapState()
    )
    const mapContainer = mapContainerOf(view)
    const handle = view.container.querySelector('[role="separator"][aria-orientation="horizontal"]')

    // 上限: 240 + 241 = 481 → 480 に丸めクランプ（下方向ドラッグで増大）
    act(() => {
      fireEvent.pointerDown(handle, { clientY: 259 })
      fireEvent.pointerMove(handle, { clientY: 500 })
      fireEvent.pointerUp(handle)
    })
    expect(mapContainer.style.height).toBe('480px')

    // 下限: 480 - 321 = 159 → 160 に丸めクランプ（上方向ドラッグで減少）
    act(() => {
      fireEvent.pointerDown(handle, { clientY: 421 })
      fireEvent.pointerMove(handle, { clientY: 100 })
      fireEvent.pointerUp(handle)
    })
    expect(mapContainer.style.height).toBe('160px')
  })
})
