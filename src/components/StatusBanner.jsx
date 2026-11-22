import React, { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'

const ERROR_LABELS = {
  timeout: 'タイムアウト',
  rate_limit: 'レート制限',
  server_error: 'サーバーエラー',
  network: '接続エラー',
  empty: '結果なし',
  invalid_query: 'クエリエラー'
}

// 取得成功報のトースト表示時間（自動消滅）
const SUCCESS_TOAST_MS = 3000

/**
 * 検索成功の取得報告（件数＋取得時刻＋エンドポイント注記）を一時表示するトースト。
 *
 * - fixed 配置で画面に重ねて表示する（常時バナーではなくポップアップ）
 *   位置はヘッダー（AppHeader）の直下。pointer-events: none で操作を妨げない
 * - 約3秒（SUCCESS_TOAST_MS）で自動的に消える。消えた後の縦スペースは
 *   残らない（フロー外の fixed 要素のため）
 * - 新しい検索が成功するたびに再表示する（fetchedAt・件数の変化で
 *   タイマーがリセットされる。新規検索は status が loading になり
 *   いったんアンマウントされるため、成功時に毎回新規マウントされる）
 */
function SuccessToast({ count, fetchMeta }) {
  const [visible, setVisible] = useState(true)
  // 再表示のトリガー: 取得時刻＋件数。同じ検索の再描画では発火しない
  const trigger = `${fetchMeta?.fetchedAt ?? 0}|${count}`

  useEffect(() => {
    setVisible(true)
    const t = setTimeout(() => setVisible(false), SUCCESS_TOAST_MS)
    return () => clearTimeout(t)
  }, [trigger])

  if (!visible) return null

  const timeStr = fetchMeta?.fetchedAt
    ? new Date(fetchMeta.fetchedAt).toLocaleString('ja-JP', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      })
    : null

  return (
    <div className="fixed inset-x-0 top-[57px] z-30 px-3 pointer-events-none">
      <div className="mx-auto max-w-xl bg-green-50 border border-green-200 rounded-lg shadow-md px-4 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-green-800">
            {count.toLocaleString()}件の結果を取得しました
          </span>
          {timeStr && (
            <span className="text-xs text-slate-500">
              取得: {timeStr}
              {fetchMeta?.cached && '（キャッシュ）'}
              {fetchMeta?.endpoint && ` / ${fetchMeta.endpoint}`}
              {fetchMeta?.fallback && '（フォールバック利用）'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBanner() {
  const { state } = useApp()
  const { status, error, errorType, errorSuggestion, results, fetchMeta } = state

  if (status === 'loading') {
    return (
      <div className="bg-primary-50 border-b border-primary-200 px-4 py-2 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-primary-800">Overpass APIにクエリ実行中...</span>
      </div>
    )
  }

  if (status === 'error' && error) {
    const label = errorType ? ERROR_LABELS[errorType] : null
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-2.5">
        <div className="flex items-start gap-2">
          {/* whitespace-pre-line: メッセージ内の改行（\n）を保持して表示。改行なしのメッセージには影響しない */}
          <span className="text-red-600 text-sm font-medium shrink-0 mt-0.5 whitespace-pre-line">
            ⚠️ {label ? `${label}: ` : ''}{error}
          </span>
        </div>
        {errorSuggestion && (
          <p className="text-xs text-red-500 mt-1 ml-5">
            → {errorSuggestion}
          </p>
        )}
      </div>
    )
  }

  if (status === 'success') {
    const count = results.length
    if (count === 0) {
      return (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
          <span className="text-sm text-slate-600">
            該当する結果がありません。
          </span>
          <span className="text-xs text-slate-400 ml-2">
            （OSMに未登録である可能性、または表記の違いで一致しない可能性があります）
          </span>
        </div>
      )
    }

    // 取得成功報はトースト化（約3秒で自動消滅するポップアップ表示）。
    // 0件の案内・loading・error は従来どおり常時表示のバナーのまま
    return <SuccessToast count={count} fetchMeta={fetchMeta} />
  }

  return null
}

export default StatusBanner
