import React, { useCallback, useMemo, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { applyResultFilters, hasActiveFilters, cuisineFacetValues } from '../../utils/resultFilters'
import { activeSearchOf } from '../../state/appReducer'
import EditPanel from '../EditPanel'
import MobileFacilityCard from './MobileFacilityCard'
import CollapsibleResultsMap from './CollapsibleResultsMap'
import BarrierFreeLegend from '../BarrierFreeLegend'
import BarrierFreeSummary from './BarrierFreeSummary'
import ShareButton from '../ShareButton'
import {
  FilterInput, FilterSelect, WifiPowerRow, CategorySelect, CuisineChips,
  PairedFilterRow, KEYWORD_LABEL, WHEELCHAIR_OPTIONS
} from '../ResultFilterBar'
import AttributeCompleteness from '../AttributeCompleteness'
import WorkspacePowerWifiSummary from '../WorkspacePowerWifiSummary'
import { ATTRIBUTE_LABELS } from '../../utils/statistics'
import { barrierFreeTypeLabel, tactileStatus, lengthLabel, signalLabels } from '../../utils/barrierFreeResults'
import { kerbDetailLabel } from '../../utils/barrierFree'
import { barrierFreeToMapGeoJSON } from '../../utils/barrierFreeGeoJSON'
import { useFacilityMapSelection } from '../../hooks/useFacilityMapSelection'

/**
 * (#59) モバイル「一覧」タブ
 *
 * - 結果をカード形式で表示（施設名で地図上のピンを選択）
 * - クライアント側フィルタ: 施設名 / カテゴリ / Webサイト有無 / 並び順
 * - フィルタは AppContext（resultFilters）に保存するため、
 *   タブを離れても選択が保持される
 * - 検索0件時は専用のガイダンス（EditPanel）を表示
 * - (#75) CSV/GeoJSON 保存はヘッダーのハンバーガーメニュー（HeaderMenu）へ集約
 */

const MAX_CARDS = 500

function scrollResultCard(list, cardId) {
  const card = list?.ownerDocument.getElementById(cardId)
  if (!card || !list.contains(card)) return
  const cardBounds = card.getBoundingClientRect()
  const listBounds = list.getBoundingClientRect()
  const top = list.scrollTop + cardBounds.top - listBounds.top - (list.clientHeight - cardBounds.height) / 2
  list.scrollTo?.({ top, behavior: 'smooth' })
}

export default function MobileListTab() {
  const { state } = useApp()
  return state.resultKind === 'barrier_free' ? <BarrierFreeMobileList /> : <PoiMobileList />
}

function PoiMobileList() {
  const { state, dispatch } = useApp()
  const { results, status, resultFilters, searchSource } = state
  const { nameFilter, sortDir } = resultFilters

  // 縁石の高さ絞り込み（kerbHeight）はバリアフリー一覧専用なので、
  // 施設一覧では 'any' に固定して適用しない（旧BF検索の残値で全件が消えるのを防ぐ）
  const poiFilters = useMemo(() => ({ ...resultFilters, kerbHeight: 'any' }), [resultFilters])

  // (#44) カテゴリ選択は検索フォームと一覧フィルタを同じ値として扱う。
  // ドロップダウンの操作は検索フォームのcategoryにdispatchし、
  // reducerが resultFilters.catFilter をミラーする（データ取得後なら即絞り込み）。
  const activeSearch = activeSearchOf(state) || {}
  const searchFormType = searchSource === 'municipality' ? 'SET_MUNICIPALITY_SEARCH' : 'SET_SIMPLE_SEARCH'
  const changeCategory = (value) => dispatch({ type: searchFormType, payload: { category: value } })

  const setFilters = (patch) => dispatch({ type: 'SET_RESULT_FILTERS', payload: patch })

  // (#44) PCのResultsPanelと共通のフィルタロジック（resultFilters.js）を使う
  const filtered = useMemo(
    () => applyResultFilters(results, poiFilters),
    [results, poiFilters]
  )
  const filtersActive = hasActiveFilters(poiFilters)

  // 料理ジャンルの件数は、同じジャンルでさらに絞る前の結果から集計する。
  const cuisineFacets = useMemo(() => cuisineFacetValues(
    applyResultFilters(results, { ...poiFilters, cuisine: '', sortDir: 'none' }),
    10,
    poiFilters.cuisine,
  ), [results, poiFilters])
  // 「フィルタ適用中」マーカーはフィルタが実際に件数を減らしているときだけ出す
  // （検索時にカテゴリを選択済みの場合は結果が既に絞り込まれているため不要）
  const narrowing = filtersActive && filtered.length < (results || []).length

  const hasResults = status === 'success' && (results || []).length > 0
  const visible = useMemo(() => filtered.slice(0, MAX_CARDS), [filtered])

  const { selection, selectedKey, selectFacility, selectPin } = useFacilityMapSelection(visible, results)
  const listRef = useRef(null)

  // 結果マップのピンタップ: カードが表示されているならスクロールして選択する。
  // カードが非表示（フィルタ除外・MAX_CARDS を超える分）なら何もしない。
  const handleMarkerSelect = useCallback((result) => {
    const key = selectPin(result)
    if (!key) return
    scrollResultCard(listRef.current, `facility-card-${key}`)
  }, [selectPin])

  const resetFilters = () => {
    // 検索フォームのカテゴリ・目的選択も一緒に解除する（状態の整合性）
    dispatch({ type: searchFormType, payload: { category: '', purpose: '' } })
    setFilters({ nameFilter: '', typeFilter: 'all', catFilter: '', purposeFilter: '', sortDir: 'none', cuisine: '', wifi: 'all', power: 'all', wheelchair: 'all', kerbHeight: 'any' })
  }

  return (
    <div className="h-full flex flex-col bg-slate-100 [container-type:size]">
      {hasResults && (
        <div className="shrink-0 px-3 pt-3 [--results-map-max-height:max(0px,calc(100cqh_-_12rem))]">
          <CollapsibleResultsMap
            results={filtered}
            fitPoiDensity
            showOsmLink
            onMarkerClick={handleMarkerSelect}
            selection={selection}
          />
        </div>
      )}
      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-y-contain min-h-0 px-3 py-3 space-y-3">
        {status === 'idle' && (
          <p className="text-sm text-slate-500 text-center pt-8">
            検索を実行すると、結果がこの一覧に表示されます。
          </p>
        )}

        {status === 'success' && (results || []).length === 0 && <EditPanel />}

        {hasResults && (
          <>
            {/* (ピースN) 検索条件の共有ボタン: 件数表示の右側に横並びで配置 */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-600">
                {(results || []).length.toLocaleString()}件中、{filtered.length.toLocaleString()}件を表示
                {narrowing ? '（フィルタ適用中）' : ''}
              </p>
              <ShareButton />
            </div>

            {/* (B1) 属性の充足率: 表示中結果を追従 */}
            <AttributeCompleteness results={filtered} className="my-1" />

            {/* (作業スペース系 電源・Wi-Fi) 表示中の一覧（フィルタ適用後）の対象施設を母数とする
                電源・Wi-Fi 集計。対象施設が0件のときは表示されない */}
            <WorkspacePowerWifiSummary results={filtered} className="my-1" />

            {/* (共通フィルタバー) コントロール・選択肢・CSSクラス構成は ResultFilterBar に集約
                （まちメモ帳と共用。ロジックは utils/resultFilters.js） */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
              {/* キーワード行: 見出し文言「キーワード」は除去（プレースホルダで意味が
                  伝わるため）。右側はフィルタ全クリアシンボル（✕）の固定スロットを
                  常時確保し、表示・非表示でレイアウトがずれない */}
              <FilterInput
                label={KEYWORD_LABEL}
                value={nameFilter}
                onChange={(e) => setFilters({ nameFilter: e.target.value })}
                filter="keyword"
                heading={null}
                showClearAll={filtersActive}
                onClearAll={resetFilters}
              />
              <WifiPowerRow
                wifiValue={resultFilters.wifi}
                onWifiChange={(v) => setFilters({ wifi: v })}
                powerValue={resultFilters.power}
                onPowerChange={(v) => setFilters({ power: v })}
              />
              <PairedFilterRow>
                <FilterSelect
                  label="車椅子対応で絞る"
                  value={resultFilters.wheelchair}
                  onChange={(e) => setFilters({ wheelchair: e.target.value })}
                  filter="wheelchair"
                  className="flex-[1_1_10.5rem] min-w-0"
                >
                  {WHEELCHAIR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </FilterSelect>
                <FilterSelect
                  label="並び順"
                  value={sortDir}
                  onChange={(e) => setFilters({ sortDir: e.target.value })}
                  className="flex-[1_1_9rem] min-w-0"
                  filter="sort"
                >
                  <option value="none">並び順</option>
                  <option value="asc">名前あ行順</option>
                  <option value="desc">名前逆順</option>
                </FilterSelect>
              </PairedFilterRow>
              <CategorySelect
                items={results}
                value={activeSearch.category || ''}
                onChange={(e) => changeCategory(e.target.value)}
              />
              {/* 料理ジャンル: 結果にcuisineタグがあるときだけチップ行を表示
                  （単一選択トグル。再クリックで解除） */}
              <CuisineChips
                facets={cuisineFacets}
                value={resultFilters.cuisine || ''}
                onChange={(v) => setFilters({ cuisine: v })}
              />
            </div>
          </>
        )}

        {hasResults && filtered.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center space-y-2">
            <p className="text-sm text-amber-800">現在の絞り込み条件に一致する施設はありません。</p>
            <button
              type="button"
              onClick={resetFilters}
              className="min-h-[44px] px-4 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg"
            >
              フィルタをリセット
            </button>
          </div>
        )}

        <div className="card-grid">
          {visible.map((r) => (
            <MobileFacilityCard
              key={`${r.type}/${r.id}`}
              result={r}
              cardId={`facility-card-${r.type}/${r.id}`}
              selected={selectedKey === `${r.type}/${r.id}`}
              showMapThumb
              onSelect={selectFacility}
            />
          ))}
        </div>

        {filtered.length > MAX_CARDS && (
          <p className="text-xs text-slate-500 text-center">
            最初の{MAX_CARDS.toLocaleString()}件を表示しています（全{filtered.length.toLocaleString()}件）。
            絞り込みで対象を減らすと、ほかの施設を表示できます。
          </p>
        )}
      </div>
    </div>
  )
}


/**
 * (#62) バリアフリー検索の結果一覧（モバイル）
 *
 * 対象要素: 歩道・歩行者用通路（way）/ 縁石・音声案内信号・振動案内信号（node）。
 * 名称は name タグがなければ barrierFreeLabel（タグから生成した表示名）を表示する。
 * フィルタは名称・要素種別のみに絞る（カテゴリ・Webサイト・属性欠落は対象外）。
 */
function BarrierFreeMobileList() {
  const { state, dispatch } = useApp()
  const { results, status, resultFilters } = state

  // バリアフリー要素には意味のないフィルタ（料理ジャンル・
  // WiFi・電源・車椅子）は適用しない（旧POI検索の残値で全件が消えるのを防ぐ）
  const bfFilters = { ...resultFilters, cuisine: '', wifi: 'all', power: 'all', wheelchair: 'all' }
  const filtered = useMemo(
    () => applyResultFilters(results || [], bfFilters),
    [results, resultFilters]
  )

  // キーワード行のクリアシンボル表示条件: この画面で resetFilters が解除できる絞り込み
  // 条件のみ集計する（カテゴリ・目的は検索条件そのものなので集計しない）
  const filtersActive = hasActiveFilters({ ...bfFilters, catFilter: '', purposeFilter: '' })

  const setFilters = (patch) => dispatch({ type: 'SET_RESULT_FILTERS', payload: patch })
  // バリアフリー検索ではフォームのカテゴリ（barrier_free）は検索条件そのものなので、
  // リセットは表示フィルタのみに限る
  const resetFilters = () => {
    setFilters({ nameFilter: '', typeFilter: 'all', sortDir: 'none', cuisine: '', wifi: 'all', power: 'all', wheelchair: 'all', kerbHeight: 'any' })
  }

  const hasResults = status === 'success' && (results || []).length > 0
  const visible = useMemo(() => filtered.slice(0, MAX_CARDS), [filtered])
  const narrowing = filtered.length < (results || []).length
  const { selection, selectedKey, selectFacility, selectPin } = useFacilityMapSelection(visible, results)
  const listRef = useRef(null)

  const selectFeature = (result) => {
    const feature = barrierFreeToMapGeoJSON([result]).features[0]
    if (feature) selectFacility(result, feature.geometry)
  }
  const handleMarkerSelect = useCallback((result) => {
    const key = selectPin(result)
    if (key) scrollResultCard(listRef.current, `barrier-free-card-${key}`)
  }, [selectPin])

  return (
    <div className="h-full flex flex-col bg-slate-100 [container-type:size]">
      {hasResults && (
        <div className="shrink-0 px-3 pt-3 [--results-map-max-height:max(0px,calc(100cqh_-_12rem))]">
          <CollapsibleResultsMap
            kind="barrier_free"
            results={filtered}
            initiallyOpen
            showOsmLink
            selection={selection}
            onMarkerClick={handleMarkerSelect}
          />
          {/* 凡例は地図ブロック側（固定領域）に置く。リストのスクロール領域から
              外すことで、リストをスクロールしても凡例が表示され続ける。 */}
          <BarrierFreeLegend twoColumns />
        </div>
      )}
      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-y-contain min-h-0 px-3 py-3 space-y-3">
        {status === 'idle' && (
          <p className="text-sm text-slate-500 text-center pt-8">
            検索を実行すると、結果がこの一覧に表示されます。
          </p>
        )}

        {status === 'success' && (results || []).length === 0 && (
          <div className="bg-white border border-dashed border-slate-200 rounded-xl p-4 text-center space-y-1">
            <p className="text-sm text-slate-500">この地域ではバリアフリー関連の登録がありません。</p>
          </div>
        )}

        {hasResults && (
          <>
            <p className="text-xs text-slate-600">
              {(results || []).length.toLocaleString()}件中、{filtered.length.toLocaleString()}件を表示
              {narrowing ? '（フィルタ適用中）' : ''}
            </p>

            {/* データの充実度（参考）: 点字ブロック等の登録状況を可視化し充実を促す。
                集計対象はフィルタ適用前の results 全体。歩道が0件なら表示しない */}
            <BarrierFreeSummary results={results} />

            {/* (共通フィルタバー) コントロールは ResultFilterBar 共用 */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
              {/* キーワード行: 見出し文言は除去し、右側はフィルタ全クリアシンボル（✕）の
                  固定スロットを常時確保する（POI一覧と同様） */}
              <FilterInput
                label={KEYWORD_LABEL}
                value={resultFilters.nameFilter}
                onChange={(e) => setFilters({ nameFilter: e.target.value })}
                filter="keyword"
                heading={null}
                showClearAll={filtersActive}
                onClearAll={resetFilters}
              />
              <div className="flex gap-2">
                <FilterSelect
                  label="要素種別で絞り込む"
                  value={resultFilters.typeFilter}
                  onChange={(e) => setFilters({ typeFilter: e.target.value })}
                  className="flex-1 min-w-0"
                  filter="type"
                >
                  <option value="all">タイプ: すべて</option>
                  <option value="way">線</option>
                  <option value="node">点</option>
                </FilterSelect>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="shrink-0 min-h-[44px] px-3 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  リセット
                </button>
              </div>
              <p className="text-xs text-slate-400">
                OpenStreetMapに登録済みのデータのみ。点字ブロックは登録情報（tactile_paving）を表示します。
              </p>
              {/* 縁石の高さ（バリアフリー一覧専用）: bf を持つ結果のうち
                  kerbHeightClass が一致するものだけ残す */}
              <FilterSelect
                label="縁石の高さ"
                value={resultFilters.kerbHeight || 'any'}
                onChange={(e) => setFilters({ kerbHeight: e.target.value })}
                filter="kerb"
              >
                <option value="any">縁石の高さ: すべて</option>
                <option value="flat">縁石の高さ: 段差なし</option>
                <option value="low">縁石の高さ: 低め（3cm以下）</option>
                <option value="high">縁石の高さ: 高め（3cm超）</option>
                <option value="unknown">縁石の高さ: 未記録</option>
              </FilterSelect>
            </div>
          </>
        )}

        {hasResults && filtered.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center space-y-2">
            <p className="text-sm text-amber-800">現在の絞り込み条件に一致する要素はありません。</p>
            <button
              type="button"
              onClick={resetFilters}
              className="min-h-[44px] px-4 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg"
            >
              フィルタをリセット
            </button>
          </div>
        )}

        <div className="card-grid">
          {visible.map((r) => (
            <BarrierFreeCard
              key={`${r.type}/${r.id}`}
              result={r}
              selected={selectedKey === `${r.type}/${r.id}`}
              onSelect={selectFeature}
            />
          ))}
        </div>

        {filtered.length > MAX_CARDS && (
          <p className="text-xs text-slate-500 text-center">
            最初の{MAX_CARDS.toLocaleString()}件を表示しています（全{filtered.length.toLocaleString()}件）。
            絞り込みで対象を減らすと、ほかの要素を表示できます。
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * (#62) バリアフリー要素のカード（モバイル）
 *
 * タイトル: 名称（name タグ）があればそれを、なければ種別ラベル
 * （barrierFreeTypeLabel: 歩道 / 歩行者用通路 / 通路(値) / 案内信号 / 縁石 等）のみ。
 * 点字ブロックの状態はタイトルに含まず、バッジとして表示する。
 * barrierFreeLabel はこのカードでは使わない（地図ポップアップ・poiDescription 専用）。
 */
function BarrierFreeCard({ result, selected, onSelect }) {
  const named = !!result.name
  const tags = result.tags || {}
  const tactile = tactileStatus(result)
  const length = lengthLabel(result)
  const signals = signalLabels(result)
  const kind = result.bf?.kind

  // タイトル: 名称があれば名称、なければ種別ラベルのみ
  const title = named ? result.name : barrierFreeTypeLabel(result)

  // 点字ブロックバッジ: 歩道（way）では 有/無/未記録 のどれか必ず1つ出す。
  // ノードでは tactile が記録されている場合のみ 有/無 を出す。
  let tactileBadge = null
  let tactileClass = ''
  if (kind === 'way') {
    if (tactile === '有') {
      tactileBadge = '点字ブロック 有'
      tactileClass = 'bg-emerald-50 text-emerald-700'
    } else if (tactile === '無') {
      tactileBadge = '点字ブロック 無'
      tactileClass = 'bg-rose-50 text-rose-600'
    } else {
      tactileBadge = '点字ブロック 未記録'
      tactileClass = 'bg-rose-50 text-rose-400'
    }
  } else if (tactile != null) {
    tactileBadge = `点字ブロック ${tactile}`
    tactileClass = tactile === '有' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
  }

  const kerbValue = result.bf?.kerb ?? tags.kerb ?? null
  const isKerb = tags.barrier === 'kerb' || kerbValue != null
  const kerbDetail = isKerb ? kerbDetailLabel(kerbValue, tags['kerb:height']) : null
  const kerbBadge = isKerb ? (kerbDetail ? `縁石 ${kerbDetail}` : '縁石') : null

  // 種別バッジ: 名称がある場合に表示。縁石ノードは縁石バッジが種別を示すため
  // 重複を避け、種別バッジを出さない
  const showTypeBadge = named && !isKerb

  // 追加チップ: バリアフリー関連タグがある場合だけ出す
  const extraChips = []
  if (title !== '横断歩道' && (tags.footway === 'crossing' || tags.highway === 'crossing')) extraChips.push('横断歩道')
  if (tags.wheelchair) {
    const wc = tags.wheelchair
    extraChips.push(
      wc === 'yes' ? '車椅子 可'
        : wc === 'no' ? '車椅子 不可'
          : wc === 'limited' ? '車椅子 制限あり'
            : `車椅子 ${wc}`
    )
  }
  if (tags.width) {
    const w = tags.width
    extraChips.push(Number.isFinite(Number(w)) ? `幅 ${w} m` : `幅 ${w}`)
  }
  if (tags.surface) extraChips.push(`路面 ${tags.surface}`)

  const hasBadges = showTypeBadge || tactileBadge != null || length != null ||
    signals.length > 0 || kerbBadge != null || extraChips.length > 0

  return (
    <div
      id={`barrier-free-card-${result.type}/${result.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${title}を地図で選択`}
      aria-pressed={selected}
      onClick={() => onSelect(result)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(result)
        }
      }}
      className={`cursor-pointer bg-white border rounded-xl p-3 shadow-sm space-y-1.5 focus-visible:outline-primary-500 ${
        selected ? 'border-primary-400 ring-2 ring-primary-500' : 'border-slate-200'}`}
    >
      <div className="flex items-center gap-2">
        {showTypeBadge && (
          <span className="inline-flex items-center rounded-full bg-sky-50 text-sky-700 px-2 py-0.5 text-xs shrink-0">
            {barrierFreeTypeLabel(result)}
          </span>
        )}
        <span className="text-sm font-medium text-slate-800 truncate">{title}</span>
      </div>

      {hasBadges && (
        <div className="flex flex-wrap gap-1.5">
          {tactileBadge && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${tactileClass}`}>{tactileBadge}</span>
          )}
          {length && (
            <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-xs">{length}</span>
          )}
          {signals.map((s) => (
            <span key={s} className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs">{s}案内</span>
          ))}
          {kerbBadge && (
            <span className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 px-2 py-0.5 text-xs">{kerbBadge}</span>
          )}
          {extraChips.map((c) => (
            <span key={c} className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-xs">{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}
