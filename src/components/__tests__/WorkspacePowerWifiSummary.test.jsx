// @vitest-environment jsdom
/**
 * (作業スペース系 電源・Wi-Fi) WorkspacePowerWifiSummary:
 * - 「⚡ 電源あり a件（x%）」「📶 Wi-Fi あり b件（y%）」が表示される
 * - 母数（対象施設数）は title と aria-label に載る
 * - 対象施設が0件（・空配列）のときは何も表示しない
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import WorkspacePowerWifiSummary from '../WorkspacePowerWifiSummary'

const mk = (id, tags) => ({ type: 'node', id, tags })

afterEach(() => cleanup())

describe('WorkspacePowerWifiSummary', () => {
  it('「電源あり a件（x%）」「Wi-Fi あり b件（y%）」が表示される（母数は対象施設のみ）', () => {
    render(
      <WorkspacePowerWifiSummary
        results={[
          mk(1, { amenity: 'cafe', internet_access: 'wlan', socket: 'yes' }),
          mk(2, { amenity: 'cafe', internet_access: 'no' }),
          mk(3, { amenity: 'library' }),
          mk(4, { amenity: 'restaurant', internet_access: 'wlan' }), // 対象外
        ]}
      />
    )
    // 母数=対象3件: 電源あり1件（33%）・Wi-Fiあり1件（33%）
    expect(screen.getByText('⚡ 電源あり 1件（33%）')).toBeTruthy()
    expect(screen.getByText('📶 Wi-Fi あり 1件（33%）')).toBeTruthy()
  })

  it('母数は表示テキストではなく title と aria-label に入る', () => {
    render(
      <WorkspacePowerWifiSummary
        results={[
          mk(1, { amenity: 'cafe', internet_access: 'wlan' }),
          mk(2, { amenity: 'cafe' }),
        ]}
      />
    )
    const power = screen.getByText('⚡ 電源あり 0件（0%）')
    expect(power.getAttribute('title')).toBe('電源: 0%（0/2件）が登録あり')
    const wifi = screen.getByText('📶 Wi-Fi あり 1件（50%）')
    expect(wifi.getAttribute('title')).toBe('Wi-Fi: 50%（1/2件）が登録あり')
    const box = power.closest('div[aria-label]')
    expect(box.getAttribute('aria-label')).toBe('作業スペース系 2件の電源・Wi-Fi集計')
  })

  it('対象施設が0件のときは何も表示しない（null）', () => {
    const { container } = render(
      <WorkspacePowerWifiSummary results={[mk(1, { amenity: 'restaurant' })]} />
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText(/電源あり \d+件/)).toBeNull()
    expect(screen.queryByText(/Wi-Fi あり \d+件/)).toBeNull()
  })

  it('空配列・null でも何も表示しない', () => {
    const { container } = render(<WorkspacePowerWifiSummary results={[]} />)
    expect(container.firstChild).toBeNull()
    cleanup()
    const r2 = render(<WorkspacePowerWifiSummary results={null} />)
    expect(r2.container.firstChild).toBeNull()
  })
})
