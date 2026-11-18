import React from 'react'
import Spinner from './Spinner'

/**
 * 地名・駅名入力のテキストボックス（共通）。モバイルのトップ（QuickTopIntro）と
 * 地図タブの場所指定（MobileSearchTab の formBody）で共用する。
 *
 * ジオコーディング問い合わせ中（geocoding）は、ボックスの内側右端に処理中スピナー
 * を表示する。スピナーは pointer-events-none なので表示中も入力は妨げない。
 * ボックス自体は無効化しない（disabled は施設検索中などの別用途のみ）。
 *
 * @param {string} value 入力値
 * @param {(value: string) => void} onChange 入力値変更（値を受け取る）
 * @param {(e: KeyboardEvent) => void} [onKeyDown] キー操作（Enter/Escape 等）
 * @param {string} [placeholder] プレースホルダー
 * @param {string} [id] 要素id（label の htmlFor 用）
 * @param {boolean} [disabled] 無効化（施設検索中等）
 * @param {boolean} [geocoding] ジオコーディング問い合わせ中 → 右端にスピナー
 * @param {boolean} [areaSet] 検索エリア設定済み（成功）→ 緑系のスタイル
 */
export default function PlaceNameInput({
  value = '',
  onChange = () => {},
  onKeyDown,
  placeholder = '地名・駅名（例: 大阪駅）',
  id,
  disabled = false,
  geocoding = false,
  areaSet = false,
}) {
  const className = [
    'w-full pl-3 py-2 text-sm border rounded-lg',
    geocoding ? 'pr-9' : 'pr-3',
    areaSet ? 'border-green-500 bg-green-50' : 'border-slate-200 bg-white disabled:bg-slate-50',
  ].join(' ')

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown || undefined}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />
      {geocoding && (
        <div
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
          data-testid="place-input-spinner"
        >
          <Spinner />
        </div>
      )}
    </div>
  )
}
