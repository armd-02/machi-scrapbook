import React, { useEffect, useRef } from 'react'
import { AppContext } from './context/AppContext'
import { decodeURLToState } from './utils/urlState'
import { useIsMobile } from './hooks/useIsMobile'
import MobileShell from './components/mobile/MobileShell'
import { BatchMatchProvider } from './context/BatchMatchContext.jsx'
import { appReducer, createInitialState } from './state/appReducer'

/**
 * PC・モバイル共通レイアウト
 *
 * 従来のPC専用レイアウト（検索フォーム+地図+結果パネルの3分割＋
 * ハンバーガーメニューで画面切替）は廃止し、モバイルと同じシェル
 * （MobileShell: 下部ナビ3タブ 検索/一覧/その他）を両幅で共用する。
 *
 * - モバイル（<1024px）: MobileShellがビューポート全体を占有する。
 * - PC（>=1024px）: 同一のMobileShellを中央寄せのmax-widthコンテナ
 *   （max-w-[520px]）内で表示する。要素の順序・流れはモバイルと
 *   同一で、幅の調整のみ。
 *
 * PCでもモバイルと同一のコンポーネント・ロジックを使うため:
 * - 初期表示は一般向けトップ（QuickTop）。地図は検索タブ内に常設で、
 *   地図モード表示時のみ現れる（モバイルと同一タイミング）。
 * - 詳細検索フォーム・バリアフリー・CSV一括照合・CSVダウンロードは
 *   「くわしく探す」タブと「その他」タブからアクセスできる。
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

  const shell = (
    <AppContext.Provider value={{ state, dispatch }}>
      <BatchMatchProvider>
        <MobileShell />
      </BatchMatchProvider>
    </AppContext.Provider>
  )

  if (isMobile) return shell

  // PC: モバイルと同じシェルを中央寄せのmax-widthコンテナに表示する
  return (
    <div className="min-h-dvh bg-slate-200">
      <div className="mx-auto w-full max-w-[520px] shadow-2xl">{shell}</div>
    </div>
  )
}

export default App
