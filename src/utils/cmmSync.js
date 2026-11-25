/**
 * CMM（community_mapmaker）同期エンジン。
 *
 * まちメモ帳のアイテムと、community_mapmaker 後端の Activity を同期する
 * 純粋なエンジン層。UI や localStorage への lastSyncAt 保存は行わない
 *（呼び出し側が result.lastSyncAt を保存する）。
 *
 * 後端: https://cmapmaker.openacrossbase.net（community_mapmaker_backend）
 * アプリキー: machi-scrapbook（スキーマ: name / memo / rating / book / tags）
 * - tags: OSM タグの JSON 文字列（(ピースG0)）。空・未定義なら項目を送らない
 *
 * 構成:
 *  - API クライアント: fetchActivities（一覧取得・認証不要）/
 *    saveBatch（一括書き込み・HTTP Basic 認証）
 *  - 変換: memoToActivity（メモ → Activity 値）/
 *    activityToMemoPatch（Activity → メモ更新パッチ）
 *  - syncMemos: ①取得 → ②取り込み → ③作成/更新 → ④削除 → ⑤書き込み → ⑥結果返却
 *
 * 同期ルール（syncMemos）:
 *  - 同期対象は「公開ブックに属するアクティブなメモ」のみ。
 *  - 対応付けは cmmId が優先。cmmId が無いメモは osmid（= メモの key）で
 *    取得した Activity と対応付ける。
 *  - （マルチユーザー対応・所有の基準は「作成者」）
 *    ・通常経路（ログインIDがユーザーID形式＝'@' を含まない）:
 *      取得時に userid=<ログインID> を付けて、自分が作成した投稿だけ
 *      をサーバ側で絞り込む。取得できた投稿は最終更新者（updated_by_userid）
 *      が別人でも自分のものとして取り込み・更新の対象にする（サーバ側の
 *      フィルタを信頼し、手元の updated_by_userid 除外は行わない）。
 *    ・フォールバック経路（ログインIDがメールアドレス形式＝'@' を含む）:
 *      userid はユーザーID専用なので使わず、全件取得して手元で
 *      updated_by_userid の完全一致＋cmmId 結び付きで判定する。
 *      あいまいな所有権推測は行わない（他人の投稿は取り込まない・
 *      上書きしない・削除候補にしない）。cmmId 連結による判定は有効。
 *  - 削除候補はローカル由来のみ（トンブストーン＋公開ブックから外れた
 *    cmmId 付きメモ）。取得できなかった他人の投稿は削除対象にしない。
 *  - 取り込み（imported）: リモート側の updated_at が新しい場合、または
 *    リモートにだけ存在する Activity を、ローカルメモの更新・新規メモとして返す。
 *    リモートの book（ブック名）がローカルに無い場合は createBook: true で
 *    「同名のブックを新規作成し公開にする」旨を伝える。
 *  - 作成（created）: cmmId 無しでリモートにも対応 Activity の無い公開メモ。
 *  - 更新（updated）: cmmId ありでローカル内容がリモートと異なる公開メモ。
 *    増分取得でリモート記録が見えない場合（最後に同期してから変更が無い）は
 *    比較できないため、ローカル内容を送る（冪等的・安全側）。
 *  - 削除（deleted）: トンブストーン、非公開ブックへ移動した cmmId 付きメモ、
 *    ごみ箱に入った cmmId 付きメモ。
 *  - バッチが 1000 件を超える場合は分割送信し、バッチごとに成功/失敗を
 *    区別して返す（成功済みの部分を失わない。認証/権限エラーでその後は中断）。
 */

import { bookNameOf, DEFAULT_BOOK_ID, normalizeBookId } from './scrapbooks.js'
import { memochoKeyOf } from './memocho.js'
import { isValidCmmId } from './cmmTombstones.js'

export const CMM_BASE_URL = 'https://cmapmaker.openacrossbase.net'
export const CMM_APP_KEY = 'machi-scrapbook'
/** 1 トランザクションあたりの変更数の上限（後端仕様） */
export const CMM_MAX_BATCH_CHANGES = 1000

/** 名称が未設定のメモの保存名（memocho.js の addMemocho と同じセンチネル） */
const NAME_SENTINEL = '名称なし'

/**
 * CMM 通信・検証エラー。kind は
 * 'auth'（401）/ 'permission'（403）/ 'validation'（422）/
 * 'network'（それ以外の HTTP エラーとネットワーク失敗）のいずれか。
 */
export class CmmError extends Error {
  constructor({ kind = 'network', status = null, code = null, message = 'CMM 通信エラー', details = null } = {}) {
    super(message)
    this.name = 'CmmError'
    this.kind = kind
    this.status = status
    this.code = code
    this.details = details
  }
}

/* ---------------------------------------------------------------------------
 * 日付ヘルパー
 * ------------------------------------------------------------------------- */

/**
 * CMM の日時文字列をミリ秒へ変換。
 * 'YYYY-MM-DD HH:MM:SS'（UTC）と RFC3339（'Z' またはオフセット付き）を扱う。
 * 時区記号のない場合は UTC とする。解析できない場合は null。
 */
export function cmmToMs(value) {
  if (typeof value !== 'string' || value === '') return null
  let s = value.trim()
  if (s.includes(' ')) s = s.replace(' ', 'T')
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z'
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/** ミリ秒を RFC3339（UTC・'Z' 付き）文字列へ。小数秒が 0 なら省略する。 */
export function cmmToRfc3339Z(ms) {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

/* ---------------------------------------------------------------------------
 * メモ ⇔ Activity 変換
 * ------------------------------------------------------------------------- */

/**
 * メモの保存名を Activity の name へ。
 * 保存名をそのまま送り、空の場合は空文字列を送る（表示用のフォールバック
 * 名称「名称なし」は送らない）。
 */
export function cmmNameOf(memo) {
  const name = memo && typeof memo.name === 'string' ? memo.name : ''
  return name === '' || name === NAME_SENTINEL ? '' : name
}

/**
 * Activity の rating 値（'1'..'5' / 1..5）を 0..5 の整数へ。
 * 未設定・不正値は 0（未評価）。
 */
export function parseCmmRating(value) {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * メモ 1 件を Activity 入力値に変換する。
 * 戻り値: { osmid, name, memo, book, [rating], [latitude, longitude], [tags] }
 * - osmid: メモの key（type/id）そのまま
 * - rating: 1..5 のときだけ "1".."5" 文字列として含める（0 は省略）
 * - 座標: lat/lon が両方揃っているときだけ含める
 * - tags: (ピースG0) OSM タグの JSON 文字列。空・未定義の tags は送らない
 *   （rating の「0 なら送らない」と同じく、意味のない値は送らない）
 * 更新用の id は含めない（saveBatch 側で付ける）。
 */
export function memoToActivity(memo, books = []) {
  const activity = {
    osmid: memochoKeyOf(memo),
    name: cmmNameOf(memo),
    memo: memo && typeof memo.memo === 'string' ? memo.memo : '',
    book: bookNameOf(books, memo ? memo.bookId : null),
  }
  const rating = parseCmmRating(memo ? memo.rating : null)
  if (rating > 0) activity.rating = String(rating)
  // (ピースG0) OSM タグを JSON 文字列として送る。空オブジェクト・未定義・
  // 非オブジェクトは項目自体を送らない
  const tags = memo && memo.tags != null && typeof memo.tags === 'object' && !Array.isArray(memo.tags)
    ? memo.tags
    : null
  if (tags !== null && Object.keys(tags).length > 0) {
    activity.tags = JSON.stringify(tags)
  }
  const lat = finiteNumber(memo ? memo.lat : null)
  const lon = finiteNumber(memo ? memo.lon : null)
  if (lat !== null && lon !== null) {
    activity.latitude = lat
    activity.longitude = lon
  }
  return activity
}

/**
 * (ピースG0) Activity の tags（JSON 文字列）をメモの tags オブジェクトへ解釈する。
 * - 項目が無い（undefined / null）: undefined を返す（パッチに含めない＝従来どおり）
 * - 文字列: JSON として解釈し、プレーンオブジェクトならそれを返す。
 *   不正な JSON・オブジェクト以外（配列・スカラー等）は空オブジェクト {}
 * - 文字列でない（オブジェクト等）: 空オブジェクト {}
 * 同期全体を失敗させない（例外を捕捉する）。
 */
export function parseCmmTags(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // 不正な JSON は空オブジェクト
  }
  return {}
}

/**
 * Activity 1 件をメモ更新用のパッチに変換する（memoToActivity の逆）。
 * 戻り値: { name, memo, rating, book, [tags] }
 * - name: 空・null のときは保存名センチネル「名称なし」
 * - rating: '1'..'5' を 1..5 の整数に（未設定は 0）
 * - book: ブック名（空・null は ''）
 * - tags: (ピースG0) 項目があるときだけ含む（parseCmmTags）。無い既存の投稿は
 *   パッチに tags を含めず、ローカル側の tags はそのまま維持する
 */
export function activityToMemoPatch(activity) {
  const a = activity && typeof activity === 'object' ? activity : {}
  const patch = {
    name: typeof a.name === 'string' && a.name !== '' ? a.name : NAME_SENTINEL,
    memo: a.memo == null ? '' : String(a.memo),
    rating: parseCmmRating(a.rating),
    book: typeof a.book === 'string' ? a.book : '',
  }
  const tags = parseCmmTags(a.tags)
  if (tags !== undefined) patch.tags = tags
  return patch
}

/* ---------------------------------------------------------------------------
 * API クライアント
 * ------------------------------------------------------------------------- */

function errorKindForStatus(status) {
  if (status === 401) return 'auth'
  if (status === 403) return 'permission'
  if (status === 422) return 'validation'
  return 'network'
}

/** CmmError（または未知のエラー）を result.errors 用の通常オブジェクトへ。 */
export function toErrorObject(err) {
  if (err instanceof CmmError) {
    return { kind: err.kind, status: err.status, code: err.code, message: err.message, details: err.details }
  }
  return { kind: 'network', status: null, code: null, message: String(err && err.message ? err.message : err), details: null }
}

function basicAuthHeader(credentials) {
  const raw = `${credentials.username}:${credentials.password}`
  const bytes = new TextEncoder().encode(raw)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `Basic ${btoa(bin)}`
}

function hasCredentials(credentials) {
  return (
    credentials != null &&
    typeof credentials.username === 'string' &&
    credentials.username !== '' &&
    typeof credentials.password === 'string'
  )
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

/** CMM 後端への HTTP リクエスト。非 2xx とネットワーク失敗で CmmError を投げる。 */
async function cmmRequest(path, { method = 'GET', body, credentials } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (credentials && method !== 'GET') headers.Authorization = basicAuthHeader(credentials)
  let res
  try {
    res = await fetch(`${CMM_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new CmmError({ kind: 'network', message: `ネットワークエラー: ${err && err.message ? err.message : err}` })
  }
  const text = await res.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!res.ok) {
    const code = payload && typeof payload.code === 'string' ? payload.code : null
    throw new CmmError({
      kind: errorKindForStatus(res.status),
      status: res.status,
      code,
      message: (payload && payload.message) || code || `HTTP ${res.status}`,
      details: payload && typeof payload === 'object' && payload.errors ? payload.errors : null,
    })
  }
  return payload
}

/**
 * リモートの Activity 一覧を取得する（認証不要）。
 * @param {{ since?: string|null, userid?: string|null }} options
 *   since: 増分取得の境界（RFC3339・時区付き・境界値を含む）。
 *   null/空・解析不能なら全件取得。
 *   userid: 作成者（初回投稿者）のログイン用ユーザーIDで絞り込む
 *   （大文字・小文字は区別しない）。updated_since と併用できる。
 *   ユーザーID専用（メールアドレスには使えない）。
 * @returns {Promise<Array>} Activity 配列（スキーマフィールドはトップレベルに展開）
 */
export async function fetchActivities({ since = null, userid = null } = {}) {
  let sinceValue = typeof since === 'string' && since !== '' ? since : null
  if (sinceValue !== null && cmmToMs(sinceValue) === null) sinceValue = null
  const params = new URLSearchParams({ app: CMM_APP_KEY })
  if (sinceValue !== null) params.set('updated_since', sinceValue)
  if (typeof userid === 'string' && userid !== '') params.set('userid', userid)
  const payload = await cmmRequest(`/api/activities.php?${params.toString()}`)
  if (!Array.isArray(payload)) {
    throw new CmmError({ kind: 'network', message: 'CMM 一覧の応答形式が不正です' })
  }
  return payload
}

/**
 * 変更（creates/updates/deletes）を一括送信する。
 * 1000 件を超える場合は分割して順次送信し、バッチごとに成功/失敗を区別して返す。
 * 認証・権限エラー（401/403）の後はその後のバッチを送らない。
 * created/updated はサーバー応答の Activity 記録、deleted は要求した ID 配列
 *（バッチ成功=全て適用）を返す。
 * @returns {Promise<{created: Array, updated: Array, deleted: Array, errors: Array}>}
 */
export async function saveBatch({ creates = [], updates = [], deletes = [] } = {}, credentials = null) {
  const createsList = asArray(creates)
  const updatesList = asArray(updates)
  const deletesList = asArray(deletes)
  const result = { created: [], updated: [], deleted: [], errors: [] }
  const total = createsList.length + updatesList.length + deletesList.length
  if (total === 0) return result
  if (!hasCredentials(credentials)) {
    result.errors.push(toErrorObject(new CmmError({ kind: 'auth', message: 'CMM 認証情報がありません' })))
    return result
  }
  for (const chunk of chunkBatch(createsList, updatesList, deletesList)) {
    try {
      const payload = await cmmRequest('/api/activities-batch.php', {
        method: 'POST',
        body: { app: CMM_APP_KEY, creates: chunk.creates, updates: chunk.updates, deletes: chunk.deletes },
        credentials,
      })
      result.created.push(...asArray(payload && payload.created))
      result.updated.push(...asArray(payload && payload.updated))
      // バッチは全か無かのトランザクションなので、成功すれば要求した削除 ID が
      // 全て適用されている（サーバー応答の echo に依存しない）
      result.deleted.push(...chunk.deletes)
    } catch (err) {
      const e = err instanceof CmmError ? err : new CmmError({ kind: 'network', message: String(err && err.message ? err.message : err) })
      result.errors.push(toErrorObject(e))
      if (e.kind === 'auth' || e.kind === 'permission') break
    }
  }
  return result
}

/** 変更を 1000 件以下のバッチに分割する（creates/updates/deletes の順に並べる）。 */
function chunkBatch(creates, updates, deletes) {
  const flat = [
    ...creates.map((value) => ({ kind: 'create', value })),
    ...updates.map((value) => ({ kind: 'update', value })),
    ...deletes.map((value) => ({ kind: 'delete', value })),
  ]
  const chunks = []
  for (let i = 0; i < flat.length; i += CMM_MAX_BATCH_CHANGES) {
    const slice = flat.slice(i, i + CMM_MAX_BATCH_CHANGES)
    chunks.push({
      creates: slice.filter((c) => c.kind === 'create').map((c) => c.value),
      updates: slice.filter((c) => c.kind === 'update').map((c) => c.value),
      deletes: slice.filter((c) => c.kind === 'delete').map((c) => c.value),
    })
  }
  return chunks
}

/* ---------------------------------------------------------------------------
 * 同期オーケストレーション
 * ------------------------------------------------------------------------- */

function isSyncableMemo(memo) {
  return (
    memo != null &&
    typeof memo === 'object' &&
    typeof memo.type === 'string' &&
    typeof memo.id === 'number' &&
    Number.isFinite(memo.id)
  )
}

function isDeleted(memo) {
  return typeof memo.deletedAt === 'string' && memo.deletedAt !== ''
}

function findBook(books, bookId) {
  const id = normalizeBookId(bookId)
  const list = Array.isArray(books) ? books : []
  return list.find((book) => book != null && book.id === id) ?? null
}

function isPublicBook(book) {
  return book != null && book.public === true
}

/** Activity の book（ブック名）をローカルブックへ解決する。 */
function resolveRemoteBook(bookName, books) {
  const name = typeof bookName === 'string' ? bookName : ''
  if (name === '') return { bookId: DEFAULT_BOOK_ID, createBook: false }
  const found = (Array.isArray(books) ? books : []).find((book) => book != null && book.name === name)
  return found ? { bookId: found.id, createBook: false } : { bookId: null, createBook: true }
}

/**
 * 対応した Activity とメモの内容を比較して取るべき行動を返す。
 * 'import'（リモートが新しい）/ 'update'（ローカルが新しい・異なる）/ 'none'。
 */
function pairAction(memo, activity, books) {
  const remoteMs = cmmToMs(activity.updated_at)
  const localMs = cmmToMs(memo.cmmUpdatedAt)
  if ((remoteMs ?? -Infinity) > (localMs ?? -Infinity)) return 'import'
  return memoContentDiffers(memo, activity, books) ? 'update' : 'none'
}

/** メモと Activity の内容（name/memo/rating/book/座標）に差があるかを判定する。 */
function memoContentDiffers(memo, activity, books) {
  const patch = activityToMemoPatch(activity)
  if (patch.name !== cmmNameOf(memo)) return true
  const localMemo = memo.memo == null ? '' : String(memo.memo)
  if (patch.memo !== localMemo) return true
  if (patch.rating !== parseCmmRating(memo.rating)) return true
  if (patch.book !== bookNameOf(books, memo.bookId)) return true
  const aLat = finiteNumber(activity.latitude)
  const aLon = finiteNumber(activity.longitude)
  const mLat = finiteNumber(memo.lat)
  const mLon = finiteNumber(memo.lon)
  if (aLat !== mLat || aLon !== mLon) return true
  return false
}

function withId(activity, id) {
  return { ...activity, id }
}

/**
 * （マルチユーザー対応）Activity が「自分の投稿」かを判定する。
 * updated_by_userid がログインIDと完全一致する場合のみ「自分の」。
 * あいまいな一致（メールアドレスのローカルパート等）で所有権を推測しない。
 * ログインIDが分からない（credentials 無し）場合は常に false。
 */
function isOwn(activity, myUserId) {
  if (myUserId == null) return false
  return (
    activity != null &&
    typeof activity.updated_by_userid === 'string' &&
    activity.updated_by_userid === myUserId
  )
}

function cmmUpdatedAtOf(activity, fallbackMs) {
  const ms = cmmToMs(activity.updated_at)
  return cmmToRfc3339Z(ms !== null ? ms : fallbackMs)
}

/** 既存メモのリモート値取り込み（update-memo）エントリを生成する。 */
function memoImportEntry(memo, activity, books) {
  const patch = activityToMemoPatch(activity)
  const book = resolveRemoteBook(patch.book, books)
  const entry = {
    type: 'update-memo',
    key: memochoKeyOf(memo),
    cmmId: activity.id,
    cmmUpdatedAt: cmmUpdatedAtOf(activity, Date.now()),
    name: patch.name,
    memo: patch.memo,
    rating: patch.rating,
    bookName: patch.book,
    bookId: book.bookId,
    createBook: book.createBook,
  }
  // (ピースG0) tags 項目がある Activity だけ tags をエントリに含める。
  // 無い場合はキー自体を出さず、ローカル側の tags を維持する
  if (patch.tags !== undefined) entry.tags = patch.tags
  return entry
}

/** リモートにだけ存在する Activity の新規メモ（new-memo）エントリを生成する。 */
function newMemoEntry(activity, books) {
  const patch = activityToMemoPatch(activity)
  const book = resolveRemoteBook(patch.book, books)
  return {
    type: 'new-memo',
    key: typeof activity.osmid === 'string' ? activity.osmid : '',
    cmmId: activity.id,
    cmmUpdatedAt: cmmUpdatedAtOf(activity, Date.now()),
    name: patch.name,
    memo: patch.memo,
    rating: patch.rating,
    bookName: patch.book,
    bookId: book.bookId,
    createBook: book.createBook,
    lat: finiteNumber(activity.latitude),
    lon: finiteNumber(activity.longitude),
    // (ピースG0) tags: 解釈できたオブジェクトをそのまま持つ。項目が無い
    // 既存の投稿は null（スナップショット側で従来どおり tags: null）
    tags: patch.tags ?? null,
  }
}

/**
 * まちメモ帳と CMM の同期を実行する。入力を変更せず（mutate せず）、
 * ローカル側に適用すべき変更（imported）とリモートへの書き込み結果
 * （created/updated/deleted）を返す。localStorage には触れない。
 *
 * @param {Object} options
 * @param {Array}  options.memos        メモ帳アイテム配列（ごみ箱分を含む）
 * @param {Array}  options.books        スクラップブック配列（public フィールド付き）
 * @param {Array}  options.tombstones   トンブストーンの cmmId 配列
 * @param {{username:string,password:string}|null} options.credentials
 * @param {string|null} options.lastSyncAt  前回の同期境界（RFC3339）。null で全件取得。
 * @returns {Promise<{created:Array,updated:Array,deleted:Array,imported:Array,errors:Array,lastSyncAt:(string|null)}>}
 *   lastSyncAt が null のときは「変更しない」意味（取得失敗など）。
 */
export async function syncMemos({ memos = [], books = [], tombstones = [], credentials = null, lastSyncAt = null } = {}) {
  const result = { created: [], updated: [], deleted: [], imported: [], errors: [], lastSyncAt: null }

  // （マルチユーザー対応）ログインIDを「自分のユーザーID」として使う。
  // ユーザーID形式（'@' を含まない）ならサーバ側の userid フィルタを使う
  // 通常経路、メールアドレス形式なら手元フィルタのフォールバック経路。
  const myUserId =
    credentials != null && typeof credentials.username === 'string' && credentials.username !== ''
      ? credentials.username
      : null
  const serverSideFilter = myUserId != null && !myUserId.includes('@')
  // 所有権判定: 通常経路は常に true（サーバ側フィルタを信頼・最終更新者が
  // 別人でも自分の投稿）。フォールバック経路は updated_by_userid の完全一致。
  const isMine = serverSideFilter ? () => true : (activity) => isOwn(activity, myUserId)

  // ① 取得（初回は全件、その後は lastSyncAt 以降の増分。
  //   通常経路は userid で作成者を絞り込む）
  let remote
  try {
    remote = await fetchActivities({ since: lastSyncAt, userid: serverSideFilter ? myUserId : null })
  } catch (err) {
    result.errors.push(toErrorObject(err))
    return result
  }

  // リモート Activity を index する
  const remoteById = new Map()
  const remoteByOsmid = new Map()
  let maxRemoteMs = null
  for (const activity of remote) {
    if (activity == null || typeof activity !== 'object') continue
    if (typeof activity.id === 'string' && activity.id !== '') remoteById.set(activity.id, activity)
    const osmid = typeof activity.osmid === 'string' ? activity.osmid : ''
    if (osmid !== '') {
      const existing = remoteByOsmid.get(osmid)
      if (!existing) remoteByOsmid.set(osmid, activity)
      else if (!isMine(existing) && isMine(activity)) {
        // 同一 osmid に複数 Activity がある場合、自分の投稿を対応付けに優先する
        remoteByOsmid.set(osmid, activity)
      }
    }
    const ms = cmmToMs(activity.updated_at)
    if (ms !== null && (maxRemoteMs === null || ms > maxRemoteMs)) maxRemoteMs = ms
  }

  const validMemos = (Array.isArray(memos) ? memos : []).filter(isSyncableMemo)
  const memosByOsmid = new Map()
  for (const memo of validMemos) memosByOsmid.set(memochoKeyOf(memo), memo)

  // 削除セット: トンブストーン ＋ 非公開ブック/ごみ箱の cmmId 付きメモ
  const deleteSet = new Set()
  for (const t of Array.isArray(tombstones) ? tombstones : []) {
    if (isValidCmmId(t)) deleteSet.add(t)
  }
  for (const memo of validMemos) {
    if (!isValidCmmId(memo.cmmId)) continue
    const shared = !isDeleted(memo) && isPublicBook(findBook(books, memo.bookId))
    if (!shared) deleteSet.add(memo.cmmId)
  }

  // ②③④ メモごとに 取り込み/作成/更新 を計画する
  const creates = []
  const updates = []
  const matchedActivityIds = new Set()

  for (const memo of validMemos) {
    if (isDeleted(memo)) continue
    if (!isPublicBook(findBook(books, memo.bookId))) continue

    // cmmId が削除セットに入っている（トンブストーン済み、または非同期メモが
    // 所有している）場合は stale 扱い → 新規作成に降格する
    if (isValidCmmId(memo.cmmId) && deleteSet.has(memo.cmmId)) {
      creates.push(memoToActivity(memo, books))
      continue
    }

    // 対応付け: cmmId 優先、次いで osmid。
    // 既に別のメモが対応付け済みの Activity には対応付けない（先着順）。
    let paired = null
    if (isValidCmmId(memo.cmmId)) {
      const byId = remoteById.get(memo.cmmId)
      if (byId && !matchedActivityIds.has(byId.id)) {
        paired = byId
      } else if (byId) {
        // cmmId 指向の Activity が既に別のメモに対応付け済み → stale 扱い
        creates.push(memoToActivity(memo, books))
        continue
      }
    } else {
      const byOsmid = remoteByOsmid.get(memochoKeyOf(memo))
      // 削除セット（トンブストーン等）に入っている Activity には対応付けない。
      // （マルチユーザー対応）フォールバック経路では他人の投稿
      // （updated_by_userid が自分と一致しない）には対応付けない →
      // 対応付けられなければ新規作成として送る。通常経路は isMine が常に true。
      if (byOsmid && !deleteSet.has(byOsmid.id) && !matchedActivityIds.has(byOsmid.id) && isMine(byOsmid)) paired = byOsmid
    }

    if (paired) {
      matchedActivityIds.add(paired.id)
      const action = pairAction(memo, paired, books)
      if (action === 'import') {
        result.imported.push(memoImportEntry(memo, paired, books))
      } else if (action === 'update') {
        updates.push(withId(memoToActivity(memo, books), paired.id))
      }
      continue
    }

    if (!isValidCmmId(memo.cmmId)) {
      creates.push(memoToActivity(memo, books))
      continue
    }

    // cmmId ありだが取得セットに無い（最後に同期して以来リモート変更なし）
    // → 内容を比較できないため、ローカル内容を送る（冪等的）
    updates.push(withId(memoToActivity(memo, books), memo.cmmId))
  }

  // ② 取り込み: リモートにだけ存在する Activity を新規メモとして返す
  for (const activity of remote) {
    if (activity == null || typeof activity !== 'object') continue
    if (typeof activity.id !== 'string' || activity.id === '') continue
    if (matchedActivityIds.has(activity.id)) continue
    if (deleteSet.has(activity.id)) continue
    // （マルチユーザー対応）フォールバック経路では他人の投稿は取り込まない。
    // 通常経路は isMine が常に true（サーバ側フィルタ済み）
    if (!isMine(activity)) continue
    const osmid = typeof activity.osmid === 'string' ? activity.osmid : ''
    // ローカルに同じ osmid のメモ（非公開/ごみ箱含む）が在る場合は対応済み・
    // 非同期対象なので、取り込まない
    if (osmid !== '' && memosByOsmid.has(osmid)) continue
    result.imported.push(newMemoEntry(activity, books))
  }

  // ③④⑤ リモートへ書き込む
  if (creates.length > 0 || updates.length > 0 || deleteSet.size > 0) {
    const batch = await saveBatch({ creates, updates, deletes: [...deleteSet] }, credentials)
    result.created.push(...batch.created)
    result.updated.push(...batch.updated)
    result.deleted.push(...batch.deleted)
    result.errors.push(...batch.errors)
  }

  // ⑥ 次の同期境界（取得済み Activity の最新 updated_at、無ければ現在時刻）
  result.lastSyncAt = maxRemoteMs !== null ? cmmToRfc3339Z(maxRemoteMs) : cmmToRfc3339Z(Date.now())
  return result
}
