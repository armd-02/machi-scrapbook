import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { useSearch } from '../../hooks/useSearch'
import { getMapInstance } from '../../hooks/useMapRef'
import { buildSearchCriteria } from '../../utils/searchCriteria'
import { boundsToBbox, isValidBbox } from '../../utils/searchBbox'
import { checkBboxSize, geocodeCandidates, isBboxTooLarge, isMunicipalityCandidate, searchAreaFromGeocode } from '../../utils/geo'
import { loadMunicipalities, matchMunicipalities, exactMatchMunicipalities, municipalityToCandidate } from '../../utils/municipalities'
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
 *     ① 「検索する」押下時の geocode（地名・駅名の結果の範囲を検索エリアに設定。
 *        駅など小さな範囲は約1km正方形に拡大）
 *     ② 「都道府県から探す」セクションで自治体を選択（そのbboxをエリアに設定）
 *   操作の流れ（#63 のタイル即検索は「選択→検索する」に分割）:
 *     ① 地名・駅名を入力（または「都道府県から探す」で自治体を選ぶ）
 *     ② 目的タイルを1つ選択（タップは選択だけ。選択中はハイライト表示。
 *        別のタイルを押すと選択が移る）
 *     ③ タイル下の「検索する」ボタン（または場所入力欄で Enter）で検索実行。
 *        入力に地名があれば geocode → 検索エリア確定（成功で入力欄が緑・
 *        「検索エリアに「○○」を設定しました」表示）。入力が空で自治体などで
 *        エリアが設定済みならそれを使う。場所が決まらなければ検索せず
 *        案内・エラー表示、タイル（種別）が未選択なら検索せず
 *        「種別を選んでください」趣旨の案内を表示する。
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
 *   置く（トップの QuickTopIntro「どのあたりの場所？」と同様の挙動を共有する）。
 *   地名・駅名の入力でサジェスト（自治体ローカル計算＋Nominatim）が出る。候補タップ・
 *   Enter（確定）で geocode → 確定場所を検索エリア（state.bbox）に設定し、入力欄が
 *   緑になり「検索エリアに「○○」を設定しました」が出る。確定時（bboxSource:
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
// エラー文。候補選択時（handleCandidateSelect）と「検索する」押下時
// （handleTopSearch の geocode 分岐）で共通にする
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
  const [searching, setSearching] = useState(false)
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

  // (top) 地名入力のサジェスト: 入力欄の下に表示する候補（geocodeCandidates の結果）
  const [suggestCandidates, setSuggestCandidates] = useState([])
  // (top) ジオコーディング問い合わせ中カウント（サジェスト用）。リクエスト開始で増え、
  // 完了（候補返却／エラー）で減る。地名入力欄右端のスピナー表示に使う
  const [geocodePending, setGeocodePending] = useState(0)
  // 地名入力のジオコーディング問い合わせ中（サジェスト or 検索確定のいずれか）。
  // 地名入力欄右端のスピナー表示に使う（入力欄自体は無効化しない）
  const geocoding = searching || geocodePending > 0
  // (top) 自治体サジェスト候補（municipalities.json からローカル計算）。Nominatim の
  // 順位に左右されず、自治体名を確実に選べるようにするため Nominatim 候補より
  // 前に表示する（ローカル計算なので即座に出る）。QuickTopIntro 渡しの候補は
  // [...muniSuggest, ...suggestCandidates] の順で組み立てる
  const [muniSuggest, setMuniSuggest] = useState([])
  // (top) 自治体データ（municipalities.json）。トップ表示時に読み込む
  const [municipalities, setMunicipalities] = useState([])

  // (top) トップ表示時に自治体データを読み込む（モジュールキャッシュで二重取得しない。
  // loadMunicipalities は失敗時も空配列を返すため catch は不要）
  useEffect(() => {
    if (view !== 'top') return undefined
    let cancelled = false
    loadMunicipalities().then((list) => {
      if (!cancelled) setMunicipalities(list)
    })
    return () => { cancelled = true }
  }, [view])

  // (top) 自治体データが後から読み込み完了した場合に、現在の入力値で
  // 自治体候補を再計算する（データより先にユーザーが入力したケースに対応）
  useEffect(() => {
    if (view !== 'top') return
    const q = placeQuery.trim()
    setMuniSuggest(q.length >= 2
      ? matchMunicipalities(municipalities, q).map(municipalityToCandidate)
      : [])
  }, [municipalities, view])
  // (top) 「検索する」押下で候補が複数（2件以上）だったときの選択待ち候補。
  // 入力欄の下に「候補が複数あります。選んでください。」の案内付きで表示され、
  // 候補タップで検索エリアが設定される。施設検索は実行されない
  const [pendingCandidates, setPendingCandidates] = useState(null)
  // (top) 検索エリアが設定された地名（trim 済み入力値）。同じ名前で
  // 「検索する」を再度押したときは、geocode せず設定済みエリアを再利用する
  // （複数候補の提示→選択→再度「検索する」の流れで、提示がループしないように）
  const [areaSetQuery, setAreaSetQuery] = useState(null)
  // (top) サジェストのデバウンス（約400ms）タイマーとリクエスト順序番号
  // （入力が変わった古いリクエストの結果は無視するために使う）
  const suggestTimerRef = useRef(null)
  const suggestSeqRef = useRef(0)

  // (top) 目的タイル → 検索条件（handleTopSearch と自治体セクションへの引き継ぎで共用）
  const tileConditions = (tile) => (tile.purpose
    ? { category: '', cuisine: '', keyword: '', purpose: tile.purpose }
    : { category: tile.category, cuisine: '', keyword: '', purpose: '' })

  // (top) 「検索する」ボタン・場所入力欄 Enter で実行する統一検索フロー。
  // ① 場所の確定: 入力欄に地名・駅名があれば geocodeCandidates して検索エリアを設定。
  //   候補が1件の場合は従来どおり進む（成功で入力欄を緑にし
  //   「検索エリアに「○○」を設定しました」を表示）。候補が2件以上の場合は
  //   1件目を勝手に選ばず、候補リストを「候補が複数あります。選んでください。」
  //   という案内とともに提示し、施設検索は実行しない。候補をタップすると
  //   エリアが設定され（handleCandidateSelect）、あらためて「検索する」を
  //   押すと検索が実行される。同じ地名のエリアが既に設定済みなら、
  //   geocode をせず設定済みエリアを再利用する。
  //   入力が空なら既存の検索エリア（「都道府県から探す」の自治体選択などで
  //   設定済みの state.bbox）を使う。地図を移動しない: 駅など小さな範囲
  //   （面積が1km²未満）の結果は searchAreaFromGeocode が約1km正方形に拡大する。
  // ② 場所が決まらなければ（入力が空でエリア未設定、または geocode で
  //   見つからない）検索せず、従来の案内・エラー表示を出す。
  // ③ タイル（種別）が未選択なら検索せず「種別を選んでください」案内。
  // ④ 場所と種別がそろえば、その範囲・種別で施設検索を実行
  //   （成功で MobileShell が一覧タブへ自動切替）。
  const handleTopSearch = async () => {
    if (state.status === 'loading' || searching) return

    // ① 場所の確定
    const q = placeQuery.trim()
    let areaBbox = state.bbox
    // 検索エリアの由来（スナップショットの bboxSource 用）。既存エリアの再利用時は
    // 現在の source を維持し、geocode・自治体で新規設定した場合は geocode/municipality
    let areaSource = state.bboxSource
    if (q) {
      // 実行中のサジェスト（デバウンス待ち・リクエスト中）を無効化する
      // （検索実行中は候補リストを表示しない）
      if (suggestTimerRef.current) {
        clearTimeout(suggestTimerRef.current)
        suggestTimerRef.current = null
      }
      suggestSeqRef.current += 1
      setSuggestCandidates([])
      setMuniSuggest([])

      if (placeAreaSet && q === areaSetQuery && areaBbox && isValidBbox(areaBbox)) {
        // 同じ地名の検索エリアが既に設定済み（geocode または候補選択による）。
        // geocode をせず設定済みエリアをそのまま再利用する（複数候補の提示が
        // ループするのを防ぐ）
      } else {
        setSearching(true)
        setSearchError(null)
        setAreaName(null)
        // 検索中は緑を解除。成功時のみ再度設定される（見つからなかった場合は緑にならない）
        setPlaceAreaSet(false)
        setAreaSetQuery(null)
        setPendingCandidates(null)
        try {
          // 自治体の完全一致をNominatimより先に調べる（静的データでローカル解決）。
          // Nominatim の順位に左右されず、自治体名は確実にその自治体で解決される
          const exact = exactMatchMunicipalities(municipalities, q)
          if (exact.length === 1) {
            // 完全一致が1件: その自治体の範囲を検索エリアにして、従来の「地名が
            // 見つかった」流れで進める（Nominatim は呼ばない）
            const result = municipalityToCandidate(exact[0])
            areaBbox = searchAreaFromGeocode(result)
            areaSource = 'municipality'
            dispatch({ type: 'SET_BBOX', payload: { ...areaBbox, source: areaSource } })
            setAreaName(result.displayName)
            setPlaceAreaSet(true)
            setAreaSetQuery(q)
          } else if (exact.length >= 2) {
            // 完全一致が2件以上（同名自治体）: その自治体候補だけを候補リストとして
            // 提示し、施設検索は実行しない（既存の複数候補提示の流れに合わせる）。
            // Nominatim は呼ばない
            setPendingCandidates(exact.map(municipalityToCandidate))
          } else {
            // 完全一致なし: 従来どおり Nominatim の流れ
            const cands = await geocodeCandidates(q)
            if (cands.length === 0) {
              setSearchError('場所が見つかりませんでした。別の表記で試してください。')
              return
            }
            if (cands.length >= 2) {
              // 候補が複数: 1件目を勝手に選ばない。候補リストを提示し、
              // 利用者に選ばせる。施設検索は実行しない（候補をタップすると
              // エリアが設定され、あらためて「検索する」で検索が実行される）。
              setPendingCandidates(cands)
              return
            }
            // 候補が1件: 従来どおり進む
            const result = cands[0]
            // 候補の元のBBOXが広すぎる（国・外国の州・都道府県など）: 検索エリアに
            // 設定せず、施設検索のクエリも発行しない（広範囲全域の巨大クエリを防ぐ）。
            // 既存のバリデーションエラーと同じ流儀（SET_STATUS 'error' + SET_ERROR）で
            // エラーを返す。市区町村レベルの行政区域（isMunicipalityCandidate）は
            // ガードの対象外: 大きな市（例: 高山市・約2,178 km²）は最小の県より大きく、
            // 面積だけでは市区町村と都道府県を区別できないため
            if (!isMunicipalityCandidate(result) && isBboxTooLarge(result.boundingbox)) {
              dispatch({ type: 'SET_STATUS', payload: 'error' })
              dispatch({
                type: 'SET_ERROR',
                payload: tooLargeSearchError(result.name),
                errorType: 'validation'
              })
              return
            }
            // (#63) ジオコード結果の範囲を検索エリア（state.bbox）として設定する。
            // トップ画面には地図を描画しないため、地図の表示範囲は使わない。
            areaBbox = searchAreaFromGeocode(result)
            areaSource = 'geocode'
            dispatch({ type: 'SET_BBOX', payload: { ...areaBbox, source: areaSource } })
            setAreaName(result.displayName)
            // 入力値は残して緑で表示（場所が決まったことが入力欄の見た目で分かる）。
            // 編集されたら handlePlaceQueryChange が緑と検索エリアを解除する。
            setPlaceAreaSet(true)
            setAreaSetQuery(q)
          }
        } catch (error) {
          setSearchError(error.message || '地名検索に失敗しました')
          return
        } finally {
          setSearching(false)
        }
      }
    }

    // ② 場所が未設定（入力が空でエリア未設定、または geocode で見つからない）
    if (!areaBbox || !isValidBbox(areaBbox)) {
      dispatch({ type: 'SET_STATUS', payload: 'error' })
      dispatch({
        type: 'SET_ERROR',
        // 文の区切りで改行（\n）。表示側は StatusBanner が whitespace-pre-line で改行を保持する
        payload: '場所がまだ設定されていません。\n地名・駅名を入力して「検索する」を押すか、\n「都道府県から探す」で自治体を選択してください。',
        errorType: 'validation'
      })
      return
    }

    // ③ 種別（目的タイル）が未選択
    if (!selectedTile) {
      dispatch({ type: 'SET_STATUS', payload: 'error' })
      dispatch({
        type: 'SET_ERROR',
        payload: '種別を選んでください。\n目的の施設にあたる目的タイルを1つタップしてください。',
        errorType: 'validation'
      })
      return
    }

    // ④ 施設検索（旧タイル即検索と同じ方式: 更新後の状態スナップショット
    //    → buildSearchCriteria → search）
    const conditions = tileConditions(selectedTile)

    // 地図モードで検索する。自治体モード等なら先に地図モードへ切替
    // （目的タイル・フォーム経由のいずれの流れでも地図モードで検索する既存設計を維持）
    if (state.searchSource !== 'map') {
      dispatch({ type: 'SET_SEARCH_SOURCE', payload: 'map' })
    }
    dispatch({ type: 'SET_SIMPLE_SEARCH', payload: conditions })

    // stale-state競合を避けるため、更新後の状態からスナップショットを構築 (#47)。
    // 検索は確定した検索エリア（areaBbox）の範囲で実行する。トップ画面には
    // 地図を描画しないため、地図の表示範囲（mapBounds）は使わない。
    // 直前に geocode した場合、dispatch は非同期で state.bbox にはまだ反映
    // されていないため、スナップショットに新しいエリアを直接含める。
    const next = {
      ...state,
      bbox: areaBbox,
      bboxSource: areaSource,
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
  // 入力内容と検索エリアが食い違う状態を作らないため（「検索する」の未設定ガードが
  // 再び働く）。エラー表示・成功フィードバックも一緒に消す。
  const handlePlaceQueryChange = (value) => {
    setPlaceQuery(value)
    setPlaceAreaSet(false)
    setAreaName(null)
    setSearchError(null)
    setAreaSetQuery(null)
    dispatch({ type: 'SET_BBOX', payload: null })
    // サジェスト・選択待ち候補をリセットする（古いリストを残さない）
    if (suggestTimerRef.current) {
      clearTimeout(suggestTimerRef.current)
      suggestTimerRef.current = null
    }
    suggestSeqRef.current += 1 // 実行中のサジェストリクエストの結果を無効化する
    setSuggestCandidates([])
    setPendingCandidates(null)

    const q = value.trim()
    // (top) 自治体候補: 静的データでローカル計算するため、デバウンス・Nominatim
    // 待ちをせず即座に表示する（Nominatim 候補より前に表示される）
    setMuniSuggest(q.length >= 2
      ? matchMunicipalities(municipalities, q).map(municipalityToCandidate)
      : [])

    // (top) サジェスト: 2文字以上の入力で約400msのデバウンス後に
    // geocodeCandidates を呼び、候補リストを入力欄の下に表示する
    if (q.length >= 2) {
      const seq = suggestSeqRef.current
      suggestTimerRef.current = setTimeout(() => {
        suggestTimerRef.current = null
        setGeocodePending((c) => c + 1) // リクエスト開始 → スピナー表示
        geocodeCandidates(q)
          .then((cands) => {
            setGeocodePending((c) => c - 1) // リクエスト完了 → スピナー解除
            // その間に入力が変わっていたら（seq が進行していたら）古い結果は無視
            if (seq === suggestSeqRef.current) setSuggestCandidates(cands)
          })
          .catch(() => {
            setGeocodePending((c) => c - 1) // リクエスト完了（エラー）→ スピナー解除
            if (seq === suggestSeqRef.current) setSuggestCandidates([])
          })
      }, 400)
    }
  }

  // (top) 候補をタップしたら、その候補で検索エリアを設定する（既存の
  // 「地名が見つかった」ときと全く同じ流れ: bbox → state.bbox、入力欄が緑に
  // なり「検索エリアに「○○」を設定しました」が出る）。リストは閉じる。
  // 施設検索はまだ実行しない（従来どおり「検索する」ボタンで実行）。
  // サジェストの候補と「候補が複数あります」の候補で共通。
  const handleCandidateSelect = (candidate) => {
    // 実行中のサジェストをキャンセル
    if (suggestTimerRef.current) {
      clearTimeout(suggestTimerRef.current)
      suggestTimerRef.current = null
    }
    // リクエスト中のサジェスト結果も無効化する（選択した直後に通信が返って
    // 候補リストが再表示されることがあったため。handleTopSearch と同じ扱い）
    suggestSeqRef.current += 1
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
    const areaBbox = searchAreaFromGeocode(candidate)
    // 候補の由来: 自治体（静的データ由来 kind='自治体'・市区町村レベルのaddresstype）→
    // 'municipality'、それ以外（Nominatim由来）→ 'geocode'
    dispatch({
      type: 'SET_BBOX',
      payload: {
        ...areaBbox,
        source: isMunicipalityCandidate(candidate) ? 'municipality' : 'geocode'
      }
    })
    setAreaName(candidate.displayName)
    setPlaceAreaSet(true)
    setAreaSetQuery(placeQuery.trim())
    setSuggestCandidates([])
    setMuniSuggest([])
    setPendingCandidates(null)
  }

  // (#xx) フォームの地図モードの場所入力欄で Enter（確定）したときの処理。
  // トップの QuickTopIntro と同じ geocode フローだが、施設検索は実行しない
  // （タイル・種別の確認もなし）。確定した場所を検索エリアに設定し、緑＋
  // 「検索エリアに「○○」を設定しました」を表示する（MapView 側で fitBounds＋
  // 矩形描画が行われる）。
  // - 候補1件: エリア設定（成功）
  // - 候補複数: 候補リストを提示（選択でエリア設定）
  // - 見つからない・広すぎる: 入力欄の下にエラー表示
  const handlePlaceConfirm = async () => {
    const q = placeQuery.trim()
    if (!q || state.status === 'loading' || searching) return

    // 同じ地名のエリアが既に設定済みなら何もしない（再geocodeしない。
    // Nominatim のレート制限・候補提示ループの防止）
    if (placeAreaSet && q === areaSetQuery && bbox && isValidBbox(bbox)) return

    // 実行中のサジェスト（デバウンス待ち・リクエスト中）を無効化する
    if (suggestTimerRef.current) {
      clearTimeout(suggestTimerRef.current)
      suggestTimerRef.current = null
    }
    suggestSeqRef.current += 1
    setSuggestCandidates([])
    setMuniSuggest([])
    setPendingCandidates(null)
    setSearching(true)
    setSearchError(null)
    setAreaName(null)
    setPlaceAreaSet(false)
    setAreaSetQuery(null)
    try {
      // 自治体の完全一致をNominatimより先に調べる（静的データでローカル解決）
      const exact = exactMatchMunicipalities(municipalities, q)
      if (exact.length === 1) {
        const result = municipalityToCandidate(exact[0])
        const areaBbox = searchAreaFromGeocode(result)
        dispatch({ type: 'SET_BBOX', payload: { ...areaBbox, source: 'municipality' } })
        setAreaName(result.displayName)
        setPlaceAreaSet(true)
        setAreaSetQuery(q)
        return
      }
      if (exact.length >= 2) {
        setPendingCandidates(exact.map(municipalityToCandidate))
        return
      }
      const cands = await geocodeCandidates(q)
      if (cands.length === 0) {
        setSearchError('場所が見つかりませんでした。別の表記で試してください。')
        return
      }
      if (cands.length >= 2) {
        setPendingCandidates(cands)
        return
      }
      const result = cands[0]
      if (!isMunicipalityCandidate(result) && isBboxTooLarge(result.boundingbox)) {
        setSearchError(tooLargeSearchError(result.name))
        return
      }
      const areaBbox = searchAreaFromGeocode(result)
      dispatch({ type: 'SET_BBOX', payload: { ...areaBbox, source: 'geocode' } })
      setAreaName(result.displayName)
      setPlaceAreaSet(true)
      setAreaSetQuery(q)
    } catch (error) {
      setSearchError(error.message || '地名検索に失敗しました')
    } finally {
      setSearching(false)
    }
  }

  // (#xx) 場所入力欄のキー操作: Enter で確定（geocode→エリア設定）、
  // Escape で入力と検索エリアをクリア（矩形も消える）
  const handleMapPlaceKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handlePlaceConfirm()
    } else if (e.key === 'Escape') {
      handlePlaceQueryChange('')
    }
  }

  // アンマウント時に保留中のサジェストタイマーをキャンセル
  useEffect(() => () => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
  }, [])

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
      if (suggestTimerRef.current) {
        clearTimeout(suggestTimerRef.current)
        suggestTimerRef.current = null
      }
      suggestSeqRef.current += 1
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

  // (#xx) 地図モードの場所入力用候補（トップの QuickTopIntro と同じ組み立て: 自治体
  // サジェスト→Nominatimサジェスト。選択待ちなら pendingCandidates を表示）
  const mapCandidates = pendingCandidates
    ? pendingCandidates
    : [...muniSuggest, ...suggestCandidates]

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

        {/* (#xx) 場所入力: トップの QuickTopIntro と同じ挙動（サジェスト→確定→緑＋
            フィードバック）。確定場所は検索エリア（state.bbox）になり、地図がその
            範囲にfitし青い矩形が描画される。入力をクリアすると矩形が消え、地図の
            表示範囲で検索する（AreaCard が「地図の現在表示範囲」を表示） */}
        <div className="space-y-2">
          <PlaceNameInput
            value={placeQuery}
            onChange={handlePlaceQueryChange}
            onKeyDown={handleMapPlaceKeyDown}
            placeholder="地名・駅名（例: 大阪駅）"
            disabled={state.status === 'loading'}
            geocoding={geocoding}
            areaSet={placeAreaSet}
          />
          {/* 候補リスト（サジェスト＋複数候補提示は共通の GeocodeCandidateList） */}
          {mapCandidates.length > 0 && (
            <GeocodeCandidateList
              candidates={mapCandidates}
              heading={pendingCandidates ? '候補が複数あります。選んでください。' : null}
              onSelect={handleCandidateSelect}
              disabled={state.status === 'loading'}
            />
          )}
          {searchError && (
            <p role="alert" className="text-sm text-red-600">{searchError}</p>
          )}
          {areaName && (
            <p className="text-sm text-green-700">検索エリアに「{areaName}」を設定しました</p>
          )}
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
              searching={searching}
              searchError={searchError}
              areaName={areaName}
              areaSet={placeAreaSet}
              geocoding={geocoding}
              onSearch={handleTopSearch}
              disabled={state.status === 'loading'}
              candidates={pendingCandidates
                ? pendingCandidates
                : [...muniSuggest, ...suggestCandidates]}
              candidatesHeading={pendingCandidates ? '候補が複数あります。選んでください。' : null}
              onCandidateSelect={handleCandidateSelect}
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
            searching={searching}
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
