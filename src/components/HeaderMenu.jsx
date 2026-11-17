import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useMemocho } from '../hooks/useMemocho'
import { downloadCSV, downloadGeoJSON } from '../utils/export'
import { applyResultFilters, hasActiveFilters } from '../utils/resultFilters'
import { memochoKeyOf } from '../utils/memocho'

/**
 * (#75) ヘッダーのハンバーガーメニュー
 *
 * ヘッダー右端（モバイル・PC の両シェルで共用）に ☰ ボタンを置き、
 * ドロップダウンに次の操作をまとめる:
 *   - 一覧を保存（CSV）        downloadCSV（フィルタ済み結果。旧ExportBarと同一ロジック）
 *   - GeoJSON（高度な形式）    downloadGeoJSON（同上）
 *   - まちメモ帳をすべて削除   useMemocho の remove で全件削除（MemochoSection の
 *                             onDeleteAll と同じ方式）。2段階確認（window.confirm 不使用）
 *
 * 旧ExportBar（一覧タブ・その他タブのCSV/GeoJSONボタン）はこのメニューに
 * 集約され、削除した。ODbL表記・自治体モードのファイル名prefix も
 * 引き継ぐ。保存件数表記（「3件を保存します」／フィルタ時は
 * 「全20件中、3件を保存します」）は CSV/GeoJSON 各項目に付す。
 * 項目が無効なときは「0件を保存します」と表示して理由を伝える。
 *
 * 操作後のフィードバックはメニューの代わりに位置取る短いメッセージ
 * （role="status"）で表示する。閉じる（✕）またはメニューを再度開くと消える。
 */
export default function HeaderMenu() {
  const { state } = useApp()
  const { items, remove } = useMemocho()

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'ok' | 'err', text }
  const rootRef = useRef(null)

  const { results, fetchMeta, searchSource, selectedMunicipality, resultFilters } = state

  const closeMenu = () => {
    setMenuOpen(false)
    setConfirmWipe(false)
  }

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu()
      return
    }
    setNotice(null)
    setMenuOpen(true)
  }

  // メニュー外をタップしたら閉じる（2段階削除の確認状態もリセット）。
  // MemochoSection のサンドイッチメニューと同じ機構。
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  // ===== 保存操作（旧ExportBar と同じロジック） =====
  const hasResults = !!(results && results.length > 0)
  const filtered = hasResults ? applyResultFilters(results, resultFilters) : []
  const filtersOn = hasActiveFilters(resultFilters)
  const exportDisabled = !hasResults || filtered.length === 0

  // 保存件数表記（CSV/GeoJSON 項目に共通）
  const countText = filtersOn
    ? `全${results.length}件中、${filtered.length}件を保存します`
    : `${filtered.length}件を保存します`

  // 自治体モードではファイル名に自治体名を含める（#44）
  const prefix = searchSource === 'municipality' && selectedMunicipality?.name
    ? `osm-${selectedMunicipality.displayName || selectedMunicipality.name}`
    : 'osm-results'

  const onExportCSV = () => {
    downloadCSV(filtered, fetchMeta, prefix)
    setNotice({ kind: 'ok', text: '一覧をCSVとして保存しました。' })
    closeMenu()
  }

  const onExportGeoJSON = () => {
    downloadGeoJSON(filtered, fetchMeta)
    setNotice({ kind: 'ok', text: '一覧をGeoJSONとして保存しました。' })
    closeMenu()
  }

  // ===== まちメモ帳の全消去（2段階確認） =====
  const onDeleteAll = () => {
    // 2段階: 1回目で表示が確認メッセージに切り替わり、2回目で実行する
    // （window.confirm は使わない。MemochoSection の onDeleteAll と同じ方式）
    if (!confirmWipe) {
      setConfirmWipe(true)
      return
    }
    items.forEach((item) => remove(memochoKeyOf(item)))
    setNotice({ kind: 'ok', text: 'まちメモ帳の登録をすべて削除しました。' })
    closeMenu()
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="メニュー"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
        className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
      >
        ☰
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="メニュー"
          className="absolute right-0 top-full mt-1.5 w-56 z-40 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onExportCSV}
            disabled={exportDisabled}
            className="w-full min-h-[44px] px-3 py-1.5 flex flex-col items-start gap-0.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="一覧をCSVとして保存します（Excelで開けます・UTF-8 BOM付き）"
          >
            <span>📄 一覧を保存（CSV）</span>
            <span className="text-[11px] text-slate-400">{countText}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onExportGeoJSON}
            disabled={exportDisabled}
            className="w-full min-h-[44px] px-3 py-1.5 flex flex-col items-start gap-0.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="GeoJSONとして保存（QGIS等の地図ツール向け）"
          >
            <span>GeoJSON（高度な形式）</span>
            <span className="text-[11px] text-slate-400">{countText}</span>
          </button>
          {hasResults && (
            <p className="px-3 pb-1.5 text-[10px] text-slate-400">
              ODbL / © OpenStreetMap contributors
            </p>
          )}
          <div className="border-t border-slate-200" />
          <button
            type="button"
            role="menuitem"
            onClick={onDeleteAll}
            disabled={items.length === 0}
            className={`w-full min-h-[44px] px-3 text-left text-sm disabled:opacity-40 disabled:cursor-not-allowed ${
              confirmWipe
                ? 'text-red-700 bg-red-50 font-semibold'
                : 'text-red-600 hover:bg-slate-50'
            }`}
          >
            {confirmWipe
              ? '本当にすべて削除しますか？'
              : `まちメモ帳をすべて削除${items.length > 0 ? `（${items.length}件）` : ''}`}
          </button>
        </div>
      )}

      {/* 操作後のフィードバック（メニュー閉じたときだけ表示） */}
      {notice && !menuOpen && (
        <div
          role="status"
          className={`absolute right-0 top-full mt-1.5 z-40 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs shadow-lg border ${
            notice.kind === 'err'
              ? 'text-red-700 bg-red-50 border-red-200'
              : 'text-emerald-700 bg-emerald-50 border-emerald-200'
          }`}
        >
          {notice.text}
          <button
            type="button"
            aria-label="メッセージを閉じる"
            onClick={() => setNotice(null)}
            className="opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
