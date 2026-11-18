import { useEffect, useState } from 'react'
import {
  addMemocho,
  activeItems,
  hasMemocho,
  loadMemocho,
  memochoKeyOf,
  mergeMemocho,
  removeMemocho,
  restoreMemocho,
  saveMemocho,
  trashItems,
  trashMemocho,
  updateMapImage,
  updateRating,
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
  try {
    saveMemocho(items)
  } catch {
    // localStorage の容量超過など。メモリ上の状態は保ち、通知も続ける
    // （保存できなかった分は再読み込みで消えるが、操作で落とさない）
  }
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
 *   items          現在のアイテム配列（React state。アクティブ＋ごみ箱。購読で自動更新）
 *   active         アクティブ（deletedAt が無い）アイテムの配列（表示・絞り込み・CSV の対象）
 *   trashItems     ごみ箱（deletedAt 付き）アイテムの配列
 *   has(key)       キー（'node/123' 形式）がアクティブに登録済みかを返す（ごみ箱は未登録扱い）
 *   add(result)    検索結果を追加。追加・復元したら true（アクティブ重複なら false）
 *   remove(key)    キーのアイテムを完全に削除。削除できたら true（存在しなければ false）
 *   trash(key)     論理削除（deletedAt を付けてごみ箱へ）。できたら true
 *   restore(key)   ごみ箱から復元（deletedAt を除去）。できたら true
 *   toggle(result) 未登録なら追加（'added'）、登録済みならごみ箱へ（'removed'）、
 *                  ごみ箱なら復元（'added'）
 *   setMemo(key, text)  そのキーのメモ文字列を差し替える
 *   importItems(items)  読み込み用アイテム配列を合流。{ added, skipped }（件数）を返す
 *   wipeAll()      アクティブ＋ごみ箱の全件を完全に削除。消去した件数を返す
 *   emptyTrash()   ごみ箱の全件を完全に削除。削除した件数を返す
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

    // 通常の一覧表示・件数・絞り込み・CSV 書き出しの対象（アクティブのみ）
    active: activeItems(items),

    // ごみ箱ビューで使うアイテム
    trashItems: trashItems(items),

    has: (key) => hasMemocho(items, key),

    add: (result) => {
      const current = getStore()
      const next = addMemocho(current, result)
      const added = next !== current
      if (added) setStore(next)
      return added
    },

    // 完全削除（ハード削除）。ごみ箱の完全削除・全消去の内部で使う
    remove: (key) => {
      const current = getStore()
      const next = removeMemocho(current, key)
      const removed = next.length < current.length
      if (removed) setStore(next)
      return removed
    },

    // 論理削除: 該当キーのアクティブアイテムを deletedAt を付けてごみ箱へ
    trash: (key) => {
      const current = getStore()
      const next = trashMemocho(current, key)
      const trashed = next !== current
      if (trashed) setStore(next)
      return trashed
    },

    // ごみ箱から復元（deletedAt を除去）
    restore: (key) => {
      const current = getStore()
      const next = restoreMemocho(current, key)
      const restored = next !== current
      if (restored) setStore(next)
      return restored
    },

    // 「メモ帳に追加」トグル。登録済みならごみ箱へ（論理削除）、
    // ごみ箱にあるなら復元、無ければ追加。addMemocho はごみ箱の復元を内包している
    toggle: (result) => {
      const current = getStore()
      const key = memochoKeyOf(result)
      if (hasMemocho(current, key)) {
        setStore(trashMemocho(current, key))
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

    /** そのキーのアイテムに地図サムネイル（dataURL）を保存する */
    setMapImage: (key, dataUrl) => {
      const current = getStore()
      setStore(updateMapImage(current, key, dataUrl))
    },

    /** そのキーのアイテムの評価（0〜5 の整数、0 ＝ 未評価）を保存する。範囲外の値は無視される */
    setRating: (key, rating) => {
      const current = getStore()
      setStore(updateRating(current, key, rating))
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
    },

    /** 「まちメモ帳をすべて削除」。アクティブ＋ごみ箱の全件を完全に削除する。消去した件数を返す */
    wipeAll: () => {
      const count = getStore().length
      setStore([])
      return count
    },

    /** 「ごみ箱を空にする」。deletedAt 付き（ごみ箱）のみを完全に削除する。削除した件数を返す */
    emptyTrash: () => {
      const current = getStore()
      const kept = activeItems(current)
      const removed = current.length - kept.length
      if (removed > 0) setStore(kept)
      return removed
    }
  }
}
