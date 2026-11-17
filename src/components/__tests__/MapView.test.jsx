// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import MapView from '../MapView'
import { AppContext } from '../../context/AppContext'
import { BASEMAP_STYLE } from '../../utils/mapStyle'

/**
 * MapLibre移行（Task 1）+ 検索後カメラ不動（Task 2）の検証
 *
 * - (Task 2) 検索実行（bboxSource='search'）ではfitBoundsを呼ばない。
 *   カメラfitはURL復元由来（bboxSource='url'）の初回適用時と、
 *   確定場所（bboxSource: geocode/municipality）の確定時のみ。
 * - (#xx) 検索範囲矩形（BBOXオーバーレイ）は確定場所（geocode/municipality）
 *   のbboxにのみ描画され、クリアで消える。検索由来・URL由来のbboxには描画しない。
 * - (a) OSMFJベクタタイルベースマップ（BASEMAP_STYLEオブジェクト、リモート取得なし）
 * - (#38) ポップアップはtextContentベースのDOMノード（HTML注入不可）
 * - (#39相当) 結果更新時に旧ポップアップを閉じる
 * - クラスタリング（supercluster不要のネイティブcluster）+ 500件上限の撤廃
 * - (#60) ウィンドウリサイズでmap.resize()
 * - アクティブ結果のハイライトマーカー（panToのみ、BBOX不変）
 */

// vi.mockファクトリはファイル先頭にホイスされるため、共通モックは動的importで参照。
// autoLoad: false → 'load'イベントをテストが制御して発火する。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock({ autoLoad: false })
  return { default: mockState.api }
})

class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver || MockResizeObserver
  if (mockState.api) mockState.api.resetState()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const BBOX_OSAKA = { south: 34.66, west: 135.47, north: 34.69, east: 135.5 }
const BBOX_KYOto = { south: 34.7, west: 135.48, north: 34.71, east: 135.49 }

const RESULTS = [
  {
    type: 'node', id: 9001, lat: 34.68, lon: 135.48,
    name: '<script>alert(1)</script>',
    tags: { name: '<script>alert(1)</script>', amenity: 'cafe', wheelchair: 'yes' }
  },
  {
    // overpass.jsのパイプラインはway/relationのcenterをトップレベルlat/lonに正規化する
    type: 'way', id: 9002, lat: 34.67, lon: 135.49, center: { lat: 34.67, lon: 135.49 },
    name: 'テストラーメン屋',
    tags: { name: 'テストラーメン屋', amenity: 'restaurant', cuisine: 'ramen' }
  }
]

function renderMap(state = {}, props = {}) {
  const fullState = {
    results: [], bbox: null, bboxSource: null, activeResultId: null,
    status: 'idle',
    ...state
  }
  const view = render(
    <AppContext.Provider value={{ state: fullState, dispatch: vi.fn() }}>
      <MapView {...props} />
    </AppContext.Provider>
  )
  return { view, state: fullState }
}

const getMap = () => mockState.api._state.maps.at(-1)
const fireLoad = () => act(() => { getMap().fire('load') })
const callsOf = (map, name) => map._calls.filter((c) => c.name === name)

describe('Task 2: 検索後のカメラ不変', () => {
  it('検索由来のbbox（bboxSource=search）ではfitBoundsを呼ばない', () => {
    renderMap({ bbox: BBOX_KYOto, bboxSource: 'search', results: RESULTS })
    fireLoad()
    expect(callsOf(getMap(), 'fitBounds')).toHaveLength(0)
    // 初期center/zoomもBBOXから派生しない（既定の大阪中心）
    const map = getMap()
    expect(map._options.center).toEqual([135.5023, 34.6937])
    expect(map._options.zoom).toBe(13)
  })

  it('URL復元由来のbbox（bboxSource=url）は初回ロード時のみfitBoundsする', () => {
    renderMap({ bbox: BBOX_OSAKA, bboxSource: 'url' })
    fireLoad()
    const fits = callsOf(getMap(), 'fitBounds')
    expect(fits).toHaveLength(1)
    // [[west, south], [east, north]]（MapLibreは{lng, lat}順）
    expect(fits[0].args[0]).toEqual([[135.47, 34.66], [135.5, 34.69]])
    expect(fits[0].args[1]).toEqual({ padding: 20 })
  })

  it('URL復元fit後に検索すると、再fitされない（カメラ位置・ズームは不変）', () => {
    const { view, state } = renderMap({ bbox: BBOX_OSAKA, bboxSource: 'url', results: RESULTS })
    fireLoad()
    expect(callsOf(getMap(), 'fitBounds')).toHaveLength(1)

    // 検索実行: 新規bbox（source=search）でstateが更新される
    const next = { ...state, bbox: BBOX_KYOto, bboxSource: 'search' }
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: next, dispatch: vi.fn() }}>
          <MapView />
        </AppContext.Provider>
      )
    })

    // fitBoundsは初回の1件のみ（再fitなし）
    expect(callsOf(getMap(), 'fitBounds')).toHaveLength(1)
    // jumpToも呼ばれない（カメラ位置・ズームの変更なし）
    expect(callsOf(getMap(), 'jumpTo')).toHaveLength(0)
    // 結果マーカーは反映される（検索結果の更新自体は正常に動作）
    expect(getMap()._lastGeoJSON.data.features.length).toBe(2)
  })

  it('検索由来・URL由来のbboxでは選択矩形（BBOXオーバーレイ）を描画しない（確定場所のみ）', () => {
    renderMap({ bbox: BBOX_OSAKA, bboxSource: 'url', results: RESULTS })
    fireLoad()
    const map = getMap()
    // 結果レイヤのみ（矩形レイヤ・矩形ソースなし）
    const layerIds = map._layers.map((l) => l.id)
    expect(layerIds).toEqual(['point-circle', 'clusters', 'cluster-count'])
    const sourceIds = [...map._sources.keys()]
    expect(sourceIds).toEqual(['results'])
  })
})

describe('(#xx) 検索範囲矩形オーバーレイ（BBOXオーバーレイ）と確定場所fit', () => {
  // jsdomではgetBoundingClientRectが常に0を返すため、fit系テストでは
  // コンテナのサイズをパッチして「表示中」を再現する。
  function mockVisibleContainer() {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    spy.mockReturnValue({
      width: 300, height: 300, top: 0, left: 0, right: 300, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    })
    return spy
  }

  it('確定場所（bboxSource=geocode）では青い矩形を描画する（ソース+線レイヤ+矩形GeoJSON）', () => {
    renderMap({ bbox: BBOX_OSAKA, bboxSource: 'geocode', results: RESULTS })
    fireLoad()
    const map = getMap()

    // 矩形の線レイヤが結果レイヤ群に追加される
    expect(map._layers.map((l) => l.id)).toEqual([
      'point-circle', 'clusters', 'cluster-count', 'bbox-overlay-line',
    ])
    const src = map.getSource('bbox-overlay')
    expect(src).toBeTruthy()

    // 矩形GeoJSON: 閉じたLineString（5点、[lng, lat]順）
    const fc = src._data
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(1)
    const geom = fc.features[0].geometry
    expect(geom.type).toBe('LineString')
    expect(geom.coordinates).toEqual([
      [135.47, 34.66], // 西南
      [135.5, 34.66],  // 東南
      [135.5, 34.69],  // 東北
      [135.47, 34.69], // 西北
      [135.47, 34.66], // 開始点に戻る（閉じる）
    ])

    // レイヤスタイル: 青#2563eb・幅2.5・不透明度0.9
    const layer = map._layers.find((l) => l.id === 'bbox-overlay-line')
    expect(layer.type).toBe('line')
    expect(layer.source).toBe('bbox-overlay')
    expect(layer.paint['line-color']).toBe('#2563eb')
    expect(layer.paint['line-width']).toBe(2.5)
    expect(layer.paint['line-opacity']).toBe(0.9)
  })

  it('確定場所（municipality）でも矩形を描画する', () => {
    renderMap({ bbox: BBOX_KYOto, bboxSource: 'municipality' })
    fireLoad()
    const map = getMap()
    expect(map.getSource('bbox-overlay')).toBeTruthy()
    expect(map._layers.some((l) => l.id === 'bbox-overlay-line')).toBe(true)
  })

  it('確定場所（geocode）ではfitBoundsを呼ぶ: [[west,south],[east,north]] + {padding:40, maxZoom:17, duration:800}', () => {
    const spy = mockVisibleContainer()
    renderMap({ bbox: BBOX_OSAKA, bboxSource: 'geocode' })
    // マウント時は地図未ロード → fitは保留（まだ呼ばれない）
    expect(callsOf(getMap(), 'fitBounds')).toHaveLength(0)
    fireLoad()
    // ロード完了時に保留fitが適用される
    const fits = callsOf(getMap(), 'fitBounds')
    expect(fits).toHaveLength(1)
    expect(fits[0].args[0]).toEqual([[135.47, 34.66], [135.5, 34.69]])
    expect(fits[0].args[1]).toEqual({ padding: 40, maxZoom: 17, duration: 800 })
    spy.mockRestore()
  })

  it('同一bbox値の再dispatchではfitBounds・setDataを繰り返さない（dedup）', () => {
    const { view, state } = renderMap({ bbox: BBOX_OSAKA, bboxSource: 'geocode' })
    fireLoad()
    const map = getMap()
    expect(callsOf(map, 'fitBounds')).toHaveLength(1)
    const setDataBefore = map._calls.filter((c) => c.name === 'setData').length

    // 値が同じbboxを新しいオブジェクトとして再dispatch（useSearchの毎検索SET_BBOXに相当）
    const next = { ...state, bbox: { ...BBOX_OSAKA }, bboxSource: 'geocode' }
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: next, dispatch: vi.fn() }}>
          <MapView />
        </AppContext.Provider>
      )
    })

    // fitBoundsは初回の1件のみ（再fitなし）
    expect(callsOf(map, 'fitBounds')).toHaveLength(1)
    // 矩形のsetDataも繰り返されない（_lastGeoJSONが矩形で上書きされない）
    const setDataAfter = map._calls.filter((c) => c.name === 'setData').length
    expect(setDataAfter).toBe(setDataBefore)
    // 矩形ソースは維持される
    expect(map.getSource('bbox-overlay')).toBeTruthy()
  })

  it('bboxがクリア（null）されると矩形オーバーレイが削除され、同じ場所の再確定でfitし直せる', () => {
    const spy = mockVisibleContainer()
    const { view, state } = renderMap({ bbox: BBOX_OSAKA, bboxSource: 'geocode' })
    fireLoad()
    const map = getMap()
    expect(map.getSource('bbox-overlay')).toBeTruthy()
    expect(callsOf(map, 'fitBounds')).toHaveLength(1)

    // クリア: bbox=null（入力欄を空にした場合）
    const cleared = { ...state, bbox: null, bboxSource: null }
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: cleared, dispatch: vi.fn() }}>
          <MapView />
        </AppContext.Provider>
      )
    })
    // 矩形ソース・レイヤが削除される
    expect(map.getSource('bbox-overlay')).toBeNull()
    expect(map._layers.map((l) => l.id)).toEqual(['point-circle', 'clusters', 'cluster-count'])

    // 同じ場所を再確定 → fitし直し・矩形再描画（fitフラグがリセットされている）
    const again = { ...cleared, bbox: { ...BBOX_OSAKA }, bboxSource: 'geocode' }
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: again, dispatch: vi.fn() }}>
          <MapView />
        </AppContext.Provider>
      )
    })
    expect(map.getSource('bbox-overlay')).toBeTruthy()
    expect(callsOf(map, 'fitBounds')).toHaveLength(2)
    spy.mockRestore()
  })

  it('検索由来bbox（bboxSource=search）の確定場所fitは行わない（fitBounds追加なし）', () => {
    const spy = mockVisibleContainer()
    const { view, state } = renderMap({ bbox: BBOX_OSAKA, bboxSource: 'geocode' })
    fireLoad()
    const map = getMap()
    expect(callsOf(map, 'fitBounds')).toHaveLength(1)

    // 検索実行: bbox値が変わりsource=searchに
    const next = { ...state, bbox: BBOX_KYOto, bboxSource: 'search' }
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: next, dispatch: vi.fn() }}>
          <MapView />
        </AppContext.Provider>
      )
    })

    // 再fitされない（fitBoundsは初回の1件のみ）
    expect(callsOf(map, 'fitBounds')).toHaveLength(1)
    // 矩形オーバーレイも削除される（確定場所ではなくなったため）
    expect(map.getSource('bbox-overlay')).toBeNull()
    spy.mockRestore()
  })
})

describe('(a) OSMベースマップ（ベクタタイル）', () => {
  it('OSMFJベースマップスタイル（osmfj_poi、カメラフィールド除去済み）で初期化する', () => {
    renderMap({})
    const map = getMap()
    // ベースマップは community_mapmaker 由来のスタイル（src/styles/osmfj_poi.json）
    // を mapStyle.js が読み込み、center/zoom/bearing/pitch を除去して export する
    // BASEMAP_STYLE を使う。Mapオプションの style はこのスタイルオブジェクトそのもの
    // （リモート取得不要）。
    expect(map._options.style).toBe(BASEMAP_STYLE)
  })
})

describe('(b) カメラオプション: 平面地図（pitch固定0）', () => {
  it('maxPitch: 0 と pitchWithRotate: false を指定し、回転（dragRotate/touchZoomRotate）は従来どおり有効', () => {
    renderMap({})
    const map = getMap()
    // アプリは平面（top-down）地図のため pitch を常に0に固定し、回転操作での
    // 連動ピッチ（pitchWithRotate 既定 true）を無効化する。
    expect(map._options.maxPitch).toBe(0)
    expect(map._options.pitchWithRotate).toBe(false)
    // 回転（dragRotate / touchZoomRotate）は従来どおり有効（明示的に無効化していない）
    expect(map._options.dragRotate).not.toBe(false)
    expect(map._options.touchZoomRotate).not.toBe(false)
  })
})

describe('#38: プレーンテキストポップアップ（HTML注入対策）', () => {
  it('ポップアップはDOMノードで構築され、nameがテキストとして扱われる', () => {
    renderMap({ results: RESULTS })
    fireLoad()
    const map = getMap()

    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/9001')
    act(() => {
      map.fire('click', 'point-circle', {
        features: [feature],
        lngLat: { lat: 34.68, lng: 135.48 }
      })
    })

    const popup = mockState.api._state.popups.at(-1)
    expect(popup).toBeTruthy()
    // setDOMElementでDOMノード（setHTML未使用）
    expect(popup._element).toBeInstanceOf(HTMLElement)
    expect(popup._text).toBeNull()

    // スクリプト注入試みのnameはエスケープされたテキストとして表示される
    const nameEl = popup._element.querySelector('.map-popup-name')
    expect(nameEl.textContent).toBe('<script>alert(1)</script>')
    expect(nameEl.innerHTML).not.toContain('<script>')
    expect(popup._element.querySelector('script')).toBeNull()
  })

  it('結果が更新されると旧ポップアップは閉じる', () => {
    const { view, state } = renderMap({ results: RESULTS })
    fireLoad()
    const map = getMap()

    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/9001')
    act(() => {
      map.fire('click', 'point-circle', { features: [feature], lngLat: { lat: 34.68, lng: 135.48 } })
    })
    const popup = mockState.api._state.popups.at(-1)
    expect(popup._removed).toBe(false)

    // 結果更新 → 旧ポップアップがcloseされる
    const next = { ...state, results: [...RESULTS, { type: 'node', id: 9003, lat: 34.665, lon: 135.485, name: '新規', tags: { name: '新規', shop: 'bakery' } }] }
    act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: next, dispatch: vi.fn() }}>
          <MapView />
        </AppContext.Provider>
      )
    })
    expect(popup._removed).toBe(true)
  })
})

describe('クラスタリング（ネイティブcluster、supercluster不要）', () => {
  it('cluster有効なGeoJSONソース+3レイヤ（点/クラスタ/件数）を追加する', () => {
    renderMap({ results: RESULTS })
    fireLoad()
    const map = getMap()
    const source = map._sources.get('results')
    expect(source.type).toBe('geojson')
    expect(source.cluster).toBe(true)
    expect(source.clusterRadius).toBeGreaterThan(0)
    const layerIds = map._layers.map((l) => l.id)
    expect(layerIds).toEqual(['point-circle', 'clusters', 'cluster-count'])
  })

  it('500件上限が撤廃され、全件がGeoJSONに含まれる', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      type: 'node', id: 10000 + i, lat: 34.6 + (i % 50) * 0.0005, lon: 135.47 + Math.floor(i / 50) * 0.0005,
      name: `施設${i}`, tags: { name: `施設${i}`, amenity: 'cafe' }
    }))
    renderMap({ results: many })
    fireLoad()
    const map = getMap()
    expect(map._lastGeoJSON.data.features.length).toBe(600)
  })

  it('クラスタクリックでメンバー範囲へfitBoundsする（ユーザー操作は許可）', () => {
    mockState.api.setQuerySourceFeatures(() => [
      { geometry: { coordinates: [135.5, 34.85] } },
      { geometry: { coordinates: [135.51, 34.86] } }
    ])
    renderMap({ results: RESULTS })
    fireLoad()
    const map = getMap()

    act(() => {
      map.fire('click', 'clusters', { features: [{ properties: { cluster_id: 1, point_count: 2 } }] })
    })

    const fits = callsOf(map, 'fitBounds')
    expect(fits).toHaveLength(1)
    expect(fits[0].args[0]).toEqual([[135.5, 34.85], [135.51, 34.86]])
    expect(fits[0].args[1]).toEqual({ padding: 40, maxZoom: 17, duration: 800 })
  })
})

describe('#60: リサイズ時の再描画（resize）', () => {
  afterEach(() => vi.useRealTimers())

  it('ウィンドウリサイズでmap.resize()が呼ばれる', () => {
    vi.useFakeTimers()
    renderMap({ results: RESULTS })
    fireLoad()
    const map = getMap()

    act(() => {
      fireEvent(window, new Event('resize'))
    })
    vi.advanceTimersByTime(110)

    expect(callsOf(map, 'resize').length).toBeGreaterThanOrEqual(1)
  })
})

describe('ハイライトマーカー（#60 施設選択）', () => {
  it('アクティブ結果にオレンジマーカー+プレーンテキストポップアップを表示する', () => {
    renderMap({ results: RESULTS, activeResultId: 'node/9001' })
    fireLoad()

    const markers = mockState.api._state.markers
    const highlight = markers.find((m) => m._element && m._element.className === 'map-highlight-marker')
    expect(highlight).toBeTruthy()
    expect(highlight._lngLat).toEqual([135.48, 34.68]) // [lng, lat]
    expect(highlight._popup._text).toBe('<script>alert(1)</script>') // setText（プレーン）
  })

  it('アクティブ結果の変更でマーカー位置が追従し、解除で削除される', () => {
    // （load前にactiveResultIdを設定してもpanToは走らないため、
    //   load後に設定・変更・解除の順で検証する）
    const { view, state } = renderMap({ results: RESULTS })
    fireLoad()
    const map = getMap()

    const set = (s) => act(() => {
      view.rerender(
        <AppContext.Provider value={{ state: s, dispatch: vi.fn() }}>
          <MapView />
        </AppContext.Provider>
      )
    })

    // node/9001 を選択 → panTo + マーカー作成
    set({ ...state, activeResultId: 'node/9001' })
    expect(callsOf(map, 'panTo')).toEqual([{ name: 'panTo', args: [[135.48, 34.68], { duration: 500 }] }])
    let highlight = mockState.api._state.markers.find((m) => m._element && m._element.className === 'map-highlight-marker')
    expect(highlight._lngLat).toEqual([135.48, 34.68])

    // 別結果へ切替 → 同一マーカーの位置追従（panToも更新）
    set({ ...state, activeResultId: 'way/9002' })
    expect(highlight._lngLat).toEqual([135.49, 34.67])
    expect(mockState.api._state.markers.filter((m) => m._element && m._element.className === 'map-highlight-marker')).toHaveLength(1)

    // 解除 → マーカー削除
    set({ ...state, activeResultId: null })
    expect(highlight._removed).toBe(true)
  })
})

describe('Task 11: GeoJSONソース更新はsetData（Map.setGeoJSONはmaplibre-glに存在しない）', () => {
  it('mockは実APIに合わせMap.setGeoJSONを持たない（回帰時にTypeErrorで検出）', () => {
    renderMap({ results: RESULTS })
    fireLoad()
    // 実maplibre-glのMapにはsetGeoJSONメソッドがない（mapbox-gl由来のAPI）。
    // モックにも存在させないことで、アプリ側が誤ってmap.setGeoJSON()を呼んだ場合は
    // 本番と同様の「setGeoJSON is not a function」でテストが失敗する。
    expect(getMap().setGeoJSON).toBeUndefined()
  })

  it('検索結果の到着はgetSource("results").setData()で反映される', () => {
    const { view, state } = renderMap({ results: [] })
    fireLoad()
    const map = getMap()
    // load時のsyncResults: 空のFeatureCollectionがsetDataされている
    expect(map._lastGeoJSON.id).toBe('results')
    expect(map._lastGeoJSON.data.features.length).toBe(0)

    // 検索結果がstateに到着 → [results] effectがsetDataを呼ぶ
    act(() => {
      view.rerender(
        <AppContext.Provider
          value={{ state: { ...state, results: RESULTS, bbox: BBOX_KYOto, bboxSource: 'search' }, dispatch: vi.fn() }}
        >
          <MapView />
        </AppContext.Provider>
      )
    })

    expect(map._lastGeoJSON.id).toBe('results')
    expect(map._lastGeoJSON.data.features.length).toBe(2)
    const keys = map._lastGeoJSON.data.features.map((f) => f.properties.key)
    expect(keys).toEqual(['node/9001', 'way/9002'])
  })
})

describe('モバイル: マーカークリックでボトムシート（ポップアップ非表示）', () => {
  it('onMarkerClickが提供されていればクリックでコールバックし、ポップアップを作らない', () => {
    const onMarkerClick = vi.fn()
    renderMap({ results: RESULTS }, { onMarkerClick })
    fireLoad()
    const map = getMap()
    const popupsBefore = mockState.api._state.popups.length

    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/9001')
    act(() => {
      map.fire('click', 'point-circle', { features: [feature], lngLat: { lat: 34.68, lng: 135.48 } })
    })

    expect(onMarkerClick).toHaveBeenCalledTimes(1)
    const clicked = onMarkerClick.mock.calls[0][0]
    expect(clicked.id).toBe(9001)
    expect(mockState.api._state.popups.length).toBe(popupsBefore)
  })
})
