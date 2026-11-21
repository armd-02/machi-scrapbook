/**
 * nearbyCandidates.js のユニットテスト
 *
 * - prepareNearbyCandidates: 重複除去・距離順・distanceKm/displayName の付与。
 *   上限8件（MAX_NEARBY_SUGGEST）での切り捨ては行わず、全件保持する
 *   （上限は「表示する候補」の上限でありキャッシュ全体の上限ではない）
 * - matchNearbyCandidates: 名前の部分一致照合・駅の「駅」省略マッチ。
 *   照合結果を表示上限（8件）に絞る
 *
 * 背景: 旧実装は prepareNearbyCandidates が先頭8件でキャッシュを切り捨て
 * ていたため、現在地近くに地区名などが8件以上あると、それより遠い駅が
 * キャッシュから落ち、「富田」で摂津富田駅が出ない、といった症状が発生
 * していた。
 */
import { describe, it, expect } from 'vitest'
import {
  haversineKm,
  buildNearbyQuery,
  parseNearbyResponse,
  approxBoundsAreaM2,
  prepareNearbyCandidates,
  matchNearbyCandidates,
  PARK_MIN_AREA_M2,
  MAX_NEARBY_SUGGEST
} from '../nearbyCandidates'

const CENTER = { lat: 34.7, lon: 135.5 }

/** 地区（place）候補のファクトリ */
const area = (name, lat, lon) => ({ lat, lon, name, kind: '地区' })
/** 駅候補のファクトリ */
const station = (name, lat, lon) => ({ lat, lon, name, kind: '駅' })

// ===== buildNearbyQuery / parseNearbyResponse（公園の面積フィルタ） =====
//
// 背景: 旧クエリの `(if: area() > 10000)` 節は実サーバー（armd-01 で HTTP 500、
// 公式 overpass-api.de で HTTP 400）に受け付けられず、周辺候補の取得が
// 常時失敗していた。節を除去し、公園の面積フィルタは `out bb` の bounds
// から近似面積を計算して parseNearbyResponse 側（端末側）で行う形にした。

describe('buildNearbyQuery: サーバーに受け付けられる形', () => {
  it('生成クエリに (if: ...) 節が含まれない', () => {
    const q = buildNearbyQuery(34.7, 135.5)
    expect(q).not.toContain('(if:')
    expect(q).not.toContain('area()')
  })

  it('駅・地区名・公園（way/relation）の取得節と out bb を含める', () => {
    const q = buildNearbyQuery(34.7, 135.5)
    expect(q).toContain('nwr["railway"="station"]["name"](around:5000,34.7,135.5);')
    expect(q).toContain('nwr["place"~"^(neighbourhood|quarter|suburb|locality)$"]["name"](around:5000,34.7,135.5);')
    expect(q).toContain('way["leisure"="park"]["name"](around:5000,34.7,135.5);')
    expect(q).toContain('relation["leisure"="park"]["name"](around:5000,34.7,135.5);')
    expect(q.endsWith('out bb;')).toBe(true)
  })
})

describe('parseNearbyResponse: 公園の面積フィルタ（端末側）', () => {
  /** 公園要素（way/relation）のファクトリ。sideDeg: 正方形の一辺の緯度・経度幅（度） */
  const park = (name, minlat, minlon, sideDeg, type = 'way') => ({
    type,
    tags: { name, leisure: 'park' },
    bounds: {
      minlat,
      minlon,
      maxlat: minlat + sideDeg,
      maxlon: minlon + sideDeg
    }
  })

  it('大きな公園（近似面積 > 10000m²）は候補に残る', () => {
    // 約220m × 約180m ≈ 40000m²
    const data = { elements: [park('大きな公園', 34.7, 135.5, 0.002)] }
    const out = parseNearbyResponse(data)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: '大きな公園', kind: '公園' })
    expect(out[0].boundingbox).toEqual({
      south: 34.7, west: 135.5, north: 34.7 + 0.002, east: 135.5 + 0.002
    })
  })

  it('小さい公園（近似面積 <= 10000m²）は候補から落ちる', () => {
    // 約56m × 約46m ≈ 2500m²
    const data = { elements: [park('小さな庭', 34.7, 135.5, 0.0005)] }
    expect(parseNearbyResponse(data)).toEqual([])
  })

  it('relation 型の公園も同じ面積フィルタが効く', () => {
    const data = { elements: [park('関係公園', 34.7, 135.5, 0.002, 'relation')] }
    expect(parseNearbyResponse(data).map((c) => c.name)).toEqual(['関係公園'])
  })

  it('駅・地区名（node）は面積フィルタの対象外（変化なし）', () => {
    const data = {
      elements: [
        { type: 'node', lat: 34.701, lon: 135.5, tags: { name: '某駅', railway: 'station' } },
        { type: 'node', lat: 34.702, lon: 135.5, tags: { name: '某町', place: 'neighbourhood' } },
        { type: 'way', tags: { name: '小さな庭', leisure: 'park' }, bounds: { minlat: 34.7, minlon: 135.5, maxlat: 34.7005, maxlon: 135.5005 } }
      ]
    }
    const out = parseNearbyResponse(data)
    expect(out.map((c) => c.name)).toEqual(['某駅', '某町'])
  })
})

describe('approxBoundsAreaM2: bounds の近似面積', () => {
  it('緯度・経度の幅をメートル換算した矩形面積を返す', () => {
    // 0.001度 ≒ 111m（緯度）。34.7度付近で経度方向は cos(34.7°)≒0.82 を掛ける
    const areaM2 = approxBoundsAreaM2({ minlat: 34.7, minlon: 135.5, maxlat: 34.701, maxlon: 135.501 })
    // 0.001度 ≒ 111m（緯度）。34.7度付近で経度方向は cos(34.7°)≒0.82 を掛ける
    // → 111m × 約91m ≒ 10200m²
    expect(areaM2).toBeGreaterThan(9000)
    expect(areaM2).toBeLessThan(13000)
    expect(areaM2).toBeCloseTo(111320 * 111320 * Math.cos((34.7005 * Math.PI) / 180) * 0.001 * 0.001, 0)
  })

  it('しきい値（PARK_MIN_AREA_M2）との大小関係が選別に使える', () => {
    const big = approxBoundsAreaM2({ minlat: 34.7, minlon: 135.5, maxlat: 34.702, maxlon: 135.502 })
    const small = approxBoundsAreaM2({ minlat: 34.7, minlon: 135.5, maxlat: 34.7005, maxlon: 135.5005 })
    expect(big).toBeGreaterThan(PARK_MIN_AREA_M2)
    expect(small).toBeLessThanOrEqual(PARK_MIN_AREA_M2)
  })
})

describe('prepareNearbyCandidates', () => {
  it('距離順に並び替え、distanceKm・displayName・prefecture・city を付与する', () => {
    const raw = [
      station('遠い駅', 34.9, 135.5),
      area('近い町', 34.701, 135.501),
      station('中駅', 34.75, 135.5),
    ]
    const cands = prepareNearbyCandidates(raw, CENTER)
    expect(cands.map((c) => c.name)).toEqual(['近い町', '中駅', '遠い駅'])
    expect(cands[0]).toMatchObject({
      distanceKm: haversineKm(CENTER.lat, CENTER.lon, 34.701, 135.501),
      displayName: '近い町',
      prefecture: '',
      city: '',
    })
    // 距離が近い順に distanceKm も小さい順
    expect(cands[0].distanceKm).toBeLessThan(cands[1].distanceKm)
    expect(cands[1].distanceKm).toBeLessThan(cands[2].distanceKm)
  })

  it('同一種別・同名・約110m以内の重複要素を1件にまとめる', () => {
    const raw = [
      station('梅田駅', 34.7011, 135.4955),
      station('梅田駅', 34.7012, 135.4956),
      station('阪神電車梅田駅', 34.702, 135.496),
    ]
    const cands = prepareNearbyCandidates(raw, CENTER)
    // 同名の2駅が1件に。同名だが110m以上離れていれば別件（ここでは阪神電車梅田駅は別名）
    expect(cands).toHaveLength(2)
  })

  it('上限（8件）を超える全件を保持する（キャッシュは切り捨てない）', () => {
    // 地区12件 + 駅1件。旧実装はここで先頭8件に切り捨てていた
    const raw = []
    for (let i = 0; i < 12; i++) {
      raw.push(area(`地区${i + 1}町`, 34.7 + 0.01 * i, 135.5 + 0.01 * i))
    }
    raw.push(station('遠い駅', 34.9, 135.5))
    const cands = prepareNearbyCandidates(raw, CENTER)
    expect(cands).toHaveLength(13)
    // 距離が最も遠い駅もキャッシュに含まれる
    expect(cands[cands.length - 1].name).toBe('遠い駅')
  })

  it('空・null の入力は空配列を返す', () => {
    expect(prepareNearbyCandidates([], CENTER)).toEqual([])
    expect(prepareNearbyCandidates(null, CENTER)).toEqual([])
  })
})

describe('matchNearbyCandidates', () => {
  // 回帰テストのフィクスチャ: 現在地近くに地区が8件（「富田」に一致しない
  // 名前）あり、駅（摂津富田駅）が距離順で9件目
  function nineCandidateFixture() {
    const raw = [
      area('東町', 34.702, 135.5),
      area('西町', 34.704, 135.5),
      area('町屋町', 34.706, 135.5),
      area('北町', 34.708, 135.5),
      area('南町', 34.71, 135.5),
      area('上長町', 34.712, 135.5),
      area('下町', 34.714, 135.5),
      area('上長西町', 34.716, 135.5),
      station('摂津富田駅', 34.718, 135.5),
    ]
    return prepareNearbyCandidates(raw, CENTER)
  }

  it('駅が9件目以降でも、駅名の一部を入力すれば候補に出る（回帰テスト）', () => {
    const cands = nineCandidateFixture()
    expect(cands).toHaveLength(9)
    // 「富田」に一致するのは駅だけ → 候補に出る（旧実装ではキャッシュから
    // 駅が切り捨てられており、ここが空配列だった）
    const matched = matchNearbyCandidates(cands, '富田')
    expect(matched.map((c) => c.name)).toEqual(['摂津富田駅'])
  })

  it('駅名の「駅」を外した入力でも駅に当たる', () => {
    const cands = nineCandidateFixture()
    const matched = matchNearbyCandidates(cands, '摂津富田')
    expect(matched.map((c) => c.name)).toEqual(['摂津富田駅'])
  })

  it('名前の部分一致（両方向の包含・大小文字無視）で絞り込む', () => {
    const cands = prepareNearbyCandidates(
      [area('梅田東町', 34.701, 135.5), area('西梅田町', 34.702, 135.5), area('難波町', 34.703, 135.5)],
      CENTER
    )
    // 「梅田」を含む2件（前後どちらに含まれても当たる）
    expect(matchNearbyCandidates(cands, '梅田').map((c) => c.name))
      .toEqual(['梅田東町', '西梅田町'])
  })

  it('照合結果が多い場合は表示上限（8件）に絞る', () => {
    // 「富田」に一致する地区10件（距離順）→ 表示は先頭8件のみ
    const raw = []
    for (let i = 1; i <= 10; i++) {
      raw.push(area(`富田${i}丁目`, 34.7 + 0.01 * i, 135.5))
    }
    const cands = prepareNearbyCandidates(raw, CENTER)
    const matched = matchNearbyCandidates(cands, '富田')
    expect(matched).toHaveLength(MAX_NEARBY_SUGGEST)
    expect(matched.map((c) => c.name))
      .toEqual(['富田1丁目', '富田2丁目', '富田3丁目', '富田4丁目', '富田5丁目', '富田6丁目', '富田7丁目', '富田8丁目'])
  })

  it('入力が2文字未満なら空配列を返す（ネットワーク問い合わせなし）', () => {
    const cands = nineCandidateFixture()
    expect(matchNearbyCandidates(cands, '富')).toEqual([])
    expect(matchNearbyCandidates(cands, '')).toEqual([])
    expect(matchNearbyCandidates(cands, '  ')).toEqual([])
  })

  it('一致がなければ空配列を返す', () => {
    const cands = nineCandidateFixture()
    expect(matchNearbyCandidates(cands, '存在しない地名ZZ')).toEqual([])
  })
})
