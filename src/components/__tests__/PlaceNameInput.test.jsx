// @vitest-environment jsdom
/**
 * PlaceNameInput: 地名・駅名入力のテキストボックス（共通）。
 *
 * モバイルのトップ（QuickTopIntro）と地図タブの場所指定（MobileSearchTab の
 * formBody）で共用する。ジオコーディング問い合わせ中（geocoding）は、ボックスの
 * 内側右端に処理中スピナーを表示する。スピナーは pointer-events-none なので表示
 * 中も入力は妨げない。ボックス自体は無効化しない（disabled は施設検索中などの
 * 別用途のみ）。
 */
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import PlaceNameInput from '../PlaceNameInput'

afterEach(() => cleanup())

const PLACEHOLDER = '地名・駅名（例: 大阪駅）'

describe('PlaceNameInput', () => {
  it('既定では入力欄（地名・駅名のplaceholder）が表示され、スピナーはない', () => {
    render(<PlaceNameInput value="" onChange={() => {}} />)
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy()
    expect(screen.queryByTestId('place-input-spinner')).toBeNull()
  })

  it('geocoding=true で入力欄の内側右端にスピナーが表示される', () => {
    render(<PlaceNameInput value="梅田" onChange={() => {}} geocoding={true} />)
    expect(screen.getByTestId('place-input-spinner')).toBeTruthy()
  })

  it('geocoding=false ではスピナーが表示されない', () => {
    render(<PlaceNameInput value="梅田" onChange={() => {}} geocoding={false} />)
    expect(screen.queryByTestId('place-input-spinner')).toBeNull()
  })

  it('スピナー表示中も入力は無効化されない（disabled にならない・タイプできる）', () => {
    const onChange = vi.fn()
    render(<PlaceNameInput value="梅" onChange={onChange} geocoding={true} />)
    const input = screen.getByPlaceholderText(PLACEHOLDER)
    // 無効化されていない
    expect(input.disabled).toBe(false)
    // タイプできる（onChange が呼ばれる）
    fireEvent.change(input, { target: { value: '梅田' } })
    expect(onChange).toHaveBeenCalledWith('梅田')
  })

  it('スピナーは pointer-events-none で入力操作を妨げない', () => {
    const { container } = render(<PlaceNameInput value="梅田" onChange={() => {}} geocoding={true} />)
    const spinner = container.querySelector('[data-testid="place-input-spinner"]')
    expect(spinner).toBeTruthy()
    expect(spinner.className).toContain('pointer-events-none')
  })

  it('geocoding のとき右パディングが広くなる（pr-3 → pr-9 でスピナーのスペースを確保）', () => {
    const { rerender } = render(<PlaceNameInput value="梅田" onChange={() => {}} geocoding={false} />)
    let input = screen.getByPlaceholderText(PLACEHOLDER)
    expect(input.className).toContain('pr-3')
    rerender(<PlaceNameInput value="梅田" onChange={() => {}} geocoding={true} />)
    input = screen.getByPlaceholderText(PLACEHOLDER)
    expect(input.className).toContain('pr-9')
  })

  it('areaSet=true で緑系のスタイル（border-green-500 / bg-green-50）になる', () => {
    render(<PlaceNameInput value="梅田" onChange={() => {}} areaSet={true} />)
    const input = screen.getByPlaceholderText(PLACEHOLDER)
    expect(input.className).toContain('border-green-500')
    expect(input.className).toContain('bg-green-50')
  })

  it('onChange は値（event ではなく string）を受け取る', () => {
    const onChange = vi.fn()
    render(<PlaceNameInput value="" onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: '大阪駅' } })
    expect(onChange).toHaveBeenCalledWith('大阪駅')
  })

  it('id が渡されたときは入力欄に id が付く（label の htmlFor 連携）', () => {
    render(<PlaceNameInput id="quick-place-input" value="" onChange={() => {}} />)
    expect(document.getElementById('quick-place-input')).toBeTruthy()
  })

  describe('「現在地付近」ボタン（onCurrentLocation）', () => {
    it('onCurrentLocation を渡さないときはボタンは表示されない', () => {
      render(<PlaceNameInput value="" onChange={() => {}} />)
      expect(screen.queryByRole('button', { name: '現在地付近' })).toBeNull()
    })

    it('onCurrentLocation を渡すと「地名検索」ボタンの右にアイコンのみボタン（🎯）が表示される', () => {
      const { container } = render(
        <PlaceNameInput value="" onChange={() => {}} onGeocode={() => {}} onCurrentLocation={() => {}} />
      )
      const btn = screen.getByRole('button', { name: '現在地付近' })
      // アイコンのみ: テキストラベルなし（内容は🎯そのもの）
      expect(btn.textContent).toBe('🎯')
      expect(btn.getAttribute('aria-label')).toBe('現在地付近')
      expect(btn.getAttribute('title')).toBe('現在地付近')
      // 「地名検索」ボタンの隣（同一行）
      const geocodeBtn = screen.getByRole('button', { name: '地名検索' })
      expect(geocodeBtn.parentElement).toBe(btn.parentElement)
      // 入力行の右端（地名検索ボタンの後）
      const row = container.querySelector('.flex')
      const children = [...row.children]
      expect(children.indexOf(geocodeBtn)).toBeLessThan(children.indexOf(btn))
    })

    it('押下で onCurrentLocation が呼ばれる', () => {
      const onCurrentLocation = vi.fn()
      render(<PlaceNameInput value="" onChange={() => {}} onCurrentLocation={onCurrentLocation} />)
      fireEvent.click(screen.getByRole('button', { name: '現在地付近' }))
      expect(onCurrentLocation).toHaveBeenCalledTimes(1)
    })

    it('currentLocationBusy=true でボタンが無効化され、内容がスピナーに替わる', () => {
      const onCurrentLocation = vi.fn()
      render(
        <PlaceNameInput value="" onChange={() => {}} onCurrentLocation={onCurrentLocation} currentLocationBusy={true} />
      )
      const btn = screen.getByRole('button', { name: '現在地付近' })
      expect(btn.disabled).toBe(true)
      expect(btn.querySelector('.animate-spin')).toBeTruthy()
      expect(btn.textContent).toBe('')
      // 無効中は押下してもコールバックは呼ばれない
      fireEvent.click(btn)
      expect(onCurrentLocation).not.toHaveBeenCalled()
    })

    it('disabled=true（施設検索中等）でもボタンは無効化される', () => {
      render(<PlaceNameInput value="" onChange={() => {}} onCurrentLocation={() => {}} disabled={true} />)
      expect(screen.getByRole('button', { name: '現在地付近' }).disabled).toBe(true)
    })
  })
})
