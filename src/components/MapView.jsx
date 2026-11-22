import React, { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useApp } from '../context/AppContext'
import { setMapInstance } from '../hooks/useMapRef'
import { isValidBbox } from '../utils/searchBbox'
import { BASEMAP_STYLE } from '../utils/mapStyle'
import { wheelchairBadge } from '../utils/accessibility'
import { buildOsmElementUrl } from '../utils/editLinks'
import { barrierFreeToMapGeoJSON, TACTILE_LINE_COLORS, NODE_ROLE_COLORS, CROSSING_COLOR } from '../utils/barrierFreeGeoJSON'
import { barrierFreeLabel } from '../utils/barrierFree'

// Default center: Osaka, Japan（MapLibreは[経度, 緯度]順）
const DEFAULT_CENTER = [135.5023, 34.6937]
const DEFAULT_ZOOM = 13

// 結果マーカー用のGeoJSONソース・レイヤID
const RESULTS_SOURCE = 'results'
const POINT_LAYER = 'point-circle'
const CLUSTERS_LAYER = 'clusters'
const CLUSTER_COUNT_LAYER = 'cluster-count'

// (#62) バリアフリー結果用のソース・レイヤID（第4ピース）
// 既存のクラスタリングソース（cluster: true）は点のみをクラスタするため、
// way の線描画には別途 cluster 無効のソースを使う。
const BF_SOURCE = 'barrier-free'
const BF_LINE_LAYER = 'bf-line'
const BF_NODE_LAYER = 'bf-node'

// 空のFeatureCollection（ソースのデータクリア用。共有して再利用する）
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// (Task 1) 既存の「500件上限」をネイティブクラスタリングに置き換え。
// superclusterベースのクラスタは全件を扱えるため上限・警告バナーは不要。
const CLUSTER_RADIUS = 45
const CLUSTER_MAX_ZOOM = 13

// MapLibreスタイル仕様に準拠したレイヤ定義。
// - paint/layoutプロパティはkebab-caseで、それぞれ paint: / layout: オブジェクト内に書く。
// - レイヤのトップレベルに置いたcamelCaseプロパティ（circleRadius等）はMapLibreが
//   検証も適用もせず無言で無視するため、必ずnestingが必要。
// - symbolの text-field/text-font/text-size はMapLibre仕様のlayoutプロパティ
//   （Mapboxではpaint側だがMapLibreで分類が異なる）。
// 回帰テスト: src/components/__tests__/mapViewLayerDefs.test.js
export const POINT_LAYER_DEF = {
  id: POINT_LAYER,
  type: 'circle',
  source: RESULTS_SOURCE,
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-radius': 6,
    'circle-color': '#2563eb',
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff'
  }
}

export const CLUSTERS_LAYER_DEF = {
  id: CLUSTERS_LAYER,
  type: 'circle',
  source: RESULTS_SOURCE,
  filter: ['has', 'point_count'],
  paint: {
    'circle-radius': ['step', ['get', 'point_count'], 12, 4, 16, 16, 20, 24, 32],
    'circle-color': '#f59e0b',
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff'
  }
}

export const CLUSTER_COUNT_LAYER_DEF = {
  id: CLUSTER_COUNT_LAYER,
  type: 'symbol',
  source: RESULTS_SOURCE,
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count'],
    'text-font': ['Noto Sans Regular'],
    'text-size': 12,
    'text-anchor': 'center'
  },
  paint: {
    'text-color': '#ffffff'
  }
}

// (#62) バリアフリー結果のレイヤ定義（第4ピース）。
// 色は barrierFreeGeoJSON.js の定数を使う（凡例 BarrierFreeLegend と同一）。
// - bf-line: way を線描画。色は点字ブロックの登録状態（tactile）で分ける。
//   way の近似中心点（頂点平均）はマーカーとしては描画しない。
// - bf-node: node を点描画。色は役割（role: signal / kerb / kerb+signal）で分ける。
export const BF_LINE_LAYER_DEF = {
  id: BF_LINE_LAYER,
  type: 'line',
  source: BF_SOURCE,
  filter: ['==', ['get', 'kind'], 'way'],
  paint: {
    'line-color': ['case', ['==', ['get', 'crossing'], true], CROSSING_COLOR,
      ['match', ['get', 'tactile'],
        'yes', TACTILE_LINE_COLORS.yes,
        'no', TACTILE_LINE_COLORS.no,
        TACTILE_LINE_COLORS.unknown]],
    'line-width': 4,
    'line-opacity': 0.9
  }
}

export const BF_NODE_LAYER_DEF = {
  id: BF_NODE_LAYER,
  type: 'circle',
  source: BF_SOURCE,
  filter: ['==', ['get', 'kind'], 'node'],
  paint: {
    'circle-radius': 6,
    'circle-color': ['match', ['get', 'role'],
      'signal', NODE_ROLE_COLORS.signal,
      'kerb', NODE_ROLE_COLORS.kerb,
      'kerb+signal', NODE_ROLE_COLORS['kerb+signal'],
      'crossing', NODE_ROLE_COLORS.crossing,
      NODE_ROLE_COLORS.other],
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff'
  }
}

// (#xx) 検索範囲矩形（BBOXオーバーレイ）— 確定した検索範囲を地図上に矩形で描画
const BBOX_OVERLAY_SOURCE = 'bbox-overlay'
const BBOX_OVERLAY_LAYER = 'bbox-overlay-line'

// bbox({south, west, north, east}) → 閉じた矩形LineString（[経度, 緯度]順）
export function bboxToOverlayGeoJSON(bbox) {
  const { south, west, north, east } = bbox
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south]
        ]
      },
      properties: {}
    }]
  }
}

// bbox → MapLibre fitBounds の引数形式（[[west, south], [east, north]]）
export function bboxToFitBounds(bbox) {
  return [[bbox.west, bbox.south], [bbox.east, bbox.north]]
}

// bbox の同一性を判定するキー（fitBoundsの再実行防止・ソース維持判定用）
const bboxKey = (bbox) => `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`

// 確定場所（地名入力・自治体選択）で fitBounds を実行する bboxSource
const FIT_BBOX_SOURCES = ['geocode', 'municipality']

// 検索範囲矩形レイヤ（青 #2563eb・実線）
export const BBOX_OVERLAY_LAYER_DEF = {
  id: BBOX_OVERLAY_LAYER,
  type: 'line',
  source: BBOX_OVERLAY_SOURCE,
  paint: {
    'line-color': '#2563eb',
    'line-width': 2.5,
    'line-opacity': 0.9
  }
}

/**
 * 結果マーカーのポップアップ内容をDOMノードで構築する（#38）。
 * setHTMLにタグ由来文字列を渡さず、全テキストはtextContentで設定する。
 * リンク（OSM/iD）はURL生成関数から生成する安全な<a>要素のみ。
 */
function buildPopupElement(result) {
  const root = document.createElement('div')
  root.className = 'map-popup-root'

  const nameEl = document.createElement('div')
  nameEl.className = 'map-popup-name'
  nameEl.textContent = result.name || '（名称不明）'
  root.appendChild(nameEl)

  const metaEl = document.createElement('div')
  metaEl.className = 'map-popup-meta'
  metaEl.textContent = `${result.type} / ID: ${result.id}`
  root.appendChild(metaEl)

  const wc = wheelchairBadge(result.tags)
  if (wc) {
    const wcEl = document.createElement('div')
    wcEl.className = 'map-popup-wc'
    wcEl.textContent = wc.text.startsWith('♿') ? wc.text : `♿ ${wc.text}`
    root.appendChild(wcEl)
  }

  const linkRow = document.createElement('div')
  linkRow.className = 'map-popup-links'
  const osmLink = document.createElement('a')
  osmLink.href = buildOsmElementUrl(result)
  osmLink.target = '_blank'
  osmLink.rel = 'noopener'
  osmLink.className = 'map-popup-link'
  osmLink.textContent = '🔗 OSMで開く'
  linkRow.appendChild(osmLink)
  root.appendChild(linkRow)

  // 主要タグ（name系・wheelchairを除く）を最大3件
  const keyTags = Object.entries(result.tags || {})
    .filter(([k]) => k !== 'name' && k !== 'name:ja' && k !== 'wheelchair')
    .slice(0, 3)
  for (const [k, v] of keyTags) {
    const tagEl = document.createElement('div')
    tagEl.className = 'map-popup-tag'
    tagEl.textContent = `${k}: ${v}`
    root.appendChild(tagEl)
  }

  return root
}

/**
 * 検索結果をクラスタリング用GeoJSONに変換する
 * (#62 第4ピース) bf 付きの項目（バリアフリー結果）は除外する:
 * 歩道ウェイの近似中心点が青い点として表示されるのを防ぐため。
 * 施設検索（bf なし）の表示は従来どおり。
 */
export function resultsToGeoJSON(results) {
  return {
    type: 'FeatureCollection',
    features: (Array.isArray(results) ? results : [])
      .filter((r) => !r.bf && r.lat != null && r.lon != null)
      .map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: {
          type: r.type,
          id: r.id,
          key: `${r.type}/${r.id}`,
          name: r.name || null
        }
      }))
  }
}

/**
 * 地図コンポーネント（MapLibre GL版）
 *
 * 設計方針 (#29 + #41 + Task 2):
 * - state.bbox は「前回検索に使用したBBOX」であり、地図のpan/zoomでは更新されない
 * - (#41) 検索範囲は「検索する」押下時点の地図表示範囲（getBounds）で決定される
 * - (Task 2) 検索実行（useSearch の SET_BBOX）だけでカメラ位置・ズームを
 *   変更しない。カメラfitは確定場所（bboxSource: geocode/municipality）の
 *   確定時と、URL復元由来（bboxSource='url'）の初回適用時のみ。
 * - (#xx) 検索範囲矩形（BBOXオーバーレイ）: 確定場所（bboxSource:
 *   geocode/municipality）の bbox に対し青（#2563eb）の矩形を地図上に描画する。
 *   入力クリア・別範囲の確定で消える。検索由来（source='search'）・URL由来
 *   （source='url'）の bbox には矩形を描画しない。
 * - マーカーはネイティブクラスタリング（MapLibreのcluster、supercluster不要）で表示
 * - (#38) ポップアップはtextContentベースのDOMノードのみ（setHTML禁止）
 * - (#60) コンテナサイズ変化でmap.resize()（hidden→表示復帰時のタイル再描画）
 */
/**
 * @param {{center:[number,number], zoom:number}|null} [initialCamera=null]
 *   (#63) 再マウント時の初期カメラ（[経度, 緯度]順）。モバイル検索タブで
 *   トップ⇄フォーム切替時に地図が再マウントされるため、前の表示範囲を
 *   引き継ぐのに使う（URL復元bboxのfitBoundsは従来どおり優先される）。
 */
function MapView({ onMarkerClick = null, onMarkerTap = null, initialCamera = null }) {
  const containerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const loadedRef = useRef(false)
  const popupRef = useRef(null)
  const highlightMarkerRef = useRef(null)
  // (#41-1 / Task 2) URL復元bboxの初回fitフラグ（一度きり）
  const hasFitInitialBboxRef = useRef(false)
  // (#xx) 確定場所fit: 既にfit済みbboxのキー（同一bboxの再fit防止）
  const fittedBboxKeyRef = useRef(null)
  // (#xx) 確定場所fitの保留中bbox（コンテナ非表示（サイズ0）時に設定し、
  // 表示復帰（resize）時に適用）
  const pendingBboxFitRef = useRef(null)
  // (#xx) オーバーレイ矩形の同期済みbboxキー（同一範囲の重複setData防止）
  const overlayKeyRef = useRef(null)
  // (#60) アクティブ結果のハイライトマーカー
  const { state } = useApp()
  const { results, activeResultId, resultKind } = state

  // (#47) 最新のstateを常に読むためのref（イベントハンドラで旧stateを防ぐ）
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })
  const onMarkerClickRef = useRef(onMarkerClick)
  useEffect(() => { onMarkerClickRef.current = onMarkerClick })
  const onMarkerTapRef = useRef(onMarkerTap)
  useEffect(() => { onMarkerTapRef.current = onMarkerTap })

  // results/activeResultId の最新値（loadイベント内で使用する）
  const resultsRef = useRef(results)
  useEffect(() => { resultsRef.current = results })
  const activeResultIdRef = useRef(activeResultId)
  useEffect(() => { activeResultIdRef.current = activeResultId })

  // (#62) 結果データの地図反映（第4ピース）。
  // 注: maplibre-glのMapにはMap.setGeoJSON()がない（mapbox-gl由来のAPI）。
  // 正しいAPIは getSource(id).setData(geojson) である。
  // バリアフリー検索（resultKind='barrier_free'）の結果は専用ソース
  // （'barrier-free'、線+点）へ、POI検索の結果は既存のクラスタリングソース
  // （'results'）へ反映する。切り替わりで片側のデータを空にする。
  // setDataの順序は「先に旧データをクリア→後に新データを設定」とし、
  // 最終 setData が現在の表示対象になるようにする（モックの_lastGeoJSON参照用）。
  const syncData = () => {
    const map = mapInstanceRef.current
    if (!map || !loadedRef.current) return
    const s = stateRef.current
    const isBf = s.resultKind === 'barrier_free'
    const resultsSource = map.getSource(RESULTS_SOURCE)

    if (isBf) {
      setupBfLayers(map)
      if (resultsSource) resultsSource.setData(EMPTY_FC)
      const bfSource = map.getSource(BF_SOURCE)
      if (bfSource) bfSource.setData(barrierFreeToMapGeoJSON(s.results))
    } else {
      if (map.getSource(BF_SOURCE)) removeBfLayers(map)
      if (resultsSource) resultsSource.setData(resultsToGeoJSON(s.results))
    }
  }

  // (#60) アクティブ結果のハイライトマーカー管理
  const syncHighlight = () => {
    const map = mapInstanceRef.current
    if (!map || !loadedRef.current) return

    const activeId = activeResultIdRef.current
    const active = activeId
      ? resultsRef.current.find((r) => `${r.type}/${r.id}` === activeId)
      : null
    const valid = active && active.lat != null && active.lon != null

    if (!valid) {
      if (highlightMarkerRef.current) {
        highlightMarkerRef.current.remove()
        highlightMarkerRef.current = null
      }
      return
    }

    const lngLat = [active.lon, active.lat]
    if (!highlightMarkerRef.current) {
      const el = document.createElement('div')
      el.className = 'map-highlight-marker'
      const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat)
      // (#38) 名称はsetText（プレーンテキスト）
      marker.setPopup(new maplibregl.Popup({ offset: 14 }).setText(active.name || '選択中の施設'))
      marker.addTo(map)
      highlightMarkerRef.current = marker
    } else {
      highlightMarkerRef.current.setLngLat(lngLat)
    }
  }

  // (#xx) 確定場所かどうか（入力・選択で確定した geocode/municipality 由来のみ）。
  // 検索実行（source='search'）・URL復元（source='url'）の bbox は「確定場所」では
  // なく、矩形を描画しない（地図移動・検索のたびに矩形が出入りしないための
  // 区分け。モックの _lastGeoJSON 上書き回避にも寄与する）。
  const isConfirmedBbox = (s) =>
    !!s.bbox && isValidBbox(s.bbox) &&
    (s.bboxSource === 'geocode' || s.bboxSource === 'municipality')

  // (#xx) 検索範囲矩形オーバーレイを確定場所（state.bbox）と同期する。
  // 確定場所（geocode/municipality）: 青（#2563eb）の矩形を描画
  //   （ソース・レイヤ未作成なら作成）。
  // それ以外（検索由来・URL由来・null・無効）: 矩形を描画しない。
  //   既存のオーバーレイがあれば削除する（入力クリア・範囲変更時）。
  const syncBboxOverlay = () => {
    const map = mapInstanceRef.current
    if (!map || !loadedRef.current) return
    const s = stateRef.current
    if (isConfirmedBbox(s)) {
      if (!map.getSource(BBOX_OVERLAY_SOURCE)) {
        map.addSource(BBOX_OVERLAY_SOURCE, { type: 'geojson', data: EMPTY_FC })
        map.addLayer(BBOX_OVERLAY_LAYER_DEF)
      }
      map.getSource(BBOX_OVERLAY_SOURCE).setData(bboxToOverlayGeoJSON(s.bbox))
    } else if (map.getSource(BBOX_OVERLAY_SOURCE)) {
      map.removeLayer(BBOX_OVERLAY_LAYER)
      map.removeSource(BBOX_OVERLAY_SOURCE)
    }
  }

  // (#xx) 確定場所bboxにカメラをfitBoundsする（fit済み記録を更新）
  const applyBboxFit = (map, bbox) => {
    map.fitBounds(bboxToFitBounds(bbox), { padding: 40, maxZoom: 17, duration: 800 })
    fittedBboxKeyRef.current = bboxKey(bbox)
  }

  // 結果マーカー（点レイヤ）のクリック処理。
  // POINT_LAYER（POI）と BF_NODE_LAYER（バリアフリーノード）で共有する。
  const makeFeatureClickHandler = (map) => (e) => {
    const key = e.features?.[0]?.properties?.key
    if (!key) return
    const result = stateRef.current.results.find((r) => `${r.type}/${r.id}` === key)
    if (!result) return

    // POI説明枠への通知（ポップアップと並行して呼び出す）
    if (onMarkerTapRef.current) {
      onMarkerTapRef.current(result)
    }

    const closePopup = () => {
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
    }

    // (#59) モバイル: マーカータップで施設詳細ボトムシートを開く（ポップアップ非表示）
    if (onMarkerClickRef.current) {
      closePopup()
      onMarkerClickRef.current(result)
      return
    }

    // PC: onMarkerTap が設定されている場合はポップアップを廃止し、
    // 説明枠に一本化する（PC版 SearchTabContent で onMarkerTap を渡す）。
    if (onMarkerTapRef.current) {
      closePopup()
      return
    }

    closePopup()
    // (#38) ポップアップ内容はDOMノード（textContent）のみ
    // (#62 第4ピース) バリアフリー項目は buildPopupElement を流用し、
    // 表示名を barrierFreeLabel（例: 歩道・点字ブロックあり）に置き換える。
    // OSMリンク・ID表示等はそのまま（最小限の表示）。
    const popupData = result.bf ? { ...result, name: barrierFreeLabel(result) } : result
    const popup = new maplibregl.Popup({ offset: 10, closeButton: true })
      .setLngLat(e.lngLat)
      .setDOMElement(buildPopupElement(popupData))
    popup.addTo(map)
    popupRef.current = popup
  }

  // クリック・カーソルハンドラ（load後にレイヤが存在的になってから有効）
  const setupInteractions = (map) => {
    map.on('click', POINT_LAYER, makeFeatureClickHandler(map))

    // クラスタクリック → メンバー範囲へ拡大（ユーザー操作によるfitは許可）
    map.on('click', CLUSTERS_LAYER, (e) => {
      const clusterId = e.features?.[0]?.properties?.cluster_id
      if (clusterId == null) return
      const features = map.querySourceFeatures(RESULTS_SOURCE, {
        cluster: clusterId,
        clusterProperties: { expandToSingle: true }
      }) || []
      if (features.length === 0) return
      let west = 180, south = 90, east = -180, north = -90
      for (const f of features) {
        const [x, y] = f.geometry.coordinates
        if (x < west) west = x
        if (x > east) east = x
        if (y < south) south = y
        if (y > north) north = y
      }
      map.fitBounds([[west, south], [east, north]], { padding: 40, maxZoom: 17, duration: 800 })
    })

    // ポインタカーソル
    for (const layerId of [POINT_LAYER, CLUSTERS_LAYER]) {
      map.on('mouseenter', layerId, () => {
        const canvas = map.getCanvas?.()
        if (canvas) canvas.style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        const canvas = map.getCanvas?.()
        if (canvas) canvas.style.cursor = ''
      })
    }
  }

  // (#62) バリアフリー結果のソース・レイヤ setup（第4ピース）。
  // getSource が存在すればスキップ（重複追加防止）。
  const setupBfLayers = (map) => {
    if (map.getSource(BF_SOURCE)) return
    map.addSource(BF_SOURCE, {
      type: 'geojson',
      data: EMPTY_FC
    })
    map.addLayer(BF_LINE_LAYER_DEF)
    map.addLayer(BF_NODE_LAYER_DEF)
    // (#62 第4ピース) 線（way）と点（node）のクリックでポップアップを表示。
    // ポイントレイヤ（POINT_LAYER）と同一のハンドラを共有する。
    for (const layerId of [BF_LINE_LAYER, BF_NODE_LAYER]) {
      map.on('click', layerId, makeFeatureClickHandler(map))
      map.on('mouseenter', layerId, () => {
        const canvas = map.getCanvas?.()
        if (canvas) canvas.style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        const canvas = map.getCanvas?.()
        if (canvas) canvas.style.cursor = ''
      })
    }
  }

  // (#62) バリアフリーレイヤの削除（POI検索へ切り返したとき）
  const removeBfLayers = (map) => {
    if (!map.getSource(BF_SOURCE)) return
    map.removeLayer(BF_LINE_LAYER)
    map.removeLayer(BF_NODE_LAYER)
    map.removeSource(BF_SOURCE)
  }

  const setupResultLayers = (map) => {
    if (map.getSource(RESULTS_SOURCE)) return
    map.addSource(RESULTS_SOURCE, {
      type: 'geojson',
      data: EMPTY_FC,
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM
    })
    map.addLayer(POINT_LAYER_DEF)
    map.addLayer(CLUSTERS_LAYER_DEF)
    map.addLayer(CLUSTER_COUNT_LAYER_DEF)
    setupInteractions(map)
  }

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapInstanceRef.current) return

    // URL復元bbox（bboxSource='url'）があれば中心・ズームをそれに合わせる。
    // (Task 2) 検索由来のbboxでは初期カメラをBBOXに依存させない。
    const s0 = stateRef.current
    const initialBbox = (s0.bbox && s0.bboxSource === 'url') ? s0.bbox : null
    const center = initialCamera && Array.isArray(initialCamera.center) && initialCamera.center.length === 2
      ? initialCamera.center
      : initialBbox
        ? [(initialBbox.west + initialBbox.east) / 2, (initialBbox.south + initialBbox.north) / 2]
        : DEFAULT_CENTER
    const zoom = initialCamera && initialCamera.zoom != null
      ? initialCamera.zoom
      : (initialBbox ? 12 : DEFAULT_ZOOM)

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center,
      zoom,
      // 本アプリは平面（top-down）地図。pitchを常に0に固定し、回転操作での
      // 連動ピッチ（pitchWithRotate既定true）も無効化する。回転自体は有効。
      maxPitch: 0,
      pitchWithRotate: false
    })
    // Leaflet版は左上のズームコントロール。MapLibre標準は右上のため
    // 地名検索ツールバー（右上）と重ならないよう左上に配置。
    map.addControl(new maplibregl.NavigationControl(), 'top-left')

    mapInstanceRef.current = map
    setMapInstance(map)
    hasFitInitialBboxRef.current = false

    map.on('load', () => {
      loadedRef.current = true

      setupResultLayers(map)

      // (#41-1 / Task 2) URL復元由来のBBOXの場合のみ一度だけfit。
      // 検索由来（bboxSource==='search'）のbboxではカメラを変更しない。
      const s = stateRef.current
      if (s.bbox && s.bboxSource === 'url' && !hasFitInitialBboxRef.current) {
        map.fitBounds(
          [[s.bbox.west, s.bbox.south], [s.bbox.east, s.bbox.north]],
          { padding: 20 }
        )
        hasFitInitialBboxRef.current = true
      }

      // (#xx) 検索範囲矩形オーバーレイを描画（マウント時点でbboxが設定されていた場合）
      syncBboxOverlay()

      // (#xx) マウント時に保留されていた確定場所fitを適用
      const pendingFit = pendingBboxFitRef.current
      if (pendingFit && isValidBbox(pendingFit) &&
          FIT_BBOX_SOURCES.includes(stateRef.current.bboxSource)) {
        applyBboxFit(map, pendingFit)
        pendingBboxFitRef.current = null
      }

      // (#62) バリアフリー検索の結果なら専用ソース・レイヤもsetupして反映
      syncData()
      syncHighlight()
    })

    // (#41-3/#60) コンテナのsize変化（タブのhidden↔表示切替など）でresize()。
    // display:none→表示復帰時、sizeが0だったコンテナにタイル再描画が走らず
    // 古いタイルのままであるのを防ぐ。
    let roTimer = null
    const ro = new ResizeObserver(() => {
      if (roTimer) clearTimeout(roTimer)
      roTimer = setTimeout(() => {
        const el = containerRef.current
        if (!el || !mapInstanceRef.current) return
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          mapInstanceRef.current.resize()
          // (#xx) 非表示中に保留されていた確定場所fitを適用（トップ→フォーム等）
          const pending = pendingBboxFitRef.current
          if (pending && isValidBbox(pending) &&
              FIT_BBOX_SOURCES.includes(stateRef.current.bboxSource)) {
            applyBboxFit(mapInstanceRef.current, pending)
            pendingBboxFitRef.current = null
          }
        }
      }, 100)
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      if (roTimer) clearTimeout(roTimer)
      if (highlightMarkerRef.current) {
        highlightMarkerRef.current.remove()
        highlightMarkerRef.current = null
      }
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
      map.remove()
      mapInstanceRef.current = null
      loadedRef.current = false
      setMapInstance(null)
    }
  }, [])

  // ウィンドウリサイズで地図サイズを再調整
  useEffect(() => {
    let timer = null
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (mapInstanceRef.current && typeof mapInstanceRef.current.resize === 'function') {
          mapInstanceRef.current.resize()
        }
      }, 100)
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // (#xx) 検索範囲矩形オーバーレイを state.bbox / bboxSource の変化に合わせて更新する。
  // 確定場所（geocode/municipality）→ 矩形描画 / それ以外 → オーバーレイ削除。
  // 同一範囲（bbox値が同じ）の再dispatch（useSearchが毎検索で同じbboxを
  // SET_BBOXし直すケース）では再setDataしない（モックの_lastGeoJSONが矩形で
  // 上書きされないようにする）。
  useEffect(() => {
    if (isConfirmedBbox(state)) {
      const key = bboxKey(state.bbox)
      if (overlayKeyRef.current === key) return
      overlayKeyRef.current = key
    } else {
      overlayKeyRef.current = null
    }
    syncBboxOverlay()
  }, [state.bbox, state.bboxSource])

  // (#xx) 確定場所bbox（source: geocode/municipality）でカメラをfitBoundsする
  // - 確定（bboxの変化）時のみfit。値が変わらない再dispatch（useSearchが
  //   検索ごとに同じbboxをSET_BBOXする）では再fitしない
  // - bboxがnull（クリア）になるとfitフラグをリセットし、同じ場所の再確定で
  //   再度fitできるようにする
  // - コンテナ非表示（サイズ0、例: トップ画面・別タブ中）は保留し、地図が
  //   表示されてから適用する（ResizeObserver / load イベントで適用）
  useEffect(() => {
    const { bbox, bboxSource } = state
    const valid = bbox && isValidBbox(bbox) && FIT_BBOX_SOURCES.includes(bboxSource)
    if (!valid) {
      fittedBboxKeyRef.current = null
      pendingBboxFitRef.current = null
      return
    }
    const map = mapInstanceRef.current
    if (!map || !loadedRef.current) {
      // 地図未ロード: loadイベントで適用する
      pendingBboxFitRef.current = bbox
      return
    }
    const key = bboxKey(bbox)
    if (fittedBboxKeyRef.current === key) return // 既にfit済み
    const el = containerRef.current
    const r = el ? el.getBoundingClientRect() : null
    if (r && r.width > 0 && r.height > 0) {
      applyBboxFit(map, bbox)
    } else {
      pendingBboxFitRef.current = bbox
    }
  }, [state.bbox, state.bboxSource])

  // 結果マーカー更新（クラスタリングGeoJSON / バリアフリー線・点GeoJSON）
  // (#62) resultKind にも従い、POI⇄バリアフリーのソース切り替えを行う。
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !loadedRef.current) return
    // 旧ポップアップは閉じる（参照していた要素が更新されるため）
    if (popupRef.current) {
      popupRef.current.remove()
      popupRef.current = null
    }
    // (Task 11) maplibre-glにはMap.setGeoJSON()が存在しない（mapbox-glのAPI）ため、
    // 検索結果の反映は getSource().setData() で行う。
    syncData()
  }, [results, resultKind])

  // Highlight active result — panToで移動（BBOX・ズームは変更しない）
  // 解除（activeResultId=null）時にもsyncHighlight()を実行し、
  // 既存のハイライトマーカーを削除する
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !loadedRef.current) return
    if (activeResultId) {
      const result = results.find((r) => `${r.type}/${r.id}` === activeResultId)
      if (result && result.lat != null && result.lon != null) {
        map.panTo([result.lon, result.lat], { duration: 500 })
      }
    }
    syncHighlight()
  }, [activeResultId, results])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
      {/* (#62) 凡例（BarrierFreeLegend）は地図のオーバーレイではなく、
          親レイアウト（Appの地図ブロック・モバイル検索タブ）の地図本体の下に
          通常のフローで描画する。 */}
    </div>
  )
}

export default MapView
