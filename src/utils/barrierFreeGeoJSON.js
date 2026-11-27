/**
 * (#62) バリアフリー検索 — 第4ピース: 地図描画用GeoJSON変換
 *
 * toStandardResults（barrierFreeResults.js）の正規化済み結果を、
 * 地図上の線（way）と点（node）描画用GeoJSONに変換する。
 * - way: bf.geometry（[[lon, lat], ...]）を LineString として使う
 *   （頂点平均の近似中心点は地図上では使わない）
 * - way: 線に加え、形状の中点（距離基準）に Point の「way-icon」を付与する
 *   （#73）線はタップしにくいので、中点にアイコンを置き、線をタップしたのと
 *   同じ key（`${type}/${id}`）を持つことで同じウェイが選択される
 * - node: bf.geometry（[lon, lat]）を Point として使う
 *
 * 色定数（TACTILE_LINE_COLORS / NODE_ROLE_COLORS）は MapView の
 * レイヤ定義と凡例（BarrierFreeLegend）で共有する。
 * 第5ピース（GeoJSONダウンロード）でも bf.geometry をそのまま使える。
 */

// 線（way）の色: 点字ブロックの登録状態による。
// 明るいベクタベースマップ（OSMFJ）上で目立つよう高彩度の色を使う。
// あり（緑）／なし（赤）／未記録（濃いグレー）。
export const TACTILE_LINE_COLORS = {
  yes: '#16a34a',      // 点字ブロックあり（緑）
  no: '#dc2626',       // 点字ブロックなし（濃い赤）
  unknown: '#475569'   // 未記録
}

export const CROSSING_COLOR = '#db2777'

// 点（node）の色: 役割（role）による（仕様: 縁石=オレンジ、音声案内=紫、両方=別の色）
export const NODE_ROLE_COLORS = {
  kerb: '#f59e0b',          // 縁石（オレンジ）
  signal: '#7c3aed',        // 音声/振動案内信号（紫）
  'kerb+signal': '#0d9488', // 縁石+案内信号（ティール: 上記どちらとも異なる色）
  crossing: CROSSING_COLOR,
  other: '#64748b'          // それ以外のバリアフリー要素（スレート）
}

// (#70) 追加対象（バリアフリー検索の広げ）の要素色。
// T1で追加されたエレベーター/トイレ/車椅子用駐車場/階段/スロープは、
// 点字ブロック・役割の分類とは別に、種別ごとに色を付ける。
// MapView のレイヤ定義と凡例（BarrierFreeLegend）で共有する。
export const BF_NEW_ELEMENT_COLORS = {
  elevator: '#2563eb',   // エレベーター（青）
  toilets: '#a21caf',    // トイレ（フuchsia）
  parking: '#059669',    // 車椅子用駐車場（緑）
  steps: '#d97706',      // 階段（アンバー）
  ramp: '#0f766e'        // スロープ（ティール）
}

/**
 * (#70) T1追加対象の種別を返す（地図描画のカラー分け・凡例に使う）。
 * - highway=elevator → 'elevator'
 * - highway=steps → 'steps'
 * - amenity=toilets → 'toilets'
 * - parking_space=disabled → 'parking'
 * - ramp:wheelchair → 'ramp'
 * 上記に当てはまらない（既存の歩道/縁石/案内信号/横断歩道等）は null。
 * @param {object} result - 標準結果形状（tags を持つ）
 * @returns {'elevator'|'steps'|'toilets'|'parking'|'ramp'|null}
 */
export function newElementType(result) {
  const tags = (result && result.tags) || {}
  if (tags.highway === 'elevator') return 'elevator'
  if (tags.highway === 'steps') return 'steps'
  if (tags.amenity === 'toilets') return 'toilets'
  if (tags.parking_space === 'disabled') return 'parking'
  if (tags['ramp:wheelchair'] != null) return 'ramp'
  return null
}

/**
 * ノードの地図表示用役割（role）を返す（仕様: 第4ピース）。
 * - kerb と signal の両方: 'kerb+signal'
 * - kerb のみ: 'kerb'
 * - hasSound または hasVibration のみ: 'signal'
 * - 上記に当てはまらない横断歩道: 'crossing'
 * - どれにも当てはまらない: 'other'
 * kerb 判定は barrierFreeTypeLabel（barrierFreeResults.js）と同一
 * （barrier=kerb か kerb タグがある）。
 */
export function roleOf(result) {
  const r = result || {}
  const bf = r.bf || {}
  const tags = r.tags || {}
  const isSignal = !!(bf.hasSound || bf.hasVibration)
  const isKerb = tags.barrier === 'kerb' || tags.kerb != null
  if (isKerb && isSignal) return 'kerb+signal'
  if (isKerb) return 'kerb'
  if (isSignal) return 'signal'
  if (tags.highway === 'crossing') return 'crossing'
  return 'other'
}

/**
 * ウェイの線形状の中点（距離基準）を計算する。
 * 全頂点を順に辿り、総長的一半の位置にある点を [lon, lat] で返す。
 * 2点未満（総長ゼロ）のときは先頭点（または null）を返す。
 * @param {Array<[number, number]>} geometry - [[lon, lat], ...]
 * @returns {[number, number] | null} 中点
 */
export function lineMidpoint(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null
  const R = 6371000 // 地球半径 m
  const toRad = (deg) => deg * Math.PI / 180
  const distM = (lat1, lon1, lat2, lon2) => {
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  let total = 0
  for (let i = 1; i < geometry.length; i++) {
    const [lon1, lat1] = geometry[i - 1]
    const [lon2, lat2] = geometry[i]
    total += distM(lat1, lon1, lat2, lon2)
  }
  if (total <= 0) return [geometry[0][0], geometry[0][1]]
  const half = total / 2
  let acc = 0
  for (let i = 1; i < geometry.length; i++) {
    const [lon1, lat1] = geometry[i - 1]
    const [lon2, lat2] = geometry[i]
    const d = distM(lat1, lon1, lat2, lon2)
    if (acc + d >= half) {
      const t = d === 0 ? 0 : (half - acc) / d
      return [lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t]
    }
    acc += d
  }
  const [lon, lat] = geometry[geometry.length - 1]
  return [lon, lat]
}

/**
 * バリアフリー検索結果（標準結果形状、bf フィールド付き）を
 * 地図描画用GeoJSON（FeatureCollection）に変換する。
 *
 * 各featureのproperties:
 * - key: `${type}/${id}`（結果リストのキーと同一。クリック時の特定用）
 * - kind: 'way' | 'way-icon' | 'node'
 * - name: name タグの値（無ければ null）
 * - way / way-icon のみ: tactile（'yes' | 'no' | null）
 * - node のみ: role（'signal' | 'kerb' | 'kerb+signal' | 'other'）
 * - T1追加対象（#70）: newType（'elevator' | 'steps' | 'toilets' | 'parking' | 'ramp'）。
 *   追加対象でなければ付与されない（既存の歩道等には存在しない）。
 *
 * 線・点の仕分けは bf.kind（'way' / 'node'）で行う（仕様2）。
 *
 * 描画に使えるジオメトリが無い要素（wayが1点未満、nodeが座標なし）は除外する。
 * @param {Array} results - toStandardResults の出力
 * @returns {{type:'FeatureCollection', features:Array}}
 */
export function barrierFreeToMapGeoJSON(results) {
  const features = []
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r !== 'object') continue
    const geom = r.bf && Array.isArray(r.bf.geometry) ? r.bf.geometry : []
    const key = `${r.type}/${r.id}`
    const newType = newElementType(r)

    if (r.bf && r.bf.kind === 'way' && geom.length >= 2) {
      // tactile は yes / no / null の3値に正規化（その他は未記録扱い）
      const tactile = (r.bf.tactile === 'yes' || r.bf.tactile === 'no') ? r.bf.tactile : null
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: geom },
        properties: {
          key,
          kind: 'way',
          name: r.name || null,
          ...(r.tags?.footway === 'crossing' ? { crossing: true } : {}),
          // (#70) T1追加対象の種別（既存の歩道等には付与しない）
          ...(newType ? { newType } : {}),
          tactile
        }
      })
      // (#73) ウェイの中点アイコン: 線と同じ key を持ち、タップで同じウェイが選択される。
      // 色分けは線と同じ（crossing / newType / tactile）。線描画自体は残す。
      const mid = lineMidpoint(geom)
      if (mid) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: mid },
          properties: {
            key,
            kind: 'way-icon',
            name: r.name || null,
            ...(r.tags?.footway === 'crossing' ? { crossing: true } : {}),
            // (#70) T1追加対象の種別（既存の歩道等には付与しない）
            ...(newType ? { newType } : {}),
            tactile
          }
        })
      }
    } else if (r.bf && r.bf.kind === 'node' && geom.length === 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: geom },
        properties: {
          key,
          kind: 'node',
          name: r.name || null,
          role: roleOf(r),
          // (#70) T1追加対象の種別（既存の縁石等には付与しない）
          ...(newType ? { newType } : {})
        }
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
