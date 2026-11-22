import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { getMapInstance } from '../../hooks/useMapRef'
import StatusBanner from '../StatusBanner'
import MobileBottomNav from './MobileBottomNav'
import MobileSearchTab from './MobileSearchTab'
import MobileListTab from './MobileListTab'
import MobileOtherTab from './MobileOtherTab'
import MemochoSection from './MemochoSection'
import MobileFacilityDetail from './MobileFacilityDetail'
import AppHeader from '../AppHeader'

/**
 * (#59) モバイルシェル
 *
 * - 上部: ヘッダー + StatusBanner（検索/一覧/その他タブで共通表示。
 *   まちメモ帳タブ表示中は出さない。状態は保持されるため、他のタブへ
 *   戻ると再び表示される）
 * - 中央: 4タブ（検索/一覧/メモ帳/その他）。非活性タブは hidden で
 *   アンマウントしないため、検索条件・フィルタ状態がタブ切替をまたいで保持される。
 *   (#60) MapLibre マップは検索タブ内に常設（地図モード時に表示、
 *   (#63) 自治体モードでは hidden で非表示。トップ⇄フォーム切替では再マウントしない）
 * - 下部: 下部ナビゲーション（4タブ）
 * - 施設詳細: ボトムシート（オーバーレイ。主ナビのタブではない）
 *
 * 検索完了時は結果（一覧）タブへ、エラー時は検索タブへ自動切替する。
 *
 * ごみ箱（memochoView='trash'）: ヘッダーメニューの「ごみ箱」で reducer の
 * memochoView が 'trash' になるとメモ帳タブへ自動切替し、MemochoSection が
 * ごみ箱ビューを表示する。メモ帳タブを離れると 'list' にリセットされる。
 */
export default function MobileShell() {
  const { state, dispatch } = useApp()
  const [tab, setTab] = useState('search')
  const [detail, setDetail] = useState(null) // { result, origin }
  // (#63) 検索タブ内のビュー（'top' 一般向けトップ | 'form' 従来検索フォーム）。
  // 初期表示はトップ。検索成功でリストタブへ切替しても値は保持し、検索タブへ
  // 戻ったとき直前の文脈（トップ⇄フォーム）を引き継ぐ
  const [searchView, setSearchView] = useState('top')

  // (#80) 画面 ↔ state.screen 同期（ブックマーク・URL連動）
  // ローカル（tab, searchView）の射影と state.screen を一致させる。
  // 双方向を別々の effect で行うと、片方の変更が相手に届く前の古い値で
  // 逆向きの同期が走り、値が往復して無限ループになる（screenUrl テストの
  // ハングで判明）。単一の effect で「直前に一致していた値」
  // （lastScreenRef）と比べ、変わった側に合わせて片方向だけ同期する。
  const lastScreenRef = useRef(state.screen)
  useEffect(() => {
    const s = tab === 'search' ? (searchView === 'form' ? 'form' : 'top')
      : tab === 'list' ? 'list'
      : tab === 'memo' ? 'memo'
      : 'other'
    if (s === state.screen) {
      lastScreenRef.current = s
      return
    }
    if (state.screen !== lastScreenRef.current) {
      // 外部の画面変更（URL復元・戻る／進む）→ ローカルへ反映
      lastScreenRef.current = state.screen
      if (state.screen === 'top' || state.screen === 'form') {
        if (tab !== 'search') setTab('search')
        if (searchView !== state.screen) setSearchView(state.screen)
      } else if (tab !== state.screen) {
        // 'list' | 'memo' | 'other' はタブIDと同名
        setTab(state.screen)
      }
    } else {
      // ローカルの画面変更 → state.screen へ反映
      lastScreenRef.current = s
      dispatch({ type: 'SET_SCREEN', payload: s })
    }
  }, [tab, searchView, state.screen, dispatch])

  // 検索完了（loading → success/error）でタブを自動切替。
  // 検索の種類によらず、成功時は常に「一覧」タブ、エラー時は「検索」タブへ。
  const prevStatusRef = useRef(state.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = state.status
    if (prev !== 'loading' || state.status === prev) return
    setTab(state.status === 'success' ? 'list' : 'search')
  }, [state.status])

  // 検索タブに戻ったとき: 地図の表示領域が0だったMapLibreを resize() で修正
  // （検索タブは hidden のままアンマウントされないため、戻った瞬間にサイズが古い）
  // (#60) MapLibreのresize()（旧LeafletのinvalidateSize()相当）
  useEffect(() => {
    if (tab !== 'search') return
    const map = getMapInstance()
    if (map && typeof map.resize === 'function') map.resize()
  }, [tab])

  // ごみ箱ビュー（memochoView='trash'）が設定されるとメモ帳タブへ自動切替する
  useEffect(() => {
    if (state.memochoView === 'trash') setTab('memo')
  }, [state.memochoView])

  // メモ帳タブを離れたらごみ箱ビューを通常一覧（'list'）にリセットする。
  // 次にもも帳タブを開いたとき、前回のごみ箱ビューを引き継がないようにするため
  useEffect(() => {
    if (tab !== 'memo' && state.memochoView === 'trash') {
      dispatch({ type: 'SET_MEMOCHO_VIEW', payload: 'list' })
    }
  }, [tab, state.memochoView, dispatch])

  const openDetail = (result, origin) => setDetail({ result, origin })
  const closeDetail = () => setDetail(null)

  const selectTab = (id) => {
    if (detail) setDetail(null)
    setTab(id)
  }

  // ヘッダーのタイトルボタン: どこから押しても一般向けトップ（searchタブの
  // searchView='top'）へ戻す。詳細シートが開いていれば閉じる（selectTab と同じ挙動）
  const goTop = () => {
    selectTab('search')
    setSearchView('top')
  }

  // 非活性タブは hidden 属性で隠す（アンマウントしない＝状態保持）。
  // Tailwindの hidden クラスではなく HTML hidden 属性を使うことで、
  // アクセシビリティツリー（およびテストクエリ）からも除外される。
  const panelProps = (id) => (tab === id ? {} : { hidden: true })

  return (
    <div className="flex flex-col h-dvh bg-slate-50 text-slate-800 relative">
      {/* (#76) 共通ヘッダー: アイコン＋タイトル（押下でトップへ）＋ハンバーガーメニュー */}
      <AppHeader onGoTop={goTop} />

      {/* まちメモ帳タブ表示中は StatusBanner を出さない */}
      {tab !== 'memo' && <StatusBanner />}

      <main className="flex-1 min-h-0 relative">
        <div className="absolute inset-0" {...panelProps('search')}>
          <MobileSearchTab
            view={searchView}
            onViewChange={setSearchView}
            onViewResults={() => setTab('list')}
            onMarkerClick={(r) => openDetail(r, 'map')}
          />
        </div>
        <div className="absolute inset-0" {...panelProps('list')}>
          <MobileListTab />
        </div>
        <div className="absolute inset-0" {...panelProps('memo')}>
          {/* まちメモ帳: 独立タブ。
              view/onViewChange: ヘッダーメニューの「ごみ箱」と連動したサブビュー */}
          <div className="h-full overflow-y-auto">
            <MemochoSection
              view={state.memochoView}
              onViewChange={(v) => dispatch({ type: 'SET_MEMOCHO_VIEW', payload: v })}
            />
          </div>
        </div>
        <div className="absolute inset-0" {...panelProps('other')}>
          <MobileOtherTab />
        </div>
      </main>

      <MobileBottomNav active={tab} onSelect={selectTab} />

      {detail && (
        <MobileFacilityDetail detail={detail} onClose={closeDetail} />
      )}
    </div>
  )
}
