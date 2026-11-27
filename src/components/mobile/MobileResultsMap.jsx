import React, { useCallback, useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useApp } from '../../context/AppContext'
import { BASEMAP_STYLE } from '../../utils/mapStyle'
import {
  BF_LINE_LAYER_DEF,
  BF_NODE_LAYER_DEF,
  BF_WAY_ICON_LAYER_DEF
} from '../MapView'
import { barrierFreeToMapGeoJSON } from '../../utils/barrierFreeGeoJSON'
import { useDraggableHeight } from '../../hooks/useDraggableHeight'
import { getFacilityIcon, facilityIconUrl } from '../../utils/facilityIcon'

/**
 * (修正) モバイル「一覧」タブ上部の結果マップ。
 *
 * 検索成功後、モバイルは自動で一覧タブへ切り替わるため、検索タブの地図に
 * 戻らなくても検索結果の位置を確認できるようにする。バリアフリー検索でも
 * 自治体モード検索でも、一覧タブに結果マップが表示される。
 *
 * 特性:
 * - 自前の MapLibre マップを生成する（グローバルなマップレジストリ
 *   setMapInstance/getMapInstance には登録しない）。検索タブの地図と
 *   干渉しない。
 * - 操作可能（通常の MapLibre マップ）。ドラッグで移動し、ピンチ・
 *   ホイール・ダブルタップでズームできる。検索結果画面では地図を一覧の
 *   スクロール領域の外に置き、表示領域に収まるよう高さを制限する。
 * - kind='poi'      → 白い円の上に施設アイコンを表示（circle + symbol レイヤ）
 *   kind='barrier_free' → 歩道を線・縁石/案内信号を点として表示
 *   （MapView と同じレイヤ定義・色を使うため、見た目が一致する）
 *   (#73) ウェイの中点アイコン（bf-way-icon）も MapView と同様に表示し、
 *   線と同じ key なのでタップで同じウェイが選択される
 * - (アイコンピン) kind='poi': アイコン解決は施設カードと同じ getFacilityIcon /
 *   facilityIconUrl（utils/facilityIcon.js）。必要なアイコン画像のみを
 *   map.loadImage + map.addImage で読み込み・登録し、読込に成功したアイコンは
 *   施設アイコンで描画する。未解決・読込失敗の施設は青い点（MapView の
 *   POINT_LAYER_DEF と同じ見たみの circle レイヤ）で描画する。検索タブの地図
 *   （MapView）は従来どおり青い点のまま（アイコン化しない）。
 * - (修正) kind='poi': アイコン・円の背景・フォールバック点のタップで
 *   onMarkerClick(result) プロパティを呼び出す（feature の key（type/id）から
 *   結果を解決してコールバックに渡す）。一覧タブ側はこれを受け、対応する施設
 *   カードへスクロールして選択状態にする（詳細シートは開かない）。
 *   kind='barrier_free' の線・点も同じコールバックで対応カードへ移動する。
 * - 結果の範囲（extent）に fitBounds でカメラを合わせる。範囲が算出できない
 *   場合は前回の検索 bbox に合わせる。
 * - (修正) MobileShell は全タブを常時マウントし非活性タブに hidden を付けるため、
 *   この結果マップは display:none（幅・高さ0）のまま生成・load されることがある。
 *   その状態で fitBounds を呼ぶと 0サイズ前提でカメラが決まり、表示時に結果範囲
 *   と合わない。そのためコンテナのサイズを ResizeObserver で監視し、fitBounds は
 *   コンテナに実際の表示サイズ（幅・高さとも0より大）があるときだけ行う。隠れて
 *   いる間はソースへ setData だけ行いフィットを保留し、0サイズ→表示サイズへ遷移
 *   したとき（タブ表示・折りたたみ展開など）に map.resize() と保留フィットを実行
 *   する。表示サイズ同士の変化（高さドラッグ等）では resize() のみで再フィット
 *   しない。POI・バリアフリー両 kind で同じ挙動。
 *   （表示/非表示の既定は「表示」。実ブラウザでは ResizeObserver の初期コールバック
 *   が map の 'load' より前に必ず発火し、実際の表示状態を反映するため、非表示の
 *   まま生成・load された場合も 'load' 時点で非表示として正しく判定される。）
 * - kind は props で固定し、kind 変化時は親側がコンポーネントを
 *   再生成（remount）させることで、ソース/レイヤの入れ替えロジックを
 *   単純化する。
 * - 地図の高さを地図下のドラッグハンドルで変更できる（検索タブの地図と同じ
 *   useDraggableHeight）。範囲は160〜480px。既定の高さ・保存キーは kind で分ける:
 *   （heightStorageKey prop が指定されていればそれを優先する。メモ帳一覧の
 *   メモマップは mapHeight.memocho を使い、結果マップの高さと独立させる）:
 *   kind='poi' → 既定200px・キー mapHeight.results（従来どおり）
 *   kind='barrier_free' → 既定320px・キー mapHeight.resultsBf（POI地図のキーとは
 *   独立するため、POI側で小さくした高さがバリアフリー地図に引き継がれない）
 *   高さ変更は localStorage に保存され、再マウント時も読み戻す。ドラッグに合わせて
 *   map.resize() を呼ぶ。
 */

const POI_SOURCE_ID = 'results'
const BF_SOURCE_ID = 'barrier-free'
// MapView と同一のソースID（'results' / 'barrier-free'）を使い、
// レイヤ定義（MapView 由来）をそのまま再利用する

// 初期ソースの空データ（MapView の EMPTY_FC と同じ形状）
const EMPTY_FC = { type: 'FeatureCollection', features: [] }
// 初期カメラのデフォルト（MapView と同じ: 大阪・デフォルトズーム）
const DEFAULT_CENTER = [135.5023, 34.6937]
const DEFAULT_ZOOM = 12

// 通常はズーム16まで。近接した検索結果がある場合は最大19まで拡大を許す。
const FIT_OPTIONS = { padding: 24, maxZoom: 16, duration: 0 }
const MAX_DENSE_ZOOM = 19
const SELECTED_POI_MIN_ZOOM = 17
const MARKER_DIAMETER_PX = 44
const WORLD_SIZE_AT_FIT_ZOOM = 512 * 2 ** FIT_OPTIONS.maxZoom

// 結果マップの高さの保存キー（検索タブの mapHeight.mobile とは独立）
const RESULTS_MAP_HEIGHT_KEY = 'mapHeight.results'
// (修正) バリアフリー結果マップ専用の高さ保存キー（POI地図のキーとは独立）
const BF_RESULTS_MAP_HEIGHT_KEY = 'mapHeight.resultsBf'

const HAS_POI_ICON = ['!=', ['get', 'icon'], '']

// コミュニティマップメーカーと同じく、施設アイコンの下に白い円を重ねる。
const POI_BACKGROUND_LAYER_DEF = {
  id: 'poi-background',
  type: 'circle',
  source: POI_SOURCE_ID,
  filter: HAS_POI_ICON,
  paint: {
    'circle-radius': ['step', ['zoom'], 14, 16, 17, 17, 20],
    'circle-color': '#ffffff',
    'circle-stroke-color': '#bfbfe1',
    'circle-stroke-width': 2,
  },
}

// (アイコンピン) properties.icon が空でない（= 画像の登録に成功した）機能を
// 施設アイコンで描画する。アイコン画像は buildPoiIconGeoJSON が
// map.loadImage + map.addImage で読み込み・登録する（アイコンの出典は
// facilityIcon.js のコメントを参照）。
const POI_ICON_LAYER_DEF = {
  id: 'poi-icon',
  type: 'symbol',
  source: POI_SOURCE_ID,
  filter: HAS_POI_ICON,
  layout: {
    'icon-image': ['get', 'icon'],
    'icon-size': ['step', ['zoom'], 0.25, 16, 0.3125, 17, 0.375],
    'icon-allow-overlap': true,
  },
}

// (フォールバック) properties.icon が空（= アイコン未解決・画像読込失敗）の
// 機能を青い点として描画する。検索タブの点レイヤ（MapView の POINT_LAYER_DEF）
// と同じ見た目で、従来から結果マップに表示されていた点を引き継ぐ。
const POI_FALLBACK_LAYER_DEF = {
  id: 'poi-fallback',
  type: 'circle',
  source: POI_SOURCE_ID,
  filter: ['==', ['get', 'icon'], ''],
  paint: {
    'circle-radius': 6,
    'circle-color': '#2563eb',
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
}

// 選択中の背景とアイコンを通常のピンより手前に重ねる。
const SELECTED_POI_BACKGROUND = {
  ...POI_BACKGROUND_LAYER_DEF,
  id: 'poi-selected-background',
  paint: {
    ...POI_BACKGROUND_LAYER_DEF.paint,
    'circle-color': '#93c5fd',
    'circle-stroke-color': '#2563eb',
  },
}
const SELECTED_POI_ICON = { ...POI_ICON_LAYER_DEF, id: 'poi-selected-icon' }
const SELECTED_BF_LINE = {
  ...BF_LINE_LAYER_DEF,
  id: 'bf-selected-line',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#2563eb', 'line-width': 8 },
}
const SELECTED_BF_NODE = {
  ...BF_NODE_LAYER_DEF,
  id: 'bf-selected-node',
  paint: {
    'circle-radius': 9,
    'circle-color': '#93c5fd',
    'circle-stroke-color': '#2563eb',
    'circle-stroke-width': 2,
  },
}
const SELECTED_BF_WAY_ICON = {
  ...BF_WAY_ICON_LAYER_DEF,
  id: 'bf-selected-way-icon',
  paint: {
    'circle-radius': 9,
    'circle-color': '#93c5fd',
    'circle-stroke-color': '#2563eb',
    'circle-stroke-width': 2,
  },
}

function selectedKeyFilter(selection) {
  return ['==', ['get', 'key'], selection?.key ?? '']
}

function focusSelection(map, selection) {
  const geometry = selection?.geometry
  if (geometry?.type === 'LineString') {
    const extent = extentOfGeoJSON({ features: [{ geometry }] })
    if (extent) {
      map.fitBounds([[extent.west, extent.south], [extent.east, extent.north]], {
        padding: 24, maxZoom: 18, duration: 350
      })
    }
    return
  }
  const [lon, lat] = geometry?.coordinates ?? [selection?.lon, selection?.lat]
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
  map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), SELECTED_POI_MIN_ZOOM) })
}

// (修正) maplibre-gl v6 の map.loadImage(url) は Promise 専用API
// （旧バージョンの loadImage(url, cb) コールバック形式は廃止）。戻り値は
// { data } 形で、data が HTMLImageElement | ImageBitmap
const loadImageAsync = async (map, url) => {
  const res = await map.loadImage(url)
  return res.data
}

/**
 * (アイコンピン) 結果バッチに必要なアイコンをマップへ登録し、各機能に
 * properties.icon（登録成功=アイコン名 / 失敗=空文字）を付けた GeoJSON を作る。
 *
 * - アイコン解決は getFacilityIcon（施設カードと同じロジック・未対応は
 *   フォールバックアイコン）
 * - 読み込み中の Promise をキャッシュし、連続で絞り込んでも同じ画像の登録を1回にする。
 */
async function buildPoiIconGeoJSON(map, results, iconLoads) {
  const rs = (Array.isArray(results) ? results : [])
    .filter((r) => !r.bf && r.lat != null && r.lon != null)
  if (rs.length === 0) return { type: 'FeatureCollection', features: [] }

  const icons = [...new Set(rs.map((r) => getFacilityIcon(r.tags || {})))]
  const statuses = await Promise.all(icons.map((icon) => {
    if (!iconLoads.has(icon)) {
      const loading = loadImageAsync(map, facilityIconUrl(icon)).then((image) => {
        // 縦長・横長の画像も長辺を基準に縮め、円の内側に収める。
        const pixelRatio = Math.max(1, image.width / 64, image.height / 64)
        map.addImage(icon, image, { pixelRatio })
        return true
      }).catch(() => false)
      iconLoads.set(icon, loading)
    }
    return iconLoads.get(icon)
  }))
  const loadedIcons = new Set(icons.filter((_, index) => statuses[index]))

  return {
    type: 'FeatureCollection',
    features: rs.map((r) => {
      const icon = getFacilityIcon(r.tags || {})
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: {
          type: r.type,
          id: r.id,
          key: `${r.type}/${r.id}`,
          name: r.name || null,
          icon: loadedIcons.has(icon) ? icon : '',
        },
      }
    }),
  }
}

/**
 * GeoJSON FeatureCollection の範囲（BBOX）を算出する。
 * 使用可能な座標が1つもなければ null。
 * 単一点のみだった場合は fitBounds がズームを算出できるよう
 * ごく狭い範囲に拡張する。
 */
function extentOfGeoJSON(fc) {
  let west = 180
  let south = 90
  let east = -180
  let north = -90
  let found = false

  const consider = (coord) => {
    const lon = coord && coord[0]
    const lat = coord && coord[1]
    if (typeof lon !== 'number' || typeof lat !== 'number') return
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
    found = true
  }

  for (const f of (fc && fc.features) || []) {
    const g = f && f.geometry
    if (!g) continue
    if (g.type === 'Point') consider(g.coordinates)
    else if (g.type === 'LineString') for (const c of g.coordinates) consider(c)
    else if (g.type === 'Polygon') for (const c of (g.coordinates && g.coordinates[0]) || []) consider(c)
  }

  if (!found) return null
  if (west === east && south === north) {
    const d = 0.0005
    west -= d
    east += d
    south -= d
    north += d
  }
  return { west, south, east, north }
}

function poiFitOptions(features) {
  if (features.length < 2) return FIT_OPTIONS
  // ズーム16で円の直径より近いピンを、周辺のマスだけ調べて検出する。
  // 同じ座標のピンはズームを上げても離れないので計算から除く。
  const cells = new Map()
  const seen = new Set()
  const minDistance = MARKER_DIAMETER_PX / 2 ** (MAX_DENSE_ZOOM - FIT_OPTIONS.maxZoom)
  let closest = MARKER_DIAMETER_PX
  for (const { geometry: { coordinates } } of features) {
    const [lon, lat] = coordinates
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) >= 90) continue
    const id = coordinates.join(',')
    if (seen.has(id)) continue
    seen.add(id)

    const x = (lon / 360) * WORLD_SIZE_AT_FIT_ZOOM
    const y = Math.asinh(Math.tan(lat * Math.PI / 180)) * WORLD_SIZE_AT_FIT_ZOOM / (2 * Math.PI)
    const col = Math.floor(x / MARKER_DIAMETER_PX)
    const row = Math.floor(y / MARKER_DIAMETER_PX)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const point of cells.get(`${col + dx},${row + dy}`) ?? []) {
          closest = Math.min(closest, Math.hypot(x - point.x, y - point.y))
          if (closest <= minDistance) return { ...FIT_OPTIONS, maxZoom: MAX_DENSE_ZOOM }
        }
      }
    }
    const cell = `${col},${row}`
    if (!cells.has(cell)) cells.set(cell, [])
    cells.get(cell).push({ x, y })
  }
  return { ...FIT_OPTIONS, maxZoom: FIT_OPTIONS.maxZoom + Math.log2(MARKER_DIAMETER_PX / closest) }
}

export default function MobileResultsMap({ kind = 'poi', onMarkerClick = null, onMapReady = null, selection = null, results = null, fitPoiDensity = results === null, bbox = null, heightStorageKey = null }) {
  const { state } = useApp()
  // 検索結果の絞り込み後のデータやメモ帳のデータが渡されていれば優先する。
  const poiResults = results ?? (state.results || [])
  const poiBbox = bbox ?? state.bbox
  const adjustPoiZoom = kind === 'poi' && fitPoiDensity
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const loadedRef = useRef(false)
  // 'load' が非同期で遅れて発火しても、その時点の最新結果を使うよう保持
  const latestRef = useRef({ results, bbox })
  // コンテナが現在表示されているか。既定は true（表示）。jsdom ではレイアウトが
  // 計算されずサイズ信号が常に 0 になるため、実ブラウザでは ResizeObserver の
  // 初期コールバック（map の 'load' より前に必ず発火する）で実際の表示/非表示を
  // 反映する。非表示（display:none・幅高さ0）の間は fitBounds せず保留する。
  const visibleRef = useRef(true)
  // 隠れている間に保留した表示範囲とズーム設定。
  const pendingFitRef = useRef(null)
  // マップごとのアイコン読込 Promise（アイコン名 → 登録に成功したか）。
  const iconLoadsRef = useRef(new Map())
  // (アイコンピン) applyData の実行番号。非同期のアイコン読込中に新しい
  // applyData が始まったら、古い方の setData をスキップする
  const applySeqRef = useRef(0)

  // 地図の高さをドラッグで変更（範囲160〜480px）。既定の高さと保存キーは
  // kind で分ける: poi → 既定200px・mapHeight.results / barrier_free →
  // 既定320px・mapHeight.resultsBf。保存値が localStorage にあればそれを
  // 初期値として使う（フックの既存挙動）。高さ変更に合わせて map.resize() を
  // 呼ぶことで、MapLibre の描画がドラッグに追随する
  const handleMapResize = () => {
    const map = mapRef.current
    if (map && typeof map.resize === 'function') map.resize()
  }
  const isBarrierFree = kind === 'barrier_free'
  const mapHeight = useDraggableHeight({
    defaultHeight: isBarrierFree ? 320 : 200,
    minHeight: 160,
    maxHeight: 480,
    storageKey: heightStorageKey || (isBarrierFree ? BF_RESULTS_MAP_HEIGHT_KEY : RESULTS_MAP_HEIGHT_KEY),
    getRenderedHeight: () => containerRef.current?.clientHeight,
    onResize: handleMapResize
  })

  useEffect(() => {
    latestRef.current = { results: poiResults, bbox: poiBbox }
  }, [poiResults, poiBbox])

  // (修正) onMarkerClick の最新値。イベントハンドラは地図生成時に一度だけ
  // 登録されるため、旧クロージャを防ぐために ref 経由で読む（MapView と同様）
  const onMarkerClickRef = useRef(onMarkerClick)
  useEffect(() => { onMarkerClickRef.current = onMarkerClick }, [onMarkerClick])

  const selectionRef = useRef(selection)
  useEffect(() => {
    selectionRef.current = selection
    if (!loadedRef.current) return
    const map = mapRef.current
    const filter = selectedKeyFilter(selection)
    if (kind === 'barrier_free') {
      map.setFilter(SELECTED_BF_LINE.id, ['all', SELECTED_BF_LINE.filter, filter])
      map.setFilter(SELECTED_BF_NODE.id, ['all', SELECTED_BF_NODE.filter, filter])
      map.setFilter(SELECTED_BF_WAY_ICON.id, ['all', SELECTED_BF_WAY_ICON.filter, filter])
    } else {
      map.setFilter(SELECTED_POI_BACKGROUND.id, filter)
      map.setFilter(SELECTED_POI_ICON.id, ['all', HAS_POI_ICON, filter])
    }
    if (visibleRef.current) focusSelection(map, selection)
  }, [kind, selection])

  // 最新の結果をソースに反映し、結果範囲にカメラを合わせる
  // (修正) fitBounds はコンテナに実際の表示サイズがあるときだけ行う。
  // 隠れている（幅・高さ0）間はソースへ setData だけ行いフィットを保留する。
  const applyData = useCallback(async () => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const seq = ++applySeqRef.current
    const { results: rs, bbox: bb } = latestRef.current
    const sourceId = kind === 'barrier_free' ? BF_SOURCE_ID : POI_SOURCE_ID
    // (アイコンピン) POI はアイコン画像の読み込み・登録を経て GeoJSON を作る
    // （非同期）。バリアフリーは従来どおり
    const fc = kind === 'barrier_free'
      ? barrierFreeToMapGeoJSON(rs)
      : await buildPoiIconGeoJSON(map, rs, iconLoadsRef.current)
    if (seq !== applySeqRef.current || map !== mapRef.current) return
    const source = map.getSource(sourceId)
    if (source) source.setData(fc)

    // fitBounds の対象範囲（結果の extent、算出不能なら state.bbox）
    const ext = extentOfGeoJSON(fc)
    let target = null
    if (ext) {
      target = [[ext.west, ext.south], [ext.east, ext.north]]
    } else if (bb) {
      target = [[bb.west, bb.south], [bb.east, bb.north]]
    }

    const fitOptions = adjustPoiZoom ? poiFitOptions(fc.features) : FIT_OPTIONS
    if (target && visibleRef.current) {
      map.fitBounds(target, fitOptions)
      focusSelection(map, selectionRef.current)
      pendingFitRef.current = null
    } else {
      pendingFitRef.current = target ? { target, fitOptions } : null
    }
  }, [kind, adjustPoiZoom])

  // マップ生成（kind 変化時は remount されるため、ここでは kind ごとに
  // 必要なソース/レイヤだけを作る）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const map = new maplibregl.Map({
      container: el,
      style: BASEMAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      // 平面地図のため pitch を常に0に固定（回転での連動ピッチも無効化）
      maxPitch: 0,
      pitchWithRotate: false
    })
    // タイル規約の表示義務を満足するため compact 表記制御を付ける
    map.addControl(new maplibregl.AttributionControl({ compact: true }))
    mapRef.current = map
    loadedRef.current = false
    // (アイコンピン) 新マップのためアイコン読込状態を初期化（旧マップで登録した
    // 画像は新マップには存在しないため、再読込が必要）
    iconLoadsRef.current = new Map()

    map.on('load', () => {
      loadedRef.current = true
      onMapReady?.(map)
      const filter = selectedKeyFilter(selectionRef.current)
      let clickableLayers
      if (kind === 'barrier_free') {
        map.addSource(BF_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
        map.addLayer(BF_LINE_LAYER_DEF)
        map.addLayer(BF_NODE_LAYER_DEF)
        map.addLayer(BF_WAY_ICON_LAYER_DEF)
        map.addLayer({ ...SELECTED_BF_LINE, filter: ['all', SELECTED_BF_LINE.filter, filter] })
        map.addLayer({ ...SELECTED_BF_NODE, filter: ['all', SELECTED_BF_NODE.filter, filter] })
        map.addLayer({ ...SELECTED_BF_WAY_ICON, filter: ['all', SELECTED_BF_WAY_ICON.filter, filter] })
        clickableLayers = [BF_LINE_LAYER_DEF.id, BF_NODE_LAYER_DEF.id, BF_WAY_ICON_LAYER_DEF.id, SELECTED_BF_LINE.id, SELECTED_BF_NODE.id, SELECTED_BF_WAY_ICON.id]
      } else {
        map.addSource(POI_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
        map.addLayer(POI_BACKGROUND_LAYER_DEF)
        map.addLayer(POI_ICON_LAYER_DEF)
        map.addLayer(POI_FALLBACK_LAYER_DEF)
        map.addLayer({ ...SELECTED_POI_BACKGROUND, filter })
        map.addLayer({ ...SELECTED_POI_ICON, filter: ['all', HAS_POI_ICON, filter] })
        clickableLayers = [
          POI_ICON_LAYER_DEF.id, POI_BACKGROUND_LAYER_DEF.id, POI_FALLBACK_LAYER_DEF.id,
          SELECTED_POI_BACKGROUND.id, SELECTED_POI_ICON.id
        ]
      }
      // 重なったレイヤをタップしても選択は1回にする。
      map.on('click', clickableLayers, (event) => {
        const key = event.features?.[0]?.properties?.key
        if (!key) return
        const result = latestRef.current.results.find((r) => `${r.type}/${r.id}` === key)
        if (result) onMarkerClickRef.current?.(result)
      })
      applyData()
    })

    // (修正) コンテナサイズを ResizeObserver で監視する。
    // 隠れたまま（幅・高さ0）生成・load された地図は、表示復帰時に
    // resize() しないと古い 0サイズ前提の描画・カメラのままになる。そのため:
    //   - 0サイズ→表示サイズ への遷移（タブ表示・折りたたみ展開）: map.resize()
    //     ＋ 保留中のフィット（applyData が保留した結果範囲への fitBounds）を実行
    //   - 表示サイズ同士の変化（高さドラッグ等）: map.resize() のみ（再フィットしない）
    // ResizeObserver が利用できない環境（旧ブラウザ・jsdom など）では監視しない。
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        const w = entry.contentRect.width
        const h = entry.contentRect.height
        const isVisible = w > 0 && h > 0
        const wasVisible = visibleRef.current
        visibleRef.current = isVisible

        const m = mapRef.current
        if (!m || !loadedRef.current) return // 未ロード時は表示状態の更新のみ
        if (isVisible && !wasVisible) {
          // 0サイズ→表示 遷移: 再描画 ＋ 保留フィットの実行
          m.resize()
          if (pendingFitRef.current) {
            const { target, fitOptions } = pendingFitRef.current
            m.fitBounds(target, fitOptions)
            focusSelection(m, selectionRef.current)
            pendingFitRef.current = null
          }
        } else if (isVisible && wasVisible) {
          // 表示サイズ同士（高さドラッグ等）: resize のみ（再フィットしない）
          m.resize()
        }
      })
      ro.observe(el)
    }

    return () => {
      if (ro) ro.disconnect()
      onMapReady?.(null)
      map.remove()
      mapRef.current = null
      loadedRef.current = false
    }
    // kind は props 固定（親が kind 変化時に remount させる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // 結果変化（再検索・フィルタ変更など）時はソース更新 + 範囲に再配置
  useEffect(() => {
    applyData()
  }, [poiResults, poiBbox, applyData])

  const label = kind === 'barrier_free' ? 'バリアフリー要素マップ' : '検索結果マップ'
  // ラウンド枠（rounded-lg）は地図+ハンドルの外側wrapperに持ち、
  // 地図コンテナは既定高さクラス（poi: h-[200px] / barrier_free: h-[320px]）のまま
  // （ドラッグ後はstyle上書き）
  return (
    <div className="results-map rounded-lg overflow-hidden border border-slate-200">
      <div
        ref={containerRef}
        role="application"
        aria-label={label}
        className={`results-map-canvas bg-slate-100 ${isBarrierFree ? 'h-[320px]' : 'h-[200px]'}`}
        style={{ ...mapHeight.containerStyle, maxHeight: 'var(--results-map-max-height, none)' }}
      />
      {/* 高さドラッグハンドル（検索タブの地図と同一のフック・見た目） */}
      <div
        {...mapHeight.handleProps}
        className="results-map-height-handle h-7 bg-slate-100 border-t border-slate-200 flex items-center justify-center"
      >
        <span className="w-8 h-1 rounded-full bg-slate-300" />
      </div>
    </div>
  )
}
