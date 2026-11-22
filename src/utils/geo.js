/**
 * 地理関連ユーティリティ（Nominatimジオコード、BBOX計算）
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'Machi-Scrapbook/0.1 (https://armd-02.github.io/machi-scrapbook/)'

// (#63) 検索エリア判定（searchAreaFromGeocode）でBBOXの妥当性を確認するのに使う
import { isValidBbox } from './searchBbox'
// 距離計算（viewbox 付きジオコード候補の距離順再ソートに使う）
import { haversineKm } from './nearbyCandidates'
import { executeOverpassQuery } from './overpass'
// 施設種別ラベルと「検索語の末尾が種別名か」判定
// （Overpass 名前検索フォールバックのランキングに使う）
import { facilityTypeLabel, trailingTypeLabel } from './facilityLabels'

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
  // 小数点以下6桁に丸めて末尾の0を除く（浮点誤差の混入を防ぐ）
  const r = (n) => n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return [west, north, east, south].map(r).join(',')
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

// 地名ジオコード候補の提示上限件数。Nominatim の取得件数（limit）、
// 距離順ソート後の切り詰め件数、Overpass 名前検索フォールバックの
// 提示件数のすべてがこの値を共有する
export const GEOCODE_CANDIDATE_LIMIT = 40

/**
 * 地名のジオコード候補を複数取得する（Nominatim、limit=40）
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
 *   limit: 取得件数（既定 GEOCODE_CANDIDATE_LIMIT=40）
 * @returns {Promise<Array>} - 候補の配列。各候補: { lat, lon, displayName,
 *   name, prefecture, city, type, boundingbox }
 *   （prefecture/city は addressdetails の state / city・town・village 等から抽出）
 */
export async function geocodeCandidates(query, { viewbox = null, limit = GEOCODE_CANDIDATE_LIMIT } = {}) {
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
 * ジオコード候補を指定点からの距離（km）の近い順に並び替え、先頭 N 件を返す。
 * Nominatim は結果を距離順に並べないため、viewbox を付けて現在地付近を優先
 * しても最寄りの候補が下位に沈み得る（取得件数が少ないと最寄りが候補に入らない）。
 * そのため viewbox 付きの「地名検索」では GEOCODE_CANDIDATE_LIMIT 件取得してから
 * 本関数で距離順に並べ替えて先頭 GEOCODE_CANDIDATE_LIMIT 件を使う。
 * @param {Array} candidates geocodeCandidates() の戻り値
 * @param {{ lat: number, lon: number }} center 現在位置
 * @param {number} [maxCount=GEOCODE_CANDIDATE_LIMIT] 保持する候補数
 * @returns {Array} 距離順に並び替えた候補（先頭 maxCount 件）
 */
export function sortCandidatesByDistance(candidates, center, maxCount = GEOCODE_CANDIDATE_LIMIT) {
  const list = Array.isArray(candidates) ? candidates : []
  if (!center || !list.length) return list
  const { lat, lon } = center
  const dist = (c) => haversineKm(lat, lon, c.lat, c.lon)
  return [...list].sort((a, b) => dist(a) - dist(b)).slice(0, maxCount)
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
 * 判定対象は候補が持つ元のBBOX（searchAreaFromGeocode が約1.5km四方に拡大を
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
 * ジオコード結果が駅などの小さな範囲だった場合、それを約1.5km正方形に
 * 拡大して検索エリアにするのに使う。
 * @param {{lat: number, lon: number}} center 中心点
 * @param {number} [sideKm=1.5] 一辺の長さ（km）
 * @returns {{south: number, west: number, north: number, east: number}}
 */

// ---------- 地名検索の Overpass 名前検索補完 ----------
//
// Nominatim は「検索語と完全に同名の要素」しか返さないため、名称が正確に
// 存在しない POI（例: 「岡山大学」→「岡山大学 津島キャンパス」）はどんなに
// 絞り込んでも候補にならない。そこで「Nominatim 候補のどれも name に検索語
// を含まない」場合だけ、Overpass の全国名前検索で補完する。
//
// - クエリ: nwr["name"~"<検索語>"]（範囲指定なし＝全国）。検索語は正規表現
//   として安全にエスケープする
// - エンドポイント: アプリ既定の一次エンドポイント（armd-01）のみ。フォール
//   バック連鎖（公共サーバー）には乗せない
// - タイムアウト: 周辺候補取得と同じく約25秒（[timeout:25]）
// - 候補の形状は geocodeCandidates の戻り値と互換（lat/lon・boundingbox・
//   name・displayName・kind・prefecture・city）。way/relation は bounds
//   中心を lat/lon にする（out bb）
// - 同名の候補は1件に集約（現在位置があるなら最近接・なければ先頭）。
//   件数は5件上限。現在位置がある場合は距離順にソートする

/**
 * 検索語を Overpass QL の正規表現マッチ（["name"~"..."]）用にエスケープする。
 * 1) 正規表現メタ文字をエスケープ（検索語をリテラル文字列として扱う）
 * 2) 二重引用符で囲む Overpass QL 値としてエスケープ（バックスラッシュ・
 *    二重引用符）
 * @param {string} str 検索語
 * @returns {string} エスケープ済み文字列
 */
function escapeNameRegex(str) {
  return String(str)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

/**
 * 全国名前検索（地名ジオコード補完）の Overpass QL を生成する。
 * 範囲指定なし（全国）。`out bb` で way/relation の bounds を取得する。
 * @param {string} query 検索語
 * @returns {string} Overpass QL クエリ
 */
export function buildNameSearchQuery(query) {
  const escaped = escapeNameRegex((query || '').trim())
  return `[out:json][timeout:25];nwr["name"~"${escaped}"];out bb;`
}

// タグキー → kind ラベル（候補表示用）。leisure=park のみ「公園」に
// （候補選択時の公園専用拡大ロジック kind==='公園' と整合させる）
const NAME_SEARCH_KIND_LABELS = {
  public_transport: '停留所',
  railway: '駅',
  highway: '道路',
  amenity: '施設',
  tourism: '施設',
  leisure: '施設',
  building: '建物',
  natural: '自然',
  waterway: '水路',
  place: '地域',
  landuse: '地域'
}

function nameSearchKind(tags) {
  if (tags.leisure === 'park') return '公園'
  for (const key of Object.keys(NAME_SEARCH_KIND_LABELS)) {
    if (tags[key]) return NAME_SEARCH_KIND_LABELS[key]
  }
  return ''
}

/**
 * 全国名前検索の Overpass 応答をジオコード候補に変換する
 * （geocodeCandidates の戻り値と互換の形状）。
 * - node: 自身の座標。boundingbox は null
 * - way/relation: bounds 中心を lat/lon に（out bb）。boundingbox は bounds
 * - name タグが無い要素は除外
 * @param {object} data Overpass の生 JSON
 * @returns {Array} 候補
 */
export function parseNameSearchResponse(data) {
  const elements = (data && data.elements) || []
  const out = []
  for (const el of elements) {
    const tags = el.tags || {}
    const name = (tags.name || '').trim()
    if (!name) continue

    if (el.type === 'node') {
      if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue
      out.push({
        lat: el.lat,
        lon: el.lon,
        name,
        kind: nameSearchKind(tags),
        tags,
        boundingbox: null
      })
    } else if ((el.type === 'way' || el.type === 'relation') && el.bounds) {
      const b = el.bounds
      const valid = [b.minlat, b.minlon, b.maxlat, b.maxlon].every(
        (n) => typeof n === 'number' && Number.isFinite(n)
      )
      if (!valid) continue
      out.push({
        lat: (b.minlat + b.maxlat) / 2,
        lon: (b.minlon + b.maxlon) / 2,
        name,
        kind: nameSearchKind(tags),
        tags,
        boundingbox: { south: b.minlat, west: b.minlon, north: b.maxlat, east: b.maxlon }
      })
    }
  }
  return out
}

// 同名集約で way/relation（bounds あり）を node（bounds なし）に優先させる
// しきい値（km）。同名の2候補の距離差がこれを超える場合は別の施設と見て
// 近い方を取る（bounds 優先しない）。
const BBOX_PREFERENCE_MAX_DIFF_KM = 2

/**
 * 全国名前検索の結果を提示用候補に整える。
 * - 同名の候補を1件に集約。
 *   - 双方とも bounds の有無が同じなら: 現在位置があるなら最近接・なければ先頭
 *   - 片方だけ bounds あり（way/relation）なら: 距離差が
 *     BBOX_PREFERENCE_MAX_DIFF_KM 以内なら bounds あり側を残す（検索エリアが
 *     bounds から決まるため。例: 「岡山大学 津島キャンパス」はキャンパス範囲
 *     を持つ relation を、同名の標識 node ではなく残す）。しきい値を超える
 *     距離差なら近い方（別の施設と見なす）
 * - displayName（= name）・type・addresstype・prefecture・city・distanceKm
 *   を付与
 * - 並び順:
 *   - 検索語の末尾が施設種別名（trailingTypeLabel）の場合: 種別一致候補
 *     （facilityTypeLabel がその種別名と一致する候補）を先に並べる。
 *     一致グループ内は bbox 面積の降順（キャンパス・施設敷地を優先）→
 *     距離の昇順。一致しない候補は従来どおり距離順（現在位置がある場合）。
 *     例: 「岡山大学」検索で「大学」（amenity=university）が「学校」（附属校）
 *     より先頭に来る
 *   - 末尾が種別名でない場合: 従来どおり距離順（現在位置がある場合）・
 *     なければ入力順
 * - maxCount 件で切り詰める
 * @param {Array} raw parseNameSearchResponse の戻り値
 * @param {{ lat: number, lon: number }|null} center 現在位置（未取得なら null）
 * @param {number} [maxCount=GEOCODE_CANDIDATE_LIMIT] 提示する候補の最大件数
 * @param {string} [query=''] 検索語（種別一致ランキングに使う）
 * @returns {Array} 候補（geocodeCandidates の戻り値と互換の形状）
 */
export function prepareNameSearchCandidates(raw, center, maxCount = GEOCODE_CANDIDATE_LIMIT, query = '') {
  const list = Array.isArray(raw) ? raw : []
  if (!list.length) return []

  const distFrom = (c) =>
    center ? haversineKm(center.lat, center.lon, c.lat, c.lon) : null

  // 同名の候補を1件に集約（bounds あり側を優先し、距離差が近い場合は
  // bounds あり側を残す）
  const byName = new Map()
  for (const c of list) {
    const prev = byName.get(c.name)
    if (!prev) {
      byName.set(c.name, c)
      continue
    }
    const prevHasBbox = prev.boundingbox != null
    const curHasBbox = c.boundingbox != null
    if (prevHasBbox !== curHasBbox) {
      const withBbox = curHasBbox ? c : prev
      const withoutBbox = curHasBbox ? prev : c
      const diffKm =
        distFrom(withBbox) == null || distFrom(withoutBbox) == null
          ? 0
          : Math.abs(distFrom(withBbox) - distFrom(withoutBbox))
      if (diffKm <= BBOX_PREFERENCE_MAX_DIFF_KM) {
        byName.set(c.name, withBbox)
      } else if (center && distFrom(c) < distFrom(prev)) {
        byName.set(c.name, c)
      }
    } else if (center && distFrom(c) < distFrom(prev)) {
      byName.set(c.name, c)
    }
  }

  const withMeta = [...byName.values()].map((c) => ({
    ...c,
    type: '',
    addresstype: '',
    displayName: c.name,
    prefecture: '',
    city: '',
    distanceKm: center ? haversineKm(center.lat, center.lon, c.lat, c.lon) : undefined
  }))

  const dist = (c) => (center ? c.distanceKm : 0)
  const bboxArea = (c) => (c.boundingbox ? calculateBboxAreaKm2(c.boundingbox) : 0)

  let ranked
  const typeLabel = trailingTypeLabel(query)
  if (typeLabel) {
    // 種別一致: 検索語末尾の種別名と facilityTypeLabel が一致する候補を先頭へ
    const isTypeMatch = (c) => facilityTypeLabel(c) === typeLabel
    const matches = withMeta.filter(isTypeMatch)
    const others = withMeta.filter((c) => !isTypeMatch(c))
    // 一致グループ: bbox 面積の降順（キャンパス・施設敷地を優先）→ 距離昇順
    matches.sort((a, b) => bboxArea(b) - bboxArea(a) || dist(a) - dist(b))
    // 非一致グループ: 距離順
    others.sort((a, b) => dist(a) - dist(b))
    ranked = [...matches, ...others]
  } else {
    // 末尾が種別名でない: 従来どおり（距離順・なければ入力順）
    ranked = [...withMeta]
    ranked.sort((a, b) => dist(a) - dist(b))
  }

  return ranked.slice(0, maxCount)
}

/**
 * Overpass 全国名前検索（地名ジオコード補完）。
 * Nominatim 候補のどれも name に検索語を含まない場合に呼ばれる。
 * geocodeCandidates と互換の形状で候補を返す。
 *
 * 一次エンドポイントのみを使う（フォールバック連鎖に乗せない）— 全国規模の
 * 名前正規表現検索を公共サーバーに投げないため。失敗（タイムアウト・通信
 * エラー等）は例外を投げずに空配列を返す — 呼び出し側は Nominatim 通常
 * フローに戻れる
 * @param {string} query 検索語
 * @param {{ center?: { lat: number, lon: number }|null, maxCount?: number }} [options]
 * @returns {Promise<Array>} 候補（見つからなかった・失敗時は空配列）
 */
export async function overpassNameSearch(query, { center = null, maxCount = GEOCODE_CANDIDATE_LIMIT } = {}) {
  const q = (query || '').trim()
  if (!q) return []
  try {
    const { results } = await executeOverpassQuery(buildNameSearchQuery(q), {
      parse: parseNameSearchResponse,
      fallback: false
    })
    return prepareNameSearchCandidates(results, center, maxCount, q)
  } catch (error) {
    console.warn('[geocode] Overpass 名前検索に失敗しました:', error.message)
    return []
  }
}

export function squareBboxAround(center, sideKm = 1.5) {
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
export function searchAreaFromGeocode(result, { sideKm = 1.5, thresholdKm2 = 1 } = {}) {
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
