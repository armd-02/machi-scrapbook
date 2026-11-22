import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { useSearch } from '../../hooks/useSearch'
import { getMapInstance } from '../../hooks/useMapRef'
import { buildSearchCriteria } from '../../utils/searchCriteria'
import { boundsToBbox, isValidBbox } from '../../utils/searchBbox'
import { checkBboxSize, geocodeCandidates, isBboxTooLarge, isMunicipalityCandidate, searchAreaFromGeocode, sortCandidatesByDistance, viewboxAround, overpassNameSearch } from '../../utils/geo'
import { matchNearbyCandidates } from '../../utils/nearbyCandidates'
import { loadStationFile, stationFileToCandidates, matchStationCandidates, combineSuggestCandidates, unifySuggestCandidates } from '../../utils/stationCandidates'
import { useNearbyPlaceCandidates } from '../../hooks/useNearbyPlaceCandidates'
import { loadMunicipalities, matchMunicipalities, exactMatchMunicipalities, municipalityToCandidate } from '../../utils/municipalities'
import { loadPlaceHistory, rememberPlace } from '../../utils/placeHistory'
import SimpleSearch from '../SimpleSearch'
import MunicipalitySearch from '../MunicipalitySearch'
import AdvancedSearch from '../AdvancedSearch'
import SearchActionButton from '../SearchActionButton'
import ShareButton from '../ShareButton'
import MapView from '../MapView'
import GeocodeCandidateList from '../GeocodeCandidateList'
import PlaceNameInput from '../PlaceNameInput'
import { QuickTopIntro, QuickTopTiles } from './MobileQuickTop'
import BarrierFreeLegend from '../BarrierFreeLegend'
import PoiDescription from '../PoiDescription'
import { useDraggableHeight, MAP_HEIGHT_STORAGE_KEY_MOBILE } from '../../hooks/useDraggableHeight'

/**
 * (#59) モバイル「検索」タブ
 *
 * 入力順（優先度順）: 1) エリア 2) 施設カテゴリ 3) 施設名・キーワード 4) 検索実行
 * - (#60) 地図モードでは画面上部に地図を表示。地図を移動・拡大することで
 *   検索範囲を同一画面で指定できる（独立した「地図」タブは廃止）
 * - (#63) 初期表示は「一般向けトップ」（QuickTopIntro + 目的タイル）。
 *   「くわしく探す」で従来の検索フォーム（view='form'）へ切替、フォーム側から
 *   「トップへ戻る」でトップへ戻れる。地図は両ビューで同一の単一インスタンス
 *   （ツリー内で安定した位置に描画するため再マウントせず、位置・範囲を引き継ぐ）。
 *   (#63) トップ表示（view='top'）には地図を描画しない（mapBlock は hidden、
 *   マウントは維持）。フォーム表示（view='form'）では地図ブロックは常に表示される
 *   （フォームは常に地図モード＝「地図から探す」のみのため）。タイル検索は「地図の表示範囲」ではなく「設定済みの
 *   検索エリア」（state.bbox）で行う。検索エリアは次の2つの方法で設定される:
 *     ① 場所入力欄の「地名検索」ボタン（または Enter）での geocode（地名・駅名の
 *        結果の範囲を検索エリアに設定。駅など小さな範囲は約1.5km正方形に拡大）
 *     ② 「都道府県から探す」セクションで自治体を選択（そのbboxをエリアに設定）
 *   操作の流れ:
 *     ① 地名・駅名を入力して「地名検索」を押す（または Enter。geocode で検索
 *        エリアを確定。成功で入力欄が緑になり、候補の表示名（displayName）が
 *        入力欄に入る）。または「都道府県から探す」で自治体を選ぶ。
 *     ② 目的タイルを1つ選択（タップは選択だけ。選択中はハイライト表示。
 *        別のタイルを押すと選択が移る）
 *     ③ タイル下の「指定した場所と種別で検索」ボタンで検索実行。
 *        ジオコードは行わず、設定済みのエリア＋タイル（種別）で施設検索する。
 *        エリアが未設定なら検索せず「先に場所を指定してください」趣旨の案内、
 *        タイル（種別）が未選択なら検索せず「種別を選んでください」趣旨の
 *        案内を表示する。
 *   入力中のサジェストは Nominatim に問い合わせない（公開 Nominatim の利用
 *   ポリシーでオートコンプリートが禁止されているため）: 自治体候補（ローカル
 *   データ）＋周辺 Overpass キャッシュ（駅・地区・大きな公園。入力欄フォーカス
 *   時に1回取得してキャッシュ）の名前部分一致で端末内照合する。
 *   場所と種別がそろえばその範囲・種別で施設検索を実行し、成功で一覧タブへ
 *   自動切替される（MobileShell 側の既存挙動）。
 *   詳細フォーム側（form 表示は常に地図モード）と結果画面の動作は変更しない。
 *   自治体モードの検索はトップ画面の「都道府県から探す」セクションで実行される。
 *   フォームに検索ソース切替タブ（「自治体から探す」／「地図から探す」）は無い。
 *   フォームを開いた時点でソースが自治体モードのままの場合（初期状態、またはセクション
 *   経由で検索した直後など）、地図モードへ自動切替し、#49 の引き継ぎで自治体モードの
 *   条件（カテゴリ・料理・目的）を地図モード側（simpleSearch）に引き継ぐ。
 * - (top) 場所入力（QuickTopIntro）のすぐ下・地図（mapBlock）の上に「都道府県から探す」
 *   折りたたみセクション（既定は閉じた状態）。
 *   見出しタップで MunicipalitySearch（variant="mobile"：都道府県→市区町村→任意でカテゴリ等）
 *   が展開され、「検索する」で自治体モードの検索を実行する（#47 パターンを自治体モードに
 *   応用: 更新後の状態スナップショット → buildSearchCriteria → search()）。検索成功時の
 *   一覧タブ自動切替は既存の挙動のまま。
 * - (#xx) フォーム表示の地図モードでは「どの街・エリアで探す？」セクションに場所入力欄を
 *   置く（トップの QuickTopIntro「どこで探すか？」と同様の挙動を共有する）。
 *   地名・駅名の入力でサジェスト（自治体ローカル計算＋Overpass 周辺キャッシュ）が
 *   出る。候補タップまたは「地名検索」ボタン（または Enter）で geocode →
 *   確定場所を検索エリア（state.bbox）に設定し、入力欄が
 *   緑になり候補の表示名（displayName）が入る。確定時（bboxSource:
 *   geocode/municipality）は MapView が fitBounds で確定場所にfitし、地図上に検索範囲の
 *   青（#2563eb）矩形を描画する（BBOXオーバーレイ）。検索は確定した範囲で実行される
 *   （地図を移動しても確定場所の範囲が優先）。入力をクリアすると矩形が消え、
 *   検索範囲は地図の現在表示範囲に戻る。
 * - 詳細条件は「条件を追加」で展開する段階的開示（AdvancedSearch）
 * - 「検索する」ボタンはスロールームの外（ヘッダー横並び方式のP0再発防止）
 * - 地図の移動でOverpass検索は実行されない（明示的な押下のみ）
 * - 検索中は「中止」でキャンセル可能
 */

// 「広すぎる」ガード（BBOX面積ベース: geo.js の isBboxTooLarge）で統一する
// エラー文。候補選択時（handleCandidateSelect）と「地名検索」時
// （handleGeocodePlace）で共通にする
const tooLargeSearchError = (name) =>
  `『${(name || '').trim()}』の範囲が広すぎるため検索できません。市区町村や駅・地名を指定してください。`

export default function MobileSearchTab({ view = 'top', onViewChange = () => {}, onViewResults, onMarkerClick = null }) {
  const { state, dispatch } = useApp()
  const { search, cancel } = useSearch()
  const { searchSource, searchMode, bbox, bboxSource, selectedMunicipality } = state
  const [boundsVersion, setBoundsVersion] = useState(0)

  // (#63) 場所指定（クイックトップの地名入力）。親コンポーネントがview切替に
  // 関係なく同じインスタンスを維持するため、入力状態はこのコンポーネントが保持する
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeFocused, setPlaceFocused] = useState(false)
  const [placeHistory, setPlaceHistory] = useState(loadPlaceHistory)
  const [searchError, setSearchError] = useState(null)
  // 検索エリアとして設定した場所の表示名（成功フィードバック用）
  const [areaName, setAreaName] = useState(null)
  // 「検索する」で geocode → 検索エリア設定に成功したか。true の場合、
  // 場所入力欄を緑色で表示する。入力内容の編集やエラー時は解除される
  const [placeAreaSet, setPlaceAreaSet] = useState(false)
  // (top) 選択中の目的タイル（QUICK_TILES の要素）。タップで選択だけを行い、
  // 別のタイルを押すと選択が移る（同時に選べるのは1つだけ）。
  // 施設検索はタイル下の「検索する」ボタンで実行される
  const [selectedTile, setSelectedTile] = useState(null)

  // (top) 「都道府県から探す」折りたたみセクションの開閉（既定は閉じた状態）
  const [muniSectionOpen, setMuniSectionOpen] = useState(false)

  // (top) 地名入力のサジェスト: 入力欄の下に表示する候補（自治体候補＋
  // Overpass 周辺キャッシュの端末内照合。入力中の Nominatim 問い合わせは行わない）
  const [suggestCandidates, setSuggestCandidates] = useState([])
  // 「地名検索」実行中（明示的な Nominatim ジオコード）。地名入力欄右端の
  // スピナー表示に使う（入力欄自体は無効化しない）。「地名検索」ボタンの
  // 無効化・Enter のガードにも使う
  const [geocoding, setGeocoding] = useState(false)
  // (top) 自治体サジェスト候補（municipalities.json からローカル計算）。Nominatim の
  // 順位に左右されず、自治体名を確実に選べるようにするため Nominatim 候補より
  // 前に表示する（ローカル計算なので即座に出る）。QuickTopIntro 渡しの候補は
  // [...muniSuggest, ...suggestCandidates] の順で組み立てる
  const [muniSuggest, setMuniSuggest] = useState([])
  // (top) 自治体データ（municipalities.json）。トップ表示時に読み込む
  const [municipalities, setMunicipalities] = useState([])

  // 周辺地名候補（地区・大きな公園）。地名入力欄のフォーカス時に現在位置
  // から5km圏内を Overpass で1回取得してキャッシュし、入力中の端末内照合に
  // 使う。位置情報が拒否された場合は空配列（自治体候補のみで動作）。
  // 駅・路面電車・ケーブルカーの候補は全国駅ファイル（stations.json）から取る
  const nearby = useNearbyPlaceCandidates()

  // 全国駅ファイルの候補（stations.json。トップ表示時に1回だけ読み込む・
  // モジュールキャッシュで再読み込みを防ぐ）。読み込み失敗時はエラー表示
  // （stationLoadFailed）し駅候補は出さない（無言で空に落とさない・
  // 再試行はページ再読み込みのみ）
  const [stations, setStations] = useState([])
  const [stationLoadFailed, setStationLoadFailed] = useState(false)
  // 駅ファイル読み込み失敗メッセージ（トップ・フォーム両方の場所入力まわりに
  // 表示する。駅候補は出さない・再試行はページ再読み込みのみ）
  const stationError = stationLoadFailed
    ? '駅データの読み込みに失敗しました。駅候補は表示されません（ページを再読み込みしてください）。'
    : null
  // stations への反映は1回だけ（トップ↔フォームのview切替で effect が
  // 再実行されても同じ Promise が返るので状態の書き換えを1回に抑える）
  const stationsLoadedRef = useRef(false)

  // 地名入力欄フォーカス時: 周辺候補の現在位置取得・Overpass キャッシュ
  // （nearby.request）。駅ファイルはトップ表示時に読み込むためここではしない
  const handlePlaceFocus = useCallback(() => {
    setPlaceFocused(true)
    nearby.request()
  }, [nearby.request])
  const handlePlaceBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setPlaceFocused(false)
  }

  // (top) トップ表示時に自治体データと全国駅ファイルを読み込む。
  // 両方ともモジュールキャッシュで二重取得しない（loadMunicipalities は
  // 失敗時も空配列を返すため catch は不要）。駅ファイルは失敗時に Error で
  // reject するため catch でエラー表示する（駅候補は出さない・再試行しない）。
  // 状態への反映は view 切替後に解決しても行う（フォーム表示の場所入力も
  // 自治体候補・駅候補の両方を使うため cancelled 判定を付けない）。駅ファイルの
  // 反映は stationsLoadedRef で1回に抑え、自治体データはモジュールキャッシュが
  // 同じ配列参照を返すため React が更新をスキップして冪等になる
  useEffect(() => {
    if (view !== 'top') return undefined
    loadMunicipalities().then((list) => setMunicipalities(list))
    loadStationFile()
      .then((rows) => {
        if (stationsLoadedRef.current) return
        stationsLoadedRef.current = true
        setStations(stationFileToCandidates(rows))
      })
      .catch(() => setStationLoadFailed(true))
  }, [view])

  // 自治体データが後から読み込み完了した場合に、現在の入力値で自治体候補を
  // 再計算する（データより先にユーザーが入力したケースに対応。フォーム表示の
  // 場所入力も自治体候補を使うためトップ表示に限定しない）。検索エリアが
  // 設定済みならスキップする（入力欄には選択した候補の displayName が入っていて
  // ユーザーの入力ではないため・view 切替で設定済みエリアのリストが再出現しない）
  useEffect(() => {
    if (placeAreaSet) return
    const q = placeQuery.trim()
    setMuniSuggest(q.length >= 2
      ? matchMunicipalities(municipalities, q).map(municipalityToCandidate)
      : [])
  }, [municipalities, placeAreaSet])

  // (top) 周辺キャッシュが取得完了（フォーカス→Overpass取得→完了）したとき
  // に、現在の入力値で周辺候補を再導出する（取得中にすでに文字が入力されて
  // いたケースに対応）
  useEffect(() => {
    const q = placeQuery.trim()
    if (q.length < 2) return
    // 検索エリアが設定済みなら再導出しない（候補選択の瞬間に通信中だった
    // 周辺候補の結果が後から届いても、候補リストを再表示させない）。入力が
    // 編集されると placeAreaSet がクリアされるので、その後はリストが再表示
    // される
    if (placeAreaSet) return
    // 駅ファイルが後から読み込み完了した場合もここで再導出される
    setSuggestCandidates(
      combineSuggestCandidates(
        matchStationCandidates(stations, q),
        matchNearbyCandidates(nearby.candidates, q),
        nearby.center
      )
    )
  }, [stations, nearby.candidates, nearby.center, placeQuery, placeAreaSet])

  // (top) 「地名検索」で候補が複数（2件以上）だったときの選択待ち候補。
  // 入力欄の下に「候補が複数あります。選んでください。」の案内付きで表示され、
  // 候補タップで検索エリアが設定される。施設検索は実行されない
  const [pendingCandidates, setPendingCandidates] = useState(null)
  // (top) 検索エリアが設定された地名（trim 済み入力値）。同じ名前で
  // 「地名検索」を再度押したときは、geocode せず設定済みエリアを再利用する
  // （複数候補の提示→選択→再度「地名検索」の流れで、提示がループしないように）
  const [areaSetQuery, setAreaSetQuery] = useState(null)

  const confirmPlace = ({ query, displayName, bbox }) => {
    dispatch({ type: 'SET_BBOX', payload: bbox })
    setAreaName(displayName)
    setPlaceAreaSet(true)
    setPlaceQuery(displayName)
    setAreaSetQuery(displayName)
    setSearchError(null)
    setSuggestCandidates([])
    setMuniSuggest([])
    setPendingCandidates(null)
    setPlaceHistory(rememberPlace(placeHistory, { query, displayName, bbox }))
  }

  // (top) 目的タイル → 検索条件（handleTopSearch と自治体セクションへの引き継ぎで共用）
  const tileConditions = (tile) => (tile.purpose
    ? { category: '', cuisine: '', keyword: '', purpose: tile.purpose }
    : { category: tile.category, cuisine: '', keyword: '', purpose: '' })

  // (top) タイル下の「指定した場所と種別で検索」ボタンで実行する施設検索。
  // ジオコードは一切行わない: 「設定済みの検索エリア＋選ばれたタイル（種別）」
  // のみで施設検索を実行する（明示的な1回の操作で Nominatim に問い合わせる
  // 「地名検索」と役割を分ける）。
  // ① エリアが未設定なら検索せず、「先に場所を指定してください」趣旨の案内。
  // ② タイル（種別）が未選択なら検索せず「種別を選んでください」案内。
  // ③ 場所と種別がそろえば、その範囲・種別で施設検索を実行
  //   （成功で MobileShell が一覧タブへ自動切替）。
  const handleTopSearch = () => {
    if (state.status === 'loading') return

    // ① 検索エリアの確認（geocode は行わない）。エリアは「地名検索」または
    //   「都道府県から探す」の自治体選択で設定済みの state.bbox
    const areaBbox = state.bbox
    const areaSource = state.bboxSource
    if (!areaBbox || !isValidBbox(areaBbox)) {
      dispatch({ type: 'SET_STATUS', payload: 'error' })
      dispatch({
        type: 'SET_ERROR',
        // 文の区切りで改行（\n）。表示側は StatusBanner が whitespace-pre-line で改行を保持する
        payload: '場所がまだ設定されていません。\n地名・駅名を入力して「地名検索」を押すか、\n「都道府県から探す」で自治体を選択してください。',
        errorType: 'validation'
      })
      return
    }

    // ② 種別（目的タイル）が未選択
    if (!selectedTile) {
      dispatch({ type: 'SET_STATUS', payload: 'error' })
      dispatch({
        type: 'SET_ERROR',
        payload: '種別を選んでください。\n目的の施設にあたる目的タイルを1つタップしてください。',
        errorType: 'validation'
      })
      return
    }

    // ③ 施設検索（旧タイル即検索と同じ方式: 更新後の状態スナップショット
    //    → buildSearchCriteria → search）
    const conditions = tileConditions(selectedTile)

    // 地図モードで検索する。自治体モード等なら先に地図モードへ切替
    // （目的タイル・フォーム経由のいずれの流れでも地図モードで検索する既存設計を維持）
    if (state.searchSource !== 'map') {
      dispatch({ type: 'SET_SEARCH_SOURCE', payload: 'map' })
    }
    dispatch({ type: 'SET_SIMPLE_SEARCH', payload: conditions })

    // stale-state競合を避けるため、更新後の状態からスナップショットを構築 (#47)。
    // 検索は設定済みの検索エリア（state.bbox）の範囲で実行する。トップ画面には
    // 地図を描画しないため、地図の表示範囲（mapBounds）は使わない。
    const next = {
      ...state,
      searchSource: 'map',
      simpleSearch: { ...state.simpleSearch, ...conditions }
    }
    const criteria = buildSearchCriteria(next, {})
    // criteria が ok でない場合、壊れた criteria を search() に渡さない
    // （渡すと useSearch 側の検証エラーが発火し、通信エラーとして表示される）。
    // 代わりに criteria 自身の message / suggestion をエラー表示する。
    if (criteria.ok !== true) {
      dispatch({ type: 'SET_STATUS', payload: 'error' })
      dispatch({
        type: 'SET_ERROR',
        payload: criteria.message,
        errorType: 'validation',
        errorSuggestion: criteria.suggestion
      })
      return
    }
    search(criteria)
  }

  // (top) 地名入力欄の「地名検索」ボタン（または Enter）で実行する
  // ジオコードフロー。Nominatim で地名を確定し、結果を検索エリアに設定する
  // （施設検索は実行しない。施設検索は「指定した場所と種別で検索」で行う）。
  // - 入力が空ならエラー案内
  // - 同じ地名のエリアが既に設定済みなら何もしない（再geocodeしない。
  //   Nominatim のレート制限・候補提示ループの防止）
  // - 自治体の完全一致が1件: その自治体の範囲をエリアに設定（Nominatim 呼ばない）
  // - 完全一致が2件以上: 自治体候補だけ複数提示（Nominatim 呼ばない）
  // - それ以外: Nominatim で geocode（1リクエスト/秒の制限）。Nominatim 問い合わせ
  //   前に現在位置の取得確定を待つ（未取得ならその場で取得を開始して待つ、
  //   失敗なら viewbox なしで従来どおり）。位置が取れていれば viewbox（現在地中心
  //   ±0.15度）を付けて近傍の結果を優先する（bounded=1 は付けない）。viewbox
  //   付きでは limit=20 で取得し、現在位置からの距離順に並べ替えて先頭5件を使う
  //   ・候補1件: エリア設定（成功で入力欄が緑＋フィードバック）
  //   ・候補複数: 候補リストを提示（タップでエリア設定）
  //   ・0件・広すぎる: 入力欄の下にエラー表示
  const handleGeocodePlace = async () => {
    const q = placeQuery.trim()
    if (!q) {
      setSearchError('先に地名・駅名を入力してください。')
      return
    }
    if (state.status === 'loading' || geocoding) return

    // 同じ地名のエリアが既に設定済みなら何もしない（再geocodeしない）
    if (placeAreaSet && q === areaSetQuery && bbox && isValidBbox(bbox)) return

    // 端末内のローカルサジェスト（自治体・周辺キャッシュ）をクリアする。
    // ジオコードの結果（単一候補でのエリア設定、または複数候補の提示）が
    // 代わりに表示されるため
    setSuggestCandidates([])
    setMuniSuggest([])
    setGeocoding(true)
    setSearchError(null)
    setAreaName(null)
    // 実行中は緑を解除。成功時のみ再度設定される（見つからなかった場合は緑にならない）
    setPlaceAreaSet(false)
    setAreaSetQuery(null)
    setPendingCandidates(null)
    try {
      // 自治体の完全一致をNominatimより先に調べる（静的データでローカル解決）。
      // Nominatim の順位に左右されず、自治体名は確実にその自治体で解決される
      const exact = exactMatchMunicipalities(municipalities, q)
      if (exact.length === 1) {
        const result = municipalityToCandidate(exact[0])
        const areaBbox = searchAreaFromGeocode(result)
        confirmPlace({ query: q, displayName: result.displayName, bbox: { ...areaBbox, source: 'municipality' } })
        return
      }
      if (exact.length >= 2) {
        setPendingCandidates(exact.map(municipalityToCandidate))
        return
      }
      // 完全一致なし: Nominatim の流れ。Nominatim を問い合わせる前に現在位置
      // の取得が確定するのを待つ（既に取れていれば即決。進行中なら確定を待ち、
      // 未開始ならその場で取得を開始して待つ。拒否・失敗・タイムアウトなら
      // viewbox なしで従来どおり問い合わせる — ユーザーをブロックしない）
      const pos = await nearby.awaitPosition()
      const viewbox = viewboxAround(pos)
      // viewbox 付きのときは多めに取得（limit=20）して現在位置からの距離順に
      // 並び替え、先頭5件を候補として使う（Nominatim は距離順に並べないため）。
      // viewbox なしは従来どおり limit=5・Nominatim の順序のまま
      const cands = viewbox
        ? sortCandidatesByDistance(
            await geocodeCandidates(q, { viewbox, limit: 20 }),
            pos,
            5
          )
        : await geocodeCandidates(q, { limit: 5 })

      // Nominatim 候補のどれも name に検索語を含まない場合、Overpass の全国
      // 名前検索で補完する（Nominatim は検索語と完全に同名の要素しか返さず、
      // 例: 「岡山大学」→「岡山大学 津島キャンパス」は候補にならない）。補完が
      // 候補を返したら Nominatim 部分一致候補（検索語を含まないもの）は提示せず、
      // 補完候補のみを提示する。補完が空（・失敗）なら従来どおりの流れ
      // （Nominatim 結果／「見つからない」）に戻る
      if (!cands.some((c) => (c.name || '').includes(q))) {
        const fallbackCands = await overpassNameSearch(q, { center: pos })
        if (fallbackCands.length > 0) {
          setPendingCandidates(fallbackCands)
          return
        }
      }

      if (cands.length === 0) {
        setSearchError('場所が見つかりませんでした。別の表記で試してください。')
        return
      }
      if (cands.length >= 2) {
        setPendingCandidates(cands)
        return
      }
      // 候補が1件: その範囲を検索エリアに設定
      const result = cands[0]
      // 候補の元のBBOXが広すぎる（国・外国の州・都道府県など）: 検索エリアに
      // 設定せず、場所入力欄の下でエラー表示（広範囲全域の巨大クエリを防ぐ）。
      // 市区町村レベルの行政区域（isMunicipalityCandidate）はガードの対象外
      // （大きな市（例: 高山市）を地名入力から検索できる仕様）
      if (!isMunicipalityCandidate(result) && isBboxTooLarge(result.boundingbox)) {
        setSearchError(tooLargeSearchError(result.name))
        return
      }
      const areaBbox = searchAreaFromGeocode(result)
      confirmPlace({ query: q, displayName: result.displayName, bbox: { ...areaBbox, source: 'geocode' } })
    } catch (error) {
      setSearchError(error.message || '地名検索に失敗しました')
    } finally {
      setGeocoding(false)
    }
  }

  // (top) 目的タイル: タップは「選択」だけ（検索は実行しない）。
  // 同時に選べるのは1つだけ: 別のタイルを押すと選択が移る。
  // 実際の施設検索はタイル下の「検索する」ボタン（handleTopSearch）で実行される。
  const handleTileSelect = (tile) => {
    if (state.status === 'loading') return
    setSelectedTile(tile)
    // 自治体が選択済みなら、セクション内検索にも種別を引き継ぐ
    // （自治体→タイルの順で操作しても、セクションの「検索する」で種別が効く）
    if (state.selectedMunicipality) {
      dispatch({ type: 'SET_MUNICIPALITY_SEARCH', payload: tileConditions(tile) })
    }
  }

  // (top) 自治体セクションの「検索する」: #47 パターン（更新後の状態スナップショット →
  // buildSearchCriteria → search()）を自治体モードに応用。
  // 通常はソースが municipality でセクション内の条件は既に state に反映済みなので
  // state をそのまま読む。ソースが map（目的タイルや「地図で見る」で切替された流れ）の
  // 場合は、まず municipality へ切替し、直後にセクション内で設定された条件をそのまま
  // 再dispatchして、reducer の #49 引き継ぎ（last-wins）による上書きを防ぐ。
  // これによりスナップショットと dispatch 後の状態が一致する。
  const handleMuniSectionSearch = () => {
    if (state.status === 'loading') return
    const ms = state.municipalitySearch || { category: '', cuisine: '', purpose: '' }
    let next = state
    if (state.searchSource !== 'municipality') {
      dispatch({ type: 'SET_SEARCH_SOURCE', payload: 'municipality' })
      dispatch({ type: 'SET_MUNICIPALITY_SEARCH', payload: { ...ms } })
      next = { ...state, searchSource: 'municipality' }
    }
    const criteria = buildSearchCriteria(next)
    if (criteria.ok !== true) return
    search(criteria)
  }
  // 場所入力の内容が編集されたら、緑のスタイルと検索エリアを未設定に戻す。
  // 入力内容と検索エリアが食い違う状態を作らないため（「指定した場所と種別で
  // 検索」の未設定ガードが再び働く）。エラー表示・成功フィードバックも一緒に消す。
  // サジェストは即座に再計算する: 自治体候補（ローカルデータ）＋周辺 Overpass
  // キャッシュの端末内照合（matchNearbyCandidates）。入力中のネットワーク
  // 問い合わせは行わない（公開 Nominatim の利用ポリシー）。
  const handlePlaceQueryChange = (value) => {
    setPlaceQuery(value)
    setPlaceAreaSet(false)
    setAreaName(null)
    setSearchError(null)
    setAreaSetQuery(null)
    dispatch({ type: 'SET_BBOX', payload: null })
    // 選択待ち候補をリセットする（古いリストを残さない）
    setPendingCandidates(null)

    const q = value.trim()
    // 自治体候補: 静的データでローカル計算するため即座に表示する
    setMuniSuggest(q.length >= 2
      ? matchMunicipalities(municipalities, q).map(municipalityToCandidate)
      : [])
    // 駅候補（全国駅ファイル）＋周辺候補（地区・公園）: 端末内で照合して
    // 結合する（位置が分かっていれば距離順・分からなければ駅→周辺の順）
    setSuggestCandidates(q.length >= 2
      ? combineSuggestCandidates(
          matchStationCandidates(stations, q),
          matchNearbyCandidates(nearby.candidates, q),
          nearby.center
        )
      : [])
  }

  // (top) 候補をタップしたら、その候補で検索エリアを設定する（既存の
  // 「地名が見つかった」ときと全く同じ流れ: bbox → state.bbox、入力欄が緑になり
  // 候補の表示名（displayName）が入る）。リストは閉じる。
  // 施設検索はまだ実行しない（「指定した場所と種別で検索」ボタンで実行）。
  // サジェストの候補（自治体・周辺 Overpass キャッシュ）と「候補が複数あります」
  // の候補（Nominatim）で共通。
  // エリアの範囲: 駅・地区（点）は searchAreaFromGeocode が約1.5km正方形にする。
  // 公園は取得した bounds（out bb）を使うが、小さい場合は拡大する
  // （公園の bbox 面積が0.01km²未満なら約1.5km正方形に）。
  const handleCandidateSelect = (candidate) => {
    // 候補の元のBBOXが広すぎる（国・外国の州・都道府県など）: 検索エリアを設定
    // せず（広範囲全域の巨大クエリを防ぐ）、場所入力欄の下でエラー表示
    // （searchError）で知らせる。通常候補（駅・地名など）は従来どおり
    // エリアが設定される。市区町村レベルの候補（自治体データ由来、または
    // Nominatim の addresstype が市区町村レベルの行政区域）はガードの対象外
    // （大きな市（例: 高山市）を地名入力から検索できる仕様・
    // 「都道府県から探す」等の自治体検索経路を現行仕様に維持）
    if (!isMunicipalityCandidate(candidate) && isBboxTooLarge(candidate.boundingbox)) {
      dispatch({ type: 'SET_BBOX', payload: null })
      setAreaName(null)
      setPlaceAreaSet(false)
      setAreaSetQuery(null)
      setSearchError(tooLargeSearchError(candidate.name))
      setSuggestCandidates([])
      setMuniSuggest([])
      setPendingCandidates(null)
      return
    }
    const areaBbox = searchAreaFromGeocode(
      candidate,
      candidate.kind === '公園' ? { thresholdKm2: 0.01 } : {}
    )
    // 候補の由来: 自治体（静的データ由来 kind='自治体'・市区町村レベルのaddresstype）→
    // 'municipality'、それ以外（Nominatim・周辺Overpassキャッシュ由来）→ 'geocode'
    confirmPlace({
      query: placeQuery.trim() || candidate.displayName,
      displayName: candidate.displayName,
      bbox: {
        ...areaBbox,
        source: isMunicipalityCandidate(candidate) ? 'municipality' : 'geocode'
      }
    })
  }

  // (#xx) 場所入力欄のキー操作: Enter で「地名検索」実行（geocode→エリア設定）、
  // Escape で入力と検索エリアをクリア（矩形も消える）。
  // トップの QuickTopIntro とフォームの地図モードで共有する。
  const handleMapPlaceKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleGeocodePlace()
    } else if (e.key === 'Escape') {
      handlePlaceQueryChange('')
    }
  }

  // 地図上のマーカータップで選択されたPOI（説明枠の表示用）
  const [tappedPoi, setTappedPoi] = useState(null)
  useEffect(() => {
    if (state.status === 'success') setTappedPoi(null)
  }, [state.results, state.status])
  // 地図の高さをドラッグで変更（既定240px）。
  // 高さ変更に合わせて map.resize() を呼ぶことで、MapLibre の描画が
  // ドラッグに追随する（MapView側のResizeObserverは2重の安全策）
  const handleMapResize = () => {
    const map = getMapInstance()
    if (map && typeof map.resize === 'function') map.resize()
  }
  const mapHeight = useDraggableHeight({ defaultHeight: 240, minHeight: 160, maxHeight: 480, storageKey: MAP_HEIGHT_STORAGE_KEY_MOBILE, onResize: handleMapResize })

  // (#xx) フォームは常に地図モード（「地図から探す」）。フォームを開いた時点で
  // ソースが自治体モードのままの場合（初期状態、または「都道府県から探す」セクション
  // 経由で検索した直後など）、地図モードへ自動切替する。#49 の引き継ぎで自治体
  // モードの条件（カテゴリ・料理・目的）を地図モード側（simpleSearch）に引き継ぐ。
  useEffect(() => {
    if (view === 'form' && state.searchSource !== 'map') {
      dispatch({ type: 'SET_SEARCH_SOURCE', payload: 'map' })
    }
  }, [view, state.searchSource, dispatch])

  const setMode = (mode) => {
    dispatch({ type: 'SET_SEARCH_MODE', payload: mode })
  }

  // (#63) 「都道府県から探す」セクション（またはフォームの自治体モード）で
  // 自治体が選択されたら、その範囲を検索エリア（state.bbox）として保持する。
  // これでトップ画面でタイルを選択して「検索する」を押すと、その自治体の範囲で
  // 検索できる（入力が空ならこのエリアがそのまま使われる）。
  // セクション自身の「検索する」ボタンの動作は変えない（自治体モードの条件は
  // 自治体のbboxを直接使用するため）。選択解除（null）時はエリアを消さない。
  const prevMunRef = useRef(state.selectedMunicipality)
  useEffect(() => {
    const mun = state.selectedMunicipality
    if (mun === prevMunRef.current) return
    prevMunRef.current = mun
    if (mun && mun.bbox && isValidBbox(mun.bbox)) {
      dispatch({ type: 'SET_BBOX', payload: { ...mun.bbox } })
      // 目的タイルが選択済みなら、その種別を自治体モードの条件にも引き継ぐ
      // （「都道府県から探す」セクション内の「検索する」でも、タイルで選んだ
      // 種別が効くようにする。タイルだけ見て検索する流れとの一貫性のため）
      if (selectedTile) {
        dispatch({ type: 'SET_MUNICIPALITY_SEARCH', payload: tileConditions(selectedTile) })
      }
      // 自治体選択で検索エリアが上書きされるため、地名入力由来の緑・フィードバックを
      // 解除する（入力内容と検索エリアが食い違う状態を防ぐ）
      setPlaceAreaSet(false)
      setAreaName(null)
      setAreaSetQuery(null)
      // 地名入力のサジェスト・選択待ち候補も古いものになるためクリアする
      setSuggestCandidates([])
      setMuniSuggest([])
      setPendingCandidates(null)
    }
  }, [state.selectedMunicipality, dispatch])

  // 地図が動いた場合（地理コード等）に範囲情報を再計算
  // （地図のアンマウント/再マウントに追従させるため searchSource を依存に含める）
  useEffect(() => {
    if (searchSource !== 'map') return undefined
    const map = getMapInstance()
    if (!map || typeof map.on !== 'function' || typeof map.off !== 'function') return undefined
    const update = () => setBoundsVersion((v) => v + 1)
    map.on('moveend', update)
    map.on('zoomend', update)
    return () => {
      map.off('moveend', update)
      map.off('zoomend', update)
    }
  }, [searchSource])

  const isAdvanced = searchMode === 'advanced'

  // 地図の現在表示範囲を読む（生LatLngBounds。buildSearchCriteria側でBBOX変換する）
  const readMapBounds = () => {
    const map = getMapInstance()
    return map && typeof map.getBounds === 'function' ? map.getBounds() : null
  }

  // 検索条件スナップショット（ボタンの無効判定・ヒント表示用）
  // 地図インスタンスはマウント後のeffectで登録されるため、state変化の
  // 再レンダリングで初めて取得できる（元の挙動を維持）
  // (#xx) view を依存に追加: ソース切替タブの撤去で「タブ切替による再計算」が
  // 失われたため、フォーム表示切替時に地図登録済みの範囲で再計算させる
  // （トップ表示中はフッターボタンが描画されないため副作用はない）
  const criteria = useMemo(() => {
    const map = getMapInstance()
    const mapBounds =
      searchSource === 'map' && map && typeof map.getBounds === 'function' ? map.getBounds() : null
    return buildSearchCriteria(state, mapBounds ? { mapBounds } : {})
  }, [state, searchSource, boundsVersion, bbox, selectedMunicipality, view])

  // (top) 自治体セクション「検索する」ボタンの無効判定（自治体モードの条件スナップショット）。
  // 実行時の handleMuniSectionSearch と同じ入力（セクション内条件＋選択自治体BBOX）で判定する
  const muniCriteria = useMemo(() => {
    const next = state.searchSource === 'municipality' ? state : { ...state, searchSource: 'municipality' }
    return buildSearchCriteria(next)
  }, [state])

  // 表示用のBBOX（縮退・逆順の場合はnull＝未設定扱い）
  // 毎レンダリングで読むことで、マウント後の地図取得にも追従する
  const mapBbox = (() => {
    if (searchSource !== 'map') return null
    const map = getMapInstance()
    return map && typeof map.getBounds === 'function' ? boundsToBbox(map.getBounds()) : null
  })()

  // 地名入力のサジェスト候補（トップの QuickTopIntro と地図モードの場所入力で
  // 共有）。自治体候補＋駅・周辺候補を unifySuggestCandidates で統一する:
  // 現在位置（nearby.center）が分かっている場合は3種を合せて距離の近い順、
  // 分からない場合は現行の並び（自治体→駅・周辺）を維持。選択待ちなら
  // pendingCandidates を表示
  const showHistory = placeFocused && !placeQuery.trim() && placeHistory.length > 0
  const unifiedSuggest = showHistory
    ? placeHistory.map((entry) => ({
        ...entry,
        label: entry.query === entry.displayName ? entry.query : `${entry.query}（${entry.displayName}）`,
      }))
    : pendingCandidates ?? unifySuggestCandidates(muniSuggest, suggestCandidates, nearby.center)
  const candidatesHeading = showHistory
    ? '最近使った地名'
    : pendingCandidates ? '候補が複数あります。選んでください。' : null
  const onPlaceSelect = showHistory ? confirmPlace : handleCandidateSelect

  // (#xx) 地図モードの場所入力用候補（トップの QuickTopIntro と同じ組み立て）
  const mapCandidates = unifiedSuggest

  // (#xx) 確定場所（geocode/municipality）が設定済みかどうか — 検索ボタンラベル用
  const confirmedArea = !!(bbox && isValidBbox(bbox) &&
    (bboxSource === 'geocode' || bboxSource === 'municipality'))

  const handleSearch = () => {
    // クリック時点で地図表示範囲を新鮮に読み取る
    const mapBounds = searchSource === 'map' ? readMapBounds() : null
    const c = buildSearchCriteria(state, mapBounds ? { mapBounds } : {})
    if (c.ok !== true) return
    search(c)
  }

  // 地図ブロック（両ビュー共通・ツリー内で安定した位置＝2番目の子要素）。
  // 同一のJSX要素を同じ位置に描画し続けることで、トップ⇄フォーム切替時に
  // MapViewが再マウントされず、地図の位置・表示範囲が引き継がれる (#63)。
  // 非表示になるのはトップ表示（view='top'、#63でトップには地図を描画しない）のみ。
  // フォーム表示では常に地図モードなので常に表示される。マウントは両ビューで
  // 維持し、表示復帰時のresizeは MapView側のResizeObserverが処理する #60）
  const mapBlock = (
    <div hidden={view !== 'form'} data-testid="map-block" className="rounded-xl overflow-hidden border border-slate-200">
      <div className="relative h-[240px]" style={mapHeight.containerStyle}>
        <MapView
          onMarkerClick={onMarkerClick}
          onMarkerTap={(result) => {
            setTappedPoi(result)
            dispatch({ type: 'SET_ACTIVE_RESULT', payload: `${result.type}/${result.id}` })
          }}
        />
      </div>
      {/* 高さドラッグハンドル（PC版と同一のフック） */}
      <div
        {...mapHeight.handleProps}
        className="h-7 bg-slate-100 border-t border-slate-200 flex items-center justify-center"
      >
        <span className="w-8 h-1 rounded-full bg-slate-300" />
      </div>
    </div>
  )

  // 従来フォームの冒頭: トップへ戻る導線。
  // (#xx) フォームは常に地図モードのため、検索ソース切替タブ（「自治体から探す」／
  // 「地図から探す」）とフォーム内蔵の MunicipalitySearch は撤去した。自治体検索は
  // トップ画面の「都道府県から探す」セクションでのみ実行される。
  const formHeader = (
    <button
      type="button"
      onClick={() => onViewChange('top')}
      className="min-h-[44px] w-full flex items-center justify-center gap-1 text-sm font-medium text-primary-600 bg-white border border-primary-200 rounded-xl hover:bg-primary-50"
    >
      ← トップへ戻る
    </button>
  )

  // 従来フォームの地図以降の内容（凡例・エリア・カテゴリ/キーワード・切替）。
  // フォームは常に地図モードのため、ソース条件付けなしで常時描画する。
  const formBody = (
    <>
      {/* 凡例＋POI説明枠（横並び。狭い画面では折り返し） */}
      <div className="flex flex-wrap gap-2">
        <BarrierFreeLegend />
        {tappedPoi && (
          <div className="flex-1 min-w-[200px]">
            <PoiDescription tappedPoi={tappedPoi} />
          </div>
        )}
      </div>

      {/* エリア: 場所入力（確定場所で検索）＋ 検索範囲カード */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2" aria-label="検索範囲">
        <h2 className="text-[11px] font-medium text-slate-500">どの街・エリアで探す？</h2>

        {/* (#xx) 場所入力: トップの QuickTopIntro と同じ挙動（サジェスト→「地名検索」
            で確定→緑＋フィードバック）。確定場所は検索エリア（state.bbox）になり、
            地図がその範囲にfitし青い矩形が描画される。入力をクリアすると矩形が消え、
            地図の表示範囲で検索する（AreaCard が「地図の現在表示範囲」を表示） */}
        <div className="space-y-2" onBlur={handlePlaceBlur}>
          <PlaceNameInput
            value={placeQuery}
            onChange={handlePlaceQueryChange}
            onKeyDown={handleMapPlaceKeyDown}
            onFocus={handlePlaceFocus}
            onGeocode={handleGeocodePlace}
            placeholder="地名・駅名（例: 大阪駅）"
            disabled={state.status === 'loading'}
            geocoding={geocoding}
            geocodeDisabled={geocoding}
            areaSet={placeAreaSet}
          />
          {/* 候補リスト（サジェスト＋複数候補提示は共通の GeocodeCandidateList） */}
          {mapCandidates.length > 0 && (
            <GeocodeCandidateList
              candidates={mapCandidates}
              heading={candidatesHeading}
              onSelect={onPlaceSelect}
              disabled={state.status === 'loading'}
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
        </div>

        <AreaCard state={state} liveBounds={mapBbox} areaName={areaName} />
      </section>

      {/* カテゴリ / キーワード */}
      {isAdvanced ? <AdvancedSearch /> : <SimpleSearch variant="mobile" />}

      {/* 詳細条件の段階的開示 */}
      <button
        type="button"
        onClick={() => setMode(isAdvanced ? 'simple' : 'advanced')}
        className="w-full min-h-[44px] text-sm font-medium text-primary-600 bg-white border border-primary-200 rounded-xl hover:bg-primary-50"
      >
        {isAdvanced ? '− 簡易検索に戻る' : '＋ 条件を追加（詳細検索）'}
      </button>
    </>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
        {/* (#63) 一般向けトップ ⇄ 従来検索フォーム */}
        {view === 'top' ? (
          /* 説明・場所入力と「都道府県から探す」セクションを1つのラッパー要素にまとめる。
             これにより mapBlock はトップ・フォーム両ビューで2番目の子という安定した
             位置に描画され、トップ⇄フォーム切替時に MapView が再マウントされない (#63) */
          <div className="space-y-3">
            <QuickTopIntro
              placeQuery={placeQuery}
              onPlaceQueryChange={handlePlaceQueryChange}
              onGeocode={handleGeocodePlace}
              onFocus={handlePlaceFocus}
              onPlaceBlur={handlePlaceBlur}
              geocodeDisabled={geocoding}
              searchError={searchError}
              stationError={stationError}
              areaSet={placeAreaSet}
              geocoding={geocoding}
              disabled={state.status === 'loading'}
              candidates={unifiedSuggest}
              candidatesHeading={candidatesHeading}
              onCandidateSelect={onPlaceSelect}
            />

            {/* (top) 「都道府県から探す」入口: 折りたたみセクション（既定は閉じた状態、見出しタップで開閉）
                overflow-hidden は付けない（市区町村サジェスト一覧が position:absolute で
                セクション下端を越えて地図上に伸びるため、クリップされてしまう）。
                角丸は内部要素がパディング内で収まるため外側のクリップが不要。
                relative z-30: 地図（mapBlock）より上側の重なり順にし、サジェスト一覧が
                地図に隠れないようにする */}
            <section className="bg-white rounded-xl shadow-sm relative z-30" aria-label="都道府県から探す">
              <button
                type="button"
                onClick={() => setMuniSectionOpen((o) => !o)}
                aria-expanded={muniSectionOpen}
                className="w-full min-h-[44px] px-3 py-2 flex items-center justify-between text-sm font-medium text-slate-700"
              >
                <span>都道府県から探す</span>
                <span className="text-xs text-slate-500">{muniSectionOpen ? '▴ 閉じる' : '▾ 開く'}</span>
              </button>
              {muniSectionOpen && (
                <div className="p-3 space-y-3 border-t border-slate-100">
                  {/* 従来フォームと同一の MunicipalitySearch（モバイル変種）を内嵌 */}
                  <MunicipalitySearch variant="mobile" />
                  <button
                    type="button"
                    onClick={handleMuniSectionSearch}
                    disabled={state.status === 'loading' || muniCriteria.ok !== true}
                    className="w-full min-h-[44px] text-sm font-medium bg-primary-600 text-white rounded-lg disabled:opacity-50"
                  >
                    検索する
                  </button>
                </div>
              )}
            </section>
          </div>
        ) : (
          formHeader
        )}

        {mapBlock}

        {view === 'top' ? (
          <QuickTopTiles
            onTileTap={handleTileSelect}
            onSearch={handleTopSearch}
            onOpenDetailed={() => onViewChange('form')}
            selectedTileId={selectedTile ? selectedTile.id : null}
            searching={state.status === 'loading'}
            disabled={state.status === 'loading'}
          />
        ) : (
          formBody
        )}

        <ShareButton />
      </div>

      {/* 検索実行（スロールームの外に固定 — P0 再発防止）。フォーム表示時のみ */}
      {view === 'form' && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <SearchActionButton
            fullWidth
            criteria={criteria}
            status={state.status}
            onSearch={handleSearch}
            onCancel={cancel}
            label={confirmedArea ? 'この範囲で検索' : 'この表示範囲で検索'}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 検索範囲カード（「どの街・エリアで探す？」セクション内・地図モード）
 * - (#xx) 確定場所（bboxSource: geocode/municipality）が設定済みなら、
 *   確定場所の名前＋範囲を「検索範囲」として表示（検索はこの範囲で実行される）
 * - 未確定なら地図の現在表示範囲（liveBounds）を表示（従来どおり）
 * - 地図が未準備（非表示など）の場合は前回検索範囲にフォールバック
 * - 範囲が大きすぎる場合は警告
 */
function AreaCard({ state, liveBounds = null, areaName = null }) {
  const { bbox, bboxSource } = state
  const confirmed = !!(bbox && isValidBbox(bbox) &&
    (bboxSource === 'geocode' || bboxSource === 'municipality'))
  const isLive = !!liveBounds
  const shown = confirmed ? bbox : (isLive ? liveBounds : bbox)
  const info = shown ? checkBboxSize(shown) : null
  return (
    <div className="space-y-0.5">
      {confirmed ? (
        <>
          <span className="text-sm text-slate-700">
            検索範囲{areaName ? `: ${areaName}` : ''}
          </span>
          <span className="block text-[11px] text-slate-500">
            確定した場所の範囲で検索されます。
          </span>
        </>
      ) : (
        <>
          <span className="text-sm text-slate-700">地図の現在表示範囲</span>
          <span className="block text-[11px] text-slate-500">
            場所を指定しない場合は、地図を移動・拡大して検索したい範囲を設定できます。
          </span>
        </>
      )}
      {shown && (
        <span className="block font-mono text-[10px] text-slate-400 break-all">
          {confirmed ? '範囲: ' : isLive ? '検索範囲: ' : '直前: '}{shown.south}, {shown.west} 〜 {shown.north}, {shown.east}
          {info && `（約${Math.round(info.areaKm2).toLocaleString()} km²）`}
        </span>
      )}
      {info && info.message && (
        <span className={`block text-[11px] ${info.tooLarge ? 'text-red-600' : 'text-amber-600'}`}>
          {info.message}
        </span>
      )}
    </div>
  )
}
