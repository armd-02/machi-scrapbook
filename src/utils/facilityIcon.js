/**
 * 施設アイコン判定。
 *
 * コミュニティマップメーカー（cmapmaker）の lib/poilib.js の
 * PoiCont.getIcon(tags) と #prioritizeTagKeys の挙動をコピーした実装。
 * 対応表・キー優先順は src/data/markerIcons.js（marker.jsonc / category-ja.jsonc 由来）。
 *
 * 判定の優先順:
 * 1. subtag（key=value の組み合わせ条件）を最優先で評価
 * 2. 通常タグをキー優先順（MARKER_KEY_ORDER）で見え、
 *    施設タグに存在し対応表にアイコンがある最初の key=value のアイコンを使う。
 *    `building` キーは最後に回す（建物の形状より施設の用途を優先するため）
 * 3. どれにも該当しなければ fallback の marker-stroked.png
 * 4. アイコン名が .svg で終わる場合は .png に置き換える
 */
import { MARKER_TAG, MARKER_SUBTAG, MARKER_KEY_ORDER, FALLBACK_ICON } from '../data/markerIcons'

// .svg → .png（コピー元 normalizeIcon と同じ）。テスト用にも export する。
export const normalizeIconName = (icon) => (icon ? icon.replace('.svg', '.png') : '')
const normalizeIcon = normalizeIconName

// 建物の形状より施設の用途を優先し、building は最後の候補にする（コピー元 #prioritizeTagKeys）
const prioritizeTagKeys = (keys) => [
  ...keys.filter((key) => key !== 'building'),
  ...keys.filter((key) => key === 'building')
]

/**
 * OSM タグからアイコンファイル名を解決する（コピー元 getIcon と同じ挙動）。
 *
 * @param {object} [tags] - 施設オブジェクトが保持する OSM タグ（result.tags）。
 *   { tags: {...} } 形状のオブジェクトが渡されても内側の tags を使う（コピー元と同じ許容）。
 * @returns {string} アイコンファイル名（例: 'cafe.png'）。該当なければ fallback。
 */
export function getFacilityIcon(tags) {
  const t = (tags && typeof tags === 'object' && tags.tags && typeof tags.tags === 'object')
    ? tags.tags
    : (tags ?? {})

  // 1. subtag を最優先
  for (const keyEqVal of Object.keys(MARKER_SUBTAG)) {
    const [key, val] = keyEqVal.split('=')
    if (t[key] !== val) continue
    const subKeyMap = MARKER_SUBTAG[keyEqVal]
    for (const subKey of Object.keys(subKeyMap)) {
      const subVal = t[subKey]
      if (subVal === undefined) continue
      const icon = subKeyMap[subKey]?.[subVal]
      if (icon) return normalizeIcon(icon)
    }
  }

  // 2. 通常タグ: キー優先順で見るが、その key=value にアイコンが無ければ次のキーへ進む
  const mainkeys = prioritizeTagKeys(MARKER_KEY_ORDER).filter(
    (key) => key !== '*' && t[key] !== undefined
  )
  for (const mainkey of mainkeys) {
    const icon = MARKER_TAG[mainkey]?.[t[mainkey]]
    if (icon) return normalizeIcon(icon)
  }

  // 3. 全部見つからなかった時だけ fallback
  return FALLBACK_ICON
}

/**
 * アイコンファイル名から表示用 URL を作る。
 * 本番は GitHub Pages の base（/machi-scrapbook/）を踏むため import.meta.env.BASE_URL を使う。
 */
export function facilityIconUrl(icon) {
  return `${import.meta.env.BASE_URL}icons/${icon}`
}
