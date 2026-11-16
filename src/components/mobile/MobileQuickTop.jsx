/**
 * (#63) モバイル「一般向けトップ」（クイックトップ）
 *
 * 検索タブの既定の初期表示。一般ユーザーは検索フォームの学習コストを
 * かけずに「場所 × 目的」だけで検索できるようにする:
 *
 * - QuickTopIntro: 一文の説明 ＋ 場所指定（地名・駅名入力）
 *   （トップ画面には地図を描画しない #63。「地図で見る」は結果側の導線）
 * - QuickTopTiles: 目的タイル10種 → タップで「選択」だけ（タップで検索しない）。
 *   選択中のタイルはハイライト（枠・背景色）で表示され、同時に選べるのは1つだけ
 *   （別のタイルを押すと選択が移る）。
 * - タイルの下に「検索する」ボタン: 押下（または場所入力欄で Enter）で初めて
 *   施設検索が実行される（成功でリストタブへ自動切替）。
 * - 「くわしく探す」: 従来の検索フォームへ（フォーム側には戻る導線がある）
 *
 * 「検索する」押下時の流れ（親の handleTopSearch で実行）:
 * ① 入力欄に地名があれば geocode して検索エリアを確定（成功で入力欄を緑に
 *    し「検索エリアに「○○」を設定しました」を表示）。入力が空で
 *    「都道府県から探す」などでエリアが設定済みならそれを使う。
 * ② 場所が決まらなければ（入力が空でエリア未設定、または geocode で
 *    見つからない）検索せず、案内・エラー表示を出す。
 * ③ タイル（種別）が選ばれていなければ検索せず「種別を選んでください」
 *    趣旨の案内を出す。
 * ④ 場所と種別がそろえば、その範囲・種別で施設検索を実行する。
 *
 * 検索範囲は「設定済みの検索エリア」（state.bbox）。地名・駅名の geocode
 * （「検索する」押下時に実行）または「都道府県から探す」での自治体選択で
 * 設定される。トップ画面には地図を描画しない（#63）。地図は親（MobileSearchTab）
 * が常時マウントした単一インスタンスとして保持し、フォーム表示の地図モードで
 * のみ表示される（位置・範囲はトップ⇄フォーム切替時に引き継がれる）。
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
 * トップ冒頭ブロック: 説明一行 ＋ 場所指定（地名・駅名入力）。
 *
 * 入力欄の右に「検索」ボタンは置かない（操作の流れ変更）。実際の検索は
 * 目的タイルの下にある「検索する」ボタン（または入力欄で Enter）で実行される。
 *
 * @param {string} placeQuery 場所入力値（親が管理: 切替時に状態を保持）
 * @param {(value: string) => void} onPlaceQueryChange
 * @param {(() => void) | null} onSearch 検索実行（親で geocode→施設検索→一覧切替）。
 *   入力欄で Enter を押したときにも呼ばれる（「検索する」ボタンと同じ動作）
 * @param {boolean} searching 地名検索実行中
 * @param {string | null} searchError 地名検索エラー
 * @param {string | null} areaName 設定した検索エリアの表示名（成功フィードバック）
 * @param {boolean} areaSet 検索エリアが設定済み（成功）か。true の場合、
 *   場所入力欄を緑系（緑の枠線・薄い緑の背景）に表示する
 * @param {boolean} disabled 検索中などでの無効化
 */
export function QuickTopIntro({
  placeQuery = '',
  onPlaceQueryChange = () => {},
  onSearch = null,
  searching = false,
  searchError = null,
  areaName = null,
  areaSet = false,
  disabled = false
}) {
  // 入力欄で Enter を押した場合は「検索する」ボタンと同じ動作
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && onSearch && !disabled && !searching) {
      e.preventDefault()
      onSearch()
    }
  }
  return (
    <>
      <p className="pt-1 text-base text-slate-600">
        近くの施設を、みんなの地図で探す
      </p>

      {/* 場所指定: 地名・駅名を入力し、「検索する」を押すと
          geocode → 検索エリア確定 → 施設検索 が実行される */}
      <section className="bg-white rounded-xl p-3 shadow-sm space-y-2" aria-label="どこで探すか">
        <label htmlFor="quick-place-input" className="block text-sm font-semibold text-slate-700">
          どこあたりの場所？
        </label>
        <input
          id="quick-place-input"
          type="text"
          value={placeQuery}
          onChange={(e) => onPlaceQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="地名・駅名（例: 大阪駅）"
          disabled={disabled}
          className={
            areaSet
              ? // 検索エリア設定成功: 場所が決まったことを入力欄の色で示す
                'w-full px-3 py-2 text-sm border border-green-500 bg-green-50 rounded-lg'
              : 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50'
          }
        />
        {searchError && (
          <p role="alert" className="text-sm text-red-600">{searchError}</p>
        )}
        {areaName && (
          <p className="text-sm text-green-700">検索エリアに「{areaName}」を設定しました</p>
        )}
      </section>
    </>
  )
}

/**
 * 目的タイルグリッド（選択）＋「検索する」ボタン ＋ 「くわしく探す」導線。
 *
 * タイルはタップで「選択」だけ行う（タップで検索しない）。同時に選べる
 * のは1つだけ（別のタイルを押すと選択が移る）。選択中のタイルは枠と背景色で
 * ハイライトされる。施設検索は「検索する」ボタンの押下で初めて実行される。
 *
 * @param {(tile: object) => void} onTileTap タイルタップ（親で選択だけ行う）
 * @param {string | null} selectedTileId 選択中のタイルのid（ハイライト表示用）
 * @param {() => void} onSearch 「検索する」押下（親で geocode→施設検索→一覧切替）
 * @param {() => void} onOpenDetailed 「くわしく探す」で従来フォームへ
 * @param {boolean} searching 地名検索実行中（「検索中…」表示・無効化）
 * @param {boolean} disabled 検索中などでの無効化
 */
export function QuickTopTiles({
  onTileTap = () => {},
  onSearch = () => {},
  onOpenDetailed = () => {},
  selectedTileId = null,
  searching = false,
  disabled = false
}) {
  return (
    <>
      <section className="bg-white rounded-xl p-3 shadow-sm space-y-2" aria-label="目的から探す">
        <div className="grid grid-cols-2 gap-2">
          {QUICK_TILES.map((tile) => {
            const selected = selectedTileId === tile.id
            return (
              <button
                key={tile.id}
                type="button"
                onClick={() => onTileTap(tile)}
                disabled={disabled}
                aria-pressed={selected}
                className={
                  selected
                    ? // 選択中: 枠と背景色でハイライト
                      'min-h-[64px] rounded-xl border-2 border-primary-600 bg-primary-50 flex flex-col items-center justify-center gap-0.5 text-sm font-medium text-primary-700 disabled:opacity-50'
                    : 'min-h-[64px] rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-0.5 text-sm font-medium text-slate-700 active:bg-primary-50 disabled:opacity-50'
                }
              >
                <span aria-hidden="true" className="text-xl leading-none">{tile.icon}</span>
                {tile.label}
              </button>
            )
          })}
        </div>

        {/* 「検索する」: 施設検索を実行する唯一のエントリ（場所geocode→検索→一覧切替）。
            種別未選択のまま押下しても検索は実行されず、親が案内表示を出す */}
        <button
          type="button"
          onClick={onSearch}
          disabled={disabled || searching}
          className="w-full min-h-[44px] text-sm font-medium bg-primary-600 text-white rounded-lg disabled:opacity-50"
        >
          {searching ? '検索中…' : '検索する'}
        </button>
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
