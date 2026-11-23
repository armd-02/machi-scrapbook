import React from 'react'
import Spinner from './Spinner'

/**
 * 地名・駅名入力のテキストボックス（共通）。モバイルのトップ（QuickTopIntro）と
 * フォーム側の場所入力欄（MobileSearchTab の formBody）で共用する。
 *
 * ジオコーディング問い合わせ中（geocoding）は、ボックスの内側右端に処理中スピナー
 * を表示する。スピナーは pointer-events-none なので表示中も入力は妨げない。
 * ボックス自体は無効化しない（disabled は施設検索中などの別用途のみ）。
 *
 * 入力欄の右側に「地名検索」ボタンを配置する（onGeocode を渡した場合のみ）。
 * 押下（または入力欄で Enter）で入力テキストを Nominatim でジオコードし、
 * 結果を検索エリアに設定する（明示的な1回の問い合わせ。入力中の
 * オートコンプリートには Nominatim を使わない）。
 *
 * @param {string} value 入力値
 * @param {(value: string) => void} onChange 入力値変更（値を受け取る）
 * @param {(e: KeyboardEvent) => void} [onKeyDown] キー操作（Enter/Escape 等）
 * @param {() => void} [onFocus] フォーカス時のコールバック（周辺候補の取得起動など）
 * @param {(value: string) => void} [onGeocode] 「地名検索」ボタンの押下。
 *   渡すと入力欄の右に「地名検索」ボタンが表示される
 * @param {string} [placeholder] プレースホルダー
 * @param {string} [id] 要素id（label の htmlFor 用）
 * @param {boolean} [disabled] 無効化（施設検索中等）
 * @param {boolean} [geocoding] ジオコーディング問い合わせ中 → 右端にスピナー
 * @param {boolean} [geocodeDisabled] 「地名検索」ボタンを無効化（ジオコード実行中等）
 * @param {boolean} [areaSet] 検索エリア設定済み（成功）→ 緑系のスタイル
 * @param {(() => void) | null} [onCurrentLocation] 「現在地付近」ボタンの押下。
 *   指定した場合、「地名検索」ボタンの右側にアイコンのみボタン（🎯 ターゲット風）
 *   を表示する。aria-label / title は「現在地付近」。押下で現在位置を確定した
 *   場所として設定する（親で処理）。
 * @param {boolean} [currentLocationBusy] 現在位置取得中。「現在地付近」ボタンを
 *   無効化し、ボタン内をスピナーにする。
 */
export default function PlaceNameInput({
  value = '',
  onChange = () => {},
  onKeyDown,
  onFocus,
  onGeocode = null,
  placeholder = '地名・駅名（例: 大阪駅）',
  id,
  disabled = false,
  geocoding = false,
  geocodeDisabled = false,
  areaSet = false,
  onCurrentLocation = null,
  currentLocationBusy = false,
}) {
  const className = [
    'w-full pl-3 py-2 text-sm border rounded-lg',
    geocoding ? 'pr-9' : 'pr-3',
    areaSet ? 'border-green-500 bg-green-50' : 'border-slate-200 bg-white disabled:bg-slate-50',
  ].join(' ')

  return (
    <div className="flex items-stretch gap-2">
      <div className="relative flex-1 min-w-0">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown || undefined}
          onFocus={onFocus || undefined}
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
      {onGeocode && (
        <button
          type="button"
          onClick={onGeocode}
          disabled={disabled || geocodeDisabled}
          data-testid="place-geocode-button"
          className="shrink-0 min-h-[38px] px-3 text-sm font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 disabled:opacity-50"
        >
          地名検索
        </button>
      )}
      {onCurrentLocation && (
        // (#xx) 「現在地付近」ボタン: アイコンのみ（テキストラベルなし）。
        // 押下で現在位置を確定した場所として設定する（親で処理）。
        // 位置は「地名検索」ボタンの隣（入力行の右端）
        <button
          type="button"
          onClick={onCurrentLocation}
          disabled={disabled || currentLocationBusy}
          aria-label="現在地付近"
          title="現在地付近"
          data-testid="place-current-location-button"
          className="shrink-0 min-h-[38px] w-[38px] flex items-center justify-center text-base leading-none bg-white border border-primary-200 rounded-lg hover:bg-primary-50 disabled:opacity-50"
        >
          {currentLocationBusy ? <Spinner /> : '🎯'}
        </button>
      )}
    </div>
  )
}
