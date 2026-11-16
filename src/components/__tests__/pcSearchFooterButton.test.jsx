// @vitest-environment jsdom
/**
 * PCレイアウト（>=1024px）: 検索ボタンの固定フッター配置（モバイル版との統一）
 *
 * 旧PC専用レイアウト（SearchTabContent）は廃止され、PCはモバイルと同じシェル
 * （MobileShell）を中央寄せmax-widthコンテナ内で表示する。検索タブ（MobileSearchTab）の
 * フッター配置契約はモバイル・PC共通になり、本ファイルはPC幅（matches=false）でそれを検証する。
 *
 * 固定する契約:
 * - ボタンはスロールーム（overflow-y-autoのコンテナ）の外・タブ下端の固定フッターにある
 *   （スクロールしても常に視認可能 — P0再発防止）
 * - 固定フッターは「上に境界線・白背景・shrink-0」のバー
 * - fullWidth版（横幅いっぱい・min 48px の大型タップターゲット）が使われている
 * - ラベルは検索ソースで切り替わる: 地図モード「この表示範囲で検索」/
 *   自治体モード「検索する」（モバイル版と同一規則）
 *
 * ボタンの動作（criteria/status/onSearch/onCancel）は SearchActionButton 側の
 * テスト（SearchActionButton.test.jsx）と pcMapSearchButton.test.jsx がカバーするため、
 * ここでは配置・ラベルの検証に専念する。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../../App'

// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return { default: mockState.api }
})

class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver || MockResizeObserver
  if (!window.matchMedia) {
    // matches: false → PC幅（>=1024px）: モバイルシェルをmax-widthコンテナ内で表示
    window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
  if (mockState.api) mockState.api.resetState()
  window.history.replaceState(null, '', '/')

  // municipalities.jsonには妥当なフィクスチャを返す（MunicipalitySearchの
  // data.municipalities 反復が空オブジェクトでクラッシュするのを防ぐ）。
  // それ以外のフェッチは空データで応答（検索実行はしない）。
  const MUNI_DATA = {
    count: 1,
    municipalities: [
      { name: '高槻市', code: '272078', prefecture: '大阪府', prefCode: '27', adminLevel: 8, osmId: 101, bbox: { south: 34.78051, west: 135.55719, north: 34.97667, east: 135.67264 }, displayName: '高槻市' }
    ]
  }
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('municipalities.json')) {
      return { ok: true, json: async () => MUNI_DATA }
    }
    return { ok: true, json: async () => ({}) }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

const IT_TIMEOUT = 15000

/**
 * ボタンから上位をたどって固定フッター（shrink-0 + border-t + bg-white）を特定する。
 * （地図のドラッグハンドルやサイトフッターも shrink-0/border-t を持つため、
 *   ボタンの祖先関係で絞る）
 */
function findFixedFooter(btn) {
  let el = btn.parentElement
  while (el) {
    const cls = typeof el.className === 'string' ? el.className : ''
    if (cls.includes('shrink-0') && cls.includes('border-t') && cls.includes('bg-white')) return el
    el = el.parentElement
  }
  return null
}

// 従来フォーム表示（「くわしく探す」）へ切替する
function openFormView() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
}

describe('PC: 検索ボタンの固定フッター配置（モバイル版との統一）', () => {
  it('フッター（スロールーム外）にfullWidth版の大きな検索ボタンが表示される（地図モード）', async () => {
    render(<App />)
    openFormView()
    fireEvent.click(screen.getByRole('tab', { name: '地図から探す' }))

    const btn = screen.getByRole('button', { name: 'この表示範囲で検索' })

    // fullWidth版: 横幅いっぱい・min 48px の大型タップターゲット
    expect(btn.className).toContain('w-full')
    expect(btn.className).toContain('min-h-[48px]')

    // 固定フッター内（上に境界線・白背景・shrink-0でスクロールしない）
    const footer = findFixedFooter(btn)
    expect(footer).toBeTruthy()
    expect(footer.className).toContain('shrink-0')
    expect(footer.className).toContain('border-t')
    expect(footer.className).toContain('bg-white')

    // スロールーム（overflow-y-autoコンテナ）の外に存在する
    expect(btn.closest('[class*="overflow-y-auto"]')).toBeNull()

    // 地図ロード完了後にボタンが有効化される（押下時点範囲で検索できる）
    await waitFor(() => {
      const b = screen.getByRole('button', { name: 'この表示範囲で検索' })
      expect(b.hasAttribute('disabled')).toBe(false)
    }, { timeout: 5000 })
  }, IT_TIMEOUT)

  it('ラベルは検索ソースで切り替わる: 地図モード「この表示範囲で検索」⇄ 自治体モード「検索する」', async () => {
    render(<App />)

    // 従来フォーム表示へ切替（#66: 既定の初期ソースは自治体モード）
    openFormView()
    // 既定は自治体モード: 「検索する」のみ
    expect(screen.getByRole('button', { name: '検索する' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()

    // 地図モードへ切替 → 「この表示範囲で検索」に切り替わる
    fireEvent.click(screen.getByRole('tab', { name: '地図から探す' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '検索する' })).toBeNull()
    }, { timeout: 5000 })

    // 自治体モードへ戻す → 「検索する」に復帰
    fireEvent.click(screen.getByRole('tab', { name: '自治体から探す' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '検索する' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'この表示範囲で検索' })).toBeNull()
    }, { timeout: 5000 })
  }, IT_TIMEOUT)

  it('自治体モードでも固定フッターは同一構造（fullWidth版・スロールーム外）', async () => {
    render(<App />)

    openFormView()
    // 既定の自治体モードのフッターボタン
    const btn = screen.getByRole('button', { name: '検索する' })

    // fullWidth版: 横幅いっぱい・min 48px の大型タップターゲット
    expect(btn.className).toContain('w-full')
    expect(btn.className).toContain('min-h-[48px]')

    // 固定フッター内（上に境界線・白背景・shrink-0）
    const footer = findFixedFooter(btn)
    expect(footer).toBeTruthy()
    expect(footer.className).toContain('shrink-0')
    expect(footer.className).toContain('border-t')
    expect(footer.className).toContain('bg-white')

    // スロールームの外に存在する
    expect(btn.closest('[class*="overflow-y-auto"]')).toBeNull()
  }, IT_TIMEOUT)
})
