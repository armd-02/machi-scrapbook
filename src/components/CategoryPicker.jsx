import React, { useState } from 'react'
import { CATEGORY_GROUPS, getCategoriesForPurpose, getCategoryById, getPurposeOfCategory } from '../data/categories'

// 目的グループの表示順は CATEGORY_GROUPS の定義順そのままを使う: 「すること」系
// （食べる・買う・遊ぶ・公園・学ぶ）→「生活の施設」系（病院・薬局・役所・手続き・
// 公共施設・会社・事務所・移動・交通）。モバイルクイックトップ（QUICK_TILES）と
// 同一のグループ分け・順序（単一データソース）。
// チップグリッドに載せるグループ（バリアフリーは除外して特別枠で表示）
const GRID_GROUPS = CATEGORY_GROUPS.filter((g) => g.name !== 'バリアフリー')

// バリアフリーグループ（グリッドの下に横長特別枠として表示）
const BARRIER_FREE_GROUP = CATEGORY_GROUPS.find((g) => g.name === 'バリアフリー') || null

/**
 * (#44 生活者目線UI) カテゴリピッカー
 *
 * variant='pc'    : 従来どおりのグループ付き <select>（PC検索パネル用）
 * variant='mobile': 目的ベースのアイコンチップ。「すること」系→「生活の施設」系の順で表示
 *                  （食べる／買う／遊ぶ・公園／学ぶ → 病院・薬局／役所・手続き／公共施設／
 *                  会社・事務所／移動・交通）。
 *                  バリアフリーは場所の種類ではなく見方のモードなので、グリッドの下に
 *                  横長（全幅）1行の特別枠として分離表示する。
 *                  → タップするとその目的の具体カテゴリチップが展開する
 *                  （段階的開示 = progressive disclosure）
 */

/**
 * onPurposeChange: 目的チップのタップを検索スコープとして親に報告する（#44）
 *  - 目的チップを開く: onPurposeChange(目的名) → 「その目的の施設種類」に絞って検索可能
 *  - 目的チップを閉じる・カテゴリチップ選択・解除: onPurposeChange(null) → 目的スコープ解除
 *  （カテゴリが選択中はカテゴリが優先され、目的スコープはセットされない）
 */
export default function CategoryPicker({ value, onChange, onPurposeChange, variant = 'pc' }) {
  if (variant === 'pc') {
    return <PcSelect value={value} onChange={onChange} />
  }
  return <MobileChips value={value} onChange={onChange} onPurposeChange={onPurposeChange} />
}

// ===== PC: グループ付きセレクト =====

function PcSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
    >
      <option value="">選択してください（任意）</option>
      {CATEGORY_GROUPS.map((g) => (
        <optgroup key={g.name} label={`${g.icon} ${g.name}`}>
          {getCategoriesForPurpose(g.name).map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

// ===== モバイル: 目的アイコンチップ + 段階的開示 =====

function MobileChips({ value, onChange, onPurposeChange = () => {} }) {
  const [openPurpose, setOpenPurpose] = useState(null)

  const selectedCat = value ? getCategoryById(value) : null
  const openCategories = openPurpose ? getCategoriesForPurpose(openPurpose) : []

  const purposeOf = (id) => getPurposeOfCategory(id)
  const iconOf = (id) => {
    const g = CATEGORY_GROUPS.find((g) => g.name === purposeOf(id))
    return g ? g.icon : ''
  }

  const tapPurpose = (name) => {
    // (#44) 目的チップのタップは「その目的の施設種類に絞る」検索スコープ
    if (openPurpose === name) {
      // 再タップで閉じる: 目的スコープを解除
      onPurposeChange(null)
      setOpenPurpose(null)
      return
    }
    if (selectedCat) {
      if (purposeOf(selectedCat.id) === name) {
        // 同じ目的のカテゴリが選択中: カテゴリが優先されるためスコープはセットしない
        // （旧選択のクリアもせず、リストの閲覧用のみ開く）
        setOpenPurpose(name)
        return
      }
      // 異なる目的: 旧選択をクリア（stale条件の防止）＋新しい目的スコープをセット
      onChange('')
      onPurposeChange(name)
    } else {
      onPurposeChange(name)
    }
    setOpenPurpose(name)
  }

  const tapCategory = (catId) => {
    if (value === catId) {
      onChange('') // 再タップで選択解除
      onPurposeChange(null)
      setOpenPurpose(null)
      return
    }
    onChange(catId)
    onPurposeChange(null) // カテゴリが選択されれば目的スコープは不要
    setOpenPurpose(null)
  }

  return (
    <div>
      {/* 目的チップ: CATEGORY_GROUPS の定義順（バリアフリーは除外） */}
      <div className="grid grid-cols-3 gap-1.5">
        {GRID_GROUPS.map((g) => {
          const isSel = selectedCat && purposeOf(selectedCat.id) === g.name
          const isOpen = openPurpose === g.name
          return (
            <button
              key={g.name}
              type="button"
              onClick={() => tapPurpose(g.name)}
              aria-expanded={isOpen}
              aria-pressed={!!isSel}
              className={`min-h-[48px] rounded-xl border px-1 py-1.5 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isSel
                  ? 'bg-primary-50 border-primary-400 text-primary-700'
                  : isOpen
                    ? 'bg-primary-50 border-primary-300'
                    : 'bg-white border-slate-200 text-slate-600 active:bg-slate-50'
              }`}
            >
              <span className="text-lg leading-none" aria-hidden="true">{g.icon}</span>
              <span className="text-xs font-medium">{g.name}</span>
            </button>
          )
        })}
      </div>

      {/* バリアフリー: 場所の種類ではなく見方のモードなので、目的チップと
          同格に並べず、グリッドの下に横長（全幅）1行の特別枠として分離表示。
          挙動は目的チップと同じ（タップで目的スコープ設定＋カテゴリ展開） */}
      {BARRIER_FREE_GROUP && (
        <button
          type="button"
          onClick={() => tapPurpose(BARRIER_FREE_GROUP.name)}
          aria-expanded={openPurpose === BARRIER_FREE_GROUP.name}
          aria-pressed={!!(selectedCat && purposeOf(selectedCat.id) === BARRIER_FREE_GROUP.name)}
          className={`w-full mt-1.5 min-h-[48px] rounded-xl border flex flex-row items-center justify-center gap-1.5 px-2 text-sm font-medium transition-colors ${
            selectedCat && purposeOf(selectedCat.id) === BARRIER_FREE_GROUP.name
              ? 'bg-primary-50 border-primary-400 text-primary-700'
              : openPurpose === BARRIER_FREE_GROUP.name
                ? 'bg-primary-50 border-primary-300'
                : 'bg-white border-slate-200 text-slate-600 active:bg-slate-50'
          }`}
        >
          <span className="text-lg leading-none" aria-hidden="true">{BARRIER_FREE_GROUP.icon}</span>
          <span>{BARRIER_FREE_GROUP.name}</span>
        </button>
      )}

      {/* 展開された具体カテゴリチップ */}
      {openPurpose && openCategories.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {openCategories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => tapCategory(cat.id)}
              aria-pressed={value === cat.id}
              className={`min-h-[44px] rounded-full border px-3 text-sm transition-colors ${
                value === cat.id
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 active:bg-slate-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* 選択中カテゴリの表示・解除 */}
      {selectedCat && (
        <div className="mt-1.5 flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-lg px-2.5 py-1.5">
          <span className="text-sm text-primary-800">
            {iconOf(selectedCat.id)} {selectedCat.label}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange('')
              onPurposeChange(null)
            }}
            className="ml-auto text-xs text-primary-700 underline min-h-[24px] px-1"
          >
            解除
          </button>
        </div>
      )}
    </div>
  )
}
