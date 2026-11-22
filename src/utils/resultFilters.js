/**
 * (#44 生活者目線UI) 検索結果の表示フィルタ共通ユーティリティ
 *
 * PCの一覧とモバイルの一覧タブ（ともに MobileListTab）が同じ
 * フィルタ定義・同じロジックを共有する。ヘッダーのハンバーガーメニュー
 * （HeaderMenu）はこの関数で「表示中」の結果集合を求め、エクスポート対象
 * （表示中 N / 全部 M）を明示する（「検索と出力の一致」要件 #44）。
 *
 * フィルタ状態は App.jsx の reducer state.resultFilters に置き、
 * { nameFilter, typeFilter, catFilter, sortDir } を持つ。
 *   - nameFilter:   キーワード（name / name:ja / メモ本文の部分一致、大文字小文字無視）。
 *     一覧・まちメモ帳で共用（matchesKeyword）。メモ帳はメモ本文（memo）にも効く
 *   - typeFilter:   OSM要素種別（all | node | way | relation）
 *   - catFilter:    施設カテゴリID（categoryMatchesElement で判定）
 *   - purposeFilter: 目的名（その目的に属するカテゴリのいずれかに一致するものだけ）
 *   - cuisine:      料理ジャンル（tags.cuisine の '; ' 区切り値の一部一致・大小文字無視）。
 *     選択肢は cuisineFacetValues（フィルタ適用前の結果から集計）が提供する。
 *   - wifi:         WiFi有無（all | yes | no）。wifiStatus（3状態）と一致するものだけ。
 *     未登録（unknown）は「あり」にも「なし」にも含めない。
 *   - power:        電源有無（all | yes）。powerStatus（3状態）で 'yes' のものだけ。
 *   - wheelchair:   車椅子対応（しきい値型の単一選択）。'all' | 'gte_partial' | 'gte_yes'。
 *     'gte_partial' = 一部対応以上（yes/designated + limited）、'gte_yes' = 対応可のみ
 *     （yes/designated）。未登録（tags.wheelchair が無い）は絞り込み指定時は該当しない。
 *   - rating:       ★評価（all | gte1〜gte4 | eq5）。rating は整数 0-5（0 = 未評価）。
 *     未評価は「すべて」にのみ該当する。まちメモ帳専用の絞り込み。
 *   - kerbHeight:   縁石の高さ（any | flat | low | high | unknown）。
 *     bf を持つ結果のみ kerbHeightClass（barrierFreeResults.js）で分類し、
 *     一致するものだけ残す。bf を持たない結果は除外される。
 *     バリアフリー一覧専用の絞り込み（施設一覧にはUIを出さない）。
 *   - sortDir:      施設名で並び替え（none | asc | desc）
 *
 * (#44) catFilter / purposeFilter は検索フォームのカテゴリ・目的選択のミラー
 * として reducer（appReducer.js）が同期する。カテゴリが設定されている間は
 * purposeFilter は空になる（カテゴリ > 目的 の優先度）。
 */
import { categoryMatchesElement } from './categoryMatch'
import { facilityName } from './facilityLabels'
import { getCategoriesForPurpose } from '../data/categories'
import { kerbHeightClass } from './barrierFreeResults'
import { powerStatus, wifiStatus } from './powerWifi'


// ===== 料理ジャンルファセット（cuisine） =====

/**
 * cuisine タグ値 → 日本語表示ラベル の辞書（一般的な値のみ）。
 * 載っていない値はそのまま表示する（cuisineFacetValues がフォールバック）。
 */
const CUISINE_LABELS = {
  ramen: 'ラーメン',
  udon: 'うどん',
  soba: 'そば',
  sushi: '寿司',
  japanese: '和食',
  tempura: '天ぷら',
  ramen_bar: 'ラーメン',
  italian: 'イタリアン',
  chinese: '中華',
  french: 'フレンチ',
  indian: 'インド料理',
  nepalese: 'ネパール料理',
  thai: 'タイ料理',
  vietnamese: 'ベトナム料理',
  korean: '韓国料理',
  malay: 'マレー料理',
  burger: 'ハンバーガー',
  pizza: 'ピザ',
  steak: 'ステーキ',
  barbecue: 'バーベキュー',
  yakiniku: '焼肉',
  izakaya: '居酒屋',
  curry: 'カレー',
  noodle: '麺',
  pasta: 'パスタ',
  bakery: 'パン',
  bread: 'パン',
  sweets: 'スイーツ',
  dessert: 'スイーツ',
  ice_cream: 'アイスクリーム',
  cafe: 'カフェ',
  coffee_shop: 'カフェ',
  tea: 'お茶',
  beer: 'ビール',
  wine: 'ワイン',
  bar: 'バー',
  pub: 'パブ',
  fast_food: 'ファストフード',
  mexican: 'メキシカン',
  spanish: 'スペイン料理',
  greek: 'ギリシャ料理',
  turkish: 'トルコ料理',
  persian: 'ペルシア料理',
  moroccan: 'モロッコ料理',
  russian: 'ロシア料理',
  american: 'アメリカ料理',
  australian: 'オーストラリア料理',
  brazilian: 'ブラジル料理',
  swiss: 'スイス料理',
  dutch: 'オランダ料理',
  scandinavian: '北欧料理',
  mediterranean: '地中海料理',
  seafood: '海鮮',
  vegetarian: 'ベジタリアン',
  vegan: 'ヴィーガン',
  halal: 'ハラル',
  kosher: 'コーシャ',
  buffet: 'ビュッフェ',
  beef_bowl: '牛丼',
  steak_house: 'ステーキ',
  okonomiyaki: 'お好み焼き',
  takoyaki: 'たこ焼き',
  yakitori: '焼き鳥',
  tonkatsu: 'とんかつ',
  kushiyaki: '串焼き',
  teppanyaki: '鉄板焼き',
  monjayaki: 'もんじゃ焼き',
  shabu_shabu: 'しゃぶしゃぶ',
  sukiyaki: 'すき焼き',
  jingisukan: 'ジンギスカン',
  champon: 'ちゃんぽん',
  sara_udon: '皿うどん',
  donburi: '丼',
  bento: '弁当',
  onigiri: 'おにぎり',
  unagi: 'うなぎ',
  fugu: 'ふぐ',
  horumon: 'ホルモン',
  taiyaki: 'たい焼き',
  wagashi: '和菓子',
  kakigori: 'かき氷',
  crepe: 'クレープ',
  donut: 'ドーナツ',
  donuts: 'ドーナツ',
  sandwich: 'サンドイッチ',
  hot_dog: 'ホットドッグ',
  fried_chicken: 'フライドチキン',
  chicken: 'チキン',
  kebab: 'ケバブ',
  tacos: 'タコス',
  burrito: 'ブリトー',
  fish_and_chips: 'フィッシュ＆チップス',
  german: 'ドイツ料理',
  british: 'イギリス料理',
  taiwanese: '台湾料理',
  cantonese: '広東料理',
  sichuan: '四川料理',
  dim_sum: '点心',
  hot_pot: '火鍋',
  pho: 'フォー',
  banh_mi: 'バインミー',
  pad_thai: 'パッタイ',
  indonesian: 'インドネシア料理',
  filipino: 'フィリピン料理',
  peruvian: 'ペルー料理',
  ethiopian: 'エチオピア料理',
  lebanese: 'レバノン料理',
  hawaiian: 'ハワイアン',
  bubble_tea: 'タピオカ',
  smoothie: 'スムージー',
  juice: 'ジュース',
  chocolate: 'チョコレート',
  salad: 'サラダ',
  soup: 'スープ',
  breakfast: '朝食',
  local: '郷土料理',
  regional: '郷土料理'
}

/**
 * 結果の tags.cuisine（';' 区切り）を集計したファセット値を返す。
 *
 * - 値は小文字に正規化して集計する（'Ramen' と 'ramen' は同一値）。
 *   フィルタ（applyResultFilters の cuisine）も大小文字無視で判定するため、
 *   チップの value とフィルタ値を同じ正規化で扱える。
 * - label は CUISINE_LABELS の日本語表記。載っていない値はそのまま。
 * - count の多い順に並び、同件数の場合は値の昇順で決める（安定した表示）。
 * - 最大 limit 件（既定10）まで返す。
 *
 * @param {Array} results - 料理ジャンル以外の条件を適用した結果
 * @param {number} limit - 返すファセット値の最大件数（既定10）
 * @param {string} selected - 選択中の値。0件や上位外でも解除できるように残す
 * @returns {Array<{value:string, label:string, count:number}>}
 */
/**
 * cuisine タグ値の日本語表示ラベルを返す（辞書に載っていない値はそのまま返す）。
 * チップ行（cuisineFacetValues）と折りたたみ見出し行（CuisineChips）でラベルを
 * 統一するために共用する。
 * @param {string} value - cuisine タグ値（小文字化された値）
 * @returns {string} 日本語ラベル、または生の値
 */
export function cuisineLabelOf(value) {
  return CUISINE_LABELS[value] || value
}

export function cuisineFacetValues(results, limit = 10, selected = '') {
  const counts = new Map()
  for (const r of Array.isArray(results) ? results : []) {
    const raw = r && r.tags ? r.tags.cuisine : null
    if (raw == null || raw === '') continue
    for (const part of String(raw).split(';')) {
      const value = part.trim().toLowerCase()
      if (!value) continue
      counts.set(value, (counts.get(value) || 0) + 1)
    }
  }
  const items = [...counts.entries()].map(([value, count]) => ({
    value,
    label: cuisineLabelOf(value),
    count
  }))
  items.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  const facets = items.slice(0, limit)
  if (selected && limit > 0 && !facets.some((item) => item.value === selected)) {
    return [...facets.slice(0, limit - 1), {
      value: selected,
      label: cuisineLabelOf(selected),
      count: counts.get(selected) ?? 0,
    }]
  }
  return facets
}

/**
 * アクティブなフィルタが1つでも存在するか
 */
// ===== キーワード・WiFi・電源・車椅子・評価の判定（一覧・まちメモ帳共通） =====

/**
 * キーワード絞り込み（一覧・メモ帳で統一）:
 * 名称（name / name:ja）とメモ本文（memo）のいずれかにキーワードが
 * 部分一致すれば該当する（大文字小文字無視）。
 * 一覧の結果には memo フィールドが無いので実質 name+name:ja となる。
 */
export function matchesKeyword(item, keyword) {
  const kw = (keyword || '').trim().toLowerCase()
  if (!kw) return true
  const tags = (item && item.tags) || {}
  const haystack = [item && item.name, tags['name:ja'], item && item.memo]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(kw)
}

/**
 * WiFi 有無で絞る（'all' | 'yes' | 'no'）。
 * wifiStatus（3状態）が mode と一致するものだけ残す。
 * 'yes' = 登録されて yes、'no' = 登録されて no。未登録（unknown）はどちらにも該当しない。
 */
export function matchesWifi(item, mode) {
  if (mode === 'all') return true
  return wifiStatus((item && item.tags) || {}) === mode
}

/**
 * 電源有無で絞る（'all' | 'yes'）。
 * 「あり」のみで絞り込む仕様: powerStatus（3状態）が 'yes' のものだけ残す。
 * 'no' / 未登録（unknown）は「あり」に含まない（未登録＝なしと混同しない）。
 */
export function matchesPower(item, mode) {
  if (mode === 'all') return true
  return powerStatus((item && item.tags) || {}) === 'yes'
}

/**
 * 車椅子対応で絞る（しきい値型の単一選択: 'all' | 'gte_partial' | 'gte_yes'）。
 * 'gte_partial' = 一部対応以上（yes / designated / limited）、'gte_yes' = 対応可のみ
 * （yes / designated）。
 * 未登録（tags.wheelchair が無い）は絞り込み指定時は該当しない。
 * 旧形式（単一値 'yes'/'partial'/'no'・複数選択配列）も normalizeWheelchair で
 * 新しいしきい値値に変換して受け付ける（後方互換）。
 */
export function matchesWheelchair(item, mode) {
  const v = ((item && item.tags) || {}).wheelchair
  const m = normalizeWheelchair(mode)
  if (m === 'all') return true
  if (m === 'gte_partial') return v === 'yes' || v === 'designated' || v === 'limited'
  if (m === 'gte_yes') return v === 'yes' || v === 'designated'
  return true
}

/**
 * 車椅子フィルタの値を新しい形式（しきい値型の単一文字列）に正規化する（後方互換）。
 * 旧形式（複数選択の配列・単一文字列）の値を読み込んでも壊れないようにする（移行）。
 *
 * - 新しい形式の文字列（'all' | 'gte_partial' | 'gte_yes'）: そのまま返す
 * - 旧形式の文字列:
 *   - 'yes' → 'gte_yes'（対応可のみ）
 *   - 'partial' → 'gte_partial'（一部対応以上）
 *   - 'all' / 'no' / 不明な値 → 'all'（絞り込みなし）
 * - 旧形式の配列（複数選択）:
 *   - 'partial' を含む → 'gte_partial'（最も広いしきい値）
 *   - 'partial' を含まず 'yes' を含む → 'gte_yes'
 *   - それ以外（'no' のみ・空配列など）→ 'all'
 * - undefined / null / その他 → 'all'
 *
 * @param {*} value - wheelchair フィルタ値（文字列または配列）
 * @returns {'all'|'gte_partial'|'gte_yes'} 新しい形式の単一文字列
 */
export function normalizeWheelchair(value) {
  const VALID = ['all', 'gte_partial', 'gte_yes']
  if (Array.isArray(value)) {
    if (value.includes('partial')) return 'gte_partial'
    if (value.includes('yes')) return 'gte_yes'
    return 'all'
  }
  if (typeof value === 'string') {
    if (VALID.includes(value)) return value
    if (value === 'yes') return 'gte_yes'
    if (value === 'partial') return 'gte_partial'
    return 'all'
  }
  return 'all'
}

/**
 * 車椅子フィルタが有効か（絞り込みが掛かっているか）。
 * 単一値なら 'all' 以外、旧形式の配列なら1つ以上選択済み を判定する。
 */
function wheelchairActive(f) {
  const wc = f && f.wheelchair
  if (Array.isArray(wc)) return wc.length > 0
  return !!wc && wc !== 'all'
}

/**
 * ★評価で絞る（'all' | 'gte1'〜'gte4' | 'eq5'）。
 * rating は整数 0-5（0 = 未評価）。未評価（0）は「すべて」にのみ該当する。
 */
export function matchesRating(item, mode) {
  if (mode === 'all') return true
  const r = (item && Number.isInteger(item.rating)) ? item.rating : 0
  if (mode === 'eq5') return r === 5
  const m = /^gte(\d+)$/.exec(mode || '')
  if (m) return r >= Number(m[1])
  return false
}

export function hasActiveFilters(filters) {
  const f = filters || {}
  return !!(
    (f.nameFilter || '').trim() ||
    (f.typeFilter && f.typeFilter !== 'all') ||
    (f.catFilter || '') ||
    (f.purposeFilter || '') ||
    ((f.cuisine || '').trim() !== '') ||
    (f.wifi && f.wifi !== 'all') ||
    (f.power && f.power !== 'all') ||
    wheelchairActive(f) ||
    (f.rating && f.rating !== 'all') ||
    (f.kerbHeight && f.kerbHeight !== 'any') ||
    (f.sortDir && f.sortDir !== 'none')
  )
}

/**
 * 表示フィルタを適用した結果配列を返す（新しい配列を返す。元は変更しない）
 * @param {Array} results - Overpass result 配列
 * @param {object} filters - 上記のフィルタ状態
 * @returns {Array} フィルタ＆ソート後の配列
 */
export function applyResultFilters(results, filters) {
  const f = filters || {}
  let out = results || []

  if ((f.nameFilter || '').trim()) out = out.filter((r) => matchesKeyword(r, f.nameFilter))

  if (f.typeFilter && f.typeFilter !== 'all') {
    out = out.filter((r) => r.type === f.typeFilter)
  }

  if (f.catFilter) {
    out = out.filter((r) => categoryMatchesElement(f.catFilter, r))
  }

  if (f.purposeFilter) {
    // 目的スコープ: その目的グループのカテゴリのいずれかに一致すれば残す（OR union）
    const cats = getCategoriesForPurpose(f.purposeFilter) || []
    if (cats.length > 0) {
      out = out.filter((r) => cats.some((c) => categoryMatchesElement(c.id, r)))
    }
  }

  // 料理ジャンル: tags.cuisine（';' 区切り）に値を含む結果だけ残す（部分一致・大小文字無視）
  const cuisine = (f.cuisine || '').trim().toLowerCase()
  if (cuisine) {
    out = out.filter((r) => {
      const raw = r && r.tags ? r.tags.cuisine : null
      if (raw == null || raw === '') return false
      return String(raw).split(';').some((part) => part.trim().toLowerCase().includes(cuisine))
    })
  }

  // 一覧・まちメモ帳共通: WiFi / 電源 / 車椅子 / ★評価
  if (f.wifi && f.wifi !== 'all') out = out.filter((r) => matchesWifi(r, f.wifi))
  if (f.power && f.power !== 'all') out = out.filter((r) => matchesPower(r, f.power))
  if (wheelchairActive(f)) out = out.filter((r) => matchesWheelchair(r, f.wheelchair))
  if (f.rating && f.rating !== 'all') out = out.filter((r) => matchesRating(r, f.rating))

  // 縁石の高さ（バリアフリー一覧専用）: bf を持つ結果のうち kerbHeightClass が
  // 一致するものだけ残し、bf を持たない結果（および縁石でない要素）は除外する
  if (f.kerbHeight && f.kerbHeight !== 'any') {
    out = out.filter((r) => {
      if (!r || !r.bf || typeof r.bf !== 'object') return false
      return kerbHeightClass(r) === f.kerbHeight
    })
  }

  if (f.sortDir === 'asc' || f.sortDir === 'desc') {
    out = [...out].sort((a, b) => {
      const cmp = facilityName(a).localeCompare(facilityName(b), 'ja')
      return f.sortDir === 'asc' ? cmp : -cmp
    })
  }

  return out
}
