// @vitest-environment jsdom
/**
 * バリアフリー検索 — データの充実度（BarrierFreeSummary）の表示テスト
 *
 * - 歩道（way）が0件のときは非表示（null）
 * - 割合（登録あり%）と内訳（あり/なし/未記録の件数と%）が表示される
 * - 延長行は lengthM が数値の歩道があるときだけ表示される
 */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import BarrierFreeSummary from '../BarrierFreeSummary'

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

afterEach(() => cleanup())

describe('BarrierFreeSummary: 非表示条件', () => {
  it('歩道（way）が0件（ノードのみ）のときは表示しない', () => {
    const { container } = render(<BarrierFreeSummary results={[
      node(1, { tags: { barrier: 'kerb' } }),
      node(2, { hasSound: true })
    ]} />)
    expect(container.firstChild).toBeNull()
  })

  it('空配列・null・undefined でも表示しない', () => {
    expect(render(<BarrierFreeSummary results={[]} />).container.firstChild).toBeNull()
    expect(render(<BarrierFreeSummary results={null} />).container.firstChild).toBeNull()
    expect(render(<BarrierFreeSummary results={undefined} />).container.firstChild).toBeNull()
  })
})

describe('BarrierFreeSummary: 割合と内訳の表示', () => {
  it('歩道があるときは見出し・登録率・内訳（件数と%）が表示される', () => {
    // yes 2 / no 1 / unknown 1 → 登録あり 3 件（60%）
    const results = [
      way(1, { tactile: 'yes' }),
      way(2, { tactile: 'yes' }),
      way(3, { tactile: 'no' }),
      way(4, { tactile: null }),
      node(5, { hasSound: true }),
      node(6, { tags: { barrier: 'kerb' } })
    ]
    render(<BarrierFreeSummary results={results} />)

    expect(screen.getByText('データの充実度（参考）')).toBeTruthy()
    expect(screen.getByText('歩道 4 件のうち点字ブロック登録あり 3 件（75%）')).toBeTruthy()
    // 内訳: あり 2 件（50%）・なし 1 件（25%）・未記録 1 件（25%）
    expect(screen.getByText('あり 2 件（50%）・なし 1 件（25%）・未記録 1 件（25%）')).toBeTruthy()
    // 信号・縁石行: signal 1 件・縁石 1 件
    expect(screen.getByText('音声・振動案内信号 1 件・縁石 1 件')).toBeTruthy()
    // 注記
    expect(screen.getByText(/この範囲で取得したデータだけの集計です/)).toBeTruthy()
  })

  it('割合は整数%に丸める（端数は切り捨て・四捨五入の流儀で丸め）', () => {
    // yes 1 / unknown 2 → 登録あり 1 件（1/3 = 33.3% → 33%）
    const results = [way(1, { tactile: 'yes' }), way(2, { tactile: null }), way(3, { tactile: null })]
    render(<BarrierFreeSummary results={results} />)
    expect(screen.getByText('歩道 3 件のうち点字ブロック登録あり 1 件（33%）')).toBeTruthy()
  })
})

describe('BarrierFreeSummary: 延長行の有無', () => {
  it('lengthM が数値の歩道があるときは延長行を表示する（m 表示）', () => {
    // yesLengthM = 150（way1 150 + way2 0? いや way2 は yes だが lengthM あり 50 → 合計 200）
    const results = [
      way(1, { tactile: 'yes', lengthM: 150 }),
      way(2, { tactile: 'yes', lengthM: 50 }),
      way(3, { tactile: 'no', lengthM: 200 })
    ]
    render(<BarrierFreeSummary results={results} />)
    // totalLengthM = 400, yesLengthM = 200 → 200/400 = 50%
    expect(screen.getByText('点字ブロックありの延長: 約200 m（歩道全体の 50%）')).toBeTruthy()
  })

  it('延長が 1000 m 以上なら km 換算で表示する', () => {
    const results = [
      way(1, { tactile: 'yes', lengthM: 1500 }),
      way(2, { tactile: 'yes', lengthM: 1000 })
    ]
    render(<BarrierFreeSummary results={results} />)
    // yesLengthM = 2500 → 約2.5 km（totalLengthM = 2500 → 100%）
    expect(screen.getByText('点字ブロックありの延長: 約2.5 km（歩道全体の 100%）')).toBeTruthy()
  })

  it('lengthM が数値の歩道が無ければ延長行を表示しない', () => {
    const results = [
      way(1, { tactile: 'yes', lengthM: null }),
      way(2, { tactile: 'no', lengthM: null })
    ]
    render(<BarrierFreeSummary results={results} />)
    expect(screen.queryByText(/点字ブロックありの延長/)).toBeNull()
  })
})

describe('BarrierFreeSummary: 積み上げ横バー', () => {
  it('内訳に色付きのバー（凡例・地図と同色）を含む', () => {
    const results = [
      way(1, { tactile: 'yes' }),
      way(2, { tactile: 'no' }),
      way(3, { tactile: null })
    ]
    const { container } = render(<BarrierFreeSummary results={results} />)
    // バーは role="img" で内訳を説明する
    expect(screen.getByRole('img', { name: /点字ブロックの内訳/ })).toBeTruthy()
    // 3色（yes/no/unknown）の区画が描画される（幅比 1/3 ずつ）
    const bar = screen.getByRole('img', { name: /点字ブロックの内訳/ })
    const segments = bar.querySelectorAll('div')
    expect(segments).toHaveLength(3)
    // jsdom は背景色を hex から rgb() に正規化して返す（#16a34a → rgb(22, 163, 74) など）
    const colors = [...segments].map((el) => el.style.backgroundColor)
    expect(colors[0]).toBe('rgb(22, 163, 74)')   // yes: 緑 (#16a34a)
    expect(colors[1]).toBe('rgb(220, 38, 38)')   // no: 濃い赤 (#dc2626)
    expect(colors[2]).toBe('rgb(71, 85, 105)') // unknown: 濃いグレー (#475569)
  })

  it('該当が0件の区画は描画しない', () => {
    const results = [way(1, { tactile: 'yes' }), way(2, { tactile: 'yes' })]
    render(<BarrierFreeSummary results={results} />)
    const bar = screen.getByRole('img', { name: /点字ブロックの内訳/ })
    // yes のみなので区画は1つ
    expect(bar.querySelectorAll('div')).toHaveLength(1)
  })
})
