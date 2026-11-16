import React from 'react'
import {
  facilityName,
  facilityTypeLabel,
  formatAddress,
  safeWebsite
} from '../../utils/facilityLabels'
import { parseAccessibility } from '../../utils/accessibility'
import { buildIdElementUrl, buildOsmElementUrl } from '../../utils/editLinks'
import { keyInfoFor } from '../../utils/categoryProfiles'
import { formatOpeningHoursJa } from '../../utils/openingHours'
import MiniLocationMap from './MiniLocationMap'

/**
 * (#59 / #61 / #62) 施設詳細ボトムシート
 *
 * 表示項目は一覧の施設カード（MobileFacilityCard）とそろえた構成:
 *   - 施設名 ＋ カテゴリチップ（facilityTypeLabel・カードと同じ見た目）
 *   - 基本行（カードと同じラベル付き行の形式）:
 *     住所（登録時のみ）／電話（常時・未登録なら「-」）／
 *     営業時間（登録時のみ）／Webサイト（常時・未登録なら「-」）
 *   - カテゴリ別の追加項目（keyInfoFor の items のうち、基本4項目
 *     address/phone/opening_hours/website と wheelchair を除外したものを
 *     カードと同じ並びで表示）
 *   - メール・FAX（登録時のみ）
 *   - SNSリンク（Instagram/Facebook/X/YouTube: タグがある場合のみ）
 * (#61) バリアフリー情報: 車椅子・トイレ・駐車・エレベーター等を日本語解釈して表示
 * 補助情報: OSM ID・座標・OSMで見る
 * (#62) 位置マップ: 座標がある場合、ボトムシート上部に施設位置を示す
 *        小型マップ（MiniLocationMap）＋マーカーを表示する
 * 主ナビゲーションのタブではなく、施設カード／地図マーカーから開くオーバーレイ。
 *
 * 変更点: 「タグ一覧（折りたたみ）」セクションは廃止。基本行はカードと同一の
 * ラベル付き形式に統一し、電話・Webサイトは未登録でも「-」を常時表示する。
 * 「OSMに登録されていません」注記は削除（電話・Webサイトは「-」で常時表示）。
 */

// 基本4項目（住所・電話・営業時間・Webサイト）。
// カテゴリプロファイル（keyInfoFor）の項目のうちこれらと重なるものは
// 基本行で表示するため、追加行から除外して二重表示を防ぐ（カードと同条件）。
const BASE_KEYS = new Set(['address', 'phone', 'opening_hours', 'website'])

// SNSリンク定義（タグキー → 表示ラベル・URL組み立て用のドメイン）
const SNS_SOURCES = [
  { label: 'Instagram', key: 'contact:instagram', domain: 'instagram.com' },
  { label: 'Facebook', key: 'contact:facebook', domain: 'facebook.com' },
  { label: 'X', key: 'contact:twitter', domain: 'x.com' },
  { label: 'YouTube', key: 'contact:youtube', domain: 'youtube.com' }
]

/**
 * SNSタグ値 → リンク情報
 * http で始まる値はそのままURLとして使う。それ以外はアカウント名として扱い、
 * 先頭の @ を除いて各サービスのURLを組み立てる（https://<ドメイン>/<名>）。
 */
function buildSnsLink(source, value) {
  if (/^http/.test(value)) {
    return { label: source.label, url: value, display: value }
  }
  const account = value.replace(/^@/, '')
  if (!account) return null
  return {
    label: source.label,
    url: `https://${source.domain}/${account}`,
    display: account
  }
}

/** タグからSNSリンク一覧を生成（登録がある場合のみ） */
function snsLinksFromTags(tags) {
  const links = []
  for (const source of SNS_SOURCES) {
    const value = tags[source.key]
    if (typeof value !== 'string' || !value) continue
    const link = buildSnsLink(source, value)
    if (link) links.push(link)
  }
  return links
}

export default function MobileFacilityDetail({ detail, onClose }) {
  const { result } = detail
  const tags = result.tags || {}
  const name = facilityName(result)
  const typeLabel = facilityTypeLabel(result)
  const address = formatAddress(tags)
  const phone = tags.phone || tags['contact:phone']
  const website = safeWebsite(tags)
  const email = tags['contact:email'] || tags.email || ''
  const fax = tags['contact:fax'] || tags.fax || ''
  const openingHours = formatOpeningHoursJa(tags.opening_hours) || ''
  const accessItems = parseAccessibility(tags)
  const hasCoords = result.lat != null && result.lon != null

  // (A3) カテゴリ別の追加項目（基本4項目・wheelchair は除外。カードと同じ条件）
  const extraItems = keyInfoFor(result).items.filter(
    (it) => !BASE_KEYS.has(it.key) && it.key !== 'wheelchair'
  )

  // SNSリンク（タグが登録されている場合のみ）
  const snsLinks = snsLinksFromTags(tags)

  return (
    <div className="absolute inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`施設詳細: ${name}`}
        className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[85dvh] flex flex-col"
      >
        <div className="px-4 pt-2 pb-3 border-b border-slate-100">
          <div className="mx-auto w-10 h-1 bg-slate-200 rounded-full mb-2" aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="absolute top-2 right-2 w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full text-lg leading-none"
          >
            ✕
          </button>
          {/* 施設名 ＋ カテゴリチップ（カードと同じ見た目） */}
          <div className="flex items-center gap-2 pr-10">
            <h2 className="text-base font-semibold text-slate-800 break-words min-w-0 flex-1">{name}</h2>
            <span className="shrink-0 text-[11px] text-primary-700 bg-primary-50 rounded-md px-2 py-0.5">
              {typeLabel}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">{result.type}/{result.id}</p>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {/* (#62) 位置マップ: 施設座標を中心にマーカー表示（非インタラクティブ） */}
          {hasCoords && (
            <MiniLocationMap lng={result.lon} lat={result.lat} />
          )}

          {/* 基本項目行（カードと同じラベル付き行の形式） */}
          {address && (
            <p className="text-xs text-slate-600 break-words">
              <span className="text-slate-400">住所</span>
              <span className="ml-1">📍 {address}</span>
            </p>
          )}
          {phone ? (
            <a
              href={`tel:${phone}`}
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

          {/* (A3) カテゴリ別の追加項目（基本4項目・wheelchair と重ならないもの） */}
          {extraItems.length > 0 && (
            <ul className="space-y-1">
              {extraItems.map((it) => (
                <li key={it.key} className="text-xs text-slate-600 break-words">
                  {it.text}
                </li>
              ))}
            </ul>
          )}

          {/* メール・FAX（登録がある場合のみ） */}
          {email && (
            <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 text-sm text-primary-600 break-all">
              ✉️ {email}
            </a>
          )}
          {fax && <p className="text-xs text-slate-600">📠 FAX: {fax}</p>}

          {/* SNSリンク（タグがある場合のみ） */}
          {snsLinks.length > 0 && (
            <ul className="space-y-1">
              {snsLinks.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary-600 break-all"
                  >
                    <span className="text-slate-400">{s.label}</span>
                    <span>{s.display}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          {accessItems.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <p className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-600">
                ♿ バリアフリー情報
              </p>
              <ul className="px-3 py-2 space-y-1.5">
                {accessItems.map((it) => (
                  <li key={it.key} className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true">{it.icon}</span>
                      <span className="text-slate-700">{it.label}</span>
                      <span className={`border rounded-full px-2 py-0.5 ${it.cls}`}>{it.status}</span>
                    </span>
                    {it.note && (
                      <span className="block text-[11px] text-slate-500 mt-0.5 break-words">{it.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasCoords && (
            <p className="text-xs text-slate-500 font-mono">🗺 {result.lat}, {result.lon}</p>
          )}

          <a
            href={buildOsmElementUrl(result)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary-600"
          >
            🔗 OSMで見る（{result.type}/{result.id}）
          </a>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex gap-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {hasCoords && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${result.lat},${result.lon}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 min-h-[44px] px-4 flex items-center justify-center bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-800 text-sm font-medium rounded-lg"
              title="Googleマップで経路検索"
            >
              🧭 経路検索
            </a>
          )}
          {/* (B3) iD編集導線: 対象施設を特定した状態でiDへジャンプ */}
          <a
            href={buildIdElementUrl(result)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-h-[44px] px-4 flex items-center justify-center bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-sm font-medium rounded-lg"
            title="iDエディタで編集（OSMアカウント必要）"
          >
            ✏️ iDで編集
          </a>
        </div>
      </div>
    </div>
  )
}
