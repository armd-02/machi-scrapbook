import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import MobileFacilityCard from './MobileFacilityCard'
import MemochoTrash from './MemochoTrash'
import CollapsibleResultsMap from './CollapsibleResultsMap'
import { useMemocho } from '../../hooks/useMemocho'
import { useFacilityMapSelection } from '../../hooks/useFacilityMapSelection'
import { memochoKeyOf, activeItems } from '../../utils/memocho'
import { captureMapImage } from '../../utils/mapCapture'
import { linkifySegments } from '../../utils/linkify'
import { cuisineFacetValues } from '../../utils/resultFilters'
import { DEFAULT_MEMO_FILTERS, applyMemochoFilters, isMemoFilterActive } from '../../utils/memochoFilters'
import {
  FilterInput, FilterSelect, WifiPowerRow, CategorySelect, CuisineChips,
  RatingStarsRow, PairedFilterRow, KEYWORD_LABEL, WHEELCHAIR_OPTIONS
} from '../ResultFilterBar'
import { useScrapbooks } from '../../hooks/useScrapbooks'
import { normalizeBookId, DEFAULT_BOOK_ID, MAX_BOOKS } from '../../utils/scrapbooks'
import { useCmmSync } from '../../hooks/useCmmSync'
import { cmmToMs } from '../../utils/cmmSync'
import { takeCmmOsmReturn } from '../../utils/cmmOsmSession'
import { publicMapUrl } from '../../utils/publicMapUrl'
import CmmLoginDialog from '../CmmLoginDialog'
import CmmSyncResultPanel from '../CmmSyncResultPanel'

/**
 * (まちメモ帳 第3ピース) まちメモ帳セクション
 *
 * 保存済みの施設を検索結果と同じ MobileFacilityCard で表示する。
 * 施設情報やサムネイルのタップでメモマップのピンを選択する。
 *
 * - 各カードに複数行メモ欄: 未編集中は表示モード（改行を保持して描画し、http(s)://
 *   URL を target=_blank のリンク化）、タップで編集モード（複数行 textarea）に切替、
 *   フォーカスを外すと setMemo で保存される
 * - 各カードに星5つの評価行（メモ欄の上）: 星をタップして 1〜5 を設定できる。
 *   現在の値と同じ星をタップすると 0（未評価）に解除される
 * - カード右上の✕ボタンは2段階確認（1回目で「削除しますか？（ごみ箱へ移動します）」
 *   の確認_stripが出、2回目で実行）。実行すると論理削除（deletedAt を付け
 *   ごみ箱へ移動）され、通常の一覧からは消える（自動で期限切れ削除されない）
 * - ごみ箱ビュー（view='trash'）: ヘッダーメニューの「ごみ箱」から入ると
 *   MemochoTrash を代わりに描画する（復元・完全削除・ごみ箱を空にする・
 *   一覧に戻る）。view/onViewChange は App reducer の memochoView と連動する
 * - 書き出し（JSON/CSV）・読み込み・全消去は、#79 でヘッダー右端の
 *   ハンバーガーメニュー（HeaderMenu）に統一されたため、本コンポーネントには
 *   メニューボタン・ファイル入力は持たない
 *
 * - フィルタバー（まちメモ帳絞り込み）: 見出しの下にフィルタUIを置く。状態は
 *   メモ帳ローカル（本コンポーネントの useState）で、アプリ全体の
 *   resultFilters（App reducer）とは混ぜないため、検索一覧や書き出しには
 *   影響しない。絞り込みロジックは検索一覧と完全に統一されており
 *   （(共通フィルタバー) utils/resultFilters.js の applyResultFilters 等を
 *    utils/memochoFilters.js が薄いアダプタとして再利用）、以下の条件は
 *   すべて AND 結合:
 *   - キーワード（nameFilter）: 名前（name / name:ja）とメモ本文の対象にした部分一致
 *   - カテゴリ（catFilter）: 一覧と同じ categoryMatchesElement
 *   - 料理の種別（cuisine）: アイテムの tags.cuisine を cuisineFacetValues で集計
 *   - WiFi（wifi）: internet_access タグの3状態判定（wifiStatus）。あり＝'yes'、
 *     なし＝'no'。未登録（unknown）はどちらにも含めない
 *   - 電源（power）: powerSupply タグの3状態判定（powerStatus）。「あり」＝'yes' のみ
 *   - 車椅子対応（wheelchair）: しきい値型の単一選択（all / gte_partial / gte_yes）。
 *     一部対応以上＝yes/designated/limited、対応可のみ＝yes/designated。未登録は絞り込み時に除外
 *   - ★評価（rating）: rating フィールド（0＝未評価）ベース。★N以上＝rating >= N、
 *     ★5のみ＝rating === 5。未評価（0）は「すべて」にのみ該当。UIは星ボタン5つ
 *     （カードの★評価行と同じ見た目・操作: 星nを押すと★N以上、同じ星を再タップで解除）
 *   - 絞り込み中は見出しの件数が「全n件中 m件を表示」になり、キーワード行の入力欄の
 *     右側に全条件を一括解除するシンボル（✕・aria-label「フィルタをクリア」）が出る
 *     （右側の固定幅スロットは常時確保されるため、表示・非表示でレイアウトがずれない）
 *
 * - スクラップブックバー（(スクラップブック) ピース2）: メモマップの上（スクロールしない
 *   固定領域）にブックの切り替え・管理バー（ScrapbookBar）を置く。
 *   - セレクトボックス「すべて」＋各ブック（デフォルト先頭）で単一選択。選択中のブックの
 *     メモだけリスト・マップに表示される（「すべて」なら全部）。従来のフィルタ条件と
 *     AND 結合して適用される。選択は localStorage（machi-memocho-book-filter）に
 *     保存され次回も維持される（stale な選択は「すべて」にフォールバック）
 *   - 「カテゴリ管理」ボタン: 新規作成（作ったら選択状態にする）・名前を変更
 *     （選択中のブック・「すべて」選択中は不可）・削除（選択中のブック・2段階確認・
 *     そのブックのメモはすべて「デフォルト」へ移動）。「デフォルト」は削除不可。
 *   - ごみ箱ビュー（view='trash'）にはバーを出さない
 *
 * - カテゴリ編集モード（ピース3）: カード一覧の直前で開始・終了する。
 *   モード ON のとき、各メモカードの下部に所属
 *   ブックの変更 UI（「カテゴリ」ラベル＋セレクトボックス）が出る。現在の
 *   ブック名がセレクトに表示され、「デフォルト」を含む全ブックから選べる。
 *   変更は即座に保存される（setBook → updateBook → localStorage）。カードの
 *   通常のタップ動作（詳細を開く）と干渉しない位置（施設カードのクリック領域の
 *   外）にある。特定のブック表示中に別のブックへ移すとその場で一覧から消え、
 *   「すべて」表示中は消えず所属表示だけが変わる。モード OFF のときは出さない
 *
 * - コンテキストメニュー＋最大化表示（(ピースO)）: カードを右クリック（PC）または
 *   長押し（モバイル、約550ms。iOS Safari は contextmenu が発火しないため）すると、
 *   その地点（画面端ではビューポート内に収まるようクランプ）に fixed ポップアップ
 *   が出る。項目は「最大化」と「登録削除」の2つ。カード内の対話要素（a, button,
 *   textarea, input, select, [role="button"]）から始まった操作では開かない。
 *   長押しで開いた直後のクリックはカードの選択処理に伝播しない。メニューの外を
 *   タップ・Escキー・スクロールで閉じる。「最大化」を選ぶとリスト画面内の
 *   オーバーレイ（fixed inset-0、背景はリスト画面と同じ slate-100、内容はスクロール
 *   可）でそのカードを大きく表示する（メモ欄の textarea は rows=12・文字サイズは
 *   大きめ。評価の星・削除の2段階確認はそのまま使える）。Escキーでも閉じる。
 *   「登録削除」を選ぶとカードの既存の2段階確認帯（ごみ箱へ移動）を表示する。
 *   最大化中にそのメモが削除されるとオーバーレイは閉じる。ごみ箱ビューでは
 *   メニューは出さない（通常の一覧のみ有効）
 */

// メモのリンクを押してもメモの編集モードに切り替えない。
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

// (CMM同期) 最終同期時刻（RFC3339）を「2026/01/18 14:32」のようなローカル表示に変換する。
// 不正な値は null
function formatLastSyncAt(rfc) {
  const ts = cmmToMs(rfc)
  if (ts == null) return null
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// (スクラップブックバー) 選択中のブックを localStorage に保存するキー
const BOOK_FILTER_STORAGE_KEY = 'machi-memocho-book-filter'

// 地図サムネイルの生成を試行済みのキー（セッション内のみ。失敗の再試行防止）
const attemptedMapKeys = new Set()

export default function MemochoSection({ view = 'list', onViewChange }) {
  // items = 全件（アクティブ＋ごみ箱）/ active = アクティブ（deletedAt 無し）のみ
  const {
    items, active, trashItems: trashList,
    remove, trash: trashItem, restore, emptyTrash,
    setMemo, setMapImage, setRating, moveBook, setBook,
  } = useMemocho()

  const [memoDrafts, setMemoDrafts] = useState({}) // { [key]: 編集途中のメモ }
  // (まちメモ帳絞り込み) フィルタ状態はメモ帳ローカル。
  // アプリ全体の resultFilters（App reducer）とは混ぜない（検索一覧・書き出しに影響しない）
  const [memoFilters, setMemoFilters] = useState(DEFAULT_MEMO_FILTERS)

  // (スクラップブック) ブック管理（モジュールレベルストア・他コンポーネントと共有）
  const { books, create: createBook, rename: renameBook, remove: removeBook, setPublic: setBookPublic } = useScrapbooks()

  const cmmSync = useCmmSync()
  const [loginOpen, setLoginOpen] = useState(false)
  const [callbackError, setCallbackError] = useState(null)
  const [completingLogin, setCompletingLogin] = useState(false)

  useEffect(() => {
    const returned = takeCmmOsmReturn()
    if (!returned) return
    setCompletingLogin(true)
    returned.then(async ({ session, error }) => {
      if (error) {
        setCallbackError(error.message)
        setLoginOpen(true)
      } else {
        await cmmSync.runSync(session)
      }
    }).finally(() => setCompletingLogin(false))
  }, [cmmSync.runSync])

  // (スクラップブックバー) 選択中のブック（'all' ＝ すべて）。localStorage に保存され、
  // 次回開いたときも維持される
  const [bookFilter, setBookFilter] = useState(() => {
    try {
      const raw = localStorage.getItem(BOOK_FILTER_STORAGE_KEY)
      if (raw == null) return 'all'
      return raw === 'all' ? 'all' : normalizeBookId(raw)
    } catch {
      return 'all'
    }
  })
  // 選択中のブックが削除済み（stale な選択）の場合は「すべて」にフォールバックする
  const effectiveBookFilter =
    bookFilter === 'all' ? 'all' : books.some((b) => b.id === bookFilter) ? bookFilter : 'all'

  // ブック選択を localStorage に保存する（保存失敗は無視・表示中の状態は維持）
  const selectBook = (id) => {
    setBookFilter(id)
    try {
      localStorage.setItem(BOOK_FILTER_STORAGE_KEY, id)
    } catch {
      // 無視（表示中の状態は維持される）
    }
  }

  // カード一覧でカテゴリ編集を開始・終了する。
  const [categoryEdit, setCategoryEdit] = useState(false)

  // (スクラップブックバー) ブックを削除する: そのブックのメモ（ごみ箱含む）をすべて
  // 「デフォルト」へ移してからブックを削除する
  const handleDeleteBook = (bookId) => {
    if (bookId !== DEFAULT_BOOK_ID) moveBook(bookId, DEFAULT_BOOK_ID)
    return removeBook(bookId)
  }

  // 選択中ブックのアクティブメモ件数（削除確認に表示する）
  const selectedBookCount = useMemo(
    () => (effectiveBookFilter === 'all' ? 0
      : active.filter((it) => (it.bookId ?? 'default') === effectiveBookFilter).length),
    [active, effectiveBookFilter]
  )

  // (スクラップブック) ブック絞り込み: 選択中のブックのアイテムに絞り、その上で
  // 従来のフィルタ条件を AND 結合して適用する。bookId 無いアイテムは「デフォルト」
  // への所属とみなす。対象はアクティブアイテムのみ（ごみ箱は対象外）
  const bookFiltered = useMemo(
    () => (effectiveBookFilter === 'all'
      ? active
      : active.filter((it) => (it.bookId ?? 'default') === effectiveBookFilter)),
    [active, effectiveBookFilter]
  )

  // 絞り込んだ一覧: ブック絞り込み＋従来の条件すべて AND 結合（ロジックは
  // utils/memochoFilters の純粋関数 applyMemochoFilters）
  const filtered = useMemo(
    () => applyMemochoFilters(bookFiltered, memoFilters),
    [bookFiltered, memoFilters]
  )

  const cuisineFacets = useMemo(() => cuisineFacetValues(
    applyMemochoFilters(bookFiltered, { ...memoFilters, cuisine: '' }),
    10,
    memoFilters.cuisine,
  ), [bookFiltered, memoFilters])

  // いずれかの条件が有効なら「絞り込み中」（純粋関数 isMemoFilterActive＋ブック選択）
  const filtersActive = isMemoFilterActive(memoFilters) || effectiveBookFilter !== 'all'

  // 「フィルタをクリア」: 従来のフィルタ条件＋ブック選択（「すべて」）をまとめてリセット
  const resetMemoFilters = () => {
    setMemoFilters(DEFAULT_MEMO_FILTERS)
    selectBook('all')
  }

  // (ピースO) コンテキストメニュー: カードの右クリック/長押しでポップアップ
  // （fixed 表示）。状態は { key, left, top }、null なら閉じている
  const [contextMenu, setContextMenu] = useState(null)
  const contextMenuRef = useRef(null)

  // (ピースO) 最大化表示: 最大化中のカードのキー（null なら非表示）
  const [maximizedKey, setMaximizedKey] = useState(null)

  // (ピースO) 削除の2段階確認: 確認帯を表示中のカードのキー（null なら表示なし）
  const [deleteConfirmKey, setDeleteConfirmKey] = useState(null)

  const closeContextMenu = () => setContextMenu(null)

  // (ピースO) メニューをクリック位置に開く。画面端ではビューポート内に収まるよう
  // クランプする（メニューサイズは概算 152×88）。長押しで開いた直後に contextmenu
  // が再発した場合は同じキーなので再表示しない（二重表示防止）
  const handleOpenContextMenu = (key, x, y) => {
    setContextMenu((m) => {
      if (m && m.key === key) return m
      const vw = window.innerWidth || document.documentElement.clientWidth
      const vh = window.innerHeight || document.documentElement.clientHeight
      const left = Math.max(8, Math.min(x, vw - 152 - 8))
      const top = Math.max(8, Math.min(y, vh - 88 - 8))
      return { key, left, top }
    })
  }

  // (ピースO) メニューを閉じる: メニュー外のタップ、Escキー、スクロール
  useEffect(() => {
    if (!contextMenu) return
    const onPointerDown = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) closeContextMenu()
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    const onScroll = () => closeContextMenu()
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll)
    }
  }, [contextMenu])

  // (ピースO) 最大化オーバーレイは Esc キーでも閉じる
  useEffect(() => {
    if (!maximizedKey) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMaximizedKey(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [maximizedKey])

  // (ピースO) 削除実行時: 確認帯を閉じ、そのメモが最大化中ならオーバーレイも閉じる
  const handleRemove = (key) => {
    setDeleteConfirmKey(null)
    if (maximizedKey === key) setMaximizedKey(null)
    return trashItem(key)
  }

  // (メモマップ) ピンになるのは座標を持つアイテムのみ（無いものはカードだけ表示）
  const mapItems = useMemo(
    () => filtered.filter((it) => it.lat != null && it.lon != null),
    [filtered]
  )

  const { selection, selectedKey, selectFacility, selectPin } = useFacilityMapSelection(filtered)

  // メモマップのピンタップ: カードが表示されているならスクロールして選択する。
  // カードが非表示（フィルタ除外）なら何もしない。
  const handlePinSelect = useCallback((item) => {
    const key = selectPin(item)
    if (!key) return
    const el = document.getElementById(`memocho-card-${key}`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectPin])

  // 地図サムネイル: 座標があり未生成のアイテムを1件ずつ順番に生成して保存する。
  // 失敗したアイテムはセッション内では再試行しない（attemptedMapKeys）。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // アクティブアイテムのみを対象にする（ごみ箱のアイテムには生成しない）
      for (const item of activeItems(items)) {
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

  // ごみ箱ビュー（ヘッダーメニューの「ごみ箱」で memochoView が 'trash' になる）。
  // 通常の一覧ではなく MemochoTrash を描画する
  if (view === 'trash') {
    return (
      <MemochoTrash
        items={trashList}
        onRestore={restore}
        onRemove={remove}
        onEmptyTrash={emptyTrash}
        onBack={() => onViewChange && onViewChange('list')}
      />
    )
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
    // レイアウトは検索結果画面（MobileListTab）に合わせる: フル高さ flex（h-full flex flex-col）で
    // メモマップを画面一番上に固定（shrink-0）、その下の flex-1 overflow-y-auto エリアで
    // 見出し・件数・フィルタ・カードリストが独立スクロールする（地図はスクロールしない）
    <section aria-label="まちメモ帳" className="h-full flex flex-col bg-slate-100 [container-type:size]">
      {/* (スクラップブックバー) メモマップの上（スクロールしない固定領域）に置く。
          ブックの切り替え＋新規作成・名前変更・削除。
          ごみ箱ビューにはバーを出さない（view='trash' は上の早期 return） */}
      <div className="shrink-0 px-3 pt-3">
        <ScrapbookBar
          books={books}
          bookFilter={effectiveBookFilter}
          onSelectBook={selectBook}
          onCreate={createBook}
          onRename={renameBook}
          onSetPublic={setBookPublic}
          onDelete={handleDeleteBook}
          bookCount={selectedBookCount}
          onSyncClick={() => {
            setCallbackError(null)
            setLoginOpen(true)
          }}
          syncing={completingLogin || cmmSync.syncing}
          lastSyncAt={cmmSync.lastSyncAt}
          syncResult={cmmSync.result}
          onSyncClose={cmmSync.dismissResult}
          lastUserId={cmmSync.lastUserId}
        />
      </div>

      {/* (メモマップ) スクラップブックバーの下（見出し・フィルタより上）に固定。
          検索結果マップと同じ折りたたみ式。ピンタップで対応カードへスクロール＋選択。
          座標を持つアイテムが1件以上あるときだけ表示される（ごみ箱ビューには地図を出さない）。
          (スクラップブックバー) バーが地図の上部に固定領域として入るため、地図の
          最大高さの計算からバーの高さ（約5rem）を引いて従来とほぼ同じ表示面積を維持する */}
      {mapItems.length > 0 && (
        <div className="shrink-0 px-3 pt-3 [--results-map-max-height:max(0px,calc(100cqh_-_12rem_-_5rem))]">
          <CollapsibleResultsMap
            title="メモマップ"
            results={mapItems}
            onMarkerClick={handlePinSelect}
            selection={selection}
            heightStorageKey="mapHeight.memocho"
          />
        </div>
      )}

      {/* 見出し・件数・フィルタ・カードリスト: 独立スクロール（地図は上部に固定される） */}
      <div className="flex-1 overflow-y-auto overscroll-y-contain min-h-0 px-3 py-3 space-y-3">
        {/* 見出し＋件数（#79: ☰メニューはヘッダーの HeaderMenu に統一） */}
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">まちメモ帳</h2>
          <span className="text-xs text-slate-500">
            {filtersActive
              ? `全${active.length.toLocaleString()}件中、${filtered.length.toLocaleString()}件を表示`
              : `${active.length}件`}
          </span>
        </div>

        {/* (共通フィルタバー) コントロール・選択肢・CSSクラス構成は ResultFilterBar に集約
            （検索一覧と共用）。状態はメモ帳ローカルで、検索結果の resultFilters とは
            独立している（キー名は resultFilters と統一） */}
        {active.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
            {/* キーワード行: 見出し文言「キーワード」は除去（プレースホルダで意味が
                伝わるため）。右側はフィルタ全クリアシンボル（✕）の固定スロットを
                常時確保し、絞り込み中はシンボルが出てクリックで全条件を一括解除
                （表示・非表示でレイアウトがずれない） */}
            <FilterInput
              label={KEYWORD_LABEL}
              value={memoFilters.nameFilter}
              onChange={(e) => setMemoFilters((f) => ({ ...f, nameFilter: e.target.value }))}
              filter="keyword"
              heading={null}
              showClearAll={filtersActive}
              onClearAll={resetMemoFilters}
            />
            <WifiPowerRow
              wifiValue={memoFilters.wifi}
              onWifiChange={(v) => setMemoFilters((f) => ({ ...f, wifi: v }))}
              powerValue={memoFilters.power}
              onPowerChange={(v) => setMemoFilters((f) => ({ ...f, power: v }))}
            />
            <PairedFilterRow>
              <FilterSelect
                label="車椅子対応で絞る"
                value={memoFilters.wheelchair}
                onChange={(e) => setMemoFilters((f) => ({ ...f, wheelchair: e.target.value }))}
                filter="wheelchair"
                className="flex-[1_1_10.5rem] min-w-0"
              >
                {WHEELCHAIR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </FilterSelect>
              <RatingStarsRow
                value={memoFilters.rating}
                onChange={(v) => setMemoFilters((f) => ({ ...f, rating: v }))}
              />
            </PairedFilterRow>
            <CategorySelect
              items={activeItems(items)}
              value={memoFilters.catFilter || ''}
              onChange={(e) => setMemoFilters((f) => ({ ...f, catFilter: e.target.value }))}
            />
            {/* 料理の種別: アイテムに cuisine タグがあるときだけ行を表示（一覧タブと同じ
                CuisineChips 共用・折りたたみ式） */}
            <CuisineChips
              facets={cuisineFacets}
              value={memoFilters.cuisine || ''}
              onChange={(v) => setMemoFilters((prev) => ({ ...prev, cuisine: v }))}
            />
          </div>
        )}

        {(filtered.length > 0 || categoryEdit) && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCategoryEdit((editing) => !editing)}
              className={`min-h-[44px] rounded-lg border px-3 text-sm font-medium ${
                categoryEdit
                  ? 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700'
                  : 'border-primary-200 bg-white text-primary-700 hover:bg-primary-50'
              }`}
            >
              {categoryEdit ? 'カテゴリ変更を終了' : 'メモのカテゴリを変更'}
            </button>
          </div>
        )}
        {/* 一覧（0件のときは案内文、絞り込みで0件のときはリセット案内） */}
        {active.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center">
            {EMPTY_TEXT}
          </p>
        ) : filtered.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center space-y-2">
            <p className="text-sm text-amber-800">現在の絞り込み条件に一致するアイテムはありません。</p>
            <button
              type="button"
              onClick={resetMemoFilters}
              className="min-h-[44px] px-4 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg"
            >
              フィルタをリセット
            </button>
          </div>
        ) : (
          <div className="card-grid">
            {filtered.map((item) => {
              const key = memochoKeyOf(item)
              // (ピースO) 最大化中のカードはオーバーレイに表示するため、一覧からは除外する
              if (key === maximizedKey) return null
              return (
                <MemochoCard
                  key={key}
                  item={item}
                  onSelect={selectFacility}
                  draft={memoDrafts[key]}
                  onDraftChange={onDraftChange}
                  onDraftCommit={onDraftCommit}
                  onSetRating={setRating}
                  // 論理削除: deletedAt を付けてごみ箱へ移動する
                  onRemove={handleRemove}
                  selected={selectedKey === key}
                  // (カテゴリ編集モード) ON のときだけカードに所属ブックの変更 UI を出す
                  books={books}
                  editMode={categoryEdit}
                  onSetBook={setBook}
                  // (ピースO) 削除の確認帯はセクション側で状態を管理（コンテキストメニューの
                  // 「登録削除」からも表示できるため）
                  confirmDelete={deleteConfirmKey === key}
                  onConfirmDeleteShow={() => setDeleteConfirmKey(key)}
                  onConfirmDeleteHide={() => setDeleteConfirmKey(null)}
                  // (ピースO) 右クリック/長押しでコンテキストメニューを開く
                  onOpenContextMenu={handleOpenContextMenu}
                />
              )
            })}
          </div>
        )}
      </div>

      <CmmLoginDialog
        open={loginOpen}
        callbackError={callbackError}
        onClose={() => setLoginOpen(false)}
      />

      {/* (ピースO) コンテキストメニュー: カードの右クリック/長押しで fixed ポップアップ。
          「最大化」でカードを最大化表示、「登録削除」でカードの2段階確認帯を出す。
          メニュー外のタップ・Esc・スクロールで閉じる */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="メモカードの操作"
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg px-1.5 py-1.5"
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (contextMenu.key) setMaximizedKey(contextMenu.key)
              closeContextMenu()
            }}
            className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded"
          >
            最大化
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeContextMenu()
              if (contextMenu.key) setDeleteConfirmKey(contextMenu.key)
            }}
            className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded"
          >
            登録削除
          </button>
        </div>
      )}

      {/* (ピースO) 最大化表示: リスト画面内のオーバーレイ（fixed inset-0、背景は
          リスト画面と同じ slate-100、内容はスクロール可）。上部に「閉じる」ボタン
          （Esc キーでも閉じる）。中身は MemochoCard の再利用（maximized でメモ欄を
          大きくする）。そのメモが削除されるとオーバーレイも閉じる */}
      {maximizedKey && (
        <div className="fixed inset-0 z-50 bg-slate-100 overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-end bg-slate-100 px-3 py-2 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setMaximizedKey(null)}
              className="min-h-[44px] px-4 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
            >
              閉じる
            </button>
          </div>
          <div className="px-3 py-3">
            {active.some((it) => memochoKeyOf(it) === maximizedKey) && (
              <MemochoCard
                key={maximizedKey}
                item={active.find((it) => memochoKeyOf(it) === maximizedKey)}
                onSelect={selectFacility}
                draft={memoDrafts[maximizedKey]}
                onDraftChange={onDraftChange}
                onDraftCommit={onDraftCommit}
                onSetRating={setRating}
                onRemove={handleRemove}
                selected={selectedKey === maximizedKey}
                books={books}
                editMode={categoryEdit}
                onSetBook={setBook}
                maximized
                confirmDelete={deleteConfirmKey === maximizedKey}
                onConfirmDeleteShow={() => setDeleteConfirmKey(maximizedKey)}
                onConfirmDeleteHide={() => setDeleteConfirmKey(null)}
                onOpenContextMenu={handleOpenContextMenu}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 登録済み1件分のカード: MobileFacilityCard（同じ見た目）＋評価行＋メモ欄。
 *
 * - 施設部分とサムネイルは MobileFacilityCard で選択する。
 * - 評価行（星5つ）はメモ欄の上に置く。タップでその値を設定し、現在の値と
 *   同じ星をタップすると 0（未評価）に解除される。状態は aria-pressed で表現する
 * - 右上の✕は2段階確認: 1回目で「削除しますか？（ごみ箱へ移動します）」の確認
 *   帯がカード上部に出、削除で論理削除（ごみ箱へ）、キャンセルで戻す
 *   （window.confirm は使わない。HeaderMenu の全消去と同じ方式）
 * - メモ欄は表示モード/編集モードの2状態: 未編集中（draft なし）はメモ文字を
 *   表示モードで描画（改行保持・http(s):// URL を target=_blank のリンク化、
 *   リンクタップは stopPropagation で編集開始を防止）。表示をタップ
 *   すると編集モード（複数行 textarea・現在の値からドラフト開始・textarea は
 *   自動フォーカスされ従来の input と同等に編集が開始される）に切替し、
 *   フォーカスを外したとき（onBlur）に onDraftCommit 経由で setMemo されて確定し表示モードに戻る。
 *   評価行・メモ欄はカード枠の中に置くが、施設カード本体（クリック領域）の
 *   外に置くことで、編集操作がピン選択に伝播しない。
 */
function MemochoCard({
  item, onSelect, draft, onDraftChange, onDraftCommit, onSetRating, onRemove,
  selected = false, books = [], editMode = false, onSetBook = null,
  maximized = false, confirmDelete = false, onConfirmDeleteShow, onConfirmDeleteHide,
  onOpenContextMenu,
}) {
  const key = memochoKeyOf(item)
  const memoValue = draft != null ? draft : item.memo || ''
  const rating = item.rating ?? 0 // 旧データ（rating 無し）は未評価として扱う
  // (カテゴリ編集モード) 所属ブック ID。books に無い ID（例: 読み込みデータ）は
  // 'default' にフォールバックし、セレクトで選択肢と一致させる
  const bookValue = books.some((b) => b.id === item.bookId) ? item.bookId : 'default'
  const isEditing = draft != null
  const editRef = useRef(null)

  // (ピースO) コンテキストメニュー: 右クリック（contextmenu）または長押し（約550ms）で開く。
  // 長押し中: ポインタが10px以上動いたり、離れたり、カードを離れるとキャンセルする。
  // カード内の対話要素（a, button, textarea, input, select, [role="button"]）から
  // 始まった操作では開かない（メモ編集の textarea の長押しなどで開いてはならない）。
  // 長押しで開いた直後のクリックはカードの選択処理に伝播しないよう抑止する
  const LONG_PRESS_MS = 550
  const LONG_PRESS_MOVE_PX = 10
  const longPressRef = useRef(null)
  const suppressClickRef = useRef(false)

  const cancelLongPress = () => {
    const lp = longPressRef.current
    if (lp) {
      clearTimeout(lp.timer)
      longPressRef.current = null
    }
  }

  const isInteractiveTarget = (target) =>
    target != null && typeof target.closest === 'function' &&
    target.closest('a, button, textarea, input, select, [role="button"]') != null

  const handlePointerDown = (e) => {
    if (e.button != null && e.button !== 0) return // 左ボタンの長押しのみ
    if (isInteractiveTarget(e.target)) return
    cancelLongPress()
    longPressRef.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        longPressRef.current = null
        suppressClickRef.current = true
        if (onOpenContextMenu) onOpenContextMenu(key, e.clientX, e.clientY)
      }, LONG_PRESS_MS)
    }
  }

  const handlePointerMove = (e) => {
    const lp = longPressRef.current
    if (!lp) return
    if (Math.abs(e.clientX - lp.x) > LONG_PRESS_MOVE_PX || Math.abs(e.clientY - lp.y) > LONG_PRESS_MOVE_PX) {
      cancelLongPress()
    }
  }

  const handlePointerUp = () => cancelLongPress()

  const handleContextMenu = (e) => {
    e.preventDefault()
    if (isInteractiveTarget(e.target)) return
    if (onOpenContextMenu) onOpenContextMenu(key, e.clientX, e.clientY)
  }

  const handleClickCapture = (e) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      e.stopPropagation()
      e.preventDefault()
    }
  }

  // (ピースO) アンマウント時に未解消の長押しタイマーを消す
  useEffect(() => () => cancelLongPress(), [])

  // 編集モードへ切替たら textarea を自動フォーカス（従来の input がタップで
  // フォーカスされてキーボードが出るのと同じ体験にする）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isEditing && editRef.current) editRef.current.focus()
  }, [isEditing])

  return (
    <div
      id={`memocho-card-${key}`}
      className={`relative bg-white border rounded-xl shadow-sm overflow-hidden ${
        selected ? 'border-primary-400 ring-2 ring-primary-500' : 'border-slate-200'
      }`}
      // (ピースO) コンテキストメニュー: 右クリック・長押し（詳細は各ハンドラ参照）
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClickCapture={handleClickCapture}
    >
      {/* 2段階確認中: 上部に確認帯を表示（カード内容を押下して配置）。
          (ピースO) 状態はセクション側で管理（confirmDelete prop）: カードの✕ボタン
          でなくても、コンテキストメニューの「登録削除」からも表示できる */}
      {confirmDelete && (
        <div className="flex items-center gap-1.5 bg-red-50 border-b border-red-200 px-2 py-1.5">
          <span className="flex-1 min-w-0 text-[11px] leading-tight text-red-700">
            削除しますか？（ごみ箱へ移動します）
          </span>
          <button
            type="button"
            onClick={() => {
              onConfirmDeleteHide && onConfirmDeleteHide()
              onRemove && onRemove(key)
            }}
            className="shrink-0 min-h-[28px] px-2 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
          >
            削除
          </button>
          <button
            type="button"
            onClick={() => onConfirmDeleteHide && onConfirmDeleteHide()}
            className="shrink-0 min-h-[28px] px-2 text-[11px] text-slate-600 hover:bg-red-100 rounded"
          >
            キャンセル
          </button>
        </div>
      )}
      <MobileFacilityCard
        bare
        hideMemoToggle
        showMapThumb
        mapImage={item.mapImage ?? null}
        result={item}
        onSelect={onSelect}
      />
      {!confirmDelete && (
        <button
          type="button"
          aria-label={`${item.name}をメモ帳から削除`}
          onClick={() => onConfirmDeleteShow && onConfirmDeleteShow()}
          className={`absolute top-2 right-2 z-10 w-7 h-7 grid place-items-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 ${
            item.mapImage ? 'bg-white/90 shadow' : ''
          }`}
        >
          ✕
        </button>
      )}
      <div className="px-3 pb-3">
        {/* (カテゴリ編集モード) 所属ブックの変更 UI。モード ON のときだけ表示。
            施設カード本体のクリック領域の外（下のエリア）に置くため、カードの通常の
            タップ動作（詳細を開く）と干渉しない。変更は即座に保存される
            （onSetBook → updateBook → localStorage）。
            特定のブック表示中に別のブックへ移すと、絞り込みの対象外になり
            その場で一覧から消える。「すべて」表示中は消えず、所属表示だけが変わる */}
        {editMode && books.length > 0 && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="shrink-0 text-[11px] font-medium text-slate-500" aria-hidden="true">カテゴリ</span>
            <select
              value={bookValue}
              onChange={(e) => onSetBook && onSetBook(key, e.target.value)}
              aria-label={`${item.name}のカテゴリを変更`}
              className="min-w-0 flex-1 min-h-[44px] px-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
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
            rows={maximized ? 12 : 3}
            onChange={(e) => onDraftChange(key, e.target.value)}
            onBlur={(e) => onDraftCommit(key, e.currentTarget.value)}
            className={`w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600 resize-none leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              maximized ? 'text-sm' : 'text-xs'
            }`}
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

/**
 * (スクラップブックバー) メモマップの上（スクロールしない固定領域）に置く、
 * スクラップブックの切り替え・管理バー。
 *
 * (ピースI) レイアウトは2行構成: 1行目はブック切替セレクト（flex-1・
 * min-w-0）＋「カテゴリ管理」ドロップダウンボタン、2行目は同期ボタン
 * ＋最終同期時刻／「未同期」表示。セレクトは1行目の残り幅すべてを使い、
 * 狭い画面でも選択中のカテゴリ名が読める幅を確保する。
 *
 * - セレクトボックス: 「すべて」＋各ブック（「デフォルト」を先頭に）。単一選択で、
 *   選択中のブックのメモだけリスト・マップに表示される（「すべて」なら全部）。
 *   選択は localStorage（BOOK_FILTER_STORAGE_KEY）に保存され次回も維持される。
 *   見た目はメモ帳の絞り込みセレクト（FilterSelect）と同じ
 * - 「カテゴリ管理」ボタン（文字ラベルに「▾」を付けたドロップダウン）:
 *   新規作成・名前を変更・公開設定・削除のメニュー。
 *   - 新規作成: 名前を入力して作成し、作ったらそのブックを選択状態にする
 *   - 名前を変更: 選択中のブックの名前を変更する（「すべて」選択中は不可）
 *   - 公開設定: 選択中のブックの公開（public）を切り替える（「すべて」選択中は不可）。
 *     「デフォルト」ブックも対象。ボタンラベルが現在状態を示す（公開なら
 *     「非公開にする」、非公開なら「公開にする」）。タップで即座に保存される
 *   - 削除: 選択中のブックを削除し、そのブックのメモはすべて「デフォルト」へ
 *     移す（2段階確認）。「デフォルト」は削除できない（名前変更は可）
 * - 公開ブックはセレクトのラベルに「（公開）」が付く
 * - 「CMM 同期」ボタン（(CMM同期、ピースC)）: 押すとログインダイアログ
 *   （CmmLoginDialog）が表示され、OpenStreetMap ログイン後に同期を開始する。
 *   同期中は無効化されラベルが「同期中…」に変わる。最終同期時刻がある場合、
 *   ボタンの右に「最終: YYYY/MM/DD HH:MM」を表示する。同期完了後はバーの下に
 *   結果パネル（CmmSyncResultPanel）が表示され、✕ で閉じられる
 * - (ピースM) 非公開のカテゴリを選択中のときは、「公開地図へ反映」と「公開マップのURLをコピー」
 *   ボタンを無効化（グレーアウト）し、「選択中のカテゴリは非公開です」の注記を表示する。
 *   「すべて」選択中または公開カテゴリ選択中は従来どおり有効。最終同期時刻の表示はそのまま
 *
 * @param {Array} books 現在あるブック配列（既定ブックが先頭）
 * @param {string} bookFilter 選択中のブックID（'all' ＝ すべて）
 * @param {(id: string) => void} onSelectBook 選択の切替（'all' も可）
 * @param {(name: string) => object|null} onCreate 新規作成。作ったブックを返す
 * @param {(id: string, name: string) => boolean} onRename 名前変更
 * @param {(id: string, isPublic: boolean) => boolean} onSetPublic 公開設定の切替
 * @param {(id: string) => boolean} onDelete 削除（メモは「デフォルト」へ移動済みであること）
 * @param {number} bookCount 選択中ブックのメモ件数（削除確認の案内に使う）
 * @param {() => void} onSyncClick 同期ボタンの押下（ログインダイアログを開く）
 * @param {boolean} syncing 同期実行中か
 * @param {string|null} lastSyncAt 最終同期時刻（RFC3339 文字列）
 * @param {string|null} lastUserId 同期で使ったユーザー名（localStorage 保存）
 * @param {object|null} syncResult 直近の同期結果（syncMemos の戻り値）
 * @param {() => void} onSyncClose 同期結果パネルを閉じる
 */
function ScrapbookBar({
  books, bookFilter, onSelectBook, onCreate, onRename, onSetPublic, onDelete,
  bookCount,
  onSyncClick, syncing, lastSyncAt, syncResult, onSyncClose, lastUserId
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState('')
  const rootRef = useRef(null)

  const selected = bookFilter === 'all' ? null : (books.find((b) => b.id === bookFilter) ?? null)
  const canRename = selected != null
  const canPublish = selected != null
  const canDelete = selected != null && selected.id !== DEFAULT_BOOK_ID
  // (ピースM・拡張) 公開系ボタンは公開カテゴリを選択中のみ有効。
  // 非公開カテゴリ選択中と「すべて」選択中は無効化する（ユーザー判断 2026-11-26）
  const isPrivateSelected = selected != null && !selected.public
  const isAllSelected = selected == null
  const publishDisabled = isPrivateSelected || isAllSelected
  // (ピースH) ブック数の上限（デフォルト含む 100 冊）に達しているか
  const atBookLimit = (Array.isArray(books) ? books : []).length >= MAX_BOOKS

  const closeMenu = () => {
    setMenuOpen(false)
    setConfirmDelete(false)
    setNewName('')
    setRenameName('')
  }

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu()
      return
    }
    setConfirmDelete(false)
    setNewName('')
    setRenameName(selected ? selected.name : '')
    setMenuOpen(true)
  }

  // メニュー外をタップしたら閉じる（HeaderMenu と同じ方式。確認状態もリセット）
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    const book = onCreate(name)
    // (ピースH) 上限到達などで作成できない場合は選択・閉じを行わない
    if (!book) return
    onSelectBook(book.id)
    closeMenu()
  }

  const handleRename = () => {
    if (!selected) return
    const name = renameName.trim()
    if (!name) return
    if (onRename(selected.id, name)) closeMenu()
  }

  // 公開設定の切替。現在状態がボタンラベルに出ている（公開なら非公開へ、逆もまた然り）。
  // タップで即座に保存される（2段階確認はない）
  const handleSetPublic = () => {
    if (!selected) return
    if (onSetPublic(selected.id, !selected.public)) closeMenu()
  }

  // 2段階: 1回目で確認メッセージに切り替わり、2回目で実行する
  const handleDelete = () => {
    if (!selected) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    if (onDelete(selected.id)) {
      // 削除したブックが選択中だった場合は「すべて」に戻す
      if (bookFilter === selected.id) onSelectBook('all')
      closeMenu()
    }
  }

  const actionButtonClass =
    'shrink-0 min-h-[44px] px-3 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed'

  const copyPublicMap = async (url) => {
    setCopyFeedback('')
    try {
      await navigator.clipboard.writeText(url)
      setCopyFeedback('公開マップのURLをコピーしました')
    } catch {
      setCopyFeedback('公開マップのURLをコピーできませんでした')
    }
  }

  // (ピースL) 公開マップのURLコピーは、同期で使ったユーザーID（localStorage
  // に保存済み）を使い回す。入力欄では入力しない
  const handleCopyClick = () => {
    setCopyFeedback('')
    if (lastUserId == null || lastUserId === '') {
      setCopyFeedback('公開マップのURLは、『公開地図へ反映』をした後にコピーできます')
      return
    }
    const url = publicMapUrl(lastUserId)
    if (url == null) {
      setCopyFeedback('メールアドレス形式のIDでは公開マップのURLを作れません')
      return
    }
    copyPublicMap(url)
  }

  return (
    <div ref={rootRef} className="relative">
      {/* (ピースI) 2行構成: 1行目はセレクト＋「カテゴリ管理」ボタン、2行目は同期。
          セレクトは1行目の残り幅すべてを使える（flex-1・min-w-0） */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-col gap-2">
        {/* 1行目: ブック切替セレクト＋カテゴリ管理（ドロップダウン） */}
        <div className="flex items-center gap-2">
          {/* ブック切替セレクト: 「すべて」＋各ブック（デフォルト先頭）。
              見た目は絞り込みセレクト（FIELD_CLASS）と揃える */}
          <select
            value={bookFilter}
            onChange={(e) => onSelectBook(e.target.value)}
            aria-label="スクラップブック"
            className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="all">すべて</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.public ? '（公開）' : ''}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={toggleMenu}
            aria-label="カテゴリ管理"
            aria-expanded={menuOpen}
            className="shrink-0 min-h-[44px] px-3 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            カテゴリ管理▾
          </button>
        </div>
        {/* 2行目: 公開地図への反映・URLのコピー・最終同期時刻 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSyncClick}
            disabled={syncing || publishDisabled}
            aria-label={syncing ? '公開地図へ反映中' : '公開地図へ反映'}
            className="shrink-0 flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? (
              <span className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M21 21v-5h-5" />
              </svg>
            )}
            {syncing ? '反映中…' : '公開地図へ反映'}
          </button>
          <button
            type="button"
            onClick={handleCopyClick}
            disabled={publishDisabled}
            className="shrink-0 flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            URLをコピー
          </button>
          {/* (ピースM) 非公開カテゴリ選択中の無効化理由 */}
          {isPrivateSelected && (
            <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">
              選択中のカテゴリは非公開です
            </span>
          )}
          {/* (拡張) 「すべて」選択中の無効化理由 */}
          {isAllSelected && (
            <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">
              反映するには公開カテゴリを選んでください
            </span>
          )}
          {lastSyncAt != null && formatLastSyncAt(lastSyncAt) != null ? (
            <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">
              最終: {formatLastSyncAt(lastSyncAt)}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-slate-400 whitespace-nowrap">未同期</span>
          )}
        </div>
        {copyFeedback && <p role="status" className="text-xs text-slate-600">{copyFeedback}</p>}
      </div>

      {/* (CMM同期、ピースC) 直近の同期結果: 成功は件数サマリー（role=status）、
          エラーは kind 別の案内（role=alert）。✕ で閉じる */}
      {syncResult != null && (
        <div className="mt-1.5">
          <CmmSyncResultPanel result={syncResult} onClose={onSyncClose} />
        </div>
      )}

      {menuOpen && (
        <div
          role="menu"
          aria-label="カテゴリ管理"
          className="absolute right-0 top-full mt-1.5 w-64 z-40 bg-white border border-slate-200 rounded-xl shadow-lg p-3 space-y-3"
        >
          {/* 新規作成 */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400">カテゴリの新規作成</p>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="カテゴリ名"
                aria-label="新規カテゴリの名前"
                disabled={atBookLimit}
                className="min-w-0 flex-1 min-h-[44px] px-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-40"
              />
              <button
                type="button"
                role="menuitem"
                onClick={handleCreate}
                disabled={atBookLimit || !newName.trim()}
                className={actionButtonClass}
              >
                作成
              </button>
            </div>
            {atBookLimit && (
              <p className="text-[10px] text-amber-600" role="status">
                冊子の上限（{MAX_BOOKS}冊）に達しているため、新しいカテゴリを作れません。
              </p>
            )}
          </div>

          <div className="border-t border-slate-200" />

          {/* 名前を変更 */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400">
              {canRename ? `名前を変更（${selected.name}）` : '名前を変更'}
            </p>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="新しい名前"
                aria-label="カテゴリの名前"
                disabled={!canRename}
                className="min-w-0 flex-1 min-h-[44px] px-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-40"
              />
              <button
                type="button"
                role="menuitem"
                onClick={handleRename}
                disabled={!canRename || !renameName.trim()}
                className={actionButtonClass}
              >
                変更
              </button>
            </div>
            {!canRename && (
              <p className="text-[10px] text-slate-400">変更するブックを選択してください。</p>
            )}
          </div>

          <div className="border-t border-slate-200" />

          {/* 公開設定（CMM への公開）。現在状態がラベルに出る。即座に保存 */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400">公開設定</p>
            {selected ? (
              <button
                type="button"
                role="menuitem"
                onClick={handleSetPublic}
                className="w-full min-h-[44px] px-3 text-sm font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg"
              >
                {selected.public ? '非公開にする' : '公開にする'}
              </button>
            ) : (
              <p className="text-[10px] text-slate-400">公開設定を変更するブックを選択してください。</p>
            )}
          </div>

          <div className="border-t border-slate-200" />

          {/* 削除 */}
          {canDelete ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold tracking-wider text-slate-400">削除</p>
              {confirmDelete ? (
                <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                  <span className="flex-1 min-w-0 text-[11px] leading-tight text-red-700">
                    「{selected.name}」を削除しますか？メモ{bookCount}件が「デフォルト」へ移動します。
                  </span>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleDelete}
                    className="shrink-0 min-h-[28px] px-2 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
                  >
                    削除する
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setConfirmDelete(false)}
                    className="shrink-0 min-h-[28px] px-2 text-[11px] text-slate-600 hover:bg-red-100 rounded"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDelete}
                  className="w-full min-h-[44px] px-3 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg"
                >
                  「{selected.name}」を削除
                </button>
              )}
            </div>
          ) : selected ? (
            <p className="text-[10px] text-slate-400">「デフォルト」は削除できません（名前変更はできます）。</p>
          ) : (
            <p className="text-[10px] text-slate-400">削除するブックを選択してください。</p>
          )}
        </div>
      )}
    </div>
  )
}
