/**
 * (ピースG1) CMM Activity → 公開マップ表示アイテムの変換テスト
 *
 * publicMapItems.js（osmidToTypeAndId / activityToMapItem）の単体テスト。
 * ネットワーク・DOM は使わない。
 */
import { describe, it, expect } from 'vitest'
import { osmidToTypeAndId, activityToMapItem } from '../publicMapItems'

describe('osmidToTypeAndId', () => {
  it('node/way/relation の osmid を分割する', () => {
    expect(osmidToTypeAndId('node/100')).toEqual({ type: 'node', id: 100 })
    expect(osmidToTypeAndId('way/200')).toEqual({ type: 'way', id: 200 })
    expect(osmidToTypeAndId('relation/300')).toEqual({ type: 'relation', id: 300 })
  })

  it('不正な形式は null を返す', () => {
    expect(osmidToTypeAndId(null)).toBeNull()
    expect(osmidToTypeAndId(undefined)).toBeNull()
    expect(osmidToTypeAndId(123)).toBeNull()
    expect(osmidToTypeAndId('node')).toBeNull()
    expect(osmidToTypeAndId('/100')).toBeNull()
    expect(osmidToTypeAndId('node/')).toBeNull()
    expect(osmidToTypeAndId('building/100')).toBeNull()
    expect(osmidToTypeAndId('node/0')).toBeNull()
    expect(osmidToTypeAndId('node/-5')).toBeNull()
    expect(osmidToTypeAndId('node/abc')).toBeNull()
    expect(osmidToTypeAndId('node/1.5')).toBeNull()
  })
})

describe('activityToMapItem', () => {
  const base = {
    osmid: 'node/1001',
    name: 'テスト珈琲店',
    latitude: 34.85,
    longitude: 135.5,
    tags: JSON.stringify({ amenity: 'cafe', name: 'テスト珈琲店' }),
    memo: '静かなお店',
    rating: '4',
    book: 'お気に入り',
  }

  it('Activity を表示アイテムに変換する', () => {
    expect(activityToMapItem(base)).toEqual({
      type: 'node',
      id: 1001,
      name: 'テスト珈琲店',
      lat: 34.85,
      lon: 135.5,
      tags: { amenity: 'cafe', name: 'テスト珈琲店' },
      memo: '静かなお店',
      rating: 4,
      book: 'お気に入り',
    })
  })

  it('osmid が不正だと null を返す', () => {
    expect(activityToMapItem({ ...base, osmid: 'building/1' })).toBeNull()
    expect(activityToMapItem({ name: 'osmid なし' })).toBeNull()
    expect(activityToMapItem(null)).toBeNull()
  })

  it('座標が欠落している場合 lat/lon は null（カードは出る・ピンは出ない）', () => {
    const item = activityToMapItem(base)
    expect(item.lat).toBe(34.85)
    expect(item.lon).toBe(135.5)
    const item2 = activityToMapItem({ ...base, latitude: undefined, longitude: undefined })
    expect(item2.lat).toBeNull()
    expect(item2.lon).toBeNull()
    // 片方だけの欠落も null
    const item3 = activityToMapItem({ ...base, longitude: '135.5' })
    expect(item3.lon).toBeNull()
  })

  it('tags の JSON 文字列をオブジェクトに解析する', () => {
    const item = activityToMapItem({ ...base, tags: '{"amenity":"cafe"}' })
    expect(item.tags).toEqual({ amenity: 'cafe' })
  })

  it('tags が無効JSON・欠落・空オブジェクトの場合は null', () => {
    expect(activityToMapItem({ ...base, tags: 'not-json' }).tags).toBeNull()
    expect(activityToMapItem({ ...base, tags: undefined }).tags).toBeNull()
    expect(activityToMapItem({ ...base, tags: '{}' }).tags).toBeNull()
    expect(activityToMapItem({ ...base, tags: '["array"]' }).tags).toBeNull()
  })

  it('rating を正規化する（範囲外・不正 → 0）', () => {
    expect(activityToMapItem({ ...base, rating: '4' }).rating).toBe(4)
    expect(activityToMapItem({ ...base, rating: 4 }).rating).toBe(4)
    expect(activityToMapItem({ ...base, rating: '9' }).rating).toBe(0)
    expect(activityToMapItem({ ...base, rating: '0' }).rating).toBe(0)
    expect(activityToMapItem({ ...base, rating: 'abc' }).rating).toBe(0)
    expect(activityToMapItem({ ...base, rating: null }).rating).toBe(0)
  })

  it('name/memo/book を正規化する（欠落・空 → null / 空文字）', () => {
    const item = activityToMapItem({ ...base, name: undefined, memo: undefined, book: '' })
    expect(item.name).toBeNull()
    expect(item.memo).toBe('')
    expect(item.book).toBeNull()
  })

  it('名前センチネル「名称なし」はそのまま渡す（表示側で種別名に置き換わる）', () => {
    const item = activityToMapItem({ ...base, name: '名称なし' })
    expect(item.name).toBe('名称なし')
  })
})
