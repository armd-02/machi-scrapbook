// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CmmLoginDialog from '../CmmLoginDialog'
import { startCmmOsmLogin } from '../../utils/cmmOsmSession'

vi.mock('../../utils/cmmOsmSession', () => ({ startCmmOsmLogin: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const loginButton = () => screen.getByRole('button', { name: 'OpenStreetMap でログイン' })

describe('CmmLoginDialog', () => {
  it('閉じていると表示せず、認証を開始しない', () => {
    render(<CmmLoginDialog open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(startCmmOsmLogin).not.toHaveBeenCalled()
  })

  it('開始中は再クリックを防ぎ、ダイアログを閉じたら遷移を中止する', () => {
    startCmmOsmLogin.mockImplementationOnce(() => new Promise(() => {}))
    const onClose = vi.fn()
    const { rerender } = render(<CmmLoginDialog open onClose={onClose} />)
    fireEvent.click(loginButton())
    const [[signal]] = startCmmOsmLogin.mock.calls
    expect(loginButton().disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    rerender(<CmmLoginDialog open={false} onClose={onClose} />)
    expect(signal.aborted).toBe(true)
  })

  it('認証開始に失敗した場合は再試行できる', async () => {
    startCmmOsmLogin.mockRejectedValueOnce(new Error('現在のURLでは同期できません。'))
    render(<CmmLoginDialog open onClose={vi.fn()} />)
    fireEvent.click(loginButton())
    expect((await screen.findByRole('alert')).textContent).toBe('現在のURLでは同期できません。')
    expect(loginButton().disabled).toBe(false)
  })

  it('認証から戻ったときのエラーを表示する', () => {
    render(<CmmLoginDialog open callbackError="連携がキャンセルされました。" onClose={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('連携がキャンセルされました。')
  })
})
