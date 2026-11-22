import { captureMapImage } from './mapCapture'

const RESULT_THUMB_ZOOM = 17

/**
 * 検索結果カードの地図サムネイル（メモリキャッシュのみ・localStorage 保存しない）。
 *
 * まちメモ帳のサムネイルは localStorage に保存する（永続）が、検索結果は
 * 一時的なので、サムネイルはモジュール単位のメモリキャッシュに保持する。
 *
 * - 同一施設（type/id のキー）は再表示しても再生成しない
 * - 生成失敗（null）はセッション内でリトライしない
 * - 逐次キューにより、同時に走っているタイル合成（captureMapImage）は
 *   常に 1 件のみ。多数のカードが一気に画面に入っても、タイル要求を
 *   大量に同時送出しない
 */

// 施設キー（type/id）→ dataURL | null（null = 生成失敗・セッション内リトライしない）
const thumbCache = new Map()
// キュー中・生成中のキー（同一キーの重複キューイングを防ぐ）
const inFlight = new Map()
// 逐次キューの末尾（新しい生成は前回の完了を待って実行される）
let queueTail = Promise.resolve()

/**
 * サムネイル生成を逐次キューに追加し、Promise（dataURL | null）を返す。
 * - 既に生成済み（キャッシュ命中）→ 即 resolve
 * - キュー中・生成中 → 同じ Promise を共有（重複生成しない）
 * - さもなければ逐次キューの末尾に追加
 */
export function queueThumb(key, lat, lon) {
  if (thumbCache.has(key)) return Promise.resolve(thumbCache.get(key))
  const pending = inFlight.get(key)
  if (pending) return pending
  const p = queueTail.then(async () => {
    const url = await captureMapImage(lat, lon, RESULT_THUMB_ZOOM)
    thumbCache.set(key, url)
    return url
  })
  inFlight.set(key, p)
  p.then(() => inFlight.delete(key), () => inFlight.delete(key))
  queueTail = p.then(() => {}, () => {})
  return p
}

/**
 * 指定キーの生成済みサムネイル（dataURL | null）を返す。
 * 未生成の場合は undefined を返す（null = 生成失敗 と区別する）。
 */
export function getCachedThumb(key) {
  return thumbCache.has(key) ? thumbCache.get(key) : undefined
}

/**
 * テスト用: メモリキャッシュとキュー状態を初期化する。
 */
export function resetThumbState() {
  thumbCache.clear()
  inFlight.clear()
  queueTail = Promise.resolve()
}
