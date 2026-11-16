// @vitest-environment jsdom
/**
 * (#44) applyResultFilters / hasActiveFilters: 目的スコープ（purposeFilter）
 */
import { describe, it, expect } from 'vitest'
import { applyResultFilters, hasActiveFilters, matchesPerspective, cuisineFacetValues } from '../resultFilters'

const cafe = { type: 'node', id: 1, tags: { amenity: 'cafe' } }
const park = { type: 'node', id: 2, tags: { leisure: 'park' } }
const hotel = { type: 'way', id: 3, tags: { tourism: 'hotel' } }
const conv = { type: 'node', id: 4, tags: { shop: 'convenience' } }
const RESULTS = [cafe, park, hotel, conv]

const BASE = { nameFilter: '', typeFilter: 'all', catFilter: '', purposeFilter: '', websiteOnly: false, sortDir: 'none' }

describe('applyResultFilters: purposeFilter（目的スコープ）', () => {
  it('遊ぶ: その目的のカテゴリに一致する要素だけが残る', () => {
    const out = applyResultFilters(RESULTS, { ...BASE, purposeFilter: '遊ぶ' })
    // park（公園・広場）と hotel（宿泊施設）は遊ぶグループ、cafe（食べる）/conv（買う）は外れる
    expect(out.map(r => r.id)).toEqual([2, 3])
  })

  it('買う: 小売・コンビニ系だけが残る', () => {
    const out = applyResultFilters(RESULTS, { ...BASE, purposeFilter: '買う' })
    expect(out.map(r => r.id)).toEqual([4])
  })

  it('食べる: cafeだけが残る', () => {
    const out = applyResultFilters(RESULTS, { ...BASE, purposeFilter: '食べる' })
    expect(out.map(r => r.id)).toEqual([1])
  })

  it('未知の目的名はフィルタしない（全件維持）', () => {
    const out = applyResultFilters(RESULTS, { ...BASE, purposeFilter: '存在しない目的' })
    expect(out.map(r => r.id)).toEqual([1, 2, 3, 4])
  })

  it('catFilterとpurposeFilterはANDで効く', () => {
    // cafe（食べる）をcatFilterで選択し、遊ぶのpurposeFilterも設定 → 一致なし
    const out = applyResultFilters(RESULTS, { ...BASE, catFilter: 'cafe', purposeFilter: '遊ぶ' })
    expect(out).toHaveLength(0)
  })

  it('他のフィルタ（nameFilter等）と組み合わせられる', () => {
    // Overpass正規化では tags.name → 顶层name にコピーされる（facilityNameはresult.nameを読む）
    const named = [
      { type: 'node', id: 10, name: '中央公園', tags: { leisure: 'park', name: '中央公園' } },
      { type: 'node', id: 11, name: '北公園', tags: { leisure: 'park', name: '北公園' } }
    ]
    const out = applyResultFilters(named, { ...BASE, purposeFilter: '遊ぶ', nameFilter: '中央' })
    expect(out.map(r => r.id)).toEqual([10])
  })
})

describe('applyResultFilters: missingFilter（B2: 主要属性の欠落で絞り込み）', () => {
  const full = { type: 'node', id: 20, name: '完全カフェ', tags: { amenity: 'cafe', name: '完全カフェ', phone: '06-1111-1111', opening_hours: 'Mo-Fr 09:00-17:00', website: 'https://full.example', 'addr:street': '梅田1-1' } }
  const noPhone = { type: 'node', id: 21, name: '電話なしカフェ', tags: { amenity: 'cafe', name: '電話なしカフェ', opening_hours: 'Mo-Fr 09:00-17:00', website: 'https://nophone.example', 'addr:street': '梅田2-2' } }
  const noWeb = { type: 'node', id: 22, name: 'サイトなし公園', tags: { leisure: 'park', name: 'サイトなし公園', phone: '06-2222-2222', 'addr:city': '大阪市' } }
  const M = [full, noPhone, noWeb]

  it('特定属性: その属性が未登録の施設だけが残る', () => {
    expect(applyResultFilters(M, { ...BASE, missingFilter: 'phone' }).map(r => r.id)).toEqual([21])
    expect(applyResultFilters(M, { ...BASE, missingFilter: 'website' }).map(r => r.id)).toEqual([22])
    expect(applyResultFilters(M, { ...BASE, missingFilter: 'opening_hours' }).map(r => r.id)).toEqual([22])
    expect(applyResultFilters(M, { ...BASE, missingFilter: 'address' }).map(r => r.id)).toEqual([])
  })

  it('any: いずれかの主要属性が未登録なら残る', () => {
    expect(applyResultFilters(M, { ...BASE, missingFilter: 'any' }).map(r => r.id)).toEqual([21, 22])
  })

  it('none（または未設定）なら全件維持', () => {
    expect(applyResultFilters(M, { ...BASE, missingFilter: 'none' }).map(r => r.id)).toEqual([20, 21, 22])
    expect(applyResultFilters(M, BASE).map(r => r.id)).toEqual([20, 21, 22])
  })

  it('nameFilterと組み合わせられる（名称検索のまま欠落絞り込み）', () => {
    const out = applyResultFilters(M, { ...BASE, missingFilter: 'phone', nameFilter: '電話' })
    expect(out.map(r => r.id)).toEqual([21])
    // 名称一致しても電話があれば除外される
    const out2 = applyResultFilters(M, { ...BASE, missingFilter: 'phone', nameFilter: '完全' })
    expect(out2).toHaveLength(0)
  })

  it('空文字のopening_hoursも未登録扱い（has関数と同一のtruthiness判定）', () => {
    const emptyHours = { type: 'node', id: 23, name: '空営業時間', tags: { amenity: 'cafe', name: '空営業時間', opening_hours: '' } }
    expect(applyResultFilters([emptyHours], { ...BASE, missingFilter: 'opening_hours' })).toHaveLength(1)
  })
})

// ===== 視点フィルタ（matchesPerspective） =====

// 施設形状（tags）とバリアフリー形状（bf）のフィクチャ
const wcFacility = { type: 'node', id: 60, tags: { amenity: 'cafe', wheelchair: 'yes' } }
const wcDesignated = { type: 'node', id: 61, tags: { amenity: 'cafe', wheelchair: 'designated' } }
const wcLimited = { type: 'node', id: 62, tags: { amenity: 'cafe', wheelchair: 'limited' } }
const kerbLow = { type: 'node', id: 63, tags: { amenity: 'cafe', 'kerb:height': '0.02' } }
const kerbHigh = { type: 'node', id: 64, tags: { amenity: 'cafe', 'kerb:height': '0.05' } }
const kerbBad = { type: 'node', id: 65, tags: { amenity: 'cafe', 'kerb:height': 'abc' } }
const bfKerbFlush = { type: 'node', id: 66, tags: {}, bf: { kind: 'node', kerb: 'flush' } }
const bfKerbLowered = { type: 'node', id: 67, tags: {}, bf: { kind: 'node', kerb: 'lowered' } }
const bfKerbHigh = { type: 'node', id: 68, tags: {}, bf: { kind: 'node', kerb: 'high' } }

const tactileFacility = { type: 'node', id: 70, tags: { amenity: 'cafe', tactile_paving: 'yes' } }
const tactileNoFacility = { type: 'node', id: 71, tags: { amenity: 'cafe', tactile_paving: 'no' } }
const bfTactileYes = { type: 'way', id: 72, tags: { highway: 'footway' }, bf: { kind: 'way', tactile: 'yes' } }
const bfTactileNo = { type: 'way', id: 73, tags: { highway: 'footway' }, bf: { kind: 'way', tactile: 'no' } }
const bfSound = { type: 'node', id: 74, tags: {}, bf: { kind: 'node', hasSound: true, hasVibration: false } }
const bfVibration = { type: 'node', id: 75, tags: {}, bf: { kind: 'node', hasSound: false, hasVibration: true } }

const diaperYes = { type: 'node', id: 80, tags: { amenity: 'cafe', diaper: 'yes' } }
const diaperNo = { type: 'node', id: 81, tags: { amenity: 'cafe', diaper: 'no' } }
const diaperEmpty = { type: 'node', id: 82, tags: { amenity: 'cafe', diaper: '' } }
const changingTable = { type: 'node', id: 83, tags: { amenity: 'cafe', changing_table: 'yes' } }
const kidsArea = { type: 'node', id: 84, tags: { amenity: 'cafe', kids_area: 'yes' } }
const highchair = { type: 'node', id: 85, tags: { amenity: 'cafe', highchair: 'yes' } }

const rampYes = { type: 'node', id: 90, tags: { amenity: 'cafe', ramp: 'yes' } }
const rampWheelchair = { type: 'node', id: 91, tags: { amenity: 'cafe', 'ramp:wheelchair': 'yes' } }
const elevatorYes = { type: 'node', id: 92, tags: { amenity: 'cafe', elevator: 'yes' } }
const elevatorNo = { type: 'node', id: 93, tags: { amenity: 'cafe', elevator: 'no' } }
const plain = { type: 'node', id: 99, tags: { amenity: 'cafe' } }


describe('matchesPerspective: wheelchair（車椅子）', () => {
  it('tags.wheelchair が yes / designated の施設は該当する', () => {
    expect(matchesPerspective(wcFacility, 'wheelchair')).toBe(true)
    expect(matchesPerspective(wcDesignated, 'wheelchair')).toBe(true)
  })

  it('limited / no / 未登録は該当しない（「登録あり」のみ残す）', () => {
    expect(matchesPerspective(wcLimited, 'wheelchair')).toBe(false)
    expect(matchesPerspective(plain, 'wheelchair')).toBe(false)
  })

  it("tags['kerb:height'] が数値として解釈できて 0.03m 以下なら該当する", () => {
    expect(matchesPerspective(kerbLow, 'wheelchair')).toBe(true)
    const edge = { tags: { 'kerb:height': '0.03' } }
    expect(matchesPerspective(edge, 'wheelchair')).toBe(true)
  })

  it('kerb:height が 0.03m 超・数値解釈不可・空文字なら該当しない', () => {
    expect(matchesPerspective(kerbHigh, 'wheelchair')).toBe(false)
    expect(matchesPerspective(kerbBad, 'wheelchair')).toBe(false)
    expect(matchesPerspective(diaperEmpty, 'wheelchair')).toBe(false)
  })

  it('bf.kerb が flush / lowered のバリアフリー結果は該当する', () => {
    expect(matchesPerspective(bfKerbFlush, 'wheelchair')).toBe(true)
    expect(matchesPerspective(bfKerbLowered, 'wheelchair')).toBe(true)
  })

  it('bf.kerb が flush/lowered 以外（例: high）は該当しない', () => {
    expect(matchesPerspective(bfKerbHigh, 'wheelchair')).toBe(false)
  })
})

describe('matchesPerspective: vision（目の不自由な方）', () => {
  it('tags.tactile_paving === yes は該当する、no / 未登録は該当しない', () => {
    expect(matchesPerspective(tactileFacility, 'vision')).toBe(true)
    expect(matchesPerspective(tactileNoFacility, 'vision')).toBe(false)
    expect(matchesPerspective(plain, 'vision')).toBe(false)
  })

  it('bf.tactile === yes のバリアフリー結果は該当する（no は該当しない）', () => {
    expect(matchesPerspective(bfTactileYes, 'vision')).toBe(true)
    expect(matchesPerspective(bfTactileNo, 'vision')).toBe(false)
  })

  it('bf.hasSound / bf.hasVibration が true なら該当する', () => {
    expect(matchesPerspective(bfSound, 'vision')).toBe(true)
    expect(matchesPerspective(bfVibration, 'vision')).toBe(true)
    expect(matchesPerspective({ bf: { hasSound: false, hasVibration: false } }, 'vision')).toBe(false)
  })
})

describe('matchesPerspective: child（子ども連れ）', () => {
  it('tags.diaper が存在し no でないなら該当する（yes）', () => {
    expect(matchesPerspective(diaperYes, 'child')).toBe(true)
  })

  it('diaper が no / 空文字 / 未登録は該当しない', () => {
    expect(matchesPerspective(diaperNo, 'child')).toBe(false)
    expect(matchesPerspective(diaperEmpty, 'child')).toBe(false)
    expect(matchesPerspective(plain, 'child')).toBe(false)
  })

  it('changing_table / kids_area / highchair が yes なら該当する', () => {
    expect(matchesPerspective(changingTable, 'child')).toBe(true)
    expect(matchesPerspective(kidsArea, 'child')).toBe(true)
    expect(matchesPerspective(highchair, 'child')).toBe(true)
  })

  it('changing_table が no なら該当しない（yes のみ）', () => {
    expect(matchesPerspective({ tags: { changing_table: 'no' } }, 'child')).toBe(false)
  })
})

describe('matchesPerspective: elderly（お年寄り）', () => {
  it('tags.wheelchair が yes / designated なら該当する', () => {
    expect(matchesPerspective(wcFacility, 'elderly')).toBe(true)
    expect(matchesPerspective(wcDesignated, 'elderly')).toBe(true)
  })

  it('ramp / ramp:wheelchair / elevator が yes なら該当する', () => {
    expect(matchesPerspective(rampYes, 'elderly')).toBe(true)
    expect(matchesPerspective(rampWheelchair, 'elderly')).toBe(true)
    expect(matchesPerspective(elevatorYes, 'elderly')).toBe(true)
  })

  it('no / 未登録は該当しない', () => {
    expect(matchesPerspective(elevatorNo, 'elderly')).toBe(false)
    expect(matchesPerspective({ tags: { ramp: 'no' } }, 'elderly')).toBe(false)
    expect(matchesPerspective(plain, 'elderly')).toBe(false)
  })
})

describe('matchesPerspective: none / 不明な視点', () => {
  it("'none' は全件該当する（フィルタしない）", () => {
    expect(matchesPerspective(plain, 'none')).toBe(true)
    expect(matchesPerspective(bfKerbFlush, 'none')).toBe(true)
    expect(matchesPerspective(plain, undefined)).toBe(true)
  })

  it('不明な視点IDはフィルタしない（安全側）', () => {
    expect(matchesPerspective(plain, 'unknown')).toBe(true)
  })
})

describe('applyResultFilters: perspective（視点フィルタ）', () => {
  it('wheelchair: 車椅子対応が登録済みの施設・バリアフリー要素だけが残る', () => {
    const out = applyResultFilters(
      [wcFacility, wcLimited, plain, bfKerbFlush],
      { ...BASE, perspective: 'wheelchair' }
    )
    expect(out.map((r) => r.id).sort()).toEqual([60, 66])
  })

  it('vision: 点字ブロック・音声/振動案内が登録済みのものだけが残る', () => {
    const out = applyResultFilters(
      [tactileFacility, bfTactileYes, bfSound, plain],
      { ...BASE, perspective: 'vision' }
    )
    expect(out.map((r) => r.id).sort()).toEqual([70, 72, 74])
  })

  it('child / elderly も同様に絞れる', () => {
    expect(applyResultFilters([diaperYes, changingTable, plain], { ...BASE, perspective: 'child' }).map((r) => r.id).sort()).toEqual([80, 83])
    expect(applyResultFilters([elevatorYes, elevatorNo, plain], { ...BASE, perspective: 'elderly' }).map((r) => r.id)).toEqual([92])
  })

  it("'none'（または未設定）なら全件維持", () => {
    expect(applyResultFilters([wcFacility, plain], { ...BASE, perspective: 'none' })).toHaveLength(2)
    expect(applyResultFilters([wcFacility, plain], BASE)).toHaveLength(2)
  })

  it('nameFilter と組み合わせられる（AND）', () => {
    const a = { type: 'node', id: 100, name: '駅カフェ', tags: { amenity: 'cafe', name: '駅カフェ', wheelchair: 'yes' } }
    const b = { type: 'node', id: 101, name: '山カフェ', tags: { amenity: 'cafe', name: '山カフェ', wheelchair: 'yes' } }
    const out = applyResultFilters([a, b], { ...BASE, perspective: 'wheelchair', nameFilter: '駅' })
    expect(out.map((r) => r.id)).toEqual([100])
  })
})

describe('hasActiveFilters', () => {
  it('purposeFilterのみでもtrue', () => {
    expect(hasActiveFilters({ ...BASE, purposeFilter: '遊ぶ' })).toBe(true)
    expect(hasActiveFilters(BASE)).toBe(false)
  })

  it('perspective（視点フィルタ）が none 以外ならtrue', () => {
    expect(hasActiveFilters({ ...BASE, perspective: 'wheelchair' })).toBe(true)
    expect(hasActiveFilters({ ...BASE, perspective: 'none' })).toBe(false)
  })

  it('missingFilter（B2）がnone以外ならtrue', () => {
    expect(hasActiveFilters({ ...BASE, missingFilter: 'any' })).toBe(true)
    expect(hasActiveFilters({ ...BASE, missingFilter: 'none' })).toBe(false)
  })

  it('cuisine（料理ジャンル）が空以外ならtrue', () => {
    expect(hasActiveFilters({ ...BASE, cuisine: 'ramen' })).toBe(true)
    expect(hasActiveFilters({ ...BASE, cuisine: '' })).toBe(false)
    expect(hasActiveFilters(BASE)).toBe(false)
  })

  it('kerbHeight（縁石の高さ）が any 以外ならtrue', () => {
    expect(hasActiveFilters({ ...BASE, kerbHeight: 'flat' })).toBe(true)
    expect(hasActiveFilters({ ...BASE, kerbHeight: 'unknown' })).toBe(true)
    expect(hasActiveFilters({ ...BASE, kerbHeight: 'any' })).toBe(false)
    expect(hasActiveFilters(BASE)).toBe(false)
  })
})

// ===== 料理ジャンルファセット（cuisine） =====

describe('cuisineFacetValues', () => {
  const r = (id, cuisine) => ({ type: 'node', id, tags: { amenity: 'restaurant', ...(cuisine ? { cuisine } : {}) } })

  it("tags.cuisine（';' 区切り）を集計し [{ value, label, count }] を返す", () => {
    const out = cuisineFacetValues([
      r(1, 'ramen'),
      r(2, 'ramen'),
      r(3, 'ramen;sushi'),
      r(4, 'sushi'),
      r(5, 'italian')
    ])
    expect(out).toEqual([
      { value: 'ramen', label: 'ラーメン', count: 3 },
      { value: 'sushi', label: '寿司', count: 2 },
      { value: 'italian', label: 'イタリアン', count: 1 }
    ])
  })

  it('値を小文字に正規化する（Ramen / ramen は同一値として集計）', () => {
    const out = cuisineFacetValues([r(1, 'Ramen'), r(2, 'ramen'), r(3, 'RAMEN')])
    expect(out).toEqual([{ value: 'ramen', label: 'ラーメン', count: 3 }])
  })

  it('半角スペース・空区切りは無視される', () => {
    const out = cuisineFacetValues([r(1, ' ramen ; sushi ;')])
    expect(out).toEqual([
      { value: 'ramen', label: 'ラーメン', count: 1 },
      { value: 'sushi', label: '寿司', count: 1 }
    ])
  })

  it('件数の多い順に並び、同件数は値の昇順で決める', () => {
    const out = cuisineFacetValues([
      r(1, 'pizza'),
      r(2, 'burger'),
      r(3, 'pizza'),
      r(4, 'burger'),
      r(5, 'udon')
    ])
    // pizza/burger が同件数(2) → 値の昇順で burger が先
    expect(out.map((f) => f.value)).toEqual(['burger', 'pizza', 'udon'])
  })

  it('既定で最大10件まで返す', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      type: 'node', id: i, tags: { cuisine: `v${i}` } // 未知値: ラベルは値のまま
    }))
    // 全て同件数(1) → 値の昇順の先頭10件
    const out = cuisineFacetValues(many)
    expect(out).toHaveLength(10)
    expect(out.map((f) => f.value)).toEqual(['v0', 'v1', 'v10', 'v11', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'])
  })

  it('limit で返す件数を制限できる', () => {
    const out = cuisineFacetValues([r(1, 'ramen'), r(2, 'sushi'), r(3, 'udon')], 2)
    expect(out.map((f) => f.value)).toEqual(['ramen', 'sushi'])
  })

  it('一般的な値は日本語ラベル、載っていない値はそのまま表示', () => {
    const out = cuisineFacetValues([
      r(1, 'ramen'), r(2, 'sushi'), r(3, 'japanese'), r(4, 'chinese'),
      r(5, 'french'), r(6, 'indian'), r(7, 'thai'), r(8, 'korean'),
      r(9, 'cafe'), r(10, 'coffee_shop'), r(11, 'burger'), r(12, 'pizza'),
      r(13, 'udon'), r(14, 'soba'), r(15, 'yakiniku'), r(16, 'izakaya'),
      r(17, 'bakery'), r(18, 'sweets'), r(19, 'curry'), r(20, 'weird_food')
    ], 30)
    const byValue = Object.fromEntries(out.map((f) => [f.value, f.label]))
    expect(byValue.ramen).toBe('ラーメン')
    expect(byValue.sushi).toBe('寿司')
    expect(byValue.japanese).toBe('和食')
    expect(byValue.chinese).toBe('中華')
    expect(byValue.french).toBe('フレンチ')
    expect(byValue.indian).toBe('インド料理')
    expect(byValue.thai).toBe('タイ料理')
    expect(byValue.korean).toBe('韓国料理')
    expect(byValue.cafe).toBe('カフェ')
    expect(byValue.coffee_shop).toBe('カフェ')
    expect(byValue.burger).toBe('ハンバーガー')
    expect(byValue.pizza).toBe('ピザ')
    expect(byValue.udon).toBe('うどん')
    expect(byValue.soba).toBe('そば')
    expect(byValue.yakiniku).toBe('焼肉')
    expect(byValue.izakaya).toBe('居酒屋')
    expect(byValue.bakery).toBe('パン')
    expect(byValue.sweets).toBe('スイーツ')
    expect(byValue.curry).toBe('カレー')
    expect(byValue.weird_food).toBe('weird_food')
  })

  it('cuisineタグが無い結果・空配列は空配列を返す', () => {
    expect(cuisineFacetValues([r(1, null), { type: 'node', id: 2, tags: { amenity: 'cafe' } }])).toEqual([])
    expect(cuisineFacetValues([])).toEqual([])
    expect(cuisineFacetValues(undefined)).toEqual([])
  })
})

describe('applyResultFilters: cuisine（料理ジャンル）', () => {
  const ramenA = { type: 'node', id: 110, tags: { amenity: 'restaurant', cuisine: 'ramen' } }
  const ramenB = { type: 'node', id: 111, tags: { amenity: 'restaurant', cuisine: 'ramen;sushi' } }
  const sushiC = { type: 'node', id: 112, tags: { amenity: 'restaurant', cuisine: 'sushi' } }
  const italianD = { type: 'node', id: 113, tags: { amenity: 'restaurant', cuisine: 'italian' } }
  const plainE = { type: 'node', id: 114, tags: { amenity: 'restaurant' } }
  const C = [ramenA, ramenB, sushiC, italianD, plainE]

  it("'ramen' なら cuisine に ramen を含む結果だけ残る（';' 区切りのうち含むもの）", () => {
    expect(applyResultFilters(C, { ...BASE, cuisine: 'ramen' }).map((r) => r.id)).toEqual([110, 111])
  })

  it('大小文字は無視する（フィルタ値・タグ値の両方）', () => {
    expect(applyResultFilters(C, { ...BASE, cuisine: 'RAMEN' }).map((r) => r.id)).toEqual([110, 111])
    const upper = { type: 'node', id: 115, tags: { amenity: 'restaurant', cuisine: 'Ramen' } }
    expect(applyResultFilters([upper], { ...BASE, cuisine: 'ramen' })).toHaveLength(1)
  })

  it("';' 区切りの値の部分一致で絞る", () => {
    // 'su' → 'sushi' の部分一致（sushiC と ramenB）
    expect(applyResultFilters(C, { ...BASE, cuisine: 'su' }).map((r) => r.id)).toEqual([111, 112])
  })

  it('フィルタ設定時は cuisine タグが無い結果は除外される', () => {
    expect(applyResultFilters(C, { ...BASE, cuisine: 'ramen' }).map((r) => r.id)).not.toContain(114)
  })

  it('cuisine 未設定（空文字・キーなし）なら全件維持', () => {
    expect(applyResultFilters(C, { ...BASE, cuisine: '' })).toHaveLength(5)
    expect(applyResultFilters(C, BASE)).toHaveLength(5)
  })

  it('nameFilter と組み合わせられる（AND）', () => {
    const namedRamen = { type: 'node', id: 116, name: 'ラーメン屋A', tags: { amenity: 'restaurant', name: 'ラーメン屋A', cuisine: 'ramen' } }
    const namedSushi = { type: 'node', id: 117, name: '寿司屋B', tags: { amenity: 'restaurant', name: '寿司屋B', cuisine: 'ramen' } }
    const out = applyResultFilters([namedRamen, namedSushi], { ...BASE, cuisine: 'ramen', nameFilter: 'ラーメン' })
    expect(out.map((r) => r.id)).toEqual([116])
  })
})

// ===== 縁石の高さ（kerbHeight） =====

describe('applyResultFilters: kerbHeight（縁石の高さ）', () => {
  // bf を持つバリアフリー結果（縁石要素）と、縁石でない要素・bf 無いPOI
  const kerbFlush = { type: 'node', id: 120, tags: { barrier: 'kerb', kerb: 'flush' }, bf: { kind: 'node', kerb: 'flush' } }
  const kerbLowered = { type: 'node', id: 121, tags: { barrier: 'kerb', kerb: 'lowered' }, bf: { kind: 'node', kerb: 'lowered' } }
  const kerbRaised = { type: 'node', id: 122, tags: { barrier: 'kerb', kerb: 'raised' }, bf: { kind: 'node', kerb: 'raised' } }
  const kerbHeightLow = { type: 'node', id: 123, tags: { barrier: 'kerb', 'kerb:height': '0.02' }, bf: { kind: 'node', kerb: null } }
  const kerbUnknown = { type: 'node', id: 124, tags: { barrier: 'kerb' }, bf: { kind: 'node', kerb: null } }
  const footwayW = { type: 'way', id: 125, tags: { highway: 'footway', tactile_paving: 'yes' }, bf: { kind: 'way', tactile: 'yes', kerb: null } }
  const poiNoBf = { type: 'node', id: 126, tags: { amenity: 'cafe' } }
  const K = [kerbFlush, kerbLowered, kerbRaised, kerbHeightLow, kerbUnknown, footwayW, poiNoBf]

  it('flat: 段差なしの縁石だけ残る（flush）', () => {
    expect(applyResultFilters(K, { ...BASE, kerbHeight: 'flat' }).map((r) => r.id)).toEqual([120])
  })

  it('low: 低めの縁石だけ残る（lowered / kerb:height 0超〜0.03以下）', () => {
    expect(applyResultFilters(K, { ...BASE, kerbHeight: 'low' }).map((r) => r.id)).toEqual([121, 123])
  })

  it('high: 高めの縁石だけ残る（raised / kerb:height 0.03超）', () => {
    const kerbHeightHigh = { type: 'node', id: 127, tags: { barrier: 'kerb', 'kerb:height': '0.05' }, bf: { kind: 'node', kerb: null } }
    const out = applyResultFilters([...K, kerbHeightHigh], { ...BASE, kerbHeight: 'high' })
    expect(out.map((r) => r.id)).toEqual([122, 127])
  })

  it('unknown: 縁石要素だが高さもkerb値も未記録のものだけ残る', () => {
    expect(applyResultFilters(K, { ...BASE, kerbHeight: 'unknown' }).map((r) => r.id)).toEqual([124])
  })

  it('縁石でない bf 要素（歩道等）はどのクラスでも除外される', () => {
    for (const cls of ['flat', 'low', 'high', 'unknown']) {
      expect(applyResultFilters(K, { ...BASE, kerbHeight: cls }).map((r) => r.id)).not.toContain(125)
    }
  })

  it('bf を持たない結果（POI）は除外される', () => {
    for (const cls of ['flat', 'low', 'high', 'unknown']) {
      expect(applyResultFilters(K, { ...BASE, kerbHeight: cls }).map((r) => r.id)).not.toContain(126)
    }
  })

  it("'any'（または未設定）なら全件維持", () => {
    expect(applyResultFilters(K, { ...BASE, kerbHeight: 'any' })).toHaveLength(7)
    expect(applyResultFilters(K, BASE)).toHaveLength(7)
  })

  it('nameFilter と組み合わせられる（AND）', () => {
    const namedFlush = { type: 'node', id: 128, name: '駅前縁石', tags: { barrier: 'kerb', name: '駅前縁石', kerb: 'flush' }, bf: { kind: 'node', kerb: 'flush' } }
    const namedLowered = { type: 'node', id: 129, name: '公園縁石', tags: { barrier: 'kerb', name: '公園縁石', kerb: 'lowered' }, bf: { kind: 'node', kerb: 'lowered' } }
    const out = applyResultFilters([namedFlush, namedLowered], { ...BASE, kerbHeight: 'flat', nameFilter: '駅前' })
    expect(out.map((r) => r.id)).toEqual([128])
  })
})
