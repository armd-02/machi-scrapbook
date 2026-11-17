// @vitest-environment jsdom
/**
 * ヘッダーメニューからの全消去 → メモ帳タブが即座に0件表示になる（統合）
 *
 * ヘッダーのハンバーガーメニュー（AppHeader 内の HeaderMenu）で
 * まちメモ帳を全消去すると、メモ帳タブ（MemochoSection）のリストは
 * 即座に0件（空状態の案内文）になる。
 *
 * 両コンポーネントは useMemocho（モジュールレベルストア＋購読）を共用するため、
 * ヘッダー側での削除が他インスタンスに同期で反映される。このテストはその
 * 連携を固める（実行後に MemochoSection が空状態テキストを表示することを検証）。
 *
 * 対象は localStorage の machi-memocho-v1 キーのみ（他キーは不変）。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import AppHeader from '../AppHeader'
import MemochoSection from '../mobile/MemochoSection'
import { AppContext } from '../../context/AppContext'
import { createInitialState } from '../../state/appReducer'
import { MEMOCHO_STORAGE_KEY } from '../../utils/memocho'
import { resetMemochoStore } from '../../hooks/useMemocho'

// downloadCSV / downloadGeoJSON をモック（ファイル生成・アンカー操作を回避）
vi.mock('../../utils/export', () => ({
  downloadCSV: vi.fn(),
  downloadGeoJSON: vi.fn(),
}))

function seedMemocho() {
  localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
    {
      type: 'node', id: 1001, name: 'テスト珈琲店', lat: 34.85, lon: 135.5,
      tags: { name: 'テスト珈琲店', amenity: 'cafe' },
      memo: '', addedAt: '2026-01-01T00:00:00.000Z',
    },
  ]))
}

function renderShell() {
  return render(
    <AppContext.Provider value={{ state: createInitialState(), dispatch: vi.fn() }}>
      <div>
        <AppHeader onGoTop={vi.fn()} />
        <MemochoSection />
      </div>
    </AppContext.Provider>
  )
}

beforeEach(() => {
  localStorage.clear()
  resetMemochoStore()
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  resetMemochoStore()
})

describe('ヘッダーメニュー全消去 → メモ帳タブ即座に0件', () => {
  it('2段階確認で実行すると、MemochoSection が空状態を表示し localStorage も空になる', () => {
    seedMemocho()
    renderShell()

    // 初期: 登録1件がメモ帳リストに表示される
    expect(screen.getByText('テスト珈琲店')).toBeTruthy()

    // ヘッダーメニューを開き、2段階削除を実行
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' }))

    // メモ帳タブが即座に0件（空状態の案内文）になる
    expect(screen.getByText(/まだ登録がありません/)).toBeTruthy()
    expect(screen.queryByText('テスト珈琲店')).toBeNull()

    // localStorage の machi-memocho-v1 が空配列に
    expect(JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))).toEqual([])
  })

  it('他キーのローカルデータ（例: マップ高さ mapHeight.*）は消えない', () => {
    localStorage.setItem('mapHeight.resultsBf', '320')
    seedMemocho()
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /まちメモ帳をすべて削除/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' }))

    // まちメモ帳だけが消え、他キーはそのまま
    expect(JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))).toEqual([])
    expect(localStorage.getItem('mapHeight.resultsBf')).toBe('320')
  })
})
