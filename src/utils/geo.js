/**
 * 地理関連ユーティリティ（Nominatimジオコード、BBOX計算）
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'OSM-Data-Explorer/0.1 (https://armd-02.github.io/osm-data-explorer/)'

// (#63) 検索エリア判定（searchAreaFromGeocode）でBBOXの妥当性を確認するのに使う
import { isValidBbox } from './searchBbox'

/**
 * Nominatimの boundingbox（文字列配列 [south,north,west,east]）を
 * { south, north, west, east } オブジェクトに変換する。無い場合は null。
 */
function toBbox(rawBbox) {
  if (!Array.isArray(rawBbox) || rawBbox.length !== 4) return null
  return {
    south: parseFloat(rawBbox[0]),
    north: parseFloat(rawBbox[1]),
    west: parseFloat(rawBbox[2]),
    east: parseFloat(rawBbox[3])
  }
}

// addressdetails で「市区町村」レベルに対応するキー（最初に非空のものを採用）
const CITY_KEYS = ['city', 'town', 'village', 'municipality', 'borough']

/**
 * addressdetails から都道府県（state）と市区町村（city/town/village等）を抽出
 * @param {object|null} addressdetails Nominatimの addressdetails
 * @returns {{ prefecture: string, city: string }}
 */
function extractAddress(addressdetails) {
  const ad = addressdetails || {}
  const prefecture = (ad.state || ad.province || '').trim()
  let city = ''
  for (const key of CITY_KEYS) {
    if (ad[key] && String(ad[key]).trim()) {
      city = String(ad[key]).trim()
      break
    }
  }
  return { prefecture, city }
}

/**
 * 地名をジオコードする（Nominatim）
 * @param {string} query - 地名（例: "大阪市北区"）
 * @returns {Promise<object|null>} - { lat, lon, display_name, type, boundingbox }
 */
let lastRequestTime = 0

export async function geocode(query) {
  if (!query || query.trim() === '') return null

  // Nominatim利用規約: 最大1リクエスト/秒
  const elapsed = Date.now() - lastRequestTime
  const waitMs = Math.min(1000, Math.max(0, 1000 - elapsed))
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  const params = new URLSearchParams({
    q: query.trim(),
    format: 'json',
    limit: '1',
    countrycodes: 'jp'
  })

  const url = `${NOMINATIM_URL}?${params.toString()}`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      }
    })

    if (!response.ok) {
      throw new Error(`Nominatim APIエラー (${response.status})`)
    }

    const data = await response.json()
    lastRequestTime = Date.now()

    if (data.length === 0) return null

    const result = data[0]
    return {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      displayName: result.display_name,
      type: result.type,
      boundingbox: toBbox(result.boundingbox)
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('ジオコードに失敗しました')
    }
    throw error
  }
}

/**
 * Nominatim の class:type から候補の種別（日本語）を返す。
 * 同名・同住所でも実体が違う候補（駅舎・バス停・レンタサイクル等）を
 * ラベル上で区別するために使う。地名そのもの（place/boundary）は種別なし。
 */
const NOMINATIM_KIND_LABELS = {
  'railway:station': '駅', 'railway:halt': '駅',
  'railway:tram_stop': '電停', 'railway:subway_entry': '地下鉄出入口',
  'building:train_station': '駅',
  'highway:bus_stop': 'バス停', 'highway:platform': 'バス停',
  'amenity:bus_station': 'バスターミナル', 'amenity:bicycle_rental': 'レンタサイクル',
  'amenity:parking': '駐車場', 'amenity:fuel': 'ガソリンスタンド',
  'amenity:taxi': 'タクシー乗り場',
  'public_transport:station': '駅', 'public_transport:platform': 'ホーム',
  'aeroway:aerodrome': '空港', 'aeroway:terminal': '空港ターミナル'
}

function nominatimKind(row) {
  if (!row || !row.class || !row.type) return ''
  return NOMINATIM_KIND_LABELS[row.class + ':' + row.type] || ''
}

/**
 * 地名のジオコード候補を複数取得する（Nominatim、limit=5）
 *
 * トップの地名入力サジェストや、複数候補の提示（候補が2件以上で利用者に
 * 選ばせる流れ）に使う。geocode() と同じくレート制限（最大1リクエスト/秒）を
 * 守る（モジュール内の lastRequestTime を共有）。
 *
 * @param {string} query - 地名（例: "上本町"）
 * @returns {Promise<Array>} - 候補の配列。各候補: { lat, lon, displayName,
 *   name, prefecture, city, type, boundingbox }
 *   （prefecture/city は addressdetails の state / city・town・village 等から抽出）
 */
export async function geocodeCandidates(query) {
  if (!query || query.trim() === '') return []

  // Nominatim利用規約: 最大1リクエスト/秒（geocode() と共有）
  const elapsed = Date.now() - lastRequestTime
  const waitMs = Math.min(1000, Math.max(0, 1000 - elapsed))
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  const params = new URLSearchParams({
    q: query.trim(),
    format: 'json',
    limit: '5',
    addressdetails: '1',
    countrycodes: 'jp'
  })

  const url = `${NOMINATIM_URL}?${params.toString()}`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      }
    })

    if (!response.ok) {
      throw new Error(`Nominatim APIエラー (${response.status})`)
    }

    const data = await response.json()
    lastRequestTime = Date.now()

    const candidates = (data || []).map((row) => {
      const { prefecture, city } = extractAddress(row.address || row.addressdetails)
      return {
        lat: parseFloat(row.lat),
        lon: parseFloat(row.lon),
        displayName: row.display_name,
        name: (row.name || '').trim(),
        prefecture,
        city,
        type: row.type,
        kind: nominatimKind(row),
        boundingbox: toBbox(row.boundingbox)
      }
    })
    // 実質同じ候補（同じラベルで中心が約100m以内）の重複を除く
    const kept = []
    for (const c of candidates) {
      const label = geocodeCandidateLabel(c)
      const dup = kept.some((k) =>
        geocodeCandidateLabel(k) === label &&
        Math.abs(k.lat - c.lat) < 0.001 &&
        Math.abs(k.lon - c.lon) < 0.001)
      if (!dup) kept.push(c)
    }
    return kept
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('ジオコードに失敗しました')
    }
    throw error
  }
}

/**
 * displayName の先頭部分（最初のコンマより前）を返す
 */
function displayNameLeadingPart(displayName) {
  if (!displayName) return ''
  const text = String(displayName)
  const idx = text.indexOf(',')
  return (idx >= 0 ? text.slice(0, idx) : text).trim()
}

/**
 * ジオコード候補の表示ラベルを作る: 「名称（都道府県市区町村）」形式。
 * 例: 「上本町（鹿児島県鹿児島市）」「小倉（福岡県北九州市）」
 * - 市区町村が取れない場合は都道府県だけ: 「○○（鹿児島県）」
 * - 都道府県・市区町村のどちらも無い場合は displayName の先頭部分だけ
 * - 名称は name を採用。name が無い場合は displayName の先頭部分を使う
 */
export function geocodeCandidateLabel(candidate) {
  if (!candidate) return ''
  const name = (candidate.name && candidate.name.trim())
    ? candidate.name.trim()
    : displayNameLeadingPart(candidate.displayName)
  const prefecture = (candidate.prefecture || '').trim()
  const city = (candidate.city || '').trim()
  const kind = (candidate.kind || '').trim()
  const area = prefecture && city ? prefecture + city : (prefecture || city)
  const parts = [kind, area].filter(Boolean)

  if (!parts.length) return name
  return `${name}（${parts.join('・')}）`
}

/**
 * BBOXの概算面積（km²）を計算
 * 日本国内の緯度帯（30°〜45°N）での概算
 */
export function calculateBboxAreaKm2(bbox) {
  const { south, north, west, east } = bbox
  const latMid = (south + north) / 2
  const latRad = (latMid * Math.PI) / 180

  const dLatKm = ((north - south) * Math.PI / 180) * 6371
  const dLonKm = ((east - west) * Math.PI / 180) * 6371 * Math.cos(latRad)

  return dLatKm * dLonKm
}

/**
 * BBOXが検索に大きすぎないかチェック
 * @returns {{ tooLarge: boolean, areaKm2: number, message: string|null }}
 */
export function checkBboxSize(bbox) {
  const areaKm2 = calculateBboxAreaKm2(bbox)

  // 50km x 50km = 2500 km² を目安に警告
  if (areaKm2 > 2500) {
    return {
      tooLarge: true,
      areaKm2,
      message: `検索範囲が広すぎます（約${Math.round(areaKm2).toLocaleString()} km²）。範囲を狭めると検索が早くなります。`
    }
  }

  // 200km x 200km = 40000 km² を目安にエラー扱い
  if (areaKm2 > 40000) {
    return {
      tooLarge: true,
      areaKm2,
      message: `検索範囲が大きすぎます（約${Math.round(areaKm2).toLocaleString()} km²）。Overpass APIの制限により検索できない場合があります。必ず範囲を狭めてください。`
    }
  }

  return { tooLarge: false, areaKm2, message: null }
}

// 地球の平均半径（km）。緯度・経度1°のkm換算に使う
const EARTH_RADIUS_KM = 6371

/**
 * (#63) 指定点を中心にした約 sideKm 正方形のBBOXを生成する。
 * ジオコード結果が駅などの小さな範囲だった場合、それを約1km正方形に
 * 拡大して検索エリアにするのに使う。
 * @param {{lat: number, lon: number}} center 中心点
 * @param {number} [sideKm=1] 一辺の長さ（km）
 * @returns {{south: number, west: number, north: number, east: number}}
 */
export function squareBboxAround(center, sideKm = 1) {
  const { lat, lon } = center
  const KM_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_KM
  const latRad = (lat * Math.PI) / 180
  const halfLat = sideKm / 2 / KM_PER_DEG
  const halfLon = sideKm / 2 / (KM_PER_DEG * Math.cos(latRad))
  return {
    south: lat - halfLat,
    west: lon - halfLon,
    north: lat + halfLat,
    east: lon + halfLon
  }
}

/**
 * (#63) ジオコード結果から検索エリア（BBOX）を決定する。
 * 結果の boundingbox が有効で、面積が thresholdKm2 km² 以上ならそのまま使う。
 * それ未満（駅など点状の小さな範囲）なら、ジオコード点を中心にした
 * 約 sideKm km 正方形に拡大して使う。
 * @param {object} result geocode() の戻り値 { lat, lon, displayName, type, boundingbox }
 * @param {{ sideKm?: number, thresholdKm2?: number }} [options]
 * @returns {{south: number, west: number, north: number, east: number}}
 */
export function searchAreaFromGeocode(result, { sideKm = 1, thresholdKm2 = 1 } = {}) {
  const bbox = result.boundingbox
  if (bbox && isValidBbox(bbox) && calculateBboxAreaKm2(bbox) >= thresholdKm2) {
    return bbox
  }
  return squareBboxAround({ lat: result.lat, lon: result.lon }, sideKm)
}

/**
 * 地名が行政区域かどうかを判定
 * Nominatimのtypeが行政区域を表すかチェック
 */
export function isAdministrativeBoundary(type) {
  const adminTypes = [
    'country', 'state', 'region', 'county',
    'city', 'town', 'village', 'suburb',
    'municipality', 'borough', 'district'
  ]
  return adminTypes.includes(type)
}
