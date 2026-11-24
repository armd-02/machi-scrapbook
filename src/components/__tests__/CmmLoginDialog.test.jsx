// @vitest-environment jsdom
/**
 * (CMM同期、ピースC) CmmLoginDialog のテスト
 *
 * 検証内容:
 * - open=false のときは何もレンダリングしない
 * - open=true のときは dialog（aria-label「CMM 同期ログイン」）が表示される
 * - 入力値が空のときは「同期する」が無効
 * - ユーザー名（trim 済み）＋パスワードを入力して「同期する」で
 *   onSync({ username, password }) が呼ばれる
 * - 「キャンセル」で onClose が呼ばれる
 * - バックグラウンドタップで onClose が呼ばれる
 * - Escape キーで onClose が呼ばれる
 * - 閉じて再オープンすると入力値がリセットされる（認証情報の再利用・保存はしない）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import CmmLoginDialog from '../CmmLoginDialog'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('表示', () => {
  it('open=false のときは何もレンダリングしない', () => {
    const { container } = render(
      <CmmLoginDialog open={false} onSync={vi.fn()} onClose={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('open=true のときは「CMM 同期ログイン」の dialog が表示される', () => {
    render(<CmmLoginDialog open onSync={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'CMM 同期ログイン' })).toBeTruthy()
    expect(screen.getByLabelText('ユーザー名')).toBeTruthy()
    expect(screen.getByLabelText('パスワード')).toBeTruthy()
    expect(screen.getByRole('button', { name: '同期する' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy()
  })

  it('パスワード欄は type="password" である', () => {
    render(<CmmLoginDialog open onSync={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByLabelText('パスワード').type).toBe('password')
  })
})

describe('送信', () => {
  it('入力値が空のときは「同期する」が無効で onSync は呼ばれない', () => {
    const onSync = vi.fn()
    render(<CmmLoginDialog open onSync={onSync} onClose={vi.fn()} />)
    const submit = screen.getByRole('button', { name: '同期する' })
    expect(submit.disabled).toBe(true)
    fireEvent.submit(submit.closest('form'))
    expect(onSync).not.toHaveBeenCalled()
  })

  it('両方入力すると有効になり、onSync は trim 済みユーザー名とパスワードで呼ばれる', () => {
    const onSync = vi.fn()
    render(<CmmLoginDialog open onSync={onSync} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: '  user1  ' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pass1' } })

    const submit = screen.getByRole('button', { name: '同期する' })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    expect(onSync).toHaveBeenCalledWith({ username: 'user1', password: 'pass1' })
  })

  it('ユーザー名のみの入力は不十分（パスワード空では無効のまま）', () => {
    render(<CmmLoginDialog open onSync={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'user1' } })
    expect(screen.getByRole('button', { name: '同期する' }).disabled).toBe(true)
  })
})

describe('閉じる', () => {
  it('「キャンセル」で onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<CmmLoginDialog open onSync={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('バックグラウンドタップで onClose が呼ばれる', () => {
    const onClose = vi.fn()
    const { container } = render(<CmmLoginDialog open onSync={vi.fn()} onClose={onClose} />)
    const backdrop = container.querySelector('.bg-slate-900\\/40')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape キーで onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<CmmLoginDialog open onSync={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('閉じて再オープンすると入力値がリセットされる', () => {
    const onClose = vi.fn()
    const { rerender } = render(<CmmLoginDialog open onSync={vi.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'user1' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pass1' } })

    rerender(<CmmLoginDialog open={false} onSync={vi.fn()} onClose={onClose} />)
    rerender(<CmmLoginDialog open onSync={vi.fn()} onClose={onClose} />)

    expect(screen.getByLabelText('ユーザー名').value).toBe('')
    expect(screen.getByLabelText('パスワード').value).toBe('')
  })
})
