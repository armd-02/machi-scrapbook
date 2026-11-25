// @vitest-environment jsdom
/**
 * (CMM同期、ピースC) メモ帳画面の CMM 同期 UI の統合テスト
 *
 * cmmSync.js の syncMemos だけをモックし（ネットワークにはアクセスしない）、
 * スクラップブックバーの同期ボタン → ログインダイアログ → 同期実行 →
 * 結果表示・cmmId 保存・最終同期時刻表示 の流れを検証する。
 *
 * 検証内容:
 * - バーに「公開地図へ反映」ボタンと「未同期」表示が出る
 * - 同期ボタンでログインダイアログが開き、キャンセルで閉じて同期は実行されない
 * - 認証情報を入力して「同期する」で syncMemos が呼ばれ、反映中は
 *   ボタンが無効化され「反映中…」表示になる
 * - 成功 → 結果パネル（role="status"）で件数サマリー、最終同期時刻が
 *   「最終: ...」で表示され、localStorage に保存される
 * - 成功 → 作成された Activity の cmmId が該当メモに保存される
 * - 失敗（auth） → role="alert" で「ユーザー名・パスワードを確認」の案内
 * - localStorage に最終同期時刻があると「最終: ...」が表示される
 * - 同期を実行したら使ったユーザー名（username）を localStorage に保存し、
 *   「公開マップのURLをコピー」がそのユーザーIDから URL をコピーする（入力欄なし）
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import MemochoSection from '../MemochoSection'
import { resetMemochoStore } from '../../../hooks/useMemocho'
import { resetScrapbooksStore } from '../../../hooks/useScrapbooks'
import { MEMOCHO_STORAGE_KEY, loadMemocho } from '../../../utils/memocho'
import { SCRAPBOOKS_STORAGE_KEY } from '../../../utils/scrapbooks'
import { AppContext } from '../../../context/AppContext'
import { appReducer, createInitialState } from '../../../state/appReducer'
import { syncMemos, CmmError } from '../../../utils/cmmSync'
import { CMM_LAST_SYNC_KEY, CMM_LAST_USERID_KEY } from '../../../hooks/useCmmSync'

vi.mock('../../../utils/cmmSync', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, syncMemos: vi.fn() }
})

vi.mock('../../../utils/mapCapture', () => ({
  captureMapImage: vi.fn(async () => 'data:image/jpeg;base64,QUJD'),
}))

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

function makeItem(overrides = {}) {
  return {
    type: 'node',
    id: 1001,
    name: 'テスト珈琲店',
    lat: 34.85,
    lon: 135.5,
    tags: { name: 'テスト珈琲店', amenity: 'cafe' },
    memo: '',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function seedMemos(items) {
  localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify(items))
}

function seedBooks(books) {
  localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify(books))
}

function SectionHarness(props) {
  const [state, dispatch] = React.useReducer(appReducer, createInitialState())
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <MemochoSection {...props} />
    </AppContext.Provider>
  )
}

function renderSection(overrides = {}) {
  return render(<SectionHarness {...overrides} />)
}

const syncButton = () => screen.getByRole('button', { name: '公開地図へ反映' })
const syncingButton = () => screen.getByRole('button', { name: '公開地図へ反映中' })
const copyButton = () => screen.getByRole('button', { name: '公開マップのURLをコピー' })

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
  return writeText
}

const okResult = (overrides = {}) => ({
  created: [],
  updated: [],
  deleted: [],
  imported: [],
  errors: [],
  lastSyncAt: '2026-01-18T14:32:00Z',
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  resetMemochoStore()
  resetScrapbooksStore()
  if (mockState.api) mockState.api.resetState()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  seedMemos([makeItem()])
  seedBooks([{ id: 'default', name: 'デフォルト', createdAt: '2026-01-01T00:00:00Z', public: false }])
  syncMemos.mockResolvedValue(okResult())
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  resetMemochoStore()
  resetScrapbooksStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('バーの表示', () => {
  it('「公開地図へ反映」ボタンと「未同期」表示が表示される', () => {
    renderSection()
    expect(syncButton()).toBeTruthy()
    expect(screen.getByText('未同期')).toBeTruthy()
  })

  it('最終同期時刻が保存済みなら「最終: ...」が表示される', () => {
    localStorage.setItem(CMM_LAST_SYNC_KEY, JSON.stringify('2026-01-18T14:32:00Z'))
    renderSection()
    expect(screen.queryByText('未同期')).toBeNull()
    expect(screen.getByText(/最終: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/)).toBeTruthy()
  })
})

describe('公開マップのURLをコピー', () => {
  it('ユーザーIDが未保存なら案内が出てコピーされない（入力欄は無い）', async () => {
    const writeText = mockClipboard()
    renderSection()
    fireEvent.click(copyButton())

    expect(screen.queryByRole('textbox', { name: /コミュニティマップメーカーのユーザーID/ })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('公開マップのURLは、『公開地図へ反映』をした後にコピーできます')
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.getByText('未同期')).toBeTruthy()
    expect(syncMemos).not.toHaveBeenCalled()
  })

  it('同期を実行したら使ったユーザーIDが保存され、URLがコピーできる', async () => {
    const writeText = mockClipboard()
    renderSection()
    fireEvent.click(syncButton())
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'user1' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pass1' } })
    fireEvent.click(screen.getByRole('button', { name: '同期する' }))

    // 同期実行で user1 が localStorage に保存される
    expect(JSON.parse(localStorage.getItem(CMM_LAST_USERID_KEY))).toBe('user1')

    fireEvent.click(copyButton())
    expect(writeText).toHaveBeenCalledWith(
      'https://machi-scrapbook.openacrossbase.net/map/?userid=user1'
    )
    expect(await screen.findByText('公開マップのURLをコピーしました')).toBeTruthy()
  })

  it('ユーザーIDがメールアドレス形式なら案内が出てコピーされない', async () => {
    const writeText = mockClipboard()
    localStorage.setItem(CMM_LAST_USERID_KEY, JSON.stringify('user1@example.com'))
    renderSection()
    fireEvent.click(copyButton())

    expect(screen.getByRole('status').textContent).toBe('メールアドレス形式のIDでは公開マップのURLを作れません')
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('ログインダイアログ', () => {
  it('同期ボタンを押すとログインダイアログが開く', () => {
    renderSection()
    fireEvent.click(syncButton())
    expect(screen.getByRole('dialog', { name: '公開地図への反映ログイン' })).toBeTruthy()
  })

  it('キャンセルでダイアログが閉じられ、syncMemos は呼ばれない', async () => {
    renderSection()
    fireEvent.click(syncButton())
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(syncMemos).not.toHaveBeenCalled()
  })
})

describe('同期実行', () => {
  it('認証情報を入力して「同期する」で syncMemos が呼ばれ、反映中は「反映中…」＋無効化', async () => {
    renderSection()
    fireEvent.click(syncButton())
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'user1' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pass1' } })

    let resolveSync
    syncMemos.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = () => resolve(okResult())
        })
    )

    fireEvent.click(screen.getByRole('button', { name: '同期する' }))

    // ダイアログは閉じられ、ボタンが無効化された「反映中…」表示になる
    expect(screen.queryByRole('dialog')).toBeNull()
    const btn = syncingButton()
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('反映中…')

    // 引数検証: 認証情報・メモ・ブックが渡る
    expect(syncMemos).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { username: 'user1', password: 'pass1' },
        memos: expect.arrayContaining([expect.objectContaining({ type: 'node', id: 1001 })]),
      })
    )

    await act(async () => {
      resolveSync()
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '公開地図へ反映中' })).toBeNull()
    )
    expect(syncButton().disabled).toBe(false)
  })

  it('成功 → 結果パネル（role="status"）で件数サマリーが表示される', async () => {
    syncMemos.mockResolvedValue(
      okResult({ created: [{ id: 'act/11', osmid: 'node/1001', updated_at: '2026-01-18T14:32:00Z' }] })
    )
    renderSection()
    fireEvent.click(syncButton())
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'user1' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pass1' } })
    fireEvent.click(screen.getByRole('button', { name: '同期する' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('同期完了: 1件新規 0件更新 0件削除 0件取り込み')
    })

    // 最終同期時刻が表示され、localStorage に保存される
    expect(screen.getByText(/最終: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/)).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(CMM_LAST_SYNC_KEY))).toBe('2026-01-18T14:32:00Z')

    // 使ったユーザー名も localStorage に保存される
    expect(JSON.parse(localStorage.getItem(CMM_LAST_USERID_KEY))).toBe('user1')

    // cmmId が該当メモに保存される
    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 1001)
    expect(item.cmmId).toBe('act/11')

    // ✕ で結果パネルが閉じる
    fireEvent.click(screen.getByRole('button', { name: '同期結果を閉じる' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('同期結果を閉じても、公開マップのURLを直接コピーできる', async () => {
    const writeText = mockClipboard()
    renderSection()
    fireEvent.click(syncButton())
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'user1' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pass1' } })
    fireEvent.click(screen.getByRole('button', { name: '同期する' }))

    const link = await screen.findByRole('link', {
      name: 'https://machi-scrapbook.openacrossbase.net/map/?userid=user1',
    })
    expect(link.target).toBe('_blank')
    expect(screen.getByRole('button', { name: 'リンクをコピー' })).toBeTruthy()
    const url = link.href
    fireEvent.click(screen.getByRole('button', { name: '同期結果を閉じる' }))
    expect(screen.queryByRole('link', { name: url })).toBeNull()
    fireEvent.click(copyButton())
    expect(writeText).toHaveBeenCalledWith(url)
    expect(await screen.findByText('公開マップのURLをコピーしました')).toBeTruthy()
  })

  it('失敗（auth） → role="alert" で「ユーザー名とパスワードを確認」の案内が出る', async () => {
    syncMemos.mockRejectedValue(new CmmError({ kind: 'auth', message: '認証に失敗しました' }))
    renderSection()
    fireEvent.click(syncButton())
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'user1' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '同期する' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('同期に失敗しました')
    expect(alert.textContent).toContain('ユーザー名とパスワードを確認してください')

    // 最終同期時刻は更新されない
    expect(localStorage.getItem(CMM_LAST_SYNC_KEY)).toBeNull()
    expect(screen.getByText('未同期')).toBeTruthy()

    // ユーザー名は同期実行時点で保存される（失敗でも保存される）
    expect(JSON.parse(localStorage.getItem(CMM_LAST_USERID_KEY))).toBe('user1')
  })
})
