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
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { geocode, geocodeCandidates, geocodeCandidateLabel, searchAreaFromGeocode } from '../geo'

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

// ---------- searchAreaFromGeocode との互換 ----------

describe('searchAreaFromGeocode の候補互換', () => {
  it('geocodeCandidates の候補オブジェクトをそのまま渡せる（小さな範囲は約1km正方形に拡大）', () => {
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
    // 約1km（経度方向は緯度で短くなる）
    expect(area.north - area.south).toBeGreaterThan(0.004)
    expect(area.north - area.south).toBeLessThan(0.01)
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
