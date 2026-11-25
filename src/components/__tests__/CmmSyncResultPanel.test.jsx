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
 * - （ピースF）403 project_access_denied を含む場合、
 *   プロジェクト未参加の専用案内とポータルリンクが表示される。
 *   他のエラーでは専用案内は出ない。混合時は併記。
 * - （ピースJ）公開地図URL: userId が有効（空でなく「@」を含まない）かつ
 *   auth/permission エラーが無いときに表示される。URL エンコード・別タブリンク・
 *   「リンクをコピー」が clipboard に URL を渡す。clipboard 未対応でもエラーにならない。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import CmmSyncResultPanel from '../CmmSyncResultPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete navigator.clipboard
})

/** jsdom には navigator.clipboard が無いので、テストごとにスタブする */
function stubClipboard(writeText) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
}

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

describe('プロジェクト未参加（403 project_access_denied、ピースF）', () => {
  const DENIED = {
    kind: 'permission',
    status: 403,
    code: 'project_access_denied',
    message: 'project access denied',
  }

  it('専用案内とポータルの参加リンクが表示される', () => {
    render(<CmmSyncResultPanel result={makeResult({ errors: [DENIED] })} onClose={vi.fn()} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('このプロジェクトに参加していないため、同期できませんでした')
    expect(alert.textContent).toContain('プロジェクト「まちのスクラップブック」に参加してから、もう一度同期してください')
    const link = screen.getByRole('link', { name: 'コミュニティマップメーカーのポータル' })
    expect(link.href).toBe('https://cmapmaker.openacrossbase.net/#projects')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener')
  })

  it('他の種類のエラーでは専用案内が出ない', () => {
    const cases = [
      { kind: 'auth', status: 401, message: 'unauthorized' },
      { kind: 'validation', status: 422, message: 'invalid' },
      { kind: 'network', message: 'timeout' },
      { kind: 'permission', status: 403, code: 'other_code', message: 'forbidden' },
      { kind: 'permission', message: '403' }, // status/code 無し（従来形式）
    ]
    for (const error of cases) {
      cleanup()
      render(<CmmSyncResultPanel result={makeResult({ errors: [error] })} onClose={vi.fn()} />)
      expect(screen.queryByRole('link')).toBeNull()
      expect(screen.getByRole('alert').textContent).not.toContain('このプロジェクトに参加していないため')
    }
  })

  it('403 project_access_denied と他のエラーが混在する場合、案内と他のエラーメッセージが併記される', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({
          errors: [DENIED, { kind: 'validation', status: 422, message: 'invalid' }],
        })}
        onClose={vi.fn()}
      />
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('このプロジェクトに参加していないため、同期できませんでした')
    expect(alert.textContent).toContain('リクエストの内容に問題があります')
  })
})

describe('公開地図URL（ピースJ）', () => {
  const urlOf = (userId) =>
    `https://machi-scrapbook.openacrossbase.net/map/?userid=${encodeURIComponent(userId)}`

  it('userId が結果にあると公開地図URLが別タブリンクで表示される', () => {
    render(<CmmSyncResultPanel result={makeResult({ userId: 'user1' })} onClose={vi.fn()} />)
    expect(screen.getByText('公開地図')).toBeTruthy()
    const link = screen.getByRole('link', { name: urlOf('user1') })
    expect(link.href).toBe(urlOf('user1'))
    expect(link.target).toBe('_blank')
  })

  it('userId の特殊文字はURLエンコードされる', () => {
    render(<CmmSyncResultPanel result={makeResult({ userId: 'user 1/jp' })} onClose={vi.fn()} />)
    const link = screen.getByRole('link')
    expect(link.href).toBe(urlOf('user 1/jp'))
  })

  it('userId が無い・空の場合は表示されない', () => {
    for (const userId of [undefined, null, '']) {
      cleanup()
      render(<CmmSyncResultPanel result={makeResult({ userId })} onClose={vi.fn()} />)
      expect(screen.queryByText('公開地図')).toBeNull()
    }
  })

  it('userId が「@」を含む（メールアドレス形式）場合は表示されない', () => {
    render(<CmmSyncResultPanel result={makeResult({ userId: 'user@example.com' })} onClose={vi.fn()} />)
    expect(screen.queryByText('公開地図')).toBeNull()
  })

  it('auth エラーがあるときは表示されない', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ userId: 'user1', errors: [{ kind: 'auth', message: '401' }] })}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText('公開地図')).toBeNull()
  })

  it('permission エラーがあるときは表示されない', () => {
    render(
      <CmmSyncResultPanel
        result={makeResult({ userId: 'user1', errors: [{ kind: 'permission', message: '403' }] })}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText('公開地図')).toBeNull()
  })

  it('validation / network のみなら表示される', () => {
    for (const error of [{ kind: 'validation', message: '422' }, { kind: 'network', message: 'x' }]) {
      cleanup()
      render(
        <CmmSyncResultPanel result={makeResult({ userId: 'user1', errors: [error] })} onClose={vi.fn()} />
      )
      expect(screen.getByText('公開地図')).toBeTruthy()
    }
  })

  it('「リンクをコピー」で clipboard にURLが渡され、「コピーしました」になる', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    render(<CmmSyncResultPanel result={makeResult({ userId: 'user1' })} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(urlOf('user1')))
    expect(screen.getByRole('button', { name: 'コピーしました' })).toBeTruthy()
  })

  it('clipboard が使えない環境ではコピー失敗をエラーにせず、リンク表示だけが残る', () => {
    delete navigator.clipboard
    render(<CmmSyncResultPanel result={makeResult({ userId: 'user1' })} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }))
    // エラーにならず、「コピーしました」にもならず、リンク表示だけが残る
    expect(screen.queryByText('コピーしました')).toBeNull()
    expect(screen.getByText('公開地図')).toBeTruthy()
    expect(screen.getByRole('link', { name: urlOf('user1') })).toBeTruthy()
  })
})
