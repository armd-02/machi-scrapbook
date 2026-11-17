// @vitest-environment jsdom
/**
 * (まちメモ帳 第3ピース) MemochoSection のテスト
 * - 0件のときの案内文
 * - localStorage の保存データが一覧に表示される（メモ欄の初期値含む）
 * - メモ欄を編集してフォーカスを外すと setMemo で保存される
 * - 読み込み: JSONファイルを渡すと合流し、追加/スキップ件数のメッセージが出る。
 *   不正なファイルではエラーメッセージが出て内容が変わらない
 * - すべて削除が2段階で動き、実行後は0件表示になる
 * - JSON書き出し: URL.createObjectURL をモックして呼び出しを確認
 * - カードタップで onOpenDetail が呼ばれる
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
  return { view, onOpenDetail, fileInput: () => view.container.querySelector('input[type="file"]') }
}

function jsonFile(text, name = 'machi-memocho.json') {
  return new File([text], name, { type: 'application/json' })
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
    // ☰ メニューボタン（aria-label「まちメモ帳メニュー」）が存在する
    expect(screen.getByRole('button', { name: 'まちメモ帳メニュー' })).toBeTruthy()
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
    // メモ欄の初期値は保存済みのメモ
    expect(screen.getByLabelText('テスト珈琲店のメモ').value).toBe('前回訪問済み')
    expect(screen.getByLabelText('みらい公園のメモ').value).toBe('')
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
  it('メモ欄を編集してフォーカスを外すと localStorage に保存される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    renderSection()

    const input = screen.getByLabelText('テスト珈琲店のメモ')
    fireEvent.change(input, { target: { value: 'Wi-Fiがあります' } })

    // 編集中は未保存（draft のみ）
    expect(storedItems()[0].memo).toBe('')

    fireEvent.blur(input)

    expect(storedItems()[0].memo).toBe('Wi-Fiがあります')
    // 入力欄の表示も保存値に追従する
    expect(screen.getByLabelText('テスト珈琲店のメモ').value).toBe('Wi-Fiがあります')
  })

  it('変更なしでフォーカスを外しても内容は変わらない', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem({ memo: '元のメモ' })]))
    renderSection()

    fireEvent.blur(screen.getByLabelText('テスト珈琲店のメモ'))
    expect(storedItems()[0].memo).toBe('元のメモ')
  })
})

describe('MemochoSection: 読み込み', () => {
  it('JSONファイルを渡すと合流し、追加/スキップ件数のメッセージが出る', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem({ memo: '既存メモ' })]))
    const { view, fileInput } = renderSection()

    const imported = JSON.stringify({
      app: 'machi-memocho',
      version: 1,
      items: [
        makeItem({ memo: '取り込みメモ' }), // キー重複 → スキップ（既存優先）
        PARK, // 新規 → 追加
      ],
    })
    fireEvent.change(fileInput(), { target: { files: [jsonFile(imported)] } })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('1件を取り込みました（1件は登録済みのためスキップ）')
    }, { timeout: 5000 })

    // 一覧に新着施設が表示され、件数も更新される
    expect(screen.getByText('2件')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'みらい公園' })).toBeTruthy()

    // 既存が優先される（既存メモが上書きされない）
    const stored = storedItems()
    expect(stored).toHaveLength(2)
    expect(stored[0].memo).toBe('既存メモ')
    expect(stored[1].name).toBe('みらい公園')
  })

  it('すべてが重複の場合は「新しい項目はありません」メッセージが出る', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    const { fileInput } = renderSection()

    fireEvent.change(fileInput(), {
      target: { files: [jsonFile(JSON.stringify({ app: 'machi-memocho', version: 1, items: [makeItem()] }))] },
    })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('新しい項目はありません（1件は登録済みのためスキップ）')
    }, { timeout: 5000 })
    // 内容が変わらない
    expect(storedItems()).toEqual([makeItem()])
  })

  it('JSONでないファイルではエラーメッセージが出て内容が変わらない', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    const { fileInput } = renderSection()

    fireEvent.change(fileInput(), { target: { files: [jsonFile('これはJSONではありません')] } })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('読み込みに失敗しました')
    }, { timeout: 5000 })
    expect(screen.getByRole('status').textContent).toContain('無効な JSON')
    // 内容が変わらない
    expect(storedItems()).toEqual([makeItem()])
    expect(screen.getByText('1件')).toBeTruthy()
  })

  it('形式が一致しないファイル（app が違う）でもエラーで内容が変わらない', async () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    const { fileInput } = renderSection()

    fireEvent.change(fileInput(), {
      target: { files: [jsonFile(JSON.stringify({ app: 'other-app', version: 1, items: [makeItem()] }))] },
    })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('読み込みに失敗しました')
    }, { timeout: 5000 })
    expect(storedItems()).toEqual([makeItem()])
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

describe('MemochoSection: すべて削除（2段階）', () => {
  it('1回目で確認表示に切り替わり、2回目の押下で実行される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem(), PARK]))
    renderSection()
    expect(screen.getByText('2件')).toBeTruthy()

    // ☰ でメニューを開く
    fireEvent.click(screen.getByRole('button', { name: 'まちメモ帳メニュー' }))
    expect(screen.getByRole('menuitem', { name: 'すべて削除' })).toBeTruthy()

    // 1回目の押下: 表示が確認メッセージに切り替わるだけ（内容不変）
    fireEvent.click(screen.getByRole('menuitem', { name: 'すべて削除' }))
    expect(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'すべて削除' })).toBeNull()
    expect(storedItems()).toHaveLength(2)
    expect(screen.getByText('2件')).toBeTruthy()

    // 2回目の押下: 実行されて0件になる
    fireEvent.click(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' }))
    expect(screen.getByText('0件')).toBeTruthy()
    expect(storedItems()).toEqual([])
    expect(screen.getByRole('status').textContent).toContain('すべて削除しました')
    // 実行後はメニューが閉じる（確認状態もリセット）
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('window.confirm を使っていない（confirm のスピアは呼ばれない）', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'まちメモ帳メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'すべて削除' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '本当にすべて削除しますか？' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(storedItems()).toEqual([])
  })
})

describe('MemochoSection: 書き出し', () => {
  it('JSONで書き出し: URL.createObjectURL が呼ばれ、Blob は serializeMemocho の内容', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'まちメモ帳メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSONで書き出し' }))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(JSON.parse(await blob.text())).toEqual({
      app: 'machi-memocho',
      version: 1,
      items: [makeItem()],
    })
    expect(screen.getByRole('status').textContent).toContain('JSONとして書き出しました')
  })

  it('CSVで書き出し: 末尾に memo 列が付いたCSVになる（通常 toCSV と列構成の違い）', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem({ memo: 'メモ内容' })]))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'まちメモ帳メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSVで書き出し' }))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const csv = (await URL.createObjectURL.mock.calls[0][0].text())
    const lines = csv.replace(/^\uFEFF/, '').split('\n')
    const headers = lines[0].split(',')
    expect(headers[headers.length - 1]).toBe('memo') // memo 列は末尾
    const row = lines[1].split(',')
    expect(row[headers.length - 1]).toBe('メモ内容')
    expect(screen.getByRole('status').textContent).toContain('CSVとして書き出しました')
  })
})
