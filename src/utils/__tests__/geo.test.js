/**
 * geo.js のジオコード関数のユニットテスト（fetch をモックしネットワークなし）
 *
 * - geocode（既存）: limit=1 の単一結果・空クエリ・空結果・エラー
 * - geocodeCandidates（新規）: limit=5・addressdetails=1、都道府県・市区町村の
 *   抽出、boundingbox の形式、空結果、エラー
 * - geocodeCandidateLabel（新規）: 「名称（都道府県市区町村）」ラベル生成
 *   と各フォールバック
 * - レート制限: geocode と geocodeCandidates が 1リクエスト/秒 を共有する
 * - searchAreaFromGeocode が geocodeCandidates の候補オブジェクトにも使える
 * - calculateBboxAreaKm2 / isBboxTooLarge: BBOX面積の近似計算と
 *   「広すぎる」しきい値判定（MAX_SEARCH_AREA_KM2 = 1,000 km² 以上）。
 *   旧都道府県名ベースのガード（isPrefectureCandidate）を置き換える
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { geocode, geocodeCandidates, geocodeCandidateLabel, calculateBboxAreaKm2, isBboxTooLarge, isMunicipalityCandidate, MAX_SEARCH_AREA_KM2, searchAreaFromGeocode, sortCandidatesByDistance } from '../geo'

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
  it('limit=5・addressdetails=1 で照会し、候補配列を指定した形式で返す', async () => {
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
    expect(params.get('limit')).toBe('5')
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
