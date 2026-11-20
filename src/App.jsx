import React, { useEffect, useRef } from 'react'
import { AppContext } from './context/AppContext'
import { decodeURLToState, normalizeScreen } from './utils/urlState'
import { useIsMobile } from './hooks/useIsMobile'
import MobileShell from './components/mobile/MobileShell'
import PcShell from './components/mobile/PcShell'
import { BatchMatchProvider } from './context/BatchMatchContext.jsx'
import { appReducer, createInitialState } from './state/appReducer'

/**
 * (#72) レイアウト切替: ビューポート幅ベース（useIsMobile = matchMedia）
 *
 * - モバイル（<1024px）: MobileShellがビューポート全体を占有する。
 *   従来どおり（4タブ: 検索/一覧/メモ帳/その他）。
 * - PC（>=1024px）: 専用シェル（PcShell）で2ペインレイアウト。
 *   画面いっぱいにヘッダー・ステータス・下フッターを表示し、中央 main
 *   領域は左ペイン（幅600px）＝「検索」、右ペイン（残り幅）＝「一覧」
 *   または「メモ帳」。下フッターの選択で右ペインの内容が切替し、
 *   「その他」選択時は左ペインが消えて「その他」が全幅になる。
 *   旧PCの並列レイアウト（検索フォーム+結果リスト）は廃止のままで、
 *   その構成は「左ペイン=検索 / 右ペイン=一覧」として復活した。
 *
 * PCでもモバイルと同一のコンポーネント・ロジック（MobileSearchTab・
 * MobileListTab・MemochoSection・MobileOtherTab 等）を再利用するため:
 * - 初期表示は左ペインが一般トップ（QuickTop）、右ペインがメモ帳。
 *   検索が成功すると右ペインが自動的に「一覧」へ切替される。
 * - 詳細検索フォーム・バリアフリー・CSV一括照合・CSVダウンロードは
 *   「くわしく探す」（左ペイン）と「その他」からアクセスできる。
 *
 * 幅が1024pxをまたぐと matchMedia のイベントで再レンダされ、
 * レイアウトが追従する。
 */
function App() {
  const [state, dispatch] = React.useReducer(appReducer, createInitialState())
  const isMobile = useIsMobile()

  // URLから状態を復元
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const urlState = decodeURLToState(window.location.search)
    if (urlState) {
      // (#80) 画面（view パラメータ）。検索条件の復元と独立。
      if (urlState.screen) dispatch({ type: 'SET_SCREEN', payload: urlState.screen })
      // (#49) SET_SEARCH_SOURCE を先頭でdispatch: last-wins引き継ぎにより
      // モード切替時にカテゴリが上書きされるため、モード固有stateの復元より先に
      // 実行しないと、URLのカテゴリが初期値で消去される。
      if (urlState.searchSource) dispatch({ type: 'SET_SEARCH_SOURCE', payload: urlState.searchSource })
      if (urlState.searchMode) dispatch({ type: 'SET_SEARCH_MODE', payload: urlState.searchMode })
      if (urlState.simpleSearch) dispatch({ type: 'SET_SIMPLE_SEARCH', payload: urlState.simpleSearch })
      if (urlState.advancedSearch) dispatch({ type: 'SET_ADVANCED_SEARCH', payload: urlState.advancedSearch })
      // (Task 2) URL復元由来のbboxは source:'url' と記録
      // → MapViewはこれのみカメラfit（検索由来はfitしない）
      if (urlState.bbox) dispatch({ type: 'SET_BBOX', payload: { ...urlState.bbox, source: 'url' } })
      if (urlState.selectedMunicipality) dispatch({ type: 'SET_MUNICIPALITY', payload: urlState.selectedMunicipality })
      if (urlState.municipalitySearch) dispatch({ type: 'SET_MUNICIPALITY_SEARCH', payload: urlState.municipalitySearch })
      // (A2) 一覧フィルタを最後に適用: 検索stateのミラー値を上書きし、URLを権威に
      if (urlState.resultFilters) dispatch({ type: 'SET_RESULT_FILTERS', payload: urlState.resultFilters })
    }
  }, [dispatch])

  // (#80) 画面 ↔ URL同期（ブックマーク・戻る／進む対応）
  //
  // state.screen が変更されると、現在URLの view パラメータを更新して
  // pushState する（履歴エントリが追加され、戻る／進むで画面を行き来できる）。
  // URLの検索条件パラメータはセッション中に書き換えられない（共有URLは
  // ShareButton経由のみ）ため、view だけを更新してその他はそのまま残す。
  //
  // 例外: 現在URLの view が state.screen と既に見合っている場合は push しない。
  // 戻る／進む（popstate）で画面が変わった場合はURLが既に正しい位置にある
  // ため、ここで push すると履歴が汚染される（forward が壊れる）。
  const lastScreenRef = useRef(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const current = normalizeScreen(params.get('view')) || 'top'
    // 初回（マウント時）は push しない（URL復元で来た画面をURLに書き戻さない）
    // URLとstateが既に見合っていれば push しない（popstate 由来の変更）
    if (lastScreenRef.current === state.screen || current === state.screen) {
      lastScreenRef.current = state.screen
      return
    }
    lastScreenRef.current = state.screen
    if (state.screen === 'top') params.delete('view')
    else params.set('view', state.screen)
    const qs = params.toString()
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    window.history.pushState({ screen: state.screen }, '', url)
  }, [state.screen])

  // (#80) 戻る／進む（popstate）: URLの view パラメータから画面を復元する。
  // 検索条件パラメータはエントリ間で共通（セッション中にURLへ書き込まない）
  // なので、ここでは画面のみを適用する。
  useEffect(() => {
    const onPop = () => {
      // view パラメータの省略＝既定のトップ画面
      const s = normalizeScreen(new URLSearchParams(window.location.search).get('view')) || 'top'
      if (s !== state.screen) dispatch({ type: 'SET_SCREEN', payload: s })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [state.screen, dispatch])

  const contextValue = { state, dispatch }
  if (isMobile) {
    // モバイル: 従来どおり MobileShell がビューポート全体を占有
    return (
      <AppContext.Provider value={contextValue}>
        <BatchMatchProvider>
          <MobileShell />
        </BatchMatchProvider>
      </AppContext.Provider>
    )
  }
  // PC（幅 >= 1024px）: 2ペインレイアウト（左:検索 / 右:一覧・メモ帳）
  return (
    <AppContext.Provider value={contextValue}>
      <BatchMatchProvider>
        <PcShell />
      </BatchMatchProvider>
    </AppContext.Provider>
  )
}

export default App
