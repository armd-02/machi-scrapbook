// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QuickTopTiles, QUICK_TILES } from '../MobileQuickTop'
import { CATEGORY_GROUPS } from '../../../data/categories'

// CATEGORY_GROUPS からタイルを組み立てたとき预期される形（実装と同一のマッピング）
const expectedTile = (group) => ({ id: group.name, label: group.name, icon: group.icon, purpose: group.name })

afterEach(cleanup)

describe('QUICK_TILES: タイルデータ', () => {
  it('タイルはすべて目的（purpose）ベースで、単一カテゴリのタイルは存在しない', () => {
    for (const tile of QUICK_TILES) {
      expect(tile.purpose).toBeTruthy()
      expect(tile.category).toBeUndefined()
    }
  })

  it('QUICK_TILES は CATEGORY_GROUPS から組み立てられている（定義を変えたらタイルも追随する）', () => {
    // 全グループを、定義順・ラベル・アイコン・purpose ごとに対比
    const expected = CATEGORY_GROUPS.map(expectedTile)
    expect(QUICK_TILES).toEqual(expected)
  })

  it('タイルの表示順・ラベル・アイコンは CATEGORY_GROUPS と同一（全10種別）', () => {
    expect(QUICK_TILES.map((t) => t.label)).toEqual([
      '食べる', '買う', '遊ぶ・公園', '学ぶ',
      '病院・薬局', '役所・手続き', '公共設備', '会社・事務所', '移動・交通', 'バリアフリー'
    ])
    for (const tile of QUICK_TILES) {
      const group = CATEGORY_GROUPS.find((g) => g.name === tile.purpose)
      expect(group).toBeTruthy()
      expect(group.name).toBe(tile.label) // purposeはグループ名そのもの
      expect(tile.icon).toBe(group.icon) // アイコンもグループと同一
    }
  })

  it('新規タイル: 公共設備（🚻）・会社・事務所（🏢）・移動・交通（🚉）が生活の施設系に並ぶ', () => {
    const byLabel = (label) => QUICK_TILES.find((t) => t.label === label)
    expect(byLabel('公共設備').icon).toBe('🚻')
    expect(byLabel('公共設備').purpose).toBe('公共設備')
    expect(byLabel('会社・事務所').icon).toBe('🏢')
    expect(byLabel('会社・事務所').purpose).toBe('会社・事務所')
    expect(byLabel('移動・交通').icon).toBe('🚉')
    expect(byLabel('移動・交通').purpose).toBe('移動・交通')
    // 単一カテゴリ由来の旧タイル（泊まる・駅・交通・トイレ）は廃止
    for (const label of ['泊まる', '駅・交通', 'トイレ']) {
      expect(byLabel(label)).toBeUndefined()
    }
  })

  it('各タイルは id が一意で、purpose と category をちょうど片方だけ持つ', () => {
    const ids = QUICK_TILES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const tile of QUICK_TILES) {
      const hasPurpose = tile.purpose !== undefined
      const hasCategory = tile.category !== undefined
      expect(hasPurpose !== hasCategory).toBe(true)
    }
  })

  it('バリアフリーは QUICK_TILES に含まれ、「移動・交通」の直後（右隣）に配置される', () => {
    const labels = QUICK_TILES.map((t) => t.label)
    const transportIdx = labels.indexOf('移動・交通')
    const bfIdx = labels.indexOf('バリアフリー')
    expect(bfIdx).toBe(transportIdx + 1)
    const bfTile = QUICK_TILES[bfIdx]
    expect(bfTile).toEqual(expectedTile(
      CATEGORY_GROUPS.find((g) => g.name === 'バリアフリー')
    ))
  })
})

describe('QuickTopTiles: 描画', () => {
  it('バリアフリーは通常のタイルとしてグリッド内に表示され（「移動・交通」の右隣）、タップで onTileTap が呼ばれる', () => {
    const onTileTap = vi.fn()
    const { container } = render(<QuickTopTiles onTileTap={onTileTap} onSearch={vi.fn()} />)
    const grid = container.querySelector('div.grid')
    const bf = screen.getByRole('button', { name: 'バリアフリー' })
    // グリッド内に位置する
    expect(grid.contains(bf)).toBe(true)
    // 他のタイルと同じスタイル（アイコン＋ラベル・min-h-[64px]）
    expect(bf.className).toContain('min-h-[64px]')
    expect(bf.className).toContain('border-slate-200')
    // タップで onTileTap が呼ばれる（他のタイルと同じ処理）
    const bfTile = QUICK_TILES.find((t) => t.label === 'バリアフリー')
    fireEvent.click(bf)
    expect(onTileTap).toHaveBeenCalledWith(bfTile)
  })

  it('バリアフリータイルの選択状態は aria-pressed で表現される', () => {
    render(<QuickTopTiles onTileTap={vi.fn()} onSearch={vi.fn()} selectedTileId="バリアフリー" />)
    const bf = screen.getByRole('button', { name: 'バリアフリー' })
    expect(bf.getAttribute('aria-pressed')).toBe('true')
    // 選択中はプライマリの枠線・背景になる
    expect(bf.className).toContain('border-primary-600')
    expect(bf.className).toContain('bg-primary-50')
  })
})
