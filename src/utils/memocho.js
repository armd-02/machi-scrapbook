/**
 * まちメモ帳のデータ層（お気に入り＋個人メモ）。
 *
 * localStorage（キー: 'machi-memocho-v1'）に保存するアイテム群を扱う
 * React 非依存の純粋な関数群。
 *
 * アイテムの形:
 *   { type, id, name, lat, lon, tags, memo, addedAt, mapImage?, rating }
 *   - type: 'node' | 'way' | 'relation'
 *   - id:   数値
 *   - mapImage?: 地図サムネイル（dataURL）。未設定なら省略
 *   - rating: 0〜5 の評価（整数）。0 ＝ 未評価
 *   - 一意キー: `${type}/${id}`
 */

export const MEMOCHO_STORAGE_KEY = 'machi-memocho-v1'
export const MEMOCHO_APP_ID = 'machi-memocho'
export const MEMOCHO_VERSION = 1

const VALID_TYPES = new Set(['node', 'way', 'relation'])

/** type/id が最小限の形で妥当かを検査（検索結果・保存済みアイテム両方に対応） */
function isValidSource(source) {
  return (
    source != null &&
    typeof source === 'object' &&
    VALID_TYPES.has(source.type) &&
    typeof source.id === 'number' &&
    Number.isFinite(source.id)
  )
}

/** {type, id} から 'node/123' 形式の一意キーを返す */
export function memochoKeyOf(source) {
  return `${source.type}/${source.id}`
}

/**
 * localStorage から読み、アイテムの配列を返す。
 * 未保存・壊れたJSON・配列でない・type/id が不正な要素は []（または除外）。
 */
export function loadMemocho() {
  let raw
  try {
    raw = localStorage.getItem(MEMOCHO_STORAGE_KEY)
  } catch {
    return []
  }
  if (raw == null) return []
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(isValidSource)
  } catch {
    return []
  }
}

/** アイテムの配列を localStorage へ保存 */
export function saveMemocho(items) {
  localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify(items))
}

/** 配列にキーが登録済みかを返す */
export function hasMemocho(items, key) {
  return items.some((item) => memochoKeyOf(item) === key)
}

/**
 * 検索結果（{type, id, lat, lon, tags}）からスナップショットを作って追加し、
 * 新しい配列を返す。
 *
 * - name: tags.name → tags['name:ja'] → '名称なし' の優先順
 * - tags: 浅いコピー（元のオブジェクトと独立）
 * - memo: '' / rating: 0（未評価）/ addedAt: 現在時刻の ISO 文字列
 * - 既に同じキーが登録済みなら配列をそのまま返す（重複追加しない）
 */
export function addMemocho(items, result) {
  if (!isValidSource(result)) return items

  const key = memochoKeyOf(result)
  if (hasMemocho(items, key)) return items

  const tags = result.tags && typeof result.tags === 'object' ? { ...result.tags } : null
  const name =
    (tags && (tags.name || tags['name:ja'])) || '名称なし'

  const snapshot = {
    type: result.type,
    id: result.id,
    name,
    lat: typeof result.lat === 'number' ? result.lat : null,
    lon: typeof result.lon === 'number' ? result.lon : null,
    tags,
    memo: '',
    rating: 0,
    addedAt: new Date().toISOString(),
  }
  return [...items, snapshot]
}

/** そのキーのアイテムを除いた新しい配列を返す */
export function removeMemocho(items, key) {
  return items.filter((item) => memochoKeyOf(item) !== key)
}

/** そのキーのアイテムの memo を差し替えた新しい配列を返す */
export function updateMemo(items, key, memo) {
  return items.map((item) => (memochoKeyOf(item) === key ? { ...item, memo } : item))
}

/** そのキーのアイテムの mapImage（地図サムネイル dataURL）を差し替えた新しい配列を返す */
export function updateMapImage(items, key, mapImage) {
  return items.map((item) => (memochoKeyOf(item) === key ? { ...item, mapImage } : item))
}

/**
 * そのキーのアイテムの rating（0〜5 の評価、0 ＝ 未評価）を差し替えた
 * 新しい配列を返す。rating が 0〜5 の整数以外の場合は変更しない。
 */
export function updateRating(items, key, rating) {
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 0 || rating > 5) {
    return items
  }
  return items.map((item) => (memochoKeyOf(item) === key ? { ...item, rating } : item))
}

/**
 * 読み込み用の合流。キー重複は既存（current）を優先する。
 * 戻り値: { items, added, skipped }
 *   - items:   合流後の配列
 *   - added:   imported から実際に追加されたアイテム
 *   - skipped: 既存キーと重複して追加しなかった件数
 */
export function mergeMemocho(current, imported) {
  const seen = new Set(current.map(memochoKeyOf))
  const items = [...current]
  const added = []
  let skipped = 0

  for (const item of imported) {
    const key = memochoKeyOf(item)
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    items.push(item)
    added.push(item)
  }
  return { items, added, skipped }
}

/**
 * 書き出し用JSON文字列。
 * 形式: { app: 'machi-memocho', version: 1, items: [...] }
 */
export function serializeMemocho(items) {
  return JSON.stringify({
    app: MEMOCHO_APP_ID,
    version: MEMOCHO_VERSION,
    items,
  })
}

function normalizeCoordinate(value, label) {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`まちメモ帳: ${label} が数値でも null でもありません`)
}

/**
 * 正規化。要素が形式を満たさなければ Error を投げる。
 */
function normalizeItem(item) {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('まちメモ帳: 不正なアイテム形式です')
  }
  if (!VALID_TYPES.has(item.type)) {
    throw new Error(`まちメモ帳: type が不正です（${item.type}）`)
  }
  if (typeof item.id !== 'number' || !Number.isFinite(item.id)) {
    throw new Error(`まちメモ帳: id が数値ではありません（${item.type}）`)
  }

  const lat = normalizeCoordinate(item.lat, 'lat')
  const lon = normalizeCoordinate(item.lon, 'lon')

  const name =
    typeof item.name === 'string' && item.name !== '' ? item.name : '名称なし'
  const memo = item.memo == null ? '' : String(item.memo)
  const tags =
    item.tags != null && typeof item.tags === 'object' && !Array.isArray(item.tags)
      ? { ...item.tags }
      : null
  const addedAt = typeof item.addedAt === 'string' ? item.addedAt : null
  // 地図サムネイル（dataURL）。画像データでない文字列や大きすぎる値は保持しない
  const mapImage =
    typeof item.mapImage === 'string' &&
    item.mapImage.startsWith('data:image/') &&
    item.mapImage.length <= 200000
      ? item.mapImage
      : null
  // 評価（0〜5、0 ＝ 未評価）。0〜5 の整数以外は未評価として扱う（寛容な方式）
  const rating =
    typeof item.rating === 'number' &&
    Number.isInteger(item.rating) &&
    item.rating >= 0 &&
    item.rating <= 5
      ? item.rating
      : 0

  const normalized = {
    type: item.type,
    id: item.id,
    name,
    lat,
    lon,
    tags,
    memo,
    addedAt,
  }
  if (mapImage) normalized.mapImage = mapImage
  normalized.rating = rating
  return normalized
}

/**
 * 読み込み用。上の形式のオブジェクトと、素のアイテム配列の両方を受け付ける。
 * 各要素を検証・正規化した配列を返す。
 * 全体が不正（JSONでない・形式に合わない・要素が不正）の場合は Error を投げる。
 */
export function parseMemochoJSON(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('まちメモ帳: 無効な JSON です')
  }

  if (Array.isArray(data)) {
    return data.map(normalizeItem)
  }

  if (data != null && typeof data === 'object' && Array.isArray(data.items)) {
    if (data.app !== MEMOCHO_APP_ID) {
      throw new Error('まちメモ帳: app が一致しません')
    }
    return data.items.map(normalizeItem)
  }

  throw new Error('まちメモ帳: 形式が一致しません（オブジェクトの items が配列ではありません）')
}
