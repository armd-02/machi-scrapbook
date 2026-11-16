/**
 * 地理関連ユーティリティ（Nominatimジオコード、BBOX計算）
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'OSM-Data-Explorer/0.1 (https://armd-02.github.io/osm-data-explorer/)'

// (#63) 検索エリア判定（searchAreaFromGeocode）でBBOXの妥当性を確認するのに使う
import { isValidBbox } from './searchBbox'

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
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed))
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
      boundingbox: result.boundingbox
        ? {
            south: parseFloat(result.boundingbox[0]),
            north: parseFloat(result.boundingbox[1]),
            west: parseFloat(result.boundingbox[2]),
            east: parseFloat(result.boundingbox[3])
          }
        : null
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('ジオコードに失敗しました')
    }
    throw error
  }
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
