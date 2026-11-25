import React, { useEffect, useRef, useState } from 'react'
import { publicMapUrl } from '../utils/publicMapUrl'

/**
 * CMM 同期結果パネル（ピースC）
 *
 * 同期完了後にスクラップブックバーの下に表示される。
 *
 * - 成功（errors が空）: role="status" で
 *   「同期完了: N件新規 M件更新 K件削除 I件取り込み」を表示
 * - エラー: role="alert" で kind 別に分かりやすいメッセージを表示
 *   （auth / permission / validation / network・その他）
 * - （ピースF）403 の project_access_denied を含む場合は、
 *   「プロジェクトに参加していない」旨の専用案内とポータルの参加リンクを
 *   優先して表示する（他のエラーは従来どおりの表示のまま併記）
 * - （ピースJ）公開地図のURL表示: userId が空でなく「@」を含まず、かつ
 *   auth / permission のエラーが無いときに、banner の下に「公開地図」の
 *   リンク（別タブで開く）＋「リンクをコピー」ボタンを表示する
 *
 * banner の右端の ✕ ボタンで閉じる。
 *
 * props:
 *   result   同期結果（syncMemos の戻り値＋ userId。{ created, updated,
 *            deleted, imported, errors, lastSyncAt, userId }）
 *   onClose  閉じるコールバック
 */
export default function CmmSyncResultPanel({ result, onClose }) {
  if (result == null) return null

  const errors = Array.isArray(result.errors) ? result.errors : []
  const denied = errors.some(isProjectAccessDenied)
  const otherErrors = denied ? errors.filter((e) => !isProjectAccessDenied(e)) : errors
  // (ピースJ) 認証・権限のエラーがあるときは公開URLを表示しない
  const authOrPermission = errors.some((e) => e != null && (e.kind === 'auth' || e.kind === 'permission'))
  const publicUrl = publicMapUrl(result.userId)

  return (
    <div className="space-y-1.5">
      {errors.length === 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 px-3 py-2 bg-emerald-50 border-b border-emerald-200 text-sm text-emerald-800"
        >
          <span className="flex-1">
            同期完了: {result.created.length}件新規 {result.updated.length}件更新{' '}
            {result.deleted.length}件削除 {result.imported.length}件取り込み
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="同期結果を閉じる"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md
              text-emerald-700 hover:bg-emerald-100"
          >
            ✕
          </button>
        </div>
      ) : (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700"
        >
          <div className="flex-1 space-y-1">
            <p className="font-medium">同期に失敗しました</p>
            {denied && (
              <p>
                このプロジェクトに参加していないため、同期できませんでした。
                <a
                  href="https://cmapmaker.openacrossbase.net/#projects"
                  target="_blank"
                  rel="noopener"
                  className="underline underline-offset-2"
                >
                  コミュニティマップメーカーのポータル
                </a>
                でプロジェクト「まちのスクラップブック」に参加してから、もう一度同期してください。
              </p>
            )}
            {otherErrors.map((error, index) => (
              <p key={index}>{errorMessage(error)}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="エラーメッセージを閉じる"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md
              text-red-600 hover:bg-red-100"
          >
            ✕
          </button>
        </div>
      )}
      {publicUrl != null && !authOrPermission && (
        <PublicUrlRow url={publicUrl} />
      )}
    </div>
  )
}

/**
 * （ピースJ）公開地図ページのURL表示。「公開地図」ラベル＋リンク（別タブ）
 * ＋「リンクをコピー」ボタン。コピー成功で一時的に「コピーしました」になる。
 * クリップボードが使えない環境ではコピー失敗をエラーにしない（リンクのみ残る）
 */
function PublicUrlRow({ url }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードが使えない環境（jsdom・旧ブラウザ等）では何もしない
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 text-sm text-blue-900">
      <span className="shrink-0 font-medium">公開地図</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 break-all underline underline-offset-2"
      >
        {url}
      </a>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 min-h-7 px-2 text-xs font-medium rounded-md border border-blue-300 bg-white text-blue-800 hover:bg-blue-100"
      >
        {copied ? 'コピーしました' : 'リンクをコピー'}
      </button>
    </div>
  )
}

/**
 * エラーが「プロジェクト未参加」（403 project_access_denied）かどうか。
 * 該当するエラーには専用案内（ポータルの参加リンク）を表示し、
 * 汎用の権限メッセージは出さない。
 */
function isProjectAccessDenied(error) {
  return (
    error != null &&
    error.kind === 'permission' &&
    error.status === 403 &&
    error.code === 'project_access_denied'
  )
}

/** エラーの kind に応じたユーザー向けメッセージ */
function errorMessage(error) {
  if (error == null) return '不明なエラーが発生しました。'
  switch (error.kind) {
    case 'auth':
      return '認証に失敗しました。ユーザー名とパスワードを確認してください。'
    case 'permission':
      return 'この操作には権限がありません。アカウントの確認をお願いしています。'
    case 'validation':
      return 'リクエストの内容に問題があります。時間をおいて再試行してください。'
    default:
      return '通信エラーが発生しました。ネットワーク接続を確認して再試行してください。'
  }
}
