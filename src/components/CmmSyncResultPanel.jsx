import React from 'react'

/**
 * CMM 同期結果パネル（ピースC）
 *
 * 同期完了後にスクラップブックバーの下に表示される。
 *
 * - 成功（errors が空）: role="status" で
 *   「同期完了: N件新規 M件更新 K件削除 I件取り込み」を表示
 * - エラー: role="alert" で kind 別に分かりやすいメッセージを表示
 *   （auth / permission / validation / network・その他）
 *
 * 右端の ✕ ボタンで閉じる。
 *
 * props:
 *   result   syncMemos の戻り値（{ created, updated, deleted, imported, errors, lastSyncAt }）
 *   onClose  閉じるコールバック
 */
export default function CmmSyncResultPanel({ result, onClose }) {
  if (result == null) return null

  const errors = Array.isArray(result.errors) ? result.errors : []

  if (errors.length === 0) {
    return (
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
    )
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-2 px-3 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700"
    >
      <div className="flex-1 space-y-1">
        <p className="font-medium">同期に失敗しました</p>
        {errors.map((error, index) => (
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
