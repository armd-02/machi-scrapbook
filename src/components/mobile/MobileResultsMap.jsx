import React, { useCallback, useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useApp } from '../../context/AppContext'
import { BASEMAP_STYLE } from '../../utils/mapStyle'
import {
  BF_LINE_LAYER_DEF,
  BF_NODE_LAYER_DEF
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
 *   ホイール・ダブルタップでズームできる。一覧タブの縦スクロール領域内に
 *   埋め込まれるが、タッチ操作は地図に渡る（interactive 既定値・
 *   pointer-events なし）。
 * - kind='poi'      → 結果を施設アイコン（symbolレイヤ）として表示
 *   kind='barrier_free' → 歩道を線・縁石/案内信号を点として表示
 *   （MapView と同じレイヤ定義・色を使うため、見た目が一致する）
 * - (アイコンピン) kind='poi': アイコン解決は施設カードと同じ getFacilityIcon /
 *   facilityIconUrl（utils/facilityIcon.js）。必要なアイコン画像のみを
 *   map.loadImage + map.addImage で読み込み・登録し、読込に成功したアイコンは
 *   施設アイコンで描画する。未解決・読込失敗の施設は青い点（MapView の
 *   POINT_LAYER_DEF と同じ見たみの circle レイヤ）で描画する。検索タブの地図
 *   （MapView）は従来どおり青い点のまま（アイコン化しない）。
 * - (修正) kind='poi': アイコン・フォールバック点のマーカータップで
 *   onMarkerClick(result) プロパティを呼び出す（feature の key（type/id）から
 *   結果を解決してコールバックに渡す）。一覧タブ側はこれを受け、対応する施設
 *   カードへスクロールして選択状態にする（詳細シートは開かない）。
 *   kind='barrier_free' にはタップコールバックを設けない
 *   （従来どおりクリックでのポップアップ等も無い挙動を維持）
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

// fitBounds の共通オプション（コンパクトな地図のため padding 24px・
// maxZoom 16。duration 0 は再検索時のカメラ遷移を即時にするため）
const FIT_OPTIONS = { padding: 24, maxZoom: 16, duration: 0 }

// 結果マップの高さの保存キー（検索タブの mapHeight.mobile とは独立）
const RESULTS_MAP_HEIGHT_KEY = 'mapHeight.results'
// (修正) バリアフリー結果マップ専用の高さ保存キー（POI地図のキーとは独立）
const BF_RESULTS_MAP_HEIGHT_KEY = 'mapHeight.resultsBf'

// (アイコンピン) properties.icon が空でない（= 画像の登録に成功した）機能を
// 施設アイコンで描画する。アイコン画像は buildPoiIconGeoJSON が
// map.loadImage + map.addImage で読み込み・登録する（アイコンの出典は
// facilityIcon.js のコメントを参照）。
const POI_ICON_LAYER_DEF = {
  id: 'poi-icon',
  type: 'symbol',
  source: POI_SOURCE_ID,
  filter: ['!=', ['get', 'icon'], ''],
  layout: {
    'icon-image': ['get', 'icon'],
    'icon-size': 0.5, // 64px のアイコンを約32pxで描画
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

// map.loadImage(url, cb) を Promise 化する
const loadImageAsync = (map, url) =>
  new Promise((resolve, reject) =>
    map.loadImage(url, (err, img) => (err ? reject(err) : resolve(img)))
  )

/**
 * (アイコンピン) 結果バッチに必要なアイコンをマップへ登録し、各機能に
 * properties.icon（登録成功=アイコン名 / 失敗=空文字）を付けた GeoJSON を作る。
 *
 * - アイコン解決は getFacilityIcon（施設カードと同じロジック・未対応は
 *   フォールバックアイコン）
 * - 未試行のアイコンのみを loadImage → addImage で並行読み込む（Promise.all）
 * - 読込成功/失敗は iconStatus（Map: アイコン名 → boolean）にキャッシュされ、
 *   再検索などで同じアイコンが再び出てきても再読込しない
 */
async function buildPoiIconGeoJSON(map, results, iconStatus) {
  const rs = (Array.isArray(results) ? results : [])
    .filter((r) => !r.bf && r.lat != null && r.lon != null)
  if (rs.length === 0) return { type: 'FeatureCollection', features: [] }

  const icons = [...new Set(rs.map((r) => getFacilityIcon(r.tags || {})))]
  await Promise.all(
    icons.filter((icon) => !iconStatus.has(icon)).map(async (icon) => {
      try {
        const image = await loadImageAsync(map, facilityIconUrl(icon))
        map.addImage(icon, image)
        iconStatus.set(icon, true)
      } catch {
        iconStatus.set(icon, false)
      }
    })
  )

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
          icon: iconStatus.get(icon) === true ? icon : '',
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

export default function MobileResultsMap({ kind = 'poi', onMarkerClick = null }) {
  const { state } = useApp()
  const results = state.results || []
  const bbox = state.bbox
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
  // 隠れている間に保留した fitBounds の対象範囲 [[sw],[ne]]（null で保留なし）
  const pendingBoundsRef = useRef(null)
  // (アイコンピン) アイコン画像の読込状態（アイコン名 → true=登録成功 /
  // false=失敗）。マップ生成時に初期化し、再検索での再読込を防ぐ
  const iconStatusRef = useRef(new Map())
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
    storageKey: isBarrierFree ? BF_RESULTS_MAP_HEIGHT_KEY : RESULTS_MAP_HEIGHT_KEY,
    onResize: handleMapResize
  })

  useEffect(() => {
    latestRef.current = { results, bbox }
  }, [results, bbox])

  // (修正) onMarkerClick の最新値。イベントハンドラは地図生成時に一度だけ
  // 登録されるため、旧クロージャを防ぐために ref 経由で読む（MapView と同様）
  const onMarkerClickRef = useRef(onMarkerClick)
  useEffect(() => { onMarkerClickRef.current = onMarkerClick }, [onMarkerClick])

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
      : await buildPoiIconGeoJSON(map, rs, iconStatusRef.current)
    if (seq !== applySeqRef.current) return // 新しい applyData に引き継ぐ
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

    const visible = visibleRef.current
    if (target && visible) {
      map.fitBounds(target, FIT_OPTIONS)
      pendingBoundsRef.current = null
    } else {
      // 隠れている（または対象範囲なし）間はフィットを保留
      pendingBoundsRef.current = target
    }
  }, [kind])

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
    iconStatusRef.current = new Map()

    map.on('load', () => {
      loadedRef.current = true
      if (kind === 'barrier_free') {
        map.addSource(BF_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
        map.addLayer(BF_LINE_LAYER_DEF)
        map.addLayer(BF_NODE_LAYER_DEF)
      } else {
        map.addSource(POI_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
        // (アイコンピン) 施設アイコン（symbol）＋読込失敗時のフォールバック点
        // （circle・MapView の POINT_LAYER_DEF と同じ見た目）
        map.addLayer(POI_ICON_LAYER_DEF)
        map.addLayer(POI_FALLBACK_LAYER_DEF)
        // マーカータップ → onMarkerClick。アイコン・フォールバックの両レイヤに
        // 同じハンドラを付ける（2つの filter は排他的なので重複しない）。
        const handlePoiClick = (e) => {
          const key = e.features?.[0]?.properties?.key
          if (!key) return
          const result = latestRef.current.results.find((r) => `${r.type}/${r.id}` === key)
          if (!result) return
          const cb = onMarkerClickRef.current
          if (cb) cb(result)
        }
        map.on('click', POI_ICON_LAYER_DEF.id, handlePoiClick)
        map.on('click', POI_FALLBACK_LAYER_DEF.id, handlePoiClick)
      }
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
          if (pendingBoundsRef.current) {
            m.fitBounds(pendingBoundsRef.current, FIT_OPTIONS)
            pendingBoundsRef.current = null
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
      map.remove()
      mapRef.current = null
      loadedRef.current = false
    }
    // kind は props 固定（親が kind 変化時に remount させる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // 結果変化（再検索など）時はソース更新 + 範囲に再配置
  useEffect(() => {
    applyData()
  }, [results, bbox, applyData])

  const label = kind === 'barrier_free' ? 'バリアフリー要素マップ' : '検索結果マップ'
  // ラウンド枠（rounded-lg）は地図+ハンドルの外側wrapperに持ち、
  // 地図コンテナは既定高さクラス（poi: h-[200px] / barrier_free: h-[320px]）のまま
  // （ドラッグ後はstyle上書き）
  return (
    <div className="rounded-lg overflow-hidden border border-slate-200">
      <div
        ref={containerRef}
        role="application"
        aria-label={label}
        className={isBarrierFree ? 'h-[320px] bg-slate-100' : 'h-[200px] bg-slate-100'}
        style={mapHeight.containerStyle}
      />
      {/* 高さドラッグハンドル（検索タブの地図と同一のフック・見た目） */}
      <div
        {...mapHeight.handleProps}
        className="h-7 bg-slate-100 border-t border-slate-200 flex items-center justify-center"
      >
        <span className="w-8 h-1 rounded-full bg-slate-300" />
      </div>
    </div>
  )
}
