import React, { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP_STYLE } from '../../utils/mapStyle'

/**
 * 施設詳細用の小型ロケーションマップ（#62）。
 *
 * - 渡された座標を中心にし、デフォルスマーカー（ピン）を表示する。
 *   デフォルスマーカーは maplibre-gl がインラインSVGで生成するため、
 *   外部アセット/CDNへの依存がない。
 * - インタラクティブ（実機フィードバック: 詳細内地図をパンチ/ズーム可能に）。
 *   ドラッグで移動、ピンチ（タッチ）/ホイール（マウス）でズームできる。
 *   回転（bearing）と傾き（pitch）は全地図の方針どおり無効: dragRotate: false
 *   ＋ touchZoomRotate.disableRotation()（ピンチズームを残して捻り回転のみ無効化）
 *   ＋ maxPitch: 0 / pitchWithRotate: false。
 * - メインマップと同一のOSMベクタタイルベースマップ（BASEMAP_STYLE、OSMFJ）を
 *   使う。コンパクト版 AttributionControl で © OpenStreetMap 表示
 *   （タイル利用規約上必須）。
 * - アンマウントまたは座標変更時に map を破棄する。
 */
export default function MiniLocationMap({ lng, lat, height = 200, zoom = 15, className = '' }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const map = new maplibregl.Map({
      container: el,
      style: BASEMAP_STYLE,
      center: [lng, lat],
      zoom,
      attributionControl: false, // 既定の（広い）attrib bar の代わりに compact 版を明示追加
      // インタラクティブ: ドラッグで移動、ピンチ/ホイールでズーム
      dragPan: true,
      scrollZoom: true,
      touchZoomRotate: true, // ピンチズーム有効。捻り回転は下方の disableRotation で無効化
      dragRotate: false, // 回転（bearing）は無効（マウス/トラックパッドの2指ドラッグ回転）
      keyboard: false, // インセット地図はキーボード操作（矢印キー等）を奪わない
      // 平面地図のため pitch を常に0に固定（回転での連動ピッチも無効化）
      maxPitch: 0,
      pitchWithRotate: false
    })
    // 2指タッチの「捻り回転」部分のみ無効化（ピンチズームは残す）。
    // touchZoomRotate: true だけでは捻りで bearing が回転するため、
    // 全地図の方針（回転・pitch 無効）に合わせて無効化する。
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.AttributionControl({ compact: true }))
    new maplibregl.Marker().setLngLat([lng, lat]).addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [lng, lat, zoom])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`位置マップ（緯度 ${lat}、経度 ${lng}）`}
      className={`overflow-hidden rounded-lg border border-slate-200 ${className}`}
      style={{ height }}
    />
  )
}
