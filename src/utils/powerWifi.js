/**
 * (作業スペース系 電源・Wi-Fi) OSM タグから施設の電源・Wi-Fi の状況を
 * 3状態（'yes' / 'no' / 'unknown'）で判定する純粋関数。
 *
 * 背景: 検索対象の施設（カフェ・図書館等の作業スペース系）では「未登録」が
 * 大半であり、unknown（未登録）を yes/no と混同しない区別が本質。
 * 'unknown' は「施設に無い」ではなく「OSM に情報が登録されていない」を意味する。
 *
 * 判定基準（指示どおり）:
 * - Wi-Fi: あり＝tags.internet_access が設定されていて（非空）'no' でないもの。
 *          無し＝internet_access が 'no'。それ以外は「未登録」（unknown）
 * - 電源:  あり＝tags.power_supply が 'yes'、または socket 系キー（'socket'
 *          または 'socket:' で始まるキー）が存在し値が 'no' でない（非空）もの。
 *          無し＝power_supply が 'no'、または socket が 'no'。それ以外は
 *          「未登録」（unknown）
 *   ※ yes と no の両方に該当する場合は 'yes' が優先（先に評価する）
 *
 * 空文字の値は「未登録」とみなす（設定済みとは数えない）。
 */

/**
 * Wi-Fi の状況（internet_access タグ）
 * @param {object} [tags] - OSM タグ（{ [key]: value }）
 * @returns {'yes'|'no'|'unknown'}
 */
export function wifiStatus(tags) {
  const v = tags ? tags.internet_access : undefined
  if (typeof v !== 'string' || v === '') return 'unknown'
  return v === 'no' ? 'no' : 'yes'
}

/**
 * 電源の状況（power_supply ＋ socket 系キー）
 * @param {object} [tags] - OSM タグ（{ [key]: value }）
 * @returns {'yes'|'no'|'unknown'}
 */
export function powerStatus(tags) {
  if (!tags || typeof tags !== 'object') return 'unknown'

  // --- 'yes' 判定（先に評価する）
  if (tags.power_supply === 'yes') return 'yes'
  for (const key of Object.keys(tags)) {
    if (key !== 'socket' && !key.startsWith('socket:')) continue
    const v = tags[key]
    if (typeof v === 'string' && v !== '' && v !== 'no') return 'yes'
  }

  // --- 'no' 判定
  if (tags.power_supply === 'no' || tags.socket === 'no') return 'no'
  return 'unknown'
}

/**
 * 電源・Wi-Fi の状況をまとめて返す
 * @param {object} [tags] - OSM タグ（{ [key]: value }）
 * @returns {{ power: 'yes'|'no'|'unknown', wifi: 'yes'|'no'|'unknown' }}
 */
export function powerWifiStatus(tags) {
  return { power: powerStatus(tags), wifi: wifiStatus(tags) }
}

/**
 * 電源・Wi-Fi の表示対象か否か（作業スペースになりやすい施設）
 *
 * 対象（いずれかに一致すれば true・OR 結合・値は完全一致）:
 * - amenity=cafe
 * - amenity=library
 * - amenity=internet_cafe
 * - office=coworking
 *
 * 対象外の施設（レストラン・コンビニ等）のカードには電源・Wi-Fi の行を出さない。
 * @param {object} [tags] - OSM タグ（{ [key]: value }）
 * @returns {boolean}
 */
export function isWorkspaceFacility(tags) {
  if (!tags || typeof tags !== 'object') return false
  return (
    tags.amenity === 'cafe' ||
    tags.amenity === 'library' ||
    tags.amenity === 'internet_cafe' ||
    tags.office === 'coworking'
  )
}

/**
 * 対象施設（isWorkspaceFacility）の電源・Wi-Fi 集計
 *
 * @param {Array<object>} [results] - 正規化済みの結果要素配列（表示中の一覧）
 * @returns {null | {
 *   total: number,        // 対象施設の数（母数）
 *   powerPresent: number, // 電源あり（'yes'）の件数
 *   powerPct: number,     // 電源ありの割合（%・四捨五入）
 *   wifiPresent: number,  // Wi-Fiあり（'yes'）の件数
 *   wifiPct: number       // Wi-Fiありの割合（%・四捨五入）
 * }}
 * 対象施設が0件のときは null（集計自体を表示しない）。
 */
export function summarizeWorkspacePowerWifi(results) {
  const list = Array.isArray(results) ? results : []
  const targets = list.filter((r) => r && isWorkspaceFacility(r.tags))
  const total = targets.length
  if (total === 0) return null

  let powerPresent = 0
  let wifiPresent = 0
  for (const r of targets) {
    const s = powerWifiStatus(r.tags)
    if (s.power === 'yes') powerPresent += 1
    if (s.wifi === 'yes') wifiPresent += 1
  }
  return {
    total,
    powerPresent,
    powerPct: Math.round((powerPresent / total) * 100),
    wifiPresent,
    wifiPct: Math.round((wifiPresent / total) * 100),
  }
}
