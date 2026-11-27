import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useMemocho } from '../hooks/useMemocho'
import { downloadCSV, downloadGeoJSON, downloadFile, toCSV } from '../utils/export'
import { applyResultFilters, hasActiveFilters } from '../utils/resultFilters'
import { serializeMemocho, parseMemochoJSON, trashItems } from '../utils/memocho'
import { loadScrapbooks, saveScrapbooks, mergeScrapbooks, DEFAULT_BOOK_ID } from '../utils/scrapbooks'
import {
  OVERPASS_PREFERENCE_OPTIONS,
  getOverpassPreference,
  setOverpassPreference
} from '../utils/overpassPreference'

/**
 * (#75) ヘッダーのハンバーガーメニュー（#79 でアプリ唯一のハンバーガーメニューに）
 *
 * ヘッダー右端（モバイル・PC の両シェルで共用）に ☰ ボタンを置き、
 * ドロップダウンに次の操作をまとめる:
 *
 * [検索結果]（旧ExportBar と同一ロジック）
 *   - 一覧を保存（CSV）        downloadCSV（フィルタ済み結果）
 *   - GeoJSON（高度な形式）    downloadGeoJSON（同上）
 *
 * [まちメモ帳]（#79: MemochoSection 見出しの☰メニューから集約）
 *   - まちメモ帳をJSONで書き出し  serializeMemocho（items＋books）→ machi-memocho.json（アクティブ＋ごみ箱の全件）
 *   - まちメモ帳をCSVで書き出し   toCSV（includeMemo/includeRating/includeBook で末尾に memo/rating/book 列）
 *     → machi-memocho.csv。book 列はブック名（scrapbooks.js から解決）
 *     ※ CSV はアクティブ（deletedAt 無し）のみを対象にする
 *   - まちメモ帳を読み込む       .json ファイル選択 → parseMemochoJSON。
 *     ブックリスト（books）を先に合流（mergeScrapbooks、同一IDは既存を優先）し、
 *     上限（100冊）で作成されなかったブックに属するメモの bookId を
 *     「デフォルト」に落としたうえで importItems で合流する。
 *     旧形式（books なし）のファイルもそのまま読める
 *   - ごみ箱                     メモ帳タブのごみ箱ビューへ（memochoView を 'trash' に設定）
 *   - まちメモ帳をすべて削除     wipeAll でアクティブ＋ごみ箱の全件を完全削除。2段階確認（window.confirm 不使用）
 *
 * メニューは [検索結果] と [まちメモ帳] の2グループで見分けられるよう整理:
 * グループ見出し行（aria-hidden）＋区切り線（border-t）で区切る。
 * 全消去は危険操作として、まちメモ帳の他の項目からも区切り線で分離し赤字で表示。
 *
 * ODbL表記・自治体モードのファイル名prefix は旧ExportBarから引き継ぐ。
 * 保存件数表記（「3件を保存します」／フィルタ時は「全20件中、3件を保存します」）は
 * 検索結果系の CSV/GeoJSON 項目に付す。まちメモ帳の書き出し項目には「N件」を付す。
 * 項目が無効なときは「0件」系と表示して理由を伝える。
 *
 * 操作後のフィードバックはメニューの代わりに位置取る短いメッセージ
 * （role="status"）で表示する。閉じる（✕）またはメニューを再度開くと消える。
 * メッセージは ✓ / ⚠️ アイコン付き（StatusBanner の ⚠️ 表記に従い成功/エラーを区別し、
 * 狭い画面で長いメッセージが画面外にはみ出さないよう max-width＋折り返しを付す）。
 * 読み込みの結果・エラー（合流件数・無効なJSON等）もこのメッセージで通知する。
 *
 * [Overpass API]: 検索の第一候補エンドポイント切替（ラジオ2択）。
 * 「標準」= custom（armd-01）/「海外」= public（公式 overpass-api.de）。
 * 選択は localStorage（overpassPreference.js）に保存され次回起動時も維持される。
 * useSearch が検索実行時に読む。地名検索の名前検索補完（overpassNameSearch）は
 * 常に 'custom' 固定で、この切替の影響を受けない。
 * 選択は設定変更なので実行後もメニューを閉じない（選択状態がそのまま見える）。
 * private_coffee は選択肢に含まれない（フォールバック候補のままである）。
 */
export default function HeaderMenu() {
  const { state, dispatch } = useApp()
  // items = 全件（アクティブ＋ごみ箱）/ active = アクティブ（deletedAt 無し）のみ
  const { items, active, importItems, wipeAll } = useMemocho()
  const trashCount = trashItems(items).length

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'ok' | 'err', text }
  // Overpass API 切替: 初期値は localStorage から読む（未保存なら既定の 'custom'）
  const [endpointPref, setEndpointPref] = useState(() => getOverpassPreference())

  const onSelectEndpoint = (id) => {
    // 保存成功時のみ表示状態を更新（保存失敗時は従来値のまま）
    if (setOverpassPreference(id)) setEndpointPref(id)
  }
  const rootRef = useRef(null)
  const fileInputRef = useRef(null) // まちメモ帳の読み込み用（非表示ファイル入力）

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

  // ===== まちメモ帳の書き出し・読み込み（#79: MemochoSection の☰メニューから集約） =====
  const onMemochoExportJSON = () => {
    // items に加えてブックリスト（ID・名前）も書き出す（読み込み時に復元される）
    downloadFile(serializeMemocho(items, loadScrapbooks()), 'machi-memocho.json', 'application/json')
    setNotice({ kind: 'ok', text: 'まちメモ帳をJSONとして書き出しました。' })
    closeMenu()
  }

  const onMemochoExportCSV = () => {
    // 通常の toCSV の列構成を変えず、memo/rating/book 列を末尾に追加する。
    // 対象はアクティブ（ごみ箱に入っていない）アイテムのみ
    downloadFile(
      toCSV(active, { includeMemo: true, includeRating: true, includeBook: true, books: loadScrapbooks() }),
      'machi-memocho.csv',
      'text/csv;charset=utf-8'
    )
    setNotice({ kind: 'ok', text: `${active.length}件をCSVとして書き出しました。` })
    closeMenu()
  }

  const onImportClick = () => {
    closeMenu()
    if (fileInputRef.current) fileInputRef.current.click()
  }

  const onFileChange = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onerror = () => setNotice({ kind: 'err', text: '読み込みに失敗しました: ファイルを読めませんでした。' })
    reader.onload = () => {
      try {
        const { items: importedItems, books: importedBooks } = parseMemochoJSON(String(reader.result))
        // ブックリストを先に合流する（同一IDは既存を優先してスキップ）。
        // 旧形式のファイルでは importedBooks は [] なので何も起きない。
        // (ピースH) 上限（100冊）を超えるブックは作らず、そのブックに属する
        // メモの bookId は「デフォルト」に落とす（メモ自体は取り込む）
        let mergedBooks = loadScrapbooks()
        const rejectedBookIds = new Set()
        if (importedBooks.length > 0) {
          const { books, added: addedBooks, rejected } = mergeScrapbooks(loadScrapbooks(), importedBooks)
          mergedBooks = books
          rejected.forEach((book) => rejectedBookIds.add(book.id))
          if (addedBooks.length > 0) saveScrapbooks(mergedBooks)
        }
        const items = importedItems.map((item) => (
          item != null
          && typeof item.bookId === 'string'
          && item.bookId !== ''
          && rejectedBookIds.has(item.bookId)
            ? { ...item, bookId: DEFAULT_BOOK_ID }
            : item
        ))
        const { added, skipped } = importItems(items)
        const text =
          added > 0 && skipped > 0
            ? `${added}件を取り込みました（${skipped}件は登録済みのためスキップ）`
            : added > 0
              ? `${added}件を取り込みました`
              : `新しい項目はありません（${skipped}件は登録済みのためスキップ）`
        setNotice({ kind: 'ok', text })
      } catch (err) {
        setNotice({ kind: 'err', text: `読み込みに失敗しました: ${err.message}` })
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  // ===== まちメモ帳の全消去（2段階確認） =====
  // アクティブ＋ごみ箱の全件を完全に削除する（ごみ箱のアイテムも含む）
  const onDeleteAll = () => {
    // 2段階: 1回目で表示が確認メッセージに切り替わり、2回目で実行する
    // （window.confirm は使わない。MemochoSection の onDeleteAll と同じ方式）
    if (!confirmWipe) {
      setConfirmWipe(true)
      return
    }
    const count = wipeAll()
    setConfirmWipe(false)
    setNotice({ kind: 'ok', text: `まちメモ帳の登録を${count}件すべて削除しました。` })
    closeMenu()
  }

  // 「ごみ箱」: メモ帳タブのサブビューをごみ箱に切替える。
  // シェル側で memochoView が 'trash' になるとメモ帳タブへ自動切替される
  const onOpenTrash = () => {
    dispatch({ type: 'SET_MEMOCHO_VIEW', payload: 'trash' })
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
          {/* グループ見出し: 検索結果（視覚的なグルーピング用・スクリーンリーダーからは非表示） */}
          <p aria-hidden="true" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400">検索結果</p>
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
          {/* グループ見出し: Overpass API（検索の第一候補エンドポイント切替） */}
          <p aria-hidden="true" className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-slate-400">Overpass API</p>
          <div role="radiogroup" aria-label="Overpass API">
            {OVERPASS_PREFERENCE_OPTIONS.map((opt) => {
              const selected = endpointPref === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelectEndpoint(opt.id)}
                  className={`w-full min-h-[44px] px-3 py-1.5 flex flex-col items-start gap-0.5 text-left text-sm transition-colors ${
                    selected ? 'text-emerald-700 bg-emerald-50' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {/* ラジオ指示（点・輪郭） */}
                    <span
                      aria-hidden="true"
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                        selected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </span>
                    {opt.label}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="border-t border-slate-200" />
          {/* グループ見出し: まちメモ帳（視覚的なグルーピング用・スクリーンリーダーからは非表示） */}
          <p aria-hidden="true" className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-slate-400">まちメモ帳</p>
          {/* まちメモ帳系（#79: MemochoSection の☰メニューから集約） */}
          <button
            type="button"
            role="menuitem"
            onClick={onMemochoExportJSON}
            disabled={items.length === 0}
            className="w-full min-h-[44px] px-3 py-1.5 flex flex-col items-start gap-0.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="まちメモ帳をJSONファイルとして書き出します（再読み込み用）"
          >
            <span>まちメモ帳をJSONで書き出し</span>
            <span className="text-[11px] text-slate-400">{items.length}件</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onMemochoExportCSV}
            disabled={active.length === 0}
            className="w-full min-h-[44px] px-3 py-1.5 flex flex-col items-start gap-0.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="まちメモ帳をCSVとして書き出します（末尾に memo/rating 列を追加・ごみ箱のアイテムは除外）"
          >
            <span>まちメモ帳をCSVで書き出し</span>
            <span className="text-[11px] text-slate-400">{active.length}件</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onImportClick}
            className="w-full min-h-[44px] px-3 py-1.5 flex flex-col items-start gap-0.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            title="まちメモ帳のJSONファイルを読み込んで合流します"
          >
            <span>まちメモ帳を読み込む</span>
            <span className="text-[11px] text-slate-400">JSONファイルを選択</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onOpenTrash}
            className="w-full min-h-[44px] px-3 py-1.5 flex flex-col items-start gap-0.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            title="ごみ箱（論理削除されたアイテム）を表示・復元します"
          >
            <span>🗑 ごみ箱</span>
            <span className="text-[11px] text-slate-400">{trashCount}件</span>
          </button>
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

      {/* まちメモ帳の読み込み用ファイル入力（非表示・accept: .json） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={onFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* 操作後のフィードバック（メニュー閉じたときだけ表示）。
          ✓ / ⚠️ アイコン＋色分けで成功/エラーを一目で区別し、ユーザーが気付けるようにする */}
      {notice && !menuOpen && (
        <div
          role="status"
          className={`absolute right-0 top-full mt-1.5 z-40 flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs shadow-lg border max-w-[calc(100vw_-_1.25rem)] ${
            notice.kind === 'err'
              ? 'text-red-700 bg-red-50 border-red-200'
              : 'text-emerald-700 bg-emerald-50 border-emerald-200'
          }`}
        >
          <span aria-hidden="true" className="shrink-0 mt-px">
            {notice.kind === 'err' ? '⚠️' : '✓'}
          </span>
          <span className="break-words">{notice.text}</span>
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
    </div>
  )
}
