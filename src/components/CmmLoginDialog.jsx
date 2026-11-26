import React from 'react'
import { startCmmOsmLogin } from '../utils/cmmOsmSession'

export default function CmmLoginDialog({ open, callbackError, onClose }) {
  const login = React.useRef(null)
  const [waiting, setWaiting] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return undefined
    setWaiting(false)
    setError(null)
    return () => login.current?.abort()
  }, [open])

  React.useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  async function handleLogin() {
    if (login.current) return
    const controller = new AbortController()
    login.current = controller
    setWaiting(true)
    setError('')
    try {
      await startCmmOsmLogin(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) setError(error.message)
    } finally {
      login.current = null
      if (!controller.signal.aborted) setWaiting(false)
    }
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
          コミュニティマップメーカーに連携した OpenStreetMap アカウントで同期します。
        </p>
        <p className="mt-1 text-xs text-slate-500">
          初めての同期には、
          <a href="https://cmapmaker.openacrossbase.net/register.html?app_key=machi-scrapbook" target="_blank" rel="noopener" className="text-primary-600 underline">アカウント登録</a>
          と
          <a href="https://cmapmaker.openacrossbase.net/#projects" target="_blank" rel="noopener" className="text-primary-600 underline">プロジェクト参加</a>
          が必要です。既存のアカウントは
          <a href="https://cmapmaker.openacrossbase.net/mypage.html" target="_blank" rel="noopener" className="text-primary-600 underline">マイページ</a>
          から OSM と連携できます。
        </p>
        {waiting && <p role="status" className="mt-3 text-sm text-slate-600">OpenStreetMap のログイン画面を開いています…</p>}
        {!waiting && (error ?? callbackError) && <p role="alert" className="mt-3 text-sm text-red-700">{error ?? callbackError}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleLogin}
            disabled={waiting}
            className="flex-1 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:bg-slate-300"
          >
            OpenStreetMap でログイン
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
