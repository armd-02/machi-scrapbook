// @vitest-environment jsdom
/**
 * (CMM同期、ピースC) CmmSyncResultPanel のテスト
 *
 * 検証内容:
 * - result が null のときは何もレンダリングしない
 * - 成功（errors 空）: role="status" で
 *   「同期完了: N件新規 M件更新 K件削除 I件取り込み」を表示
 * - エラー: role="alert" で kind 別のメッセージを表示
 *   - auth → ユーザー名・パスワードの確認を促す文言
 *   - permission → 権限不足の旨
 *   - validation → リクエスト内容の問題
 *   - network（その他） → 通信エラーの旨
 * - 複数のエラーがある場合は全部表示される
 * - ✕ ボタンで onClose が呼ばれる（成功・エラー両方）
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import CmmSyncResultPanel from '../CmmSyncResultPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const makeResult = (overrides = {}) => ({
  created: [],
  updated: [],
  deleted: [],
  imported: [],
  errors: [],
  lastSyncAt: null,
  ...overrides,
})

describe('表示しないケース', () => {
  it('result が null のときは何もレンダリングしない', () => {
    const { container } = render(<CmmSyncResultPanel result={null} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('成功', () => {
  it('作成・更新・削除・取り込みの件数が role="status" で表示される', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ created: [1, 2], updated: [1], deleted: ['a'], imported: [1, 2, 3] })}
        onClose={vi.fn()}
      />
    )
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('同期完了: 2件新規 1件更新 1件削除 3件取り込み')
  })

  it('全件0でも成功表示が出る', () => {
    render(<CmmSyncResultPanel result={makeResult()} onClose={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('同期完了: 0件新規 0件更新 0件削除 0件取り込み')
  })

  it('✕ で onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<CmmSyncResultPanel result={makeResult()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '同期結果を閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('エラー', () => {
  it('auth → 認証失敗の案内が role="alert" で表示される', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ errors: [{ kind: 'auth', message: '401' }] })}
        onClose={vi.fn()}
      />
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('同期に失敗しました')
    expect(alert.textContent).toContain('ユーザー名とパスワードを確認してください')
  })

  it('permission → 権限不足の案内が表示される', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ errors: [{ kind: 'permission', message: '403' }] })}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('権限がありません')
  })

  it('validation → リクエスト内容の問題の案内が表示される', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ errors: [{ kind: 'validation', message: '422' }] })}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('リクエストの内容に問題があります')
  })

  it('network（kind なし・その他） → 通信エラーの案内が表示される', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ errors: [{ kind: 'network', message: 'timeout' }] })}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('通信エラーが発生しました')
  })

  it('複数のエラーがある場合は全部表示される', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({
          errors: [
            { kind: 'auth', message: '401' },
            { kind: 'network', message: 'timeout' },
          ],
        })}
        onClose={vi.fn()}
      />
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('ユーザー名とパスワードを確認してください')
    expect(alert.textContent).toContain('通信エラーが発生しました')
  })

  it('部分成功（created あり＋errors あり）でもエラー表示になる', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ created: [1], errors: [{ kind: 'validation', message: '422' }] })}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('リクエストの内容に問題があります')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('✕ で onClose が呼ばれる（エラー表示の場合）', () => {
    const onClose = vi.fn()
    render(
      <CmmSyncResultPanel
        result={makeResult({ errors: [{ kind: 'network', message: 'x' }] })}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'エラーメッセージを閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
