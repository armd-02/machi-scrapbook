/**
 * (ピースG1) 公開マップページ（/map/）: CMM Activity → 表示アイテムの変換
 *
 * 公開マップページは URL の `userid` パラメータで指定されたユーザーの
 * Activity 一覧（CMM 後端・GET activities.php、認証不要・userid でサーバー
 * 側フィルタ）を取得し、各 Activity をまちメモ帳アイテムと同じ形の
 * 表示アイテムに変換してカード・地図ピンに表示する。
 *
 *   { type, id, name, lat, lon, tags, memo, rating, book }
 *
 * - type/id: osmid（= メモキー `${type}/${id}`）から取得。osmid が不正
 *   （欠落・未知のタイプ・ID が正の整数でない）だとアイテム全体を
 *   スキップする（null を返す）。
 * - name/memo/book: Activity フィールドから（book はブック名）。
 * - rating: parseCmmRating で正規化（範囲外・不正 → 0 = 未評価）。
 * - lat/lon: Activity の latitude/longitude。欠落・不正なら null
 *   （カードは表示されるが地図ピンは出ない）。
 * - tags: Activity の tags JSON 文字列を解析（ピースG0 の parseCmmTags
 *   を再利用）。無効・欠落なら null（アイコンはフォールバック、
 *   タイ普拉ベルは「施設」に落ちる）。
 */
import { parseCmmTags, parseCmmRating } from './cmmSync'

const OSM_TYPES = new Set(['node', 'way', 'relation'])

/**
 * osmid（'node/100'）を { type, id } に分割する。
 * 形式が不正（文字列でない・'/'が無い・タイプ未知・ID が正の整数でない）
 * なら null を返す。
 */
export function osmidToTypeAndId(osmid) {
  if (typeof osmid !== 'string') return null
  const slash = osmid.indexOf('/')
  if (slash <= 0 || slash === osmid.length - 1) return null
  const type = osmid.slice(0, slash)
  if (!OSM_TYPES.has(type)) return null
  const id = Number(osmid.slice(slash + 1))
  if (!Number.isInteger(id) || id <= 0) return null
  return { type, id }
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * CMM Activity を表示アイテムに変換する。
 * osmid が有効でない Activity は null を返す。
 */
export function activityToMapItem(activity) {
  const tid = osmidToTypeAndId(activity && activity.osmid)
  if (!tid) return null
  const a = activity || {}
  const tags = parseCmmTags(a.tags)
  return {
    type: tid.type,
    id: tid.id,
    name: typeof a.name === 'string' && a.name !== '' ? a.name : null,
    lat: finiteNumber(a.latitude),
    lon: finiteNumber(a.longitude),
    tags: tags && Object.keys(tags).length > 0 ? tags : null,
    memo: typeof a.memo === 'string' ? a.memo : '',
    rating: parseCmmRating(a.rating),
    book: typeof a.book === 'string' && a.book !== '' ? a.book : null,
  }
}
