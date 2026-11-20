// @vitest-environment jsdom
/**
 * (#80) 画面 ↔ URL同期（ブックマーク・戻る／進む）の統合テスト
 *
 * - 各画面（トップ / くわしく探す / 一覧 / メモ帳 / その他）が view パラメータで
 *   区別され、画面切替でURLが追従する（pushState）
 * - view パラメータ付きURLを直接開くと対応する画面が表示される
 * - 戻る／進む（popstate）で画面を行き来できる
 * - 検索条件パラメータとの共存
 * - PC 2ペインレイアウトとの共存（'memo' は PC では 'top' のエイリアス）
 *
 * MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import App from '../../App'

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return { default: mockState.api }
})

// ===== matchMedia スタブ =====
let mediaMatches = true
function setupMatchMedia() {
  window.matchMedia = (query) => ({
    matches: mediaMatches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

// ===== fetch モック（本ファイルのテストでは検索実行しない） =====
function setupFetchMock() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: false,
    status: 404,
    headers: new Map(),
    json: async () => ({}),
  }))
}

// ===== ヘルパー =====
function renderApp(query = '') {
  window.history.replaceState(null, '', query ? `?${query}` : '/')
  render(<App />)
}

function viewParam() {
  return new URLSearchParams(window.location.search).get('view')
}

// 「くわしく探す」でフォームビューへ
function openFormView() {
  fireEvent.click(screen.getByRole('button', { name: /くわしく探す/ }))
}

// 下部ナビ（モバイルナビゲーション）のタブをクリック
function navClick(label) {
  const nav = screen.getByRole('navigation', { name: 'モバイルナビゲーション' })
  fireEvent.click(within(nav).getByRole('button', { name: label }))
}

// 戻る／進むのシミュレーション: 履歴エントリのURLへ移動し popstate を送出する。
// （jsdom の history.back() は実ブラウザと挙動が異なることがあるため直接シミュレート）
function popTo(url) {
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }))
}

const IT_TIMEOUT = 15000

beforeEach(() => {
  setupMatchMedia()
  if (mockState.api) mockState.api.resetState()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  setupFetchMock()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

// ======================================================================
// モバイル
// ======================================================================
describe('(#80) モバイル: 画面 ↔ URL同期', () => {
  beforeEach(() => {
    mediaMatches = true
    setupMatchMedia()
  })

  it('初期表示はトップ画面で、URLにviewパラメータはない', () => {
    renderApp()
    expect(viewParam()).toBeNull()
    // トップ画面（一般向けトップ）が表示されている
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
  })

  it('「くわしく探す」でフォームを開くとURLは view=form になる', async () => {
    renderApp()
    openFormView()
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })
    // フーム表示: 検索実行ボタンが在席
    expect(screen.getByRole('button', { name: /この.*範囲で検索/ })).toBeTruthy()
  })

  it('下部ナビでの画面切替にURLが追従する（form→memo→list→search）', async () => {
    renderApp()
    openFormView()
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })

    navClick('メモ帳')
    await waitFor(() => expect(viewParam()).toBe('memo'), { timeout: IT_TIMEOUT })
    expect(screen.getByRole('heading', { name: 'まちメモ帳' })).toBeTruthy()

    navClick('一覧')
    await waitFor(() => expect(viewParam()).toBe('list'), { timeout: IT_TIMEOUT })
    expect(screen.getByText(/検索を実行すると、結果がこの一覧に表示されます/)).toBeTruthy()

    // 検索タブへ戻ると、直前のフォーム表示（searchView='form'）が引き継がれる
    navClick('検索')
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })
    expect(screen.getByRole('button', { name: /この.*範囲で検索/ })).toBeTruthy()
  })

  it('ヘッダーの「トップ画面に戻る」でトップへ戻り、viewがURLから消える', async () => {
    renderApp()
    openFormView()
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })

    fireEvent.click(screen.getByRole('button', { name: 'トップ画面に戻る' }))
    await waitFor(() => expect(viewParam()).toBeNull(), { timeout: IT_TIMEOUT })
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
  })

  it('viewパラメータ付きURLを直接開くと対応する画面が表示される', async () => {
    for (const [view, check] of [
      ['form', () => screen.getByRole('button', { name: /この.*範囲で検索/ })],
      ['memo', () => screen.getByRole('heading', { name: 'まちメモ帳' })],
      ['list', () => screen.getByText(/検索を実行すると、結果がこの一覧に表示されます/)],
      ['other', () => screen.getByRole('tablist', { name: 'その他の機能' })],
    ]) {
      cleanup()
      renderApp(`view=${view}`)
      await waitFor(check, { timeout: IT_TIMEOUT })
      // URLは書き換えられない
      expect(viewParam()).toBe(view)
    }
  })

  it('戻る／進むで画面を行き来できる（popstate → 画面復元、URLは書き換えない）', async () => {
    renderApp()
    openFormView()
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })
    navClick('メモ帳')
    await waitFor(() => expect(viewParam()).toBe('memo'), { timeout: IT_TIMEOUT })

    // back → エントリ0（view なし＝トップ）
    popTo('/')
    await waitFor(() => expect(viewParam()).toBeNull(), { timeout: IT_TIMEOUT })
    await waitFor(() => expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy(), { timeout: IT_TIMEOUT })

    // forward → ?view=memo（メモ帳）
    popTo('/?view=memo')
    await waitFor(() => expect(viewParam()).toBe('memo'), { timeout: IT_TIMEOUT })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'まちメモ帳' })).toBeTruthy(), { timeout: IT_TIMEOUT })
  })
})

// ======================================================================
// PC（2ペイン）
// ======================================================================
describe('(#80) PC: 画面 ↔ URL同期（2ペイン）', () => {
  beforeEach(() => {
    mediaMatches = false
    setupMatchMedia()
  })

  // 右ペインの表示中かどうか（hidden 属性）
  function rightPaneVisible(testid) {
    const el = document.querySelector(`[data-testid="${testid}"]`)
    return el && !el.hidden
  }

  it('初期表示は2ペイン（左:トップ / 右:メモ帳）で、URLにviewパラメータはない', async () => {
    renderApp()
    expect(viewParam()).toBeNull()
    // 左ペイン: 一般トップ（「くわしく探す」ボタン）
    expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
    // 右ペイン: メモ帳（PCの既定）
    await waitFor(() => expect(rightPaneVisible('pc-right-memo')).toBe(true), { timeout: IT_TIMEOUT })
    expect(rightPaneVisible('pc-right-list')).toBe(false)
  })

  it('左ペインでフォームを開くとURLは view=form（右ペインはそのまま）', async () => {
    renderApp()
    await waitFor(() => expect(rightPaneVisible('pc-right-memo')).toBe(true), { timeout: IT_TIMEOUT })
    openFormView()
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })
    // 右ペインはメモ帳のまま（フォーム表示がプライマリ画面）
    expect(rightPaneVisible('pc-right-memo')).toBe(true)
    expect(rightPaneVisible('pc-right-list')).toBe(false)
  })

  it('トップから右ペインを切替えるとURLが追従する（list→memo/top）', async () => {
    renderApp()
    // 既定（右:メモ帳）はトップ画面＝view なし
    expect(viewParam()).toBeNull()

    navClick('一覧')
    await waitFor(() => expect(viewParam()).toBe('list'), { timeout: IT_TIMEOUT })
    expect(rightPaneVisible('pc-right-list')).toBe(true)

    navClick('メモ帳')
    // PC では「トップ+右:メモ帳」＝トップ画面なので view は消える
    await waitFor(() => expect(viewParam()).toBeNull(), { timeout: IT_TIMEOUT })
    expect(rightPaneVisible('pc-right-memo')).toBe(true)
  })

  it('ヘッダーの「トップ画面に戻る」はPCのトップ（左:top / 右:メモ帳）へ', async () => {
    renderApp()
    openFormView()
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })
    // トップへ戻ると、右ペインは既定のメモ帳に揃えられる
    fireEvent.click(screen.getByRole('button', { name: 'トップ画面に戻る' }))
    await waitFor(() => expect(viewParam()).toBeNull(), { timeout: IT_TIMEOUT })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
      expect(rightPaneVisible('pc-right-memo')).toBe(true)
    }, { timeout: IT_TIMEOUT })
  })

  it('view=form のURLを開くとフォーム表示（右ペインはメモ帳のまま）', async () => {
    renderApp('view=form')
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })
    await waitFor(() => expect(screen.getByRole('button', { name: /この.*範囲で検索/ })).toBeTruthy(), { timeout: IT_TIMEOUT })
    expect(rightPaneVisible('pc-right-memo')).toBe(true)
  })

  it('view=memo のURLを開くと右ペインのメモ帳を表示し、URLは書き換えられない', async () => {
    renderApp('view=memo')
    // PC では 'memo' は 'top' のエイリアス（トップ+右:メモ帳）
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /くわしく探す/ })).toBeTruthy()
      expect(rightPaneVisible('pc-right-memo')).toBe(true)
    }, { timeout: IT_TIMEOUT })
    // 同期エフェクトがURLを書き換えない（エイリアスでループを回避）
    expect(viewParam()).toBe('memo')
  })

  it('検索条件パラメータとviewが共存するURLでも両方復元される', async () => {
    renderApp('view=form&c=cafe')
    await waitFor(() => expect(viewParam()).toBe('form'), { timeout: IT_TIMEOUT })
    // フォーム内でカフェカテゴリが選択済みとして表示される
    // （選択中カテゴリ名は「🍜 カフェ」のようにアイコン付きのラベルで表示され、
    // 説明文「コーヒーショップ・カフェ」にも文字列が含まれるため、末尾が
    // 「カフェ」の短いリーフ要素で特定する）
    await waitFor(() => {
      const isCafeLabel = (_content, el) =>
        el.children.length === 0 && el.textContent.trim().endsWith('カフェ') && el.textContent.trim().length <= 6
      expect(screen.getByText(isCafeLabel)).toBeTruthy()
    }, { timeout: IT_TIMEOUT })
  })
})
