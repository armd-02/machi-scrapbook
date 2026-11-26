import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { AppContext } from '../../context/AppContext'
import { appReducer, createInitialState } from '../../state/appReducer'
import CollapsibleResultsMap from '../../components/mobile/CollapsibleResultsMap'
import MobileFacilityCard from '../../components/mobile/MobileFacilityCard'
import {
  FilterInput, FilterSelect, WifiPowerRow, CategorySelect, CuisineChips,
  RatingStarsRow, PairedFilterRow, KEYWORD_LABEL, WHEELCHAIR_OPTIONS
} from '../../components/ResultFilterBar'
import { useFacilityMapSelection } from '../../hooks/useFacilityMapSelection'
import { fetchActivities, toErrorObject } from '../../utils/cmmSync'
import { activityToMapItem } from '../../utils/publicMapItems'
import { memochoKeyOf } from '../../utils/memocho'
import { DEFAULT_MEMO_FILTERS, applyMemochoFilters, isMemoFilterActive } from '../../utils/memochoFilters'
import { cuisineFacetValues } from '../../utils/resultFilters'
import './publicMapLayout.css'

/**
 * (ピースG1) 公開マップページ（/map/）
 *
 * URL の `userid` パラメータで指定されたユーザーの CMM 同期済み
 * スクラップブックを、地図＋カード一覧で表示する独立ページ。
 *
 * URL 形: /map/?userid=<ユーザーID>
 *
 * - データソースは CMM 後端の Activity 一覧（fetchActivities・認証不要・
 *   userid でサーバー側フィルタ）。Overpass には一切アクセスしない。
 * - 各 Activity をまちメモ帳アイテムと同じ形の表示アイテムに変換する
 *   （publicMapItems.js）。
 * - PCの横長画面は左に地図、右にフィルタとカード一覧を表示する。
 *   それ以外は地図を上部に固定する。カード一覧側は独立してスクロールする。
 * - 地図のピンタップは対応するカードへスクロールして選択状態にする
 *   （まちメモ帳・検索結果と同じ挙動）。カードタップは地図のピンを
 *   選択する（双向）。
 * - カードデザインはメモ帳・検索結果で共用の MobileFacilityCard
 *   （右側に地図サムネイル・種別は情報行）。
 * - (ピースG2) フィルタ: メモ帳画面と同じフィルタバー（キーワード・
 *   種別詳細・Wi-Fi／電源・車椅子・★評価。ResultFilterBar 部品と
 *   memochoFilters のロジックを再利用）。状態はページローカル。
 *   絞り込みはカード一覧と地図のピンの両方に効く（メモ帳と同じ挙動）。
 * - (ピースG2) 「メモ帳に追加」ボタン: 検索結果カードと同じ
 *   MobileFacilityCard のトグルボタン（hideMemoToggle しない）。追加先は
 *   この端末のメモ帳のデフォルト冊子で、保存形式・重複時の扱いは検索結果
 *   からの追加と同一（useMemocho の addMemocho を再利用）。投稿の
 *   tags もそのまま保存される。
 *
 * userid が無しの場合は案内文を表示し、データ取得は行わない。
 *
 * このページは独立した Vite エントリ（map/index.html）で、メインアプリの
 * AppProvider がない。MobileResultsMap が useApp() を呼ぶため、空の
 * appReducer 状態を AppContext.Provider で包む（results prop を常に
 * 明示的に渡しているため、state 側のフォールバックは使われない）。
 */
export default function PublicMapPage() {
  const userid = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('userid')
    const value = typeof raw === 'string' ? raw.trim() : ''
    return value !== '' ? value : null
  }, [])

  const [state, dispatch] = useReducer(appReducer, createInitialState())
  // null = 読み込み中、[] = 読み込み完了（0件の場合を含む）
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  // (ピースG2) フィルタ状態はページローカル（メモ帳の memoFilters と同じ形状）
  const [memoFilters, setMemoFilters] = useState(DEFAULT_MEMO_FILTERS)

  useEffect(() => {
    if (!userid) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const activities = await fetchActivities({ userid })
        if (cancelled) return
        setItems(activities.map((a) => activityToMapItem(a)).filter(Boolean))
      } catch (err) {
        if (!cancelled) setError(toErrorObject(err))
      }
    })()
    return () => { cancelled = true }
  }, [userid])

  const listItems = items ?? []

  // (ピースG2) 絞り込み: 各条件 AND 結合（メモ帳と同じロジック）。
  // カード一覧と地図ピンの両方に適用する
  const filtered = useMemo(
    () => applyMemochoFilters(listItems, memoFilters),
    [listItems, memoFilters]
  )
  // 料理の種別チップのファセット（他の条件を適用したアイテムから集計・
  // メモ帳の CuisineChips と同じ流儀）
  const cuisineFacets = useMemo(
    () => cuisineFacetValues(applyMemochoFilters(listItems, { ...memoFilters, cuisine: '' }), 10, memoFilters.cuisine),
    [listItems, memoFilters]
  )
  const filtersActive = isMemoFilterActive(memoFilters)
  const resetMemoFilters = () => setMemoFilters(DEFAULT_MEMO_FILTERS)

  const { selection, selectedKey, selectFacility, selectPin } = useFacilityMapSelection(filtered)

  // 地図のピンタップ: カードへスクロールして選択する（まちメモ帳と同じ挙動）
  const handlePinSelect = useCallback((item) => {
    const key = selectPin(item)
    if (!key) return
    const el = document.getElementById(`map-card-${key}`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectPin])

  // 地図ピンを出すのは座標を持つアイテムのみ（座標無いものはカードだけ）。
  // (ピースG2) フィルタで除外されたアイテムはピンにも出ない
  const mapItems = filtered.filter((i) => i.lat != null && i.lon != null)

  // タブタイトルもページタイトルに合わせる
  useEffect(() => {
    if (userid) document.title = `${userid}さんの公開マップ`
  }, [userid])

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div className="h-dvh flex flex-col overflow-hidden bg-slate-100">
        <header className="shrink-0 px-3 pt-3 pb-2">
          <h1 className="text-base font-bold text-slate-800 break-words">
            {userid ? `${userid}さんの公開マップ` : 'まちのスクラップブック 公開マップ'}
          </h1>
        </header>

        {!userid ? (
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-600 space-y-2">
              <p className="font-medium text-slate-700">ユーザーIDをURLに指定してください</p>
              <p>
                URLに <code className="text-xs bg-slate-100 rounded px-1">userid</code> パラメータを付けることで、
                その人の公開スクラップブックを表示できます。
              </p>
              <p>例: /map/?userid=あなたのユーザーID</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-6" role="alert">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              公開スクラップブックを読み込めませんでした: {error.message}
            </div>
          </div>
        ) : items === null ? (
          <div className="flex-1 min-h-0 grid place-items-center">
            <p className="text-sm text-slate-500">読み込み中…</p>
          </div>
        ) : listItems.length === 0 ? (
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-6">
            <p className="text-sm text-slate-500">ユーザー「{userid}」の公開データが見つかりませんでした。</p>
          </div>
        ) : (
          <main className="public-map-layout flex min-h-0 flex-1 flex-col">
            {/* 座標を持つアイテムが1件以上あるときだけ地図を表示 */}
            {mapItems.length > 0 && (
              <div className="public-map-pane shrink-0 px-3 pt-2">
                <CollapsibleResultsMap
                  title="公開マップ"
                  initiallyOpen
                  results={mapItems}
                  onMarkerClick={handlePinSelect}
                  selection={selection}
                  heightStorageKey="mapHeight.publicmap"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto overscroll-y-contain min-h-0 min-w-0 px-3 py-3 space-y-3 [container-type:inline-size]">
              {/* (ピースG2) フィルタバー（メモ帳画面と同じ構成・部品を再利用） */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
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
                  items={listItems}
                  value={memoFilters.catFilter || ''}
                  onChange={(e) => setMemoFilters((f) => ({ ...f, catFilter: e.target.value }))}
                />
                <CuisineChips
                  facets={cuisineFacets}
                  value={memoFilters.cuisine || ''}
                  onChange={(v) => setMemoFilters((prev) => ({ ...prev, cuisine: v }))}
                />
              </div>

              <p className="text-xs text-slate-500">
                {filtersActive
                  ? `全${listItems.length.toLocaleString()}件中、${filtered.length.toLocaleString()}件を表示`
                  : `${listItems.length}件`}
              </p>

              {filtered.length === 0 ? (
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
                <ul className="card-grid">
                  {filtered.map((item) => (
                    <li key={memochoKeyOf(item)}>
                      <PublicMapCard
                        item={item}
                        onSelect={selectFacility}
                        selected={selectedKey === memochoKeyOf(item)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </main>
        )}
      </div>
    </AppContext.Provider>
  )
}

/**
 * 公開マップのカード1件: MobileFacilityCard（共通デザイン）＋
 * 評価・ブック・メモの読み取り専用表示。
 *
 * - (ピースG2) 「メモ帳に追加」ボタンは検索結果カードと同じもの
 *   （MobileFacilityCard 内蔵のトグル・useMemocho の addMemocho を利用）。
 *   追加先はこの端末のメモ帳のデフォルト冊子で、投稿の tags も保存される。
 *   既に登録済みの施設は「📝 登録済み」となり、タップで削除（ごみ箱）になる
 *   （検索結果側と同一の扱い）。
 * - 編集操作（メモ編集・評価変更）は無い。
 * - カードDOMの id は map-card-<key>（ピンタップ時のスクロール先）。
 */
function PublicMapCard({ item, onSelect, selected = false }) {
  const key = memochoKeyOf(item)
  const rating = Number.isInteger(item.rating) ? item.rating : 0
  const memo = item.memo || ''
  const hasExtra = rating > 0 || item.book !== null || memo !== ''
  return (
    <div
      id={`map-card-${key}`}
      className={`relative bg-white border rounded-xl shadow-sm overflow-hidden ${
        selected ? 'border-primary-400 ring-2 ring-primary-500' : 'border-slate-200'
      }`}
    >
      <MobileFacilityCard bare showMapThumb result={item} onSelect={onSelect} />
      {hasExtra && (
        <div className="px-3 pb-3 space-y-1">
          {rating > 0 && (
            <p className="text-xs leading-none text-amber-500" aria-label={`評価 ${rating} / 5`}>
              {'★'.repeat(rating)}
              {'☆'.repeat(5 - rating)}
            </p>
          )}
          {item.book && (
            <p className="text-xs text-slate-600 break-words">
              <span className="text-slate-400">ブック</span>
              <span className="ml-1">{item.book}</span>
            </p>
          )}
          {memo !== '' && (
            <p className="text-xs text-slate-600 whitespace-pre-line break-words">
              <span className="text-slate-400">メモ</span>
              <span className="ml-1">{memo}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
