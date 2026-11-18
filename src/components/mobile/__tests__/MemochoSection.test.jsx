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
 * - カードの✕は2段階確認＋論理削除（deletedAt 付けてごみ箱へ移動）
 * - ごみ箱ビュー（view='trash'）: 削除日時・復元・完全に削除（2段階確認）・
 *   ごみ箱を空にする（2段階確認）・一覧に戻る
 * - カード内の「🔎詳細」ボタン押下で onOpenDetail が呼ばれる（カード本体タップでは開かない）
 * - 地図サムネイルの生成・表示
 *
 * 書き出し（JSON/CSV）・読み込み・全消去（2段階確認）のテストは、#79 で
 * ヘッダーメニューに集約されたため HeaderMenu.test.jsx へ移した。
 *
 * - フィルタバー（まちメモ帳絞り込み）: 見出しの下にキーワード入力とチップ行を
 *   置き、5条件（すべて AND 結合）で絞り込む。キーワード＝名前＋メモ本文の
 *   部分一致（大小文字無視）、WiFi有無＝internet_access（あり＝設定されていて
 *   'no' でない／なし＝それ以外・未設定を含む）、車椅子対応＝wheelchair 値の
 *   完全一致（対応可=yes／一部対応=limited／対応なし=no）、料理の種別＝
 *   tags.cuisine 集計チップ（再クリックで解除・一覧側と同一の部分一致・';'区切り
 *   処理）、★評価＝rating ベース（★N以上＝rating >= N、★5のみ＝rating === 5）。
 *   状態はメモ帳ローカル（resultFilters とは無関係、アンマウントで初期化・
 *   保存データに影響しない）。絞り込み中は件数が「全M件中、N件を表示」になり、
 *   「フィルタをクリア」ボタンで全条件を一括解除できる。絞り込みで0件なら
 *   リセット案内が出る
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
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

  it('カード本体タップでは onOpenDetail は呼ばれない（詳細は開かない）', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    const { onOpenDetail } = renderSection()

    fireEvent.click(screen.getByRole('heading', { name: 'テスト珈琲店' }))
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('「🔎詳細」ボタン押下で onOpenDetail（スナップショット＋origin "memocho"）が呼ばれる', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    const { onOpenDetail } = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'テスト珈琲店の詳細' }))
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
    // (絞り込み) フィルタバーにも role="group" があるため、評価行は
    // aria-label（「…の評価」）でスコープを絞って数える
    expect(screen.getAllByRole('group', { name: /の評価$/ })).toHaveLength(2)
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

describe('MemochoSection: カードの✕（2段階確認・論理削除）', () => {
  it('1回目で確認帯が出て、2回目で実行しごみ箱へ移動する（通常一覧は0件）', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    renderSection()
    expect(screen.getByText('テスト珈琲店')).toBeTruthy()
    // メモ帳内では「登録済み」トグルは出ない
    expect(screen.queryByRole('button', { name: /登録済み/ })).toBeNull()

    // 1回目の✕タップ: 確認帯のみ表示。ストアは変わらない
    fireEvent.click(screen.getByRole('button', { name: 'テスト珈琲店をメモ帳から削除' }))
    expect(screen.getByText(/削除しますか？/)).toBeTruthy()
    expect(screen.getByText(/ごみ箱へ移動します/)).toBeTruthy()
    expect(screen.getByText('テスト珈琲店')).toBeTruthy()
    expect(storedItems()).toHaveLength(1)
    expect(storedItems()[0].deletedAt).toBeUndefined()

    // 2回目（削除ボタン）: 論理削除。通常一覧は0件だがストアには残り続ける
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(screen.getByText(/まだ登録がありません/)).toBeTruthy()
    const stored = storedItems()
    expect(stored).toHaveLength(1)
    expect(stored[0].deletedAt).toBeTruthy()
  })

  it('キャンセルすると確認帯が消え、アイテムは変更されない', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([makeItem()]))
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'テスト珈琲店をメモ帳から削除' }))
    expect(screen.getByText(/削除しますか？/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByText(/削除しますか？/)).toBeNull()
    expect(screen.getByText('テスト珈琲店')).toBeTruthy()
    const stored = storedItems()
    expect(stored).toHaveLength(1)
    expect(stored[0].deletedAt).toBeUndefined()
  })
})

describe('MemochoSection: ごみ箱ビュー', () => {
  const TRASH_ITEM = () => makeItem({ deletedAt: '2026-06-15T10:30:00.000Z' })

  it('view="trash" では削除アイテムを「名前＋削除日時」で表示し、操作ボタンが出る', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([TRASH_ITEM()]))
    renderSection({ view: 'trash', onViewChange: vi.fn() })

    expect(screen.getByRole('heading', { name: 'ごみ箱' })).toBeTruthy()
    expect(screen.getByText('テスト珈琲店')).toBeTruthy()
    expect(screen.getByText(/6月15日/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '復元' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '完全に削除' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ごみ箱を空にする' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'まちメモ帳へ' })).toBeTruthy()
  })

  it('復元: deletedAt が除去され、ごみ箱から消えてフィードバックが出る', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([TRASH_ITEM()]))
    renderSection({ view: 'trash' })

    fireEvent.click(screen.getByRole('button', { name: '復元' }))
    expect(screen.getByText(/復元しました/)).toBeTruthy()
    const stored = storedItems()
    expect(stored).toHaveLength(1)
    expect(stored[0].deletedAt).toBeUndefined()
    // ごみ箱の一覧から消える（正確な名称一致。フィードバックは「…を復元しました」）
    expect(screen.queryByText('テスト珈琲店')).toBeNull()
  })

  it('完全に削除: 1回目で確認が出て、2回目でストアから完全に取り除かれる', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([TRASH_ITEM()]))
    renderSection({ view: 'trash' })

    fireEvent.click(screen.getByRole('button', { name: '完全に削除' }))
    expect(screen.getByText(/完全に削除しますか？/)).toBeTruthy()
    expect(screen.getByText(/取り消せません/)).toBeTruthy()
    // まだストアに残っている
    expect(storedItems()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(screen.getByText(/完全に削除しました/)).toBeTruthy()
    expect(storedItems()).toEqual([])
  })

  it('ごみ箱を空にする（2段階）: 2回目で全件が完全削除される', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      TRASH_ITEM(),
      makeItem({ id: 77, name: 'みらい公園', tags: { name: 'みらい公園', leisure: 'park' }, deletedAt: '2026-06-16T08:00:00.000Z' }),
    ]))
    renderSection({ view: 'trash' })
    expect(screen.getByText('2件')).toBeTruthy()

    // 1回目: 確認表示に切り替わる
    fireEvent.click(screen.getByRole('button', { name: 'ごみ箱を空にする' }))
    expect(screen.getByRole('button', { name: '本当に空にしますか？' })).toBeTruthy()

    // 2回目: 実行
    fireEvent.click(screen.getByRole('button', { name: '本当に空にしますか？' }))
    expect(screen.getByText(/ごみ箱を空にしました/)).toBeTruthy()
    expect(storedItems()).toEqual([])
    expect(screen.getByText(/ごみ箱は空です/)).toBeTruthy()
  })

  it('「まちメモ帳へ」で onViewChange("list") が呼ばれる', () => {
    const onViewChange = vi.fn()
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([TRASH_ITEM()]))
    renderSection({ view: 'trash', onViewChange })

    fireEvent.click(screen.getByRole('button', { name: 'まちメモ帳へ' }))
    expect(onViewChange).toHaveBeenCalledWith('list')
  })
})

// ===== フィルタバー（まちメモ帳絞り込み） =====
//
// フィクスチャ: internet_access / wheelchair / cuisine / rating / メモ本文の
// 組み合わせで、5条件の各フィルタ判定と AND 適用を検証する5件＋公園1件:
// - WiFi (internet_access): A=wireless / B=no / C=proprietary / E=wired / D=未設定 / 公園=未設定
//   ※ 共通フィルタバー統一後は3状態判定（wifiStatus）: wireless/proprietary/wired='yes'、
//     no='no'、未設定='unknown'（「WiFiなし」に含めない）
// - 車椅子 (wheelchair):    A=yes / C=limited / D=no / 他は未設定
// - 評価 (rating):          A=4 / B=2 / C=3 / E=0 / D=5 / 公園=未設定（0として扱う）
// - メモ本文:               A=「静かでWiFiが速い」/ C=「こしょうが効いている」/ 他は空
const CAFE_WIFI = makeItem({
  id: 2001, name: 'カフェA', memo: '静かでWiFiが速い', rating: 4,
  tags: { name: 'カフェA', amenity: 'cafe', cuisine: 'coffee', internet_access: 'wireless', wheelchair: 'yes' },
})
const CAFE_NO_WIFI = makeItem({
  id: 2002, name: 'カフェB', rating: 2,
  tags: { name: 'カフェB', amenity: 'cafe', cuisine: 'coffee', internet_access: 'no' },
})
const RAMEN_PROP = makeItem({
  id: 2003, name: 'ラーメンC', memo: 'こしょうが効いている', rating: 3,
  tags: { name: 'ラーメンC', amenity: 'restaurant', cuisine: 'ramen', internet_access: 'proprietary', wheelchair: 'limited' },
})
const RAMEN_WIRED = makeItem({
  id: 2004, name: 'ラーメンE', rating: 0,
  tags: { name: 'ラーメンE', amenity: 'restaurant', cuisine: 'ramen', internet_access: 'wired' },
})
const SUSHI_NONE = makeItem({
  id: 2005, name: '寿司D', rating: 5,
  tags: { name: '寿司D', amenity: 'restaurant', cuisine: 'sushi', wheelchair: 'no' },
})
const FILTER_ITEMS = [CAFE_WIFI, CAFE_NO_WIFI, RAMEN_PROP, RAMEN_WIRED, SUSHI_NONE, PARK]

const wifiGroup = () => screen.getByRole('group', { name: 'WiFi有無で絞る' })
const wcGroup = () => screen.getByRole('group', { name: '車椅子対応で絞る' })
const ratingGroup = () => screen.getByRole('group', { name: '評価で絞る' })
const cuisineGroup = () => screen.queryByRole('group', { name: '料理ジャンル' })
// 折りたたみ見出し行（「料理ジャンル」＋開閉トグル）。選択中ラベル有無の両方で一致する。
const cuisineHeader = () => screen.queryByRole('button', { name: /料理ジャンル/ })
const keywordInput = () => screen.getByRole('textbox', { name: '名前・メモで絞り込む' })

function seedFilterItems() {
  localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify(FILTER_ITEMS))
}

describe('MemochoSection: フィルタバー', () => {
  it('アイテムがあるときフィルタバーが出て、最初はすべて「すべて」が選択', () => {
    seedFilterItems()
    renderSection()

    // キーワード入力＋3つのチップ行＋料理ジャンル行（cuisine タグを持つアイテムがあるため出る）
    expect(keywordInput()).toBeTruthy()
    expect(wifiGroup()).toBeTruthy()
    expect(wcGroup()).toBeTruthy()
    expect(ratingGroup()).toBeTruthy()
    // 料理ジャンル行は折りたたみ式: 初期は見出し行のみ表示・チップ群は非表示
    expect(cuisineHeader()).toBeTruthy()
    expect(cuisineGroup()).toBeNull()

    // WiFi行: すべて が pressed・他は未選択
    expect(within(wifiGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(wifiGroup()).getByRole('button', { name: 'WiFiあり' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(wifiGroup()).getByRole('button', { name: 'WiFiなし' }).getAttribute('aria-pressed')).toBe('false')
    // 車椅子行: すべて が pressed・他は未選択
    expect(within(wcGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    for (const name of ['対応可', '一部対応', '対応なし']) {
      expect(within(wcGroup()).getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false')
    }
    // 評価行: すべて が pressed・他は未選択
    expect(within(ratingGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    for (const name of ['★1以上', '★2以上', '★3以上', '★4以上', '★5のみ']) {
      expect(within(ratingGroup()).getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false')
    }
    // 料理行: 見出し行から展開すると、アイテムの tags.cuisine を集計したチップ（件数付き）・未選択
    // coffee は CUISINE_LABELS に載っていないため、仕様どおり生の値で表示される
    fireEvent.click(cuisineHeader())
    expect(within(cuisineGroup()).getByRole('button', { name: 'coffee（2件）' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(cuisineGroup()).getByRole('button', { name: '寿司（1件）' }).getAttribute('aria-pressed')).toBe('false')

    // フィルタ未適用: 全6件表示・件数は「6件」・クリアボタンは非表示
    expect(screen.getByText('6件')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'フィルタをクリア' })).toBeNull()
    for (const name of ['カフェA', 'カフェB', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
  })

  it('全フィルタ行に「アイコン＋見出し」が付く（id 27 統一。車椅子=♿・WiFi=📶・評価=★）', () => {
    seedFilterItems()
    renderSection()

    // 車椅子行: 見出しにアイコン(♿)＋文言「車椅子」
    expect(wcGroup().previousElementSibling.textContent).toContain('車椅子')
    expect(wcGroup().previousElementSibling.textContent).toContain('♿')
    // 統一見出しスタイル（text-sm font-medium text-slate-700・min-h-[44px]）
    expect(wcGroup().previousElementSibling.className).toContain('text-sm font-medium text-slate-700')
    expect(wcGroup().previousElementSibling.className).toContain('min-h-[44px]')

    // WiFi 行にも見出し（📶 Wi-Fi）が出る
    expect(wifiGroup().previousElementSibling.textContent).toContain('Wi-Fi')
    expect(wifiGroup().previousElementSibling.textContent).toContain('📶')
    // 評価行にも見出し（★ 評価）が出る
    expect(ratingGroup().previousElementSibling.textContent).toContain('評価')
    expect(ratingGroup().previousElementSibling.textContent).toContain('★')
  })

  it('視点行に「👁️ 視点」の可視見出しが出る（id 27 統一アイコン＋見出し）', () => {
    seedFilterItems()
    renderSection()

    const perspective = screen.getByRole('group', { name: '視点で絞る' })
    // チップ群の直前に可視見出し（アイコン👁️＋文言「視点」）が出る
    const heading = perspective.previousElementSibling
    expect(heading.textContent).toContain('視点')
    expect(heading.textContent).toContain('👁️')
    // 統一見出しスタイル（text-sm font-medium text-slate-700・min-h-[44px]）
    expect(heading.className).toContain('text-sm font-medium text-slate-700')
    expect(heading.className).toContain('min-h-[44px]')
  })

  it('id 27: 入力・セレクト系行（キーワード🔍/カテゴリ📁/未登録⚠️）にもアイコン＋見出しが付く', () => {
    seedFilterItems()
    renderSection()

    // キーワード（🔍）: 入力欄の上にアイコン＋見出し
    const kwInput = screen.getByRole('textbox', { name: '名前・メモで絞り込む' })
    const kwHeading = kwInput.previousElementSibling
    expect(kwHeading.textContent).toContain('🔍')
    expect(kwHeading.textContent).toContain('キーワード')
    expect(kwHeading.className).toContain('min-h-[44px]')

    // カテゴリ（📁）
    const catSelect = screen.getByRole('combobox', { name: 'カテゴリで絞り込む' })
    const catHeading = catSelect.previousElementSibling
    expect(catHeading.textContent).toContain('📁')
    expect(catHeading.textContent).toContain('カテゴリ')

    // 未登録（⚠️）
    const missingSelect = screen.getByRole('combobox', { name: '属性の欠落で絞る' })
    const missingHeading = missingSelect.previousElementSibling
    expect(missingHeading.textContent).toContain('⚠️')
    expect(missingHeading.textContent).toContain('未登録')
  })

  it('WiFiあり: internet_access が設定されていて "no" でないものだけ残る', () => {
    seedFilterItems()
    renderSection()

    fireEvent.click(within(wifiGroup()).getByRole('button', { name: 'WiFiあり' }))

    for (const name of ['カフェA', 'ラーメンC', 'ラーメンE']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    // "no"（B）・未設定（D・公園）は残らない
    for (const name of ['カフェB', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、3件を表示')).toBeTruthy()
  })

  it('WiFiなし: internet_access が "no" のものだけ残る（未登録は「なし」に含まない）', () => {
    seedFilterItems()
    renderSection()

    fireEvent.click(within(wifiGroup()).getByRole('button', { name: 'WiFiなし' }))

    // 'no'（B）だけ残る。未登録（D・公園）は「なし」にも「あり」にも含めない
    expect(screen.getByRole('heading', { name: 'カフェB' })).toBeTruthy()
    for (const name of ['カフェA', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()
  })

  it('車椅子対応: wheelchair 値の完全一致（対応可=yes / 一部対応=limited / 対応なし=no）', () => {
    seedFilterItems()
    renderSection()

    fireEvent.click(within(wcGroup()).getByRole('button', { name: '対応可' }))
    expect(screen.getByRole('heading', { name: 'カフェA' })).toBeTruthy()
    for (const name of ['カフェB', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()

    fireEvent.click(within(wcGroup()).getByRole('button', { name: '一部対応' }))
    expect(screen.getByRole('heading', { name: 'ラーメンC' })).toBeTruthy()
    for (const name of ['カフェA', 'カフェB', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()

    fireEvent.click(within(wcGroup()).getByRole('button', { name: '対応なし' }))
    expect(screen.getByRole('heading', { name: '寿司D' })).toBeTruthy()
    for (const name of ['カフェA', 'カフェB', 'ラーメンC', 'ラーメンE', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()
  })

  it('料理の種別: チップをタップでそのジャンルを含むアイテムだけ残り、同じチップをもう一度タップすると解除される', () => {
    seedFilterItems()
    renderSection()

    fireEvent.click(cuisineHeader())
    fireEvent.click(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }))
    for (const name of ['ラーメンC', 'ラーメンE']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    for (const name of ['カフェA', 'カフェB', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、2件を表示')).toBeTruthy()

    // 同じチップをもう一度タップ → 解除（全件に戻る）
    fireEvent.click(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }))
    expect(screen.getByText('6件')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'カフェA' })).toBeTruthy()
  })

  it('料理ジャンル行は初期状態が折りたたみ（見出し行は表示・チップ群は非表示・aria-expanded=false）', () => {
    seedFilterItems()
    renderSection()

    const header = cuisineHeader()
    expect(header).toBeTruthy()
    expect(header.textContent).toContain('料理ジャンル')
    expect(header.textContent).toContain('展開')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(cuisineGroup()).toBeNull()
  })

  it('折りたたみ状態で料理ジャンルを選択済みの場合、見出し行に選択中ジャンルのラベルが表示される', () => {
    seedFilterItems()
    renderSection()

    // 展開 → ラーメンチップ選択 → 再度折りたたむ
    fireEvent.click(cuisineHeader())
    fireEvent.click(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }))
    fireEvent.click(cuisineHeader())

    // 折りたたみ＋選択中: 見出し行は「料理ジャンル：ラーメン」・チップ群は DOM に無い
    const header = cuisineHeader()
    expect(header.textContent).toContain('料理ジャンル：ラーメン')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(cuisineGroup()).toBeNull()
    // フィルタ自体は効いたまま（2件だけ表示）
    expect(screen.getByText('全6件中、2件を表示')).toBeTruthy()

    // 再展開すると選択中チップは押下表示のまま
    fireEvent.click(header)
    expect(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('★評価: 「★4以上」は rating が 4 以上だけ残り、「★5のみ」は 5 星だけ残る', () => {
    seedFilterItems()
    renderSection()

    fireEvent.click(within(ratingGroup()).getByRole('button', { name: '★4以上' }))
    for (const name of ['カフェA', '寿司D']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    for (const name of ['カフェB', 'ラーメンC', 'ラーメンE', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、2件を表示')).toBeTruthy()

    fireEvent.click(within(ratingGroup()).getByRole('button', { name: '★5のみ' }))
    expect(screen.getByRole('heading', { name: '寿司D' })).toBeTruthy()
    for (const name of ['カフェA', 'カフェB', 'ラーメンC', 'ラーメンE', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()
  })

  it('キーワード: 名前を対象に部分一致する（大小文字無視）', () => {
    seedFilterItems()
    renderSection()

    fireEvent.change(keywordInput(), { target: { value: 'ラーメン' } })
    for (const name of ['ラーメンC', 'ラーメンE']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    for (const name of ['カフェA', 'カフェB', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、2件を表示')).toBeTruthy()
  })

  it('キーワード: メモ本文を対象に部分一致する（大小文字無視）', () => {
    seedFilterItems()
    renderSection()

    // 「静か」はカフェAのメモ本文にしか出ない
    fireEvent.change(keywordInput(), { target: { value: '静か' } })
    expect(screen.getByRole('heading', { name: 'カフェA' })).toBeTruthy()
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()

    // 「WIFI」はカフェAのメモ「静かでWiFiが速い」に大小文字無視で一致する
    fireEvent.change(keywordInput(), { target: { value: 'WIFI' } })
    expect(screen.getByRole('heading', { name: 'カフェA' })).toBeTruthy()
    for (const name of ['カフェB', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()
  })

  it('複数条件は AND で適用される（WiFiあり ＋ ラーメン ＝ internet_access 登録のラーメンだけ）', () => {
    seedFilterItems()
    renderSection()

    fireEvent.click(within(wifiGroup()).getByRole('button', { name: 'WiFiあり' }))
    fireEvent.click(cuisineHeader())
    fireEvent.click(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }))

    expect(screen.getByRole('heading', { name: 'ラーメンC' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'ラーメンE' })).toBeTruthy()
    for (const name of ['カフェA', 'カフェB', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、2件を表示')).toBeTruthy()
  })

  it('複数条件は AND で適用される（キーワード ＋ ★評価 ＝ 両方一致のものだけ）', () => {
    seedFilterItems()
    renderSection()

    fireEvent.change(keywordInput(), { target: { value: 'ラーメン' } })
    fireEvent.click(within(ratingGroup()).getByRole('button', { name: '★1以上' }))

    // ラーメンC（rating 3）は一致するが、ラーメンE（rating 0 ＝ 未評価）は一致しない
    expect(screen.getByRole('heading', { name: 'ラーメンC' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'ラーメンE' })).toBeNull()
    for (const name of ['カフェA', 'カフェB', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()
  })

  it('絞り込み結果が0件のときは案内文と「フィルタをリセット」が出る、リセットで全件に戻る', () => {
    seedFilterItems()
    renderSection()

    // WiFiなし {B} × 車椅子対応可 {A} ＝ 0件（未登録は「なし」に含まれないため）
    fireEvent.click(within(wifiGroup()).getByRole('button', { name: 'WiFiなし' }))
    fireEvent.click(within(wcGroup()).getByRole('button', { name: '対応可' }))

    expect(screen.getByText('現在の絞り込み条件に一致するアイテムはありません。')).toBeTruthy()
    for (const name of ['カフェA', 'カフェB', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }

    fireEvent.click(screen.getByRole('button', { name: 'フィルタをリセット' }))
    expect(screen.getByText('6件')).toBeTruthy()
    expect(within(wifiGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: 'カフェB' })).toBeTruthy()
  })

  it('絞り込み中は「フィルタをクリア」ボタンが出て、クリックで全5条件が一括解除される', () => {
    seedFilterItems()
    renderSection()

    // 絞り込みしていないときはクリアボタンが出ない
    expect(screen.queryByRole('button', { name: 'フィルタをクリア' })).toBeNull()

    // 全5条件（キーワード・WiFi・車椅子・料理・評価）を同時に適用する
    fireEvent.change(keywordInput(), { target: { value: 'ラーメン' } })
    fireEvent.click(within(wifiGroup()).getByRole('button', { name: 'WiFiあり' }))
    fireEvent.click(within(wcGroup()).getByRole('button', { name: '一部対応' }))
    fireEvent.click(cuisineHeader())
    fireEvent.click(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }))
    fireEvent.click(within(ratingGroup()).getByRole('button', { name: '★2以上' }))

    // 5条件の AND で一致するのはラーメンCだけ（rating 3 が ★2以上を満足）
    expect(screen.getByRole('heading', { name: 'ラーメンC' })).toBeTruthy()
    for (const name of ['カフェA', 'カフェB', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.getByText('全6件中、1件を表示')).toBeTruthy()

    // クリアボタンが出て、クリックで全条件が一度に解除される
    const clearBtn = screen.getByRole('button', { name: 'フィルタをクリア' })
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn)

    // キーワードが空になり、全チップが「すべて」に戻り、全件が表示される
    expect(keywordInput().value).toBe('')
    expect(within(wifiGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(wcGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(ratingGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(cuisineGroup()).getByRole('button', { name: 'ラーメン（2件）' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('6件')).toBeTruthy()
    for (const name of ['カフェA', 'カフェB', 'ラーメンC', 'ラーメンE', '寿司D', 'みらい公園']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: 'フィルタをクリア' })).toBeNull()
  })

  it('cuisine タグを持つアイテムが皆無なら料理ジャンル行は出ない（見出し行も含めて行ごと非表示・他は出る）', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([PARK]))
    renderSection()

    expect(keywordInput()).toBeTruthy()
    expect(wifiGroup()).toBeTruthy()
    expect(wcGroup()).toBeTruthy()
    expect(ratingGroup()).toBeTruthy()
    expect(cuisineHeader()).toBeNull()
    expect(cuisineGroup()).toBeNull()
  })

  it('0件のときはフィルタバーは出ない', () => {
    renderSection()
    expect(screen.queryByRole('textbox', { name: '名前・メモで絞り込む' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'WiFi有無で絞る' })).toBeNull()
    expect(screen.queryByRole('group', { name: '車椅子対応で絞る' })).toBeNull()
    expect(screen.queryByRole('group', { name: '評価で絞る' })).toBeNull()
  })

  it('フィルタ状態はメモ帳ローカル: 再レンダで初期化される・保存データは変わらない', () => {
    seedFilterItems()
    const { view } = renderSection()

    fireEvent.click(within(wifiGroup()).getByRole('button', { name: 'WiFiあり' }))
    expect(screen.getByText('全6件中、3件を表示')).toBeTruthy()

    // コンポーネントをアンマウントして再レンダ（状態はローカルなので初期化される）
    view.unmount()
    renderSection()

    expect(screen.getByText('6件')).toBeTruthy()
    expect(within(wifiGroup()).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    // 絞り込みは表示のみで、localStorage の保存データは変更されない
    expect(storedItems()).toHaveLength(6)
  })
})
