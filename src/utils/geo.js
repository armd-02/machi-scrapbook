/**
 * 地理関連ユーティリティ（Nominatimジオコード、BBOX計算）
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'Machi-Scrapbook/0.1 (https://armd-02.github.io/machi-scrapbook/)'

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
 * 指定点を中心に ±padDeg 度の viewbox（BBOX）を作る。
 * 「地名検索」（明示的なジオコード）で現在位置が取得できていれば、viewbox
 * パラメータを付けて現在地に近い結果を優先する（仕様 §6）。bounded=1 は
 * 付けない（viewbox は結果の優先付けのみで、範囲外の結果も返り得る）。
 * @param {{ lat: number, lon: number }|null} center 現在位置（無い場合は null）
 * @param {number} [padDeg=0.15] 中心からのオフセット（度）。仕様: ±0.15度程度
 * @returns {{south, west, north, east}|null}
 */
export function viewboxAround(center, padDeg = 0.15) {
  if (!center) return null
  const { lat, lon } = center
  if (![lat, lon].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return {
    south: lat - padDeg,
    west: lon - padDeg,
    north: lat + padDeg,
    east: lon + padDeg
  }
}

/**
 * viewbox（BBOX）を Nominatim の viewbox パラメータ文字列にする。
 * 形式: min_lon,max_lat,max_lon,min_lat
 * @returns {string|null} 無効なBBOXなら null
 */
function viewboxParam(bbox) {
  if (!bbox) return null
  const { south, west, north, east } = bbox
  if (![south, west, north, east].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null
  }
  return `${west},${north},${east},${south}`
}

/**
 * 地名をジオコードする（Nominatim）
 * @param {string} query - 地名（例: "大阪市北区"）
 * @param {{ viewbox?: object|null }} [options] - viewbox（BBOX）。現在位置
 *   付近を優先するために付ける（viewboxAround で生成）
 * @returns {Promise<object|null>} - { lat, lon, display_name, type, boundingbox }
 */
let lastRequestTime = 0

export async function geocode(query, { viewbox = null } = {}) {
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
  const vb = viewboxParam(viewbox)
  if (vb) params.set('viewbox', vb)

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
 * @param {{ viewbox?: object|null, limit?: number }} [options]
 *   viewbox: 現在位置付近を優先するBBOX（viewboxAround で生成）。
 *   Nominatim の viewbox パラメータ（min_lon,max_lat,max_lon,min_lat）として
 *   付く。bounded=1 は付けない。
 *   limit: 取得件数（既定5）
 * @returns {Promise<Array>} - 候補の配列。各候補: { lat, lon, displayName,
 *   name, prefecture, city, type, boundingbox }
 *   （prefecture/city は addressdetails の state / city・town・village 等から抽出）
 */
export async function geocodeCandidates(query, { viewbox = null, limit = 5 } = {}) {
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
    limit: String(limit),
    addressdetails: '1',
    countrycodes: 'jp'
  })
  const vb = viewboxParam(viewbox)
  if (vb) params.set('viewbox', vb)

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
        addresstype: row.addresstype || '',
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
 * 距離（km）を表示用に整形する。「約320m」「約1.2km」「約12km」
 */
function formatDistance(km) {
  if (km < 1) return `約${Math.max(1, Math.round(km * 1000))}m`
  if (km < 10) return `約${km.toFixed(1)}km`
  return `約${Math.round(km)}km`
}

/**
 * ジオコード候補の表示ラベルを作る: 「名称（種別・都道府県市区町村）」形式。
 * 例: 「上本町（鹿児島県鹿児島市）」「小倉（福岡県北九州市）」
 * - 市区町村が取れない場合は都道府県だけ: 「○○（鹿児島県）」
 * - 都道府県・市区町村のどちらも無い場合は displayName の先頭部分だけ
 * - 名称は name を採用。name が無い場合は displayName の先頭部分を使う
 * - 距離を持つ候補（周辺候補・Overpass 由来）は距離も表示: 「○○（駅・約320m）」
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
  // 周辺候補（駅・地区・公園）は距離を表示する（仕様 §3）
  if (typeof candidate.distanceKm === 'number' && candidate.distanceKm > 0) {
    parts.push(formatDistance(candidate.distanceKm))
  }

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

// 検索エリアの「広すぎる」ガードのしきい値（km²）。候補の元のBBOXの面積が
// この値以上なら広すぎる（検索不可）とする。国・外国の州・都道府県など、
// 広すぎる範囲はすべてこの判定でカバーする（旧都道府県名ベースのガードを
// 置き換える）。テストから参照できるように export する
export const MAX_SEARCH_AREA_KM2 = 1000

/**
 * BBOXの面積が「広すぎる」（MAX_SEARCH_AREA_KM2 km² 以上）かどうかを判定する。
 *
 * 判定対象は候補が持つ元のBBOX（searchAreaFromGeocode が約1km四方に拡大を
 * かける前の値）。場所入力のガードで使う: ジオコード結果が国・都道府県等の
 * 広い範囲の場合は、その全域を検索エリアに設定して巨大な Overpass クエリを
 * 発行しないようにする。
 * boundingbox が無い（点状）候補や無効なBBOXは広すぎとはみなさない。
 *
 * @param {object|null} bbox { south, north, west, east }
 * @returns {boolean} 広すぎるなら true
 */
export function isBboxTooLarge(bbox) {
  if (!isValidBbox(bbox)) return false
  return calculateBboxAreaKm2(bbox) >= MAX_SEARCH_AREA_KM2
}

// Nominatim 検索結果の addresstype うち「市区町村」（admin_level 8）レベルに
// 対応する値。日本の行政区域では市が 'city'、町が 'town'、村が 'village'
// （実 Nominatim で確認済み。例: 高山市→city、揖斐川町→town）。
// 'municipality'/'borough' は海外の対応値。都道府県は 'state'/'province'、
// 国は 'country' なのでこの例外に該当しない
const MUNICIPALITY_ADDRESSTYPES = ['city', 'town', 'village', 'municipality', 'borough']

/**
 * 候補が「市区町村」レベルの行政区域かどうかを判定する。
 *
 * 「広すぎる」ガード（isBboxTooLarge）の対象外にするのに使う。大きな市
 * （例: 高山市・約2,178 km²）は最小の県（例: 香川県・約1,876 km²）より
 * 大きく、面積だけでは市区町村と都道府県・国を区別できないため、
 * 行政区域の種類で市区町村を判定してガードの例外とする。
 *
 * 判定は候補の由来に沿う:
 * - 自治体データ（municipalities.json）由来: kind が '自治体'（municipalityToCandidate）
 * - Nominatim 由来: addresstype が市区町村レベル（city/town/village 等）
 *
 * @param {object|null} candidate geocodeCandidates や municipalityToCandidate の候補
 * @returns {boolean} 市区町村なら true
 */
export function isMunicipalityCandidate(candidate) {
  if (!candidate) return false
  if (candidate.kind === '自治体') return true
  return MUNICIPALITY_ADDRESSTYPES.includes(candidate.addresstype)
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
