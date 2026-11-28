import React, { useEffect, useRef, useState } from 'react'
import {
  facilityName,
  formatAddress,
  formatBuildingLevels,
  formatFee,
  formatCapacity,
  formatLevel,
  formatSmoking,
  formatBrand,
  safeWebsite,
  preferredFacilityLink,
  facilityTypeLabel
} from '../../utils/facilityLabels'
import { wheelchairBadge } from '../../utils/accessibility'
import { keyInfoFor } from '../../utils/categoryProfiles'
import { formatOpeningHoursJa } from '../../utils/openingHours'
import { memochoKeyOf } from '../../utils/memocho'
import { useMemocho } from '../../hooks/useMemocho'
import { powerWifiStatus, isWorkspaceFacility } from '../../utils/powerWifi'
import { getFacilityIcon, facilityIconUrl } from '../../utils/facilityIcon'
import { getCachedThumb, queueThumb } from '../../utils/resultThumbs'
import { buildOsmElementUrl } from '../../utils/editLinks'

// テスト・他コンポーネントの互換のために再エクスポート
export { facilityName, formatAddress, safeWebsite }

// 基本4項目（住所・電話・営業時間・Webサイト）。
// カテゴリプロファイル（keyInfoFor）の項目のうちこれらと重なるものは
// 基本行で表示するため、追加行から除外して二重表示を防ぐ。
const BASE_KEYS = new Set(['address', 'phone', 'opening_hours', 'website'])

// (作業スペース系 電源・Wi-Fi) 3状態の表示:
// - あり: 緑バッジ（登録済みの事実）
// - なし: 赤バッジ（登録済みの事実・TONE_CLASSES の no トーンと同じ色）
// - 未登録: バッジなしのプレーン表示（電話・Webサイトの「-」と同じく控えめ）
function PowerWifiValue({ state, icon }) {
  if (state === 'yes') {
    return (
      <span className="text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md px-2 py-0.5">
        {icon} あり
      </span>
    )
  }
  if (state === 'no') {
    return (
      <span className="text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 rounded-md px-2 py-0.5">
        {icon} なし
      </span>
    )
  }
  return <span>未登録</span>
}

/**
 * モバイル施設カード（電話帳型）
 *
 * 構成: 施設名（大きめ・太字）を先頭に、その下に
 * ラベル付きの情報行を並べる。
 *   - 基本項目: 種別・住所・電話・営業時間・Webサイト
 *     - 種別は常時行を表示（facilityTypeLabel は常に値を返す）。
 *       書式は電話等の情報行と同じ（グレーのラベル＋値）。
 *     - 電話・Webサイトは常時行を表示。登録があれば従来どおりリンク
 *       （電話は tel:、Webサイトは外部リンク target=_blank）、
 *       未登録ならリンクにせず「-」と表記する。
 *     - 住所・営業時間は従来どおり登録がある場合だけ行を表示する。
 *     - 個別にタップできるようにカードは button ではなく div。
 *       施設名行（role=button）と地図サムネイルを個別に操作できる。
 *   - カテゴリ別の追加情報（keyInfoFor のプロファイル項目）のうち、
 *     基本4項目と重ならないものは基本項目の下に続けて表示。
 *   - 車椅子バッジ・欠落フィルタ時の「未登録」表示は従来どおり。
 *
 * onSelect があればカード全体で施設を選択する。詳細モードでは施設名行と地図サムネイルから onOpen を呼ぶ。
 * OSM ID は施設情報の末尾に表示し、OpenStreetMap の地物ページへリンクする。
 *
 * showMapThumb: 固定サイズの地図サムネイルを右上に表示。
 *   mapImage が渡された場合は保存済み画像を使い、それ以外は遅延生成する。
 */
export default function MobileFacilityCard({ result, onOpen, onSelect, bare = false, hideMemoToggle = false, cardId = null, selected = false, showMapThumb = false, mapImage, registrationBookId }) {
  const tags = result.tags || {}
  const name = facilityName(result, '（名称無し）')
  const typeLabel = facilityTypeLabel(result)
  const address = formatAddress(tags)
  const phone = tags.phone || tags['contact:phone']
  const compact = Boolean(onSelect)
  const contactLink = compact
    ? preferredFacilityLink(tags)
    : { label: '公式サイト', url: safeWebsite(tags) }
  const openingHours = formatOpeningHoursJa(tags.opening_hours, { multiline: true }) || ''
  // 建物の階数（building:levels 等が登録されている場合だけ行を表示する）
  const levelsLabel = formatBuildingLevels(tags)
  // 追加の施設情報（登録されているタグから整形し、ある項目だけ行を表示する）
  const levelLabel = formatLevel(tags)
  const feeLabel = formatFee(tags)
  const capacityInfo = formatCapacity(tags)
  const smokingLabel = formatSmoking(tags)
  const brandLabel = formatBrand(result)
  // (A3) カテゴリプロファイルの追加項目（基本4項目・wheelchair は除外）
  const extraItems = keyInfoFor(result).items.filter(
    (it) => !BASE_KEYS.has(it.key) && it.key !== 'wheelchair'
  )
  const wcBadge = wheelchairBadge(tags)

  // 施設アイコン（コミュニティマップメーカー由来の対応表で判定。詳細は facilityIcon.js）
  // タグが無い・対応表に無い場合は fallback アイコン（表示は常に保証）
  const iconUrl = facilityIconUrl(getFacilityIcon(tags))

  // (作業スペース系 電源・Wi-Fi) 対象施設（cafe/library/internet_cafe/coworking）のみ
  // 電源・Wi-Fi の3状態を表示する。対象外は行ごとに出さない。
  const pwStatus = isWorkspaceFacility(tags) ? powerWifiStatus(tags) : null

  // まちメモ帳（第2ピース）: この施設が登録済みかどうか
  const { has, toggle } = useMemocho()
  const osmId = memochoKeyOf(result)
  const registered = has(osmId)

  // リンクはカードの選択と独立して動作する。
  const stopOpen = (e) => e.stopPropagation()

  // メモ帳ボタンのタップ: 追加/削除を切り替える（toggle）。
  const onToggleMemo = (e) => {
    e.stopPropagation()
    toggle(result, registrationBookId)
  }

  // (地図サムネイル) 検索結果カード用: カード右側に地図サムネイルを表示する
  // 240×240 の画像を固定サイズの枠に表示する。
  // - 生成は遅延（IntersectionObserver で画面に入ったら）＋逐次キュー（同時1件）
  // - メモリキャッシュのみ（localStorage には保存しない）。再表示しても再生成しない
  // - 生成失敗はセッション内でリトライせず、画像なしの通常表示に落とす
  const [thumb, setThumb] = useState(undefined) // undefined=未生成・null=失敗・string=dataURL
  const [detailsOpen, setDetailsOpen] = useState(false)
  const thumbnail = mapImage === undefined ? thumb : mapImage
  const hasThumbnail = showMapThumb && typeof thumbnail === 'string' && Boolean(thumbnail)
  const rootRef = useRef(null)
  const thumbKey = memochoKeyOf(result)
  const thumbLat = typeof result.lat === 'number' && Number.isFinite(result.lat) ? result.lat : null
  const thumbLon = typeof result.lon === 'number' && Number.isFinite(result.lon) ? result.lon : null
  const hasThumbCoords = showMapThumb && mapImage === undefined && thumbLat !== null && thumbLon !== null

  useEffect(() => {
    if (!hasThumbCoords) return
    const cached = getCachedThumb(thumbKey)
    if (cached !== undefined) {
      setThumb(cached)
      return
    }
    let cancelled = false
    const start = () => {
      queueThumb(thumbKey, thumbLat, thumbLon).then((url) => {
        if (!cancelled) setThumb(url)
      })
    }
    // IntersectionObserver 未対応環境（テスト・旧ブラウザ）はマウント時に即生成
    if (typeof IntersectionObserver !== 'function') {
      start()
      return () => { cancelled = true }
    }
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (cancelled) return
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        start()
      }
    }, { threshold: 0.1 })
    io.observe(el)
    return () => { cancelled = true; io.disconnect() }
  }, [hasThumbCoords, thumbKey, thumbLat, thumbLon])

  const activateFacility = () => (onSelect ?? onOpen)?.(result)
  const selectFromCard = (event) => {
    if (!event.target.closest('a, button, [role="button"]')) activateFacility()
  }
  const nameAction = onSelect ? {} : {
    role: 'button',
    tabIndex: 0,
    'aria-label': `${name}の詳細を表示`,
    onClick: activateFacility,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        activateFacility()
      }
    },
  }
  const Thumbnail = onSelect ? 'div' : 'button'
  const thumbAction = onSelect ? {} : {
    type: 'button',
    'aria-label': `${name}の詳細を表示`,
    onClick: activateFacility,
  }
  const memoToggle = !hideMemoToggle && (
    <button
      type="button"
      onClick={onToggleMemo}
      aria-label={registered ? 'メモ帳から削除' : 'メモ帳に追加'}
      aria-pressed={registered}
      className={`shrink-0 card-action-btn ${registered ? 'card-action-btn--delete' : 'card-action-btn--add'}${compact && hasThumbnail ? ' absolute right-1 top-1 z-20' : ''}`}
    >
      {registered ? '✕' : '＋'}
    </button>
  )
  const titleRow = (
    <div className="flex items-start justify-between gap-1">
      <div
        {...nameAction}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <img
          src={iconUrl}
          alt=""
          aria-hidden="true"
          className="h-6 w-6 shrink-0"
          loading="lazy"
        />
        <h3 className="min-w-0 break-words text-base font-bold text-slate-800">{name}</h3>
      </div>
      {compact && !hasThumbnail && memoToggle}
    </div>
  )
  const locationRows = (
    <>
      <p className="text-xs text-slate-600 break-words">
        <span className="text-slate-400">種別</span>
        <span className="ml-1">{typeLabel}</span>
      </p>
      {address && (
        <p className="text-xs text-slate-600 break-words">
          <span className="text-slate-400">住所</span>
          <span className="ml-1">📍 {address}</span>
        </p>
      )}
    </>
  )
  const phoneRow = phone ? (
    <a
      href={`tel:${phone}`}
      onClick={stopOpen}
      className="inline-flex items-center gap-1 text-xs text-primary-600"
    >
      <span className="text-slate-400">電話</span>
      <span>📞 {phone}</span>
    </a>
  ) : (
    <p className="text-xs text-slate-600">
      <span className="text-slate-400">電話</span>
      <span className="ml-1">-</span>
    </p>
  )
  const openingHoursRow = openingHours && (
    <p className="flex items-start gap-1 text-xs text-slate-600">
      <span className="shrink-0 text-slate-400">営業時間</span>
      <span className="min-w-0 whitespace-pre-line break-words">🕐 {openingHours}</span>
    </p>
  )
  const contactRow = contactLink?.url ? (
    <a
      href={contactLink.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopOpen}
      className="inline-flex items-center gap-1 text-xs text-primary-600 break-all"
    >
      {!compact && <span className="text-slate-400">Webサイト</span>}
      <span>🌐 {contactLink.label}</span>
    </a>
  ) : (
    <p className="text-xs text-slate-600">
      <span className="text-slate-400">{compact ? 'Web' : 'Webサイト'}</span>{' '}
      <span>-</span>
    </p>
  )
  const osmIdRow = /^(node|way|relation)\/[1-9]\d*$/.test(osmId) ? (
    <p className="text-xs text-slate-600">
      <span className="text-slate-400">OSM ID</span>
      <a
        href={buildOsmElementUrl(result)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopOpen}
        className="ml-1 text-primary-600 break-all"
      >
        {osmId}
      </a>
    </p>
  ) : null
  const additionalRows = (
    <>
      {levelsLabel && (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">階数</span>
          <span className="ml-1">{levelsLabel}</span>
        </p>
      )}
      {levelLabel && (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">所在階</span>
          <span className="ml-1">{levelLabel}</span>
        </p>
      )}
      {feeLabel && (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">料金</span>
          <span className="ml-1">{feeLabel}</span>
        </p>
      )}
      {capacityInfo && (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">{capacityInfo.label}</span>
          <span className="ml-1">{capacityInfo.text}</span>
        </p>
      )}
      {smokingLabel && (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">喫煙</span>
          <span className="ml-1">{smokingLabel}</span>
        </p>
      )}
      {brandLabel && (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">ブランド</span>
          <span className="ml-1">{brandLabel}</span>
        </p>
      )}
      {/* (作業スペース系) 電源・Wi-Fi の状態。基本4項目のあと・カテゴリ追加項目の前。
          対象施設のみ表示。あり/なしはバッジ（登録済みの事実）、
          未登録は控えめなプレーン表示（電話・Webサイトの「-」と同様） */}
      {pwStatus && (
        <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-400">電源</span>
            <PowerWifiValue state={pwStatus.power} icon="⚡" />
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-400">Wi-Fi</span>
            <PowerWifiValue state={pwStatus.wifi} icon="📶" />
          </span>
        </p>
      )}
      {/* (A3) カテゴリ別の追加項目（基本4項目と重ならないもの） */}
      {extraItems.length > 0 && (
        <ul className="space-y-1">
          {extraItems.map((it) => (
            <li key={it.key} className="text-xs text-slate-600 break-words">
              {it.text}
            </li>
          ))}
        </ul>
      )}

      {wcBadge && (
        <p className={`text-[11px] border rounded-md px-2 py-0.5 inline-block ${wcBadge.cls}`}>
          ♿ {wcBadge.text}
        </p>
      )}

    </>
  )
  const content = compact ? (
    <>
      {titleRow}
      {contactRow}
      <div>{phoneRow}</div>
      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
        className="flex min-h-7 items-center gap-1 text-xs font-medium text-slate-600"
      >
        <span aria-hidden="true">{detailsOpen ? '▼' : '▶'}</span>
        施設情報
      </button>
      {detailsOpen && (
        <div className="space-y-1.5">
          {locationRows}
          {openingHoursRow}
          {additionalRows}
          {osmIdRow}
        </div>
      )}
    </>
  ) : (
    <>
      {titleRow}
      {locationRows}
      {phoneRow}
      {openingHoursRow}
      {contactRow}
      {additionalRows}
      {osmIdRow}
      {memoToggle}
    </>
  )

  // 地図はカードの高さや施設情報の開閉にかかわらず、右上に固定サイズで表示する。
  if (showMapThumb) {
    const frameClass = bare ? '' : `bg-white border rounded-xl shadow-sm overflow-hidden ${
      selected ? 'border-primary-400 ring-2 ring-primary-500' : 'border-slate-200'
    }`
    return (
      <div
        ref={rootRef}
        id={cardId || undefined}
        onClick={onSelect ? selectFromCard : undefined}
        className={`relative w-full flex items-stretch ${frameClass}${onSelect ? ' cursor-pointer' : ''}`}
      >
        {onSelect && (
          <button
            type="button"
            aria-label={`${name}を地図で選択`}
            onClick={activateFacility}
            className="pointer-events-none absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
          />
        )}
        <div className={`flex-1 min-w-0 p-3 space-y-1.5${bare && !hasThumbnail ? ' pr-10' : ''}`}>{content}</div>
        {hasThumbnail && (
          <div className="relative h-[112px] w-[136px] shrink-0 self-start">
            <Thumbnail {...thumbAction} className="absolute inset-0 w-full cursor-pointer">
              <img src={thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </Thumbnail>
            {compact && memoToggle}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      id={cardId || undefined}
      className={bare
        ? "w-full text-left p-3 space-y-1.5"
        : `w-full text-left bg-white border rounded-xl p-3 shadow-sm space-y-1.5 ${
            selected
              ? 'border-primary-400 ring-2 ring-primary-500'
              : 'border-slate-200'}`}
    >
      {content}
    </div>
  )
}
