/**
 * スクラップブック（メモの分類）データ層（Piece 1: データ層）。
 *
 * まちメモ帳のアイテムは「ブック（分類）」に属する。ブックは
 * localStorage（SCRAPBOOKS_STORAGE_KEY）に ID・名前・作成日時で保存される。
 * デフォルトブック（ID 'default'）は常に存在し、削除できない。
 *
 * 仕様（machi-scrapbook-scrapbooks-data.md）:
 * - ブック: { id, name, createdAt, public }
 * - public: CMM への公開設定（boolean）。既定は false（非公開）。
 *   保存データに無いブックは読み込み時に false として正規化する（一括移行しない）
 * - 名前が同じブックを複数持つことを許可（ID で区別）
 * - デフォルトブック: { id: 'default', name: 'デフォルト' }、常に先頭
 * - メモアイテムの bookId が欠落・不正な場合は 'default' として扱う（読み取り時に正規化）
 * - UI（コンポーネント）の変更は別ピース
 */

export const SCRAPBOOKS_STORAGE_KEY = 'machi-scrapbooks-v1'
export const DEFAULT_BOOK_ID = 'default'
export const DEFAULT_BOOK_NAME = 'デフォルト'

/**
 * ブック（冊子）数の上限。「デフォルト」ブックを含めて 100 冊まで。
 * 上限に達した状態で新しいブックを作る試みは、どの経路（画面作成・
 * JSONインポート・CMM同期取り込み）でも黙って弾かれる。メモの件数に
 * 上限はない。
 */
export const MAX_BOOKS = 100

/**
 * デフォルトブックを新しいオブジェクトとして返す。
 * @returns {{ id: string, name: string, createdAt: null, public: boolean }}
 */
export function defaultBook() {
  return { id: DEFAULT_BOOK_ID, name: DEFAULT_BOOK_NAME, createdAt: null, public: false }
}

/**
 * bookId を正規化する。
 * 空でない文字列ならそのまま採用、それ以外（欠落・空文字・型違い）は 'default'。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBookId(value) {
  return typeof value === 'string' && value !== '' ? value : DEFAULT_BOOK_ID
}

/**
 * 新規ブック用の ID を生成する。
 * crypto.randomUUID が使える環境ではそれを、そうでなければ時間＋ランダムで代用する。
 * @returns {string}
 */
export function generateBookId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sb_${crypto.randomUUID()}`
  }
  return `sb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function isValidBookEntry(entry) {
  return (
    entry != null
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && typeof entry.id === 'string' && entry.id !== ''
    && typeof entry.name === 'string' && entry.name !== ''
  )
}

/**
 * ブックエントリを正規化した形（{ id, name, createdAt, public }）に変換する。
 * public が true なら true、それ以外（欠落・false・型違い）は false。
 * @param {object} entry
 * @returns {{ id: string, name: string, createdAt: string|null, public: boolean }}
 */
function canonicalBook(entry) {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
    public: entry.public === true,
  }
}

/**
 * localStorage からブックリストを読む。
 * - デフォルトブックは常に先頭にある（'default'）。
 *   保存データに 'default' エントリがあれば、その（改名された）名前を採用して先頭にする。
 * - 壊れた JSON・配列でないデータは空リストとして扱う。
 * - id/name が空でない文字列のエントリだけ採用し、id で重複除去する（先頭が優先）。
 * - public が無い（または true 以外）ブックは false として正規化する
 * @returns {Array<{ id: string, name: string, createdAt: string|null, public: boolean }>}
 */
export function loadScrapbooks() {
  let stored = []
  try {
    const raw = localStorage.getItem(SCRAPBOOKS_STORAGE_KEY)
    if (raw != null) {
      const data = JSON.parse(raw)
      if (Array.isArray(data)) stored = data
    }
  } catch {
    stored = []
  }

  const valid = stored.filter(isValidBookEntry)
  const seen = new Set()
  const rest = valid
    .filter((entry) => {
      if (entry.id === DEFAULT_BOOK_ID) return false
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
    .map(canonicalBook)

  const defaultEntry = valid.find((entry) => entry.id === DEFAULT_BOOK_ID)
  const head = defaultEntry ? canonicalBook(defaultEntry) : defaultBook()
  return [head, ...rest]
}

/**
 * ブックリストを localStorage に保存する。
 * @param {Array<{ id: string, name: string, createdAt?: string|null }>} books
 */
export function saveScrapbooks(books) {
  localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify(Array.isArray(books) ? books : []))
}

/**
 * 新規ブックを作成する。
 * 名前を前後空白トリムして採用する。トリム後が空（または文字列以外）なら、
 * リストをそのまま返す（空の名前での作成は拒否）。
 * @param {Array<object>} books
 * @param {string} name
 * @returns {Array<object>} 新ブックを末尾に追加した新しいリスト（作成しない場合は元の配列）
 */
export function createBook(books, name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return books
  // (ピースH) ブック数の上限（デフォルト含む 100 冊）に達していれば作成しない
  if ((Array.isArray(books) ? books : []).length >= MAX_BOOKS) return books
  const book = { id: generateBookId(), name: trimmed, createdAt: new Date().toISOString(), public: false }
  return [...(Array.isArray(books) ? books : []), book]
}

/**
 * ブックを改名する。名前を前後空白トリムして採用する。
 * トリム後が空（または文字列以外）、または id が該当ブックのない場合は、リストをそのまま返す。
 * @param {Array<object>} books
 * @param {string} id
 * @param {string} name
 * @returns {Array<object>}
 */
export function renameBook(books, id, name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return books
  if (typeof id !== 'string' || id === '') return books
  const list = Array.isArray(books) ? books : []
  // 該当ブックがなければ何もせず元の配列をそのまま返す（memocho.js と同じ流儀）
  if (!list.some((book) => book != null && book.id === id)) return books
  return list.map((book) => (book != null && book.id === id ? { ...book, name: trimmed } : book))
}

/**
 * ブックを削除する。
 * デフォルトブック（'default'）は削除できない（リストをそのまま返す）。
 * 該当ブックがなければ何も起きない。
 * @param {Array<object>} books
 * @param {string} id
 * @returns {Array<object>}
 */
export function deleteBook(books, id) {
  if (id === DEFAULT_BOOK_ID) return books
  if (typeof id !== 'string' || id === '') return books
  const list = Array.isArray(books) ? books : []
  // 該当ブックがなければ何もせず元の配列をそのまま返す（memocho.js と同じ流儀）
  if (!list.some((book) => book != null && book.id === id)) return books
  return list.filter((book) => !(book != null && book.id === id))
}

/**
 * ブックの公開設定（public）を切り替える。
 * 該当 ID のブックの public を isPublic === true で上書きする。
 * 「デフォルト」ブックを含む全ブックが対象（削除不可の制限とは無関係）。
 * isPublic が true 以外（欠落・false・型違い）の場合は非公開（false）になる。
 * 該当ブックがなければ、あるいは id が空でない文字列でなければ、
 * リストをそのまま返す（同じ参照）。
 * @param {Array<object>} books
 * @param {string} id
 * @param {boolean} isPublic
 * @returns {Array<object>}
 */
export function setBookPublic(books, id, isPublic) {
  if (typeof id !== 'string' || id === '') return books
  const list = Array.isArray(books) ? books : []
  // 該当ブックがなければ何もせず元の配列をそのまま返す（memocho.js と同じ流儀）
  if (!list.some((book) => book != null && book.id === id)) return books
  return list.map((book) => (book != null && book.id === id ? { ...book, public: isPublic === true } : book))
}

/**
 * bookId に対応するブック名を解決する（書き出し用の表示名）。
 * bookId が欠落・不正ならデフォルトブック扱い。
 * 対応するブックがリストにない（例: 削除済み）場合もデフォルトブック名を返す。
 * @param {Array<object>} books
 * @param {string|undefined|null} bookId
 * @returns {string}
 */
export function bookNameOf(books, bookId) {
  const id = normalizeBookId(bookId)
  const found = (Array.isArray(books) ? books : []).find((book) => book != null && book.id === id)
  return found ? found.name : DEFAULT_BOOK_NAME
}

/**
 * ブックエントリ列を検証・正規化する（読み込み用）。
 * 対象でないエントリ（オブジェクトでない・id/name が空でない文字列でない）は落とす。
 * id が重複する場合は先頭のエントリを採用する。
 * @param {unknown} books
 * @returns {Array<{ id: string, name: string, createdAt: string|null, public: boolean }>}
 */
export function normalizeBookEntries(books) {
  if (!Array.isArray(books)) return []
  const out = []
  const seen = new Set()
  for (const entry of books) {
    if (!isValidBookEntry(entry)) continue
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(canonicalBook(entry))
  }
  return out
}

/**
 * 読み込んだブック列を現行リストに合流する（mergeMemocho と同じ流儀）。
 * - 同一 ID が現行リストに既にある場合は既存を優先してスキップする。
 * - 新たそうなブックは末尾に追加する。
 * - (ピースH) ブック数の上限（MAX_BOOKS、デフォルト含む 100 冊）に達した時点で
 *   その後の新規ブックは追加されない。追加されなかったブックは rejected に
 *   入る（呼び出し側で、そのブックに属するメモの bookId を 'default' に
 *   落とし込む）。
 * @param {Array<object>} current
 * @param {Array<object>} imported
 * @returns {{ books: Array<object>, added: Array<object>, skipped: number, rejected: Array<object> }}
 */
export function mergeScrapbooks(current, imported) {
  const books = (Array.isArray(current) ? current : []).filter(isValidBookEntry).map(canonicalBook)
  const indexById = new Map()
  books.forEach((book, i) => {
    if (!indexById.has(book.id)) indexById.set(book.id, i)
  })
  const added = []
  const rejected = []
  let skipped = 0
  for (const entry of normalizeBookEntries(imported)) {
    if (indexById.has(entry.id)) {
      skipped += 1
      continue
    }
    // (ピースH) 上限に達していれば新規ブックは作らない
    if (books.length >= MAX_BOOKS) {
      rejected.push(entry)
      continue
    }
    indexById.set(entry.id, books.length)
    books.push(entry)
    added.push(entry)
  }
  return { books, added, skipped, rejected }
}
