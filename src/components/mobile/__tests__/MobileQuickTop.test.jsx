// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QuickTopTiles, QUICK_TILES, BARRIER_FREE_TILE } from '../MobileQuickTop'
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
    // バリアフリーを除いた全グループを、定義順・ラベル・アイコン・purpose ごとに対比
    const expected = CATEGORY_GROUPS
      .filter((g) => g.name !== 'バリアフリー')
      .map(expectedTile)
    expect(QUICK_TILES).toEqual(expected)
  })

  it('タイルの表示順・ラベル・アイコンは CATEGORY_GROUPS と同一（10種別のうちバリアフリーを除く9種）', () => {
    expect(QUICK_TILES.map((t) => t.label)).toEqual([
      '食べる', '買う', '遊ぶ・公園', '学ぶ',
      '病院・薬局', '役所・手続き', '公共施設', '会社・事務所', '移動・交通'
    ])
    for (const tile of QUICK_TILES) {
      const group = CATEGORY_GROUPS.find((g) => g.name === tile.purpose)
      expect(group).toBeTruthy()
      expect(group.name).toBe(tile.label) // purposeはグループ名そのもの
      expect(tile.icon).toBe(group.icon) // アイコンもグループと同一
    }
  })

  it('新規タイル: 公共施設（🚻）・会社・事務所（🏢）・移動・交通（🚉）が生活の施設系に並ぶ', () => {
    const byLabel = (label) => QUICK_TILES.find((t) => t.label === label)
    expect(byLabel('公共施設').icon).toBe('🚻')
    expect(byLabel('公共施設').purpose).toBe('公共施設')
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

  it('バリアフリーは QUICK_TILES から外され、BARRIER_FREE_TILE（グリッド下の全幅特別枠）として分離される', () => {
    expect(QUICK_TILES.find((t) => t.purpose === 'バリアフリー')).toBeUndefined()
    expect(BARRIER_FREE_TILE).toEqual(expectedTile(
      CATEGORY_GROUPS.find((g) => g.name === 'バリアフリー')
    ))
  })
})

describe('QuickTopTiles: 描画', () => {
  it('バリアフリーはタイルグリッドの外に、グリッドの下に横長（全幅）特別枠として表示される', () => {
    const onTileTap = vi.fn()
    const { container } = render(<QuickTopTiles onTileTap={onTileTap} onSearch={vi.fn()} />)
    const grid = container.querySelector('div.grid')
    const bf = screen.getByRole('button', { name: 'バリアフリー' })
    // グリッドの外・グリッドの後に位置する
    expect(grid.contains(bf)).toBe(false)
    expect(grid.compareDocumentPosition(bf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 全幅の特別枠。枠線は他のタイルと同一（実線）に統一されている
    expect(bf.className).toContain('w-full')
    expect(bf.className).not.toContain('border-dashed')
    expect(bf.className).toContain('border-slate-200')
    // タップで onTileTap(BARRIER_FREE_TILE) が呼ばれる（他のタイルと同じ処理）
    fireEvent.click(bf)
    expect(onTileTap).toHaveBeenCalledWith(BARRIER_FREE_TILE)
  })

  it('バリアフリー特別枠の選択状態は aria-pressed で表現される', () => {
    render(<QuickTopTiles onTileTap={vi.fn()} onSearch={vi.fn()} selectedTileId="バリアフリー" />)
    expect(screen.getByRole('button', { name: 'バリアフリー' }).getAttribute('aria-pressed')).toBe('true')
    // 選択中は破線枠ではなく実線のプライマリ枠になる
    const bf = screen.getByRole('button', { name: 'バリアフリー' })
    expect(bf.className).not.toContain('border-dashed')
  })
})
