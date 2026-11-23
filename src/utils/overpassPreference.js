/**
 * ユーザーが選択した Overpass API 第一候補エンドポイント（ハンバーガーメニューの切替）。
 *
 * メニューの「Overpass API」グループで「標準」（custom = armd-01）/「海外」
 * （public = 公式 overpass-api.de）の2択を切り替えられる。選択は localStorage
 * に保存され、次回起動時も維持される（未保存・不正値のときは既定の「標準」）。
 *
 * 検索実行時（useSearch.search）に読み取って executeOverpassQuery の第一候補
 * エンドポイントとして渡す。失敗時は従来どおり FALLBACK_ENDPOINT_ORDER の
 * フォールバック機構が働く。
 *
 * 対象外:
 * - 地名検索の名前検索補完（geo.js の overpassNameSearch）は常に 'custom'
 *   （armd-01）に固定。全国規模の名前正規表現検索は公式サーバーに送りたくない
 *   ため、切替の影響を受けない。
 * - private_coffee は選択肢に含まれない（フォールバック候補のままである）。
 */
import { DEFAULT_ENDPOINT } from '../config'

/** localStorage のキー */
export const OVERPASS_PREFERENCE_KEY = 'machi-overpass-endpoint'

/** 選択可能なエンドポイントID（private_coffee は対象外） */
export const SELECTABLE_ENDPOINTS = ['custom', 'public']

/** メニュー表示用のラベル */
export const OVERPASS_PREFERENCE_OPTIONS = [
  { id: 'custom', label: '標準' },
  { id: 'public', label: '海外' }
]

/**
 * 選択されたエンドポイントID を返す。
 * 未保存・不正値・localStorage 不可（プライバシーモード等）の場合は
 * 既定（DEFAULT_ENDPOINT = 'custom'）を返す。
 */
export function getOverpassPreference() {
  try {
    const raw = localStorage.getItem(OVERPASS_PREFERENCE_KEY)
    if (raw && SELECTABLE_ENDPOINTS.includes(raw)) return raw
  } catch (e) {
    // localStorage にアクセスできない環境は既定値で返す
  }
  return DEFAULT_ENDPOINT
}

/**
 * 選択されたエンドポイントID を localStorage に保存する。
 * 選択可能でない値は保存せず false を返す。
 */
export function setOverpassPreference(id) {
  if (!SELECTABLE_ENDPOINTS.includes(id)) return false
  try {
    localStorage.setItem(OVERPASS_PREFERENCE_KEY, id)
    return true
  } catch (e) {
    return false
  }
}
