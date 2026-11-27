import React, { useEffect, useState } from 'react'
import MobileResultsMap from './MobileResultsMap'

/**
 * (抽出) 折りたたみ式の結果マップ（検索結果画面・まちメモ帳一覧画面で共用）
 *
 * MobileListTab のローカルコンポーネントとして実装していたものを、
 * まちメモ帳の一覧画面でも同じ地図（MobileResultsMap）を使えるように
 * 共有コンポーネントとして抽出した。
 *
 * 初期状態は initiallyOpen で決める（既定は折りたたみ・地図非表示。
 * バリアフリー側は initiallyOpen を true にして初期「開く」）。
 * 見出しボタン「地図を表示／地図を隠す」で開閉する。折りたたんでいる間は
 * MobileResultsMap をマウントしない（地図を生成しない）。展開すると地図が
 * 新規マウントされ、ピン範囲にfitBoundsされる（地図の高さ設定は
 * MobileResultsMap 内で従来どおり維持される）。
 *
 * - 地図上のピンや線を選ぶと onMarkerClick(result) を呼び出し、対応するカードへ移動する。
 *
 * - title: 見出しテキスト（検索結果画面は「検索結果マップ」、メモ帳一覧は
 *   「メモマップ」）。既定は「検索結果マップ」。
 * - results / bbox: 検索結果の絞り込み後のデータやメモ帳のデータを渡せる。
 *
 * 折りたたみ状態はこのコンポーネントのローカルstateに置く。親のフック構成
 * （早期returnとuseMemoの順序）を変えずに済むため、切替によるフック数の
 * 変化で React がエラーを出すのを避ける。
 */
export default function CollapsibleResultsMap({
  kind = 'poi',
  initiallyOpen = false,
  onMarkerClick = null,
  selection = null,
  title = '検索結果マップ',
  results = null,
  fitPoiDensity,
  bbox = null,
  heightStorageKey = null,
  showWindowControls = false,
}) {
  const [visible, setVisible] = useState(initiallyOpen)
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!maximized) return
    const onKey = (e) => { if (e.key === 'Escape') setMaximized(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])
  useEffect(() => {
    if (selection?.geometry || (Number.isFinite(selection?.lon) && Number.isFinite(selection?.lat))) {
      setVisible(true)
    }
  }, [selection])
  return (
    <div className={maximized
      ? 'results-map-panel bg-white border border-slate-200 overflow-hidden fixed inset-0 z-50 flex flex-col'
      : 'results-map-panel bg-white border border-slate-200 rounded-xl overflow-hidden'}>
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={() => { setVisible((v) => !v); setMaximized(false) }}
          aria-expanded={visible}
          className="flex-1 min-h-[44px] px-3 py-2 flex items-center justify-between gap-2 text-sm font-medium text-slate-700"
        >
          <span>🗺️ {title}</span>
          <span className="shrink-0 text-xs text-slate-500">{visible ? '地図を隠す' : '地図を表示'}</span>
        </button>
        {showWindowControls && visible && (
          <>
            <button
              type="button"
              onClick={() => setMaximized((m) => !m)}
              aria-label={maximized ? '地図を元の大きさに戻す' : '地図を最大化'}
              title={maximized ? '元の大きさに戻す' : '最大化'}
              className="grid h-11 w-11 shrink-0 place-items-center text-slate-600 hover:bg-slate-100"
            >
              {maximized ? (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="8" y="8" width="12" height="12" />
                  <path d="M4 16V6a2 2 0 0 1 2-2h10" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="5" y="5" width="14" height="14" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setMaximized(false); setVisible(false) }}
              aria-label="地図を閉じる"
              title="閉じる"
              className="grid h-11 w-11 shrink-0 place-items-center text-slate-600 hover:bg-red-500 hover:text-white"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        )}
      </div>
      {visible && (
        <div className={maximized ? 'flex-1 min-h-0' : undefined}>
          <MobileResultsMap
            kind={kind}
            onMarkerClick={onMarkerClick}
            selection={selection}
            results={results}
            fitPoiDensity={fitPoiDensity}
            bbox={bbox}
            heightStorageKey={heightStorageKey}
            fillHeight={maximized}
          />
        </div>
      )}
    </div>
  )
}
