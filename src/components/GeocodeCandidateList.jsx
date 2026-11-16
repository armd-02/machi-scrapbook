import React, { useId } from 'react'
import { geocodeCandidateLabel } from '../utils/geo'

/**
 * 地名ジオコードの候補リスト（共通コンポーネント）
 *
 * トップの地名入力サジェスト（入力中の候補）と、「検索する」押下時に
 * 候補が複数あったときの提示（「候補が複数あります。選んでください」）で
 * 共通に使う。各行は geocodeCandidateLabel のラベル形式
 * （「名称（都道府県市区町村）」）で表示され、タップで候補が選ばれる。
 *
 * @param {Array} candidates geocodeCandidates() の戻り値（候補の配列）。
 *   空配列・null のときは何も描画しない。
 * @param {(candidate: object) => void} [onSelect] 候補タップ時のコールバック。
 *   引数は候補オブジェクト（{ lat, lon, displayName, name, prefecture,
 *   city, type, boundingbox }）
 * @param {string | null} [heading] リスト上部の案内文
 *   （例: 「候補が複数あります。選んでください。」）。サジェスト時は null。
 * @param {boolean} [disabled] 検索中などで無効化
 */
export default function GeocodeCandidateList({
  candidates = [],
  onSelect = null,
  heading = null,
  disabled = false
}) {
  const uid = useId()
  const listId = `geocode-candidate-list-${uid}`

  if (!candidates || candidates.length === 0) return null

  return (
    <div>
      {heading && <p className="text-sm text-slate-600 mb-1">{heading}</p>}
      <ul
        id={listId}
        role="listbox"
        aria-label="地名の候補"
        className="bg-white border border-slate-300 rounded-lg shadow-sm py-1 max-h-60 overflow-auto"
      >
        {candidates.map((candidate, i) => (
          <li key={`${listId}-opt-${i}`}>
            <button
              type="button"
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={false}
              disabled={disabled}
              onClick={() => onSelect && onSelect(candidate)}
              className="w-full text-left min-h-[44px] px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {geocodeCandidateLabel(candidate)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
