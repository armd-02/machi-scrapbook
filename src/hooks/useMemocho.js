import { useEffect, useState } from 'react'
import {
  addMemocho,
  hasMemocho,
  loadMemocho,
  memochoKeyOf,
  mergeMemocho,
  removeMemocho,
  saveMemocho,
  updateMemo
} from '../utils/memocho'

/**
 * まちメモ帳の状態管理フック（第2ピース）
 *
 * モジュールレベルのストア＋購読という単純な仕組みで、
 * 複数のコンポーネントが同時にフックを使っても状態が常に同期する。
 *
 *   - モジュール変数 storeItems が唯一の正（アイテム配列）
 *   - すべての変更は setStore() 経由で、localStorage へ保存しつつ
 *     購読者（各フックインスタンス）に通知する
 *   - 各フックインスタンスは useEffect で購読し、自分の state を更新する
 *
 * したがって、施設カードで追加した瞬間に、施設詳細シートや
 * その他タブのフックも即座に新しい items を持つようになる。
 */

// null は「まだ読み込みしていない」の意味。初回アクセスで localStorage から読む。
let storeItems = null
const listeners = new Set()

function getStore() {
  if (storeItems === null) storeItems = loadMemocho()
  return storeItems
}

function setStore(items) {
  storeItems = items
  saveMemocho(items)
  listeners.forEach((listener) => listener(items))
}

/**
 * テスト用のヘルパー。インメモリ状態を忘れ、
 * 次のアクセス時に localStorage から読み直させる。
 * テスト間で localStorage を clear した後に呼ぶこと。
 */
export function resetMemochoStore() {
  storeItems = null
}

/**
 * まちメモ帳の状態と変更操作を返す。
 *
 * 戻り値:
 *   items    現在のアイテム配列（React state。購読で自動更新される）
 *   has(key)        キー（'node/123' 形式）が登録済みかを返す
 *   add(result)     検索結果を追加。実際に追加したら true（重複なら false）
 *   remove(key)     キーのアイテムを削除。削除できたら true（存在しなければ false）
 *   toggle(result)  未登録なら追加（'added'）、登録済みなら削除（'removed'）
 *   setMemo(key, text)  そのキーのメモ文字列を差し替える
 *   importItems(items)  読み込み用アイテム配列を合流。{ added, skipped }（件数）を返す
 */
export function useMemocho() {
  const [items, setItems] = useState(getStore)

  useEffect(() => {
    const listener = (next) => setItems(next)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])

  return {
    items,

    has: (key) => hasMemocho(items, key),

    add: (result) => {
      const current = getStore()
      const next = addMemocho(current, result)
      const added = next !== current
      if (added) setStore(next)
      return added
    },

    remove: (key) => {
      const current = getStore()
      const next = removeMemocho(current, key)
      const removed = next.length < current.length
      if (removed) setStore(next)
      return removed
    },

    toggle: (result) => {
      const current = getStore()
      const key = memochoKeyOf(result)
      if (hasMemocho(current, key)) {
        setStore(removeMemocho(current, key))
        return 'removed'
      }
      const next = addMemocho(current, result)
      if (next === current) return null // 不正な source（type/id 不足）は何もしない
      setStore(next)
      return 'added'
    },

    setMemo: (key, text) => {
      const current = getStore()
      setStore(updateMemo(current, key, text))
    },

    /**
     * 読み込み用。parseMemochoJSON() 等で得たアイテム配列を合流する。
     * キー重複は既存を優先（mergeMemocho と同じ規則）。
     * 戻り値: { added, skipped }
     *   - added:   実際に追加された件数
     *   - skipped: キー重複で追加しなかった件数
     * 追加がある場合、状態（全フックインスタンス）と localStorage へ反映される。
     */
    importItems: (importedItems) => {
      const current = getStore()
      const { items: next, added, skipped } = mergeMemocho(current, importedItems)
      if (added.length > 0) setStore(next)
      return { added: added.length, skipped }
    }
  }
}
