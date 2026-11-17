/**
 * メモ文字列内の URL リンク化（セグメント分割）
 *
 * 自由テキストから http:// か https:// で始まる URL を抽出し、
 * [{ type: 'text' | 'url', value }] のセグメント列として返す。
 * 描画側（MemochoCard の表示モード）が url セグメントを <a> に変換する。
 *
 * - スキーム付き（http:// / https://）の URL のみリンク化する。
 *   www.example.com のようなスキーム無いは対象外。
 * - URL の文字集合は RFC3986 由来の安全な範囲（英数字・-._~:/?#[]@$&*+;=%'()）に限定。
 *   空白・カンマ・CJK文字・引用符等は URL の終端となるため、
 *   「https://example.com。閉店」のように文末に CJK 句点が続いても
 *   句点がリンクに含まれない。
 * - 終端に ASCII 句点・コンマ等が残った場合（「https://example.com. 」など）は
 *   末尾の句読点を削ぐ。閉じ括弧 ) ）**は URL 内部にバランスした開き括弧が
 *   ある場合は保持する（Wikipedia 風の URL 対策）。
 *
 * 純粋関数（DOM に触れない）。描画はコンポーネント側で行う。
 */

// URL として認める文字（カンマ・引用符・<>・CJK 等は含まない）
const URL_CHAR_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&*+;=%'()]+/g

// 末尾から削ぐ句読点
const TRAILING_PUNCTS = new Set([
  // ASCII
  ',', '.', ';', ':', '!', '?', ')', ']', '>', '"',
  // 全角・CJK
  '，', '。', '、', '；', '：', '！', '？', '）', '】', '」', '』', '》',
])

function trimTrailingPunct(url) {
  let end = url.length
  while (end > 0 && TRAILING_PUNCTS.has(url[end - 1])) {
    const ch = url[end - 1]
    // 閉じ括弧の直前に、それに対応する開き括弧が残っていれば URL の一部とみなす
    // （例: https://en.wikipedia.org/wiki/Cat_(animal) は末尾の ) を保持）
    if (ch === ')' || ch === '）') {
      const body = url.slice(0, end - 1)
      const opens = (body.match(/[（(]/g) || []).length
      const closes = (body.match(/[）)]/g) || []).length
      if (opens > closes) break
    }
    end -= 1
  }
  return url.slice(0, end)
}

/**
 * テキストを text/url セグメントに分割する。
 * @param {string|null|undefined} text
 * @returns {{type: 'text'|'url', value: string}[]}
 */
export function linkifySegments(text) {
  const src = text == null ? '' : String(text)
  if (!src) return []
  const segments = []
  let last = 0
  const re = new RegExp(URL_CHAR_RE.source, 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    const url = trimTrailingPunct(m[0])
    if (!url || url === 'http://' || url === 'https://') {
      // 実質 URL が空（句読点だけ、等）: 通常テキスト扱いにして正規表現を進める
      if (m.index > last) segments.push({ type: 'text', value: src.slice(last, m.index) })
      segments.push({ type: 'text', value: m[0] })
      last = m.index + m[0].length
      continue
    }
    if (m.index > last) segments.push({ type: 'text', value: src.slice(last, m.index) })
    segments.push({ type: 'url', value: url })
    // 削られた末尾句読点は後続の通常テキストに回す
    last = m.index + url.length
  }
  if (last < src.length) segments.push({ type: 'text', value: src.slice(last) })
  return segments
}
