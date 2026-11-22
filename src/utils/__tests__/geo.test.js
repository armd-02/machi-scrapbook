/**
 * geo.js のジオコード関数のユニットテスト（fetch をモックしネットワークなし）
 *
 * - geocode（既存）: limit=1 の単一結果・空クエリ・空結果・エラー
 * - geocodeCandidates（新規）: limit=40・addressdetails=1、都道府県・市区町村の
 *   抽出、boundingbox の形式、空結果、エラー
 * - geocodeCandidateLabel（新規）: 「名称（都道府県市区町村）」ラベル生成
 *   と各フォールバック
 * - レート制限: geocode と geocodeCandidates が 1リクエスト/秒 を共有する
 * - searchAreaFromGeocode が geocodeCandidates の候補オブジェクトにも使える
 * - calculateBboxAreaKm2 / isBboxTooLarge: BBOX面積の近似計算と
 *   「広すぎる」しきい値判定（MAX_SEARCH_AREA_KM2 = 1,000 km² 以上）。
 *   旧都道府県名ベースのガード（isPrefectureCandidate）を置き換える
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { geocode, geocodeCandidates, geocodeCandidateLabel, calculateBboxAreaKm2, isBboxTooLarge, isMunicipalityCandidate, MAX_SEARCH_AREA_KM2, searchAreaFromGeocode, sortCandidatesByDistance, buildNameSearchQuery, parseNameSearchResponse, prepareNameSearchCandidates, overpassNameSearch } from '../geo'
import { clearCache } from '../overpass'

// ---------- モックヘルパー ----------

/** Nominatim 応答行のファクトリ（デフォルトは鹿児島市の「上本町」） */
function nomiRow(overrides = {}) {
  return {
    lat: '31.5916',
    lon: '130.6975',
    display_name: '上本町, 鹿児島市, 鹿児島県, 日本',
    name: '上本町',
    type: 'suburb',
    boundingbox: ['31.58', '31.60', '130.68', '130.71'],
    address: { province: '鹿児島県', city: '鹿児島市' },
    ...overrides
  }
}

/** Nominatim の fetch をモック。urls にリクエストURLが記録される */
function mockNominatimFetch(rows) {
  const urls = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    urls.push(String(url))
    return { ok: true, status: 200, json: async () => rows }
  })
  return { spy, urls }
}

function parseParams(url) {
  return new URLSearchParams(String(url).split('?')[1] || '')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ---------- geocode（既存の挙動） ----------

describe('geocode（既存）', () => {
  it('limit=1・countrycodes=jp で Nominatim を呼び、最初の結果を従来の形式で返す', async () => {
    const { urls } = mockNominatimFetch([nomiRow(), nomiRow({ name: '別候補' })])
    const result = await geocode('上本町')

    const params = parseParams(urls[0])
    expect(params.get('q')).toBe('上本町')
    expect(params.get('limit')).toBe('1')
    expect(params.get('countrycodes')).toBe('jp')
    expect(params.get('format')).toBe('json')
    expect(params.get('addressdetails')).toBeNull()

    expect(result).toEqual({
      lat: 31.5916,
      lon: 130.6975,
      displayName: '上本町, 鹿児島市, 鹿児島県, 日本',
      type: 'suburb',
      boundingbox: { south: 31.58, north: 31.6, west: 130.68, east: 130.71 }
    })
  })

  it('空・空白クエリはリクエストなしで null を返す', async () => {
    const { urls } = mockNominatimFetch([])
    expect(await geocode('')).toBeNull()
    expect(await geocode('   ')).toBeNull()
    expect(urls).toHaveLength(0)
  })

  it('結果が空なら null を返す', async () => {
    mockNominatimFetch([])
    expect(await geocode('存在しない地名ZZZ')).toBeNull()
  })

  it('APIエラーなら例外を投げる', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    }))
    await expect(geocode('上本町')).rejects.toThrow('Nominatim APIエラー (500)')
  })
})

// ---------- geocodeCandidates（新規） ----------

describe('geocodeCandidates（複数候補）', () => {
  it('limit=40・addressdetails=1 で照会し、候補配列を指定した形式で返す', async () => {
    const rows = [
      nomiRow(),
      nomiRow({
        lat: '34.70',
        lon: '135.50',
        display_name: '上本町, 大阪市北区, 大阪府, 日本',
        boundingbox: ['34.69', '34.71', '135.49', '135.51'],
        address: { state: '大阪府', county: '北区', city: '大阪市' }
      })
    ]
    const { urls } = mockNominatimFetch(rows)
    const cands = await geocodeCandidates('上本町')

    const params = parseParams(urls[0])
    expect(params.get('q')).toBe('上本町')
    expect(params.get('limit')).toBe('40')
    expect(params.get('addressdetails')).toBe('1')
    expect(params.get('countrycodes')).toBe('jp')
    expect(params.get('format')).toBe('json')

    expect(cands).toHaveLength(2)
    expect(cands[0]).toEqual({
      lat: 31.5916,
      lon: 130.6975,
      displayName: '上本町, 鹿児島市, 鹿児島県, 日本',
      name: '上本町',
      prefecture: '鹿児島県',
      city: '鹿児島市',
      type: 'suburb',
      addresstype: '',
      kind: '',
      boundingbox: { south: 31.58, north: 31.6, west: 130.68, east: 130.71 }
    })
    expect(cands[1]).toMatchObject({
      lat: 34.7,
      lon: 135.5,
      displayName: '上本町, 大阪市北区, 大阪府, 日本',
      name: '上本町',
      prefecture: '大阪府',
      city: '大阪市',
      boundingbox: { south: 34.69, north: 34.71, west: 135.49, east: 135.51 }
    })
  })

  it('市区町村は city/town/village/municipality/borough のうち最初の非空を採用する', async () => {
    mockNominatimFetch([
      nomiRow({ address: { state: '奈良県', town: '橿原市' } }),
      nomiRow({ address: { state: '三重県', village: '亀山市' } }),
      nomiRow({ address: { state: '大阪府', county: '北区', municipality: '大阪市' }, lat: '34.70', lon: '135.50' }),
      nomiRow({ address: { state: '大阪府', city: '大阪市', town: '北区' }, lat: '34.75', lon: '135.55' })
    ])
    const cands = await geocodeCandidates('テスト地名')
    // city があれば city、なければ town→village→municipality→borough の順
    expect(cands.map((c) => c.city)).toEqual(['橿原市', '亀山市', '大阪市', '大阪市'])
    // 都道府県は常に state を採用
    expect(cands.map((c) => c.prefecture)).toEqual(['奈良県', '三重県', '大阪府', '大阪府'])
  })

  it('空・空白クエリはリクエストなしで空配列を返す', async () => {
    const { urls } = mockNominatimFetch([])
    expect(await geocodeCandidates('')).toEqual([])
    expect(await geocodeCandidates('   ')).toEqual([])
    expect(urls).toHaveLength(0)
  })

  it('結果が空なら空配列を返す', async () => {
    mockNominatimFetch([])
    expect(await geocodeCandidates('存在しない地名ZZZ')).toEqual([])
  })

  it('boundingbox がない候補は boundingbox: null、address が無い場合もラベル生成できる', async () => {
    mockNominatimFetch([nomiRow({ boundingbox: undefined, address: undefined })])
    const [cand] = await geocodeCandidates('某駅')
    expect(cand.boundingbox).toBeNull()
    expect(cand.prefecture).toBe('')
    expect(cand.city).toBe('')
    expect(cand.name).toBe('上本町')
  })

  it('APIエラーなら例外を投げる', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: false,
      status: 429,
      json: async () => ({})
    }))
    await expect(geocodeCandidates('上本町')).rejects.toThrow('Nominatim APIエラー (429)')
  })
})

// ---------- レート制限の共有 ----------

describe('レート制限（1リクエスト/秒）の共有', () => {
  it('geocode の直後の geocodeCandidates は間隔を待って送信する（共有している）', async () => {
    vi.useFakeTimers()
    const callTimes = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callTimes.push(Date.now())
      return { ok: true, status: 200, json: async () => [nomiRow()] }
    })
    // このファイル内の先行テストが残した待機を解消する
    await vi.advanceTimersByTimeAsync(5000)

    const p1 = geocode('地名A')
    await vi.advanceTimersByTimeAsync(100)
    await p1
    expect(callTimes).toHaveLength(1)

    // 直後の2リクエスト目: 1秒間隔のためまだ送信されない
    const p2 = geocodeCandidates('地名B')
    await vi.advanceTimersByTimeAsync(500)
    expect(callTimes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    await p2
    expect(callTimes).toHaveLength(2)
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1000)
  })
})

// ---------- geocodeCandidateLabel（新規） ----------

describe('geocodeCandidateLabel（候補ラベル）', () => {
  it('名称＋都道府県＋市区町村: 「名称（都道府県市区町村）」', () => {
    expect(geocodeCandidateLabel({ name: '上本町', prefecture: '鹿児島県', city: '鹿児島市' }))
      .toBe('上本町（鹿児島県鹿児島市）')
    expect(geocodeCandidateLabel({ name: '八幡', prefecture: '福岡県', city: '北九州市' }))
      .toBe('八幡（福岡県北九州市）')
  })

  it('市区町村がない場合は都道府県だけ: 「名称（都道府県）」', () => {
    expect(geocodeCandidateLabel({ name: '那覇', prefecture: '沖縄県', city: '' }))
      .toBe('那覇（沖縄県）')
  })

  it('名称は displayName の先頭コンマ区切り部分フォールバック', () => {
    expect(geocodeCandidateLabel({ name: null, prefecture: '大阪府', city: '大阪市', displayName: '梅田1丁目, 大阪市北区, 大阪府, 日本' }))
      .toBe('梅田1丁目（大阪府大阪市）')
  })

  it('都道府県・市区町村・名称が全て無い場合は displayName 先頭部分のみ', () => {
    expect(geocodeCandidateLabel({ name: '', prefecture: '', city: '', displayName: '梅田, 大阪市北区, 大阪府, 日本' }))
      .toBe('梅田')
  })

  it('displayName も無い場合は空文字列', () => {
    expect(geocodeCandidateLabel({})).toBe('')
  })
})

// ---------- 面積ベースの「広すぎる」判定（旧都道府県ガードの置き換え） ----------

// 面積計算（calculateBboxAreaKm2）と同じ式（地球半径6371km、経度方向を
// cos(緯度) で補正）を使って、面積が指定値 km² になる BBOX を作るヘルパー。
// 中心は緯度 latMid・経度135。テストでBBOXを構成し、判定関数がその面積を
// 正しく計算していることを検証するのに使う
const TEST_KM_PER_DEG = (Math.PI / 180) * 6371
function makeBboxAtArea(latMid, dLatKm, areaKm2) {
  const dLonKm = areaKm2 / dLatKm
  const cosMid = Math.cos((latMid * Math.PI) / 180)
  const halfLat = dLatKm / 2 / TEST_KM_PER_DEG
  const halfLon = dLonKm / 2 / (TEST_KM_PER_DEG * cosMid)
  return {
    south: latMid - halfLat,
    north: latMid + halfLat,
    west: 135 - halfLon,
    east: 135 + halfLon
  }
}

// 大阪府の実境界（都道府県サイズ。約25,800 km²）
const OSAKA_PREF_BBOX = { south: 33.4342, north: 35.0240, west: 135.2802, east: 136.8672 }

// 駅サイズ（点状・約0.04 km²）
const STATION_BBOX = { south: 34.699, north: 34.701, west: 135.499, east: 135.501 }

describe('calculateBboxAreaKm2（BBOX概算面積）', () => {
  it('都道府県サイズ（大阪府）は数万 km² になる', () => {
    const area = calculateBboxAreaKm2(OSAKA_PREF_BBOX)
    expect(area).toBeGreaterThan(20000)
    expect(area).toBeLessThan(32000)
  })

  it('市サイズ（15km × 15km）は約 225 km² になる', () => {
    const area = calculateBboxAreaKm2(makeBboxAtArea(35, 15, 225))
    expect(area).toBeCloseTo(225, 1)
  })

  it('駅サイズ（点状）は 1 km² 未満になる', () => {
    const area = calculateBboxAreaKm2(STATION_BBOX)
    expect(area).toBeGreaterThan(0)
    expect(area).toBeLessThan(1)
  })

  it('経度方向は緯度が高いほど短くなる（cos 補正）', () => {
    const low = calculateBboxAreaKm2({ south: 30, north: 31, west: 130, east: 131 })
    const high = calculateBboxAreaKm2({ south: 43, north: 44, west: 140, east: 141 })
    expect(low).toBeGreaterThan(high)
  })
})

describe('isBboxTooLarge（1,000 km² しきい値判定）', () => {
  it('しきい値定数 MAX_SEARCH_AREA_KM2 は 1,000 km²', () => {
    expect(MAX_SEARCH_AREA_KM2).toBe(1000)
  })

  it('都道府県サイズのBBOX（大阪府・約25,800 km²）は true', () => {
    expect(isBboxTooLarge(OSAKA_PREF_BBOX)).toBe(true)
  })

  it('国サイズのBBOX（日本・約263万 km²）は true', () => {
    expect(isBboxTooLarge({ south: 30.5, north: 45.5, west: 128.0, east: 146.0 })).toBe(true)
  })

  it('市サイズのBBOX（約225 km²）は false', () => {
    expect(isBboxTooLarge(makeBboxAtArea(35, 15, 225))).toBe(false)
  })

  it('駅サイズのBBOX（約0.04 km²）は false', () => {
    expect(isBboxTooLarge(STATION_BBOX)).toBe(false)
  })

  it('しきい値ちょうど（1,000 km²）は広すぎる（>= 扱い）、1 km² 未満では false', () => {
    const at = makeBboxAtArea(35, 25, MAX_SEARCH_AREA_KM2)
    expect(calculateBboxAreaKm2(at)).toBeCloseTo(1000, 6)
    expect(isBboxTooLarge(at)).toBe(true)

    const below = makeBboxAtArea(35, 25, MAX_SEARCH_AREA_KM2 - 1)
    expect(calculateBboxAreaKm2(below)).toBeCloseTo(999, 6)
    expect(isBboxTooLarge(below)).toBe(false)
  })

  it('boundingbox がない（点状）候補や無効なBBOXは広すぎとはみなさない', () => {
    expect(isBboxTooLarge(null)).toBe(false)
    expect(isBboxTooLarge(undefined)).toBe(false)
    // 順序が逆転したBBOX（south > north）は無効
    expect(isBboxTooLarge({ south: 35.1, north: 35.0, west: 135, east: 135.1 })).toBe(false)
  })
})

// ---------- 市区町村判定（「広すぎる」ガードの例外） ----------

describe('isMunicipalityCandidate（市区町村判定）', () => {
  it('自治体データ由来の候補（kind="自治体"）は市区町村', () => {
    // municipalityToCandidate の戻り値形状（addresstype は無い）
    expect(isMunicipalityCandidate({ kind: '自治体', name: '高山市' })).toBe(true)
  })

  it('Nominatim 候補の addresstype が市区町村レベルなら市区町村', () => {
    for (const addresstype of ['city', 'town', 'village', 'municipality', 'borough']) {
      expect(isMunicipalityCandidate({ addresstype })).toBe(true)
    }
  })

  it('Nominatim 候補の addresstype が都道府県・国なら市区町村ではない', () => {
    // 実 Nominatim: 高山市→city、揖斐川町→town、香川県→province、日本→country
    for (const addresstype of ['province', 'state', 'country', 'county', 'suburb', 'hamlet', 'railway', '']) {
      expect(isMunicipalityCandidate({ addresstype })).toBe(false)
    }
  })

  it('addresstype・kind が無い候補、null・undefined は市区町村ではない', () => {
    expect(isMunicipalityCandidate({})).toBe(false)
    expect(isMunicipalityCandidate({ name: '大阪駅' })).toBe(false)
    expect(isMunicipalityCandidate(null)).toBe(false)
    expect(isMunicipalityCandidate(undefined)).toBe(false)
  })

  it('geocodeCandidates が Nominatim の addresstype を候補に載せる', async () => {
    // 「高山市」の実 Nominatim 応答に近い行（boundary/administrative・addresstype=city）
    mockNominatimFetch([
      nomiRow({
        name: '高山市',
        display_name: '高山市, 岐阜県, 日本',
        class: 'boundary',
        type: 'administrative',
        addresstype: 'city',
        boundingbox: ['35.8974890', '36.3929960', '136.7539670', '137.6530540'],
        address: {}
      })
    ])
    const cs = await geocodeCandidates('高山市')
    expect(cs[0].addresstype).toBe('city')
    expect(isMunicipalityCandidate(cs[0])).toBe(true)
  })
})

// ---------- searchAreaFromGeocode との互換 ----------

describe('searchAreaFromGeocode の候補互換', () => {
  it('geocodeCandidates の候補オブジェクトをそのまま渡せる（小さな範囲は約1.5km正方形に拡大）', () => {
    const cand = {
      lat: 34.7,
      lon: 135.5,
      displayName: '大阪駅, 大阪市浪速区, 大阪府, 日本',
      name: '大阪駅',
      prefecture: '大阪府',
      city: '大阪市',
      type: 'railway_station',
      // 約220m×210m（面積が1km²未満 → 拡大される）
      boundingbox: { south: 34.699, north: 34.701, west: 135.499, east: 135.501 }
    }
    const area = searchAreaFromGeocode(cand)
    expect(area.south).toBeLessThan(34.7)
    expect(area.north).toBeGreaterThan(34.7)
    expect(area.west).toBeLessThan(135.5)
    expect(area.east).toBeGreaterThan(135.5)
    // 約1.5km（経度方向は緯度で短くなる）
    expect(area.north - area.south).toBeGreaterThan(0.012)
    expect(area.north - area.south).toBeLessThan(0.015)
  })

  it('既定の検索エリアは1.5km四方（±0.75km）になる（十三駅の回帰例）', () => {
    // 実例: 十三駅から「食べる」で検索した際、Cafe yutte（中心から北約0.54km・
    // 東約0.56km、直線約0.78km）が1km四方では両方向ともわずかに外側で
    // 見つからなかった。1.5km四方ならエリア内に入る。
    const cand = {
      lat: 34.7,
      lon: 135.5,
      displayName: '十三駅',
      name: '十三駅',
      type: 'railway_station'
      // 点状（boundingbox なし）
    }
    const area = searchAreaFromGeocode(cand)

    // 一辺1.5km: 緯度方向のspanは約0.0135度
    expect(area.north - area.south).toBeGreaterThan(0.012)
    expect(area.north - area.south).toBeLessThan(0.015)
    // 経度方向のspanは約0.0164度（1km四方の約0.0109度の1.5倍）
    expect(area.east - area.west).toBeGreaterThan(0.014)
    expect(area.east - area.west).toBeLessThan(0.018)

    // Cafe yutte 相当の点（北0.54km・東0.56km）がエリア内に入る
    const cafe = { lat: 34.70486, lon: 135.50613 }
    expect(cafe.lat).toBeGreaterThan(area.south)
    expect(cafe.lat).toBeLessThan(area.north)
    expect(cafe.lon).toBeGreaterThan(area.west)
    expect(cafe.lon).toBeLessThan(area.east)

    // 旧1km四方では外側だったこと（回帰の区別）
    const old = { south: 34.7 - 0.5 / 111.1949266, north: 34.7 + 0.5 / 111.1949266 }
    expect(cafe.lat).toBeGreaterThan(old.north)
  })
})

describe('geocodeCandidates — 同名候補の区別と重複除去', () => {
  it('同名・同住所でも種別が違えばラベルで区別できる（大阪駅の例）', async () => {
    mockNominatimFetch([
      nomiRow({ name: '大阪駅', display_name: '大阪駅, 大阪市, 大阪府, 日本', class: 'building', type: 'train_station', address: { province: '大阪府', city: '大阪市' }, lat: '34.7023', lon: '135.4955' }),
      nomiRow({ name: '大阪駅', display_name: '大阪駅, 大阪市, 大阪府, 日本', class: 'highway', type: 'bus_stop', address: { province: '大阪府', city: '大阪市' }, lat: '34.7015', lon: '135.4944' }),
      nomiRow({ name: '大阪駅', display_name: '大阪駅, 大阪市, 大阪府, 日本', class: 'amenity', type: 'bicycle_rental', address: { province: '大阪府', city: '大阪市' }, lat: '34.7028', lon: '135.4942' })
    ])
    const cs = await geocodeCandidates('大阪駅')
    expect(cs).toHaveLength(3)
    expect(cs.map((c) => geocodeCandidateLabel(c))).toEqual([
      '大阪駅（駅・大阪府大阪市）',
      '大阪駅（バス停・大阪府大阪市）',
      '大阪駅（レンタサイクル・大阪府大阪市）'
    ])
  })

  it('同じラベルで中心が近い重複候補は1件にまとめる', async () => {
    mockNominatimFetch([
      nomiRow({ class: 'railway', type: 'station', lat: '34.70230', lon: '135.49550' }),
      nomiRow({ class: 'railway', type: 'station', lat: '34.70235', lon: '135.49555' }),
      nomiRow({ class: 'place', type: 'quarter', lat: '34.71000', lon: '135.50000' })
    ])
    const cs = await geocodeCandidates('上本町')
    expect(cs).toHaveLength(2)
  })

  it('地名候補（place）は種別なしの従来ラベル', async () => {
    mockNominatimFetch([nomiRow({ class: 'place', type: 'quarter' })])
    const cs = await geocodeCandidates('上本町')
    expect(geocodeCandidateLabel(cs[0])).toBe('上本町（鹿児島県鹿児島市）')
  })
})

// ---------- sortCandidatesByDistance（viewbox 付きジオコードの距離順再ソート） ----------

describe('sortCandidatesByDistance（viewbox 付きの距離順再ソート）', () => {
  const UMEMO = { lat: 34.7, lon: 135.5 }

  const cand = (name, lat, lon, prefecture) => ({
    lat,
    lon,
    name,
    displayName: `${name}, ${prefecture}`,
    prefecture,
    city: '',
    kind: '',
    boundingbox: null
  })

  it('現在位置からの距離が近い順に並び替える', () => {
    // 距離: B 約0.15km < C 約14km < A（東京）約397km < D（鹿児島）約564km
    const cands = [
      cand('遠いA', 35.7, 139.7, '東京都'),      // 東京（約397km）
      cand('近いB', 34.701, 135.501, '大阪府'),  // 約0.15km
      cand('中C', 34.8, 135.6, '大阪府'),        // 約14km
      cand('遠いD', 31.5916, 130.6975, '鹿児島県') // 約564km
    ]
    const sorted = sortCandidatesByDistance(cands, UMEMO, 5)
    expect(sorted.map((c) => c.name)).toEqual(['近いB', '中C', '遠いA', '遠いD'])
  })

  it('maxCount を超える場合は先頭 N 件のみ残す', () => {
    // 距離: 1番目 0km < 2番目 約1.5km < 3番目 約14km < 4番目 約178km <
    // 6番目（東京）約397km < 5番目（鹿児島）約564km
    const cands = [
      cand('5番目', 31.5916, 130.6975, '鹿児島県'),
      cand('2番目', 34.71, 135.51, '大阪府'),
      cand('3番目', 34.8, 135.6, '大阪府'),
      cand('1番目', 34.7, 135.5, '大阪府'),
      cand('4番目', 33.2, 134.9, '三重県'),
      cand('6番目', 35.7, 139.7, '東京都')
    ]
    const sorted = sortCandidatesByDistance(cands, UMEMO, 5)
    expect(sorted).toHaveLength(5)
    expect(sorted.map((c) => c.name)).toEqual(['1番目', '2番目', '3番目', '4番目', '6番目'])
  })

  it('入力を原地で並べ替えない（コピーして返す）', () => {
    const cands = [
      cand('遠いA', 35.7, 139.7, '東京都'),
      cand('近いB', 34.701, 135.501, '大阪府')
    ]
    sortCandidatesByDistance(cands, UMEMO, 5)
    expect(cands.map((c) => c.name)).toEqual(['遠いA', '近いB'])
  })

  it('center が null・空配列の場合はそのまま返す', () => {
    const cands = [cand('A', 34.7, 135.5, '大阪府')]
    expect(sortCandidatesByDistance(cands, null, 5)).toEqual(cands)
    expect(sortCandidatesByDistance([], UMEMO, 5)).toEqual([])
  })
})

// ---------- Overpass 名前検索補完（地名検索のフォールバック） ----------
//
// 背景: Nominatim は「検索語と完全に同名の要素」しか返さないため、名称が
// 正確に存在しない POI（例: 「岡山大学」→「岡山大学 津島キャンパス」）は
// どんなに絞り込んでも候補にならない。そこで「Nominatim 候補のどれも
// name に検索語を含まない」場合だけ、Overpass の全国名前検索で補完する。
//
// - 補完のトリガ判定（name 部分一致チェック）は MobileSearchTab 側で行う
// - エンドポイントは一次（armd-01）のみ（フォールバック連鎖に乗せない）
// - 候補は geocodeCandidates と互換の形状（way/relation は bounds 中心）
// - 同名候補は1件に集約・GEOCODE_CANDIDATE_LIMIT（40）件上限・現在位置がある場合は距離順

describe('buildNameSearchQuery（全国名前検索）', () => {
  it('範囲指定なし（全国）のクエリを [timeout:25] で生成する', () => {
    expect(buildNameSearchQuery('岡山大学'))
      .toBe('[out:json][timeout:25];nwr["name"~"岡山大学"];out bb;')
  })

  it('正規表現メタ文字をエスケープする（検索語をリテラル文字列として扱う）', () => {
    expect(buildNameSearchQuery('A.B')).toContain('nwr["name"~"A\\\\.B"]')
    expect(buildNameSearchQuery('A+B')).toContain('nwr["name"~"A\\\\+B"]')
    expect(buildNameSearchQuery('A(B)')).toContain('nwr["name"~"A\\\\(B\\\\)"]')
  })

  it('バックスラッシュ・二重引用符は QL 引用符値用にエスケープする', () => {
    expect(buildNameSearchQuery('A"B')).toContain('nwr["name"~"A\\"B"]')
    expect(buildNameSearchQuery('A\\B')).toContain('nwr["name"~"A\\\\\\\\B"]')
  })

  it('検索語を trim する', () => {
    expect(buildNameSearchQuery('  岡山大学  '))
      .toBe('[out:json][timeout:25];nwr["name"~"岡山大学"];out bb;')
  })
})

describe('parseNameSearchResponse（Overpass 応答の解析）', () => {
  it('node: 自身の座標を使い、boundingbox は null', () => {
    const out = parseNameSearchResponse({
      elements: [
        { type: 'node', id: 1, lat: 34.651, lon: 133.921, tags: { name: '岡山大学病院', amenity: 'hospital' } }
      ]
    })
    expect(out).toEqual([
      {
        lat: 34.651, lon: 133.921, name: '岡山大学病院', kind: '施設',
        tags: { name: '岡山大学病院', amenity: 'hospital' },
        boundingbox: null
      }
    ])
  })

  it('way: bounds 中心を lat/lon にし、bounds を boundingbox にする', () => {
    const out = parseNameSearchResponse({
      elements: [
        {
          type: 'way', id: 2,
          bounds: { minlat: 34.64, minlon: 133.91, maxlat: 34.65, maxlon: 133.92 },
          tags: { name: '岡山大学 鹿田キャンパス', amenity: 'university' }
        }
      ]
    })
    expect(out).toEqual([
      {
        lat: (34.64 + 34.65) / 2,
        lon: (133.91 + 133.92) / 2,
        name: '岡山大学 鹿田キャンパス',
        kind: '施設',
        tags: { name: '岡山大学 鹿田キャンパス', amenity: 'university' },
        boundingbox: { south: 34.64, west: 133.91, north: 34.65, east: 133.92 }
      }
    ])
  })

  it('relation: way と同じ（bounds 中心）', () => {
    const out = parseNameSearchResponse({
      elements: [
        {
          type: 'relation', id: 3,
          bounds: { minlat: 34.6837964, minlon: 133.9120218, maxlat: 34.6908282, maxlon: 133.9269967 },
          tags: { name: '岡山大学 津島キャンパス', amenity: 'university' }
        }
      ]
    })
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('岡山大学 津島キャンパス')
    expect(out[0].lat).toBeCloseTo((34.6837964 + 34.6908282) / 2)
    expect(out[0].boundingbox).toEqual({
      south: 34.6837964, west: 133.9120218, north: 34.6908282, east: 133.9269967
    })
  })

  it('name タグが無い要素は除外する', () => {
    const out = parseNameSearchResponse({
      elements: [
        { type: 'node', id: 1, lat: 34.65, lon: 133.92, tags: { amenity: 'hospital' } },
        { type: 'way', id: 2, bounds: { minlat: 34.6, minlon: 133.9, maxlat: 34.7, maxlon: 134.0 }, tags: { building: 'yes' } }
      ]
    })
    expect(out).toEqual([])
  })

  it('座標が無い node・bounds が無い way は除外する', () => {
    const out = parseNameSearchResponse({
      elements: [
        { type: 'node', id: 1, tags: { name: '無座標ノード' } },
        { type: 'way', id: 2, tags: { name: '無Boundsウェイ' } }
      ]
    })
    expect(out).toEqual([])
  })

  it('kind マッピング: amenity→施設、public_transport→停留所、building→建物、leisure=park→公園、タグ無し→空', () => {
    const out = parseNameSearchResponse({
      elements: [
        { type: 'node', id: 1, lat: 34.7, lon: 135.5, tags: { name: 'A', amenity: 'cafe' } },
        { type: 'node', id: 2, lat: 34.7, lon: 135.5, tags: { name: 'B', highway: 'bus_stop', public_transport: 'platform' } },
        { type: 'node', id: 3, lat: 34.7, lon: 135.5, tags: { name: 'C', building: 'yes' } },
        { type: 'way', id: 4, bounds: { minlat: 34.7, minlon: 135.5, maxlat: 34.71, maxlon: 135.51 }, tags: { name: 'D', leisure: 'park' } },
        { type: 'node', id: 5, lat: 34.7, lon: 135.5, tags: { name: 'E' } }
      ]
    })
    expect(out.map((c) => c.kind)).toEqual(['施設', '停留所', '建物', '公園', ''])
  })
})

describe('prepareNameSearchCandidates（同名集約と上限）', () => {
  // 「岡山大学筋」が2つの要素（停留所等）として返るケースを再現するフィクスチャ
  const rawFixture = () => [
    { lat: 34.681, lon: 133.921, name: '岡山大学筋', kind: '停留所', boundingbox: null },
    { lat: 34.682, lon: 133.922, name: '岡山大学筋', kind: '停留所', boundingbox: null },
    { lat: 34.651, lon: 133.921, name: '岡山大学病院', kind: '施設', boundingbox: null },
    { lat: 34.69, lon: 133.915, name: '岡山大学 津島キャンパス', kind: '施設', boundingbox: { south: 34.68, west: 133.91, north: 34.69, east: 133.93 } }
  ]

  it('同名の候補を1件に集約する（現在位置がないなら先頭を残す）', () => {
    const out = prepareNameSearchCandidates(rawFixture(), null)
    expect(out).toHaveLength(3)
    const shiro = out.find((c) => c.name === '岡山大学筋')
    expect(shiro.lon).toBe(133.921)
  })

  it('同名の候補を1件に集約する（現在位置があるなら最近接を残す）', () => {
    // 現在位置（34.682, 133.922）は2つ目の「岡山大学筋」に近い
    const out = prepareNameSearchCandidates(rawFixture(), { lat: 34.682, lon: 133.922 })
    const shiro = out.find((c) => c.name === '岡山大学筋')
    expect(shiro.lon).toBe(133.922)
  })

  it('displayName（= name）・空のprefecture/city・distanceKm を付与する', () => {
    const out = prepareNameSearchCandidates(rawFixture(), { lat: 34.7, lon: 135.5 })
    for (const c of out) {
      expect(c.displayName).toBe(c.name)
      expect(c.prefecture).toBe('')
      expect(c.city).toBe('')
      expect(c.distanceKm).toBeGreaterThan(0)
    }
  })

  it('maxCount を超える場合は距離順にソートして切り詰める', () => {
    const raw = []
    for (let i = 1; i <= 7; i++) {
      raw.push({ lat: 34.6 + 0.01 * i, lon: 133.9 + 0.01 * i, name: `施設${i}`, kind: '施設', boundingbox: null })
    }
    const center = { lat: 34.61, lon: 133.91 }
    const out = prepareNameSearchCandidates(raw, center, 5)
    expect(out).toHaveLength(5)
    expect(out.map((c) => c.name)).toEqual(['施設1', '施設2', '施設3', '施設4', '施設5'])
  })

  it('空の入力は空配列を返す', () => {
    expect(prepareNameSearchCandidates([], { lat: 34.7, lon: 135.5 })).toEqual([])
    expect(prepareNameSearchCandidates(null, null)).toEqual([])
  })
})

describe('prepareNameSearchCandidates（種別一致ランキングとbounds優先集約）', () => {
  // 実「岡山大学」データに近いモック（2026-11 実測）:
  // 附属校（amenity=school）は現在位置（鹿田方面）に近く、大学本体
  // （amenity=university）は少し遠い。津島キャンパスは bounds 付き
  // relation と同名の標識 node が両方存在する。
  const okayamaElements = () => [
    { type: 'node', id: 1, lat: 34.6375, lon: 133.9481, tags: { name: '岡山大学附属特別支援学校', amenity: 'school' } },
    { type: 'node', id: 2, lat: 34.654, lon: 133.9435, tags: { name: '岡山大学附属小学校', amenity: 'school' } },
    { type: 'node', id: 3, lat: 34.6528, lon: 133.9431, tags: { name: '岡山大学附属中学校', amenity: 'school' } },
    { type: 'relation', id: 4, bounds: { minlat: 34.683, minlon: 133.915, maxlat: 34.692, maxlon: 133.924 }, tags: { name: '岡山大学 津島キャンパス', amenity: 'university' } },
    { type: 'node', id: 5, lat: 34.6855, lon: 133.9196, tags: { name: '岡山大学 津島キャンパス', tourism: 'information' } },
    { type: 'way', id: 6, bounds: { minlat: 34.649, minlon: 133.918, maxlat: 34.652, maxlon: 133.922 }, tags: { name: '岡山大学 鹿田キャンパス', amenity: 'university' } }
  ]
  // 現在位置は鹿田方面（附属校に近い）
  const center = { lat: 34.64, lon: 133.95 }
  const candidates = (query) =>
    prepareNameSearchCandidates(
      parseNameSearchResponse({ elements: okayamaElements() }),
      center, 5, query
    )

  it('検索語の末尾が種別名のとき、その種別と一致する候補を先頭にする（本体を附属校より優先）', () => {
    expect(candidates('岡山大学').map((c) => c.name)).toEqual([
      '岡山大学 津島キャンパス',   // 大学・bbox面積最大
      '岡山大学 鹿田キャンパス',   // 大学
      '岡山大学附属特別支援学校',  // 学校（最近接）
      '岡山大学附属中学校',
      '岡山大学附属小学校'
    ])
  })

  it('同名集約は bounds 付き way/relation を残す（津島キャンパスは relation 側）', () => {
    const cands = candidates('岡山大学')
    const tsushima = cands.find((c) => c.name === '岡山大学 津島キャンパス')
    expect(tsushima.boundingbox).not.toBeNull() // 標識 node ではなく bounds 付き relation
    expect(tsushima.lat).toBeCloseTo((34.683 + 34.692) / 2)
  })

  it('検索語の末尾が種別名でない場合は従来の距離順を維持する', () => {
    expect(candidates('岡山大学 津島キャンパス').map((c) => c.name)).toEqual([
      '岡山大学附属特別支援学校',
      '岡山大学附属中学校',
      '岡山大学附属小学校',
      '岡山大学 鹿田キャンパス',
      '岡山大学 津島キャンパス'
    ])
  })

  it('同名集約: 現在位置がない場合も bounds あり側を優先する', () => {
    const els = [
      { type: 'node', id: 1, lat: 34.7, lon: 135.5, tags: { name: '某建物', building: 'yes' } },
      { type: 'way', id: 2, bounds: { minlat: 34.7, minlon: 135.51, maxlat: 34.701, maxlon: 135.511 }, tags: { name: '某建物', building: 'yes' } }
    ]
    const cands = prepareNameSearchCandidates(
      parseNameSearchResponse({ elements: els }), null, 5, '某建物'
    )
    expect(cands).toHaveLength(1)
    expect(cands[0].boundingbox).not.toBeNull()
  })

  it('同名集約: 距離差がしきい値を超える場合は近い方（node）を残す', () => {
    const els = [
      { type: 'node', id: 1, lat: 34.7, lon: 135.5, tags: { name: '某建物', building: 'yes' } },
      { type: 'way', id: 2, bounds: { minlat: 34.85, minlon: 135.55, maxlat: 34.851, maxlon: 135.551 }, tags: { name: '某建物', building: 'yes' } }
    ]
    const cands = prepareNameSearchCandidates(
      parseNameSearchResponse({ elements: els }), { lat: 34.7, lon: 135.5 }, 5, '某建物'
    )
    expect(cands).toHaveLength(1)
    expect(cands[0].boundingbox).toBeNull()
  })
})

describe('overpassNameSearch（Overpass 全国名前検索）', () => {
  beforeEach(() => {
    // 前テストの Overpass キャッシュが残らないようにする
    clearCache()
  })

  // 「岡山大学」の Overpass 応答（実レスポンスの形状を再現）
  const NAME_ELEMENTS = {
    elements: [
      { type: 'node', id: 101, lat: 34.651, lon: 133.921, tags: { name: '岡山大学病院', amenity: 'hospital' } },
      { type: 'way', id: 202, bounds: { minlat: 34.648, minlon: 133.95, maxlat: 34.653, maxlon: 133.97 }, tags: { name: '岡山大学 鹿田キャンパス', amenity: 'university' } },
      { type: 'relation', id: 303, bounds: { minlat: 34.684, minlon: 134.01, maxlat: 34.691, maxlon: 134.03 }, tags: { name: '岡山大学 津島キャンパス', amenity: 'university' } }
    ]
  }

  function mockOverpassFetch(response, { fail = false } = {}) {
    const calls = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const u = String(url)
      const q = new URLSearchParams(options.body || '').get('data') || (options.body || '')
      calls.push({ url: u, q })
      if (fail) throw new Error('network down')
      if (!u.includes('interpreter')) {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      return { ok: true, status: 200, json: async () => response }
    })
    return { spy, calls }
  }

  it('全国名前検索クエリを一次エンドポイント（armd-01）にだけ送り、候補を返す', async () => {
    const { calls } = mockOverpassFetch(NAME_ELEMENTS)
    const cands = await overpassNameSearch('岡山大学', { center: { lat: 34.7, lon: 135.5 } })

    // 1リクエストのみ（フォールバック連鎖に乗せない）
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://armd-01.sakura.ne.jp/api/interpreter')
    expect(calls[0].q).toBe('[out:json][timeout:25];nwr["name"~"岡山大学"];out bb;')

    // geocodeCandidates と互換の形状・種別一致順（「岡山大学」は末尾が
    // 「大学」→ amenity=university 候補を bbox 面積降順で先頭、病院はそれ以降）
    expect(cands.map((c) => c.name)).toEqual([
      '岡山大学 津島キャンパス',
      '岡山大学 鹿田キャンパス',
      '岡山大学病院'
    ])
    expect(cands[0]).toEqual({
      lat: (34.684 + 34.691) / 2,
      lon: (134.01 + 134.03) / 2,
      name: '岡山大学 津島キャンパス',
      kind: '施設',
      tags: { name: '岡山大学 津島キャンパス', amenity: 'university' },
      boundingbox: { south: 34.684, west: 134.01, north: 34.691, east: 134.03 },
      type: '',
      addresstype: '',
      displayName: '岡山大学 津島キャンパス',
      prefecture: '',
      city: '',
      distanceKm: expect.any(Number)
    })
  })

  it('現在位置がない場合は距離順にしない（種別一致ランキングは適用される）', async () => {
    mockOverpassFetch(NAME_ELEMENTS)
    const cands = await overpassNameSearch('岡山大学')
    // 「岡山大学」は末尾が「大学」→ 大学候補（bbox 面積降順）が先頭、
    // それ以外は入力順（距離順ソートはされない）
    expect(cands.map((c) => c.name)).toEqual([
      '岡山大学 津島キャンパス',
      '岡山大学 鹿田キャンパス',
      '岡山大学病院'
    ])
    expect(cands[0].distanceKm).toBeUndefined()
  })

  it('失敗時は例外を投げずに空配列を返す', async () => {
    mockOverpassFetch(null, { fail: true })
    await expect(overpassNameSearch('岡山大学')).resolves.toEqual([])
  })

  it('要素が見つからない場合は空配列を返す', async () => {
    mockOverpassFetch({ elements: [] })
    await expect(overpassNameSearch('存在しない名前ZZZ')).resolves.toEqual([])
  })

  it('空のクエリはリクエストを出さず空配列を返す', async () => {
    const { spy } = mockOverpassFetch(NAME_ELEMENTS)
    await expect(overpassNameSearch('   ')).resolves.toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})
