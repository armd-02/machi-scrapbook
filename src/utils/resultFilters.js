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
 *   - missingFilter: 主要属性の欠落で絞り込み（none | any | phone | opening_hours | website | address）(B2)
 *   - perspective:  視点フィルタ（none | wheelchair | vision | child | elderly）
 *     利用者目線で「誰にとって使いやすいか」で絞る（matchesPerspective）。
 *     タグに基づく判定で「登録あり」が確認できるものだけを残し、未登録は含めない。
 *   - cuisine:      料理ジャンル（tags.cuisine の '; ' 区切り値の一部一致・大小文字無視）。
 *     選択肢は cuisineFacetValues（フィルタ適用前の結果から集計）が提供する。
 *   - wifi:         WiFi有無（all | yes | no）。wifiStatus（3状態）と一致するものだけ。
 *     未登録（unknown）は「あり」にも「なし」にも含めない。
 *   - power:        電源有無（all | yes）。powerStatus（3状態）で 'yes' のものだけ。
 *   - wheelchair:   車椅子対応（all | yes | partial | no）。tags.wheelchair の値で判定。
 *     未登録はどの絞り込みにも含めない。
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
import { missingAttributesOf } from './statistics'
import { kerbHeightClass } from './barrierFreeResults'
import { powerStatus, wifiStatus } from './powerWifi'

// ===== 視点フィルタ =====

/**
 * 視点フィルタ（matchesPerspective）
 *
 * データ項目ではなく「誰にとって使いやすいか」で結果を絞る。
 * タグ（tags）またはバリアフリー整形フィールド（bf）に基づく判定で、
 * 「登録あり」が確認できるものだけを残し、未登録は含めない。
 *
 * 視点:
 *   - wheelchair（車椅子）: tags.wheelchair が 'yes' / 'designated' ／
 *     bf.kerb が 'flush' / 'lowered' ／
 *     tags['kerb:height'] が数値として解釈できて 0.03（m）以下
 *   - vision（目の不自由な方）: tags.tactile_paving === 'yes' ／
 *     bf.tactile === 'yes' ／ bf.hasSound ／ bf.hasVibration
 *   - child（子ども連れ）: tags.diaper が存在し 'no' でない ／
 *     tags.changing_table === 'yes' ／ tags.kids_area === 'yes' ／ tags.highchair === 'yes'
 *   - elderly（お年寄り）: tags.wheelchair が 'yes' / 'designated' ／
 *     tags.ramp === 'yes' ／ tags['ramp:wheelchair'] === 'yes' ／ tags.elevator === 'yes'
 *
 * perspective が 'none'（または不明な値）なら全件が該当する（フィルタしない）。
 *
 * @param {object} result - 結果要素（tags を持ち、バリアフリー結果は bf も持つ）
 * @param {string} perspective - 視点ID（'none' | 'wheelchair' | 'vision' | 'child' | 'elderly'）
 * @returns {boolean}
 */
export function matchesPerspective(result, perspective) {
  if (!perspective || perspective === 'none') return true

  const r = result || {}
  const tags = r.tags || {}
  const bf = r.bf && typeof r.bf === 'object' ? r.bf : null

  switch (perspective) {
    case 'wheelchair':
      // 車椅子: 施設タグ / バリアフリーの縁石情報 のいずれかが登録済みで良好
      // !! で真偽値を正規化（bf 側の undefined が || 経由で外に漏れない）
      return !!(
        tags.wheelchair === 'yes' || tags.wheelchair === 'designated' ||
        (bf && (bf.kerb === 'flush' || bf.kerb === 'lowered')) ||
        kerbHeightLe(tags['kerb:height'], 0.03)
      )
    case 'vision':
      // 目の不自由な方: 点字ブロック / 音声・振動案内 のいずれかが登録済み
      // !! で真偽値を正規化（bf.hasSound 等の undefined が || 経由で外に漏れない）
      return !!(
        tags.tactile_paving === 'yes' ||
        (bf && (bf.tactile === 'yes' || bf.hasSound || bf.hasVibration))
      )
    case 'child':
      // 子ども連れ: おむつ台・授乳・キッズエリア・ハイチェア のいずれかが登録済み
      return (
        (tags.diaper && tags.diaper !== 'no') ||
        tags.changing_table === 'yes' ||
        tags.kids_area === 'yes' ||
        tags.highchair === 'yes'
      )
    case 'elderly':
      // お年寄り: 車椅子対応・スロープ・エレベーター のいずれかが登録済み
      return (
        tags.wheelchair === 'yes' || tags.wheelchair === 'designated' ||
        tags.ramp === 'yes' ||
        tags['ramp:wheelchair'] === 'yes' ||
        tags.elevator === 'yes'
      )
    default:
      // 不明な視点IDはフィルタしない（安全側の挙動）
      return true
  }
}

/**
 * kerb:height の値が数値として解釈できて maxM（m）以下か
 * （未登録・空文字・数値解釈不可は false）
 */
function kerbHeightLe(value, maxM) {
  if (value == null || value === '') return false
  const n = Number(value)
  return Number.isFinite(n) && n <= maxM
}

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
 * @param {Array} results - Overpass result 配列（フィルタ適用前の結果を渡す）
 * @param {number} limit - 返すファセット値の最大件数（既定10）
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

export function cuisineFacetValues(results, limit = 10) {
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
  return items.slice(0, limit)
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
 * 車椅子対応で絞る（'all' | 'yes' | 'partial' | 'no'）。
 * 'partial' = limited、'yes' = yes / designated。
 * 未登録（tags.wheelchair が無い）はどの絞り込みにも該当しない。
 */
export function matchesWheelchair(item, mode) {
  const v = ((item && item.tags) || {}).wheelchair
  if (mode === 'all') return true
  if (mode === 'yes') return v === 'yes' || v === 'designated'
  if (mode === 'partial') return v === 'limited'
  if (mode === 'no') return v === 'no'
  return true
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
    (f.missingFilter && f.missingFilter !== 'none') ||
    (f.perspective && f.perspective !== 'none') ||
    ((f.cuisine || '').trim() !== '') ||
    (f.wifi && f.wifi !== 'all') ||
    (f.power && f.power !== 'all') ||
    (f.wheelchair && f.wheelchair !== 'all') ||
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

  // (B2) 主要属性が欠落している施設だけを表示
  if (f.missingFilter && f.missingFilter !== 'none') {
    out = out.filter((r) => {
      const missing = missingAttributesOf(r)
      if (f.missingFilter === 'any') return missing.length > 0
      return missing.includes(f.missingFilter)
    })
  }

  // 視点フィルタ: 「誰にとって使いやすいか」で絞る（登録ありのものだけ残す）
  if (f.perspective && f.perspective !== 'none') {
    out = out.filter((r) => matchesPerspective(r, f.perspective))
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
  if (f.wheelchair && f.wheelchair !== 'all') out = out.filter((r) => matchesWheelchair(r, f.wheelchair))
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
