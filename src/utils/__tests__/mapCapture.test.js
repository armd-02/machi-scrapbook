// @vitest-environment jsdom
/**
 * mapCapture のテスト
 * - tilePlan（純粋関数）: 中心タイル・枚数・オフセットの妥当性
 * - captureMapImage: 不正な座標では null（canvas に触れない）
 */
import { describe, it, expect, vi } from 'vitest'
import { tilePlan, captureMapImage } from '../mapCapture'

describe('tilePlan', () => {
  it('大阪・梅田: タイルは最大4枚（2列×2行）、施設位置（窓の中心）を含むタイルがある', () => {
    const plan = tilePlan(34.702, 135.496)
    expect(plan.tiles.length).toBeGreaterThanOrEqual(1)
    expect(plan.tiles.length).toBeLessThanOrEqual(4)
    expect(plan.centerX).toBe(120)
    expect(plan.centerY).toBe(120)
    const coversCenter = plan.tiles.some(
      (t) => t.dx <= plan.centerX && plan.centerX < t.dx + 256 && t.dy <= plan.centerY && plan.centerY < t.dy + 256,
    )
    expect(coversCenter).toBe(true)
  })

  it('タイル番号はズーム16の範囲内', () => {
    const plan = tilePlan(34.702, 135.496)
    for (const t of plan.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x).toBeLessThan(65536)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeLessThan(65536)
    }
  })

  it('窓の左上付近のタイルはオフセットが負になりうる（中心合わせのため）', () => {
    const plan = tilePlan(34.702, 135.496)
    const minDx = Math.min(...plan.tiles.map((t) => t.dx))
    const minDy = Math.min(...plan.tiles.map((t) => t.dy))
    expect(minDx).toBeLessThanOrEqual(0)
    expect(minDy).toBeLessThanOrEqual(0)
  })
})

describe('captureMapImage', () => {
  it('指定されたズームのタイル座標とURLを使う', async () => {
    const requested = []
    vi.stubGlobal('Image', class {
      set src(url) {
        requested.push(url)
        this.onerror()
      }
    })
    try {
      await captureMapImage(34.85, 135.5, 17)
      expect(requested).toEqual(tilePlan(34.85, 135.5, 17).tiles.map(
        ({ x, y }) => `https://tile.openstreetmap.jp/17/${x}/${y}.png`,
      ))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('座標が数値でない場合は null', async () => {
    expect(await captureMapImage(null, 135.5)).toBeNull()
    expect(await captureMapImage(34.7, undefined)).toBeNull()
    expect(await captureMapImage(NaN, 135.5)).toBeNull()
  })
})
