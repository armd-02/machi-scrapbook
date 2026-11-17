// @vitest-environment jsdom
/**
 * (まちメモ帳 第3ピース) MemochoSection のテスト
 * - 0件のときは案内文が出る（#79 で☰メニューはヘッダーの HeaderMenu に
 *   統一されたため、セクション内にメニューボタン・ファイル入力は無い）
 * - localStorage の保存データが一覧に表示される（メモ欄の初期値含む）
 * - メモ欄: 未編集中は表示モード（改行保持・http(s):// URL リンク化、空メモは
 *   「メモを追加」の案内表示）、タップで編集モード（複数行 textarea・現在の値から
 *   開始・自動フォーカス）に切替し、フォーカスを外すと確定（setMemo）して表示モードに戻る
 * - 表示モード: リンクタップで詳細シートが開かない・編集モードに切替しない（stopPropagation）
 * - 星5つの評価行: タップで設定・現在の星で解除、状態は aria-pressed
 * - カードの✕で登録削除できる
 * - カードタップで onOpenDetail が呼ばれる
 * - 地図サムネイルの生成・表示
 *
 * 書き出し（JSON/CSV）・読み込み・全消去（2段階確認）のテストは、#79 で
 * ヘッダーメニューに集約されたため HeaderMenu.test.jsx へ移した。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import MemochoSection from '../MemochoSection'
import { resetMemochoStore } from '../../../hooks/useMemocho'
import { MEMOCHO_STORAGE_KEY } from '../../../utils/memocho'
import { captureMapImage } from '../../../utils/mapCapture'

vi.mock('../../../utils/mapCapture', () => ({
  captureMapImage: vi.fn(async () => 'data:image/jpeg;base64,QUJD'),
}))
const captureMapImageMock = captureMapImage

function makeItem(overrides = {}) {
  return {
    type: 'node',
    id: 1001,
    name: 'テスト珈琲店',
    lat: 34.85,
    lon: 135.5,
    tags: { name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee' },
    memo: '',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const PARK = {
  type: 'way',
  id: 77,
  name: 'みらい公園',
  lat: 34.8,
  lon: 135.5,
  tags: { name: 'みらい公園', leisure: 'park' },
  memo: '',
  addedAt: '2026-01-02T00:00:00.000Z',
}

function storedItems() {
  const raw = localStorage.getItem(MEMOCHO_STORAGE_KEY)
  return raw == null ? null : JSON.parse(raw)
}

function renderSection(overrides = {}) {
  const onOpenDetail = vi.fn()
  const view = render(<MemochoSection onOpenDetail={onOpenDetail} {...overrides} />)
  return { view, onOpenDetail }
}

beforeEach(() => {
  localStorage.clear()
  resetMemochoStore()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  resetMemochoStore()
  vi.restoreAllMocks()
})

describe('MemochoSection: 基本表示', () => {
  it('0件のときは件数「0件」と案内文が表示される', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'まちメモ帳' })).toBeTruthy()
    expect(screen.getByText('0件')).toBeTruthy()
    expect(screen.getByText(/まだ登録がありません/)).toBeTruthy()
    expect(screen.getByText(/メモ帳に追加/)).toBeTruthy()
    // (#79) 書き出し・読み込み・全消去はヘッダーのハンバーガーメニューに統一済み。
    // セクション内にメニューボタン・ファイル入力は存在しない
    expect(screen.queryByRole('button', { name: 'まちメモ帳メニュー' })).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('localStorage に保存済みのデータがあると一覧に表示される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeItem({ memo: '前回訪問済み' }),
      PARK,
    ]))
    renderSection()

    expect(screen.getByText('2件')).toBeTruthy()
    // MobileFacilityCard と同じ見た目: 施設名（h3）＋カテゴリラベル
    expect(screen.getByRole('heading', { name: 'テスト珈琲店' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'みらい公園' })).toBeTruthy()
    expect(screen.getByText('カフェ')).toBeTruthy()
    expect(screen.getByText('公園')).toBeTruthy()
    // メモ欄は未編集中なので表示モード: 保存済みメモはテキスト表示・空メモは案内表示
    expect(screen.getByLabelText('テスト珈琲店のメモ').textContent).toBe('前回訪問済み')
    expect(screen.getByLabelText('みらい公園のメモ').textContent).toBe('メモを追加')
  })

  it('カードタップで onOpenDetail（スナップショット＋origin "memocho"）が呼ばれる', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    const { onOpenDetail } = renderSection()

    fireEvent.click(screen.getByRole('heading', { name: 'テスト珈琲店' }))
    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'node', id: 1001, name: 'テスト珈琲店' }),
      'memocho'
    )
  })
})

describe('MemochoSection: メモ欄', () => {
  it('メモ表示をタップすると textarea が出て、編集後にフォーカスを外すと localStorage に保存される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    renderSection()

    // 最初は表示モード（メモが空なので「メモを追加」の案内）
    const display = screen.getByLabelText('テスト珈琲店のメモ')
    expect(display.tagName).toBe('DIV')

    // タップで編集モード（複数行 textarea）に切替・textarea は自動フォーカス
    fireEvent.click(display)
    const input = screen.getByLabelText('テスト珈琲店のメモ')
    expect(input.tagName).toBe('TEXTAREA')
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'Wi-Fiがあります' } })

    // 編集中は未保存（draft のみ）
    expect(storedItems()[0].memo).toBe('')

    fireEvent.blur(input)

    expect(storedItems()[0].memo).toBe('Wi-Fiがあります')
    // 表示モードに戻り、保存値がテキスト表示される
    const after = screen.getByLabelText('テスト珈琲店のメモ')
    expect(after.tagName).toBe('DIV')
    expect(after.textContent).toBe('Wi-Fiがあります')
  })

  it('編集モードに切替しても変更なしでフォーカスを外すと内容は変わらない', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem({ memo: '元のメモ' })]))
    renderSection()

    fireEvent.click(screen.getByLabelText('テスト珈琲店のメモ'))
    const input = screen.getByLabelText('テスト珈琲店のメモ')
    // 切替時は現在の値からドラフトが開始され、textarea は自動フォーカスされる
    expect(input.tagName).toBe('TEXTAREA')
    expect(input.value).toBe('元のメモ')
    expect(document.activeElement).toBe(input)

    fireEvent.blur(input)
    expect(storedItems()[0].memo).toBe('元のメモ')
    // 確定で表示モードへ戻る（表示⇄編集の往復）
    expect(screen.getByLabelText('テスト珈琲店のメモ').tagName).toBe('DIV')
  })

  it('編集モードでは複数行を入力でき、改行を保持したまま保存される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    renderSection()

    fireEvent.click(screen.getByLabelText('テスト珈琲店のメモ')) // 表示モード → 編集モード
    const input = screen.getByLabelText('テスト珈琲店のメモ')
    expect(input.tagName).toBe('TEXTAREA')

    fireEvent.change(input, { target: { value: '1行目\n2行目' } })
    fireEvent.blur(input)

    // 改行（\n）を含む文字列としてそのまま保存される
    expect(storedItems()[0].memo).toBe('1行目\n2行目')
    expect(screen.getByLabelText('テスト珈琲店のメモ').textContent).toBe('1行目\n2行目')
  })

  it('保存済みの複数行メモは改行を保持したまま表示モードで描画される（whitespace-pre-wrap）', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem({ memo: 'a\nb\nc' })]))
    renderSection()

    const field = screen.getByLabelText('テスト珈琲店のメモ')
    expect(field.tagName).toBe('DIV')
    expect(field.textContent).toBe('a\nb\nc')
    expect(field.className.includes('whitespace-pre-wrap')).toBe(true)
  })
})

describe('MemochoSection: メモ内の URL リンク（表示モード）', () => {
  it('http:// か https:// で始まる URL が target=_blank・rel=noopener のリンクになる', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeItem({ memo: 'ホーム https://example.com ページ' }),
    ]))
    renderSection()

    const link = screen.getByRole('link', { name: 'https://example.com' })
    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    // 周囲のテキストはそのまま描画され、リンクは表示モードの中にある
    const field = screen.getByLabelText('テスト珈琲店のメモ')
    expect(field.textContent).toBe('ホーム https://example.com ページ')
    expect(field.contains(link)).toBe(true)
  })

  it('リンクをタップしても施設詳細は開かず、編集モードにも切替しない（stopPropagation）', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeItem({ memo: '参照 https://example.com' }),
    ]))
    const { onOpenDetail } = renderSection()

    fireEvent.click(screen.getByRole('link', { name: 'https://example.com' }))

    expect(onOpenDetail).not.toHaveBeenCalled()
    // まだ表示モード（textarea は出ていない）
    expect(screen.getByLabelText('テスト珈琲店のメモ').tagName).toBe('DIV')
  })

  it('リンク以外のテキストをタップすると編集モード（textarea）に切替する', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeItem({ memo: 'ノート https://example.com' }),
    ]))
    renderSection()

    fireEvent.click(screen.getByLabelText('テスト珈琲店のメモ'))

    expect(screen.getByLabelText('テスト珈琲店のメモ').tagName).toBe('TEXTAREA')
  })

  it('URL を含む複数行メモは、表示モードで改行を保持したまま URL のみリンク化される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeItem({ memo: '1行目\n参照 https://example.com\n3行目' }),
    ]))
    renderSection()

    const field = screen.getByLabelText('テスト珈琲店のメモ')
    // 改行を含む全文がそのまま表示され、pre-wrap クラスが付いている
    expect(field.textContent).toBe('1行目\n参照 https://example.com\n3行目')
    expect(field.className.includes('whitespace-pre-wrap')).toBe(true)
    // URL 部分のみがリンクになり、表示モードの中にある
    const link = screen.getByRole('link', { name: 'https://example.com' })
    expect(field.contains(link)).toBe(true)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('スキーム無し（www. 等）のURLはリンク化されない', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeItem({ memo: 'www.example.com' }),
    ]))
    renderSection()

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByLabelText('テスト珈琲店のメモ').textContent).toBe('www.example.com')
  })
})

describe('MemochoSection: 評価（星5つ）', () => {
  const star = (i) => screen.getByRole('button', { name: `テスト珈琲店を${i}つ星で評価する` })

  it('メモ欄の上に星5つのボタン行があり、未評価なら全部 ☆・pressed なし', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()])) // rating 無し（旧データ含む）
    renderSection()

    const group = screen.getByRole('group', { name: 'テスト珈琲店の評価' })
    const buttons = [1, 2, 3, 4, 5].map(star)
    for (const b of buttons) {
      expect(group.contains(b)).toBe(true) // 評価行の中のボタン
      expect(b.textContent).toBe('☆')
      expect(b.getAttribute('aria-pressed')).toBe('false')
    }
    // メモ欄（input）より上（前に）にある
    const input = screen.getByLabelText('テスト珈琲店のメモ')
    expect(group.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('rating 3 のアイテムは ★3つ＋☆2つ、pressed は3番星だけ', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem({ rating: 3 })]))
    renderSection()

    expect(star(1).textContent).toBe('★')
    expect(star(2).textContent).toBe('★')
    expect(star(3).textContent).toBe('★')
    expect(star(4).textContent).toBe('☆')
    expect(star(5).textContent).toBe('☆')
    expect(star(1).getAttribute('aria-pressed')).toBe('false')
    expect(star(2).getAttribute('aria-pressed')).toBe('false')
    expect(star(3).getAttribute('aria-pressed')).toBe('true')
    expect(star(4).getAttribute('aria-pressed')).toBe('false')
    expect(star(5).getAttribute('aria-pressed')).toBe('false')
  })

  it('星をタップするとその値に設定され、表示と localStorage が更新される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()])) // rating 無し
    const { onOpenDetail } = renderSection()

    fireEvent.click(star(2))

    expect(storedItems()[0].rating).toBe(2)
    expect(star(1).textContent).toBe('★')
    expect(star(2).textContent).toBe('★')
    expect(star(3).textContent).toBe('☆')
    expect(star(2).getAttribute('aria-pressed')).toBe('true')
    expect(star(1).getAttribute('aria-pressed')).toBe('false')
    // 評価行のタップで詳細シートは開かない（クリック領域の外）
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('現在の値と同じ星をタップすると 0（未評価）に解除される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem({ rating: 3 })]))
    renderSection()

    fireEvent.click(star(3))

    expect(storedItems()[0].rating).toBe(0)
    for (const i of [1, 2, 3, 4, 5]) {
      expect(star(i).textContent).toBe('☆')
      expect(star(i).getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('複数アイテムではそれぞれのカードに独立した評価行がある', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      makeItem({ rating: 4 }),
      PARK, // rating 無し
    ]))
    renderSection()

    expect(screen.getByRole('button', { name: 'テスト珈琲店を4つ星で評価する' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'みらい公園を3つ星で評価する' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('group')).toHaveLength(2)
  })
})

describe('MemochoSection: 地図サムネイル', () => {
  it('mapImage のあるアイテムではカード上部に画像が出る', () => {
    const item = makeItem({ mapImage: 'data:image/jpeg;base64,QUJD' })
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([item]))
    renderSection()
    const img = document.querySelector('img[src="data:image/jpeg;base64,QUJD"]')
    expect(img).toBeTruthy()
  })

  it('地図をタップすると onOpenDetail が呼ばれる', () => {
    const item = makeItem({ mapImage: 'data:image/jpeg;base64,QUJD' })
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([item]))
    const { onOpenDetail } = renderSection()
    fireEvent.click(screen.getByRole('button', { name: /の詳細を表示/ }))
    expect(onOpenDetail).toHaveBeenCalledWith(item, 'memocho')
  })

  it('mapImage が無いアイテムでは生成して保存する', async () => {
    const item = makeItem({ id: 4242 })
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([item]))
    renderSection()
    await waitFor(() => {
      const stored = storedItems()
      expect(stored[0].mapImage).toBe('data:image/jpeg;base64,QUJD')
    })
    expect(captureMapImageMock).toHaveBeenCalledWith(34.85, 135.5)
  })
})

describe('MemochoSection: カードの✕で登録削除', () => {
  it('右上の✕を押すとその施設が削除され、0件表示になる', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    renderSection()
    expect(screen.getByText('テスト珈琲店')).toBeTruthy()
    // メモ帳内では「登録済み」トグルは出ない
    expect(screen.queryByRole('button', { name: /登録済み/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'テスト珈琲店をメモ帳から削除' }))
    expect(screen.getByText(/まだ登録がありません/)).toBeTruthy()
    expect(storedItems()).toEqual([])
  })
})
