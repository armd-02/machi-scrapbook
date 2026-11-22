import React, { useEffect, useRef, useState } from 'react'
import {
  facilityName,
  formatAddress,
  safeWebsite,
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
 *       詳細シートの展開は施設名行（role=button）または地図サムネイルの
 *       タップのみ（情報行のタップでは詳細は開かない）。
 *   - カテゴリ別の追加情報（keyInfoFor のプロファイル項目）のうち、
 *     基本4項目と重ならないものは基本項目の下に続けて表示。
 *   - 車椅子バッジ・欠落フィルタ時の「未登録」表示は従来どおり。
 *
 * 詳細シートは施設名行（role=button・aria-label: {施設名}の詳細を表示）または
 * 地図サムネイルのタップで onOpen(result) で開く（メモ帳カードと共通の形）。
 * OSM生データ（node/way、amenity=cafe、OSM ID）はカードの主表示にしない
 * （#44 方針維持）。詳細（OSM ID・全タグ）は MobileFacilityDetail に退ける。
 *
 * showMapThumb: 地図サムネイルを右側に表示（検索結果カード用）。
 *   240×240 の captureMapImage で遅延・逐次生成しメモリキャッシュする
 *   （localStorage には保存しない・生成失敗は画像なしの通常表示）。
 *   サムネイルはタップで詳細を開く（role=button・aria-label は施設名行と
 *   同じ。帰属表示オーバーレイは pointer-events-none で常時表示）。
 *   サムネイルが出ていないカード（座標なし・生成失敗）は施設名行の
 *   タップで詳細を開く。
 */
export default function MobileFacilityCard({ result, onOpen, bare = false, hideMemoToggle = false, cardId = null, selected = false, showMapThumb = false }) {
  const tags = result.tags || {}
  const name = facilityName(result)
  const typeLabel = facilityTypeLabel(result)
  const address = formatAddress(tags)
  const phone = tags.phone || tags['contact:phone']
  const website = safeWebsite(tags)
  const openingHours = formatOpeningHoursJa(tags.opening_hours) || ''
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
  const registered = has(memochoKeyOf(result))

  // （レガシー）カード全体の onClick は撤去済みで、これらの stopPropagation は
  // 現状では何もしない。それでも上位コンポーネント側で新たな伝播ハンドラが
  // 増えた場合に備え、従来どおり残す（リンク・トグルの操作自体は不変）。
  const stopOpen = (e) => e.stopPropagation()

  // メモ帳ボタンのタップ: 追加/削除を切り替える（toggle）。
  // stopPropagation は上記のレガシーパターン（伝播防御）として維持する。
  const onToggleMemo = (e) => {
    e.stopPropagation()
    toggle(result)
  }

  // (地図サムネイル) 検索結果カード用: カード右側に地図サムネイルを表示する
  // （まちメモ帳カードと同じ見た目: 表示列120px・240×240生成・©表記オーバーレイ）。
  // - 生成は遅延（IntersectionObserver で画面に入ったら）＋逐次キュー（同時1件）
  // - メモリキャッシュのみ（localStorage には保存しない）。再表示しても再生成しない
  // - 生成失敗はセッション内でリトライせず、画像なしの通常表示に落とす
  const [thumb, setThumb] = useState(undefined) // undefined=未生成・null=失敗・string=dataURL
  const rootRef = useRef(null)
  const thumbKey = memochoKeyOf(result)
  const thumbLat = typeof result.lat === 'number' && Number.isFinite(result.lat) ? result.lat : null
  const thumbLon = typeof result.lon === 'number' && Number.isFinite(result.lon) ? result.lon : null
  const hasThumbCoords = showMapThumb && thumbLat !== null && thumbLon !== null

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

  const content = (
    <>
      {/* 施設名（大きめ・太字）。タップで詳細シートを開く（role=button）。
          名前の左に施設種別アイコン（高さ24px）を表示。
          種別チップ・「🔎詳細」ボタンは廃止（#84）: 種別は下方の情報行で
          表示し、詳細は施設名行または地図サムネイルのタップで開く */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${name}の詳細を表示`}
        onClick={() => onOpen && onOpen(result)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen && onOpen(result)
          }
        }}
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

      {/* 基本項目行。種別は常時・住所・営業時間は登録済みのみ。
          電話・Webサイトは常時表示し、未登録なら「-」（リンクにはしない） */}
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
      {phone ? (
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
      )}
      {openingHours && (
        <p className="text-xs text-slate-600 break-words">
          <span className="text-slate-400">営業時間</span>
          <span className="ml-1">🕐 {openingHours}</span>
        </p>
      )}
      {website ? (
        <a
          href={website}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopOpen}
          className="inline-flex items-center gap-1 text-xs text-primary-600 break-all"
        >
          <span className="text-slate-400">Webサイト</span>
          <span>🌐 公式サイト</span>
        </a>
      ) : (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">Webサイト</span>
          <span className="ml-1">-</span>
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

      {/* まちメモ帳（第2ピース）: 追加/削除トグルボタン（小さい・左寄せ）。
          メモ帳内では右上の✕で削除するため hideMemoToggle で出さない */}
      {!hideMemoToggle && (
        <button
          type="button"
          onClick={onToggleMemo}
          aria-pressed={registered}
          className="self-start text-[11px] leading-tight px-2 py-1 rounded-md border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 active:bg-primary-200"
        >
          {registered ? '📝 登録済み' : '📝 メモ帳に追加'}
        </button>
      )}
    </>
  )

  // (地図サムネイル) 表示モード: 右側に120pxのサムネイル列を併設する
  // （まちメモ帳カードと同じ構造・©表記オーバーレイ付き）
  if (showMapThumb) {
    return (
      <div
        ref={rootRef}
        id={cardId || undefined}
        className={`w-full bg-white border rounded-xl shadow-sm overflow-hidden flex items-stretch ${
          selected ? 'border-primary-400 ring-2 ring-primary-500' : 'border-slate-200'}`}
      >
        <div className="flex-1 min-w-0 p-3 space-y-1.5">{content}</div>
        {typeof thumb === 'string' && (
          // タップで詳細を開く（メモ帳カードのサムネイルと同じ振る舞い・セマンティクス）
          <div
            className="relative shrink-0 w-[120px] cursor-pointer"
            role="button"
            aria-label={`${name}の詳細を表示`}
            onClick={() => onOpen && onOpen(result)}
          >
            <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <span className="absolute bottom-1 right-1 text-[8px] leading-tight text-right text-slate-600 bg-white/75 rounded px-0.5 pointer-events-none">
              © OpenStreetMap contributors
            </span>
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
