/**
 * (まちメモ帳絞り込み) メモ帳アイテムの絞り込み。
 *
 * 絞り込みロジックは検索一覧と完全に統一する（#共通フィルタバー）。
 * 共通の判定関数（matchesKeyword / matchesWifi / matchesWheelchair /
 * matchesRating）と適用処理（applyResultFilters / hasActiveFilters）は
 * utils/resultFilters.js に集約されており、このモジュールでは
 * 「メモ帳側のフィルタ状態の既定形状」とその利便ラッパーのみを持つ。
 *
 * 状態のキー名は検索一覧の resultFilters と同じ（形状統一）。
 * メモ帳のフィルタ状態は画面ローカル（useState）に置かれ、
 * アプリ全体の resultFilters（App reducer）とは混ぜない。
 *
 *   - nameFilter:    キーワード（name + name:ja + メモ本文の部分一致）
 *   - catFilter:     カテゴリ（categoryMatchesElement）
 *   - missingFilter: 属性欠落（none | any | phone | hours | website | address）
 *   - perspective:   視点（none | wheelchair | vision | child | elderly）
 *   - cuisine:       料理ジャンル
 *   - wifi:          WiFi（all | yes | no。未登録はどちらにも含めない）
 *   - power:         電源（all | yes。「あり」= 3状態判定の 'yes' のみ）
 *   - wheelchair:    車椅子（all | yes | partial | no）
 *   - rating:        ★評価（all | gte1〜gte4 | eq5。0 = 未評価）
 *
 * 各条件は AND 結合。
 */
import {
  applyResultFilters,
  hasActiveFilters,
  matchesKeyword,
  matchesWifi,
  matchesWheelchair,
  matchesRating
} from './resultFilters'

// 共通ロジックの再エクスポート（既存の import 先を維持するためのブリッジ）
export { matchesKeyword, matchesWifi, matchesWheelchair, matchesRating }

/** メモ帳フィルタの既定値（全キー明示。キー名は resultFilters と統一） */
export const DEFAULT_MEMO_FILTERS = {
  nameFilter: '',
  catFilter: '',
  missingFilter: 'none',
  perspective: 'none',
  cuisine: '',
  wifi: 'all',
  power: 'all',
  wheelchair: 'all',
  rating: 'all'
}

/**
 * メモ帳の絞り込みを適用した配列を返す（新しい配列を返す。元は変更しない）。
 * 共通の applyResultFilters に既定値をマージして委譲する（ロジックは重複しない）。
 * @param {Array} items - メモ帳アイテム配列
 * @param {object} filters - メモ帳フィルタ状態（部分指定可。欠落は既定値）
 * @returns {Array}
 */
export function applyMemochoFilters(items, filters) {
  const f = { ...DEFAULT_MEMO_FILTERS, ...(filters || {}) }
  return applyResultFilters(items || [], f)
}

/** いずれかの絞り込み条件が有効かどうか（共通の hasActiveFilters に委譲） */
export function isMemoFilterActive(filters) {
  return hasActiveFilters({ ...DEFAULT_MEMO_FILTERS, ...(filters || {}) })
}
