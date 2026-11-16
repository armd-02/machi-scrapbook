/**
 * (#62) バリアフリー検索 — 第3ピース: 結果の正規化と一覧表示ユーティリティ
 *
 * バリアフリー検索のOverpassクエリ生成・要素パースは barrierFree.js（第1・2ピース）
 * が担う。このファイルでは、パース済みの要素をアプリ共通の結果形状に正規化する。
 * 正規化済み結果は既存のパイプライン（キーワード絞り込み・applyResultFilters・
 * iDリンク・マーカー表示・ダウンロード）にそのまま通せる。
 */

import { parseBarrierFreeElements } from './barrierFree'
import { isValidBbox } from './searchBbox'

// バリアフリーカテゴリのid（data/categories.js）
export const BARRIER_FREE_CATEGORY = 'barrier_free'
// バリアフリー目的グループ名（CATEGORY_GROUPS）
export const BARRIER_FREE_PURPOSE = 'バリアフリー'

/**
 * 指定されたフォーム条件がバリアフリー検索に相当するか。
 * カテゴリidが barrier_free か、目的が「バリアフリー」グループのいずれかを満たせばtrue。
 */
export function isBarrierFreeCriteria(category, purpose) {
  return category === BARRIER_FREE_CATEGORY || purpose === BARRIER_FREE_PURPOSE
}

/**
 * バリアフリー形式の要素（parseBarrierFreeElements の出力）を
 * アプリ共通の結果形状に正規化する。
 *
 * 共通フィールド: id, type, tags, lat, lon, name
 *   - way の lat/lon は頂点の平均（近似中心点）。
 *     正確な形状は bf.geometry に保持し、地図描画（第4ピース）と
 *     ダウンロード（第5ピース）で使う。
 * バリアフリー専用フィールド: osmId（'way/123' 形式）、
 *   bf: { kind, tactile, lengthM, kerb, hasSound, hasVibration, geometry }
 */
export function toStandardResults(elements) {
  const out = []
  for (const el of Array.isArray(elements) ? elements : []) {
    const id = parseInt(String(el.osmId).split('/')[1], 10)
    const tags = el.tags || {}
    const name = tags.name || tags['name:ja'] || null
    const geom = Array.isArray(el.geometry) ? el.geometry : []

    if (el.kind === 'node') {
      out.push({
        id,
        type: 'node',
        tags,
        lat: geom.length > 0 ? geom[1] : null,
        lon: geom.length > 0 ? geom[0] : null,
        name,
        osmId: el.osmId,
        bf: {
          kind: 'node',
          tactile: el.tactile ?? null,
          lengthM: null,
          kerb: el.kerb ?? null,
          hasSound: !!el.hasSound,
          hasVibration: !!el.hasVibration,
          geometry: geom
        }
      })
    } else {
      // way: 中心点は頂点平均
      let lat = null
      let lon = null
      if (geom.length > 0) {
        lon = geom.reduce((sum, p) => sum + p[0], 0) / geom.length
        lat = geom.reduce((sum, p) => sum + p[1], 0) / geom.length
      }
      out.push({
        id,
        type: 'way',
        tags,
        lat,
        lon,
        name,
        osmId: el.osmId,
        bf: {
          kind: 'way',
          tactile: el.tactile ?? null,
          lengthM: el.lengthM ?? null,
          kerb: null,
          hasSound: false,
          hasVibration: false,
          geometry: geom
        }
      })
    }
  }
  return out
}

/**
 * Overpass応答JSONを共通結果形状にパースする。
 * executeOverpassQuery の parse オプションに渡す（引数は応答全体 { elements: [...] }）。
 */
export function parseBarrierFreeResponse(data) {
  return toStandardResults(parseBarrierFreeElements(data ? data.elements : undefined))
}

/**
 * 結果を指定されたbboxの内側だけに切り取る（純粋関数）。
 *
 * 既定のOverpass接続先（armd-01）はキャッシュのため、ウェイ検索の範囲を
 * グリッド状に広げて返す仕様なので、検索範囲の外側にある歩道ウェイ・ノードも
 * 結果に混ざる。表示・集計は検索範囲の中だけが正しいため、ここで切り取る。
 *
 * 判定規則:
 * - node: lat/lon が bbox 内（境界上を含む）なら残し、外なら落とす。
 * - way: bf.geometry（[lon, lat] 配列）のいずれかの頂点が bbox 内にあるか、
 *        いずれかの線分が bbox と交差するなら残す。完全に外側なら落とす。
 *        （頂点平均の近似中心 lat/lon で判定しない）
 *
 * bbox が無効（欠落・縮退・逆順）の場合はフィルタせず入力をそのまま返す。
 * useSearch は検証済みの bbox を渡す前提。
 *
 * @param {Array} results - parseBarrierFreeResponse の出力（共通結果形状の配列）
 * @param {{south:number, west:number, north:number, east:number}} bbox - クエリ生成に使ったBBOX
 * @returns {Array} bbox 内側の結果のみ
 */
export function filterByBbox(results, bbox) {
  if (!Array.isArray(results) || results.length === 0) return Array.isArray(results) ? results : []
  if (!isValidBbox(bbox)) return results

  return results.filter((r) => {
    if (r.type === 'node') {
      return typeof r.lon === 'number' && typeof r.lat === 'number' &&
        pointInBbox(r.lon, r.lat, bbox)
    }
    return wayIntersectsBbox(r.bf ? r.bf.geometry : undefined, bbox)
  })
}

/** 点がbbox内（境界上を含む）か */
function pointInBbox(lon, lat, bbox) {
  return lon >= bbox.west && lon <= bbox.east &&
    lat >= bbox.south && lat <= bbox.north
}

/**
 * way の線分列（[[lon,lat],...]）がbboxと交差するか。
 * いずれかの頂点が内側か、いずれかの線分が矩形と交差（境界を横切る）する
 * 場合は true。完全に入れない場合は false。
 */
function wayIntersectsBbox(geometry, bbox) {
  if (!Array.isArray(geometry) || geometry.length === 0) return false
  for (const p of geometry) {
    if (p && typeof p[0] === 'number' && typeof p[1] === 'number' &&
      pointInBbox(p[0], p[1], bbox)) {
      return true
    }
  }
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1]
    const b = geometry[i]
    if (!a || !b) continue
    if (typeof a[0] !== 'number' || typeof a[1] !== 'number' ||
      typeof b[0] !== 'number' || typeof b[1] !== 'number') continue
    if (segmentIntersectsBbox(a[0], a[1], b[0], b[1], bbox)) return true
  }
  return false
}

/**
 * 線分 (x1,y1)-(x2,y2) が軸平行矩形 bbox と交差するか（slab法）。
 * 境界上をまたぐ・頂点が境界上の場合は交差とみなす（境界を含む）。
 */
function segmentIntersectsBbox(x1, y1, x2, y2, bbox) {
  const dx = x2 - x1
  const dy = y2 - y1
  let tmin = 0
  let tmax = 1
  const axes = [
    [x1, dx, bbox.west, bbox.east],
    [y1, dy, bbox.south, bbox.north]
  ]
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      // 軸に平行: 線分の点が範囲内に無い場合は交差不可能
      if (p < lo || p > hi) return false
      continue
    }
    let ta = (lo - p) / d
    let tb = (hi - p) / d
    if (ta > tb) {
      const tmp = ta
      ta = tb
      tb = tmp
    }
    if (ta > tmin) tmin = ta
    if (tb < tmax) tmax = tb
    if (tmin > tmax) return false
  }
  return tmin <= tmax
}

/**
 * 要素型の日本語ラベル（一覧表示用）
 * - way: footway → 歩道, path → 歩行者用通路, それ以外 → 通路(タグ値)
 * - node: 音+振動 → 音・振動案内信号, 音のみ → 音声案内信号,
 *         振動のみ → 振動案内信号, barrier=kerb か kerb タグ → 縁石
 */
export function barrierFreeTypeLabel(result) {
  const r = result || {}
  const tags = r.tags || {}
  const bf = r.bf || {}
  if (r.type === 'way') {
    if (tags.highway === 'footway') return '歩道'
    if (tags.highway === 'path') return '歩行者用通路'
    return tags.highway ? `通路(${tags.highway})` : '通路'
  }
  const hasSound = !!bf.hasSound
  const hasVibration = !!bf.hasVibration
  if (hasSound && hasVibration) return '音・振動案内信号'
  if (hasSound) return '音声案内信号'
  if (hasVibration) return '振動案内信号'
  if (tags.barrier === 'kerb' || tags.kerb != null) return '縁石'
  return 'バリアフリー要素'
}

/**
 * 縁石要素の「縁石の高さ」分類
 *
 * 縁石要素かどうかは既存の仕組み（barrierFreeTypeLabel / カードバッジと同一）で
 * 判定する: tags.barrier === 'kerb' か kerb 値が存在（bf.kerb ?? tags.kerb != null）。
 * 縁石要素でなければ null を返す。
 *
 * 分類（優先順）:
 * 1. tags['kerb:height']（m）が数値として解釈できた場合:
 *    - 0            → 'flat'（段差なし）
 *    - 0 < h <= 0.03 → 'low'（低め: 3cm以下）
 *    - h > 0.03     → 'high'（高め: 3cm超）
 *    - 負数など上記に該当しない不正値 → 'unknown'
 * 2. 高さが未記録（欠落・空文字・数値解釈不可）の場合は bf.kerb（tags.kerb）の値で判定:
 *    - 'flush'   → 'flat'
 *    - 'lowered' → 'low'
 *    - 'raised'  → 'high'
 *    - その他・未記録 → 'unknown'
 *
 * @param {object} result - 共通結果形状（bf を持つバリアフリー結果）
 * @returns {'flat'|'low'|'high'|'unknown'|null}
 */
export function kerbHeightClass(result) {
  const r = result || {}
  const tags = r.tags || {}
  const bf = r.bf && typeof r.bf === 'object' ? r.bf : null
  const kerbValue = (bf && bf.kerb) ?? tags.kerb ?? null

  // 縁石要素の判定（既存の仕組みに合わせて）
  if (!(tags.barrier === 'kerb' || kerbValue != null)) return null

  // kerb:height（m）が数値なら高さで分類（登録済みの高さが優先）
  const h = parseKerbHeightM(tags['kerb:height'])
  if (h != null) {
    if (h === 0) return 'flat'
    if (h > 0 && h <= 0.03) return 'low'
    if (h > 0.03) return 'high'
    return 'unknown' // 負数などの不正値は未記録扱い
  }

  // 高さが無い場合は kerb 値で分類
  if (kerbValue === 'flush') return 'flat'
  if (kerbValue === 'lowered') return 'low'
  if (kerbValue === 'raised') return 'high'
  return 'unknown'
}

/**
 * kerb:height の値をメートル数値として解釈する。
 * 未登録・空文字・数値解釈不可は null。
 */
function parseKerbHeightM(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * ブロック舗装的な点字ブロック情報の表示状態
 * tactile_paving=yes → '有', no → '無', その他 → null（未登録）
 */
export function tactileStatus(result) {
  const value = (result && result.bf && result.bf.tactile) || null
  if (value === 'yes') return '有'
  if (value === 'no') return '無'
  return null
}

/**
 * 長さの表示ラベル（wayのみ。例: '123 m'）。無ければ null
 */
export function lengthLabel(result) {
  const v = result && result.bf && result.bf.lengthM
  return v != null ? `${Math.round(v)} m` : null
}

/**
 * 音声/振動案内の表示ラベル配列（例: ['音声', '振動']）。無ければ空配列
 */
export function signalLabels(result) {
  const bf = (result && result.bf) || {}
  const labels = []
  if (bf.hasSound) labels.push('音声')
  if (bf.hasVibration) labels.push('振動')
  return labels
}
