/**
 * 日本語カテゴリ → OSMタグマッピング
 * 
 * 構造:
 * - id: 一意なID
 * - label: 日本語表示名
 * - tags: タグ条件の配列
 *   - 各タグは { key, values } 
 *   - values が配列の場合 → 同一キーの複数値を OR
 * - logic: 複数tags間をどう組み合わせるか
 *   - 'or'  : いずれかのtagsが一致すればOK（デフォルト）
 *   - 'and' : 全てのtagsが一致する場合のみ
 * - description: 対象の説明（任意）
 * 
 * 新規カテゴリを追加する場合:
 * (1) CATEGORIES 配列に新しいエントリを追加
 * (2) CATEGORY_GROUPS の適切なグループの ids にIDを追加（セレクト表示用）
 */

export const CATEGORIES = [
  {
    id: 'cafe',
    label: 'カフェ',
    tags: [{ key: 'amenity', values: ['cafe'] }],
    logic: 'or',
    description: 'コーヒーショップ・カフェ'
  },
  {
    id: 'restaurant',
    label: 'レストラン',
    tags: [{ key: 'amenity', values: ['restaurant'] }],
    logic: 'or',
    description: 'レストラン・食堂'
  },
  {
    id: 'food_drink',
    label: '飲食店（すべて）',
    tags: [{ key: 'amenity', values: ['cafe', 'restaurant', 'fast_food', 'bar', 'pub', 'izakaya', 'sushi', 'food_court'] }],
    logic: 'or',
    description: 'カフェ・レストラン・ファストフード・バー・居酒屋など（以下4種の合集合）'
  },
  {
    id: 'fast_food',
    label: 'ファストフード',
    tags: [{ key: 'amenity', values: ['fast_food'] }],
    logic: 'or',
    description: 'ファストフード・バーガーショップ等'
  },
  {
    id: 'bar_izakaya',
    label: 'バー・居酒屋',
    tags: [{ key: 'amenity', values: ['bar', 'pub', 'izakaya'] }],
    logic: 'or',
    description: 'バー・パブ・居酒屋'
  },
  {
    id: 'convenience',
    label: 'コンビニ・スーパー',
    tags: [
      { key: 'shop', values: ['convenience', 'supermarket'] },
      { key: 'amenity', values: ['convenience'] }
    ],
    logic: 'or',
    description: 'コンビニエンスストア・スーパーマーケット'
  },
  {
    id: 'retail',
    label: '小売店',
    tags: [{ key: 'shop', values: ['clothes', 'shoes', 'department_store', 'gift', 'stationery', 'convenience', 'supermarket', 'bakery', 'confectionery', 'butcher', 'greengrocer', 'florist', 'jewelry', 'hairdresser', 'beauty', 'car', 'motorcycle', 'bicycle', 'sports', 'toys', 'books', 'music', 'newsagent', 'alcohol', 'tobacco', 'variety_store', 'hardware', 'furniture', 'carpet', 'diary', 'leather', 'optician', 'tattoo', 'car_repair', 'pet', 'office_supplies', 'outdoor', 'computer', 'hifi', 'charity', 'composite', 'covered_market'] }],
    logic: 'or',
    description: '各種小売店舗'
  },
  {
    id: 'pharmacy',
    label: '薬局・ドラッグストア',
    tags: [
      { key: 'amenity', values: ['pharmacy'] },
      { key: 'shop', values: ['drugstore'] }
    ],
    logic: 'or',
    description: '薬局・ドラッグストア'
  },
  {
    id: 'hospital',
    label: '病院・クリニック',
    tags: [{ key: 'amenity', values: ['hospital', 'clinic', 'doctors', 'dentist'] }],
    logic: 'or',
    description: '病院・クリニック・歯科'
  },
  {
    id: 'public_facility',
    label: '役所・公共機関',
    tags: [
      { key: 'amenity', values: ['townhall', 'post_office', 'police', 'fire_station', 'community_centre', 'recycling', 'shelter'] },
      { key: 'office', values: ['government', 'municipality'] }
    ],
    logic: 'or',
    description: '役所・郵便局・警察・消防など'
  },
  {
    // 会社・事務所: 民間の会社・専門事務所・団体のオフィス。
    // office のうち、既存カテゴリが扱う値（government/municipality → 公共施設、
    // educational_institution → 予備校・塾）を除く全般を扱う。Overpass QL に
    // 「値の除外」条件の機構がないため、office の共通値（taginfo）から
    // 民間・専門職系の値を列挙する方式（上記の除外値はリストに含まれない）。
    id: 'company_office',
    label: '会社・事務所',
    tags: [
      { key: 'office', values: [
        // 仕様が代表値として列挙する民間・専門職系の値
        'company', 'coworking', 'lawyer', 'financial', 'it', 'research',
        'accounting', 'marketing', 'telecommunication',
        // その他の共通値（taginfo の office 頻出値から民間系を選定）
        'accountant', 'advertising_agency', 'airline', 'architect', 'association',
        'broadcaster', 'charity', 'construction_company', 'consulting', 'courier',
        'employment_agency', 'energy_supplier', 'engineer', 'estate_agent',
        'event_management', 'financial_advisor', 'foundation', 'graphic_design',
        'insurance', 'logistics', 'moving_company', 'newspaper', 'ngo',
        'notary', 'publisher', 'property_management', 'security', 'surveyor',
        'tax_advisor', 'transport', 'travel_agent', 'union', 'visa',
        'water_utility', 'yes'
      ] }
    ],
    logic: 'or',
    description: '民間の会社・専門事務所・団体（役所系・教育系を除く）'
  },
  {
    id: 'park',
    label: '公園・広場',
    tags: [
      { key: 'leisure', values: ['park', 'playground', 'garden', 'pitch'] },
      { key: 'amenity', values: ['plaza'] }
    ],
    logic: 'or',
    description: '公園・遊具・庭園・広場'
  },
  {
    // (#44) 教育施設カテゴリ: 幼稚園・小学校・大学/短大・予備校を個別カテゴリ化
    // 根拠: 日本OSMデータでは amenity=* と education=*（2025年に承認された推奨キー）が
    // 併記される。実データ（東京圏）では education=prep_school が365件存在するなど、
    // 両キーを併用して取得率を確保する。
    id: 'kindergarten',
    label: '幼稚園',
    tags: [
      { key: 'amenity', values: ['kindergarten'] },
      { key: 'education', values: ['kindergarten'] },
      { key: 'school', values: ['kindergarten'] }
    ],
    logic: 'or',
    description: '幼稚園（public・private）'
  },
  {
    id: 'primary_school',
    label: '小学校',
    tags: [
      { key: 'school', values: ['primary'] },
      { key: 'amenity', values: ['primary_school'] },
      { key: 'education', values: ['primary_school'] }
    ],
    logic: 'or',
    description: 'school=primary等でタグ付けされた小学校（※OSMでは多くの小学校がschool=primary未タグ付けのため、件数が実際の数より少なくなる場合があります）'
  },
  {
    id: 'university',
    label: '大学・短大',
    tags: [
      { key: 'amenity', values: ['university', 'college'] },
      { key: 'education', values: ['university', 'college'] },
      { key: 'university', values: ['yes', 'faculty'] }
    ],
    logic: 'or',
    description: '大学・短期大学・学部・学群'
  },
  {
    id: 'prep_school',
    label: '予備校・塾',
    tags: [
      { key: 'amenity', values: ['prep_school', 'language_school'] },
      { key: 'education', values: ['prep_school', 'language_school'] },
      { key: 'office', values: ['educational_institution'] }
    ],
    logic: 'or',
    description: '進学予備校・塾・語学学校'
  },
  {
    id: 'school',
    label: '学校・教育施設',
    tags: [
      { key: 'amenity', values: ['school'] },
      { key: 'education', values: ['school'] },
      { key: 'school', values: ['middle', 'high', 'yes'] },
      { key: 'leisure', values: ['common'] }
    ],
    logic: 'or',
    description: '中学校・高校・その他学校（幼稚園・大学等は個別カテゴリ参照）'
  },
  {
    // 図書館は運営主体（公立・民間）を問わず「学ぶ」に分類する
    // （ユーザー決定 2026-11-26、以前は役所・公共機関に含まれていた）
    id: 'library',
    label: '図書館',
    tags: [{ key: 'amenity', values: ['library'] }],
    logic: 'or',
    description: '図書館'
  },
  {
    id: 'transport',
    label: '交通・駅',
    tags: [
      { key: 'railway', values: ['station', 'subway_entry', 'tram_stop'] },
      { key: 'highway', values: ['bus_stop', 'platform'] },
      { key: 'amenity', values: ['fuel', 'parking', 'bicycle_rental', 'bicycle_parking'] }
    ],
    logic: 'or',
    description: '駅・バス停・ガソリンスタンド・駐車場・レンタサイクル・駐輪場'
  },
  {
    id: 'accommodation',
    label: '宿泊施設',
    tags: [
      { key: 'tourism', values: ['hotel', 'hostel', 'motel', 'guest_house', 'apartment'] },
      { key: 'building', values: ['hotel'] }
    ],
    logic: 'or',
    description: 'ホテル・ゲストハウス・旅館'
  },
  {
    id: 'bank',
    label: '銀行・ATM',
    tags: [
      { key: 'amenity', values: ['bank', 'atm'] }
    ],
    logic: 'or',
    description: '銀行・現金自動預払機'
  },
  {
    id: 'toilets',
    label: 'トイレ',
    tags: [{ key: 'amenity', values: ['toilets'] }],
    logic: 'or',
    description: '公共トイレ・トイレ'
  },
  {
    id: 'telephone',
    label: '公衆電話',
    tags: [{ key: 'amenity', values: ['telephone'] }],
    logic: 'or',
    description: '公衆電話'
  },
  {
    id: 'drinking_water',
    label: '水飲み場',
    tags: [{ key: 'amenity', values: ['drinking_water'] }],
    logic: 'or',
    description: '水飲み場'
  },
  {
    id: 'aed',
    label: 'AED',
    tags: [{ key: 'emergency', values: ['defibrillator'] }],
    logic: 'or',
    description: 'AED（自動体外式除細動器）'
  },
  {
    id: 'post_box',
    label: '郵便ポスト',
    tags: [{ key: 'amenity', values: ['post_box'] }],
    logic: 'or',
    description: '郵便ポスト'
  },
  {
    id: 'worship',
    label: '寺院・神社',
    tags: [
      { key: 'amenity', values: ['place_of_worship'] },
      { key: 'building', values: ['temple', 'shrine', 'church'] }
    ],
    logic: 'or',
    description: '寺・神社・教会'
  },
  {
    id: 'sports',
    label: 'スポーツ施設',
    tags: [
      { key: 'leisure', values: ['sports_centre', 'stadium', 'swimming_pool', 'pitch', 'golf_course', 'tennis_court', 'basketball_court', 'volleyball_court', 'dance'] }
    ],
    logic: 'or',
    description: 'スポーツセンター・プール・球場・コート・ダンススタジオ'
  },
  {
    id: 'barrier_free',
    label: 'バリアフリー',
    tags: [],
    logic: 'or',
    description: 'バリアフリー関連のインフラ（歩道・縁石・音声案内信号）'
  },
  {
    id: 'museum',
    label: '美術館・博物館',
    tags: [{ key: 'tourism', values: ['museum', 'art_gallery', 'viewpoint'] }],
    logic: 'or',
    description: '博物館・美術館・展望台'
  },
]
// 注1: 旧スーパーマーケット(shop=supermarket)・ガソリンスタンド(amenity=fuel)エントリは、
// それぞれコンビニ・スーパー・交通・駅に完全に包含される重複だったため削除。
// 注2 (#54): 旧ラーメン店(cuisine=ramen AND amenity)エントリは削除。「カテゴリ＝施設の種類」に
// 統一し、料理（cuisine）は独立フィルタ（CUISINES）として扱う。旧共有URL c=ramen は
// urlState.js が「レストラン + cuisine=ramen」として復元する。

/**
 * カテゴリIDからカテゴリオブジェクトを取得
 */
const CATEGORY_ID_INDEX = new Map()
function ensureIndex() {
  if (CATEGORY_ID_INDEX.size === 0) {
    for (const c of CATEGORIES) CATEGORY_ID_INDEX.set(c.id, c)
  }
}
export function getCategoryById(id) {
  ensureIndex()
  return CATEGORY_ID_INDEX.get(id) || null
}

/**
 * (#44 改訂 2026-10-28、再編) 目的ベースの施設グループ — 「生活者目線UI」
 *
 * OSMタグキー（amenity=…など）を上位カテゴリにしない代わりに、利用目的で
 * グループ化する: 食べる／買う／遊ぶ・公園／学ぶ／病院・薬局／役所・手続き／
 * 公共設備／会社・事務所／移動・交通／バリアフリー。
 * PCのカテゴリselectの <optgroup> ラベル、モバイルの目的チップ、トップ画面の
 * タイルで同じ定義を共有する（単一データソース）。
 * 各カテゴリはちょうど1つのグループにだけ所属する（重複所属はない）。
 * icon は目的チップ・タイル表示用（emoji）。
 * グループ内の順序はここで制御する（CATEGORIES 配列の順序に依存しない）。
 * 表示順は「すること」系（食べる・買う・遊ぶ・公園・学ぶ）→「生活の施設」系
 * （病院・薬局・役所・手続き・公共設備・会社・事務所・移動・交通）で、
 * チップ・セレクト・タイルすべてでこの定義順をそのまま使う。
 */
export const CATEGORY_GROUPS = [
  { name: '食べる', icon: '🍜', ids: ['food_drink', 'cafe', 'restaurant', 'fast_food', 'bar_izakaya'] },
  { name: '買う', icon: '🛍️', ids: ['retail', 'convenience'] },
  { name: '遊ぶ・公園', icon: '🎠', ids: ['park', 'sports', 'museum', 'worship', 'accommodation'] },
  { name: '学ぶ', icon: '📚', ids: ['kindergarten', 'primary_school', 'university', 'prep_school', 'school', 'library'] },
  { name: '病院・薬局', icon: '🏥', ids: ['hospital', 'pharmacy'] },
  { name: '役所・手続き', icon: '🏛️', ids: ['public_facility', 'bank'] },
  { name: '公共設備', icon: '🚻', ids: ['toilets', 'telephone', 'drinking_water', 'aed', 'post_box'] },
  { name: '会社・事務所', icon: '🏢', ids: ['company_office'] },
  { name: '移動・交通', icon: '🚉', ids: ['transport'] },
  { name: 'バリアフリー', icon: '♿', ids: ['barrier_free'] }
]

/**
 * (#54) 料理（cuisine）フィルタの選択肢。
 * カテゴリ（施設の種類）とは直交する独立次元で、飲食カテゴリ選択時に
 * セレクトで絞り込める。拡張が必要な場合はここに追加する。
 */
export const CUISINES = [
  { value: 'ramen', label: 'ラーメン' },
  { value: 'udon', label: 'うどん' },
  { value: 'soba', label: 'そば' },
  { value: 'sushi', label: '寿司' },
  { value: 'japanese', label: '和食' },
  { value: 'pizza', label: 'ピザ' },
  { value: 'italian', label: 'イタリアン' },
  { value: 'chinese', label: '中華' },
  { value: 'korean', label: '韓国' },
  { value: 'thai', label: 'タイ' },
  { value: 'indian', label: 'インド' },
  { value: 'french', label: 'フレンチ' },
  { value: 'american', label: 'アメリカン' },
  { value: 'burger', label: 'バーガー' },
  { value: 'curry', label: 'カレー' },
  { value: 'teppanyaki', label: '鉄板焼き' },
  { value: 'okinawan', label: '沖縄' },
  { value: 'vietnamese', label: 'ベトナム' }
]

/**
 * (#54) カテゴリが飲食グループに属するか判定（cuisineフィルタの表示条件）
 */
export function isFoodCategory(id) {
  if (!id) return false
  const foodGroup = CATEGORY_GROUPS.find((g) => g.name === '食べる')
  return !!foodGroup && foodGroup.ids.includes(id)
}

/**
 * (#44) 目的グループ名（'食べる'など）からカテゴリ一覧を取得
 * @param {string} purposeName - '食べる' | '買う' | '遊ぶ・公園' | '学ぶ' | '病院・薬局' | '役所・手続き' | '公共設備' | '会社・事務所' | '移動・交通' | 'バリアフリー'
 * @returns {Array<object>|null} カテゴリ配列、未知の目的ならnull
 */
export function getCategoriesForPurpose(purposeName) {
  const group = CATEGORY_GROUPS.find((g) => g.name === purposeName)
  if (!group) return null
  return group.ids.map((id) => getCategoryById(id)).filter(Boolean)
}

/**
 * (#44) 指定カテゴリが属する目的グループ名を返す（'食べる'など）、属さない場合は null
 * 各カテゴリはちょうど1つのグループにだけ所属するため、ここが「唯一の所属グループ」を返す
 */
export function getPurposeOfCategory(categoryId) {
  const group = CATEGORY_GROUPS.find((g) => g.ids.includes(categoryId))
  return group ? group.name : null
}

/**
 * (#44) 目的グループ全体のunionフィルタ一覧を取得（目的スコープ検索用）
 *
 * 「遊ぶ」などを目的チップとして選択したとき、その目的に属する全カテゴリの
 * タグ条件を1つのOR unionにまとめる。カテゴリ未選択のまま検索すると、
 * 「その目的の施設種類」に絞ったOverpassクエリが生成される。
 *
 * @param {string} purposeName - CATEGORY_GROUPS のグループ名（'食べる'など）
 * @returns {Array<string>} Overpass QLフィルタ文字列の配列（角括弧なし）。
 *   未知の目的・カテゴリが空の場合は空配列。
 */
export function getPurposeUnionFilters(purposeName) {
  const cats = getCategoriesForPurpose(purposeName)
  if (!cats || cats.length === 0) return []
  const filters = []
  const seen = new Set()
  for (const cat of cats) {
    const f = categoryToQueryFilter(cat)
    for (const fl of f.unionFilters) {
      if (!seen.has(fl)) {
        seen.add(fl)
        filters.push(fl)
      }
    }
    // 注: 現行カテゴリはすべてlogic='or'のためandFiltersは空。
    // 将来AND条件カテゴリが目的グループに入ったら、ここでunionブランチ化を追加する。
  }
  return filters
}

/**
 * (#44) 目的グループの施設種類ラベルを「・」区切りで返す（UI案内文用）
 * 例: getPurposeLabelList('遊ぶ・公園') → '公園・広場・スポーツ施設・美術館・博物館・寺院・神社・宿泊施設'
 */
export function getPurposeLabelList(purposeName) {
  const cats = getCategoriesForPurpose(purposeName)
  if (!cats || cats.length === 0) return ''
  return cats.map((c) => c.label).join('・')
}

/**
 * ドメイン別にグループ化したカテゴリを返す（セレクトの <optgroup> 描画用）。
 * @returns {Array<{ group: string, categories: Array<object> }>}
 */
export function getGroupedCategories() {
  return CATEGORY_GROUPS
    .map((g) => ({
      group: g.name,
      categories: g.ids.map((id) => getCategoryById(id)).filter(Boolean)
    }))
    .filter((g) => g.categories.length > 0)
}

/**
 * カテゴリのタグ条件をOverpassクエリ用のフィルタ文字列に変換
 * 
 * logic='or': 各tag条件をunion（;区切り）で繋ぐ → いずれか一致
 * logic='and': 各tag条件を連結フィルタで繋ぐ → 全て一致
 *
 * 同一キーの複数値は正規表現 key~"^(v1|v2|...)$" で表現する
 *
 * @param {object} category - カテゴリオブジェクト
 * @returns {object} { unionFilters: string[], andFilter: string }
 *   - logic='or'  → unionFilters に各条件が入る（andFilterは空文字列）
 *   - logic='and' → andFilter に連結フィルタが入る（unionFiltersは空）
 */
export function categoryToQueryFilter(category) {
  if (!category || !category.tags || category.tags.length === 0) {
    return { unionFilters: [], andFilters: [] }
  }

  const logic = category.logic || 'or'

  // 各tag条件をOverpass QLフィルタに変換（角括弧なしのフィルタ内容）
  const filters = category.tags.map((tag) => {
    const safeKey = escapeStr(tag.key)
    if (tag.values && tag.values.length > 1) {
      // 複数値 → 正規表現でOR
      const escaped = tag.values.map((v) => escapeRegex(v))
      return `${safeKey}~"^(${escaped.join('|')})$"`
    } else if (tag.values && tag.values.length === 1) {
      return `${safeKey}=${quoteValue(tag.values[0])}`
    }
    return safeKey
  })

  if (logic === 'and') {
    // AND: フィルタ配列を返す（クエリ生成側が [f1][f2] に連結）
    return { unionFilters: [], andFilters: filters }
  }

  // OR: 各フィルタを個別に返す（クエリ生成側が [f] でunionブランチ化）
  return { unionFilters: filters, andFilters: [] }
}

/**
 * カテゴリのタグを人間可読な形式で表示
 */
export function categoryToReadableTags(category) {
  if (!category || !category.tags) return ''
  const joiner = (category.logic === 'and') ? ' AND ' : ' OR '
  return category.tags.map((tag) => {
    if (tag.values && tag.values.length > 1) {
      return `${tag.key} ∈ {${tag.values.join(', ')}}`
    } else if (tag.values && tag.values.length === 1) {
      return `${tag.key}=${tag.values[0]}`
    }
    return `${tag.key} (存在)`
  }).join(joiner)
}

// ---------- ヘルパー ----------

/**
 * Overpass QLのキーをエスケープ
 * キーは通常 alphanum + : + _ のみだが、安全のため特殊文字をエスケープ
 */
function escapeStr(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * 正規表現内で特殊な文字をエスケープ
 */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 値を適切に引用符で囲む（特殊文字を含む場合のみ）
 * (#54) cuisineフィルタ値のエスケープにも再利用されるためexport
 */
export function quoteValue(str) {
  const s = String(str)
  // 特殊文字を含む場合はダブルクォートで囲む
  if (/[",\\\s[\](){}]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}
