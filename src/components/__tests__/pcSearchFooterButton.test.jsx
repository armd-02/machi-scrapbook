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
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
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

  it('(#xx) フォームは常に地図モード: フッターラベルは「この表示範囲で検索」、ソース切替タブは撤去済み', async () => {
    render(<App />)

    // (#xx) フォームは常に地図モード（「自治体から探す」タブ・フォーム内蔵
    // MunicipalitySearch を撤去）。フッターボタンは常に地図モードラベル
    openFormView()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'この表示範囲で検索' })).toBeTruthy()
    }, { timeout: 5000 })
    expect(screen.queryByRole('tab', { name: '地図から探す' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '自治体から探す' })).toBeNull()
  }, IT_TIMEOUT)

  it('(#xx) 自治体検索ボタン「検索する」はトップの「都道府県から探す」セクション内に配置（固定フッターではない）', async () => {
    render(<App />)

    // トップ画面の「都道府県から探す」セクションを開く
    fireEvent.click(screen.getByRole('button', { name: /都道府県から探す/ }))
    const sec = screen.getByRole('region', { name: '都道府県から探す' })

    // セクション内の「検索する」ボタン（fullWidth版のタップターゲット）
    const btn = within(sec).getByRole('button', { name: '検索する' })
    expect(btn.className).toContain('w-full')
    expect(btn.className).toContain('min-h-[44px]')

    // スロールーム内（固定フッターではない）
    expect(btn.closest('[class*="overflow-y-auto"]')).toBeTruthy()
    expect(findFixedFooter(btn)).toBeNull()
  }, IT_TIMEOUT)
})
