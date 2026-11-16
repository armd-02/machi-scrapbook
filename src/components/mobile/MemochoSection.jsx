import React, { useEffect, useRef, useState } from 'react'
import MobileFacilityCard from './MobileFacilityCard'
import { useMemocho } from '../../hooks/useMemocho'
import { memochoKeyOf, serializeMemocho, parseMemochoJSON } from '../../utils/memocho'
import { toCSV, downloadFile } from '../../utils/export'

/**
 * (まちメモ帳 第3ピース) まちメモ帳セクション
 *
 * モバイル「その他」タブの先頭に置く。保存済みの施設を
 * MobileFacilityCard と同じ見た目のカードで一覧表示する（スナップショットを
 * result として渡す）。カードタップで施設詳細シートが開く（onOpenDetail prop）。
 *
 * - 各カードにメモ欄（テキスト入力）: その場で編集でき、フォーカスを外すと
 *   setMemo で保存される
 * - カード内の「📝 登録済み」ボタンで削除できる（第2ピースの toggle 機構）
 * - 見出し右端の ☰ サンドイッチメニュー（aria-label「まちメモ帳メニュー」）:
 *     - JSONで書き出し: serializeMemocho → machi-memocho.json
 *     - CSVで書き出し:  toCSV（includeMemo で末尾に memo 列を追加）→ machi-memocho.csv
 *     - 読み込み:      .json ファイル選択 → parseMemochoJSON → importItems で合流
 *     - すべて削除:    2段階確認（window.confirm は使わない）
 * - 読み込みの結果・エラーはセクション内のメッセージで表示する
 */

const EMPTY_TEXT = 'まだ登録がありません。施設のカードや詳細の「メモ帳に追加」から登録できます。'

export default function MemochoSection({ onOpenDetail }) {
  const { items, remove, setMemo, importItems } = useMemocho()

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'ok' | 'err', text }
  const [memoDrafts, setMemoDrafts] = useState({}) // { [key]: 編集途中のメモ }
  const fileInputRef = useRef(null)
  const sectionRef = useRef(null)

  const closeMenu = () => {
    setMenuOpen(false)
    setConfirmWipe(false)
  }

  // セクション外をタップしたらメニューを閉じる（2段階削除の確認もリセット）
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e) => {
      if (sectionRef.current && !sectionRef.current.contains(e.target)) closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  // ===== メニューの各アクション =====

  const onExportJSON = () => {
    downloadFile(serializeMemocho(items), 'machi-memocho.json', 'application/json')
    setNotice({ kind: 'ok', text: 'まちメモ帳をJSONとして書き出しました。' })
    closeMenu()
  }

  const onExportCSV = () => {
    // 通常の toCSV の列構成を変えず、memo 列だけ末尾に追加する
    downloadFile(toCSV(items, { includeMemo: true }), 'machi-memocho.csv', 'text/csv;charset=utf-8')
    setNotice({ kind: 'ok', text: 'まちメモ帳をCSVとして書き出しました。' })
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
    // MobileBatchMatch と同じく FileReader でファイルを読み込む
    const reader = new FileReader()
    reader.onerror = () => setNotice({ kind: 'err', text: '読み込みに失敗しました: ファイルを読めませんでした。' })
    reader.onload = () => {
      try {
        const imported = parseMemochoJSON(String(reader.result))
        const { added, skipped } = importItems(imported)
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

  const onDeleteAll = () => {
    // 2段階: 1回目で表示が確認メッセージに切り替わり、2回目で実行する
    if (!confirmWipe) {
      setConfirmWipe(true)
      return
    }
    items.forEach((item) => remove(memochoKeyOf(item)))
    setNotice({ kind: 'ok', text: 'まちメモ帳の登録をすべて削除しました。' })
    closeMenu()
  }

  // ===== メモ欄 =====

  const onDraftChange = (key, value) => {
    setMemoDrafts((d) => ({ ...d, [key]: value }))
  }

  // フォーカスを外した瞬間に保存（store・localStorage へ反映）
  const onDraftCommit = (key, value) => {
    setMemoDrafts((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
    setMemo(key, value)
  }

  return (
    <section ref={sectionRef} aria-label="まちメモ帳" className="bg-white border-b border-slate-200">
      {/* 見出し＋件数＋☰ボタン */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="text-sm font-bold text-slate-800">まちメモ帳</h2>
        <span className="text-xs text-slate-500">{items.length}件</span>
        <button
          type="button"
          aria-label="まちメモ帳メニュー"
          aria-expanded={menuOpen}
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          className="ml-auto shrink-0 w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          ☰
        </button>
      </div>

      {/* サンドイッチメニュー */}
      {menuOpen && (
        <div className="px-3 pb-2">
          <div
            role="menu"
            aria-label="まちメモ帳メニュー"
            className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100 overflow-hidden"
          >
            <button
              type="button"
              role="menuitem"
              onClick={onExportJSON}
              className="w-full min-h-[44px] px-3 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              JSONで書き出し
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onExportCSV}
              className="w-full min-h-[44px] px-3 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              CSVで書き出し
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onImportClick}
              className="w-full min-h-[44px] px-3 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              読み込み
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onDeleteAll}
              className={`w-full min-h-[44px] px-3 text-left text-sm ${
                confirmWipe
                  ? 'text-red-700 bg-red-50 font-semibold'
                  : 'text-red-600 hover:bg-slate-50'
              }`}
            >
              {confirmWipe ? '本当にすべて削除しますか？' : 'すべて削除'}
            </button>
          </div>
        </div>
      )}

      {/* 読み込み結果・エラーのメッセージ */}
      {notice && (
        <div className="px-3 pb-2">
          <p
            role="status"
            className={`text-xs rounded-lg px-2.5 py-1.5 ${
              notice.kind === 'err'
                ? 'text-red-700 bg-red-50 border border-red-200'
                : 'text-emerald-700 bg-emerald-50 border border-emerald-200'
            }`}
          >
            {notice.text}
          </p>
        </div>
      )}

      {/* 一覧（0件のときは案内文） */}
      <div className="px-3 pb-3 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center">
            {EMPTY_TEXT}
          </p>
        ) : (
          items.map((item) => (
            <MemochoCard
              key={memochoKeyOf(item)}
              item={item}
              onOpenDetail={onOpenDetail}
              draft={memoDrafts[memochoKeyOf(item)]}
              onDraftChange={onDraftChange}
              onDraftCommit={onDraftCommit}
            />
          ))
        )}
      </div>

      {/* 読み込み用の非表示ファイル入力（accept: .json） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={onFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </section>
  )
}

/**
 * 登録済み1件分のカード: MobileFacilityCard（同じ見た目）＋メモ欄。
 *
 * - カード本体タップで施設詳細シートが開く（onOpenDetail）
 * - メモ欄は入力値をローカルdraftに持ち、フォーカスを外したとき
 *   （onBlur）に onDraftCommit 経由で setMemo されて保存される。
 *   メモ欄はカードの onClick の外（シスター要素）に置くことで、
 *   編集操作が詳細シートの開閉に伝播しない。
 */
function MemochoCard({ item, onOpenDetail, draft, onDraftChange, onDraftCommit }) {
  const key = memochoKeyOf(item)
  const memoValue = draft != null ? draft : item.memo || ''

  return (
    <div className="space-y-1.5">
      <MobileFacilityCard
        result={item}
        onOpen={(res) => onOpenDetail && onOpenDetail(res, 'memocho')}
      />
      <input
        type="text"
        value={memoValue}
        placeholder="メモを追加"
        aria-label={`${item.name}のメモ`}
        onChange={(e) => onDraftChange(key, e.target.value)}
        onBlur={(e) => onDraftCommit(key, e.currentTarget.value)}
        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
      />
    </div>
  )
}
