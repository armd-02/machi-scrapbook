/**
 * (#63) モバイル「一般向けトップ」（クイックトップ）
 *
 * 検索タブの既定の初期表示。一般ユーザーは検索フォームの学習コストを
 * かけずに「場所 × 目的」だけで検索できるようにする:
 *
 * - QuickTopIntro: 一文の説明 ＋ 場所指定（地名・駅名入力）
 *   （トップ画面には地図を描画しない #63。「地図で見る」は結果側の導線）
 * - QuickTopTiles: 種別（目的グループ）タイル9種＋バリアフリーの特別枠1
 *   → タップで「選択」だけ（タップで検索しない）。
 *   タイルはすべて目的（purpose）単位で、詳しく探すの種別選択
 *   （CATEGORY_GROUPS）と同一の体系・表示順を使う（単一データソース）。
 *   バリアフリーは場所の種類ではなく見方のモードなので、カテゴリタイルと
 *   同格に並べず、グリッドの下に横長（全幅）1行の特別枠として分離する。
 *   選択中のタイルはハイライト（枠・背景色）で表示され、同時に選べるのは1つだけ
 *   （別のタイルを押すと選択が移る）。
 * - タイルの下に「検索する」ボタン: 押下（または場所入力欄で Enter）で初めて
 *   施設検索が実行される（成功でリストタブへ自動切替）。
 * - 「くわしく探す」: 従来の検索フォームへ（フォーム側には戻る導線がある）
 *
 * 「地名検索」押下時の流れ（親の handleGeocodePlace で実行）:
 * ① 入力した地名を Nominatim でジオコードする（1リクエスト/秒の制限）。
 *    現在位置が取得できていれば viewbox（現在地中心 ±0.15度）を付けて
 *    近傍の結果を優先する。bounded=1 は付けない。
 * ② 結果が1件の場合は検索エリアを設定する（入力欄を緑にし、候補の
 *    表示名（displayName）を入力欄に入れる）。複数なら候補リストを
 *    提示し、タップでエリアを設定する（入力欄に候補の表示名が入る）。
 * ③ 0件の場合は「見つからなかった」趣旨の案内を出す。
 *
 * 「指定した場所と種別で検索」押下時の流れ（親の handleTopSearch で実行）:
 * ① ジオコードは行わない。「設定済みの検索エリア＋選ばれたタイル」で
 *    施設検索を実行するだけ。
 * ② エリアが未設定なら検索せず、「先に場所を指定してください（「地名検索」
 *    か「都道府県から探す」で）」趣旨の案内を出す。
 * ③ タイル（種別）が選ばれていなければ検索せず「種別を選んでください」
 *    趣旨の案内を出す。
 * ④ 場所と種別がそろえば、その範囲・種別で施設検索を実行する。
 *
 * 入力中のサジェストは Nominatim に問い合わせない（公開 Nominatim の利用
 * ポリシーでオートコンプリートが禁止されているため）。代わりに:
 * - 自治体候補（ローカルデータ）
 * - 周辺キャッシュ（入力欄フォーカス時に現在位置から5km圏内の駅・地区・
 *   大きな公園を Overpass で1回取得した結果）の名前部分一致
 *
 * 検索範囲は「設定済みの検索エリア」（state.bbox）。「地名検索」での
 * geocode または「都道府県から探す」での自治体選択で設定される。
 * トップ画面には地図を描画しない（#63）。地図は親（MobileSearchTab）
 * が常時マウントした単一インスタンスとして保持し、フォーム表示の地図モードで
 * のみ表示される（位置・範囲はトップ⇄フォーム切替時に引き継がれる）。
 *
 * タイルはすべて目的グループ名として渡され、getPurposeUnionFilters で
 * グループ内カテゴリの union として解決される（CATEGORY_GROUPS）。
 */

import GeocodeCandidateList from '../GeocodeCandidateList'
import PlaceNameInput from '../PlaceNameInput'
import { CATEGORY_GROUPS } from '../../data/categories'

// 種別（目的グループ）タイル9種＋バリアフリー特別枠（1種）。
// CATEGORY_GROUPS から組み立てる（単一データソース）: ラベル・表示順・アイコン・
// 所属はすべて groups 側の定義に由来し、タイル側に複製した定義を持たない。
// すべて purpose（グループ名）単位（単一カテゴリのタイルは廃止）。
// バリアフリーは場所の種類ではなく見方のモードなので、カテゴリタイルと同格に
// 並べず、グリッドの下に横長（全幅）1行の特別枠として分離する（BARRIER_FREE_TILE）。
// id はグループ名（CATEGORY_GROUPS 内で一意）を使い、選択ハイライトのキーにする。
const toTile = (group) => ({ id: group.name, label: group.name, icon: group.icon, purpose: group.name })

export const QUICK_TILES = CATEGORY_GROUPS
  .filter((g) => g.name !== 'バリアフリー')
  .map(toTile)

// バリアフリー: QUICK_TILES から外し、グリッドの下に横長（全幅）1行の特別枠として
// 分離表示する。QUICK_TILES の要素と同じ形（purpose 持ち）なので、親のタイル処理は
// そのまま通用する。
export const BARRIER_FREE_TILE = toTile(
  CATEGORY_GROUPS.find((g) => g.name === 'バリアフリー')
)

/**
 * トップ冒頭ブロック: 説明一行 ＋ 場所指定（地名・駅名入力）。
 *
 * 入力欄の右に「地名検索」ボタンを置く（onGeocode を渡した場合）: 押下（または
 * 入力欄で Enter）で Nominatim ジオコードを実行し、検索エリアを設定する。
 * 施設検索は目的タイルの下にある「指定した場所と種別で検索」ボタンで行う。
 *
 * @param {string} placeQuery 場所入力値（親が管理: 切替時に状態を保持）
 * @param {(value: string) => void} onPlaceQueryChange
 * @param {(() => void) | null} onGeocode 「地名検索」実行（親で Nominatim
 *   ジオコード→検索エリア設定）。入力欄で Enter を押したときにも呼ばれる
 * @param {(() => void) | null} onFocus 地名入力欄のフォーカス時（親で周辺
 *   候補の取得を起動）
 * @param {boolean} [geocodeDisabled] 「地名検索」ボタンを無効化（ジオコード実行中等）
 * @param {string | null} searchError 地名検索エラー
 * @param {string | null} [stationError] 駅ファイル（stations.json）の読み込み
 *   失敗エラー。場所入力まわりに通信エラーとして表示（駅候補は出ない）
 * @param {boolean} areaSet 検索エリアが設定済み（成功）か。true の場合、
 *   場所入力欄を緑系（緑の枠線・薄い緑の背景）に表示する
 * @param {boolean} disabled 検索中などでの無効化
 * @param {Array | null} [candidates] 入力欄の下に表示する地名候補
 *   （geocodeCandidates() の戻り値）。サジェスト（入力中の候補）と
 *   「候補が複数あります」の提示で共通。null・空配列のときは非表示。
 *   GeocodeCandidateList（共通コンポーネント）で描画される。
 * @param {string | null} [candidatesHeading] 候補リスト上部の案内文。
 *   複数候補の提示時（「候補が複数あります。選んでください。」等）、
 *   サジェスト時は null。
 * @param {((candidate: object) => void) | null} [onCandidateSelect] 候補タップ時
 *   のコールバック。候補で検索エリアを設定する（親で処理）。
 */
export function QuickTopIntro({
  placeQuery = '',
  onPlaceQueryChange = () => {},
  onGeocode = null,
  onFocus = null,
  geocodeDisabled = false,
  searchError = null,
  stationError = null,
  areaSet = false,
  geocoding = false,
  disabled = false,
  candidates = null,
  candidatesHeading = null,
  onCandidateSelect = null
}) {
  // 入力欄で Enter を押した場合は「地名検索」ボタンと同じ動作（ジオコード実行）
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && onGeocode && !disabled && !geocodeDisabled) {
      e.preventDefault()
      onGeocode()
    }
  }
  return (
    <>
      <p className="pt-1 text-base text-slate-600">
        好きな場所で作る、わたしのまち
      </p>

      {/* 場所指定: 地名・駅名を入力し、「地名検索」を押すと
          geocode → 検索エリア確定 が実行される */}
      <section className="bg-white rounded-xl p-3 shadow-sm space-y-2" aria-label="どこで探すか">
        <label htmlFor="quick-place-input" className="block text-sm font-semibold text-slate-700">
          どこあたりの場所？
        </label>
        <PlaceNameInput
          id="quick-place-input"
          value={placeQuery}
          onChange={onPlaceQueryChange}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          onGeocode={onGeocode}
          placeholder="地名・駅名（例: 大阪駅）"
          disabled={disabled}
          geocoding={geocoding}
          geocodeDisabled={geocodeDisabled}
          areaSet={areaSet}
        />
        {/* 地名候補リスト（入力欄の下）。サジェスト（入力中の候補: 自治体＋
            Overpass 周辺キャッシュ）と「候補が複数あります」の提示で共通の
            GeocodeCandidateList を使う。候補タップで検索エリアが設定され、
            リストは閉じる（親で制御） */}
        {candidates && candidates.length > 0 && (
          <GeocodeCandidateList
            candidates={candidates}
            heading={candidatesHeading}
            onSelect={onCandidateSelect}
            disabled={disabled}
          />
        )}
        {searchError && (
          <p role="alert" className="text-sm text-red-600">{searchError}</p>
        )}
        {stationError && (
          <p role="alert" className="text-sm text-red-600">{stationError}</p>
        )}
        {/* 成功フィードバック（「設定しました」文言）は廃止: 候補を選ぶと
            入力欄に候補の表示名が入るため、何が設定されたか欄から分かる */}
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
 * @param {() => void} onSearch 「指定した場所と種別で検索」押下（親で
 *   設定済みエリア＋種別に絞った施設検索→一覧切替。ジオコードは行わない）
 * @param {() => void} onOpenDetailed 「くわしく探す」で従来フォームへ
 * @param {boolean} searching 施設検索実行中（「検索中…」表示・無効化）
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

        {/* バリアフリー: 場所の種類ではなく見方のモードなので、カテゴリタイルと
            同格に並べず、グリッドの下に横長（全幅）1行の特別枠として分離表示。
            他のタイルと同じくタップで「選択」だけを行い、「指定した場所と種別で検索」で検索する */}
        <button
          type="button"
          onClick={() => onTileTap(BARRIER_FREE_TILE)}
          disabled={disabled}
          aria-pressed={selectedTileId === BARRIER_FREE_TILE.id}
          className={
            selectedTileId === BARRIER_FREE_TILE.id
              ? // 選択中: 他のタイルと同じハイライト（実線・プライマリ色）
                'w-full min-h-[48px] rounded-xl border-2 border-primary-600 bg-primary-50 flex items-center justify-center gap-1.5 px-3 text-sm font-medium text-primary-700 disabled:opacity-50'
              : // 枠線は他のタイルと同一（実線・slate-200）に統一
                'w-full min-h-[48px] rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center gap-1.5 px-3 text-sm font-medium text-slate-700 active:bg-primary-50 disabled:opacity-50'
          }
        >
          <span aria-hidden="true" className="text-xl leading-none">{BARRIER_FREE_TILE.icon}</span>
          {BARRIER_FREE_TILE.label}
        </button>

        {/* 「指定した場所と種別で検索」: 施設検索を実行する唯一のエントリ
            （設定済みエリア＋タイルで検索→一覧切替。ジオコードは行わない）。
            エリア未設定・種別未選択のまま押下しても検索は実行されず、
            親が案内表示を出す */}
        <button
          type="button"
          onClick={onSearch}
          disabled={disabled || searching}
          className="w-full min-h-[44px] text-sm font-medium bg-primary-600 text-white rounded-lg disabled:opacity-50"
        >
          {searching ? '検索中…' : '指定した場所と種別で検索'}
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
