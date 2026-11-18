import React, { useMemo, useState } from 'react'
import { getGroupedCategories } from '../data/categories'
import { countCategoriesInResults, filterGroupsByCounts } from '../utils/resultCategories'
import { cuisineLabelOf } from '../utils/resultFilters'
import PerspectiveHelpModal from './mobile/PerspectiveHelpModal'

/**
 * (共通フィルタバー部品) 検索一覧（MobileListTab: POI / バリアフリー）と
 * まちメモ帳（MemochoSection）が共用するフィルタ制御と選択肢定義。
 *
 * CSSクラス構成・コントロール実装・選択肢（ラベル・値・挙動）をこのモジュールに
 * 1か所に集約し、画面側での重複定義をなくする。
 *
 * 共通8項目（両画面で同じラベル・選択肢・挙動）:
 *   キーワード(nameFilter) / カテゴリ(catFilter) / 料理ジャンル(cuisine) /
 *   WiFi(wifi) / 電源(power) / 車椅子(wheelchair) / 視点(perspective) /
 *   属性欠落(missingFilter)
 * 画面固有項目（このモジュールのコントロールで描画し、定義は各画面が持つ）:
 *   一覧 = 要素種別(typeFilter)・縁石の高さ(kerbHeight)
 *   メモ帳 = ★評価(rating)
 *
 * 判定ロジックは utils/resultFilters.js（applyResultFilters 等）が担当し、
 * このモジュールはUIだけを担当する。
 */

// ===== CSSクラス構成（1か所に集約） =====

const FIELD_CLASS =
  'px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
const CHIP_BASE = 'min-h-[44px] px-3 text-xs font-medium rounded-full border transition-colors'
const CHIP_SELECTED = 'bg-primary-600 text-white border-primary-600'
const CHIP_UNSELECTED = 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'

// ===== 選択肢定義（両画面共通の単一ソース） =====

/** キーワード入力の共通ラベル（placeholder・aria-label にも使用） */
export const KEYWORD_LABEL = '名前・メモで絞り込む'

export const WIFI_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'yes', label: 'WiFiあり' },
  { value: 'no', label: 'WiFiなし' },
]

export const POWER_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'yes', label: '電源あり' },
]

export const WHEELCHAIR_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'yes', label: '対応可' },
  { value: 'partial', label: '一部対応' },
  { value: 'no', label: '対応なし' },
]

/** 視点フィルタの選択肢（「誰にとって使いやすいか」で絞る） */
export const PERSPECTIVES = [
  { value: 'none', label: 'すべて' },
  { value: 'wheelchair', label: '車椅子' },
  { value: 'vision', label: '目の不自由な方' },
  { value: 'child', label: '子ども連れ' },
  { value: 'elderly', label: 'お年寄り' },
]

/** ★評価の選択肢（まちメモ帳用。0 = 未評価） */
export const RATING_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'gte1', label: '★1以上' },
  { value: 'gte2', label: '★2以上' },
  { value: 'gte3', label: '★3以上' },
  { value: 'gte4', label: '★4以上' },
  { value: 'eq5', label: '★5のみ' },
]

/** 属性欠落の選択肢（missingFilter。値は missingAttributesOf が返すキー名と一致） */
export const MISSING_OPTIONS = [
  { value: 'none', label: '未登録の絞り込み: なし' },
  { value: 'any', label: 'いずれかの属性が未登録' },
  { value: 'phone', label: '電話が未登録' },
  { value: 'opening_hours', label: '営業時間が未登録' },
  { value: 'website', label: 'Webサイトが未登録' },
  { value: 'address', label: '住所が未登録' },
]

// ===== 統一「アイコン＋見出し」定義（フィルタバー全項目・id 27） =====

/**
 * フィルタバー全項目の「アイコン＋見出し」を 1 か所に集約する単一ソース。
 *
 * 共通8項目（キーワード/カテゴリ/料理/WiFi/電源/車椅子/視点/属性欠落）＋
 * 画面固有項目（★評価/並び順/要素種別/縁石の高さ）のアイコンと見出しをここで
 * 定義し、一覧タブ・まちメモ帳・バリアフリー一覧のいずれでも同じ表示になる。
 *
 * アイコンはアプリ内で既に使われている表現に揃える（電源=⚡・Wi-Fi=📶 は
 * WorkspacePowerWifiSummary の集計表示、料理=🍜・カテゴリ=📁 は categories.js、
 * 車椅子=♿ はバリアフリー関連、キーワード=🔍 は検索系、未登録=⚠️ は注意表示、
 * 視点=👁️ は"見通し"、評価=★ は RATING_OPTIONS と同じ星、並び順=↕️ は順序）。
 */
export const FILTER_META = {
  keyword:     { icon: '🔍', heading: 'キーワード' },
  wifi:        { icon: '📶', heading: 'Wi-Fi' },
  power:       { icon: '⚡', heading: '電源' },
  wheelchair:  { icon: '♿', heading: '車椅子' },
  category:    { icon: '📁', heading: 'カテゴリ' },
  missing:     { icon: '⚠️', heading: '未登録' },
  perspective: { icon: '👁️', heading: '視点' },
  cuisine:     { icon: '🍜', heading: '料理ジャンル' },
  rating:      { icon: '★', heading: '評価' },
  sort:        { icon: '↕️', heading: '並び順' },
  type:        { icon: '📏', heading: '要素種別' },
  kerb:        { icon: '📐', heading: '縁石の高さ' },
}

/** filter キーからアイコン・見出しを解決する（無い場合は null/null） */
function metaOf(filter) {
  return (filter && FILTER_META[filter]) || { icon: null, heading: null }
}

/** 見出しの共通スタイル（既存の料理ジャンル・視点・車椅子見出しと同一） */
const HEADING_CLASS =
  'w-full min-h-[44px] px-3 py-2 flex items-center gap-2 text-sm font-medium text-slate-700'

/**
 * (id 27) 統一「アイコン＋見出し」行。フィルタバーの全項目で同じ見た目にする。
 * アイコンは aria-hidden（装飾）で、見出しテキストは truncate ではみ出しを防ぐ。
 */
export function FilterHeading({ icon = null, heading = null }) {
  if (!heading && !icon) return null
  return (
    <div className={HEADING_CLASS}>
      {icon ? <span aria-hidden="true" className="shrink-0 leading-none">{icon}</span> : null}
      {heading ? <span className="min-w-0 truncate">{heading}</span> : null}
    </div>
  )
}

// ===== コントロール =====

/**
 * フィルタ用テキスト入力（共通の見た目・クラス構成）
 * @param {string} label - placeholder・aria-label として使用
 * @param {string} value - 現在値
 * @param {(e) => void} onChange - React の input イベントハンドラ
 * @param {string} [className='w-full'] - 幅指定（w-full 等）
 */
export function FilterInput({ label, value, onChange, className = 'w-full', filter = null }) {
  const meta = metaOf(filter)
  return (
    <div className={`${className} space-y-2`}>
      <FilterHeading icon={meta.icon} heading={meta.heading} />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={label}
        aria-label={label}
        className={`w-full ${FIELD_CLASS}`}
      />
    </div>
  )
}

/**
 * フィルタ用ドロップダウン（共通の見た目・クラス構成）
 * @param {string} label - aria-label として使用
 * @param {string} value - 現在値
 * @param {(e) => void} onChange - React の select イベントハンドラ
 * @param {React.ReactNode} children - <option> 群
 * @param {string} [className='w-full'] - 幅指定（w-full | w-36 | 'flex-1 min-w-0'）
 */
export function FilterSelect({ label, value, onChange, children, className = 'w-full', filter = null }) {
  const meta = metaOf(filter)
  return (
    <div className={`${className} space-y-2`}>
      <FilterHeading icon={meta.icon} heading={meta.heading} />
      <select value={value} onChange={onChange} aria-label={label} className={`w-full ${FIELD_CLASS}`}>
        {children}
      </select>
    </div>
  )
}

/**
 * フィルタチップ（単一選択ボタンの共通見た目）
 * @param {string} label - 表示ラベル
 * @param {boolean} selected - 選択中か（aria-pressed）
 * @param {() => void} onPress - クリックハンドラ
 */
export function FilterChip({ label, selected, onPress }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPress}
      className={`${CHIP_BASE} ${selected ? CHIP_SELECTED : CHIP_UNSELECTED}`}
    >
      {label}
    </button>
  )
}

/**
 * 単一選択チップ行（role=group + aria-label 付き）
 * @param {string} label - グループの aria-label
 * @param {Array<{value: string, label: string}>} options - 選択肢
 * @param {string} value - 現在選択中の値
 * @param {(value: string) => void} onChange - 選択値のコールバック
 * @param {string} [className=''] - 追加クラス（例: 'flex-1'）
 * @param {string} [heading=null] - チップ群の上に表示する見出し（例: '車椅子'）。
 *   チップの文言だけでは絞り込みの意味が分からない行（車椅子など）で使う。
 *   見出しは料理ジャンル行（CuisineChips）の見出しと同一の見た目（text-sm・
 *   font-medium・text-slate-700・min-h-[44px]・px-3 py-2）に揃える。
 */
export function FilterChipRow({ label, options, value, onChange, className = '', filter = null, heading = null, icon = null }) {
  const meta = metaOf(filter)
  // 優先度: 明示的な icon/heading 引数 > filter 解決値
  const finalIcon = icon != null ? icon : meta.icon
  const finalHeading = heading != null ? heading : meta.heading
  return (
    <div className={`space-y-2${className ? ` ${className}` : ''}`}>
      <FilterHeading icon={finalIcon} heading={finalHeading} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {(options || []).map((o) => (
          <FilterChip
            key={o.value}
            label={o.label}
            selected={value === o.value}
            onPress={() => onChange(o.value)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 料理ジャンルのチップ行（折りたたみ式）。一覧・まちメモ帳で共用。
 *
 * - 初期状態は折りたたみ（チップ群非表示）。見出し行（「料理ジャンル」＋開閉トグル）は
 *   常に表示され、タップでチップ群を展開／収納する（トグルに aria-expanded）。
 * - 折りたたみ中でもジャンルが選択済みの場合、見出し行に選択中ジャンルのラベルを出し、
 *   「選択が効いているのに見えない」状態を防ぐ。
 * - facets が空（料理タグのある結果・アイテムが無い）ときは、見出し行も含め行ごと非表示。
 * - チップ自体の挙動（単一選択・再タップで解除・件数表示）は従来どおり。
 *
 * @param {Array<{value: string, label: string, count: number}>} facets
 *   cuisineFacetValues で集計したファセット（label は日本語ラベル済み）
 * @param {string} value - 現在選択中のジャンル値（'' = 未選択）
 * @param {(value: string) => void} onChange - 新値（'' = 解除）を渡して呼ばれる
 */
export function CuisineChips({ facets, value, onChange }) {
  const [open, setOpen] = useState(false)

  if (!Array.isArray(facets) || facets.length === 0) return null

  // 選択中ジャンルのラベル（折りたたみ中でも見出し行に表示）。
  // まず該当ファセットのラベルを使う。ファセットが消失した場合（例: 新規検索で
  // 結果セットが替わった stale な選択）は CUISINE_LABELS 辞書のラベル、それも無い
  // ときは生の値にフォールバックする（チップのラベル解決と同一の辞書を共用）。
  let selectedLabel = null
  if (value) {
    const f = facets.find((x) => x.value === value)
    selectedLabel = f ? f.label : cuisineLabelOf(value)
  }

  return (
    <>
      {/* 見出し行: 常時表示。折りたたみ中は選択中ジャンルのラベルをここで出す */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-[44px] px-3 py-2 flex items-center justify-between gap-2 text-sm font-medium text-slate-700"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="shrink-0 leading-none">{FILTER_META.cuisine.icon}</span>
          <span className="truncate">料理ジャンル{selectedLabel ? `：${selectedLabel}` : ''}</span>
        </span>
        <span className="shrink-0 text-xs text-slate-500">{open ? '折りたたむ' : '展開'}</span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="料理ジャンル">
          {facets.map((f) => (
            <FilterChip
              key={f.value}
              label={`${f.label}（${f.count.toLocaleString('ja-JP')}件）`}
              selected={value === f.value}
              onPress={() => onChange(value === f.value ? '' : f.value)}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * 「視点で絞る」チップ行（一覧・まちメモ帳で共用）。
 * チップ行 + 説明ボタンのモーダル（PerspectiveHelpModal）をまとめる。
 *
 * チップの文言（車椅子/目の不自由な方/子ども連れ/お年寄り）だけでは
 * 「何を絞るのか」が分かりにくいので、料理ジャンル・車椅子と同様の
 * 見出し「視点」を付ける。説明ボタンのモーダルで判定の詳細を補足する。
 */
export function PerspectiveChips({ value, onChange }) {
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <>
      <div className="flex items-start gap-1.5">
        <FilterChipRow
          label="視点で絞る"
          options={PERSPECTIVES}
          value={value || 'none'}
          onChange={onChange}
          className="flex-1"
          filter="perspective"
        />
        <button
          type="button"
          aria-label="視点フィルタの説明"
          onClick={() => setHelpOpen(true)}
          className="shrink-0 w-6 h-6 rounded-full border border-slate-300 text-slate-400 text-xs italic font-serif leading-none flex items-center justify-center hover:text-slate-500 hover:border-slate-400"
        >
          i
        </button>
      </div>
      {helpOpen && <PerspectiveHelpModal onClose={() => setHelpOpen(false)} />}
    </>
  )
}

/**
 * 車椅子対応のチップ行（一覧・まちメモ帳で共用）。
 *
 * チップの文言（対応可／一部対応／対応なし）だけでは絞り込みの意味が
 * 分からないため、料理ジャンル行（CuisineChips）と同じ見出し「車椅子」を
 * 付けた FilterChipRow を返す。見出しの文言・見た目はこの共通部品で
 * 固定し、一覧タブ・まちメモ帳のどちらでも同じ表示になる。
 *
 * @param {string} value - 現在選択中の値（'all' | 'yes' | 'partial' | 'no'）
 * @param {(value: string) => void} onChange - 選択値のコールバック
 */
export function WheelchairChips({ value, onChange }) {
  return (
    <FilterChipRow
      label="車椅子対応で絞る"
      options={WHEELCHAIR_OPTIONS}
      value={value}
      onChange={onChange}
      filter="wheelchair"
    />
  )
}

const CATEGORY_GROUPS = getGroupedCategories()

/**
 * カテゴリ選択（件数付きの動的選択肢）。一覧・まちメモ帳で共用。
 *
 * 選択肢は items に実際に出現したカテゴリのみを件数付きで表示し、目的別に
 * グループ分けする（optgroup）。現在選択中のカテゴリは0件でも選択肢に残る
 * （filterGroupsByCounts の selectedId 挙動）。
 *
 * @param {Array} items - 集計対象（検索結果 or メモ帳アイテム。type/tags 形状）
 * @param {string} value - 現在選択中のカテゴリID（'' = すべて）
 * @param {(value: string) => void} onChange - 選択値のコールバック
 * @param {string} [className='w-full'] - 幅指定
 */
export function CategorySelect({ items, value, onChange, className = 'w-full', filter = 'category' }) {
  const data = items || []
  const hasData = data.length > 0
  const counts = useMemo(() => countCategoriesInResults(data), [data])
  const groups = useMemo(
    () => (hasData ? filterGroupsByCounts(CATEGORY_GROUPS, counts, value || '') : CATEGORY_GROUPS),
    [hasData, counts, value]
  )
  const fmt = (n) => (n || 0).toLocaleString('ja-JP')
  return (
    <FilterSelect label="カテゴリで絞り込む" value={value || ''} onChange={onChange} className={className} filter={filter}>
      <option value="">{hasData ? `カテゴリ: すべて（${fmt(data.length)}件）` : 'カテゴリ: すべて'}</option>
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {hasData ? `${c.label}（${fmt(c.count)}件）` : c.label}
            </option>
          ))}
        </optgroup>
      ))}
    </FilterSelect>
  )
}
