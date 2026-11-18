// @vitest-environment jsdom
/**
 * (まちメモ帳絞り込み) src/utils/memochoFilters.js のテスト
 *
 * (共通フィルタバー) 統一後、絞り込みロジックはすべて utils/resultFilters.js
 * （matchesKeyword / matchesWifi / matchesPower / matchesWheelchair /
 * matchesRating / applyResultFilters / hasActiveFilters）に集約され、
 * memochoFilters.js は既定形状 DEFAULT_MEMO_FILTERS と薄いアダプタ
 * （applyMemochoFilters / isMemoFilterActive）のみを持つ。
 *
 * ここではそのアダプタの挙動（既定値補完・キー名の統一・AND 結合）と、
 * 再エクスポートされた共通判定関数のメモ帳側での挙動を検証する。
 * 共通判定関数の詳細な単体テストは resultFilters.test.js にある。
 *
 * 状態のキー名は検索一覧の resultFilters と統一:
 *   nameFilter / catFilter / missingFilter / perspective / cuisine /
 *   wifi / power / wheelchair / rating
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MEMO_FILTERS,
  applyMemochoFilters,
  isMemoFilterActive,
  matchesKeyword,
  matchesWifi,
  matchesWheelchair,
  matchesRating,
} from '../memochoFilters'

// テスト用のメモ帳アイテム（normalizeItem の出力と同じ形）
const item = (over = {}) => ({
  type: 'node',
  id: 1,
  name: 'テスト店',
  lat: 34.85,
  lon: 135.5,
  tags: { name: 'テスト店' },
  memo: '',
  addedAt: '2026-01-01T00:00:00.000Z',
  rating: 0,
  ...over,
})

describe('DEFAULT_MEMO_FILTERS', () => {
  it('全条件未適用の初期値であり、キー名は resultFilters（検索一覧）と統一されている', () => {
    expect(DEFAULT_MEMO_FILTERS).toEqual({
      nameFilter: '',
      catFilter: '',
      missingFilter: 'none',
      perspective: 'none',
      cuisine: '',
      wifi: 'all',
      power: 'all',
      wheelchair: 'all',
      rating: 'all',
    })
  })
})

describe('matchesKeyword（共通ロジックの再エクスポート）', () => {
  it('名前が部分一致すれば true', () => {
    const it1 = item({ name: 'テスト珈琲店' })
    expect(matchesKeyword(it1, '珈琲')).toBe(true)
    expect(matchesKeyword(it1, 'テスト珈琲店')).toBe(true)
    expect(matchesKeyword(it1, 'ラーメン')).toBe(false)
  })

  it('メモ本文が部分一致すれば true（名前に出ない言葉でも）', () => {
    const it1 = item({ name: 'カフェA', memo: '静かでWiFiが速い' })
    expect(matchesKeyword(it1, '静か')).toBe(true)
    expect(matchesKeyword(it1, '名前にもメモにもない')).toBe(false)
  })

  it('name:ja タグも対象になる（一覧・メモ帳で統一されたキーワ—ド判定）', () => {
    const it1 = item({ name: 'Test Shop', tags: { name: 'Test Shop', 'name:ja': 'テスト喫茶' } })
    expect(matchesKeyword(it1, '喫茶')).toBe(true)
  })

  it('大小文字を無視する', () => {
    const it1 = item({ name: 'Cafe Latte', memo: 'fast wifi' })
    expect(matchesKeyword(it1, 'CAFE')).toBe(true)
    expect(matchesKeyword(it1, 'WIFI')).toBe(true)
    expect(matchesKeyword(it1, 'wifi')).toBe(true)
  })

  it('空・空白だけのキーワードは全件一致', () => {
    const it1 = item({ name: '何でもいい' })
    expect(matchesKeyword(it1, '')).toBe(true)
    expect(matchesKeyword(it1, '   ')).toBe(true)
  })

  it('item が無い（null）場合でも例外にならず false（空キーワードなら true）', () => {
    expect(matchesKeyword(null, 'abc')).toBe(false)
    expect(matchesKeyword(null, '')).toBe(true)
  })
})

describe('matchesWifi（共通ロジック: wifiStatus の3状態判定）', () => {
  const withAccess = (v) => item({ tags: { internet_access: v } })

  it("'all' は全件一致", () => {
    expect(matchesWifi(item(), 'all')).toBe(true)
    expect(matchesWifi(withAccess('no'), 'all')).toBe(true)
  })

  it("'yes'（あり）: 設定されていて 'no' でない値（wireless/wired/proprietary/terminal 等）", () => {
    for (const v of ['wireless', 'wired', 'terminal', 'proprietary', 'yes', 'pay']) {
      expect(matchesWifi(withAccess(v), 'yes')).toBe(true)
    }
  })

  it("'yes'（あり）: 'no'・未設定・空文字は一致しない", () => {
    expect(matchesWifi(withAccess('no'), 'yes')).toBe(false)
    expect(matchesWifi(item(), 'yes')).toBe(false)
    expect(matchesWifi(withAccess(''), 'yes')).toBe(false)
  })

  it("'no'（なし）: internet_access が 'no' の場合のみ一致（未登録は含めない）", () => {
    expect(matchesWifi(withAccess('no'), 'no')).toBe(true)
    expect(matchesWifi(item(), 'no')).toBe(false)
    expect(matchesWifi(withAccess(''), 'no')).toBe(false)
    expect(matchesWifi(withAccess('wireless'), 'no')).toBe(false)
  })
})

describe('matchesWheelchair（共通ロジック: tags.wheelchair の値で判定）', () => {
  const withWc = (v) => item({ tags: { wheelchair: v } })

  it("'all' は全件一致", () => {
    expect(matchesWheelchair(item(), 'all')).toBe(true)
    expect(matchesWheelchair(withWc('designated'), 'all')).toBe(true)
  })

  it("'yes'（対応可）: 'yes' / 'designated' が一致", () => {
    expect(matchesWheelchair(withWc('yes'), 'yes')).toBe(true)
    expect(matchesWheelchair(withWc('designated'), 'yes')).toBe(true)
    expect(matchesWheelchair(withWc('limited'), 'yes')).toBe(false)
    expect(matchesWheelchair(withWc('no'), 'yes')).toBe(false)
    expect(matchesWheelchair(item(), 'yes')).toBe(false)
  })

  it("'partial'（一部対応）: 'limited' のみが一致", () => {
    expect(matchesWheelchair(withWc('limited'), 'partial')).toBe(true)
    expect(matchesWheelchair(withWc('yes'), 'partial')).toBe(false)
    expect(matchesWheelchair(withWc('designated'), 'partial')).toBe(false)
    expect(matchesWheelchair(withWc('no'), 'partial')).toBe(false)
    expect(matchesWheelchair(item(), 'partial')).toBe(false)
  })

  it("'no'（対応なし）: 'no' のみが一致（未登録は一致しない）", () => {
    expect(matchesWheelchair(withWc('no'), 'no')).toBe(true)
    expect(matchesWheelchair(withWc('yes'), 'no')).toBe(false)
    expect(matchesWheelchair(withWc('limited'), 'no')).toBe(false)
    expect(matchesWheelchair(item(), 'no')).toBe(false)
  })
})

describe('matchesRating（共通ロジック: rating フィールド。0＝未評価）', () => {
  const withRating = (v) => item({ rating: v })

  it("'all' は全件一致", () => {
    expect(matchesRating(item({ rating: 0 }), 'all')).toBe(true)
    expect(matchesRating(withRating(5), 'all')).toBe(true)
  })

  it("'gte1': rating >= 1（未評価・0 は一致しない）", () => {
    expect(matchesRating(withRating(1), 'gte1')).toBe(true)
    expect(matchesRating(withRating(5), 'gte1')).toBe(true)
    expect(matchesRating(withRating(0), 'gte1')).toBe(false)
    expect(matchesRating(item({}), 'gte1')).toBe(false) // rating 未設定（旧データ）も 0 扱い
  })

  it("'gte2'〜'gte4': rating が N 以上", () => {
    expect(matchesRating(withRating(2), 'gte2')).toBe(true)
    expect(matchesRating(withRating(1), 'gte2')).toBe(false)
    expect(matchesRating(withRating(3), 'gte3')).toBe(true)
    expect(matchesRating(withRating(2), 'gte3')).toBe(false)
    expect(matchesRating(withRating(4), 'gte4')).toBe(true)
    expect(matchesRating(withRating(3), 'gte4')).toBe(false)
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
})

describe('isMemoFilterActive（共通の hasActiveFilters に委譲）', () => {
  const base = { ...DEFAULT_MEMO_FILTERS }
  it('初期値（引数なし・デフォルト・空オブジェクト）は false', () => {
    expect(isMemoFilterActive()).toBe(false)
    expect(isMemoFilterActive(base)).toBe(false)
    expect(isMemoFilterActive({})).toBe(false)
  })

  it('各条件が初期値から外れると true', () => {
    expect(isMemoFilterActive({ ...base, nameFilter: 'カフェ' })).toBe(true)
    expect(isMemoFilterActive({ ...base, catFilter: 'cafe' })).toBe(true)
    expect(isMemoFilterActive({ ...base, missingFilter: 'phone' })).toBe(true)
    expect(isMemoFilterActive({ ...base, perspective: 'wheelchair' })).toBe(true)
    expect(isMemoFilterActive({ ...base, cuisine: 'ramen' })).toBe(true)
    expect(isMemoFilterActive({ ...base, wifi: 'yes' })).toBe(true)
    expect(isMemoFilterActive({ ...base, wifi: 'no' })).toBe(true)
    expect(isMemoFilterActive({ ...base, power: 'yes' })).toBe(true)
    expect(isMemoFilterActive({ ...base, wheelchair: 'yes' })).toBe(true)
    expect(isMemoFilterActive({ ...base, rating: 'gte1' })).toBe(true)
    expect(isMemoFilterActive({ ...base, rating: 'eq5' })).toBe(true)
  })

  it('キーワードが空白だけなら絞り込み中ではない', () => {
    expect(isMemoFilterActive({ ...base, nameFilter: '   ' })).toBe(false)
  })
})

describe('applyMemochoFilters（共通の applyResultFilters への委譲）', () => {
  const CAFE_WIFI = item({ id: 2001, name: 'カフェA', memo: '静かでWiFiが速い', rating: 4, tags: { name: 'カフェA', amenity: 'cafe', cuisine: 'coffee', internet_access: 'wireless', wheelchair: 'yes' } })
  const CAFE_NO_WIFI = item({ id: 2002, name: 'カフェB', rating: 2, tags: { name: 'カフェB', amenity: 'cafe', cuisine: 'coffee', internet_access: 'no' } })
  const RAMEN_PROP = item({ id: 2003, name: 'ラーメンC', memo: 'こしょうが効いている', rating: 3, tags: { name: 'ラーメンC', amenity: 'restaurant', cuisine: 'ramen', internet_access: 'proprietary', wheelchair: 'limited' } })
  const RAMEN_WIRED = item({ id: 2004, name: 'ラーメンE', rating: 0, tags: { name: 'ラーメンE', amenity: 'restaurant', cuisine: 'ramen', internet_access: 'wired' } })
  const SUSHI_NONE = item({ id: 2005, name: '寿司D', rating: 5, tags: { name: '寿司D', amenity: 'restaurant', cuisine: 'sushi', wheelchair: 'no' } })
  const PARK = item({ id: 3001, name: 'みらい公園', rating: 0, tags: { name: 'みらい公園', leisure: 'park' } })
  const ALL = [CAFE_WIFI, CAFE_NO_WIFI, RAMEN_PROP, RAMEN_WIRED, SUSHI_NONE, PARK]
  const names = (arr) => arr.map((x) => x.name)

  it('デフォルト・空の filters では全件そのまま（順序維持）', () => {
    // ※ applyResultFilters の慣習どおり、フィルタ未適用時は入力配列の参照が
    //   そのまま返ることがある（内容は常に正しい）
    const out1 = applyMemochoFilters(ALL)
    expect(out1).toHaveLength(6)
    expect(names(out1)).toEqual(['カフェA', 'カフェB', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園'])
    const out2 = applyMemochoFilters(ALL, {})
    expect(names(out2)).toHaveLength(6)
  })

  it('filters の欠落キーはデフォルトで補われる', () => {
    const out = applyMemochoFilters(ALL, { cuisine: 'ramen' })
    expect(names(out)).toEqual(['ラーメンC', 'ラーメンE'])
  })

  it('キーワード（nameFilter）: 名前・name:ja・メモ本文の部分一致', () => {
    expect(names(applyMemochoFilters(ALL, { nameFilter: 'ラーメン' }))).toEqual(['ラーメンC', 'ラーメンE'])
    expect(names(applyMemochoFilters(ALL, { nameFilter: '静か' }))).toEqual(['カフェA'])
    expect(names(applyMemochoFilters(ALL, { nameFilter: 'WIFI' }))).toEqual(['カフェA']) // 大小文字無視
  })

  it('カテゴリ（catFilter）: 一覧と同じ categoryMatchesElement 判定', () => {
    expect(names(applyMemochoFilters(ALL, { catFilter: 'restaurant' }))).toEqual(['ラーメンC', 'ラーメンE', '寿司D'])
    expect(names(applyMemochoFilters(ALL, { catFilter: 'cafe' }))).toEqual(['カフェA', 'カフェB'])
  })

  it('属性欠落（missingFilter）: 一覧と同じ missingAttributesOf ベース', () => {
    const withPhone = item({ id: 9101, name: '喫茶K', tags: { name: '喫茶K', amenity: 'cafe', phone: '06-1234-5678' } })
    const ALLP = [...ALL, withPhone]
    // 電話が登録されているのは喫茶Kだけ。残る6件は phone 未登録（公園も phone なし）
    expect(names(applyMemochoFilters(ALLP, { missingFilter: 'phone' }))).toEqual(['カフェA', 'カフェB', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園'])
    // 'any'（いずれか1つ以上欠落）: 喫茶Kも opening_hours/website/address が未登録なので全件一致
    expect(names(applyMemochoFilters(ALLP, { missingFilter: 'any' }))).toHaveLength(7)
    // 電話が登録済みのアイテムだけだと 'phone' には一致しない
    expect(applyMemochoFilters([withPhone], { missingFilter: 'phone' })).toHaveLength(0)
  })

  it("WiFi: あり＝'yes'（登録済みで no 以外）、なし＝'no' のみ（未登録は含めない）", () => {
    expect(names(applyMemochoFilters(ALL, { wifi: 'yes' }))).toEqual(['カフェA', 'ラーメンC', 'ラーメンE'])
    expect(names(applyMemochoFilters(ALL, { wifi: 'no' }))).toEqual(['カフェB'])
  })

  it("電源（power）: 'yes'（powerStatus が yes）のみが残る", () => {
    expect(applyMemochoFilters(ALL, { power: 'yes' })).toHaveLength(0) // フィクスチャに電源タグなし
    const withSocket = item({ id: 9002, name: 'カフェG', tags: { name: 'カフェG', amenity: 'cafe', socket: 'yes' } })
    const withSupply = item({ id: 9003, name: 'カフェH', tags: { name: 'カフェH', amenity: 'cafe', power_supply: 'yes' } })
    const noSupply = item({ id: 9004, name: 'カフェI', tags: { name: 'カフェI', amenity: 'cafe', power_supply: 'no' } })
    expect(names(applyMemochoFilters([withSocket, withSupply, noSupply], { power: 'yes' }))).toEqual(['カフェG', 'カフェH'])
  })

  it("車椅子: 'yes' = yes/designated、'partial' = limited、'no' = no（未登録は除外）", () => {
    expect(names(applyMemochoFilters(ALL, { wheelchair: 'yes' }))).toEqual(['カフェA'])
    expect(names(applyMemochoFilters(ALL, { wheelchair: 'partial' }))).toEqual(['ラーメンC'])
    expect(names(applyMemochoFilters(ALL, { wheelchair: 'no' }))).toEqual(['寿司D'])
    const designated = item({ id: 9005, name: 'カフェJ', tags: { name: 'カフェJ', amenity: 'cafe', wheelchair: 'designated' } })
    expect(names(applyMemochoFilters([designated], { wheelchair: 'yes' }))).toEqual(['カフェJ'])
  })

  it('料理の種別: 一覧側と同一の処理（部分一致・";"区切り・大小文字無視）', () => {
    expect(names(applyMemochoFilters(ALL, { cuisine: 'ramen' }))).toEqual(['ラーメンC', 'ラーメンE'])
    // ';' 区切りの複数値のうち部分一致すれば残る
    const multi = item({ id: 9001, name: '多国籍F', tags: { name: '多国籍F', amenity: 'restaurant', cuisine: 'ramen; noodles; sushi' } })
    expect(names(applyMemochoFilters([multi], { cuisine: 'noodle' }))).toEqual(['多国籍F'])
    expect(names(applyMemochoFilters([multi], { cuisine: 'SUSHI' }))).toEqual(['多国籍F']) // 大小文字無視
    // cuisine タグが無いアイテムは cuisine フィルタ適用時に除外される
    expect(applyMemochoFilters([PARK], { cuisine: 'ramen' })).toHaveLength(0)
  })

  it('★評価: ★N以上 ＝ rating >= N、★5のみ ＝ rating === 5', () => {
    expect(names(applyMemochoFilters(ALL, { rating: 'gte1' }))).toEqual(['カフェA', 'カフェB', 'ラーメンC', '寿司D'])
    expect(names(applyMemochoFilters(ALL, { rating: 'gte3' }))).toEqual(['カフェA', 'ラーメンC', '寿司D'])
    expect(names(applyMemochoFilters(ALL, { rating: 'gte4' }))).toEqual(['カフェA', '寿司D'])
    expect(names(applyMemochoFilters(ALL, { rating: 'eq5' }))).toEqual(['寿司D'])
  })

  it('複数条件は AND で適用される', () => {
    // WiFiあり ＋ ラーメン ＝ internet_access 登録のラーメンだけ
    expect(names(applyMemochoFilters(ALL, { wifi: 'yes', cuisine: 'ramen' }))).toEqual(['ラーメンC', 'ラーメンE'])
    // キーワード ＋ ★1以上 ＝ 両方一致のものだけ（ラーメンE は rating 0 で落ちる）
    expect(names(applyMemochoFilters(ALL, { nameFilter: 'ラーメン', rating: 'gte1' }))).toEqual(['ラーメンC'])
    // WiFiなし {B} × 車椅子対応可 {A} ＝ 0件
    expect(applyMemochoFilters(ALL, { wifi: 'no', wheelchair: 'yes' })).toHaveLength(0)
  })

  it('空配列・items が無い場合でも安全に空配列を返す', () => {
    expect(applyMemochoFilters([], { nameFilter: 'x', wifi: 'yes' })).toEqual([])
    expect(applyMemochoFilters(null, { nameFilter: 'x' })).toEqual([])
  })
})
