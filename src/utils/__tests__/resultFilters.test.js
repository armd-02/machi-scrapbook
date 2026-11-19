// @vitest-environment jsdom
/**
 * (#44) applyResultFilters / hasActiveFilters: 目的スコープ（purposeFilter）
 */
import { describe, it, expect } from 'vitest'
import {
  applyResultFilters, hasActiveFilters, cuisineFacetValues,
  matchesKeyword, matchesWifi, matchesPower, matchesWheelchair, matchesRating,
  normalizeWheelchair,
} from '../resultFilters'

const cafe = { type: 'node', id: 1, tags: { amenity: 'cafe' } }
const park = { type: 'node', id: 2, tags: { leisure: 'park' } }
const hotel = { type: 'way', id: 3, tags: { tourism: 'hotel' } }
const conv = { type: 'node', id: 4, tags: { shop: 'convenience' } }
const RESULTS = [cafe, park, hotel, conv]

const BASE = { nameFilter: '', typeFilter: 'all', catFilter: '', purposeFilter: '', sortDir: 'none' }

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

describe('hasActiveFilters', () => {
  it('purposeFilterのみでもtrue', () => {
    expect(hasActiveFilters({ ...BASE, purposeFilter: '遊ぶ' })).toBe(true)
    expect(hasActiveFilters(BASE)).toBe(false)
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

  it('牛丼・ステーキハウス・お好み焼き等も日本語ラベルになる', () => {
    const out = cuisineFacetValues([
      r(1, 'beef_bowl'), r(2, 'steak_house'), r(3, 'okonomiyaki'), r(4, 'yakitori'), r(5, 'taiwanese')
    ], 30)
    const byValue = Object.fromEntries(out.map((f) => [f.value, f.label]))
    expect(byValue.beef_bowl).toBe('牛丼')
    expect(byValue.steak_house).toBe('ステーキ')
    expect(byValue.okonomiyaki).toBe('お好み焼き')
    expect(byValue.yakitori).toBe('焼き鳥')
    expect(byValue.taiwanese).toBe('台湾料理')
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

// ===== (共通フィルタバー) 両画面共通の判定関数 =====

const mItem = (over = {}) => ({
  type: 'node', id: 1, name: 'テスト店', tags: { name: 'テスト店' }, memo: '', rating: 0, ...over,
})

describe('matchesKeyword（名前・name:ja・メモ本文の部分一致）', () => {
  it('名前が部分一致すれば true（大小文字無視）', () => {
    const it1 = mItem({ name: 'Cafe Latte' })
    expect(matchesKeyword(it1, 'CAFE')).toBe(true)
    expect(matchesKeyword(it1, 'ramen')).toBe(false)
  })

  it('name:ja タグも対象になる', () => {
    const it1 = mItem({ name: 'Test Shop', tags: { name: 'Test Shop', 'name:ja': 'テスト喫茶' } })
    expect(matchesKeyword(it1, '喫茶')).toBe(true)
  })

  it('メモ本文も対象になる（メモ帳アイテム）', () => {
    const it1 = mItem({ memo: '静かでWiFiが速い' })
    expect(matchesKeyword(it1, '静か')).toBe(true)
    expect(matchesKeyword(it1, 'WIFI')).toBe(true)
  })

  it('検索結果アイテム（memo フィールドなし）でも例外にならない', () => {
    const it1 = { type: 'node', id: 1, name: 'Cafe', tags: { name: 'Cafe' } }
    expect(matchesKeyword(it1, 'cafe')).toBe(true)
    expect(matchesKeyword(it1, 'メモ')).toBe(false)
  })

  it('空・空白だけのキーワードは全件一致。item が null なら空キーワードで true・それ以外 false', () => {
    expect(matchesKeyword(mItem(), '')).toBe(true)
    expect(matchesKeyword(mItem(), '   ')).toBe(true)
    expect(matchesKeyword(null, 'abc')).toBe(false)
    expect(matchesKeyword(null, '')).toBe(true)
  })
})

describe('matchesWifi（wifiStatus の3状態判定）', () => {
  const withAccess = (v) => mItem({ tags: { internet_access: v } })

  it("'all' は全件一致", () => {
    expect(matchesWifi(mItem(), 'all')).toBe(true)
    expect(matchesWifi(withAccess('no'), 'all')).toBe(true)
  })

  it("'yes'（あり）: 設定されていて 'no' でない値。未設定・空文字は一致しない", () => {
    for (const v of ['wireless', 'wired', 'proprietary', 'yes', 'pay']) {
      expect(matchesWifi(withAccess(v), 'yes')).toBe(true)
    }
    expect(matchesWifi(withAccess('no'), 'yes')).toBe(false)
    expect(matchesWifi(mItem(), 'yes')).toBe(false)
    expect(matchesWifi(withAccess(''), 'yes')).toBe(false)
  })

  it("'no'（なし）: 'no' の場合のみ。未登録（unknown）は「なし」に含まない", () => {
    expect(matchesWifi(withAccess('no'), 'no')).toBe(true)
    expect(matchesWifi(mItem(), 'no')).toBe(false)
    expect(matchesWifi(withAccess(''), 'no')).toBe(false)
    expect(matchesWifi(withAccess('wireless'), 'no')).toBe(false)
  })

  it('数値など文字列でない値は未登録として扱う', () => {
    expect(matchesWifi(mItem({ tags: { internet_access: 2 } }), 'yes')).toBe(false)
    expect(matchesWifi(mItem({ tags: { internet_access: 2 } }), 'no')).toBe(false)
  })
})

describe('matchesPower（powerStatus の3状態判定・「あり」の絞り込みのみ）', () => {
  const withTag = (tags) => mItem({ tags })

  it("'all' は全件一致", () => {
    expect(matchesPower(mItem(), 'all')).toBe(true)
    expect(matchesPower(withTag({ power_supply: 'no' }), 'all')).toBe(true)
  })

  it("'yes'（あり）: power_supply='yes'、または socket 系キーが 'no' 以外で設定済み", () => {
    expect(matchesPower(withTag({ power_supply: 'yes' }), 'yes')).toBe(true)
    expect(matchesPower(withTag({ socket: 'yes' }), 'yes')).toBe(true)
    expect(matchesPower(withTag({ 'socket:indoor': 'yes' }), 'yes')).toBe(true)
    expect(matchesPower(withTag({ 'socket:outdoor': 'pay' }), 'yes')).toBe(true)
  })

  it("'yes': power_supply='no' / socket='no' / 未登録・空文字は一致しない", () => {
    expect(matchesPower(withTag({ power_supply: 'no' }), 'yes')).toBe(false)
    expect(matchesPower(withTag({ socket: 'no' }), 'yes')).toBe(false)
    expect(matchesPower(withTag({ power_supply: 'no', socket: 'no' }), 'yes')).toBe(false)
    expect(matchesPower(mItem(), 'yes')).toBe(false)
    expect(matchesPower(withTag({ socket: '' }), 'yes')).toBe(false)
  })

  it("'no' などの不明なモードは一致しない（選択肢は all|yes のみ）", () => {
    expect(matchesPower(withTag({ power_supply: 'no' }), 'no')).toBe(false)
  })
})

describe('applyResultFilters: wheelchair（車椅子 複数選択）', () => {
  const a = { type: 'node', id: 1, tags: { name: 'A', amenity: 'cafe', wheelchair: 'yes' } }
  const b = { type: 'node', id: 2, tags: { name: 'B', amenity: 'cafe', wheelchair: 'limited' } }
  const c = { type: 'node', id: 3, tags: { name: 'C', amenity: 'cafe', wheelchair: 'no' } }
  const d = { type: 'node', id: 4, tags: { name: 'D', amenity: 'cafe' } }

  const names = (out) => out.map((r) => r.tags.name)

  it('空配列（何もチェックしていない）は絞り込みなし＝全件', () => {
    expect(names(applyResultFilters([a, b, c, d], { ...BASE, wheelchair: [] }))).toEqual(['A', 'B', 'C', 'D'])
  })

  it("['yes'] は対応可（yes / designated）だけ", () => {
    expect(names(applyResultFilters([a, b, c, d], { ...BASE, wheelchair: ['yes'] }))).toEqual(['A'])
  })

  it("['yes', 'no'] は対応可・対応なしだけ（OR、一部対応と未登録は除外）", () => {
    expect(names(applyResultFilters([a, b, c, d], { ...BASE, wheelchair: ['yes', 'no'] }))).toEqual(['A', 'C'])
  })

  it("['partial'] は一部対応（limited）だけ", () => {
    expect(names(applyResultFilters([a, b, c, d], { ...BASE, wheelchair: ['partial'] }))).toEqual(['B'])
  })

  it("['yes', 'partial', 'no'] は登録済みの全件（未登録は除外）", () => {
    expect(names(applyResultFilters([a, b, c, d], { ...BASE, wheelchair: ['yes', 'partial', 'no'] }))).toEqual(['A', 'B', 'C'])
  })
})

describe('matchesWheelchair（tags.wheelchair の値で判定）', () => {
  const withWc = (v) => mItem({ tags: { wheelchair: v } })

  it("'all' は全件一致", () => {
    expect(matchesWheelchair(mItem(), 'all')).toBe(true)
    expect(matchesWheelchair(withWc('designated'), 'all')).toBe(true)
  })

  it("'yes'（対応可）: 'yes' / 'designated'。limited・no・未登録は一致しない", () => {
    expect(matchesWheelchair(withWc('yes'), 'yes')).toBe(true)
    expect(matchesWheelchair(withWc('designated'), 'yes')).toBe(true)
    expect(matchesWheelchair(withWc('limited'), 'yes')).toBe(false)
    expect(matchesWheelchair(withWc('no'), 'yes')).toBe(false)
    expect(matchesWheelchair(mItem(), 'yes')).toBe(false)
  })

  it("'partial'（一部対応）: 'limited' のみ", () => {
    expect(matchesWheelchair(withWc('limited'), 'partial')).toBe(true)
    expect(matchesWheelchair(withWc('yes'), 'partial')).toBe(false)
    expect(matchesWheelchair(mItem(), 'partial')).toBe(false)
  })

  it("'no'（対応なし）: 'no' のみ（未登録は一致しない）", () => {
    expect(matchesWheelchair(withWc('no'), 'no')).toBe(true)
    expect(matchesWheelchair(withWc('yes'), 'no')).toBe(false)
    expect(matchesWheelchair(mItem(), 'no')).toBe(false)
  })

  it('配列（複数選択）: チェックした状態のいずれかに一致すれば true（OR 判定）', () => {
    // 対応可（yes）: yes / designated
    expect(matchesWheelchair(withWc('yes'), ['yes'])).toBe(true)
    expect(matchesWheelchair(withWc('yes'), ['yes', 'no'])).toBe(true)
    expect(matchesWheelchair(withWc('yes'), ['no'])).toBe(false)
    expect(matchesWheelchair(withWc('designated'), ['yes'])).toBe(true)
    // 一部対応（partial）: limited
    expect(matchesWheelchair(withWc('limited'), ['partial'])).toBe(true)
    expect(matchesWheelchair(withWc('limited'), ['yes', 'partial'])).toBe(true)
    expect(matchesWheelchair(withWc('limited'), ['yes', 'no'])).toBe(false)
    // 対応なし（no）
    expect(matchesWheelchair(withWc('no'), ['no'])).toBe(true)
    expect(matchesWheelchair(withWc('no'), ['yes', 'no'])).toBe(true)
    expect(matchesWheelchair(withWc('no'), ['yes'])).toBe(false)
    // 空配列は絞り込みなし（全件一致）
    expect(matchesWheelchair(withWc('yes'), [])).toBe(true)
    expect(matchesWheelchair(withWc('no'), [])).toBe(true)
    expect(matchesWheelchair(mItem(), [])).toBe(true)
    // 未登録はどの状態にも一致しない
    expect(matchesWheelchair(mItem(), ['yes'])).toBe(false)
    expect(matchesWheelchair(mItem(), ['yes', 'partial', 'no'])).toBe(false)
  })
})

describe('matchesRating（rating フィールド。0＝未評価）', () => {
  const withRating = (v) => mItem({ rating: v })

  it("'all' は全件一致（未評価も含まれる）", () => {
    expect(matchesRating(withRating(0), 'all')).toBe(true)
    expect(matchesRating(withRating(5), 'all')).toBe(true)
  })

  it("'gteN': rating >= N（gte1〜gte4）。未評価（0）は一致しない", () => {
    expect(matchesRating(withRating(1), 'gte1')).toBe(true)
    expect(matchesRating(withRating(4), 'gte4')).toBe(true)
    expect(matchesRating(withRating(3), 'gte4')).toBe(false)
    expect(matchesRating(withRating(0), 'gte1')).toBe(false)
    expect(matchesRating(mItem({}), 'gte1')).toBe(false) // rating 未設定（旧データ）も 0 扱い
  })

  it("'eq5': rating === 5 のみ", () => {
    expect(matchesRating(withRating(5), 'eq5')).toBe(true)
    expect(matchesRating(withRating(4), 'eq5')).toBe(false)
    expect(matchesRating(withRating(0), 'eq5')).toBe(false)
  })

  it('整数でない rating は 0（未評価）として扱う', () => {
    expect(matchesRating(withRating(3.5), 'gte1')).toBe(false)
    expect(matchesRating(withRating('5'), 'eq5')).toBe(false)
  })

  it('不明なモードは一致しない', () => {
    expect(matchesRating(withRating(5), 'gte9')).toBe(false)
    expect(matchesRating(withRating(5), 'xyz')).toBe(false)
  })
})

describe('hasActiveFilters（共通キー拡張）', () => {
  const base = { nameFilter: '', typeFilter: 'all', catFilter: '', purposeFilter: '', sortDir: 'none', cuisine: '', wifi: 'all', power: 'all', wheelchair: [], rating: 'all', kerbHeight: 'any' }

  it('初期値・空オブジェクトは false', () => {
    expect(hasActiveFilters(base)).toBe(false)
    expect(hasActiveFilters({})).toBe(false)
    expect(hasActiveFilters(undefined)).toBe(false)
  })

  it('共通キーが初期値から外れると true', () => {
    expect(hasActiveFilters({ ...base, nameFilter: 'カフェ' })).toBe(true)
    expect(hasActiveFilters({ ...base, catFilter: 'cafe' })).toBe(true)
    expect(hasActiveFilters({ ...base, cuisine: 'ramen' })).toBe(true)
    expect(hasActiveFilters({ ...base, wifi: 'yes' })).toBe(true)
    expect(hasActiveFilters({ ...base, wifi: 'no' })).toBe(true)
    expect(hasActiveFilters({ ...base, power: 'yes' })).toBe(true)
    expect(hasActiveFilters({ ...base, wheelchair: 'partial' })).toBe(true)
    expect(hasActiveFilters({ ...base, rating: 'gte1' })).toBe(true)
    expect(hasActiveFilters({ ...base, rating: 'eq5' })).toBe(true)
  })

  it('nameFilter が空白だけなら絞り込み中ではない', () => {
    expect(hasActiveFilters({ ...base, nameFilter: '   ' })).toBe(false)
  })

  it('wheelchair 配列（複数選択）: 1つ以上なら true、空配列は false', () => {
    expect(hasActiveFilters({ ...base, wheelchair: ['yes'] })).toBe(true)
    expect(hasActiveFilters({ ...base, wheelchair: ['yes', 'no'] })).toBe(true)
    expect(hasActiveFilters({ ...base, wheelchair: [] })).toBe(false)
  })
})

describe('normalizeWheelchair（後方互換: 古い単一値形式を配列に正規化）', () => {
  it('配列はそのまま（無効値を除外）', () => {
    expect(normalizeWheelchair(['yes', 'no'])).toEqual(['yes', 'no'])
    expect(normalizeWheelchair(['yes', 'invalid'])).toEqual(['yes'])
    expect(normalizeWheelchair([])).toEqual([])
  })

  it('単一文字列を配列に移行', () => {
    expect(normalizeWheelchair('yes')).toEqual(['yes'])
    expect(normalizeWheelchair('partial')).toEqual(['partial'])
    expect(normalizeWheelchair('no')).toEqual(['no'])
  })

  it("'all' は初期値（空配列）に", () => {
    expect(normalizeWheelchair('all')).toEqual([])
  })

  it('不明な値・undefined・null は初期値（空配列）に', () => {
    expect(normalizeWheelchair('invalid')).toEqual([])
    expect(normalizeWheelchair(undefined)).toEqual([])
    expect(normalizeWheelchair(null)).toEqual([])
  })
})
