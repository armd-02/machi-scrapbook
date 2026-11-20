// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QuickTopTiles, QUICK_TILES, BARRIER_FREE_TILE } from '../MobileQuickTop'

afterEach(cleanup)

describe('QUICK_TILES: タイルデータ', () => {
  it('会社・事務所タイル: company_office の単一カテゴリ検索（🏢）', () => {
    const tile = QUICK_TILES.find((t) => t.label === '会社・事務所')
    expect(tile).toBeTruthy()
    expect(tile.category).toBe('company_office')
    expect(tile.icon).toBe('🏢')
    expect(tile.purpose).toBeUndefined()
  })

  it('タイルの表示順: 「すること」系（食べる・買う・遊ぶ・公園・学ぶ・泊まる）→「生活の施設」系（病院・薬局・役所・手続き・会社・事務所・駅・交通・トイレ）', () => {
    expect(QUICK_TILES.map((t) => t.label)).toEqual([
      '食べる', '買う', '遊ぶ・公園', '学ぶ', '泊まる',
      '病院・薬局', '役所・手続き', '会社・事務所', '駅・交通', 'トイレ'
    ])
  })

  it('会社・事務所タイルの位置: 役所・手続きの直後（生活の施設系の並び）', () => {
    const labels = QUICK_TILES.map((t) => t.label)
    expect(labels.indexOf('会社・事務所') - labels.indexOf('役所・手続き')).toBe(1)
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
    expect(BARRIER_FREE_TILE).toEqual({
      id: 'barrierFree',
      label: 'バリアフリー',
      icon: '♿',
      purpose: 'バリアフリー'
    })
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
    render(<QuickTopTiles onTileTap={vi.fn()} onSearch={vi.fn()} selectedTileId="barrierFree" />)
    expect(screen.getByRole('button', { name: 'バリアフリー' }).getAttribute('aria-pressed')).toBe('true')
    // 選択中は破線枠ではなく実線のプライマリ枠になる
    const bf = screen.getByRole('button', { name: 'バリアフリー' })
    expect(bf.className).not.toContain('border-dashed')
  })
})
