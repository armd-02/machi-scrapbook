import React from 'react'
import { summarizeBarrierFree } from '../../utils/barrierFreeSummary'
import { TACTILE_LINE_COLORS } from '../../utils/barrierFreeGeoJSON'

/**
 * バリアフリー検索 — データの充実度（参考）表示
 *
 * 正規化済み結果（フィルタ適用前）を summarizeBarrierFree で集計し、
 * 点字ブロック等のバリアフリー情報がどれだけ登録されているかを可視化する。
 * 目的は登録状況を可視化し、データの充実（例: StepBy での点字情報追加）を促すこと。
 *
 * - 歩道（way）が0件のときは非表示（null）。歩道が1件以上あるときだけ出す。
 * - 集計対象は props.results 全体（フィルタ適用前）。
 * - 色は barrierFreeGeoJSON.js の TACTILE_LINE_COLORS を使い、凡例・地図と同色にする。
 */

// 延長の表示形式: lengthLabel（barrierFreeResults.js）と同じ流儀（整数 m）を踏襲しつつ、
// 1000 m 以上は km 換算で表示する。
function formatLength(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m)} m`
}

export default function BarrierFreeSummary({ results }) {
  const s = summarizeBarrierFree(results)
  if (s.ways === 0) return null

  const pctOfWays = (n) => (s.ways > 0 ? Math.round((n / s.ways) * 100) : 0)
  const registered = s.yes + s.no
  const registeredPct = pctOfWays(registered)
  const yesPct = pctOfWays(s.yes)
  const noPct = pctOfWays(s.no)
  const unknownPct = pctOfWays(s.unknown)
  const yesLenPct = s.totalLengthM > 0 ? Math.round((s.yesLengthM / s.totalLengthM) * 100) : 0

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5" aria-label="データの充実度">
      <div className="text-xs font-semibold text-slate-700">データの充実度（参考）</div>

      <p className="text-xs text-slate-700">
        歩道 {s.ways} 件のうち点字ブロック登録あり {registered} 件（{registeredPct}%）
      </p>

      {/* 積み上げ横バー: あり（緑）/ なし（赤）/ 未記録（濃いグレー）の幅比 */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`点字ブロックの内訳: あり ${s.yes} 件、なし ${s.no} 件、未記録 ${s.unknown} 件`}
      >
        {s.yes > 0 && (
          <div style={{ width: `${(s.yes / s.ways) * 100}%`, backgroundColor: TACTILE_LINE_COLORS.yes }} />
        )}
        {s.no > 0 && (
          <div style={{ width: `${(s.no / s.ways) * 100}%`, backgroundColor: TACTILE_LINE_COLORS.no }} />
        )}
        {s.unknown > 0 && (
          <div style={{ width: `${(s.unknown / s.ways) * 100}%`, backgroundColor: TACTILE_LINE_COLORS.unknown }} />
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        あり {s.yes} 件（{yesPct}%）・なし {s.no} 件（{noPct}%）・未記録 {s.unknown} 件（{unknownPct}%）
      </p>

      {s.totalLengthM > 0 && (
        <p className="text-[11px] text-slate-500">
          点字ブロックありの延長: 約{formatLength(s.yesLengthM)}（歩道全体の {yesLenPct}%）
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        音声・振動案内信号 {s.signals} 件・縁石 {s.kerbs} 件
      </p>

      <p className="text-[11px] text-slate-400">
        ※ この範囲で取得したデータだけの集計です。未記録でも実際には設置されている場合があります。
      </p>
    </div>
  )
}
