import { useEffect, useState } from 'react'
import {
  createBook,
  deleteBook,
  loadScrapbooks,
  renameBook,
  saveScrapbooks,
  setBookPublic,
  DEFAULT_BOOK_ID
} from '../utils/scrapbooks'

/**
 * スクラップブック（メモのカテゴリ）の状態管理フック
 *
 * useMemocho と同じ構造: モジュールレベルのストア＋購読。
 *
 *   - モジュール変数 storeBooks が唯一の正（ブック配列。既定ブックは先頭）
 *   - すべての変更は setStore() 経由で localStorage へ保存しつつ
 *     購読者（各フックインスタンス）に通知する
 *
 * したがって、メモ帳のバーで作成したブックが、他のコンポーネントでも
 * 即座に反映される。
 */

// null は「まだ読み込みしていない」の意味。初回アクセスで localStorage から読む。
let storeBooks = null
const listeners = new Set()

function getStore() {
  if (storeBooks === null) storeBooks = loadScrapbooks()
  return storeBooks
}

function setStore(books) {
  storeBooks = books
  try {
    saveScrapbooks(books)
  } catch {
    // localStorage の容量超過など。メモリ上の状態は保ち、通知も続ける
  }
  listeners.forEach((listener) => listener(books))
}

/**
 * テスト用のヘルパー。インメモリ状態を忘れ、
 * 次のアクセス時に localStorage から読み直させる。
 * テスト間で localStorage を clear した後に呼ぶこと。
 */
export function resetScrapbooksStore() {
  storeBooks = null
}

/**
 * スクラップブックの状態と変更操作を返す。
 *
 * 戻り値:
 *   books    現在のブック配列（既定ブック「デフォルト」が常に先頭）
 *   create(name)   新規ブックを作成。作成できたブック（{ id, name, createdAt, public }）を返す。
 *                  名前が空の場合は何もしないで null を返す
 *   rename(id, name)  ブックの名前を変更。変更できたら true（空名前・ID不存在は false）
 *   remove(id)       ブックを削除。削除できたら true。「デフォルト」は削除不可（常に false）
 *   setPublic(id, isPublic)  ブックの公開設定（public）を切り替える。変更できたら true。
 *                  「デフォルト」ブックも含め全ブックが対象（削除不可の制限とは無関係）
 */
export function useScrapbooks() {
  const [books, setBooks] = useState(getStore)

  useEffect(() => {
    const listener = (next) => setBooks(next)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])

  return {
    books,

    /** 新規ブックを作成する。作成されたブックを返す（名前が空なら null） */
    create: (name) => {
      const current = getStore()
      const next = createBook(current, name)
      if (next === current) return null
      setStore(next)
      return next[next.length - 1]
    },

    /** 選択中のブックの名前を変更する。変更できたら true */
    rename: (id, name) => {
      const current = getStore()
      const next = renameBook(current, id, name)
      if (next === current) return false
      setStore(next)
      return true
    },

    /** ブックを削除する。「デフォルト」は削除できない（false を返す） */
    remove: (id) => {
      if (id === DEFAULT_BOOK_ID) return false
      const current = getStore()
      const next = deleteBook(current, id)
      if (next === current) return false
      setStore(next)
      return true
    },

    /**
     * ブックの公開設定（public）を切り替える。変更できたら true。
     * 「デフォルト」ブックも含め全ブックが対象（削除不可の制限とは無関係）。
     * 保存は即座に localStorage へ反映される。
     */
    setPublic: (id, isPublic) => {
      const current = getStore()
      const next = setBookPublic(current, id, isPublic)
      if (next === current) return false
      setStore(next)
      return true
    }
  }
}
