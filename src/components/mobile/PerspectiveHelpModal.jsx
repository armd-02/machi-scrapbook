import React from 'react'

/**
 * 視点フィルタの説明モーダル
 *
 * 前半は素人向けの言葉で説明し、後半に「詳細」として判定に使う
 * OpenStreetMapのタグを書く。判定ロジックは utils/resultFilters.js の
 * matchesPerspective と一致させること。
 */
const SECTIONS = [
  {
    label: '車椅子',
    plain:
      '車椅子で利用できると登録されている場所です。車椅子対応の表示がある場所や、出入口・縁石の段差がない（または低い）場所が対象になります。',
    detail: 'wheelchair=yes / designated、縁石が kerb=flush / lowered、kerb:height が 0.03m（3cm）以下'
  },
  {
    label: '目の不自由な方',
    plain:
      '点字ブロックや、音・振動で知らせる信号など、目が見えにくい方の手がかりになる設備が登録されている場所です。',
    detail: 'tactile_paving=yes、点字ブロック tactile=yes、音声信号・振動信号の登録あり'
  },
  {
    label: '子ども連れ',
    plain: 'おむつ替え台や、子ども向けの設備が登録されている場所です。',
    detail: 'diaper の登録あり（no以外）、changing_table=yes、kids_area=yes、highchair=yes'
  },
  {
    label: 'お年寄り',
    plain:
      '移動の負担が少ないと登録されている場所です。車椅子対応の場所や、スロープ・エレベーターがある場所が対象になります。',
    detail: 'wheelchair=yes / designated、ramp=yes、ramp:wheelchair=yes、elevator=yes'
  }
]

export default function PerspectiveHelpModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="視点フィルタについて"
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
          <h2 className="text-base font-semibold text-slate-800 pr-10">視点フィルタについて</h2>
        </div>
        <div className="overflow-y-auto px-4 py-3 space-y-4 min-h-0">
          <p className="text-sm text-slate-700 leading-relaxed">
            選んだ視点の人にとって使いやすいと、OpenStreetMapに登録されている場所だけを表示します。登録がない場所は表示されません。まだ登録が少ない地域では、件数が少なくなることがあります。
          </p>
          {SECTIONS.map((s) => (
            <section key={s.label}>
              <h3 className="text-sm font-semibold text-slate-800">{s.label}</h3>
              <p className="text-sm text-slate-700 leading-relaxed mt-1">{s.plain}</p>
              <p className="text-xs text-slate-500 leading-relaxed mt-1 bg-slate-50 rounded-lg px-3 py-2">
                <span className="font-medium text-slate-600">詳細（判定に使うタグ）: </span>
                {s.detail}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
