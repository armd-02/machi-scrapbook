/**
 * 自治体データユーティリティ（一般向けトップの地名入力サジェスト用）
 *
 * 「都道府県から探す」で使っている静的データ（public/data/municipalities.json）を
 * トップの地名入力サジェストと検索フローに組み込むための関数群。
 * 自治体名をNominatimの順位に左右されず確実に選べるようにするため、
 * 自治体候補はローカル（静的データ）で即座に計算する。
 */

/**
 * municipalities.json をフェッチし、municipalities 配列を返す。
 *
 * - URL 組み立ては MunicipalitySearch.jsx と同じ方式
 *   （import.meta.env.BASE_URL + 'data/municipalities.json'）
 * - モジュールレベルのキャッシュ（Promise）で二重取得を防ぐ
 * - 取得失敗・形式不正時は空配列を返す（例外にしない）
 * @returns {Promise<Array>} municipalities 配列（失敗時は []）
 */
let cachePromise = null

export function loadMunicipalities() {
  if (!cachePromise) {
    const base = import.meta.env.BASE_URL || '/'
    cachePromise = fetch(base + 'data/municipalities.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => (d && Array.isArray(d.municipalities) ? d.municipalities : []))
      .catch(() => [])
  }
  return cachePromise
}

/**
 * query と自治体名を照合する（純粋関数）。
 *
 * - q = query.trim()。q が2文字未満なら []
 * - 完全一致（name === q）を先頭に、前方一致（name が q で始まる）をその後に並べる
 * - 返すのは最大3件
 *
 * @param {Array} municipalities municipalities.json の municipalities 配列
 * @param {string} query 入力文字列
 * @returns {Array} 一致した自治体の配列（最大3件）
 */
export function matchMunicipalities(municipalities, query) {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const list = Array.isArray(municipalities) ? municipalities : []
  const exact = list.filter((m) => m && m.name === q)
  const prefix = list.filter((m) => m && m.name !== q && m.name.startsWith(q))
  return [...exact, ...prefix].slice(0, 3)
}

/**
 * query と完全一致（name === q）する自治体すべてを返す（純粋関数）。
 *
 * トップの「検索する」押下時の地名解決で、Nominatim より先に
 * 自治体の完全一致を調べるのに使う。同名自治体（例: 伊達市×2）が
 * 複数ある場合はすべて返す。
 *
 * @param {Array} municipalities municipalities.json の municipalities 配列
 * @param {string} query 入力文字列
 * @returns {Array} 完全一致した自治体の配列
 */
export function exactMatchMunicipalities(municipalities, query) {
  const q = String(query || '').trim()
  if (!q) return []
  const list = Array.isArray(municipalities) ? municipalities : []
  return list.filter((m) => m && m.name === q)
}

/**
 * 自治体をサジェスト候補と同じ形（geocodeCandidates の戻り値形状）に変換する。
 *
 * - kind: '自治体' → geocodeCandidateLabel で「宇治市（自治体・京都府）」になる
 * - lat/lon: bbox の中心
 * - boundingbox: 自治体の bbox（{south, west, north, east} オブジェクト）。
 *   searchAreaFromGeocode は1km²以上の bbox をそのまま返すため、
 *   候補選択・検索フローでそのまま使える
 *
 * @param {object} m municipalities.json の1自治体
 * @returns {object} サジェスト候補 { name, prefecture, city, kind, lat, lon, boundingbox, displayName }
 */
export function municipalityToCandidate(m) {
  const b = m.bbox
  return {
    name: m.name,
    prefecture: m.prefecture || '',
    city: '',
    kind: '自治体',
    lat: b ? (b.south + b.north) / 2 : null,
    lon: b ? (b.west + b.east) / 2 : null,
    boundingbox: b || null,
    displayName: m.displayName || m.name
  }
}
