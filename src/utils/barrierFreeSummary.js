/**
 * バリアフリー検索 — データの充実度集計
 *
 * バリアフリー検索の正規化済み結果（bf フィールド付き、toStandardResults の出力）から、
 * 点字ブロック等のバリアフリー情報がどれだけ登録されているかを集計する。
 * 目的は登録状況を可視化し、データの充実（例: StepBy での点字情報追加）を促すこと。
 *
 * 純粋関数で、フィルタ適用前の results 全体を対象に集計する。
 * 集計対象の仕分けは bf.kind（'way' / 'node'）で行う（barrierFreeGeoJSON.js と同じ）。
 * ノードの役割判定は barrierFreeGeoJSON.js の roleOf を再利用する。
 */

import { roleOf } from './barrierFreeGeoJSON'

/**
 * バリアフリー検索結果の「データの充実度」を集計する。
 *
 * @param {Array} results - toStandardResults の出力（bf フィールド付き結果の配列）
 * @returns {{
 *   ways:number, yes:number, no:number, unknown:number,
 *   totalLengthM:number, yesLengthM:number,
 *   signals:number, kerbs:number
 * }}
 *
 * - 歩道（bf.kind === 'way'）:
 *   - ways: 歩道の総数
 *   - yes: tactile === 'yes' の件数
 *   - no:  tactile === 'no' の件数
 *   - unknown: tactile が 'yes'/'no' 以外（null・未記録）の件数
 *   - totalLengthM: lengthM が数値の歩道の延長合計
 *   - yesLengthM: tactile === 'yes' かつ lengthM が数値の歩道の延長合計
 * - ノード（bf.kind === 'node'）の roleOf による内訳:
 *   - signals: role が 'signal' か 'kerb+signal' のノード数（音声・振動案内信号）
 *   - kerbs:   role が 'kerb' か 'kerb+signal' のノード数（縁石）
 *
 * results が空・null・undefined の場合は全て 0 を返す。
 */
export function summarizeBarrierFree(results) {
  const summary = {
    ways: 0, yes: 0, no: 0, unknown: 0,
    totalLengthM: 0, yesLengthM: 0,
    signals: 0, kerbs: 0
  }
  if (!Array.isArray(results)) return summary

  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const bf = r.bf || {}

    if (bf.kind === 'way') {
      summary.ways += 1
      if (bf.tactile === 'yes') {
        summary.yes += 1
        if (typeof bf.lengthM === 'number') summary.yesLengthM += bf.lengthM
      } else if (bf.tactile === 'no') {
        summary.no += 1
      } else {
        // 'yes'/'no' 以外（null・undefined・その他）は未記録扱い
        summary.unknown += 1
      }
      if (typeof bf.lengthM === 'number') summary.totalLengthM += bf.lengthM
    } else if (bf.kind === 'node') {
      const role = roleOf(r)
      if (role === 'signal' || role === 'kerb+signal') summary.signals += 1
      if (role === 'kerb' || role === 'kerb+signal') summary.kerbs += 1
    }
  }
  return summary
}
