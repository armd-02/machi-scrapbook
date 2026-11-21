/**
 * resultSort.js のユニットテスト
 *
 * sortResultsDefault（検索結果のデフォルト並び）:
 * - 名前のある施設を先に、名前のない施設（（名称不明））を後にする
 * - 同じグループの中では bbox 中心から近い順
 * - 座標を持たない結果はそのグループの最後に置く
 * - bbox が無い・不正なら元の順を保持
 * - 元配列を変更しない（新しい配列を返す）
 */
import { describe, it, expect } from 'vitest'
import { sortResultsDefault } from '../resultSort'

const BBOX = { south: 34.7, west: 135.5, north: 34.72, east: 135.52 }
// bbox 中心 = (34.71, 135.51)

const named = (id, name, lat, lon) => ({
  type: 'node',
  id,
  lat,
  lon,
  name,
  tags: { amenity: 'cafe', name }
})
const unnamed = (id, lat, lon) => ({
  type: 'way',
  id,
  lat,
  lon,
  tags: { highway: 'footway' }
})

describe('sortResultsDefault', () => {
  it('名前のない施設を名前のある施設より後にする', () => {
    const results = [
      unnamed(1, 34.701, 135.501), // 中心に近いが名前のない施設
      named(2, '安満遺跡公園', 34.718, 135.515),
      unnamed(3, 34.719, 135.516)
    ]
    const out = sortResultsDefault(results, BBOX)
    // 名なしグループ内でも距離順: id3（約1.14km）< id1（約1.29km）
    expect(out.map((r) => r.id)).toEqual([2, 3, 1])
  })

  it('名前あり同士では bbox 中心に近い方が先に来る', () => {
    const results = [
      named(1, '遠いカフェ', 34.719, 135.519), // 中心から遠い
      named(2, '近いカフェ', 34.71, 135.51) // 中心に近い
    ]
    const out = sortResultsDefault(results, BBOX)
    expect(out.map((r) => r.id)).toEqual([2, 1])
  })

  it('名前のない同士でも中心に近い方が先に来る（グループ内の距離順）', () => {
    const results = [
      unnamed(1, 34.719, 135.519), // 遠い
      unnamed(2, 34.71, 135.51) // 近い
    ]
    const out = sortResultsDefault(results, BBOX)
    expect(out.map((r) => r.id)).toEqual([2, 1])
  })

  it('座標を持たない結果はそのグループの最後に置く', () => {
    const noCoordNamed = { type: 'relation', id: 1, lat: null, lon: null, name: '名前ありだが座標なし', tags: { name: '名前ありだが座標なし' } }
    const results = [
      noCoordNamed,
      named(2, '近いカフェ', 34.71, 135.51),
      named(3, '遠いカフェ', 34.719, 135.519)
    ]
    const out = sortResultsDefault(results, BBOX)
    expect(out.map((r) => r.id)).toEqual([2, 3, 1])
  })

  it('座標なし同士は元の順を維持する（安定ソート）', () => {
    const mk = (id, name) => ({ type: 'node', id, lat: null, lon: null, name, tags: { name } })
    const out = sortResultsDefault([mk(1, 'A'), mk(2, 'B')], BBOX)
    expect(out.map((r) => r.id)).toEqual([1, 2])
  })

  it('name:ja のみの施設も「名前あり」扱いする', () => {
    const jaOnly = { type: 'node', id: 1, lat: 34.71, lon: 135.51, tags: { amenity: 'cafe', 'name:ja': '日本語名' } }
    const results = [unnamed(2, 34.719, 135.519), jaOnly]
    const out = sortResultsDefault(results, BBOX)
    expect(out.map((r) => r.id)).toEqual([1, 2])
  })

  it('データ側のセンチネル（名称なし）は名前のない扱いにする', () => {
    const sentinel = { type: 'node', id: 1, lat: 34.71, lon: 135.51, name: '名称なし', tags: { amenity: 'cafe', name: '名称なし' } }
    const results = [sentinel, named(2, 'カフェ', 34.719, 135.519)]
    const out = sortResultsDefault(results, BBOX)
    expect(out.map((r) => r.id)).toEqual([2, 1])
  })

  it('bbox が無い・不正な場合は元の順を保持する', () => {
    const results = [unnamed(1, 34.719, 135.519), named(2, 'カフェ', 34.71, 135.51)]
    expect(sortResultsDefault(results, null).map((r) => r.id)).toEqual([1, 2])
    expect(sortResultsDefault(results, { south: 'x' }).map((r) => r.id)).toEqual([1, 2])
  })

  it('空配列・単一要素・非配列はそのまま返す', () => {
    expect(sortResultsDefault([], BBOX)).toEqual([])
    const single = [named(1, 'カフェ', 34.71, 135.51)]
    expect(sortResultsDefault(single, BBOX)).toEqual(single)
    expect(sortResultsDefault(null, BBOX)).toEqual([])
  })

  it('元配列を変更しない（新しい配列を返す）', () => {
    const results = [unnamed(1, 34.719, 135.519), named(2, 'カフェ', 34.71, 135.51)]
    const before = results.map((r) => r.id)
    sortResultsDefault(results, BBOX)
    expect(results.map((r) => r.id)).toEqual(before)
  })
})
