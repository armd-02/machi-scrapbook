import { describe, it, expect } from 'vitest'
import {
  CATEGORIES,
  CATEGORY_GROUPS,
  CUISINES,
  getCategoryById,
  getGroupedCategories,
  categoryToQueryFilter,
  categoryToReadableTags,
  isFoodCategory,
  getCategoriesForPurpose,
  getPurposeOfCategory,
  getPurposeUnionFilters,
  getPurposeLabelList
} from '../../data/categories'

// 新構成（再編）の10種別: 「すること」系→「生活の施設」系の順
const GROUP_NAMES = [
  '食べる', '買う', '遊ぶ・巡る', '学ぶ・仕事', '病院・薬局', '公共施設',
  '銀行・金融', '会社・事務所', '移動・交通', 'バリアフリー'
]

describe('カテゴリの目的ベースグループ化（#44 生活者目線UI・再編）', () => {
  it('10の種別グループ（カテゴリの重複所属なし）を新しい順序で返す', () => {
    const grouped = getGroupedCategories()
    expect(grouped.length).toBe(10)
    expect(grouped.map((g) => g.group)).toEqual(GROUP_NAMES)
    // 重複所属が廃止されたため、カテゴリ総数は CATEGORIES と一致
    const total = grouped.reduce((n, g) => n + g.categories.length, 0)
    expect(total).toBe(CATEGORIES.length)
  })

  it('各カテゴリはちょうど1つの種別にだけ所属する（分区・漏れなし）', () => {
    const seen = new Map()
    for (const name of GROUP_NAMES) {
      for (const cat of getCategoriesForPurpose(name)) {
        expect(seen.has(cat.id)).toBe(false) // グループ間の重複なし
        seen.set(cat.id, name)
      }
    }
    // 全カテゴリがちょうど1グループに所属（漏れ・余計な追加がない）
    expect(seen.size).toBe(CATEGORIES.length)
    for (const c of CATEGORIES) {
      expect(seen.has(c.id)).toBe(true)
    }
  })

  it('各グループの所属カテゴリが新しい構成と一致する', () => {
    const expected = {
      '食べる': ['food_drink', 'cafe', 'restaurant', 'fast_food', 'bar_izakaya'],
      '買う': ['retail', 'convenience', 'funeral'],
      '遊ぶ・巡る': ['park', 'sports', 'museum', 'worship', 'accommodation', 'entertainment', 'bath'],
      '学ぶ・仕事': ['kindergarten', 'primary_school', 'university', 'prep_school', 'school', 'library', 'coworking', 'community_centre', 'lessons'],
      '病院・薬局': ['hospital', 'pharmacy', 'veterinary', 'welfare'],
      '公共施設': ['toilets', 'telephone', 'drinking_water', 'aed', 'post_box', 'public_facility'],
      '銀行・金融': ['bank'],
      '会社・事務所': ['company_office'],
      '移動・交通': ['transport'],
      'バリアフリー': ['barrier_free']
    }
    for (const [name, ids] of Object.entries(expected)) {
      expect(getCategoriesForPurpose(name).map((c) => c.id)).toEqual(ids)
    }
  })

  it('旧グループ「暮らす」「その他」は廃止されている', () => {
    for (const name of ['暮らす', 'その他']) {
      expect(CATEGORY_GROUPS.find((g) => g.name === name)).toBeUndefined()
      expect(getCategoriesForPurpose(name)).toBeNull()
    }
  })

  it('「遊ぶ・巡る」グループの表示名は「遊ぶ・巡る」（旧「遊ぶ・公園」改名、タイル・ピッカーで統一）', () => {
    const g = CATEGORY_GROUPS.find((x) => x.ids.includes('park'))
    expect(g.name).toBe('遊ぶ・巡る')
  })

  it('グループ名とグループ内順序がCATEGORY_GROUPS定義（広い→狭い）と一致する', () => {
    const grouped = getGroupedCategories()
    grouped.forEach((g, i) => {
      expect(g.group).toBe(CATEGORY_GROUPS[i].name)
      expect(g.categories.map((c) => c.id)).toEqual(CATEGORY_GROUPS[i].ids)
    })
  })

  it('完全に重複するサブセットエントリ（supermarket, gas_station）は削除済み', () => {
    const ids = CATEGORIES.map((c) => c.id)
    expect(ids).not.toContain('supermarket')
    expect(ids).not.toContain('gas_station')
  })

  it('(#54) ラーメンカテゴリは削除済みで、cuisineは独立フィルタ（CUISINES）として扱う', () => {
    // カテゴリからラーメンが削除されている
    expect(getCategoryById('ramen')).toBeNull()
    expect(CATEGORIES.map((c) => c.id)).not.toContain('ramen')

    // cuisineフィルタは独立次元: ラーメン・うどんを含む
    const values = CUISINES.map((c) => c.value)
    expect(values).toContain('ramen')
    expect(values).toContain('udon')
    // 値が一意
    expect(new Set(values).size).toBe(values.length)
    // ラベルがすべて日本語
    for (const c of CUISINES) {
      expect(c.label).toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/)
    }
  })

  it('(#54) 「食べる」グループはamenity粒度の5種（food_drinkが合集合、残りは単一タイプ）', () => {
    const foodGroup = CATEGORY_GROUPS.find((g) => g.name === '食べる')
    expect(foodGroup.ids).toEqual(['food_drink', 'cafe', 'restaurant', 'fast_food', 'bar_izakaya'])

    // 単一タイプカテゴリはamenity=1値のフィルタ
    const cafe = categoryToQueryFilter(getCategoryById('cafe'))
    expect(cafe.unionFilters).toEqual(['amenity=cafe'])
    const ff = categoryToQueryFilter(getCategoryById('fast_food'))
    expect(ff.unionFilters).toEqual(['amenity=fast_food'])
    // バー・居酒屋は3値OR
    const bar = categoryToQueryFilter(getCategoryById('bar_izakaya'))
    expect(bar.unionFilters[0]).toBe('amenity~"^(bar|pub|izakaya)$"')
  })

  it('(#54) isFoodCategory: 「食べる」グループのみtrue、それ以外はfalse', () => {
    for (const id of ['food_drink', 'cafe', 'restaurant', 'fast_food', 'bar_izakaya']) {
      expect(isFoodCategory(id)).toBe(true)
    }
    for (const id of ['retail', 'pharmacy', 'school', 'transport', 'bank', '', null, 'ramen']) {
      expect(isFoodCategory(id)).toBe(false)
    }
  })

  it('getCategoriesForPurpose: 目的名からカテゴリ一覧を取得、未知の目的はnull', () => {
    const eat = getCategoriesForPurpose('食べる')
    expect(eat.map((c) => c.id)).toEqual(['food_drink', 'cafe', 'restaurant', 'fast_food', 'bar_izakaya'])
    const publicFac = getCategoriesForPurpose('公共施設')
    expect(publicFac.map((c) => c.id)).toEqual(['toilets', 'telephone', 'drinking_water', 'aed', 'post_box', 'public_facility'])
    const bf = getCategoriesForPurpose('バリアフリー')
    expect(bf.map((c) => c.id)).toEqual(['barrier_free'])
    expect(getCategoriesForPurpose('存在しない目的')).toBeNull()
  })

  it('getPurposeOfCategory: カテゴリ→唯一の所属種別名を解決できる', () => {
    expect(getPurposeOfCategory('cafe')).toBe('食べる')
    expect(getPurposeOfCategory('convenience')).toBe('買う')
    expect(getPurposeOfCategory('park')).toBe('遊ぶ・巡る')
    expect(getPurposeOfCategory('accommodation')).toBe('遊ぶ・巡る')
    expect(getPurposeOfCategory('hospital')).toBe('病院・薬局')
    expect(getPurposeOfCategory('public_facility')).toBe('公共施設')
    expect(getPurposeOfCategory('bank')).toBe('銀行・金融')
    expect(getPurposeOfCategory('school')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('kindergarten')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('primary_school')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('university')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('prep_school')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('toilets')).toBe('公共施設')
    expect(getPurposeOfCategory('telephone')).toBe('公共施設')
    expect(getPurposeOfCategory('drinking_water')).toBe('公共施設')
    expect(getPurposeOfCategory('aed')).toBe('公共施設')
    expect(getPurposeOfCategory('post_box')).toBe('公共施設')
    expect(getPurposeOfCategory('company_office')).toBe('会社・事務所')
    // (#再編) 新カテゴリの所属
    expect(getPurposeOfCategory('funeral')).toBe('買う')
    expect(getPurposeOfCategory('entertainment')).toBe('遊ぶ・巡る')
    expect(getPurposeOfCategory('bath')).toBe('遊ぶ・巡る')
    expect(getPurposeOfCategory('coworking')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('community_centre')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('lessons')).toBe('学ぶ・仕事')
    expect(getPurposeOfCategory('veterinary')).toBe('病院・薬局')
    expect(getPurposeOfCategory('welfare')).toBe('病院・薬局')
    expect(getPurposeOfCategory('transport')).toBe('移動・交通')
    expect(getPurposeOfCategory('barrier_free')).toBe('バリアフリー')
    expect(getPurposeOfCategory('ramen')).toBeNull()
  })

  it('すべての目的グループにicon（emoji）が付与されていて、重複しない', () => {
    const icons = CATEGORY_GROUPS.map((g) => g.icon)
    for (const g of CATEGORY_GROUPS) {
      expect(g.icon).toBeTruthy()
      expect(g.icon.length).toBeGreaterThan(0)
    }
    expect(new Set(icons).size).toBe(icons.length)
  })
})

describe('新規の種別詳細（公衆電話・水飲み場・AED・郵便ポスト）', () => {
  it('CATEGORIES に4件存在し、正しいタグ・ラベル・所属種別を持つ', () => {
    const expected = [
      { id: 'telephone', label: '公衆電話', filter: 'amenity=telephone' },
      { id: 'drinking_water', label: '水飲み場', filter: 'amenity=drinking_water' },
      { id: 'aed', label: 'AED', filter: 'emergency=defibrillator' },
      { id: 'post_box', label: '郵便ポスト', filter: 'amenity=post_box' }
    ]
    for (const e of expected) {
      const cat = getCategoryById(e.id)
      expect(cat).toBeTruthy()
      expect(cat.label).toBe(e.label)
      expect(categoryToQueryFilter(cat).unionFilters).toEqual([e.filter])
      expect(getPurposeOfCategory(e.id)).toBe('公共施設')
    }
  })
})

describe('既存カテゴリの変更（ラベル・transportタグ）', () => {
  it('public_facility のラベルは「役所・公共機関」（新種別「公共設備」との名前衝突回避。IDはそのまま）', () => {
    const cat = getCategoryById('public_facility')
    expect(cat.id).toBe('public_facility')
    expect(cat.label).toBe('役所・公共機関')
  })

  it('transport の取得タグに bicycle_rental・bicycle_parking が追加されている（既存タグはそのまま）', () => {
    const f = categoryToQueryFilter(getCategoryById('transport'))
    expect(f.unionFilters).toEqual([
      'railway~"^(station|subway_entry|tram_stop)$"',
      'highway~"^(bus_stop|platform)$"',
      'amenity~"^(fuel|parking|bicycle_rental|bicycle_parking|taxi|bus_station|ferry_terminal|car_rental|charging_station|car_wash)$"'
    ])
    expect(getCategoryById('transport').label).toBe('交通・駅')
  })
})

describe('#44 目的スコープ検索（getPurposeUnionFilters / getPurposeLabelList）', () => {
  it('getPurposeUnionFilters: グループ内全カテゴリのタグ条件を重複除去してunion化できる', () => {
    const filters = getPurposeUnionFilters('遊ぶ・巡る')
    // 公園2 + スポーツ1 + 博物館1 + 寺院神社2 + 宿泊2 + 娯楽3 + 銭湯2 = 13条件
    expect(filters).toHaveLength(13)
    expect(filters).toContain('leisure~"^(park|playground|garden|pitch)$"')
    expect(filters).toContain('leisure~"^(sports_centre|stadium|swimming_pool|pitch|golf_course|tennis_court|basketball_court|volleyball_court|dance|fitness_centre|sports_hall)$"')
    expect(filters).toContain('amenity=plaza')
    expect(filters).toContain('amenity=place_of_worship')
    expect(filters).toContain('building=hotel')
    expect(filters).toContain('amenity~"^(cinema|theatre|karaoke_box)$"')
    expect(filters).toContain('amenity=public_bath')
    // 単一カテゴリ（カフェ）のフィルタが混入しない
    expect(filters).not.toContain('amenity=cafe')
  })

  it('getPurposeUnionFilters: 未知の目的・空は空配列', () => {
    expect(getPurposeUnionFilters('存在しない目的')).toEqual([])
    expect(getPurposeUnionFilters('')).toEqual([])
  })

  it('getPurposeLabelList: グループ内カテゴリラベルを「・」区切りで返す', () => {
    expect(getPurposeLabelList('遊ぶ・巡る')).toBe('公園・広場・スポーツ施設・美術館・博物館・寺院・神社・宿泊施設・映画・娯楽・銭湯・サウナ')
    expect(getPurposeLabelList('公共施設')).toBe('トイレ・公衆電話・水飲み場・AED・郵便ポスト・役所・公共機関')
    expect(getPurposeLabelList('バリアフリー')).toBe('バリアフリー')
    expect(getPurposeLabelList('存在しない目的')).toBe('')
  })

  it('getPurposeUnionFilters: 「バリアフリー」は空フィルタ（クエリ組み込みは後続ピース）', () => {
    const filters = getPurposeUnionFilters('バリアフリー')
    expect(filters).toEqual([])
  })

  it('getPurposeUnionFilters: 病院・薬局 = 病院・クリニック + 薬局・ドラッグストア + 動物病院 + 福祉施設 のunion', () => {
    expect(getPurposeUnionFilters('病院・薬局')).toEqual([
      'amenity~"^(hospital|clinic|doctors|dentist)$"',
      'shop=massage',
      'amenity=pharmacy',
      'shop=drugstore',
      'amenity=veterinary',
      'amenity~"^(social_facility|nursing_home)$"'
    ])
  })

  it('getPurposeUnionFilters: 銀行・金融 = bank のunion（質屋・金貸し・郵便局・金融）', () => {
    expect(getPurposeUnionFilters('銀行・金融')).toEqual([
      'amenity~"^(bank|atm|money_lending|post_office)$"',
      'shop=pawnbroker',
      'office=financial'
    ])
  })

  it('getPurposeUnionFilters: 公共施設 = トイレ・公衆電話・水飲み場・AED・郵便ポスト・役所・公共機関 のunion', () => {
    expect(getPurposeUnionFilters('公共施設')).toEqual([
      'amenity=toilets',
      'amenity=telephone',
      'amenity=drinking_water',
      'emergency=defibrillator',
      'amenity=post_box',
      'amenity~"^(townhall|post_office|police|fire_station|recycling|shelter|courthouse|public_building)$"',
      'office~"^(government|municipality)$"'
    ])
  })

  it('getPurposeLabelList: クイックグループの案内文', () => {
    expect(getPurposeLabelList('病院・薬局')).toBe('病院・クリニック・薬局・ドラッグストア・動物病院・福祉施設')
    expect(getPurposeLabelList('銀行・金融')).toBe('銀行・金融')
    expect(getPurposeLabelList('公共施設')).toBe('トイレ・公衆電話・水飲み場・AED・郵便ポスト・役所・公共機関')
  })

  it('getPurposeUnionFilters: 他の目的グループに barrier_free フィルタが混入しない', () => {
    for (const name of GROUP_NAMES.filter((n) => n !== 'バリアフリー')) {
      const filters = getPurposeUnionFilters(name)
      for (const f of filters) {
        expect(f).not.toContain('footway')
        expect(f).not.toContain('kerb')
        expect(f).not.toContain('traffic_signals')
      }
    }
  })
})

describe('バリアフリーカテゴリ（#62）', () => {
  it('barrier_freeカテゴリがCATEGORIESに存在し、getCategoryByIdで取得できる', () => {
    const cat = getCategoryById('barrier_free')
    expect(cat).toBeTruthy()
    expect(cat.label).toBe('バリアフリー')
    expect(cat.logic).toBe('or')
    expect(cat.tags).toEqual([])
    expect(cat.description).toContain('歩道')
    expect(cat.description).toContain('縁石')
    expect(cat.description).toContain('音声案内')
  })

  it('categoryToQueryFilter: 空tagsで空フィルタを返す（クエリ組み込みは後続ピース）', () => {
    const f = categoryToQueryFilter(getCategoryById('barrier_free'))
    expect(f.unionFilters).toEqual([])
    expect(f.andFilters).toEqual([])
  })

  it('categoryToReadableTags: 空tagsで空文字列を返す（施設タグ風の表示にならない）', () => {
    const readable = categoryToReadableTags(getCategoryById('barrier_free'))
    expect(readable).toBe('')
  })
})

describe('会社・事務所カテゴリ', () => {
  it('CATEGORIESに存在し、getCategoryByIdで取得できる', () => {
    const cat = getCategoryById('company_office')
    expect(cat).toBeTruthy()
    expect(cat.label).toBe('会社・事務所')
    expect(cat.logic).toBe('or')
    expect(cat.tags).toHaveLength(1)
    expect(cat.tags[0].key).toBe('office')
  })

  it('office値は民間の会社・専門事務所・団体に限定される', () => {
    const values = getCategoryById('company_office').tags[0].values
    // 仕様が代表値として列挙する値がすべて含まれる
    for (const v of ['company', 'lawyer', 'financial', 'it', 'research', 'accounting', 'marketing', 'telecommunication']) {
      expect(values).toContain(v)
    }
    // coworking は「学ぶ・仕事」の独立詳細に移動済み（company_office には含まれない）
    expect(values).not.toContain('coworking')
    // 既存カテゴリが扱う値（役所系・教育系）は含まれない
    for (const v of ['government', 'municipality', 'educational_institution']) {
      expect(values).not.toContain(v)
    }
  })

  it('categoryToQueryFilter: office の値列挙 regex フィルタ（OR）を返す', () => {
    const f = categoryToQueryFilter(getCategoryById('company_office'))
    expect(f.andFilters).toEqual([])
    expect(f.unionFilters).toHaveLength(1)
    expect(f.unionFilters[0]).toBe('office~"^(company|lawyer|financial|it|research|accounting|marketing|telecommunication|accountant|advertising_agency|airline|architect|association|broadcaster|charity|construction_company|consulting|courier|employment_agency|energy_supplier|engineer|estate_agent|event_management|financial_advisor|foundation|graphic_design|insurance|logistics|moving_company|newspaper|ngo|notary|publisher|property_management|security|surveyor|tax_advisor|transport|travel_agent|union|visa|water_utility|yes)$"')
  })

  it('「会社・事務所」種別に属する（唯一の所属グループ）', () => {
    expect(getPurposeOfCategory('company_office')).toBe('会社・事務所')
  })

  it('categoryToReadableTags: office の値が表示される', () => {
    const readable = categoryToReadableTags(getCategoryById('company_office'))
    expect(readable).toContain('office')
    expect(readable).toContain('company')
  })

  it('フード系カテゴリではない（料理フィルタに組み込まれない）', () => {
    expect(isFoodCategory('company_office')).toBe(false)
  })
})

describe('#再編 新カテゴリ（コワーキング・公民館・習い事・映画・娯楽・銭湯・サウナ・動物病院・福祉・葬儀）', () => {
  it('8件の新カテゴリが存在し、正しいラベル・所属種別を持つ', () => {
    const expected = [
      { id: 'coworking', label: 'コワーキング', purpose: '学ぶ・仕事' },
      { id: 'community_centre', label: '公民館・コミュニティ', purpose: '学ぶ・仕事' },
      { id: 'lessons', label: '習い事・教習', purpose: '学ぶ・仕事' },
      { id: 'entertainment', label: '映画・娯楽', purpose: '遊ぶ・巡る' },
      { id: 'bath', label: '銭湯・サウナ', purpose: '遊ぶ・巡る' },
      { id: 'veterinary', label: '動物病院', purpose: '病院・薬局' },
      { id: 'welfare', label: '福祉施設', purpose: '病院・薬局' },
      { id: 'funeral', label: '葬儀', purpose: '買う' }
    ]
    for (const e of expected) {
      const cat = getCategoryById(e.id)
      expect(cat).toBeTruthy()
      expect(cat.label).toBe(e.label)
      expect(getPurposeOfCategory(e.id)).toBe(e.purpose)
    }
  })

  it('bank は「銀行・金融」に所属し、質屋・金貸し・郵便局・金融タグを持つ', () => {
    const cat = getCategoryById('bank')
    expect(cat.label).toBe('銀行・金融')
    expect(getPurposeOfCategory('bank')).toBe('銀行・金融')
    const f = categoryToQueryFilter(cat)
    expect(f.unionFilters).toEqual([
      'amenity~"^(bank|atm|money_lending|post_office)$"',
      'shop=pawnbroker',
      'office=financial'
    ])
  })

  it('public_facility は「公共施設」に所属し、community_centre を持たず courthouse・public_building を持つ', () => {
    const cat = getCategoryById('public_facility')
    expect(getPurposeOfCategory('public_facility')).toBe('公共施設')
    const f = categoryToQueryFilter(cat)
    expect(f.unionFilters).toContain('amenity~"^(townhall|post_office|police|fire_station|recycling|shelter|courthouse|public_building)$"')
    // community_centre は独立カテゴリへ移転（public_facility に残さない）
    expect(f.unionFilters[0]).not.toContain('community_centre')
  })

  it('kindergarten は「幼稚園・保育園」に改名し、childcare タグを持つ', () => {
    const cat = getCategoryById('kindergarten')
    expect(cat.label).toBe('幼稚園・保育園')
    const f = categoryToQueryFilter(cat)
    expect(f.unionFilters).toContain('amenity~"^(kindergarten|childcare)$"')
  })

  it('「役所・手続き」「公共設備」「遊ぶ・公園」「学ぶ」は廃止され、新名称・独立種別へ', () => {
    expect(CATEGORY_GROUPS.find((g) => g.name === '役所・手続き')).toBeUndefined()
    expect(getCategoriesForPurpose('役所・手続き')).toBeNull()
    expect(CATEGORY_GROUPS.find((g) => g.name === '銀行・金融')).toBeTruthy()
    expect(CATEGORY_GROUPS.find((g) => g.name === '公共施設')).toBeTruthy()
    expect(CATEGORY_GROUPS.find((g) => g.name === '公共設備')).toBeUndefined()
    expect(CATEGORY_GROUPS.find((g) => g.name === '遊ぶ・公園')).toBeUndefined()
    expect(CATEGORY_GROUPS.find((g) => g.name === '学ぶ')).toBeUndefined()
  })
})
