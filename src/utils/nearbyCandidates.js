/**
 * 周辺地名候補（地区名・大きな公園）の Overpass 取得と端末内照合
 * （駅・路面電車・ケーブルカーの候補は全国駅ファイル stations.json 側で
 * 扱う。stationCandidates.js 参照）
 *
 * 公開 Nominatim の利用ポリシーはオートコンプリート（入力中の問い合わせ）を
 * 禁止しているため、地名入力欄のサジェストは Nominatim を叩かない。
 * 代わりに:
 *  - 入力欄にフォーカスした時点で現在位置（Geolocation API）を取得し、
 *    5km 圏内の「地区名・大きな公園」を Overpass（アプリ既定の
 *    エンドポイント＋フォールバック）へ1回だけ問い合わせ、結果をキャッシュする
 *  - 入力中はキャッシュされた候補に対して端末内で名前の部分一致照合を行う
 *
 * 駅・路面電車・ケーブルカーの候補は Overpass ではなく全国駅ファイル
 * （public/data/stations.json。scripts/fetch-stations.mjs で生成）から
 * 取る（stationCandidates.js）。遠方の駅も候補に出せるようにするため、
 * 周辺クエリからは駅を除外した（駅はファイルに一本化）。
 *
 * 候補の形は Nominatim 候補（geocodeCandidates の戻り値）と互換:
 *   { lat, lon, name, displayName, kind, boundingbox, distanceKm, prefecture, city }
 *  - 地区名（node）: boundingbox は null。座標はノード自体
 *  - 公園（way/relation）: boundingbox は要素の bounds（out bb）。
 *    座標は bounds の中心
 * 検索エリアの設定（searchAreaFromGeocode）はそのまま通用する。
 *
 * 公園の面積フィルタ（PARK_MIN_AREA_M2 以上）は端末側で行う。
 * Overpass QL の `(if: area() > ...)` 節は実サーバー（armd-01・公式
 * overpass-api.de）に受け付けられず（HTTP 500 / 400）、クエリ全体が
 * 失敗するため使えない。代わりに `out bb` の bounds から近似面積を
 * 計算し、parseNearbyResponse 側で選別する。
 */

import { executeOverpassQuery } from './overpass'

// 周辺候補の取得半径（m）。仕様: 5 km
export const NEARBY_RADIUS_M = 5000
// 公園の最小面積（m²）。サーバー側の if 節が使えないため、
// 端末側で bounds の近似面積としてフィルタする（parseNearbyResponse 参照）
export const PARK_MIN_AREA_M2 = 10000
// 入力中のサジェストに表示する候補数の上限。仕様: 最大8件程度
export const MAX_NEARBY_SUGGEST = 8

// 「地区名」として扱う place の値
const AREA_PLACE_VALUES = ['neighbourhood', 'quarter', 'suburb', 'locality']

const EARTH_RADIUS_KM = 6371
const toRad = (d) => (d * Math.PI) / 180

/**
 * Haversine 距離（km）
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

/**
 * 周辺候補取得用の Overpass QL を組み立てる（仕様のクエリ。LAT/LON に現在位置を代入）
 * @param {number} lat 現在緯度
 * @param {number} lon 現在経度
 * @returns {string} Overpass QL クエリ
 */
export function buildNearbyQuery(lat, lon) {
  const around = `around:${NEARBY_RADIUS_M},${lat},${lon}`
  return [
    '[out:json][timeout:25];',
    '(',
    // 駅（railway=station）は全国駅ファイル（stations.json）に一本化するため
    // 周辺クエリには含めない。地区名・公園のみを取得する
    `nwr["place"~"^(neighbourhood|quarter|suburb|locality)$"]["name"](${around});`,
    // 公園は面積フィルタなしで取得（(if: area() > ...) 節は実サーバーに
    // 受け付けられないため）。面積による選別は parseNearbyResponse 側で
    // bounds の近似面積として行う
    `way["leisure"="park"]["name"](${around});`,
    `relation["leisure"="park"]["name"](${around});`,
    ');',
    'out bb;'
  ].join('')
}

/**
 * 要素の bounds（out bb）から近似面積（m²）を概算する。
 * 緯度1度 ≒ 111320m、経度1度 ≒ 111320m × cos(中央緯度) として矩形面積を
 * 計算する（Overpass の area() とは厳密には一致しないが、10000m²程度の
 * しきい値選別には十分）
 * @param {{ minlat: number, minlon: number, maxlat: number, maxlon: number }} b
 * @returns {number} 近似面積（m²）
 */
export function approxBoundsAreaM2(b) {
  const METERS_PER_DEG = 111320
  const midLat = (b.minlat + b.maxlat) / 2
  const heightM = (b.maxlat - b.minlat) * METERS_PER_DEG
  const widthM = (b.maxlon - b.minlon) * METERS_PER_DEG * Math.cos(toRad(midLat))
  return heightM * widthM
}

/**
 * 周辺候補の Overpass 応答パーサー（executeOverpassQuery の parse に渡す）。
 * 施設検索用の parseOverpassResponse とは違い:
 *  - way/relation の bounds（out bb）を boundingbox として保持する
 *  - 地区名・大きな公園の名前持ち要素だけを残す（駅はファイルに一本化済み）
 *  - 公園は bounds の近似面積が PARK_MIN_AREA_M2 を超えるものだけを残す
 *    （サーバー側の if 節が使えないため端末側でフィルタ。モジュール冒頭参照）
 */
export function parseNearbyResponse(data) {
  const elements = (data && data.elements) || []
  const out = []
  for (const el of elements) {
    const tags = el.tags || {}
    const name = (tags.name || '').trim()
    if (!name || name.length < 2) continue

    if (el.type === 'node') {
      const hasCoords = typeof el.lat === 'number' && typeof el.lon === 'number'
      if (!hasCoords) continue
      if (AREA_PLACE_VALUES.includes(tags.place)) {
        out.push({ lat: el.lat, lon: el.lon, name, kind: '地区' })
      }
    } else if (
      (el.type === 'way' || el.type === 'relation') &&
      tags.leisure === 'park' &&
      el.bounds
    ) {
      const b = el.bounds
      const valid = [b.minlat, b.minlon, b.maxlat, b.maxlon].every(
        (n) => typeof n === 'number' && Number.isFinite(n)
      )
      if (!valid) continue
      // 面積フィルタ（端末側）: 近似面積がしきい値を超えない公園は除外
      if (approxBoundsAreaM2(b) <= PARK_MIN_AREA_M2) continue
      out.push({
        lat: (b.minlat + b.maxlat) / 2,
        lon: (b.minlon + b.maxlon) / 2,
        name,
        kind: '公園',
        boundingbox: {
          south: b.minlat,
          west: b.minlon,
          north: b.maxlat,
          east: b.maxlon
        }
      })
    }
  }
  return out
}

/**
 * パース済み要素を表示用候補に整える:
 * - 重複除去: 同一の種別・同一名前で約110m以内（0.001°）の要素をまとめる
 *   （同一駅の複数要素: ノード＋関係など）
 * - distanceKm（現在位置からの距離）・displayName を付ける
 * - 距離順に並び替える
 * 重複除去後の全件を返す（キャッシュには全件保持する）。表示する候補数の
 * 上限（MAX_NEARBY_SUGGEST）は matchNearbyCandidates（入力照合）側で適用
 * する — ここで切り捨てると、近くだが照合されない地区・公園が8件以上
 * あるときに、それより遠い駅がキャッシュから落ちる（「富田」で摂津富田駅
 * が出ない、等の原因）
 * @param {Array} raw parseNearbyResponse の戻り値
 * @param {{ lat: number, lon: number }} center 現在位置
 * @returns {Array} サジェスト用の候補（全件・距離順）
 */
export function prepareNearbyCandidates(raw, center) {
  const dist = (c) => haversineKm(center.lat, center.lon, c.lat, c.lon)
  const sorted = [...(raw || [])].sort((a, b) => dist(a) - dist(b))

  const kept = []
  for (const c of sorted) {
    const dup = kept.some(
      (k) =>
        k.kind === c.kind &&
        k.name === c.name &&
        haversineKm(k.lat, k.lon, c.lat, c.lon) <= 0.11
    )
    if (!dup) kept.push(c)
  }

  return kept.map((c) => ({
    ...c,
    distanceKm: dist(c),
    displayName: c.name,
    prefecture: '',
    city: ''
  }))
}

/**
 * 周辺候補の取得（地区名・大きな公園。駅は stations.json に一本化済み）。
 * アプリ既定の Overpass エンドポイント（フォールバック連鎖付き）を使う。
 * 失敗時は candidates が空配列・error に理由を返す（例外は送出しない。
 * 位置情報は得られたのに周辺候補だけ取れない、という状態を軽く扱うため）
 * @param {number} lat 現在緯度
 * @param {number} lon 現在経度
 * @returns {Promise<{ candidates: Array, error: string|null }>}
 */
export async function fetchNearbyCandidates(lat, lon) {
  try {
    const { results } = await executeOverpassQuery(buildNearbyQuery(lat, lon), {
      parse: parseNearbyResponse
    })
    return { candidates: prepareNearbyCandidates(results, { lat, lon }), error: null }
  } catch (error) {
    return { candidates: [], error: error.message || '周辺候補の取得に失敗しました' }
  }
}

/**
 * 入力テキストをキャッシュされた周辺候補と端末内で照合する（仕様 §3）。
 * 入力中のネットワーク問い合わせは行わない。
 * - 名前の部分一致で絞り込む（大小文字無視・両方向の包含）
 * - 駅は入力に「駅」が無くても当たる（「大阪」で「大阪駅」）
 * - 一致した候補は距離順のまま、表示上限（MAX_NEARBY_SUGGEST 件）に絞る。
 *   上限は「表示する候補」の上限であり、キャッシュ全体の上限ではない
 *   （キャッシュには全件保持する。prepareNearbyCandidates 参照）
 * @param {Array} candidates 周辺候補（fetchNearbyCandidates 由来・全件）
 * @param {string} query 入力テキスト
 * @returns {Array} 一致した候補（距離順・最大 MAX_NEARBY_SUGGEST 件）
 */
export function matchNearbyCandidates(candidates, query) {
  const q = (query || '').trim()
  if (q.length < 2) return []
  const qLower = q.toLowerCase()
  // 駅名の「駅」を外した入力（「大阪駅」→「大阪」）でも駅に当たるようにする
  const qNoStation = qLower.replace(/駅$/, '')

  return (candidates || [])
    .filter((c) => {
      const name = (c.name || '').toLowerCase()
      if (name.includes(qLower) || qLower.includes(name)) return true
      if (c.kind === '駅' && qNoStation.length >= 2 && name.includes(qNoStation)) return true
      return false
    })
    .slice(0, MAX_NEARBY_SUGGEST)
}
