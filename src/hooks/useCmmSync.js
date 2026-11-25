import { useState } from 'react'
import { useMemocho } from './useMemocho'
import { useScrapbooks } from './useScrapbooks'
import { syncMemos, cmmToMs, cmmToRfc3339Z, toErrorObject } from '../utils/cmmSync'
import { loadCmmTombstones, saveCmmTombstones, isValidCmmId } from '../utils/cmmTombstones'
import { loadMemocho, memochoKeyOf } from '../utils/memocho'
import { DEFAULT_BOOK_ID, loadScrapbooks } from '../utils/scrapbooks'

/** 最終同期時刻（RFC3339 文字列）の保存キー */
export const CMM_LAST_SYNC_KEY = 'machi-cmm-last-sync-v1'

/** 同期で使ったユーザー名（username）の保存キー */
export const CMM_LAST_USERID_KEY = 'machi-cmm-last-userid-v1'

/** localStorage から最終同期時刻（RFC3339 文字列）を読み出す。未保存・不正なら null */
export function loadLastSyncAt() {
  try {
    const raw = localStorage.getItem(CMM_LAST_SYNC_KEY)
    if (raw == null) return null
    const value = JSON.parse(raw)
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/** 最終同期時刻（RFC3339 文字列）を localStorage に保存する。null は保存しない */
export function saveLastSyncAt(value) {
  if (typeof value !== 'string' || value === '') return
  localStorage.setItem(CMM_LAST_SYNC_KEY, JSON.stringify(value))
}

/** localStorage から同期で使ったユーザー名を読み出す。未保存・不正なら null */
export function loadLastUserId() {
  try {
    const raw = localStorage.getItem(CMM_LAST_USERID_KEY)
    if (raw == null) return null
    const value = JSON.parse(raw)
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/** 同期で使ったユーザー名を localStorage に保存する。空文字・非文字列は保存しない */
export function saveLastUserId(value) {
  if (typeof value !== 'string' || value === '') return
  localStorage.setItem(CMM_LAST_USERID_KEY, JSON.stringify(value))
}

/**
 * CMM（community map maker）同期フック（ピースC）
 *
 * 同期の実行（cmmSync.js の syncMemos）と、結果の反映（メモ・ブック・
 * 墓碑リスト・最終同期時刻への書き込み）をまとめる。
 *
 * 戻り値:
 *   status      'idle' | 'syncing' | 'done'
 *   syncing     status === 'syncing'（ボタンの無効化・ラベル切替に使う）
 *   result      直近の同期結果（syncMemos の戻り値に userId を追加したもの）。未同期なら null
 *   （ピースJ） result.userId はこの同期で使った username。メモリ上の state のみで
 *   localStorage には保存せず、パスワードは含めない（公開URL表示に使う）
 *   lastSyncAt  最終同期時刻（RFC3339 文字列、localStorage 保存）。未同期なら null
 *   lastUserId  同期で使ったユーザー名（username、localStorage 保存）。未実行なら null
 *   runSync(credentials)  同期を実行する。credentials = { username, password }。
 *                  認証情報は syncMemos の呼び出し引数として渡すだけ。ユーザー名は
 *                  公開マップのURLコピーに使い回すため localStorage に保存する（
 *                  パスワードは保存しない）。結果を返す（投げない）
 *   dismissResult()  結果表示を消す（status → 'idle'、result → null）
 *
 * 結果反映（applySyncResult）:
 *   ① created/updated の各 activity → 対応するメモ（osmid ＝ メモのキー）に
 *      cmmId（activity.id）と cmmUpdatedAt（updated_at を RFC3339 に換算）を保存
 *   ② deleted の各 cmmId → 墓碑リストから除去 ＋ その cmmId を持つメモ
 *      （非公開ブック・ごみ箱など）の cmmId/cmmUpdatedAt をクリア
 *      （投稿はサーバー側で消えたので、次回の同期で新規作成される）
 *   ③ imported → update-memo は既存メモにリモートの新しい内容を反映、
 *      new-memo は新しい共有メモとして追加。ブック名が存在しない場合は
 *      その名前のブックを新規作成して公開（public: true）にする
 *   ④ lastSyncAt → エンジンの戻り値に従って localStorage に保存
 */
export function useCmmSync() {
  const memocho = useMemocho()
  const scrapbooks = useScrapbooks()
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [lastSyncAt, setLastSyncAt] = useState(loadLastSyncAt)
  const [lastUserId, setLastUserId] = useState(loadLastUserId)

  /** 同期を実行し、結果をローカル状態へ反映する。エラーを投げずに result を返す */
  async function runSync(credentials) {
    setStatus('syncing')
    // (ピースJ) この同期で使った username を結果 state に userId として載せる。
    // メモリ上の state のみ（localStorage には書かない）。パスワードは含めない
    const userId =
      credentials != null && typeof credentials.username === 'string' && credentials.username !== ''
        ? credentials.username
        : null
    // (ピースL) 同期を実行したら使ったユーザー名を保存する（公開マップのURLコピーに
    // 使い回す）。パスワードは保存しない。空・無視の場合は保存しない
    if (userId != null) {
      saveLastUserId(userId)
      setLastUserId(userId)
    }
    let syncResult
    try {
      syncResult = await syncMemos({
        memos: memocho.items,
        books: scrapbooks.books,
        tombstones: loadCmmTombstones(),
        credentials,
        lastSyncAt,
      })
    } catch (error) {
      // 取得失敗・書き込み失敗などで syncMemos が CmmError を投げた場合:
      // 反映できる結果が無いので空結果＋エラーとして扱う（lastSyncAt は更新しない）
      syncResult = {
        created: [],
        updated: [],
        deleted: [],
        imported: [],
        errors: [toErrorObject(error)],
        lastSyncAt: null,
      }
    }
    applySyncResult(syncResult, { memocho, scrapbooks })
    if (syncResult.lastSyncAt != null) {
      saveLastSyncAt(syncResult.lastSyncAt)
      setLastSyncAt(syncResult.lastSyncAt)
    }
    setStatus('done')
    const displayResult = { ...syncResult, userId }
    setResult(displayResult)
    return displayResult
  }

  function dismissResult() {
    setStatus('idle')
    setResult(null)
  }

  return { status, syncing: status === 'syncing', result, lastSyncAt, lastUserId, runSync, dismissResult }
}

/**
 * 同期結果をローカル状態（メモ・ブック・墓碑リスト）へ反映する。
 * 純粋な syncMemos の戻り値と、ストア操作フックを引数に取る。
 */
function applySyncResult(result, { memocho, scrapbooks }) {
  // ① 作成・更新された投稿 → 対応メモに cmmId と cmmUpdatedAt を保存
  for (const activity of [...result.created, ...result.updated]) {
    if (activity == null || typeof activity.osmid !== 'string' || activity.osmid === '') continue
    if (typeof activity.id !== 'string' || activity.id === '') continue
    const ts = cmmToMs(activity.updated_at)
    memocho.updateItemFields(activity.osmid, {
      cmmId: activity.id,
      cmmUpdatedAt: cmmToRfc3339Z(ts != null ? ts : Date.now()),
    })
  }

  // ② 削除された投稿 → 墓碑リストから除去 ＋ その cmmId を持つメモの cmmId をクリア
  const deletedSet = new Set(result.deleted.filter((id) => isValidCmmId(id)))
  if (deletedSet.size > 0) {
    saveCmmTombstones(loadCmmTombstones().filter((id) => !deletedSet.has(id)))
    // ① で cmmId が書き換わったメモもあるため、ここで現在の状態を再読み込みする
    for (const item of loadMemocho()) {
      if (item != null && isValidCmmId(item.cmmId) && deletedSet.has(item.cmmId)) {
        memocho.updateItemFields(memochoKeyOf(item), { cmmId: '', cmmUpdatedAt: '' })
      }
    }
  }

  // ③ 取り込み → 既存メモの更新／新規メモの追加（ブックが無くれば作成して公開）
  for (const entry of result.imported) {
    if (entry == null || typeof entry.key !== 'string') continue
    const bookId = resolveImportedBook(entry, scrapbooks)
    if (bookId == null) continue

    if (entry.type === 'new-memo') {
      memocho.addImported({
        key: entry.key,
        name: entry.name,
        memo: entry.memo,
        rating: entry.rating,
        bookId,
        cmmId: entry.cmmId,
        cmmUpdatedAt: entry.cmmUpdatedAt,
        lat: entry.lat,
        lon: entry.lon,
        // (ピースG0) 取り込んだメモにも OSM タグを持たせる（undefined で tags: null）
        tags: entry.tags,
      })
    } else {
      // update-memo: リモートが新しい場合、既存メモの内容を上書きする。
      // undefined のフィールドは既存値を維持する（patch に含めない）
      const patch = { bookId }
      if (entry.name !== undefined) patch.name = entry.name === '' ? '名称なし' : String(entry.name)
      if (entry.memo !== undefined) patch.memo = String(entry.memo)
      if (entry.rating !== undefined) patch.rating = entry.rating
      // (ピースG0) tags 項目がある Activity だけ tags を上書きする。
      // 無い場合はローカル側の tags を維持する
      if (entry.tags !== undefined) patch.tags = entry.tags
      if (isValidCmmId(entry.cmmId)) patch.cmmId = entry.cmmId
      if (typeof entry.cmmUpdatedAt === 'string' && entry.cmmUpdatedAt !== '') {
        patch.cmmUpdatedAt = entry.cmmUpdatedAt
      }
      memocho.updateItemFields(entry.key, patch)
    }
  }
}

/**
 * 取り込みエントリが指すブックの ID を解決する。
 *
 * - createBook（リモートのブック名がローカルに無い）: 同名のブックがあれば
 *   それを再利用（今回の同期内で先に作成したものも含む）、無ければ
 *   その名前で新規作成して公開（public: true）にする。作成できない場合
 *   （ピースH: ブック数の上限 100 冊に達している）は「デフォルト」に
 *   フォールバックする（メモ自体は取り込む）
 * - 通常: entry.bookId。ブックが既に削除されている場合は 'default' にフォールバック
 */
function resolveImportedBook(entry, scrapbooks) {
  if (entry.createBook === true) {
    const existing = loadScrapbooks().find((b) => b.name === entry.bookName)
    if (existing) return existing.id
    const created = scrapbooks.create(entry.bookName)
    // (ピースH) 上限（100冊）で新規作成できない場合は「デフォルト」に入れる
    // （メモ自体は取り込む）
    if (!created) return DEFAULT_BOOK_ID
    scrapbooks.setPublic(created.id, true)
    return created.id
  }
  if (entry.bookId == null || entry.bookId === '') return DEFAULT_BOOK_ID
  if (!loadScrapbooks().some((b) => b.id === entry.bookId)) return DEFAULT_BOOK_ID
  return entry.bookId
}
