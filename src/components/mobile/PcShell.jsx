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
import AppIcon from './AppIcon'

/**
 * (#72) PC用シェル（ビューポート幅 >= 1024px）
 *
 * 画面いっぱいの 2 パネルレイアウト。ヘッダー・StatusBanner・下フッター
 * （MobileBottomNav）は全幅で常時表示され、フッターの選択が中央 main 領域の
 * 中身を決める。
 *
 * - 左ペイン（幅600px固定）: 「検索」（MobileSearchTab）。top/form 切替は
 *   モバイルと同一。常時マウントされ、"その他"表示中は hidden 属性で隠す
 *   （アンマウントしない）ため、入力状態・地図の状態は保持される。
 * - 右ペイン（残り幅）: 「一覧」（MobileListTab）または「メモ帳」（MemochoSection）。
 *   非表示側は hidden 属性で保持（アンマウントしない）。初期表示はメモ帳。
 *   検索が成功すると自動的に「一覧」へ切替（MobileShell と同じ機構）。
 * - 「その他」（MobileOtherTab）: 選択中は左・右ペインを隠し、main 領域を
 *   全幅で占める。下フッターは残るため「検索」で検索レイアウトに戻れる。
 *
 * 施設詳細シート（MobileFacilityDetail）は従来どおりオーバーレイで、
 * 左ペインの地図マーカーと右ペインの一覧・メモ帳カードの両方から開ける。
 *
 * ヘッダーのタイトルボタンは一般トップへ戻す（左ペイン検索 + top表示）。
 * 右ペインの内容はそのまま保持される。
 *
 * 「その他」から検索レイアウトへ戻る時は MapLibre の表示領域が壊れないよう
 * map.resize() を呼ぶ（MobileShell の検索タブ復帰時リサイズと同機構）。
 */
export default function PcShell() {
  const { state } = useApp()
  // 'main' = 2ペイン（左:検索 / 右:一覧・メモ帳） | 'other' = その他全幅
  const [mode, setMode] = useState('main')
  // 右ペインの内容: 'list' | 'memo'（初期: メモ帳）
  const [rightTab, setRightTab] = useState('memo')
  // 施設詳細シートの状態 { result, origin }（origin: 'map' | 'list' | 'memocho'）
  const [detail, setDetail] = useState(null)
  // MobileShell と同じく、検索タブの表示（'top' | 'form'）をシェル側が持つ。
  // 検索成功で右ペインが一覧へ切替されても左ペインの状態は保持される
  const [searchView, setSearchView] = useState('top')

  // 検索完了（loading → success）で右ペインを自動的に「一覧」へ切替。
  // エラー時は切替しない（左ペイン検索のまま、エラーはStatusBannerで表示）。
  const prevStatusRef = useRef(state.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = state.status
    if (prev !== 'loading' || state.status === prev) return
    if (state.status === 'success') setRightTab('list')
  }, [state.status])

  // 「その他」から2ペインレイアウトへ戻る時は MapLibre を resize。
  // 左ペインは"その他"表示中も hidden のままマウントされているため、
  // 復帰した瞬間の表示領域は0で、resize() で修正する
  // （MobileShell の検索タブ復帰時リサイズと同機構）。
  useEffect(() => {
    if (mode !== 'main') return
    const map = getMapInstance()
    if (map && typeof map.resize === 'function') map.resize()
  }, [mode])

  const openDetail = (result, origin) => setDetail({ result, origin })
  const closeDetail = () => setDetail(null)

  const selectTab = (id) => {
    if (detail) setDetail(null)
    if (id === 'search') setMode('main')        // 左ペイン検索の構成へ（右ペインの内容は直前のまま）
    else if (id === 'other') setMode('other')   // その他全幅表示
    else setRightTab(id)                        // 'list' | 'memo'（右ペイン切替）
  }

  // ヘッダーのタイトルボタン: 一般トップへ戻す（左ペイン検索 + top表示）。
  // 詳細シートが開いていれば閉じる（MobileShell の goTop と同じ挙動）。
  const goTop = () => {
    if (detail) setDetail(null)
    setMode('main')
    setSearchView('top')
  }

  // 下フッターの active 表示: "その他"表示中は「その他」、
  // それ以外では右ペインの内容に従う（一覧→一覧、メモ帳→メモ帳）
  const active = mode === 'other' ? 'other' : rightTab

  return (
    <div className="flex flex-col h-dvh bg-slate-50 text-slate-800 relative">
      {/* ヘッダー: 全幅。タイトルボタンで一般トップへ戻る */}
      <header className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5">
        <h1>
          <button
            type="button"
            onClick={goTop}
            aria-label="トップ画面に戻る"
            className="flex items-center gap-2.5"
          >
            <AppIcon className="w-9 h-9" />
            <span className="text-xl font-bold text-slate-800">まちデータ帳</span>
          </button>
        </h1>
      </header>

      <StatusBanner />

      <main className="flex-1 min-h-0 flex">
        {/* 左ペイン: 検索（幅600px固定）。常時マウント。"その他"中は hidden */}
        <div
          data-testid="pc-left-pane"
          hidden={mode !== 'main'}
          className="w-[600px] shrink-0 min-h-0 border-r border-slate-200"
        >
          <MobileSearchTab
            view={searchView}
            onViewChange={setSearchView}
            onViewResults={() => setRightTab('list')}
            onMarkerClick={(r) => openDetail(r, 'map')}
          />
        </div>

        {/* 右ペイン: 一覧 / メモ帳（残り幅）。"その他"中は hidden */}
        <div
          data-testid="pc-right-pane"
          hidden={mode !== 'main'}
          className="flex-1 min-w-0 min-h-0 relative"
        >
          <div data-testid="pc-right-list" hidden={rightTab !== 'list'} className="absolute inset-0">
            <MobileListTab onOpenDetail={openDetail} />
          </div>
          <div data-testid="pc-right-memo" hidden={rightTab !== 'memo'} className="absolute inset-0">
            <div className="h-full overflow-y-auto">
              <MemochoSection onOpenDetail={openDetail} />
            </div>
          </div>
        </div>

        {/* その他: 選択中は main 領域を全幅で占める。常時マウント（状態保持） */}
        <div
          data-testid="pc-other-pane"
          hidden={mode !== 'other'}
          className="flex-1 min-w-0 min-h-0"
        >
          <MobileOtherTab />
        </div>
      </main>

      {/* 下フッター: 全幅で常時表示（"その他"表示中も「検索」で戻せる） */}
      <MobileBottomNav active={active} onSelect={selectTab} />

      {detail && (
        <MobileFacilityDetail detail={detail} onClose={closeDetail} />
      )}
    </div>
  )
}
