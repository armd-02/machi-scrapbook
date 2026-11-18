// @vitest-environment jsdom
/**
 * (#76) AppHeader: モバイル・PC共通のヘッダー
 *
 * - アイコン＋タイトル（「まちのスクラップブック」）と、ハンバーガーメニュー
 *   （HeaderMenu: aria-label「メニュー」）が並ぶ
 * - タイトルボタン（aria-label「トップ画面に戻る」）を押すと onGoTop が呼ばれる
 * - ヘッダーは <header> 要素としてレンダリングされる（シェルテストが依存）
 */
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import AppHeader from '../AppHeader'
import { AppContext } from '../../context/AppContext'
import { createInitialState } from '../../state/appReducer'

function renderHeader(onGoTop = vi.fn()) {
  const view = render(
    <AppContext.Provider value={{ state: createInitialState(), dispatch: vi.fn() }}>
      <AppHeader onGoTop={onGoTop} />
    </AppContext.Provider>
  )
  return { view, onGoTop }
}

afterEach(() => cleanup())

describe('AppHeader', () => {
  it('タイトルとハンバーガーメニューが <header> 内に並ぶ', () => {
    const { view } = renderHeader()
    const header = view.container.querySelector('header')
    expect(header).toBeTruthy()
    // 見出し（h1）。ボタン内部のテキストで名前が確定しないため level で取得
    // （jest-dom 未導入のため toContainElement の代わりに DOM の contains）
    expect(header.contains(screen.getByRole('heading', { level: 1 }))).toBe(true)
    expect(screen.getByText('まちのスクラップブック')).toBeTruthy()
    expect(header.contains(screen.getByRole('button', { name: 'メニュー' }))).toBe(true)
  })

  it('タイトルボタンを押すと onGoTop が呼ばれる', () => {
    const { onGoTop } = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'トップ画面に戻る' }))
    expect(onGoTop).toHaveBeenCalledTimes(1)
  })
})
