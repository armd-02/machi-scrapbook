// @vitest-environment jsdom
/**
 * (修正) MobileResultsMap: モバイル「一覧」タブ上部の結果マップ。
 *
 * - POI結果: 施設アイコン（poi-icon symbolレイヤ）として表示、結果範囲にfitBounds
 *   （アイコンが未解決・画像読込失敗のものは青い点（poi-fallback circleレイヤ））
 * - バリアフリー結果: 線（bf-line）＋点（bf-node）として表示
 * - 範囲が算出できない場合は state.bbox にfitBounds（フォールバック）
 * - 再検索（結果変化）: ソースのsetData + fitBounds が再実行される
 * - 検索タブの地図と干渉しない: グローバルなgetMapInstance()に登録しない
 * - 操作可能: interactive: false を渡さず、コンテナに pointer-events-none を
 *   付けない（ドラッグ移動・ピンチ／ホイール／ダブルタップでズームできる）
 *
 * (修正) hidden→表示 遷移:
 * - MobileShell は全タブを常時マウントし非活性タブに hidden を付けるため、
 *   結果マップは display:none（幅・高さ0）のまま生成・load されることがある。
 *   その状態では fitBounds せず（ソースへ setData だけ行いフィットを保留）、
 *   コンテナが 0サイズ→表示サイズ へ遷移したとき（タブ表示・折りたたみ展開）に
 *   map.resize() と保留中の fitBounds を実行する。
 * - 表示サイズ同士の変化（高さドラッグ等）では map.resize() だけ行い、
 *   再フィットしない。
 * - jsdom はレイアウトを計算しないため、コンポーネントの表示/非表示判定
 *   （ResizeObserver の contentRect 幅・高さ > 0）を直接検証できない。そこで
 *   コンポーネントが生成する ResizeObserver を制御可能なモックに置き換え、
 *   テストから fireSize(w,h) で 0サイズ→表示サイズ 遷移を擬装する。
 * - 表示/非表示の既定は「表示」（実ブラウザでは ResizeObserver の初期コールバック
 *   が map の 'load' より前に必ず発火し、実際の表示状態を反映するため）。
 *   隠れた状態の検証は、load 前に hideContainer()（fireSize(0,0)）で
 *   非表示だと擬装して行う。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import { AppContext } from '../../../context/AppContext'
import { appReducer, createInitialState } from '../../../state/appReducer'
import { getMapInstance } from '../../../hooks/useMapRef'
import MobileResultsMap from '../MobileResultsMap'
import { facilityIconUrl } from '../../../utils/facilityIcon'

// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

// (修正) 制御可能な ResizeObserver モック。jsdom はレイアウトを計算しないため
// getBoundingClientRect 等のサイズ信号は常に 0 になり、コンポーネントの表示/非表示
// 判定（contentRect 幅・高さ > 0）をテストできない。そこでコンポーネントが生成する
// ResizeObserver をこのモックで置き換え、テストから fireSize(w,h) で
// 0サイズ→表示サイズ 遷移を擬装できるようにする。
const roInstances = { list: [] }
class ControllableResizeObserver {
  constructor(cb) {
    this._cb = cb
    this._target = null
    this._connected = true
    roInstances.list.push(this)
  }
  observe(el) { this._target = el }
  unobserve() { this._target = null }
  disconnect() { this._target = null; this._connected = false }
  // コンテナが (w,h) に変わったと擬装してコールバックを発火
  fireSize(w, h) {
    if (!this._connected || !this._target) return
    this._cb([{ contentRect: { width: w, height: h }, target: this._target }], this)
  }
}
global.ResizeObserver = ControllableResizeObserver

const OSAKA_BBOX = { south: 34.7, west: 135.5, north: 34.8, east: 135.6 }

// ===== テスト用データ =====
const poiA = { type: 'node', id: 1, name: 'カフェA', lat: 34.7, lon: 135.5, tags: { amenity: 'cafe', name: 'カフェA' } }
const poiB = { type: 'node', id: 2, name: '中央公園', lat: 34.71, lon: 135.51, tags: { leisure: 'park', name: '中央公園' } }
const poiSingle = { type: 'node', id: 3, name: '単独カフェ', lat: 34.75, lon: 135.55, tags: { amenity: 'cafe', name: '単独カフェ' } }
const poiNoCoords = { type: 'node', id: 4, name: '座標なし施設', lat: null, lon: null, tags: { amenity: 'cafe', name: '座標なし施設' } }
const poiC = { type: 'node', id: 5, name: '新カフェ', lat: 34.9, lon: 135.7, tags: { amenity: 'cafe', name: '新カフェ' } }

const bfFootway = {
  type: 'way',
  id: 100,
  name: '中央通り歩道',
  tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' },
  bf: { kind: 'way', tactile: 'yes', geometry: [[135.0, 34.0], [135.01, 34.01], [135.02, 34.0]] }
}
const bfKerb = {
  type: 'node',
  id: 200,
  name: null,
  tags: { barrier: 'kerb' },
  bf: { kind: 'node', kerb: null, hasSound: false, hasVibration: false, geometry: [135.1, 34.1] }
}

// ===== ハーネス =====
function Harness({ preActions = [], children }) {
  const [state, dispatch] = React.useReducer(
    appReducer,
    preActions,
    (acts) => acts.reduce((s, a) => appReducer(s, a), createInitialState())
  )
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

const getMap = () => mockState.api._state.maps.at(-1)
const callsOf = (map, name) => map._calls.filter((c) => c.name === name)
const resizesOf = (map) => callsOf(map, 'resize')

// mockの'load'はqueueMicrotaskで自動発火するため、フラッシュする
async function flushLoad() {
  await act(async () => {})
}

// コンポーネントが生成した ResizeObserver（監視対象が結果マップコンテナのもの）
const getRO = () => roInstances.list.at(-1)
// コンテナが表示サイズになったと擬装して RO を発火する（hidden→表示 遷移）
async function showContainer(w = 360, h = 200) {
  const ro = getRO()
  if (ro) await act(() => { ro.fireSize(w, h) })
}
// コンテナが hidden（幅・高さ0）だと擬装して RO を発火する（表示→hidden 遷移）
async function hideContainer() {
  const ro = getRO()
  if (ro) await act(() => { ro.fireSize(0, 0) })
}

beforeEach(() => {
  if (mockState.api) mockState.api.resetState()
  roInstances.list.length = 0
})
afterEach(() => cleanup())

describe('MobileResultsMap: POI結果（kind="poi"）', () => {
  it('結果を点レイヤとして設定し、結果範囲にfitBoundsする', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA, poiB] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    expect(map).toBeTruthy()

    // 白い円を施設アイコンの背面に描画する。
    const src = map._sources.get('results')
    expect(src).toBeTruthy()
    expect(src.type).toBe('geojson')
    expect(src.cluster).toBeFalsy()
    const [background, icon, fallback] = map._layers
    expect(map._layers.map((l) => l.id)).toEqual([
      'poi-background', 'poi-icon', 'poi-fallback', 'poi-selected-background', 'poi-selected-icon',
    ])
    expect(background).toMatchObject({
      type: 'circle',
      source: 'results',
      filter: icon.filter,
      paint: { 'circle-color': '#ffffff', 'circle-stroke-width': 2 },
    })
    expect(fallback.filter).toEqual(['==', ['get', 'icon'], ''])

    // (アイコンピン) 結果がGeoJSONとして設定され、properties.icon に
    // 解決されたアイコン名（施設カードと同じ getFacilityIcon）が付く
    await waitFor(() => {
      const fc = map._lastGeoJSON.data
      expect(fc.type).toBe('FeatureCollection')
      expect(fc.features).toHaveLength(2)
      expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [135.5, 34.7] })
      expect(fc.features[0].properties).toMatchObject({ key: 'node/1', icon: 'cafe.png' })
      expect(fc.features[1].properties).toMatchObject({ key: 'node/2', icon: 'tree_and_bench.png' })
    })
    // アイコン画像はマップへ登録される
    expect(map._images.has('cafe.png')).toBe(true)
    expect(map._images.has('tree_and_bench.png')).toBe(true)

    // 結果範囲にfitBounds
    const fit = callsOf(map, 'fitBounds')[0]
    expect(fit.args[0]).toEqual([[135.5, 34.7], [135.51, 34.71]])
    expect(fit.args[1]).toMatchObject({ padding: 24, maxZoom: 16 })
  })

  it('単一点の結果でもfitBoundsできる（範囲をわずかに拡張）', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiSingle] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()

    // (アイコンピン) アイコン読込の後に setData・fitBounds が実行される
    await waitFor(() => expect(callsOf(getMap(), 'fitBounds')).toHaveLength(1))
    const fit = callsOf(getMap(), 'fitBounds')[0]
    const [[w, s], [e, n]] = fit.args[0]
    expect(w).toBeLessThan(135.55)
    expect(e).toBeGreaterThan(135.55)
    expect(s).toBeLessThan(34.75)
    expect(n).toBeGreaterThan(34.75)
  })

  it.each([
    { label: '数メートル離れた施設', longitude: 135.50001, maxZoom: 19 },
    { label: '座標が同じ施設', longitude: 135.5, maxZoom: 16 },
  ])('$label のズーム設定を地図が見えるまで保留する', async ({ longitude, maxZoom }) => {
    const results = [poiA, { ...poiB, lat: poiA.lat, lon: longitude }]
    render(
      <Harness preActions={[{ type: 'SET_RESULTS', payload: results }]}>
        <MobileResultsMap />
      </Harness>
    )
    await hideContainer()
    const map = getMap()
    await waitFor(() => expect(map._lastGeoJSON?.data.features).toHaveLength(2))
    expect(callsOf(map, 'fitBounds')).toHaveLength(0)

    await showContainer()
    expect(callsOf(map, 'fitBounds')[0].args[1]).toMatchObject({ maxZoom })
  })

  it('座標がnoneば結果は範囲算出不能 → state.bboxにfitBoundsする', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiNoCoords] },
        { type: 'SET_STATUS', payload: 'success' },
        { type: 'SET_BBOX', payload: OSAKA_BBOX }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()

    // 使用可能な座標なし → 空のFeatureCollection
    await waitFor(() => {
      expect(getMap()._lastGeoJSON).toBeTruthy()
      expect(getMap()._lastGeoJSON.data.features).toHaveLength(0)
    })
    const fit = callsOf(getMap(), 'fitBounds')[0]
    expect(fit.args[0]).toEqual([[135.5, 34.7], [135.6, 34.8]])
  })

  it('再検索（結果変化）でsetDataとfitBoundsが再実行される', async () => {
    let dispatchRef
    function Inner() {
      const [state, dispatch] = React.useReducer(
        appReducer,
        [{ type: 'SET_RESULTS', payload: [poiA, poiB] }, { type: 'SET_STATUS', payload: 'success' }],
        (acts) => acts.reduce((s, a) => appReducer(s, a), createInitialState())
      )
      dispatchRef = dispatch
      return (
        <AppContext.Provider value={{ state, dispatch }}>
          <MobileResultsMap kind="poi" />
        </AppContext.Provider>
      )
    }
    render(<Inner />)
    await flushLoad()

    const map = getMap()
    // (アイコンピン) 最初のsetDataはアイコン読込の後に実行される
    await waitFor(() => expect(map._lastGeoJSON.data.features).toHaveLength(2))
    const fitsBefore = callsOf(map, 'fitBounds').length

    // 再検索: 新しい結果に置き換わる
    await act(async () => {
      dispatchRef({ type: 'SET_RESULTS', payload: [poiC] })
    })

    await waitFor(() => expect(map._lastGeoJSON.data.features).toHaveLength(1))
    expect(map._lastGeoJSON.data.features[0].properties.key).toBe('node/5')
    expect(callsOf(map, 'fitBounds').length).toBe(fitsBefore + 1)
    // (アイコンピン) 最初の読込ですでに登録済みのアイコンは再読込しない
    // （cafe.png・tree_and_bench.png の2回のloadImageのみ）
    expect(map._calls.filter((c) => c.name === 'loadImage')).toHaveLength(2)
    // 単一点の再検索: 点を中心にわずかに拡張された範囲へfitBounds
    const [[w, s], [e, n]] = callsOf(map, 'fitBounds').at(-1).args[0]
    expect(w).toBeCloseTo(135.6995, 6)
    expect(s).toBeCloseTo(34.8995, 6)
    expect(e).toBeCloseTo(135.7005, 6)
    expect(n).toBeCloseTo(34.9005, 6)
  })
})

describe('MobileResultsMap: loadImage の Promise 化（回帰）', () => {
  it('map.loadImage(url) の Promise が解決してから setData・fitBounds が実行される', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA, poiB] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    // (修正) maplibre-gl v6 の loadImage は Promise 専用API（url のみ引数）。
    // 旧コールバック形式 map.loadImage(url, cb) を呼び続けると Promise が永遠に
    // 解決せず setData・fitBounds に到達しない（ピンが一切出ない不具合）
    // (注) loadImage の _record は url をそのまま args として記録する（配列ではない）
    const loadImageUrls = callsOf(map, 'loadImage').map((c) => c.args)
    expect(loadImageUrls).toContain(facilityIconUrl('cafe.png'))
    expect(loadImageUrls).toContain(facilityIconUrl('tree_and_bench.png'))

    // Promise 解決後にソースへデータが入り、fitBounds が実行される
    await waitFor(() => {
      expect(map._lastGeoJSON.data.features).toHaveLength(2)
      expect(map._lastGeoJSON.data.features.map((f) => f.properties.key)).toEqual(['node/1', 'node/2'])
    })
    await waitFor(() => expect(callsOf(map, 'fitBounds')).toHaveLength(1))
  })
})

describe('MobileResultsMap: バリアフリー結果（kind="barrier_free"）', () => {
  it('歩道を線・縁石を点として設定し、両方を含む範囲にfitBoundsする', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [bfFootway, bfKerb] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="barrier_free" />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    // ソース・レイヤ: 'barrier-free' + bf-line/bf-node
    expect(map._sources.get('barrier-free')).toBeTruthy()
    expect(map._layers.map((l) => l.id)).toEqual(['bf-line', 'bf-node', 'bf-selected-line', 'bf-selected-node'])

    const fc = map._lastGeoJSON.data
    expect(fc.features).toHaveLength(2)
    const line = fc.features.find((f) => f.geometry.type === 'LineString')
    const point = fc.features.find((f) => f.geometry.type === 'Point')
    expect(line.geometry.coordinates).toEqual([[135.0, 34.0], [135.01, 34.01], [135.02, 34.0]])
    expect(line.properties).toMatchObject({ key: 'way/100', kind: 'way', tactile: 'yes' })
    expect(point.geometry.coordinates).toEqual([135.1, 34.1])
    expect(point.properties).toMatchObject({ key: 'node/200', kind: 'node', role: 'kerb' })

    // 線と点の両方を含む範囲
    const fit = callsOf(map, 'fitBounds')[0]
    expect(fit.args[0]).toEqual([[135.0, 34.0], [135.1, 34.1]])
  })
})

describe('MobileResultsMap: hidden→表示 遷移（修正）', () => {
  const poiPre = [
    { type: 'SET_RESULTS', payload: [poiA, poiB] },
    { type: 'SET_STATUS', payload: 'success' }
  ]

  it('隠れた状態（幅・高さ0）でマウントすると fitBounds をしない（setData のみ・保留）', async () => {
    render(
      <Harness preActions={poiPre}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    // コンテナが hidden（0サイズ）だと擬装（既定は「表示」なので非表示に設定）
    await hideContainer()
    await flushLoad()
    const map = getMap()
    expect(map).toBeTruthy()
    // ソースへの setData は行われる（アイコン読込の後に非同期で実行）
    await waitFor(() => {
      expect(map._lastGeoJSON).toBeTruthy()
      expect(map._lastGeoJSON.data.features).toHaveLength(2)
    })
    // fitBounds は呼ばれない（コンテナが 0サイズの間は保留）
    expect(callsOf(map, 'fitBounds')).toHaveLength(0)
    // resize も呼ばれない（表示への遷移が起きていないため）
    expect(resizesOf(map)).toHaveLength(0)
  })

  it('表示復帰（0サイズ→表示）時に map.resize() と結果範囲への fitBounds が実行される', async () => {
    render(
      <Harness preActions={poiPre}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await hideContainer()
    await flushLoad()
    const map = getMap()
    // (アイコンピン) 最初のsetData完了を待つ（hidden 中に保留される範囲はこの
    // 時点で作られるため、表示復帰前に確定しておかないとfitBoundsが実行されない）
    await waitFor(() => {
      expect(map._lastGeoJSON).toBeTruthy()
      expect(map._lastGeoJSON.data.features).toHaveLength(2)
    })
    expect(callsOf(map, 'fitBounds')).toHaveLength(0)

    // コンテナが表示サイズになったと擬装（タブ表示・折りたたみ展開）
    await showContainer(360, 200)

    // resize() が呼ばれる
    expect(resizesOf(map)).toHaveLength(1)
    // 保留していた結果範囲への fitBounds が実行される
    const fits = callsOf(map, 'fitBounds')
    expect(fits).toHaveLength(1)
    expect(fits[0].args[0]).toEqual([[135.5, 34.7], [135.51, 34.71]])
    expect(fits[0].args[1]).toMatchObject({ padding: 24, maxZoom: 16 })
  })

  it('表示サイズ同士の変化（高さドラッグ等）では resize() だけ行い再フィットしない', async () => {
    render(
      <Harness preActions={poiPre}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()
    const map = getMap()
    // (アイコンピン) load 時のfitBounds完了を待つ（setData はアイコン読込の後）
    await waitFor(() => expect(callsOf(map, 'fitBounds')).toHaveLength(1))
    await showContainer(360, 200)
    const fitsAfterShow = callsOf(map, 'fitBounds').length   // 1（load 時）
    const resizesAfterShow = resizesOf(map).length            // 1

    // 高さが 200→280 に変わったと仮定して RO を再発火（表示サイズ同士）
    await showContainer(360, 280)

    // resize() は再び呼ばれる
    expect(resizesOf(map).length).toBe(resizesAfterShow + 1)
    // しかし fitBounds は追加されない（再フィットしない）
    expect(callsOf(map, 'fitBounds').length).toBe(fitsAfterShow)
  })

  it('隠れている間の再検索でも fitBounds せず、表示復帰時に最新範囲へフィットする', async () => {
    let dispatchRef
    function Inner() {
      const [state, dispatch] = React.useReducer(
        appReducer,
        [{ type: 'SET_RESULTS', payload: [poiA, poiB] }, { type: 'SET_STATUS', payload: 'success' }],
        (acts) => acts.reduce((s, a) => appReducer(s, a), createInitialState())
      )
      dispatchRef = dispatch
      return (
        <AppContext.Provider value={{ state, dispatch }}>
          <MobileResultsMap kind="poi" />
        </AppContext.Provider>
      )
    }
    render(<Inner />)
    await hideContainer()
    await flushLoad()
    const map = getMap()
    expect(callsOf(map, 'fitBounds')).toHaveLength(0)

    // 隠れたまま再検索（新しい結果に置き換え）
    await act(async () => {
      dispatchRef({ type: 'SET_RESULTS', payload: [poiC] })
    })
    // ソースは更新されるが、隠れているため fitBounds は呼ばれない
    await waitFor(() => expect(map._lastGeoJSON.data.features).toHaveLength(1))
    expect(map._lastGeoJSON.data.features[0].properties.key).toBe('node/5')
    expect(callsOf(map, 'fitBounds')).toHaveLength(0)

    // 表示復帰 → 最新（poiC）の範囲へフィット
    await showContainer(360, 200)
    const fits = callsOf(map, 'fitBounds')
    expect(fits).toHaveLength(1)
    const [[w, s], [e, n]] = fits[0].args[0]
    // 単一点: 点を中心にわずかに拡張された範囲
    expect(w).toBeCloseTo(135.6995, 6)
    expect(s).toBeCloseTo(34.8995, 6)
    expect(e).toBeCloseTo(135.7005, 6)
    expect(n).toBeCloseTo(34.9005, 6)
  })

  it('バリアフリー（kind="barrier_free"）でも隠れたままマウント→表示復帰で結果範囲にフィットする', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [bfFootway, bfKerb] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="barrier_free" />
      </Harness>
    )
    await hideContainer()
    await flushLoad()
    const map = getMap()
    // 隠れている間は fitBounds しない
    expect(callsOf(map, 'fitBounds')).toHaveLength(0)
    // ソース（barrier-free）への setData は行われる
    expect(map._lastGeoJSON.data.features).toHaveLength(2)

    // 表示復帰 → resize ＋ 線・点を含む範囲への fitBounds
    await showContainer(360, 200)
    expect(resizesOf(map)).toHaveLength(1)
    const fits = callsOf(map, 'fitBounds')
    expect(fits).toHaveLength(1)
    expect(fits[0].args[0]).toEqual([[135.0, 34.0], [135.1, 34.1]])
  })
})

describe('MobileResultsMap: 検索タブの地図との干渉', () => {
  it('グローバルなgetMapInstance()には登録しない', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()
    expect(getMapInstance()).toBeNull()
  })

  it('OSM表記（compact）のアトリビューション制御が登録される', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()
    expect(mockState.api._state.controls).toHaveLength(1)
    expect(mockState.api._state.controls[0]._options).toEqual({ compact: true })
  })

  it('アンマウント時にマップが破棄される', async () => {
    const { unmount } = render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()
    const map = getMap()
    unmount()
    expect(map._removed).toBe(true)
  })

  it('アクセシビリティ: 結果マップはrole=applicationでラベルを持つ（操作可能な地図）', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    expect(screen.getByRole('application', { name: '検索結果マップ' })).toBeTruthy()
  })
})

describe('MobileResultsMap: 操作可能性（修正）', () => {
  it('interactive: false を渡さず、コンテナに pointer-events-none を付けない', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()

    // Map コンストラクタに interactive: false を渡していない
    // （既定値でドラッグ移動・ピンチ／ホイール／ダブルタップズームが可能）
    expect(getMap()._options.interactive).not.toBe(false)
    // コンテナに pointer-events: none が付いていない
    const container = screen.getByRole('application', { name: '検索結果マップ' })
    expect(container.className).not.toContain('pointer-events-none')
  })

  it('pitchを0に固定する（maxPitch: 0、pitchWithRotate: false）、回転は従来どおり有効', () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    const map = getMap()
    expect(map._options.maxPitch).toBe(0)
    expect(map._options.pitchWithRotate).toBe(false)
    expect(map._options.dragRotate).not.toBe(false)
    expect(map._options.touchZoomRotate).not.toBe(false)
  })
})

describe('MobileResultsMap: マーカータップ → onMarkerClick（修正）', () => {
  const poiPre = [
    { type: 'SET_RESULTS', payload: [poiA, poiB] },
    { type: 'SET_STATUS', payload: 'success' }
  ]

  it.each(['poi-icon', 'poi-background', 'poi-selected-icon'])('POI: %s のクリックで対応する結果を1回選択する', async (layerId) => {
    const onMarkerClick = vi.fn()
    render(
      <Harness preActions={poiPre}>
        <MobileResultsMap kind="poi" onMarkerClick={onMarkerClick} />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    // (アイコンピン) アイコン読込完了（setData）を待つ
    await waitFor(() => expect(map._lastGeoJSON.data.features).toHaveLength(2))
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/1')
    expect(feature).toBeTruthy()
    expect(feature.properties.icon).toBe('cafe.png')
    act(() => {
      map.fire('click', layerId, {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    // feature の key（type/id）から解決した結果がそのまま渡される
    expect(onMarkerClick).toHaveBeenCalledTimes(1)
    expect(onMarkerClick.mock.calls[0][0]).toEqual(poiA)
  })

  it('POI: タップされた key がどの結果にも対応しない場合は onMarkerClick しない', async () => {
    const onMarkerClick = vi.fn()
    render(
      <Harness preActions={poiPre}>
        <MobileResultsMap kind="poi" onMarkerClick={onMarkerClick} />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    act(() => {
      map.fire('click', 'poi-icon', {
        features: [{ properties: { key: 'node/999' } }],
        lngLat: { lat: 34.7, lng: 135.5 }
      })
    })
    expect(onMarkerClick).not.toHaveBeenCalled()
  })

  it('POI: アイコン読込失敗の機能はフォールバックの青い点（poi-fallback）になり、クリックで onMarkerClick が呼ばれる', async () => {
    // cafe.png の読込失敗を擬装する
    mockState.api.setImageLoadFailures([facilityIconUrl('cafe.png')])
    const onMarkerClick = vi.fn()
    render(
      <Harness preActions={poiPre}>
        <MobileResultsMap kind="poi" onMarkerClick={onMarkerClick} />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    // cafe アイコンの読込失敗 → properties.icon が空（フォールバック点）。
    // park アイコンは成功して施設アイコンのまま。
    await waitFor(() => {
      const features = map._lastGeoJSON.data.features
      expect(features.find((f) => f.properties.key === 'node/1').properties.icon).toBe('')
      expect(features.find((f) => f.properties.key === 'node/2').properties.icon).toBe('tree_and_bench.png')
    })
    expect(map._images.has('cafe.png')).toBe(false)
    expect(map._images.has('tree_and_bench.png')).toBe(true)

    // フォールバック点レイヤ（poi-fallback）をクリック
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/1')
    act(() => {
      map.fire('click', 'poi-fallback', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })
    expect(onMarkerClick).toHaveBeenCalledTimes(1)
    expect(onMarkerClick.mock.calls[0][0]).toEqual(poiA)
  })

  it('POI: 対応表に無い施設はフォールバックアイコン（marker-stroked.png）で表示される', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [{ type: 'node', id: 6, name: '不明施設', lat: 34.72, lon: 135.52, tags: { unknown_key: 'value' } }] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    await waitFor(() => {
      const features = map._lastGeoJSON.data.features
      expect(features).toHaveLength(1)
      expect(features[0].properties.icon).toBe('marker-stroked.png')
    })
    expect(map._images.has('marker-stroked.png')).toBe(true)
  })

  it('バリアフリー地図の線と点のクリックで対応する結果を渡す', async () => {
    const onMarkerClick = vi.fn()
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [bfFootway, bfKerb] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="barrier_free" onMarkerClick={onMarkerClick} />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    const [line, point] = map._lastGeoJSON.data.features
    act(() => {
      map.fire('click', 'bf-line', { features: [line] })
      map.fire('click', 'bf-selected-node', { features: [point] })
    })
    expect(onMarkerClick.mock.calls).toEqual([[bfFootway], [bfKerb]])
  })
})

describe('MobileResultsMap: results prop（メモ帳流用）', () => {
  it('results prop を指定すると、state の検索結果ではなく prop のデータを表示する', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA, poiB] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" results={[poiSingle]} />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    // ソースの GeoJSON は prop のデータ（単独カフェ）で、state の2結果ではない
    await waitFor(() => {
      const fc = map._lastGeoJSON.data
      expect(fc.features).toHaveLength(1)
      expect(fc.features[0].properties).toMatchObject({ key: 'node/3', icon: 'cafe.png' })
      expect(fc.features[0].geometry.coordinates).toEqual([135.55, 34.75])
    })

    // fitBounds も prop のデータの範囲へ（state の結果範囲ではない）
    await waitFor(() => expect(callsOf(map, 'fitBounds')).toHaveLength(1))
    const fit = callsOf(map, 'fitBounds')[0]
    const [[w, s], [e, n]] = fit.args[0]
    expect(w).toBeLessThan(135.55)
    expect(e).toBeGreaterThan(135.55)
    expect(s).toBeLessThan(34.75)
    expect(n).toBeGreaterThan(34.75)
  })

  it('prop 未指定なら従来どおり state の検索結果を使う', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [poiA, poiB] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileResultsMap kind="poi" />
      </Harness>
    )
    await flushLoad()

    const map = getMap()
    await waitFor(() => {
      const fc = map._lastGeoJSON.data
      expect(fc.features).toHaveLength(2)
      expect(fc.features.map((f) => f.properties.key)).toEqual(['node/1', 'node/2'])
    })
  })
})
