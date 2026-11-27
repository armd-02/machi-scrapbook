import { describe, it, expect } from 'vitest'
import { buildPoiQuery, buildSimpleQuery } from '../overpass'

const testBbox = { south: 34.700000, west: 135.480000, north: 34.710000, east: 135.490000 }

describe('#44 buildPoiQuery', () => {
  it('カテゴリ指定時: カテゴリフィルタを含むクエリを生成する', () => {
    const { query } = buildPoiQuery(testBbox, 'cafe', '')
    expect(query).toContain('[amenity=cafe]')
    expect(query).toContain('node')
    expect(query).toContain('way')
  })

  it('カテゴリ未指定時: POI対象タグに限定する', () => {
    const { query } = buildPoiQuery(testBbox, '', '')
    // POI対象タグが含まれる
    expect(query).toContain('[amenity]')
    expect(query).toContain('[shop]')
    expect(query).toContain('[tourism]')
    expect(query).toContain('[leisure]')
    expect(query).toContain('[office]')
    // 道路・建物は含まれない
    expect(query).not.toContain('[highway]')
    expect(query).not.toContain('[building]')
  })

  it('目的のみ指定時: その目的の施設種類unionに絞る（#44 目的スコープ）', () => {
    const { query } = buildPoiQuery(testBbox, '', '', '', 'お出かけ')
    // お出かけグループのフィルタが含まれる
    expect(query).toContain('[leisure~"^(park|playground|garden|pitch)$"]')
    expect(query).toContain('[amenity=plaza]')
    expect(query).toContain('[amenity=place_of_worship]')
    // お出かけに無関係なカテゴリ・汎用POIブランチは含まれない
    expect(query).not.toContain('[amenity=cafe]')
    expect(query).not.toContain('[shop]')
    expect(query).not.toContain('[office]')
  })

  it('カテゴリ+目的指定時: カテゴリが優先される（目的unionは使わない）', () => {
    const { query } = buildPoiQuery(testBbox, 'cafe', '', '', 'お出かけ')
    expect(query).toContain('[amenity=cafe]')
    expect(query).not.toContain('[amenity=place_of_worship]')
    expect(query).not.toContain('[shop]')
  })

  it('不明な目的名: 汎用POI検索にフォールバックする', () => {
    const { query } = buildPoiQuery(testBbox, '', '', '', '存在しない目的')
    expect(query).toContain('[amenity]')
    expect(query).toContain('[shop]')
  })

  it('キーワードが返される', () => {
    const { keyword } = buildPoiQuery(testBbox, 'cafe', '星巴克')
    expect(keyword).toBe('星巴克')
  })

  it('BBOX値が6桁小数でエンコードされる', () => {
    const { query } = buildPoiQuery(testBbox, '', '')
    expect(query).toContain('34.700000,135.480000,34.710000,135.490000')
  })

  it('飲食店カテゴリ: 複数値のunionを生成する', () => {
    const { query } = buildPoiQuery(testBbox, 'food_drink', '')
    expect(query).toContain('cafe')
    expect(query).toContain('restaurant')
    expect(query).toContain('fast_food')
  })

  // ===== バリアフリー検索（#62） =====

  it('バリアフリーカテゴリ選択時: 空tagsのため汎用POI検索にフォールバックする（クエリ組み込みは後続ピース）', () => {
    const { query } = buildPoiQuery(testBbox, 'barrier_free', '')
    // 空tags → カテゴリフィルタなし → 汎用POI body
    expect(query).toContain('[amenity]')
    expect(query).toContain('[shop]')
    // 歩道・縁石・音声案内フィルタはまだ含まれない
    expect(query).not.toContain('footway')
    expect(query).not.toContain('barrier=kerb')
    expect(query).not.toContain('traffic_signals')
  })

  it('バリアフリーカテゴリ未選択時: 歩道・縁石・音声案内フィルタが混入しない（汎用POI検索）', () => {
    const { query } = buildPoiQuery(testBbox, '', '')
    // バリアフリー特有のフィルタが含まれない
    expect(query).not.toContain('footway')
    expect(query).not.toContain('barrier=kerb')
    expect(query).not.toContain('traffic_signals:sound')
    expect(query).not.toContain('traffic_signals:vibration')
    // 汎用POIタグは含まれる
    expect(query).toContain('[amenity]')
    expect(query).toContain('[shop]')
  })

  it('バリアフリーカテゴリ未選択・目的未選択時も混入しない（cafe選択時）', () => {
    const { query } = buildPoiQuery(testBbox, 'cafe', '')
    expect(query).toContain('[amenity=cafe]')
    expect(query).not.toContain('footway')
    expect(query).not.toContain('barrier=kerb')
    expect(query).not.toContain('traffic_signals')
  })

  it('バリアフリーカテゴリ未選択・目的「バリアフリー」選択時: 空フィルタのため汎用POIにフォールバック', () => {
    const { query } = buildPoiQuery(testBbox, '', '', '', 'バリアフリー')
    // 空tags → purposeUnionFiltersが空 → 汎用POI body
    expect(query).toContain('[amenity]')
    expect(query).toContain('[shop]')
    // 歩道・縁石・音声案内フィルタはまだ含まれない
    expect(query).not.toContain('footway')
    expect(query).not.toContain('barrier=kerb')
    expect(query).not.toContain('traffic_signals')
  })

  it('バリアフリーカテゴリ未選択・目的「公共施設」選択時: バリアフリーフィルタは混入しない', () => {
    const { query } = buildPoiQuery(testBbox, '', '', '', '公共施設')
    // 公共施設にはバリアフリーフィルタが含まれない
    expect(query).not.toContain('footway')
    expect(query).not.toContain('barrier=kerb')
    expect(query).not.toContain('traffic_signals')
    // 公共施設のカテゴリ（トイレ・公衆電話・水飲み場・AED・郵便ポスト）は含まれる
    expect(query).toContain('amenity=toilets')
    expect(query).toContain('amenity=post_box')
    expect(query).toContain('emergency=defibrillator')
    // 移入した public_facility（役所・公共機関）のフィルタは含まれる
    expect(query).toContain('amenity~"^(townhall|post_office|police|fire_station|recycling|shelter|courthouse|public_building)$"')
    // 病院・金融系のフィルタは混入しない
    expect(query).not.toContain('amenity=pharmacy')
    expect(query).not.toContain('amenity=bank')
  })

  it('会社・事務所カテゴリ指定時: office の民間値 regex を使い、役所系・教育系は含まれない', () => {
    const { query } = buildPoiQuery(testBbox, 'company_office', '')
    // 民間の会社・事務所値で絞る
    expect(query).toContain('[office~"^(company|lawyer|financial|it|research|accounting|marketing|telecommunication|')
    // 役所系・教育系（既存カテゴリが扱う値）はクエリに含まれない
    expect(query).not.toContain('government')
    expect(query).not.toContain('educational_institution')
  })

  // (#62) 未選択時にバリアフリーが混ざらないことの固定
  it('未選択時: buildPoiQuery に highway・kerb・traffic_signals が含まれない', () => {
    const { query } = buildPoiQuery(testBbox, '', '')
    expect(query).not.toContain('highway')
    expect(query).not.toContain('kerb')
    expect(query).not.toContain('traffic_signals')
  })

  it('未選択時: buildSimpleQuery に highway・kerb・traffic_signals が含まれない', () => {
    const { query } = buildSimpleQuery(testBbox, '', '')
    expect(query).not.toContain('highway')
    expect(query).not.toContain('kerb')
    expect(query).not.toContain('traffic_signals')
  })
})
