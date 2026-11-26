import React, { useMemo, useState } from 'react'
import { getGroupedCategories } from '../data/categories'
import { countCategoriesInResults, filterGroupsByCounts } from '../utils/resultCategories'
import { cuisineLabelOf, normalizeWheelchair } from '../utils/resultFilters'

/**
 * (共通フィルタバー部品) 検索一覧（MobileListTab: POI / バリアフリー）と
 * まちメモ帳（MemochoSection）が共用するフィルタ制御と選択肢定義。
 *
 * CSSクラス構成・コントロール実装・選択肢（ラベル・値・挙動）をこのモジュールに
 * 1か所に集約し、画面側での重複定義をなくする。
 *
 * 共通6項目（両画面で同じラベル・選択肢・挙動）:
 *   キーワード(nameFilter) / カテゴリ(catFilter) / 料理ジャンル(cuisine) /
 *   WiFi(wifi) / 電源(power) / 車椅子(wheelchair)
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
const CHIP_BASE = 'min-h-[44px] shrink-0 whitespace-nowrap px-2 py-2 text-xs font-medium rounded-lg border transition-colors'
const CHIP_SELECTED = 'bg-primary-600 text-white border-primary-600'
const CHIP_UNSELECTED = 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'

// ===== 横長コンパクト行レイアウト（スマホで縦長になるのを抑える） =====

/** 見出しとコントロールを横に並べる。 */
const ROW_CLASS = 'min-h-[44px] flex items-center gap-2'
/** 行内見出しのクラス（縦積みの HEADING_CLASS と同じ style token を含み、幅・padding を落とす） */
const INLINE_HEADING_CLASS =
  'shrink-0 flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-slate-700'

export function PairedFilterRow({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 [&_select]:px-1.5 [&_select]:text-xs">
      {children}
    </div>
  )
}

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

// 車椅子対応の選択肢（しきい値型の単一選択）。
// 'gte_partial' = 一部対応以上（yes/designated + limited）、'gte_yes' = 対応可のみ
export const WHEELCHAIR_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'gte_partial', label: '一部対応以上' },
  { value: 'gte_yes', label: '対応可のみ' },
]

/** filter キー → 選択肢（FilterCheckboxRow が options を渡されないときに解決用） */
const FILTER_OPTIONS = {
  wifi: WIFI_OPTIONS,
  power: POWER_OPTIONS,
}

/** ★評価の選択肢（まちメモ帳用。0 = 未評価） */
export const RATING_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'gte1', label: '★1以上' },
  { value: 'gte2', label: '★2以上' },
  { value: 'gte3', label: '★3以上' },
  { value: 'gte4', label: '★4以上' },
  { value: 'eq5', label: '★5のみ' },
]

// ===== 統一「アイコン＋見出し」定義（フィルタバー全項目・id 27） =====

/**
 * フィルタバー全項目の「アイコン＋見出し」を 1 か所に集約する単一ソース。
 *
 * 共通6項目（キーワード/カテゴリ/料理/WiFi/電源/車椅子）＋
 * 画面固有項目（★評価/並び順/要素種別/縁石の高さ）のアイコンと見出しをここで
 * 定義し、一覧タブ・まちメモ帳・バリアフリー一覧のいずれでも同じ表示になる。
 *
 * アイコンはアプリ内で既に使われている表現に揃える（電源=⚡・Wi-Fi=📶 は
 * WorkspacePowerWifiSummary の集計表示、料理=🍜・カテゴリ=📁 は categories.js、
 * 車椅子=♿ はバリアフリー関連、キーワード=🔍 は検索系、
 * 評価=★ は RATING_OPTIONS と同じ星、並び順=↕️ は順序）。
 */
export const FILTER_META = {
  keyword:     { icon: '🔍', heading: 'キーワード' },
  wifi:        { icon: '📶', heading: 'Wi-Fi' },
  power:       { icon: '⚡', heading: '電源' },
  wheelchair:  { icon: '♿', heading: '車椅子' },
  category:    { icon: '📁', heading: '種別詳細' },
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
    <span className={INLINE_HEADING_CLASS}>
      {icon ? <span aria-hidden="true" className="shrink-0 leading-none">{icon}</span> : null}
      {heading ? <span className="whitespace-nowrap">{heading}</span> : null}
    </span>
  )
}

// ===== コントロール =====

/**
 * フィルタ用テキスト入力（共通の見た目・クラス構成）
 * @param {string} label - placeholder・aria-label として使用
 * @param {string} value - 現在値
 * @param {(e) => void} onChange - React の input イベントハンドラ
 * @param {string} [className='w-full'] - 幅指定（w-full 等）
 * @param {string} [filter] - FILTER_META のキー（アイコン・見出しの解決）
 * @param {string|null} [heading] - 見出し文言のオーバーライド。省略時は filter 由来の
 *   見出しを使う。null を渡すと見出し文言を除去する（アイコンのみ残る）。
 *   例: キーワード行はプレースホルダ（「名前・メモで絞り込む」）で意味が伝わるため
 *   見出し文言を外し、右側をフィルタクリアのシンボル用に確保する。
 * @param {boolean} [showClearAll=false] - フィルタ全クリアのシンボル（✕）を表示するか
 * @param {Function} [onClearAll] - クリアシンボルのクリックハンドラ（フィルタ全クリア）。
 *   指定すると入力欄の右側に固定幅のスロット（w-9）を常時確保する。シンボルは
 *   showClearAll で出し入れされるがスロット幅は不変なので、表示・非表示でレイアウト
 *   がずれない。
 * @param {string} [clearAllLabel='フィルタをクリア'] - クリアシンボルの aria-label と
 *   ツールチップ（title）。シンボル単体だと「キーワードだけを消す」ようにも読めるため、
 *   このラベルで「フィルタをクリア」であることを示す。
 */
export function FilterInput({ label, value, onChange, className = 'w-full', filter = null, heading = undefined, showClearAll = false, onClearAll = null, clearAllLabel = 'フィルタをクリア' }) {
  const meta = metaOf(filter)
  const finalHeading = heading === undefined ? meta.heading : heading
  const hasClearAll = typeof onClearAll === 'function'
  return (
    <div className={`${className} ${ROW_CLASS}`}>
      <FilterHeading icon={meta.icon} heading={finalHeading} />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={label}
        aria-label={label}
        className={`flex-1 min-w-0 ${FIELD_CLASS}`}
      />
      {hasClearAll && (
        /* フィルタ全クリアのスロット: 固定幅（w-9）を常時確保し、シンボルは
           showClearAll で出し入れする（未使用時は空のまま幅だけ維持）。幅が変わらない
           ためシンボルの出現でレイアウトがずれない */
        <div className="shrink-0 w-9 flex items-center justify-center">
          {showClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              aria-label={clearAllLabel}
              title={clearAllLabel}
              className="w-9 h-9 rounded-full border border-slate-300 bg-white text-slate-500 flex items-center justify-center hover:bg-slate-50 hover:text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <span aria-hidden="true" className="text-sm leading-none">✕</span>
            </button>
          )}
        </div>
      )}
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
    <div className={`${className} ${ROW_CLASS}`}>
      <FilterHeading icon={meta.icon} heading={meta.heading} />
      <select value={value} onChange={onChange} aria-label={label} className={`flex-1 min-w-0 ${FIELD_CLASS}`}>
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

const CHECKBOX_GROUP_CLASS =
  'flex-1 min-w-0 flex items-center gap-2.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none]'

/**
 * チップ見た目のチェックボックス（1個）。既存のチップ（FilterChip）と同じ
 * ピル形状・色・サイズ（min-h-[44px]・px-3・text-xs・font-medium・rounded-full）
 * で描画し、チェックボックスの箱（✓）を中に残す。選択中はチップと同じ
 * primary-600 の実色ピルになり、箱は accent を white に切り替えて視認性を保つ。
 *
 * @param {boolean} checked - チェック状態
 * @param {(e) => void} onChange - input の onChange ハンドラ
 * @param {React.ReactNode} children - ラベルテキスト
 */
function CheckboxPill({ checked, onChange, children }) {
  return (
    <label
      className={`${CHIP_BASE} ${checked ? CHIP_SELECTED : CHIP_UNSELECTED} flex items-center gap-2 cursor-pointer select-none`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={`w-4 h-4 shrink-0 ${checked ? 'accent-white' : 'accent-primary-600'}`}
      />
      <span className="whitespace-nowrap">{children}</span>
    </label>
  )
}

/**
 * フィルタチェックボックス行（単一選択）。Wi-Fi／電源／車椅子用に、
 * チップからチェックボックスへ置き換えて描画する（表示の圧縮のため）。
 *
 * チップと同じ「一度に1つだけ選択できる」単一選択の挙動をそのまま保持しつつ、
 * 見た目をチェックボックスにする。選択肢配列の先頭（default、通常
 * {value:'all',label:'すべて'}）はチェックボックスとして描画せず、「全 unchecked
 * ＝ すべて（default）」で表現する。
 *   - unchecked の箱をタップ → その値を選択（他は自動で unchecked）
 *   - checked   の箱をタップ → 選択解除（全 unchecked ＝ default に戻る）
 *
 * 状態の形（単一値 'all'|'yes'|...）と絞り込みロジック（utils/resultFilters.js）
 * は変更しない。onChange には単一値を渡す（従来チップと同じ契約）。
 *
 * @param {string} label - グループの aria-label（例: 'WiFi有無で絞る'）
 * @param {string} value - 現在選択中の値（default ＝ 全 unchecked）
 * @param {(value: string) => void} onChange - 新値（default ＝ 解除）を渡して呼ばれる
 * @param {string} [filter] - FILTER_META のキー（アイコン・見出し・選択肢の解決）
 * @param {Array<{value: string, label: string}>} [options] - 選択肢（省略時は filter 由来）
 * @param {string} [className=''] - 追加クラス
 */
export function FilterCheckboxRow({ label, value, onChange, filter = null, options = null, className = '' }) {
  const meta = metaOf(filter)
  const opts = options != null ? options : ((filter && FILTER_OPTIONS[filter]) || [])
  if (!opts.length) return null
  // default（「すべて」）＝ options の先頭。チェックボックスには出さない（全 unchecked ＝ default）。
  const defaultValue = opts[0].value
  const realOptions = opts.filter((o) => o.value !== defaultValue)
  return (
    <div className={`${className} ${ROW_CLASS}`}>
      <FilterHeading icon={meta ? meta.icon : null} heading={meta ? meta.heading : null} />
      <div className={CHECKBOX_GROUP_CLASS} role="group" aria-label={label}>
        {realOptions.map((o) => {
          const checked = value === o.value
          return (
            <CheckboxPill key={o.value} checked={checked} onChange={() => onChange(checked ? defaultValue : o.value)}>
              {o.label}
            </CheckboxPill>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 設備（Wi-Fi・電源・車椅子）の統合チェックボックス行。
 *
 * 3つのフィルタを1行にまとめ、チェックボックスで絞り込む。Wi-Fi・電源は独立した
 * オン/オフ（両方 checked にできる ＝ AND）。車椅子は単一のチェックボックスで
 * 「一部対応以上」（gte_partial）を表現する（checked ＝ 'all' 以外）。unchecked ＝
 * その条件を絞らない（'all'）。従来の「なし」絞り込みは廃止（選択肢に 'no' が
 * 無いため UI から選択できない）。
 *
 * 状態は単一値のまま（Wi-Fi・電源は 'all' | 'yes'、車椅子は
 * 'all' | 'gte_partial' | 'gte_yes'）。チェック時は 'gte_partial'、外したときは
 * 'all' を onWheelchairChange に渡す。絞り込みロジック（resultFilters.js）は変更
 * しない（両方 'yes' のとき AND になるのは既存の仕来り）。共有URLなどで 'gte_yes'
 * が入っている場合は checked 表示になり、外せば 'all'、付け直せば 'gte_partial'
 * になる（「対応可のみ」の選択肢はUIから無くなる）。
 *
 * @param {string} wifiValue - 現在の Wi-Fi 状態（'all' | 'yes'）
 * @param {(v: string) => void} onWifiChange - 'yes' / 'all' を渡して呼ばれる
 * @param {string} powerValue - 現在の電源状態（'all' | 'yes'）
 * @param {(v: string) => void} onPowerChange
 * @param {string} [wheelchairValue] - 現在の車椅子状態（'all' | 'gte_partial' | 'gte_yes'）
 * @param {(v: string) => void} [onWheelchairChange] - 'gte_partial' / 'all' を渡して呼ばれる
 * @param {string} [className=''] - 追加クラス
 */
export function WifiPowerRow({ wifiValue, onWifiChange, powerValue, onPowerChange, wheelchairValue, onWheelchairChange, className = '' }) {
  const wifiChecked = wifiValue === 'yes'
  const powerChecked = powerValue === 'yes'
  const wheelchairChecked = wheelchairValue != null && wheelchairValue !== 'all'
  return (
    <div className={`${className} ${ROW_CLASS}`}>
      <FilterHeading icon="📶" heading="設備" />
      <div className={CHECKBOX_GROUP_CLASS} role="group" aria-label="設備で絞る">
        <CheckboxPill checked={wifiChecked} onChange={() => onWifiChange(wifiChecked ? 'all' : 'yes')}>
          Wi-Fi
        </CheckboxPill>
        <CheckboxPill checked={powerChecked} onChange={() => onPowerChange(powerChecked ? 'all' : 'yes')}>
          電源
        </CheckboxPill>
        <CheckboxPill checked={wheelchairChecked} onChange={() => onWheelchairChange(wheelchairChecked ? 'all' : 'gte_partial')}>
          車椅子
        </CheckboxPill>
      </div>
    </div>
  )
}



/**
 * 評価フィルタ値を「点灯する星の数」に変換（0 = 未選択＝「すべて」）。
 * 'gte1'..'gte4' → 1..4、'eq5' → 5、それ以外（'all' 等）→ 0
 */
function ratingSelectedStars(value) {
  const m = /^gte([1-4])$/.exec(value || '')
  if (m) return Number(m[1])
  if (value === 'eq5') return 5
  return 0
}

/**
 * 星 n → 評価フィルタ値。★5 は「5以上」＝「5のみ」なので 'eq5'。
 * （matchesRating は gte5 と eq5 を同一挙動として扱う）
 */
function ratingValueOf(n) {
  return n === 5 ? 'eq5' : `gte${n}`
}

/**
 * ★ 評価フィルタ行（星ボタン5つ）。まちメモ帳カードの★評価行
 * （MemochoSection の MemochoCard）と同じ見た目・操作で揃える。
 *
 * - 星 n を押す →「★n以上」で絞り込む（n=1..4）。★5 は実質「★5のみ」。
 * - 選択中にもう一度同じ星を押す → 解除して「すべて」に戻る
 *   （カード側のトグル操作に合わせる）。
 * - 状態は従来どおり単一文字列（'all' | 'gte1'..'gte4' | 'eq5'）のままなので、
 *   絞り込みロジック（matchesRating / applyResultFilters）は変更しない。
 * - 見出しは他の行と同じ統一形式（★ 評価）。
 *
 * @param {string} value - 現在の評価フィルタ値（'all' = 未選択）
 * @param {(value: string) => void} onChange - 新値を渡して呼ばれる
 * @param {string} [filter='rating'] - FILTER_META のキー（アイコン・見出しの解決）
 * @param {string} [className=''] - 追加クラス
 */
export function RatingStarsRow({ value, onChange, filter = 'rating', className = '' }) {
  const meta = metaOf(filter)
  const selected = ratingSelectedStars(value)
  return (
    <div className={`${className} ${ROW_CLASS}`}>
      <FilterHeading icon={meta.icon} heading={meta.heading} />
      {/* 星5つの並び: カードの★評価行と同一の見た目・操作（押した星まで★・
          同じ星を再タップで解除）。トグルのaria-pressedは現在値と一致する星だけ */}
      <div role="group" aria-label="評価で絞る" className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            aria-label={i === 5 ? '★5のみで絞り込む' : `★${i}以上で絞り込む`}
            aria-pressed={value === ratingValueOf(i)}
            onClick={() => onChange(value === ratingValueOf(i) ? 'all' : ratingValueOf(i))}
            className={`shrink-0 text-sm leading-none p-0.5 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              i <= selected ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'
            }`}
          >
            {i <= selected ? '★' : '☆'}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 料理ジャンルのチップ行（折りたたみ式）。一覧・まちメモ帳で共用。
 *
 * - 初期状態は折りたたみ（チップ群非表示）。トグル（「料理ジャンル」＋開閉表示）は
 *   常に表示され、タップでチップ群を展開／収納する（トグルに aria-expanded）。
 * - 展開中はトグルの下にチップを並べる。表示領域の幅で2列と3列を切り替える。
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
    <div className="@container/cuisine space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-[44px] px-3 py-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="shrink-0 leading-none">{FILTER_META.cuisine.icon}</span>
          <span className="truncate">料理ジャンル{selectedLabel ? `：${selectedLabel}` : ''}</span>
        </span>
        <span className="shrink-0 text-xs text-slate-500">{open ? '折りたたむ' : '展開'}</span>
      </button>
      {open && (
        <div
          className="grid grid-cols-[repeat(2,minmax(min(7rem,40%),1fr))] gap-2 @[24rem]/cuisine:grid-cols-[repeat(3,minmax(7rem,1fr))]"
          role="group"
          aria-label="料理ジャンル"
        >
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
    </div>
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
    <FilterSelect label="種別詳細で絞り込む" value={value || ''} onChange={onChange} className={className} filter={filter}>
      <option value="">{hasData ? `種別詳細: すべて（${fmt(data.length)}件）` : '種別詳細: すべて'}</option>
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
