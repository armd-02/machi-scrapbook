import React from 'react'
import AppIcon from './mobile/AppIcon'
import HeaderMenu from './HeaderMenu'

/**
 * (#76) アプリ共通ヘッダー
 *
 * アプリアイコン＋タイトル（まちのスクラップブック）。タイトルボタンを押すと
 * 一般トップへ戻る（onGoTop コールバック。戻る先の操作はシェルごとに異なるため
 * プロップで渡す）。右端にはハンバーガーメニュー（HeaderMenu:
 * CSV/GeoJSON保存・まちメモ帳全消去）。
 *
 * (#75) で HeaderMenu を導入する際、MobileShell と PcShell の両方に
 * 同じヘッダー実装（flex 行＋h1タイトルボタン＋HeaderMenu）が重複していた。
 * (#76) でこの共通コンポーネントに統合し、両シェルが同じ形を共有する。
 */
export default function AppHeader({ onGoTop }) {
  return (
    <header className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5">
      <div className="flex items-center gap-2">
        {/* アプリアイコン＋タイトル。h1 を見出し要素として残しつつボタン全体を包み、
            押下でトップ画面（一般向けトップ）に戻る */}
        <h1 className="flex-1 min-w-0">
          <button
            type="button"
            onClick={onGoTop}
            aria-label="トップ画面に戻る"
            className="flex items-center gap-2.5"
          >
            <AppIcon className="w-9 h-9" />
            <span className="text-xl font-bold text-slate-800">まちのスクラップブック</span>
          </button>
        </h1>
        {/* ハンバーガーメニュー: CSV/GeoJSON保存・まちメモ帳全消去 */}
        <HeaderMenu />
      </div>
    </header>
  )
}
