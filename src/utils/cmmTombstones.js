/**
 * CMM 同期: 完全削除された投稿の cmmId を記録する墓碑（tombstone）リスト。
 *
 * React 非依存の純粋な関数群（localStorage キー: 'machi-cmm-tombstones-v1'）。
 *
 * 目的:
 *   - メモアイテムが完全削除（ハード削除）されたとき、そのアイテムの cmmId を
 *     ここに記録しておく。後続の同期ピースで、サーバー側に「この投稿は削除された」
 *     を通知するための差分判定に使う
 *   - 論理削除（ごみ箱へ移動）では記録しない。復元可能だから
 *   - cmmId が無い（同期していない）アイテムは対象外
 *
 * 記録する操作（useMemocho 側が呼ぶ）:
 *   - remove(key)   : 1件を完全削除
 *   - wipeAll()     : 全件（アクティブ＋ごみ箱）を完全削除
 *   - emptyTrash()  : ごみ箱の全件を完全削除
 */

export const CMM_TOMBSTONE_KEY = 'machi-cmm-tombstones-v1'

/** cmmId として有効か（空でない文字列） */
export function isValidCmmId(value) {
  return typeof value === 'string' && value !== ''
}

/**
 * localStorage から墓碑リスト（cmmId の文字列配列）を読み、重複除去して返す。
 * 未保存・壊れたJSON・配列でない・不正な要素は []（または除外）。
 */
export function loadCmmTombstones() {
  let raw
  try {
    raw = localStorage.getItem(CMM_TOMBSTONE_KEY)
  } catch {
    return []
  }
  if (raw == null) return []
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out = []
  const seen = new Set()
  for (const id of data) {
    if (!isValidCmmId(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 墓碑リストを localStorage へ保存（配列以外なら空配列として保存） */
export function saveCmmTombstones(ids) {
  localStorage.setItem(CMM_TOMBSTONE_KEY, JSON.stringify(Array.isArray(ids) ? ids : []))
}

/**
 * cmmId を墓碑リストに加える。
 * 新規に追加された ID の配列を返す（すべて既存なら []）。
 * 不正な値（空でない文字列でない）は無視する。
 * @param {Array<string>} ids 追加したい cmmId の配列
 * @returns {Array<string>} 新規に追加された cmmId
 */
export function addCmmTombstones(ids) {
  const current = loadCmmTombstones()
  const seen = new Set(current)
  const added = []
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!isValidCmmId(id) || seen.has(id)) continue
    seen.add(id)
    current.push(id)
    added.push(id)
  }
  if (added.length > 0) saveCmmTombstones(current)
  return added
}

/** 墓碑リストをすべて消去する（同期の差分送信完了後に呼ぶ想定） */
export function clearCmmTombstones() {
  saveCmmTombstones([])
}

/**
 * アイテム群から cmmId（空でない文字列）を取り出して重複除去した配列を返す。
 * cmmId が無いアイテムは対象外。
 * @param {Array<object>} items
 * @returns {Array<string>}
 */
export function cmmIdsOf(items) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const id = item != null ? item.cmmId : null
    if (!isValidCmmId(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
