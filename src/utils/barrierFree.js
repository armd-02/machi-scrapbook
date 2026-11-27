/**
 * バリアフリー検索用の Overpass クエリ生成・データ整形ユーティリティ
 *
 * (#62) バリアフリー検索ピース2
 * - 歩道ウェイ（highway=footway / highway=path）
 * - 縁石ノード（barrier=kerb / kerb タグ）
 * - 音声案内ノード（traffic_signals:sound / traffic_signals:vibration）
 *
 * (#70) 追加対象（バリアフリー検索の広げ）:
 * - エレベーター（highway=elevator、node / way）
 * - トイレ（amenity=toilets、node / way）
 * - 車椅子用駐車スペース（parking_space=disabled、node / way）
 * - 階段（highway=steps、way）
 * - スロープ（ramp:wheelchair が付いた要素、node / way）
 */

// ===== クエリ生成 =====

/**
 * バリアフリー検索の Overpass クエリ文字列を生成する。
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @returns {string} Overpass QL クエリ
 *
 * Overpass QL の文法上の注意（実測で HTTP 400 になった不具合の修正）:
 * - union（forブロック）は `)` の後に `;` が必要。`out` は独立した文として書く
 *   （`) out geom;` のように続けて書くと parse error になる）
 * - コロンを含むタグキー（traffic_signals:sound 等）はダブルクォートで囲む
 *   （`node[traffic_signals:sound]` は parse error。`node["traffic_signals:sound"]` が正しい）
 */
export function buildBarrierFreeQuery(bbox) {
  const { south, west, north, east } = bbox
  const bboxStr = [south, west, north, east].map(n => n.toFixed(6)).join(',')

  const body = [
    '(',
    `  way[highway=footway](${bboxStr});`,
    `  way[highway=path](${bboxStr});`,
    `  way[highway=elevator](${bboxStr});`,
    `  way[highway=steps](${bboxStr});`,
    `  way[amenity=toilets](${bboxStr});`,
    `  way[parking_space=disabled](${bboxStr});`,
    `  way["ramp:wheelchair"](${bboxStr});`,
    ');',
    'out geom;',
    '(',
    `  node[highway=crossing](${bboxStr});`,
    `  node[barrier=kerb](${bboxStr});`,
    `  node[kerb](${bboxStr});`,
    `  node["traffic_signals:sound"](${bboxStr});`,
    `  node["traffic_signals:vibration"](${bboxStr});`,
    `  node[highway=elevator](${bboxStr});`,
    `  node[amenity=toilets](${bboxStr});`,
    `  node[parking_space=disabled](${bboxStr});`,
    `  node["ramp:wheelchair"](${bboxStr});`,
    ');',
    'out body;',
  ].join('\n')

  return `[out:json][timeout:60];\n${body}\n`
}

// ===== データ整形 =====

/**
 * tactile_paving タグの値を正規化する。
 * 'yes' / 'no' の場合そのまま、それ以外・未設定は null。
 */
function normalizeTactile(tags) {
  const v = tags?.tactile_paving
  if (v === 'yes' || v === 'no') return v
  return null
}

/**
 * ハバースイン法で2点間の距離（メートル）を計算する。
 */
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000 // 地球半径 m
  const toRad = deg => deg * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * ウェイのジオメトリから概算長（メートル）を計算する。
 * @param {Array<[number, number]>} geometry - [[lon, lat], ...]
 * @returns {number} 長さ（メートル）
 */
function calcWayLengthM(geometry) {
  if (!geometry || geometry.length < 2) return 0
  let total = 0
  for (let i = 1; i < geometry.length; i++) {
    const [lon1, lat1] = geometry[i - 1]
    const [lon2, lat2] = geometry[i]
    total += haversineM(lat1, lon1, lat2, lon2)
  }
  return Math.round(total)
}

/**
 * Overpass の elements 配列を受け取り、バリアフリー検索用の整形済み配列を返す。
 * - ウェイ: { kind:'way', osmId, geometry:[[lon,lat],...], tags, tactile, lengthM }
 * - ノード: { kind:'node', osmId, geometry:[lon,lat], tags, kerb, hasSound, hasVibration, tactile }
 * - 同一 OSM ID の要素は1件にまとめる（重複排除）
 * - geometry の無いウェイ、lat/lon の無いノードは除外
 *
 * @param {Array} elements - Overpass API の elements 配列
 * @returns {Array} 整形済み要素の配列
 */
export function parseBarrierFreeElements(elements) {
  if (!Array.isArray(elements)) return []

  const map = new Map() // osmId → 整形済み要素

  for (const el of elements) {
    if (el.type === 'way') {
      // geometry が無いウェイは除外
      if (!el.geometry || el.geometry.length === 0) continue

      const osmId = `way/${el.id}`
      const geometry = el.geometry.map(p => [p.lon, p.lat])
      const tags = el.tags || {}

      map.set(osmId, {
        kind: 'way',
        osmId,
        geometry,
        tags,
        tactile: normalizeTactile(tags),
        lengthM: calcWayLengthM(geometry),
      })
    } else if (el.type === 'node') {
      // lat/lon が無いノードは除外
      if (el.lat == null || el.lon == null) continue

      const osmId = `node/${el.id}`
      const tags = el.tags || {}

      const item = {
        kind: 'node',
        osmId,
        geometry: [el.lon, el.lat],
        tags,
        kerb: tags.kerb ?? null,
        hasSound: 'traffic_signals:sound' in tags,
        hasVibration: 'traffic_signals:vibration' in tags,
        tactile: normalizeTactile(tags),
      }

      // 重複排除: 既に存在する場合は tags をマージ（同一ノードなので通常は上書きで十分）
      const existing = map.get(osmId)
      if (existing) {
        // 複数条件に該当した場合、真偽値は OR で統合
        if (item.hasSound) existing.hasSound = true
        if (item.hasVibration) existing.hasVibration = true
        if (item.kerb != null) existing.kerb = item.kerb
      } else {
        map.set(osmId, item)
      }
    }
  }

  return [...map.values()]
}

// ===== 表示名 =====

/**
 * kerb タグの値の日本語表示名（barrierFreeLabel 用）
 */
export const KERB_VALUE_LABELS = {
  flat: 'フラット',
  cut: '段差下がり',
  low: '低縁石',
  lowered: '低め（3 cm以下）',
  none: '段差なし',
  detached: '分離縁石',
  rocky: '岩場',
  high: '高縁石',
}

/** kerb:height をメートルに換算する。単位の省略時はメートル。 */
export function parseKerbHeightM(value) {
  const match = String(value ?? '').trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)?$/)
  if (!match) return null

  const height = Number(match[1])
  if (!Number.isFinite(height)) return null
  if (match[2] === 'mm') return height / 1000
  if (match[2] === 'cm') return height / 100
  return height
}

const kerbHeightFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 6 })

export function kerbDetailLabel(kerb, heightValue) {
  const height = parseKerbHeightM(heightValue)
  if (height != null && height >= 0) return `${kerbHeightFormat.format(height * 100)} cm`
  return kerb ? (KERB_VALUE_LABELS[kerb] || kerb) : null
}

/**
 * バリアフリー要素の表示名をタグから生成する（#62 仕様4）。
 *
 * 歩道・縁石・音声案内には施設のような名前（name タグ）が無いことが多いため、
 * 一覧では name が無い場合にこのラベルを表示する（例: 「歩道（点字ブロックあり）」）。
 *
 * - way: highway によるベース名（footway→歩道 / path→歩行者用通路 / その他→通路(値)）
 *        + tactile_paving の有無（あり／なし／未記録）
 *        (#70) 追加対象を優先: エレベーター / 階段 / トイレ / 車椅子用駐車場 / スロープ
 * - node: 音声+振動 → 音・振動案内信号 / 音声のみ → 音声案内信号 /
 *        振動のみ → 振動案内信号 / 縁石 → 「縁石（kerb 値の日本語）」
 *        (#70) 追加対象を優先: エレベーター / トイレ / 車椅子用駐車場 / スロープ
 *
 * 引数は parseBarrierFreeElements の出力（整形済み要素）か、
 * 標準結果形状（bf フィールドを持つもの）のどちらでもよい。
 * @param {{kind?:string, type?:string, tags?:Object, bf?:Object}} item
 * @returns {string} 表示名
 */
export function barrierFreeLabel(item) {
  if (!item || typeof item !== 'object') return 'バリアフリー要素'

  const bf = item.bf && typeof item.bf === 'object' ? item.bf : item
  const tags = item.tags || {}
  const kind = bf.kind || (item.type === 'way' ? 'way' : 'node')

  if (kind === 'way') {
    // (#70) 追加対象: 点字ブロックが該当しない要素は種別名をそのまま表示
    if (tags.highway === 'elevator') return 'エレベーター'
    if (tags.highway === 'steps') return '階段'
    if (tags.amenity === 'toilets') return 'トイレ'
    if (tags.parking_space === 'disabled') return '車椅子用駐車場'
    if (tags['ramp:wheelchair'] != null) return 'スロープ'

    const hwy = tags.highway
    const base = hwy === 'footway'
      ? '歩道'
      : hwy === 'path'
        ? '歩行者用通路'
        : hwy
          ? `通路(${hwy})`
          : '通路'
    const tactile = bf.tactile ?? tags.tactile_paving ?? null
    const suffix = tactile === 'yes'
      ? '点字ブロックあり'
      : tactile === 'no'
        ? '点字ブロックなし'
        : '点字ブロック未記録'
    return `${base}（${suffix}）`
  }

  const hasSound = !!bf.hasSound
  const hasVibration = !!bf.hasVibration
  if (hasSound && hasVibration) return '音・振動案内信号'
  if (hasSound) return '音声案内信号'
  if (hasVibration) return '振動案内信号'

  const kerb = bf.kerb ?? tags.kerb ?? null
  if (tags.barrier === 'kerb' || kerb != null) {
    const sub = kerbDetailLabel(kerb, tags['kerb:height']) ?? '未記録'
    if (sub === KERB_VALUE_LABELS.lowered) return `縁石 ${sub}`
    return `縁石（${sub}）`
  }

  // (#70) 追加対象: エレベーター / トイレ / 車椅子用駐車場 / スロープ
  if (tags.highway === 'elevator') return 'エレベーター'
  if (tags.amenity === 'toilets') return 'トイレ'
  if (tags.parking_space === 'disabled') return '車椅子用駐車場'
  if (tags['ramp:wheelchair'] != null) return 'スロープ'

  return 'バリアフリー要素'
}
