import React from 'react'

/**
 * CMM 同期のログインダイアログ（ピースC）
 *
 * 同期のたびに毎回表示される。ユーザー名・パスワードを入力して「同期する」
 * を押すと onSync({ username, password }) が呼ばれる。
 *
 * 認証情報はこのダイアログのローカル state にのみ存在し、
 * localStorage・アプリの状態には一切保存しない（閉じたら破棄）。
 *
 * （ピースF）初めての人向けの案内（アカウント登録・プロジェクト参加の
 * リンク）をタイトルの下に表示する。
 * props:
 *   open       ダイアログを表示するか
 *   onSync     「同期する」が押されたときのコールバック（{ username, password }）
 *   onClose    閉じる（キャンセル・バックグラウンドタップ・Escape）
 */
const INPUT_CLASS =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'

export default function CmmLoginDialog({ open, onSync, onClose }) {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')

  // 開くたびに初期状態（前回入力値の再利用はしない）
  React.useEffect(() => {
    if (open) {
      setUsername('')
      setPassword('')
    }
  }, [open])

  // Escape キーで閉じる
  React.useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const canSubmit = username.trim() !== '' && password !== ''

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return
    onSync({ username: username.trim(), password })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="公開地図への反映ログイン"
        className="relative w-full max-w-sm bg-white rounded-xl shadow-lg p-5"
      >
        <h2 className="text-base font-bold text-slate-800">公開地図への反映ログイン</h2>
        <p className="mt-1 text-xs text-slate-500">
          community map maker のアカウントを入力してください。
          認証情報は今回の同期でのみ使用され、保存されません。
        </p>
        <p className="mt-1 text-xs text-slate-500">
          初めての同期には、コミュニティマップメーカーのアカウントと、プロジェクトへの参加が必要です。
          <a
            href="https://cmapmaker.openacrossbase.net/register.html"
            target="_blank"
            rel="noopener"
            className="text-primary-600 underline underline-offset-2"
          >
            アカウント登録
          </a>
          ／
          <a
            href="https://cmapmaker.openacrossbase.net/#projects"
            target="_blank"
            rel="noopener"
            className="text-primary-600 underline underline-offset-2"
          >
            プロジェクト参加
          </a>
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="cmm-username" className="block text-sm font-medium text-slate-700">
              ユーザー名
            </label>
            <input
              id="cmm-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`mt-1 ${INPUT_CLASS}`}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="cmm-password" className="block text-sm font-medium text-slate-700">
              パスワード
            </label>
            <input
              id="cmm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium
                hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              同期する
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm
                hover:bg-slate-50"
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
