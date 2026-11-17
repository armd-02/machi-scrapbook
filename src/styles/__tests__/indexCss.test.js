/**
 * index.css の .maplibregl-map ルールに関する回帰テスト
 *
 * バグの経緯:
 * 一覧画面の検索結果マップ（MobileResultsMap）が初期高さを 0px で描画される
 * 問題の根本原因は、このファイル内の `.maplibregl-map { height: 100% }` ルール
 * が「レイヤ外（unlayered）」に書かれていたこと。
 *
 * Tailwind v4 はユーティリティ（h-[320px] 等）を @layer utilities に置くが、
 * CSS のカスケードではレイヤ外の作者スタイルがどのレイヤ内ルールよりも優先
 * される。そのためレイヤ外の height: 100% が h-[320px] を上書きし、親要素の
 * 高さが auto の場合 height: 100% は auto に無効化される。MapLibre のキャンバ
 * スは position: absolute なのでコンテナのフロー内コンテンツがなく、結果として
 * コンテナ高さ 0px になる。
 *
 * 対策: .maplibregl-map ルールを @layer components 内に移動した（utilities より
 * 優先度が低い）。本テストは「.maplibregl-map の高さ宣言がレイヤ外に存在しない」
 * ことを CSS 文字列として検証し、再発を防ぐ。
 *
 * jsdom の CSSOM はカスケードレイヤの優先度を再現しないため、実際のレンダ
 * ー検証は別途（ブラウザ）で行う。ここでは原因が CSS 文字列側にあり続ける
 * ことを保証するのが目的。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css')
const RAW = readFileSync(CSS_PATH, 'utf8')
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '') // コメント除去

/**
 * 指定位置の '{' から対応する '}' のインデックスを返す。
 */
function matchBrace(css, openIdx) {
  let depth = 0
  for (let i = openIdx; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error('unbalanced braces near index ' + openIdx)
}

/**
 * CSS 内の @layer <name> { ... } ブロックを（入れ子を含む）全て探す。
 * 各ブロックの {name, start, end} を返す（start/end は @layer 文の範囲）。
 */
function findLayerBlocks(css) {
  const blocks = []
  const makeRe = () => /@layer\s+([A-Za-z][A-Za-z-]*)\s*\{/g
  const scan = (text, offset) => {
    // 再帰 scan 間で lastIndex を共有しないため、毎回新しい RegExp を作る
    const re = makeRe()
    let m
    while ((m = re.exec(text)) !== null) {
      const open = m.index + m[0].length - 1
      const close = matchBrace(text, open)
      blocks.push({
        name: m[1],
        start: offset + m.index,
        end: offset + close + 1,
        innerOffset: offset + open + 1
      })
      // 入れ子の @layer も探す
      scan(text.slice(open + 1, close), offset + open + 1)
    }
  }
  scan(css, 0)
  return blocks
}

/**
 * 指定インデックスを含む（最内側の）@layer ブロックを返す。無いなら null。
 */
function layerAt(blocks, idx) {
  let best = null
  for (const b of blocks) {
    if (idx >= b.start && idx < b.end) {
      if (!best || b.start - b.end > best.start - best.end) best = b // 幅が小さい（内側の）ブロックを優先
    }
  }
  return best
}

/**
 * .maplibregl-map のルール箇所（セレクタ出現位置）を全て探す。
 */
function findRuleOccurrences(css, selector = '.maplibregl-map') {
  const out = []
  let from = 0
  while (true) {
    const i = css.indexOf(selector, from)
    if (i === -1) return out
    out.push(i)
    from = i + selector.length
  }
}

const LAYER_BLOCKS = findLayerBlocks(CSS)
const OCCURRENCES = findRuleOccurrences(CSS)

describe('index.css: .maplibregl-map のカスケードレイヤ位置', () => {
  it('.maplibregl-map ルールがファイルに存在する', () => {
    expect(OCCURRENCES.length).toBeGreaterThanOrEqual(1)
  })

  it('.maplibregl-map の全出現箇所が @layer ブロック内にある（レイヤ外に高さ宣言が無い）', () => {
    const unlayered = OCCURRENCES.filter((i) => layerAt(LAYER_BLOCKS, i) === null)
    expect(unlayered).toEqual([])
  })

  it('高さを宣言する .maplibregl-map ルールは @layer components 内にある', () => {
    // 各出現箇所のルール本体（.maplibregl-map { ... }）を取り出し、
    // height を宣言しているものについて属するレイヤを確認する。
    const offenders = []
    for (const i of OCCURRENCES) {
      const brace = CSS.indexOf('{', i)
      if (brace === -1 || brace - i > 80) continue // ルール開始と見えない
      const close = matchBrace(CSS, brace)
      const body = CSS.slice(brace + 1, close)
      if (!/^\s*height\s*:/.test(body)) continue
      const layer = layerAt(LAYER_BLOCKS, i)
      if (!layer || layer.name !== 'components') {
        offenders.push({ at: i, layer: layer ? layer.name : '(unlayered)', body: body.trim().slice(0, 120) })
      }
    }
    expect(offenders).toEqual([])
  })

  it('.maplibregl-map ルールの既存宣言（width/height/z-index）が維持されている', () => {
    const i = OCCURRENCES[0]
    const brace = CSS.indexOf('{', i)
    const close = matchBrace(CSS, brace)
    const body = CSS.slice(brace + 1, close)
    expect(body).toMatch(/width\s*:\s*100%/)
    expect(body).toMatch(/height\s*:\s*100%/)
    expect(body).toMatch(/z-index\s*:\s*0/)
  })
})
