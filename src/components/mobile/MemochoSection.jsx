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
  RatingStarsRow, KEYWORD_LABEL, WHEELCHAIR_OPTIONS
} from '../ResultFilterBar'

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

// 地図サムネイルの生成を試行済みのキー（セッション内のみ。失敗の再試行防止）
const attemptedMapKeys = new Set()

export default function MemochoSection({ view = 'list', onViewChange }) {
  // items = 全件（アクティブ＋ごみ箱）/ active = アクティブ（deletedAt 無し）のみ
  const {
    items, active, trashItems: trashList,
    remove, trash: trashItem, restore, emptyTrash,
    setMemo, setMapImage, setRating,
  } = useMemocho()

  const [memoDrafts, setMemoDrafts] = useState({}) // { [key]: 編集途中のメモ }
  // (まちメモ帳絞り込み) フィルタ状態はメモ帳ローカル。
  // アプリ全体の resultFilters（App reducer）とは混ぜない（検索一覧・書き出しに影響しない）
  const [memoFilters, setMemoFilters] = useState(DEFAULT_MEMO_FILTERS)

  // 絞り込んだ一覧: 5条件すべて AND 結合（ロジックは utils/memochoFilters の
  // 純粋関数 applyMemochoFilters）。対象はアクティブアイテムのみ（ごみ箱は対象外）
  const filtered = useMemo(
    () => applyMemochoFilters(activeItems(items), memoFilters),
    [items, memoFilters]
  )

  const cuisineFacets = useMemo(() => cuisineFacetValues(
    applyMemochoFilters(activeItems(items), { ...memoFilters, cuisine: '' }),
    10,
    memoFilters.cuisine,
  ), [items, memoFilters])

  // いずれかの条件が有効なら「絞り込み中」（純粋関数 isMemoFilterActive）
  const filtersActive = isMemoFilterActive(memoFilters)

  const resetMemoFilters = () => setMemoFilters(DEFAULT_MEMO_FILTERS)

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
      {/* (メモマップ) 画面一番上に固定（見出し・フィルタより上）。検索結果マップと同じ
          折りたたみ式。ピンタップで対応カードへスクロール＋選択。座標を持つアイテムが
          1件以上あるときだけ表示される（ごみ箱ビューには地図を出さない） */}
      {mapItems.length > 0 && (
        <div className="shrink-0 px-3 pt-3 [--results-map-max-height:max(0px,calc(100cqh_-_12rem))]">
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
            {/* 車椅子対応: しきい値型の単一選択（すべて / 一部対応以上 / 対応可のみ） */}
            <FilterSelect
              label="車椅子対応で絞る"
              value={memoFilters.wheelchair}
              onChange={(e) => setMemoFilters((f) => ({ ...f, wheelchair: e.target.value }))}
              filter="wheelchair"
            >
              {WHEELCHAIR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </FilterSelect>
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
            {/* ★ 評価: 星ボタン5つ（カードの★評価行と同じインターフェイス）。
                星nを押すと「★n以上」で絞り込み（★5は実質★5のみ）、
                選択中にもう一度同じ星を押すと解除して「すべて」に戻る */}
            <RatingStarsRow
              value={memoFilters.rating}
              onChange={(v) => setMemoFilters((f) => ({ ...f, rating: v }))}
            />
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
          <div className="grid grid-cols-1 gap-3 @min-[620px]:grid-cols-2 @min-[980px]:grid-cols-3 @min-[1340px]:grid-cols-4">
            {filtered.map((item) => (
              <MemochoCard
                key={memochoKeyOf(item)}
                item={item}
                onSelect={selectFacility}
                draft={memoDrafts[memochoKeyOf(item)]}
                onDraftChange={onDraftChange}
                onDraftCommit={onDraftCommit}
                onSetRating={setRating}
                // 論理削除: deletedAt を付けてごみ箱へ移動する
                onRemove={trashItem}
                selected={selectedKey === memochoKeyOf(item)}
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
function MemochoCard({ item, onSelect, draft, onDraftChange, onDraftCommit, onSetRating, onRemove, selected = false }) {
  const key = memochoKeyOf(item)
  const memoValue = draft != null ? draft : item.memo || ''
  const rating = item.rating ?? 0 // 旧データ（rating 無し）は未評価として扱う
  const isEditing = draft != null
  const editRef = useRef(null)
  // 削除の2段階確認状態（1回目の✕タップで true、実行/キャンセルで false）
  const [confirmDelete, setConfirmDelete] = useState(false)

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
    >
      {/* 2段階確認中: 上部に確認帯を表示（カード内容を押下して配置） */}
      {confirmDelete && (
        <div className="flex items-center gap-1.5 bg-red-50 border-b border-red-200 px-2 py-1.5">
          <span className="flex-1 min-w-0 text-[11px] leading-tight text-red-700">
            削除しますか？（ごみ箱へ移動します）
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false)
              onRemove && onRemove(key)
            }}
            className="shrink-0 min-h-[28px] px-2 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
          >
            削除
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
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
          onClick={() => setConfirmDelete(true)}
          className={`absolute top-2 right-2 z-10 w-7 h-7 grid place-items-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 ${
            item.mapImage ? 'bg-white/90 shadow' : ''
          }`}
        >
          ✕
        </button>
      )}
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
