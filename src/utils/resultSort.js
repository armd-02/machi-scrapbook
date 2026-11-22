/**
 * 検索結果のデフォルト並び（並び順プルダウン未選択＝sortDir 'none' のときの表示順）
 *
 * 現状、並び替え未選択の結果は Overpass の返却順（おおむね node → way の順）
 * のまま表示されるため、名前のない施設が先頭に来て、探している施設（名前のある
 * 公園など）が下の方に埋もれる。そこでデフォルト並びを以下にする:
 *
 * - 名前のある施設を先に、名前のない施設（表示上は種別名または「（名称不明）」）を後にする
 * - 同じグループの中では、検索に使った bbox の中心から近い順に並べる
 * - 座標を持たない結果は、そのグループの最後に置く
 *
 * 適用タイミングは検索結果を格納する時点（useSearch.js で bbox 切り取り後・
 * SET_RESULTS の前）。フィルタ側（applyResultFilters）は元の順序を保持するので、
 * 格納時に並べておけば絞り込み後も順序が保たれる。並び順プルダウンで名前の
 * 昇順・降順を明示的に選んだ場合は、フィルタ側で名前順に再並び替えられ、
 * 明示選択が優先される。
 *
 * バリアフリー検索の結果も同じ経路（useSearch.js）を通るため同じ並びになる。
 * まちメモ帳の一覧は検索結果とは別の並びなので影響を受けない。
 */
import { haversineKm } from './nearbyCandidates'
import { hasFacilityName } from './facilityLabels'

/**
 * 検索結果をデフォルト並び（名前あり優先＋bbox中心から近い順）に並べ直す。
 * 新しい配列を返す（元は変更しない）。
 *
 * - 名前のある施設（name / name:ja が実在。hasFacilityName の判定を共用）を
 *   先に、名前のない施設を後にする。名前のない施設は表示上 種別名
 *   （公共トイレ等）または「（名称不明）」で出るが、並びでは常に名前なし側
 * - グループ内は bbox 中心からの距離（haversineKm）の近い順。
 *   距離が同じ（または座標なし同士）場合は元の順を維持する（安定ソート）
 * - 座標を持たない結果（lat/lon が数値でない）は距離が無効なので
 *   そのグループの最後に置く
 * - bbox が無い・不正な場合は並びを変えず元の順を返す
 *
 * @param {Array} results - 検索結果（parseOverpassResponse / parseBarrierFreeResponse の形状）
 * @param {{ south: number, west: number, north: number, east: number }|null} bbox 検索に使った範囲
 * @returns {Array} 並び替えた結果（新しい配列）
 */
export function sortResultsDefault(results, bbox) {
  if (!Array.isArray(results) || results.length < 2) return results || []
  const hasCenter =
    bbox &&
    typeof bbox.south === 'number' &&
    typeof bbox.north === 'number' &&
    typeof bbox.west === 'number' &&
    typeof bbox.east === 'number'
  // 中心が求まらない（bbox 無し・不正）場合は並びを変えず元の順を返す
  if (!hasCenter) return results
  const center = {
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2
  }
  const dist = (r) =>
    center && typeof r.lat === 'number' && typeof r.lon === 'number'
      ? haversineKm(center.lat, center.lon, r.lat, r.lon)
      : Infinity
  const named = []
  const unnamed = []
  for (const r of results) {
    ;(hasFacilityName(r) ? named : unnamed).push(r)
  }
  named.sort((a, b) => dist(a) - dist(b))
  unnamed.sort((a, b) => dist(a) - dist(b))
  return [...named, ...unnamed]
}
