/**
 * (#63) モバイル「一般向けトップ」（クイックトップ）
 *
 * 検索タブの既定の初期表示。一般ユーザーは検索フォームの学習コストを
 * かけずに「場所 × 目的」だけで検索できるようにする:
 *
 * - QuickTopIntro: 一文の説明 ＋ 場所指定（地名・駅名 → geocode → 地図移動）
 * - QuickTopTiles: 目的タイル10種 → タップで即検索（成功でリストタブへ自動切替）
 * - 「くわしく探す」: 従来の検索フォームへ（フォーム側には戻る導線がある）
 *
 * 検索範囲は地図の現在表示範囲。地図は親（MobileSearchTab）が常時マウント
 * した単一インスタンスとして保持し、場所移動は map.jumpTo() で行う
 * （既存の地名移動機構 = geocode + jumpTo を再利用）。
 *
 * 複合タイル（病院・薬局／役所・手続き）は目的グループ名として渡され、
 * getPurposeUnionFilters でグループ内カテゴリの union として解決される
 * （CATEGORY_GROUPS の #63 クイックグループ）。
 */

// 目的タイル（10種）。purpose → 目的グループ検索、category → 単一カテゴリ検索。
// 順序は仕様の表示順（食べる・買う・病院・薬局・役所・手続き・遊ぶ・公園・
// 泊まる・駅・交通・トイレ・学ぶ・バリアフリー）。
export const QUICK_TILES = [
  { id: 'eat', label: '食べる', icon: '🍜', purpose: '食べる' },
  { id: 'buy', label: '買う', icon: '🛍️', purpose: '買う' },
  { id: 'medical', label: '病院・薬局', icon: '🏥', purpose: '病院・薬局' },
  { id: 'government', label: '役所・手続き', icon: '🏛️', purpose: '役所・手続き' },
  { id: 'play', label: '遊ぶ・公園', icon: '🎠', purpose: '遊ぶ' },
  { id: 'stay', label: '泊まる', icon: '🏨', category: 'accommodation' },
  { id: 'traffic', label: '駅・交通', icon: '🚉', category: 'transport' },
  { id: 'toilet', label: 'トイレ', icon: '🚻', category: 'toilets' },
  { id: 'learn', label: '学ぶ', icon: '📚', purpose: '学ぶ' },
  { id: 'barrierFree', label: 'バリアフリー', icon: '♿', purpose: 'バリアフリー' }
]

/**
 * トップ冒頭ブロック: 説明一行 ＋ 場所指定フォーム。
 *
 * @param {string} placeQuery 場所入力値（親が管理: 切替時に状態を保持）
 * @param {(value: string) => void} onPlaceQueryChange
 * @param {(() => void) | null} onPlaceMove 移動ボタン押下（親でgeocode+jumpTo）
 * @param {boolean} moving 地名検索実行中
 * @param {string | null} moveError 地名検索エラー
 * @param {string | null} movedName 移動した場所の表示名（成功フィードバック）
 * @param {boolean} disabled 検索中などでの無効化
 */
export function QuickTopIntro({
  placeQuery = '',
  onPlaceQueryChange = () => {},
  onPlaceMove = null,
  moving = false,
  moveError = null,
  movedName = null,
  disabled = false
}) {
  const handleSubmit = (e) => {
    e.preventDefault()
    if (onPlaceMove) onPlaceMove()
  }
  return (
    <>
      <p className="pt-1 text-base text-slate-600">
        近くの施設を、みんなの地図で探す
      </p>

      {/* 場所指定: 地名・駅名を入力して地図の表示範囲を移動 */}
      <section className="bg-white rounded-xl p-3 shadow-sm space-y-2" aria-label="どこで探すか">
        <label htmlFor="quick-place-input" className="block text-sm font-semibold text-slate-700">
          どこあたりの場所？
        </label>
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <input
            id="quick-place-input"
            type="text"
            value={placeQuery}
            onChange={(e) => onPlaceQueryChange(e.target.value)}
            placeholder="地名・駅名（例: 大阪駅）"
            disabled={disabled}
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={disabled || moving || !placeQuery.trim()}
            className="shrink-0 px-3 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg disabled:opacity-50"
          >
            {moving ? '移動中…' : '移動'}
          </button>
        </form>
        {moveError && (
          <p role="alert" className="text-sm text-red-600">{moveError}</p>
        )}
        {movedName && (
          <p className="text-sm text-green-700">地図を「{movedName}」に移動しました</p>
        )}
      </section>
    </>
  )
}

/**
 * 目的タイルグリッド ＋ 「くわしく探す」導線。
 *
 * @param {(tile: object) => void} onTileTap タイルタップ（親で即検索）
 * @param {() => void} onOpenDetailed 「くわしく探す」で従来フォームへ
 * @param {boolean} disabled 検索中などでの無効化
 */
export function QuickTopTiles({ onTileTap = () => {}, onOpenDetailed = () => {}, disabled = false }) {
  return (
    <>
      <section className="bg-white rounded-xl p-3 shadow-sm" aria-label="目的から探す">
        <div className="grid grid-cols-2 gap-2">
          {QUICK_TILES.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={() => onTileTap(tile)}
              disabled={disabled}
              className="min-h-[64px] rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-0.5 text-sm font-medium text-slate-700 active:bg-primary-50 disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-xl leading-none">{tile.icon}</span>
              {tile.label}
            </button>
          ))}
        </div>
      </section>

      {/* 従来の検索フォームへ (#63) */}
      <button
        type="button"
        onClick={onOpenDetailed}
        className="w-full min-h-[44px] text-sm font-medium text-primary-600 bg-white border border-primary-200 rounded-xl hover:bg-primary-50"
      >
        くわしく探す →
      </button>
    </>
  )
}
