import React, { useEffect, useRef, useState } from 'react'
import MobileFacilityCard from './MobileFacilityCard'
import { useMemocho } from '../../hooks/useMemocho'
import { memochoKeyOf } from '../../utils/memocho'
import { captureMapImage } from '../../utils/mapCapture'
import { linkifySegments } from '../../utils/linkify'

/**
 * (まちメモ帳 第3ピース) まちメモ帳セクション
 *
 * モバイル「その他」タブの先頭に置く。保存済みの施設を
 * MobileFacilityCard と同じ見た目のカードで一覧表示する（スナップショットを
 * result として渡す）。カードタップで施設詳細シートが開く（onOpenDetail prop）。
 *
 * - 各カードに複数行メモ欄: 未編集中は表示モード（改行を保持して描画し、http(s)://
 *   URL を target=_blank のリンク化）、タップで編集モード（複数行 textarea）に切替、
 *   フォーカスを外すと setMemo で保存される
 * - 各カードに星5つの評価行（メモ欄の上）: 星をタップして 1〜5 を設定できる。
 *   現在の値と同じ星をタップすると 0（未評価）に解除される
 * - カード右上の✕ボタンで登録を削除できる
 * - 書き出し（JSON/CSV）・読み込み・全消去は、#79 でヘッダー右端の
 *   ハンバーガーメニュー（HeaderMenu）に統一されたため、本コンポーネントには
 *   メニューボタン・ファイル入力は持たない
 */

// リンクタップ時のイベント伝播を止める（編集モードへの切替・詳細シート展開を防止）
const stopMemoLink = (e) => e.stopPropagation()

/**
 * 表示モード用のメモ描画: 文字列を linkifySegments で分割し、
 * http:// / https:// で始まる URL を <a>（target=_blank・rel=noopener）に変換する。
 * 改行はコンテナの whitespace-pre-wrap で保持される。
 */
function renderMemoWithLinks(memo) {
  return linkifySegments(memo).map((seg, i) =>
    seg.type === 'url' ? (
      <a
        key={i}
        href={seg.value}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopMemoLink}
        className="text-primary-600 underline"
      >
        {seg.value}
      </a>
    ) : (
      <React.Fragment key={i}>{seg.value}</React.Fragment>
    )
  )
}

const EMPTY_TEXT = 'まだ登録がありません。施設のカードや詳細の「メモ帳に追加」から登録できます。'

// 地図サムネイルの生成を試行済みのキー（セッション内のみ。失敗の再試行防止）
const attemptedMapKeys = new Set()

export default function MemochoSection({ onOpenDetail }) {
  const { items, remove, setMemo, setMapImage, setRating } = useMemocho()

  const [memoDrafts, setMemoDrafts] = useState({}) // { [key]: 編集途中のメモ }

  // 地図サムネイル: 座標があり未生成のアイテムを1件ずつ順番に生成して保存する。
  // 失敗したアイテムはセッション内では再試行しない（attemptedMapKeys）。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const item of items) {
        if (cancelled) return
        const key = memochoKeyOf(item)
        if (item.mapImage || item.lat == null || item.lon == null) continue
        if (attemptedMapKeys.has(key)) continue
        attemptedMapKeys.add(key)
        const url = await captureMapImage(item.lat, item.lon)
        // 生成中に items が変わり effect が再実行（クリーンアップ）されても、
        // 取得できた画像は保存する。キーが既に削除されていれば
        // updateMapImage 側で対象なしとなり無視される
        if (url) setMapImage(key, url)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

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
    <section aria-label="まちメモ帳" className="@container bg-white border-b border-slate-200">
      {/* 見出し＋件数（#79: ☰メニューはヘッダーの HeaderMenu に統一） */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="text-sm font-bold text-slate-800">まちメモ帳</h2>
        <span className="text-xs text-slate-500">{items.length}件</span>
      </div>

      {/* 一覧（0件のときは案内文） */}
      <div className="px-3 pb-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center">
            {EMPTY_TEXT}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 @min-[620px]:grid-cols-2 @min-[980px]:grid-cols-3 @min-[1340px]:grid-cols-4">
            {items.map((item) => (
              <MemochoCard
                key={memochoKeyOf(item)}
                item={item}
                onOpenDetail={onOpenDetail}
                draft={memoDrafts[memochoKeyOf(item)]}
                onDraftChange={onDraftChange}
                onDraftCommit={onDraftCommit}
                onSetRating={setRating}
                onRemove={remove}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * 登録済み1件分のカード: MobileFacilityCard（同じ見た目）＋評価行＋メモ欄。
 *
 * - カード本体タップで施設詳細シートが開く（onOpenDetail）。地図サムネイルのタップでも開く
 * - 評価行（星5つ）はメモ欄の上に置く。タップでその値を設定し、現在の値と
 *   同じ星をタップすると 0（未評価）に解除される。状態は aria-pressed で表現する
 * - メモ欄は表示モード/編集モードの2状態: 未編集中（draft なし）はメモ文字を
 *   表示モードで描画（改行保持・http(s):// URL を target=_blank のリンク化、
 *   リンクタップは stopPropagation で詳細シート・編集開始を防止）。表示をタップ
 *   すると編集モード（複数行 textarea・現在の値からドラフト開始・textarea は
 *   自動フォーカスされ従来の input と同等に編集が開始される）に切替し、
 *   フォーカスを外したとき（onBlur）に onDraftCommit 経由で setMemo されて確定し表示モードに戻る。
 *   評価行・メモ欄はカード枠の中に置くが、施設カード本体（クリック領域）の
 *   外に置くことで、編集操作が詳細シートの開閉に伝播しない。
 */
function MemochoCard({ item, onOpenDetail, draft, onDraftChange, onDraftCommit, onSetRating, onRemove }) {
  const key = memochoKeyOf(item)
  const memoValue = draft != null ? draft : item.memo || ''
  const rating = item.rating ?? 0 // 旧データ（rating 無し）は未評価として扱う
  const isEditing = draft != null
  const editRef = useRef(null)

  // 編集モードへ切替たら textarea を自動フォーカス（従来の input がタップで
  // フォーカスされてキーボードが出るのと同じ体験にする）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isEditing && editRef.current) editRef.current.focus()
  }, [isEditing])

  return (
    <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-stretch">
        <div className={`flex-1 min-w-0 ${item.mapImage ? '' : 'pr-8'}`}>
          <MobileFacilityCard
            bare
            hideMemoToggle
            result={item}
            onOpen={(res) => onOpenDetail && onOpenDetail(res, 'memocho')}
          />
        </div>
        {item.mapImage && (
          <div
            className="relative shrink-0 w-[120px] cursor-pointer"
            role="button"
            aria-label={`${item.name}の詳細を表示`}
            onClick={() => onOpenDetail && onOpenDetail(item, 'memocho')}
          >
            <img src={item.mapImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <span className="absolute bottom-1 right-1 text-[8px] leading-tight text-right text-slate-600 bg-white/75 rounded px-0.5 pointer-events-none">
              © OpenStreetMap contributors
            </span>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={`${item.name}をメモ帳から削除`}
        onClick={() => onRemove && onRemove(key)}
        className={`absolute top-2 right-2 z-10 w-7 h-7 grid place-items-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 ${
          item.mapImage ? 'bg-white/90 shadow' : ''
        }`}
      >
        ✕
      </button>
      <div className="px-3 pb-3">
        {/* 星5つの評価行（メモ欄の上）。施設カード本体のクリック領域の外 */}
        <div
          role="group"
          aria-label={`${item.name}の評価`}
          className="flex items-center gap-0.5 mb-1.5"
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`${item.name}を${i}つ星で評価する`}
              aria-pressed={rating === i}
              onClick={() => onSetRating && onSetRating(key, rating === i ? 0 : i)}
              className={`shrink-0 text-sm leading-none p-0.5 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                i <= rating ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'
              }`}
            >
              {i <= rating ? '★' : '☆'}
            </button>
          ))}
        </div>
        {/* 複数行メモ欄: 未編集中は表示モード（タップで編集開始）、編集中は textarea。
            改行はそのまま文字列に保持される */}
        {isEditing ? (
          <textarea
            ref={editRef}
            value={draft}
            placeholder="メモを追加"
            aria-label={`${item.name}のメモ`}
            rows={3}
            onChange={(e) => onDraftChange(key, e.target.value)}
            onBlur={(e) => onDraftCommit(key, e.currentTarget.value)}
            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 resize-none leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        ) : (
          <div
            onClick={() => onDraftChange(key, memoValue)}
            aria-label={`${item.name}のメモ`}
            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 whitespace-pre-wrap break-words leading-relaxed cursor-pointer active:bg-slate-50"
          >
            {memoValue ? renderMemoWithLinks(memoValue) : <span className="text-slate-400">メモを追加</span>}
          </div>
        )}
      </div>
    </div>
  )
}
