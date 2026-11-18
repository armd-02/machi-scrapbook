import React from 'react'
import { summarizeWorkspacePowerWifi } from '../utils/powerWifi'

/**
 * (作業スペース系 電源・Wi-Fi) 一覧タブの集計表示
 *
 * 表示中の一覧（フィルタ適用後）に含まれる対象施設（cafe / library /
 * internet_cafe / office=coworking）を母数として、
 * 「⚡ 電源あり a件（x%）」「📶 Wi-Fi あり b件（y%）」を表示する。
 *
 * - 母数は props.results（表示中の一覧）内の対象施設のみ。
 *   対象施設が0件のときは非表示（null）。
 * - 置場所・流儀は AttributeCompleteness（属性の充足率）に合わせる:
 *   折りたたみ不可の軽い1行表示（flex 行＋text-xs スパン）。
 * - 母数は表示テキストには含めず、title（ツールチップ）と aria-label に載せる。
 * - 「あり」= powerWifiStatus の 'yes'（未登録・'no' はカウントしない）。
 */
export default function WorkspacePowerWifiSummary({ results, className = '' }) {
  const s = summarizeWorkspacePowerWifi(results)
  if (!s) return null

  return (
    <div
      className={`flex flex-wrap gap-x-3 gap-y-1 ${className}`}
      aria-label={`作業スペース系 ${s.total}件の電源・Wi-Fi集計`}
    >
      <span
        className="text-xs text-slate-600"
        title={`電源: ${s.powerPct}%（${s.powerPresent}/${s.total}件）が登録あり`}
      >
        ⚡ 電源あり {s.powerPresent}件（{s.powerPct}%）
      </span>
      <span
        className="text-xs text-slate-600"
        title={`Wi-Fi: ${s.wifiPct}%（${s.wifiPresent}/${s.total}件）が登録あり`}
      >
        📶 Wi-Fi あり {s.wifiPresent}件（{s.wifiPct}%）
      </span>
    </div>
  )
}
