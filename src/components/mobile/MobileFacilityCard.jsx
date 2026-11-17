import React from 'react'
import {
  facilityName,
  formatAddress,
  safeWebsite,
  facilityTypeLabel
} from '../../utils/facilityLabels'
import { wheelchairBadge } from '../../utils/accessibility'
import { keyInfoFor } from '../../utils/categoryProfiles'
import { formatOpeningHoursJa } from '../../utils/openingHours'
import { missingAttributesOf, ATTRIBUTE_LABELS } from '../../utils/statistics'
import { memochoKeyOf } from '../../utils/memocho'
import { useMemocho } from '../../hooks/useMemocho'

// テスト・他コンポーネントの互換のために再エクスポート
export { facilityName, formatAddress, safeWebsite }

// 基本4項目（住所・電話・営業時間・Webサイト）。
// カテゴリプロファイル（keyInfoFor）の項目のうちこれらと重なるものは
// 基本行で表示するため、追加行から除外して二重表示を防ぐ。
const BASE_KEYS = new Set(['address', 'phone', 'opening_hours', 'website'])

/**
 * モバイル施設カード（電話帳型）
 *
 * 構成: 施設名（大きめ・太字）＋カテゴリラベルを先頭に、その下に
 * ラベル付きの情報行を並べる。
 *   - 基本項目: 住所・電話・営業時間・Webサイト
 *     - 電話・Webサイトは常時行を表示。登録があれば従来どおりリンク
 *       （電話は tel:、Webサイトは外部リンク target=_blank）、
 *       未登録ならリンクにせず「-」と表記する。
 *     - 住所・営業時間は従来どおり登録がある場合だけ行を表示する。
 *     - 個別にタップできるようにカードは button ではなく div。
 *       リンクは stopPropagation で詳細シートの展開を防ぐ。
 *   - カテゴリ別の追加情報（keyInfoFor のプロファイル項目）のうち、
 *     基本4項目と重ならないものは基本項目の下に続けて表示。
 *   - 車椅子バッジ・欠落フィルタ時の「未登録」表示は従来どおり。
 *
 * カード全体をタップすると詳細シート（onOpen(result)）が開く。
 * OSM生データ（node/way、amenity=cafe、OSM ID）はカードの主表示にしない
 * （#44 方針維持）。詳細（OSM ID・全タグ）は MobileFacilityDetail に退ける。
 */
export default function MobileFacilityCard({ result, onOpen, showMissing = false, bare = false, hideMemoToggle = false }) {
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

  // まちメモ帳（第2ピース）: この施設が登録済みかどうか
  const { has, toggle } = useMemocho()
  const registered = has(memochoKeyOf(result))

  // リンクタップ時の詳細シート展開を止める（カード全体の onClick を通さない）
  const stopOpen = (e) => e.stopPropagation()

  // メモ帳ボタンのタップ: 追加/削除を切り替える（toggle）。
  // カード全体の onClick（詳細を開く）へは伝播させない（stopOpen と同じパターン）
  const onToggleMemo = (e) => {
    e.stopPropagation()
    toggle(result)
  }

  return (
    <div
      onClick={() => onOpen(result)}
      className={bare
        ? "w-full text-left p-3 space-y-1.5 active:bg-slate-50 cursor-pointer"
        : "w-full text-left bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-1.5 active:bg-slate-50 cursor-pointer"}
    >
      {/* 施設名（大きめ・太字）＋カテゴリラベル */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-slate-800 min-w-0 break-words">{name}</h3>
        <span className="shrink-0 text-[11px] text-primary-700 bg-primary-50 rounded-md px-2 py-0.5">
          {typeLabel}
        </span>
      </div>

      {/* 基本項目行。住所・営業時間は登録済みのみ。
          電話・Webサイトは常時表示し、未登録なら「-」（リンクにはしない） */}
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
      {/* (B2) 欠落フィルタアクティブ時: 未登録の主要属性を表示 */}
      {showMissing && (() => {
        const missing = missingAttributesOf(result)
        if (missing.length === 0) return null
        return (
          <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-0.5">
            ⚠️ {missing.map((k) => ATTRIBUTE_LABELS[k]).join('・')} 未登録
          </p>
        )
      })()}

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
    </div>
  )
}
