/**
 * opening_hours の日本語化ユーティリティ（表示用のみ）
 *
 * OSM の opening_hours タグ（https://wiki.openstreetmap.org/wiki/Opening_hours_tag）
 * が 'Mo-Fr 09:00-17:00' のような英語表記のまま表示されるのを防ぐため、
 * 表示箇所のみを人間が読める日本語表記に変換する。
 *   'Mo-Fr 09:00-17:00; Sa 09:00-12:00'
 *   → '月〜金 9:00〜17:00／土 9:00〜12:00'
 *
 * データ自体（ダウンロード・CSV・OSM書き込み等）は元の値のまま。
 * 変換できない複雑な構文（月名・week・sunrise/sunset・引用符コメント等）は
 * 誤訳を避け、原文のまま表示する。
 */

// 曜日トークン → 日本語
const DAY_MAP = {
  Mo: '月', Tu: '火', We: '水', Th: '木',
  Fr: '金', Sa: '土', Su: '日', PH: '祝日',
}
const DAY_ALT = Object.keys(DAY_MAP).join('|')

const DAY_RANGE_RE = new RegExp(`\\b(${DAY_ALT})-(${DAY_ALT})\\b`, 'g')
const DAY_LIST_RE = new RegExp(`\\b(${DAY_ALT})(?:\\s*,\\s*(${DAY_ALT}))+\\b`, 'g')
const DAY_SINGLE_RE = new RegExp(`\\b(${DAY_ALT})\\b`, 'g')
const TIME_RANGE_RE = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g
const TIME_OPEN_RE = /(\d{1,2}):(\d{2})\s*\+/g
const OFF_RE = /\boff\b/gi

/** 時の先行ゼロを取り、数値文字列にする（'09' → '9'） */
function hourNoZero(h) {
  return String(parseInt(h, 10))
}

/**
 * 単一ルールの変換。
 * 変換後も英字が残る場合は原文をそのまま返す（フォールバック）。
 */
function convertRule(raw) {
  const rule = raw.trim()
  if (!rule) return raw
  if (rule === '24/7') return '24時間営業'
  const s = rule
    .replace(DAY_RANGE_RE, (m, a, b) => `${DAY_MAP[a]}〜${DAY_MAP[b]}`)
    .replace(DAY_LIST_RE, (m) => m.split(/,\s*/).map((d) => DAY_MAP[d]).join('・'))
    .replace(DAY_SINGLE_RE, (m) => DAY_MAP[m])
    .replace(TIME_RANGE_RE, (m, a, b, c, d) => `${hourNoZero(a)}:${b}〜${hourNoZero(c)}:${d}`)
    .replace(TIME_OPEN_RE, (m, a, b) => `${hourNoZero(a)}:${b}〜`)
    .replace(OFF_RE, '休み')
  // 英字が残る（月名・week・sunrise/sunset・引用符コメント等の複雑な構文）→ 原文
  return /[A-Za-z]/.test(s) ? rule : s
}

/**
 * opening_hours 値を表示用日本語表記に変換する。
 * - 空・null・undefined はそのまま返す（呼び出し側の truthy 判定を壊さない）
 * - '24/7' → '24時間営業'
 * - ';' でルールに分割し、変換後は通常 '／' でつなぐ
 * - multiline のときはルールごとに改行。コンマで始まる別の曜日区分も改行する
 */
export function formatOpeningHoursJa(value, { multiline = false } = {}) {
  if (!value) return value
  const v = String(value).trim()
  if (v === '24/7') return '24時間営業'
  const rules = v.split(';').map(convertRule)
  return multiline
    ? rules.join('\n').replace(/,\s*(?=(?:[月火水木金土日]|祝日)(?:[〜・\s]|$))/g, '\n')
    : rules.join('／')
}
