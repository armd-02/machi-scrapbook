import React, { useState } from 'react'
import { memochoKeyOf } from '../../utils/memocho'

/**
 * (ごみ箱) まちメモ帳のごみ箱ビュー
 *
 * ヘッダーメニュー（HeaderMenu）の「ごみ箱」からメモ帳タブがごみ箱ビューに
 * 切替わると、MemochoSection が本コンポーネントを代わりに描画する。
 *
 * - 削除されたアイテムを「名前＋削除日時」で一覧表示する
 * - 各行に「復元」（deletedAt を除去して通常の一覧へ戻す）と
 *   「完全に削除」（2段階確認付き。store から完全に取り除く）
 * - 「ごみ箱を空にする」（2段階確認付き。ごみ箱の全件を完全削除）
 * - 「← まちメモ帳へ」で通常の一覧ビューに戻る
 *
 * アイテムは自動で期限切れ削除されない（ユーザーが操作するまで残る）。
 */

// 削除日時（ISO 文字列）を「M月d日 H:mm」（今年以外なら西暦付き）で表示する
function formatDeletedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.getFullYear() === new Date().getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${time}`
}

export default function MemochoTrash({ items, onRestore, onRemove, onEmptyTrash, onBack }) {
  // 「ごみ箱を空にする」の2段階確認状態
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  // 「完全に削除」の確認中のキー（同時に1件だけ）
  const [confirmRemove, setConfirmRemove] = useState(null)
  // 操作後の短いフィードバック（role="status"）
  const [notice, setNotice] = useState(null)

  const handleRestore = (item) => {
    onRestore(memochoKeyOf(item))
    setConfirmRemove(null)
    setConfirmEmpty(false)
    setNotice({ text: `「${item.name}」を復元しました` })
  }

  const handleRemoveNow = (item) => {
    onRemove(memochoKeyOf(item))
    setConfirmRemove(null)
    setConfirmEmpty(false)
    setNotice({ text: `「${item.name}」を完全に削除しました` })
  }

  // 2段階: 1回目で確認表示に切り替わり、2回目で実行する（window.confirm 不使用）
  const handleEmptyTrash = () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true)
      return
    }
    const count = onEmptyTrash()
    setConfirmEmpty(false)
    setConfirmRemove(null)
    setNotice({ text: `ごみ箱を空にしました（${count}件を完全削除）` })
  }

  return (
    <section aria-label="ごみ箱" className="@container bg-white border-b border-slate-200">
      {/* 見出し行: 戻るボタン＋タイトル・件数＋ごみ箱を空にする */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          <span aria-hidden="true">←</span> まちメモ帳へ
        </button>
        <h2 className="text-sm font-bold text-slate-800">ごみ箱</h2>
        <span className="text-xs text-slate-500">{items.length}件</span>
        <div className="flex-1" />
        {items.length > 0 && (
          <button
            type="button"
            onClick={handleEmptyTrash}
            className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium ${
              confirmEmpty
                ? 'bg-red-600 text-white'
                : 'text-red-600 border border-red-200 bg-red-50 hover:bg-red-100'
            }`}
          >
            {confirmEmpty ? '本当に空にしますか？' : 'ごみ箱を空にする'}
          </button>
        )}
      </div>

      {/* 操作後のフィードバック */}
      {notice && (
        <div
          role="status"
          className="mx-3 mb-1.5 flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 text-xs text-emerald-700"
        >
          <span aria-hidden="true">✓</span>
          <span className="flex-1 min-w-0 break-words">{notice.text}</span>
          <button
            type="button"
            aria-label="メッセージを閉じる"
            onClick={() => setNotice(null)}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      <div className="px-3 pb-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center">
            ごみ箱は空です。カードの✕で削除した施設がここに移動します。
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {items.map((item) => {
              const key = memochoKeyOf(item)
              return (
                <li key={key} className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold break-words">{item.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        削除日時: {formatDeletedAt(item.deletedAt)}
                      </p>
                    </div>
                    {confirmRemove === key ? (
                      // 2段階確認中: 完全削除の確認
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-[11px] text-red-700">完全に削除しますか？（取り消せません）</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRemoveNow(item)}
                            className="min-h-[44px] px-3 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
                          >
                            削除
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(null)}
                            className="min-h-[44px] px-3 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="shrink-0 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRestore(item)}
                          className="min-h-[44px] px-3 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg"
                        >
                          復元
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(key)}
                          className="min-h-[44px] px-3 text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 rounded-lg"
                        >
                          完全に削除
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
