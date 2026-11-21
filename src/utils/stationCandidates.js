/**
 * 全国駅データファイル（public/data/stations.json）の読み込みと端末内照合
 *
 * 地名入力サジェストの駅候補は、現在地周辺の Overpass 取得ではなく
 * 全国の駅・路面電車・ケーブルカーをあらかじめファイル化した
 * stations.json（scripts/fetch-stations.mjs で手動生成）から取る。
 * 遠方の駅（富田にいて「大阪」と入力しても大阪駅）も候補に出せるようにする。
 *
 * - stations.json の形式: [名前, 緯度, 経度, 種別] の配列の配列
 *   （種別: 0=駅・1=路面電車・2=ケーブルカー。緯度・経度は小数5桁）
 * - 読み込み: 地名入力欄のフォーカス時に fetch（import.meta.env.BASE_URL
 *   付きで本番の GitHub Pages base を踏む）。モジュールレベルのキャッシュ
 *   （Promise）で再フォーカス時の再取得を防ぐ
 * - 読み込み失敗・形式不正時は空配列を返す（駅候補なしで従来どおり動作。
 *   エラー表示はしない）
 *
 * 照合ルールは周辺候補（matchNearbyCandidates）と同じ:
 *  - 名前の部分一致（大小文字無視・両方向の包含）
 *  - 駅は入力に「駅」が無くても当たる（「大阪」で「大阪駅」）
 *  - 路面電車の停留所・ケーブルカーの駅はそのまま部分一致で扱う
 */

import { haversineKm, MAX_NEARBY_SUGGEST } from './nearbyCandidates'

// stations.json の種別コード → 候補の kind ラベル
export const STATION_KIND_LABELS = {
  0: '駅',
  1: '路面電車',
  2: 'ケーブルカー'
}

let cachePromise = null

/**
 * stations.json をフェッチし、[名前, 緯度, 経度, 種別] の配列を返す。
 *
 * - URL 組み立ては municipalities.json と同じ方式
 *   （import.meta.env.BASE_URL + 'data/stations.json'）
 * - モジュールレベルのキャッシュ（Promise）で二重取得を防ぐ
 * - 取得失敗・形式不正時は空配列を返す（例外にしない・エラー表示しない）
 * @returns {Promise<Array>} 行（[名前, 緯度, 経度, 種別]）の配列（失敗時は []）
 */
export function loadStationFile() {
  if (!cachePromise) {
    const base = import.meta.env.BASE_URL || '/'
    cachePromise = fetch(base + 'data/stations.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((rows) => (Array.isArray(rows) ? rows : []))
      .catch(() => [])
  }
  return cachePromise
}

/**
 * stations.json の行を表示用候補（周辺候補・自治体候補と同じ形状）に変換する。
 * 形式不正な行（要素数不足・名前が空・座標が数値でない・未知の種別）は除外する
 * @param {Array} rows loadStationFile の戻り値
 * @returns {Array} 候補 { name, lat, lon, kind, displayName, prefecture, city }
 */
export function stationFileToCandidates(rows) {
  return (rows || [])
    .filter(
      (r) =>
        Array.isArray(r) &&
        r.length >= 4 &&
        typeof r[0] === 'string' &&
        // 実データに1文字の駅名（呉・津・旭など）があるため1文字も通す
        r[0].trim().length >= 1 &&
        typeof r[1] === 'number' &&
        typeof r[2] === 'number' &&
        r[3] in STATION_KIND_LABELS
    )
    .map((r) => ({
      name: r[0].trim(),
      lat: r[1],
      lon: r[2],
      kind: STATION_KIND_LABELS[r[3]],
      displayName: r[0].trim(),
      prefecture: '',
      city: ''
    }))
}

/**
 * 入力テキストを駅ファイルの候補と端末内で照合する（周辺候補と同じルール）。
 * 入力中のネットワーク問い合わせは行わない。
 * - 名前の部分一致で絞り込む（大小文字無視・両方向の包含）
 * - 駅は入力に「駅」が無くても当たる（「大阪」で「大阪駅」）
 * - 路面電車・ケーブルカーは名前に「駅」が付かないことがあるため、
 *   通常の部分一致だけで扱う
 * @param {Array} candidates stationFileToCandidates の戻り値
 * @param {string} query 入力テキスト
 * @returns {Array} 一致した候補（ファイルの並び順のまま・上限は結合側で適用）
 */
export function matchStationCandidates(candidates, query) {
  const q = (query || '').trim()
  if (q.length < 2) return []
  const qLower = q.toLowerCase()
  // 駅名の「駅」を外した入力（「大阪駅」→「大阪」）でも駅に当たるようにする
  const qNoStation = qLower.replace(/駅$/, '')

  return (candidates || []).filter((c) => {
    const name = (c.name || '').toLowerCase()
    if (name.includes(qLower) || qLower.includes(name)) return true
    if (c.kind === '駅' && qNoStation.length >= 2 && name.includes(qNoStation)) return true
    return false
  })
}

/**
 * 駅候補（ファイル）と周辺候補（地区・公園）の照合結果をサジェスト候補に
 * 結合する。
 *
 * - 現在地が分かっている場合（center あり）: 駅候補にも distanceKm を付け、
 *   周辺候補と合せて距離順に並び替える
 * - 分からない場合: ファイルの駅候補→周辺候補の順
 * - どちらの場合も表示上限（MAX_NEARBY_SUGGEST 件）に絞る
 *
 * @param {Array} stationMatches matchStationCandidates の戻り値
 * @param {Array} nearbyMatches matchNearbyCandidates の戻り値
 * @param {{ lat: number, lon: number }|null} center 現在位置（無ければ null）
 * @returns {Array} サジェスト候補（最大 MAX_NEARBY_SUGGEST 件）
 */
export function combineSuggestCandidates(stationMatches, nearbyMatches, center) {
  const stations = stationMatches || []
  const nearby = nearbyMatches || []
  if (center) {
    const withDist = stations.map((c) => ({
      ...c,
      distanceKm: haversineKm(center.lat, center.lon, c.lat, c.lon)
    }))
    return [...withDist, ...nearby]
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_NEARBY_SUGGEST)
  }
  return [...stations, ...nearby].slice(0, MAX_NEARBY_SUGGEST)
}
