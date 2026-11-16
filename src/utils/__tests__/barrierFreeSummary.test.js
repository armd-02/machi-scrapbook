/**
 * バリアフリー検索 — データの充実度集計（summarizeBarrierFree）のテスト
 *
 * - 歩道の tactile の yes / no / 未記録（unknown）の数え分け
 * - 延長の集計（totalLengthM / yesLengthM）
 * - roleOf によるノードの信号・縁石の数え分け
 * - 空・null・undefined 入力で全て 0
 */
import { describe, it, expect } from 'vitest'
import { summarizeBarrierFree } from '../barrierFreeSummary'

// toStandardResults（barrierFreeResults.js）の出力形状を模した標準結果の生成ヘルパ
const way = (id, { tactile = null, lengthM = null, tags = {} } = {}) => ({
  id,
  type: 'way',
  tags,
  lat: 34.67,
  lon: 135.48,
  name: tags.name || null,
  osmId: `way/${id}`,
  bf: { kind: 'way', tactile, lengthM, kerb: null, hasSound: false, hasVibration: false, geometry: [] }
})

const node = (id, { tags = {}, hasSound = false, hasVibration = false } = {}) => ({
  id,
  type: 'node',
  tags,
  lat: 34.67,
  lon: 135.48,
  name: tags.name || null,
  osmId: `node/${id}`,
  bf: { kind: 'node', tactile: null, lengthM: null, kerb: null, hasSound, hasVibration, geometry: [135.48, 34.67] }
})

describe('summarizeBarrierFree: 歩道の tactile 数え分け', () => {
  it('yes / no / 未記録（null）を正しく分類し ways に含める', () => {
    const results = [
      way(1, { tactile: 'yes', tags: { highway: 'footway' } }),
      way(2, { tactile: 'yes', tags: { highway: 'footway' } }),
      way(3, { tactile: 'no', tags: { highway: 'footway' } }),
      way(4, { tactile: null, tags: { highway: 'footway' } }),
      way(5, { tactile: null, tags: { highway: 'path' } })
    ]
    const s = summarizeBarrierFree(results)
    expect(s.ways).toBe(5)
    expect(s.yes).toBe(2)
    expect(s.no).toBe(1)
    expect(s.unknown).toBe(2)
  })

  it('tactile が yes/no/null 以外の値でも未記録（unknown）に含める', () => {
    const results = [
      way(1, { tactile: 'maybe' }),
      way(2, { tactile: undefined }),
      way(3, { tactile: 'yes' })
    ]
    const s = summarizeBarrierFree(results)
    expect(s.ways).toBe(3)
    expect(s.yes).toBe(1)
    expect(s.no).toBe(0)
    expect(s.unknown).toBe(2)
  })

  it('node は歩道の集計に含めない', () => {
    const results = [
      way(1, { tactile: 'yes' }),
      node(2, { tags: { barrier: 'kerb' } }),
      node(3, { hasSound: true })
    ]
    const s = summarizeBarrierFree(results)
    expect(s.ways).toBe(1)
    expect(s.yes).toBe(1)
  })
})

describe('summarizeBarrierFree: 延長の集計', () => {
  it('lengthM が数値の歩道のみ totalLengthM に合計する', () => {
    const results = [
      way(1, { tactile: 'yes', lengthM: 100 }),
      way(2, { tactile: 'no', lengthM: 50 }),
      way(3, { tactile: null, lengthM: 20 }),
      way(4, { tactile: 'yes', lengthM: null })  // 数値で無いので合計しない
    ]
    const s = summarizeBarrierFree(results)
    expect(s.totalLengthM).toBe(170)  // 100 + 50 + 20
    expect(s.yesLengthM).toBe(100)    // tactile 'yes' かつ数値: 100 のみ
  })

  it('tactile が yes の歩道の延長のみ yesLengthM に合計する', () => {
    const results = [
      way(1, { tactile: 'yes', lengthM: 120 }),
      way(2, { tactile: 'yes', lengthM: 80 }),
      way(3, { tactile: 'no', lengthM: 200 }),
      way(4, { tactile: null, lengthM: 300 })
    ]
    const s = summarizeBarrierFree(results)
    expect(s.totalLengthM).toBe(700)   // 120 + 80 + 200 + 300
    expect(s.yesLengthM).toBe(200)     // 120 + 80
  })

  it('lengthM が数値の歩道が無ければ延長は 0', () => {
    const results = [way(1, { tactile: 'yes', lengthM: null })]
    const s = summarizeBarrierFree(results)
    expect(s.totalLengthM).toBe(0)
    expect(s.yesLengthM).toBe(0)
  })
})

describe('summarizeBarrierFree: ノードの信号・縁石（roleOf による内訳）', () => {
  it('signal / kerb+signal を信号に、kerb / kerb+signal を縁石に数える', () => {
    const results = [
      node(1, { hasSound: true }),                                  // signal
      node(2, { hasVibration: true }),                              // signal
      node(3, { tags: { barrier: 'kerb' } }),                       // kerb
      node(4, { tags: { barrier: 'kerb' }, hasSound: true }),       // kerb+signal → 信号・縁石の両方
      node(5, { tags: { traffic_signals: 'yes' } })                 // other → どちらにも含まない
    ]
    const s = summarizeBarrierFree(results)
    expect(s.signals).toBe(3)   // node1(signal) + node2(signal) + node4(kerb+signal)
    expect(s.kerbs).toBe(2)     // node3(kerb) + node4(kerb+signal)
  })

  it('way はノードの信号・縁石の集計に含めない', () => {
    const results = [
      way(1, { tactile: 'yes' }),
      node(2, { hasSound: true })
    ]
    const s = summarizeBarrierFree(results)
    expect(s.signals).toBe(1)
    expect(s.kerbs).toBe(0)
  })
})

describe('summarizeBarrierFree: 空入力・不正入力', () => {
  it('空配列は全て 0 を返す', () => {
    const s = summarizeBarrierFree([])
    expect(s).toEqual({ ways: 0, yes: 0, no: 0, unknown: 0, totalLengthM: 0, yesLengthM: 0, signals: 0, kerbs: 0 })
  })

  it('null / undefined は全て 0 を返す（エラーにならない）', () => {
    const expected = { ways: 0, yes: 0, no: 0, unknown: 0, totalLengthM: 0, yesLengthM: 0, signals: 0, kerbs: 0 }
    expect(summarizeBarrierFree(null)).toEqual(expected)
    expect(summarizeBarrierFree(undefined)).toEqual(expected)
  })

  it('配列で無い値（文字列等）は全て 0 を返す', () => {
    const expected = { ways: 0, yes: 0, no: 0, unknown: 0, totalLengthM: 0, yesLengthM: 0, signals: 0, kerbs: 0 }
    expect(summarizeBarrierFree('oops')).toEqual(expected)
  })

  it('bf フィールドが無い・null の要素は安全にスキップされる', () => {
    const results = [
      { id: 1, type: 'node', tags: { amenity: 'cafe' } },  // bf なし
      { id: 2, type: 'way', tags: {}, bf: null },
      way(3, { tactile: 'yes', lengthM: 40 })
    ]
    const s = summarizeBarrierFree(results)
    expect(s.ways).toBe(1)
    expect(s.yes).toBe(1)
    expect(s.totalLengthM).toBe(40)
  })
})
