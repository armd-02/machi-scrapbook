// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MobileFacilityCard, { facilityName, formatAddress, safeWebsite } from '../MobileFacilityCard'
import { facilityTypeLabel } from '../../../utils/facilityLabels'
import { MEMOCHO_STORAGE_KEY } from '../../../utils/memocho'
import { resetMemochoStore } from '../../../hooks/useMemocho'

/**
 * (#59 / #44 / 電話帳型改訂) モバイル施設カード
 * - 生活者目線UI: 施設名（大きめ・太字）＋カテゴリラベルを先頭に、
 *   ラベル付きの基本項目行（住所・電話・営業時間・Webサイト）を並べる
 * - 電話はtel:リンク、Webサイトは外部リンクとして個別にタップ可能
 *   （カードはbuttonでなくdiv。リンクタップで詳細シートは開かない）
 * - カテゴリ別追加項目（keyInfoFor）は基本4項目と重ならないものだけ表示
 * - OSM生データ（node/way、amenity=cafe、OSM ID）はカードの主表示にしない
 * - 住所・営業時間は未登録なら行ごとに出さない（捏造しない）
 * - 電話・Webサイトは常時行を表示。未登録なら「-」（リンクにはしない）
 * - カード内の「🔎詳細」ボタン押下で onOpen(result)（カード本体タップでは詳細は開かない）
 */

afterEach(() => cleanup())

const COFFEE = {
  type: 'node', id: 1001, lat: 34.85, lon: 135.5,
  name: 'テスト珈琲店',
  tags: {
    name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee',
    'addr:city': '大阪市', 'addr:suburb': '梅田', 'addr:street': '1-1', 'addr:housenumber': '12',
  },
}

describe('ユーティリティ関数（facilityLabels.js 経由の再エクスポート）', () => {
  it('facilityName: name → name:ja → フォールバックの順で解決する', () => {
    expect(facilityName(COFFEE)).toBe('テスト珈琲店')
    expect(facilityName({ tags: { 'name:ja': '日本語名' } })).toBe('日本語名')
    expect(facilityName({})).toBe('（名称不明）')
  })

  it('facilityName: データ側のセンチネル（名称なし）は「名前がない」として扱いフォールバックを返す', () => {
    // まちメモ帳のアイテムは名前の無い施設に name:'名称なし' を格納する（データ出力用）。
    // 表示では（名称不明）を使う（データ出力には影響させない）。
    expect(facilityName({ name: '名称なし' })).toBe('（名称不明）')
    expect(facilityName({ name: '名称なし', tags: { 'name:ja': '日本語名' } })).toBe('日本語名')
    expect(facilityName({ name: 'テストカフェ' })).toBe('テストカフェ')
    expect(facilityName({ name: '' })).toBe('（名称不明）')
  })

  it('formatAddress: city→suburb→street→housenumber の順に連結する', () => {
    expect(formatAddress(COFFEE.tags)).toBe('大阪市 梅田 1-1 12')
    expect(formatAddress({ 'addr:street': '番地なし' })).toBe('番地なし')
    expect(formatAddress({})).toBe('')
    expect(formatAddress(null)).toBe('')
  })

  it('safeWebsite: http(s) URL のみ返し、それ以外は空文字', () => {
    expect(safeWebsite({ website: 'https://example.com' })).toBe('https://example.com')
    expect(safeWebsite({ official_website: 'http://example.jp' })).toBe('http://example.jp')
    expect(safeWebsite({ website: 'example.com' })).toBe('')
    expect(safeWebsite({})).toBe('')
    expect(safeWebsite(null)).toBe('')
  })
})

describe('MobileFacilityCard（#44 生活者目線デザイン）', () => {
  it('名称・日本語の施設タイプ・住所を表示する', () => {
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    // 施設名は大きめ・太字のh3（電話帳型カード）
    const heading = screen.getByRole('heading', { name: 'テスト珈琲店' })
    expect(heading).toBeTruthy()
    // 施設タイプは日本語ラベル（amenity=cafe → カフェ）
    expect(screen.getByText('カフェ')).toBeTruthy()
    expect(screen.getByText(/大阪市 梅田 1-1 12/)).toBeTruthy()
  })

  it('OSM生データ（要素種別・生タグ値・OSM ID）はカードに出さない', () => {
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    expect(screen.queryByText('node/1001')).toBeNull()
    expect(screen.queryByText(/^cafe$/)).toBeNull()
    expect(screen.queryByText(/^coffee$/)).toBeNull()
    expect(screen.queryByText('node')).toBeNull()
  })

  it('電話・公式サイト・営業時間が登録されていれば表示される', () => {
    const full = {
      type: 'way', id: 77, lat: 34.8, lon: 135.5,
      tags: {
        name: 'みらい公園', leisure: 'park',
        phone: '06-1234-5678',
        website: 'https://park.example.jp',
        opening_hours: '09:00-17:00',
        'addr:city': '高槻市',
      },
    }
    render(<MobileFacilityCard result={full} onOpen={vi.fn()} />)
    expect(screen.getByText('公園')).toBeTruthy()
    expect(screen.getByText(/06-1234-5678/)).toBeTruthy()
    expect(screen.getByText(/公式サイト/)).toBeTruthy()
    expect(screen.getByText(/9:00〜17:00/)).toBeTruthy()
  })

  it('住所・営業時間が未登録なら行ごとに出ない（捏造しない）', () => {
    const bare = { type: 'node', id: 9, lat: 34.8, lon: 135.5, tags: { amenity: 'bench' } }
    render(<MobileFacilityCard result={bare} onOpen={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '（名称不明）' })).toBeTruthy()
    expect(screen.queryByText(/大阪市/)).toBeNull()
    expect(screen.queryByText(/公式サイト/)).toBeNull()
    expect(screen.queryByText(/📞/)).toBeNull()
    // 住所・営業時間は未登録なので行自体が存在しない
    expect(screen.queryByText('住所')).toBeNull()
    expect(screen.queryByText('営業時間')).toBeNull()
  })

  it('電話・Webサイトは未登録でも常時行を表示し「-」と表記する（モバイル）', () => {
    // 電話・Webサイトともに未登録のCOFFEE
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    expect(screen.getByText('電話')).toBeTruthy()
    expect(screen.getByText('Webサイト')).toBeTruthy()
    // 「-」が電話行・Webサイト行のそれぞれ1つずつ（合計2つ）
    expect(screen.getAllByText('-')).toHaveLength(2)
    // 未登録なのでtel:リンク・外部リンクは出ない
    expect(screen.queryByRole('link', { name: /電話/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /公式サイト/ })).toBeNull()
  })

  it('カード本体タップでは onOpen は呼ばれない（詳細は開かない）', () => {
    const onOpen = vi.fn()
    render(<MobileFacilityCard result={COFFEE} onOpen={onOpen} />)
    // 施設名（h3）・カード内の情報行をタップしても onClick は無い
    fireEvent.click(screen.getByRole('heading', { name: 'テスト珈琲店' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('「🔎詳細」ボタン押下で onOpen(result) が呼ばれる', () => {
    const onOpen = vi.fn()
    render(<MobileFacilityCard result={COFFEE} onOpen={onOpen} />)
    const btn = screen.getByRole('button', { name: 'テスト珈琲店の詳細' })
    expect(btn.textContent).toBe('🔎詳細')
    fireEvent.click(btn)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(COFFEE)
  })

  it('カードはbutton要素ではなくdiv（リンクを内包する電話帳型カード）', () => {
    // overpass.js が tags.name を上位に正規化した形（result.name 付き）を模す
    const full = {
      type: 'way', id: 77, lat: 34.8, lon: 135.5,
      name: 'みらい公園',
      tags: {
        name: 'みらい公園', leisure: 'park',
        phone: '06-1234-5678',
        website: 'https://park.example.jp',
      },
    }
    render(<MobileFacilityCard result={full} onOpen={vi.fn()} />)
    const card = screen.getByRole('heading', { name: 'みらい公園' }).closest('div[class*="border"]')
    expect(card.tagName).toBe('DIV')
    expect(card.getAttribute('role')).not.toBe('button')
  })

  it('基本項目行は住所・電話・営業時間・Webサイトの順にラベル付きで表示される', () => {
    const full = {
      type: 'way', id: 78, lat: 34.8, lon: 135.5,
      tags: {
        name: 'みらい公園', leisure: 'park',
        phone: '06-1234-5678',
        website: 'https://park.example.jp',
        opening_hours: '09:00-17:00',
        'addr:city': '高槻市',
      },
    }
    render(<MobileFacilityCard result={full} onOpen={vi.fn()} />)
    // ラベル表示（現行ルール: 登録済みのみ。この結果は4項目すべて登録済み）
    expect(screen.getByText('住所')).toBeTruthy()
    expect(screen.getByText('電話')).toBeTruthy()
    expect(screen.getByText('営業時間')).toBeTruthy()
    expect(screen.getByText('Webサイト')).toBeTruthy()
    // 行の順序: 住所 < 電話 < 営業時間 < Webサイト
    const rows = ['住所', '電話', '営業時間', 'Webサイト'].map((label) => screen.getByText(label))
    expect(rows[0].compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rows[1].compareDocumentPosition(rows[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rows[2].compareDocumentPosition(rows[3]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('電話はtel:リンク、Webサイトはtarget=_blankの外部リンクとして個別にタップできる', () => {
    const full = {
      type: 'way', id: 79, lat: 34.8, lon: 135.5,
      tags: {
        name: 'みらい公園', leisure: 'park',
        phone: '06-1234-5678',
        website: 'https://park.example.jp',
      },
    }
    render(<MobileFacilityCard result={full} onOpen={vi.fn()} />)
    const phoneLink = screen.getByRole('link', { name: /06-1234-5678/ })
    expect(phoneLink.getAttribute('href')).toBe('tel:06-1234-5678')
    const webLink = screen.getByRole('link', { name: /公式サイト/ })
    expect(webLink.getAttribute('href')).toBe('https://park.example.jp')
    expect(webLink.getAttribute('target')).toBe('_blank')
    expect(webLink.getAttribute('rel')).toContain('noopener')
  })

  it('リンクタップはstopPropagationで詳細シートを開かない', () => {
    const onOpen = vi.fn()
    const full = {
      type: 'way', id: 80, lat: 34.8, lon: 135.5,
      tags: {
        name: 'みらい公園', leisure: 'park',
        phone: '06-1234-5678',
        website: 'https://park.example.jp',
      },
    }
    render(<MobileFacilityCard result={full} onOpen={onOpen} />)
    // 電話リンクをタップ → onOpenは呼ばれない（発信のみ）
    fireEvent.click(screen.getByRole('link', { name: /06-1234-5678/ }))
    expect(onOpen).not.toHaveBeenCalled()
    // Webサイトリンクをタップ → onOpenは呼ばれない（外部リンクのみ）
    fireEvent.click(screen.getByRole('link', { name: /公式サイト/ }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('(#61) wheelchairが登録されていれば車椅子バッジを表示する', () => {
    const r = {
      type: 'node', id: 1, lat: 34.8, lon: 135.5,
      tags: { name: 'テスト店舗', amenity: 'cafe', wheelchair: 'yes' }
    }
    render(<MobileFacilityCard result={r} onOpen={vi.fn()} />)
    expect(screen.getByText('♿ 車椅子対応')).toBeTruthy()
  })

  it('(#61) wheelchair=limited / no でもそれぞれのラベルでバッジが出る', () => {
    render(<MobileFacilityCard result={{ type: 'node', id: 2, tags: { amenity: 'cafe', wheelchair: 'limited' } }} onOpen={vi.fn()} />)
    expect(screen.getByText('♿ 車椅子一部対応')).toBeTruthy()
    cleanup()
    render(<MobileFacilityCard result={{ type: 'node', id: 3, tags: { amenity: 'cafe', wheelchair: 'no' } }} onOpen={vi.fn()} />)
    expect(screen.getByText('♿ 車椅子非対応')).toBeTruthy()
  })

  it('(#61) wheelchair未登録ならバッジは出ない', () => {
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    expect(screen.queryByText(/♿/)).toBeNull()
  })
})

describe('MobileFacilityCard: カテゴリ別追加項目 (A3)', () => {
  it('飲食店にはカテゴリに意味のあるcuisine属性を追加項目として表示する', () => {
    const r = { type: 'node', id: 30, name: '梅田ラーメン', tags: { amenity: 'restaurant', name: '梅田ラーメン', cuisine: 'ramen', opening_hours: '11:00-23:00' } }
    render(<MobileFacilityCard result={r} onOpen={vi.fn()} />)
    expect(screen.getByText(/🍴 ramen/)).toBeTruthy()
    // 営業時間は基本項目としてラベル付き行で表示される
    expect(screen.getByText('営業時間')).toBeTruthy()
    expect(screen.getByText(/11:00〜23:00/)).toBeTruthy()
  })

  it('公共トイレでも登録済みの基本項目は表示され、車椅子バッジも出る', () => {
    // 電話帳型カードでは基本4項目（住所・電話・営業時間・Webサイト）は
    // カテゴリに関わらず登録済みなら表示される（A3の項目抑制は追加項目に限定）
    const r = { type: 'node', id: 31, tags: { amenity: 'toilets', phone: '06-2222-2222', website: 'https://toilet.example', opening_hours: '24/7', 'addr:city': '北区', wheelchair: 'yes' } }
    render(<MobileFacilityCard result={r} onOpen={vi.fn()} />)
    expect(screen.getByText(/北区/)).toBeTruthy()
    const phoneLink = screen.getByRole('link', { name: /06-2222-2222/ })
    expect(phoneLink.getAttribute('href')).toBe('tel:06-2222-2222')
    expect(screen.getByRole('link', { name: /公式サイト/ })).toBeTruthy()
    expect(screen.getByText(/24時間営業/)).toBeTruthy()
    // wheelchairはバッジとして引き続き表示
    expect(screen.getByText(/♿ 車椅子対応/)).toBeTruthy()
  })

  it('駅でも登録済みの営業時間は基本項目として表示される', () => {
    const r = { type: 'node', id: 32, name: 'テスト駅', tags: { railway: 'station', name: 'テスト駅', opening_hours: '05:00-24:00', 'addr:city': '吹田市' } }
    render(<MobileFacilityCard result={r} onOpen={vi.fn()} />)
    expect(screen.getByText(/吹田市/)).toBeTruthy()
    expect(screen.getByText(/5:00〜24:00/)).toBeTruthy()
  })

  it('カテゴリ追加項目は基本4項目と重ならないものだけ表示する（二重表示しない）', () => {
    // cafeプロファイルのattrs: address, phone, opening_hours, cuisine, website
    // → 基本4項目（address/phone/opening_hours/website）は基本行で済み、
    //   追加行に出るのは cuisine のみ
    const r = {
      type: 'node', id: 33, name: 'テストカフェ',
      tags: {
        amenity: 'cafe', name: 'テストカフェ', cuisine: 'coffee',
        phone: '06-1111-2222', website: 'https://cafe.example',
        opening_hours: '08:00-20:00', 'addr:city': '大阪市',
      },
    }
    render(<MobileFacilityCard result={r} onOpen={vi.fn()} />)
    // cuisine は追加項目として1回だけ表示
    expect(screen.getAllByText(/🍴 coffee/)).toHaveLength(1)
    // 基本項目の値もそれぞれ1回だけ表示（追加行で二重表示されていない）
    expect(screen.getAllByText(/06-1111-2222/)).toHaveLength(1)
    expect(screen.getAllByText(/8:00〜20:00/)).toHaveLength(1)
    expect(screen.getAllByText(/公式サイト/)).toHaveLength(1)
    expect(screen.getAllByText(/大阪市/)).toHaveLength(1)
  })
})

describe('facilityTypeLabel（日本語施設タイプ）', () => {
  it('主要タグ値を辞書で日本語化する', () => {
    expect(facilityTypeLabel({ tags: { amenity: 'cafe' } })).toBe('カフェ')
    expect(facilityTypeLabel({ tags: { shop: 'convenience' } })).toBe('コンビニエンスストア')
    expect(facilityTypeLabel({ tags: { leisure: 'park' } })).toBe('公園')
    expect(facilityTypeLabel({ tags: { railway: 'station' } })).toBe('駅')
    expect(facilityTypeLabel({ tags: { healthcare: 'dentist' } })).toBe('歯科')
  })

  it('辞書未登録値はカテゴリ照合でラベルを取得する', () => {
    // amenity=sushi は辞書なし → food_drink カテゴリに一致 → 「飲食店（すべて）」
    expect(facilityTypeLabel({ tags: { amenity: 'sushi' } })).toBe('飲食店（すべて）')
    // amenity=plaza は辞書なし → park カテゴリに一致 → 「公園・広場」
    expect(facilityTypeLabel({ tags: { amenity: 'plaza' } })).toBe('公園・広場')
  })

  it('何も一致しなければ「施設」となる', () => {
    expect(facilityTypeLabel({ tags: {} })).toBe('施設')
    expect(facilityTypeLabel({})).toBe('施設')
  })
})

describe('まちメモ帳ボタン（第2ピース）', () => {
  // このブロックだけ localStorage・ストアをリセットして隔離する
  beforeEach(() => {
    localStorage.clear()
    resetMemochoStore()
  })
  afterEach(() => {
    localStorage.clear()
    resetMemochoStore()
  })

  it('ボタンで追加でき、表示が「登録済み」に変わる（aria-pressed も更新）', () => {
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /メモ帳に追加/ })
    expect(btn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(btn)

    expect(screen.getByRole('button', { name: /登録済み/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /メモ帳に追加/ })).toBeNull()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    // localStorage にスナップショットが保存される
    const stored = JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ type: 'node', id: 1001, name: 'テスト珈琲店' })
  })

  it('もう一度押すとごみ箱へ移動され、表示が「メモ帳に追加」に戻る（toggle・論理削除）', () => {
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /メモ帳に追加/ }))
    fireEvent.click(screen.getByRole('button', { name: /登録済み/ }))
    // 論理削除: has() が false になり表示は「メモ帳に追加」に戻る
    expect(screen.getByRole('button', { name: /メモ帳に追加/ })).toBeTruthy()
    // アイテムはごみ箱としてストアに残る（deletedAt が付く）
    const stored = JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
    expect(stored).toHaveLength(1)
    expect(stored[0].deletedAt).toBeTruthy()
  })

  it('ボタンを押しても詳細が開かない（onOpen は呼ばれない）', () => {
    const onOpen = vi.fn()
    render(<MobileFacilityCard result={COFFEE} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /メモ帳に追加/ }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('localStorage に保存済みの施設では初回表示が「登録済み」', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      { type: 'node', id: 1001, name: 'テスト珈琲店', lat: 34.85, lon: 135.5, tags: null, memo: '', addedAt: null },
    ]))
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /登録済み/ })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('MobileFacilityCard: 作業スペース系 電源・Wi-Fi', () => {
  it('対象4種（cafe/library/internet_cafe/coworking）には電源・Wi-Fi 行が表示される', () => {
    const targets = [
      { amenity: 'cafe' },
      { amenity: 'library' },
      { amenity: 'internet_cafe' },
      { office: 'coworking' },
    ]
    for (const tags of targets) {
      cleanup()
      render(<MobileFacilityCard result={{ type: 'node', id: 40, tags: { ...tags, name: 'テスト施設' } }} onOpen={vi.fn()} />)
      expect(screen.getByText('電源')).toBeTruthy()
      expect(screen.getByText('Wi-Fi')).toBeTruthy()
    }
  })

  it('対象外の施設には行ごとに出さない（何も表示されない）', () => {
    const outOfScope = [
      { amenity: 'restaurant' },
      { shop: 'convenience' },
      { amenity: 'bench' },
      { amenity: 'community_centre' },
      { office: 'company' },
    ]
    for (const tags of outOfScope) {
      cleanup()
      render(<MobileFacilityCard result={{ type: 'node', id: 41, tags: { ...tags, name: 'テスト施設' } }} onOpen={vi.fn()} />)
      expect(screen.queryByText('電源')).toBeNull()
      expect(screen.queryByText('Wi-Fi')).toBeNull()
    }
  })

  it('Wi-Fi: あり（internet_access が no 以外）は緑バッジで表示', () => {
    render(<MobileFacilityCard result={{ type: 'node', id: 42, tags: { amenity: 'cafe', name: 'A', internet_access: 'wlan', socket: 'no' } }} onOpen={vi.fn()} />)
    const badge = screen.getByText('📶 あり')
    expect(badge.className).toContain('bg-emerald-50')
  })

  it('Wi-Fi: ない（internet_access=no）は赤バッジで表示', () => {
    render(<MobileFacilityCard result={{ type: 'node', id: 43, tags: { amenity: 'cafe', name: 'B', internet_access: 'no', socket: 'yes' } }} onOpen={vi.fn()} />)
    const badge = screen.getByText('📶 なし')
    expect(badge.className).toContain('bg-rose-50')
  })

  it('Wi-Fi: 未登録はバッジを使わない控えめなプレーン表示', () => {
    // wifi 未登録・power はあり（socket:yes）→ 「未登録」は wifi 側のみ1つ
    render(<MobileFacilityCard result={{ type: 'node', id: 44, tags: { amenity: 'cafe', name: 'C', socket: 'yes' } }} onOpen={vi.fn()} />)
    const el = screen.getByText('未登録')
    // バッジ（border・背景色）ではない
    expect(el.className).not.toContain('border')
    expect(el.className).not.toContain('bg-')
  })

  it('電源: power_supply=yes は緑バッジ', () => {
    render(<MobileFacilityCard result={{ type: 'node', id: 45, tags: { amenity: 'cafe', name: 'D', power_supply: 'yes' } }} onOpen={vi.fn()} />)
    const badge = screen.getByText('⚡ あり')
    expect(badge.className).toContain('bg-emerald-50')
  })

  it('電源: socket 系キーが no 以外ならあり（socket:count のみでも）', () => {
    render(<MobileFacilityCard result={{ type: 'node', id: 46, tags: { amenity: 'library', name: 'E', 'socket:count': '2' } }} onOpen={vi.fn()} />)
    const badge = screen.getByText('⚡ あり')
    expect(badge.className).toContain('bg-emerald-50')
  })

  it('電源: socket=no は赤バッジ', () => {
    render(<MobileFacilityCard result={{ type: 'node', id: 47, tags: { amenity: 'cafe', name: 'F', socket: 'no', internet_access: 'wlan' } }} onOpen={vi.fn()} />)
    const badge = screen.getByText('⚡ なし')
    expect(badge.className).toContain('bg-rose-50')
  })

  it('電源: 未登録は控えめなプレーン表示', () => {
    // power 未登録・wifi はあり（wlan）→ 「未登録」は power 側のみ1つ
    render(<MobileFacilityCard result={{ type: 'node', id: 48, tags: { amenity: 'internet_cafe', name: 'G', internet_access: 'wlan' } }} onOpen={vi.fn()} />)
    const el = screen.getByText('未登録')
    expect(el.className).not.toContain('border')
  })

  it('両方未登録なら「未登録」が2つ（電源・Wi-Fi それぞれ）', () => {
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    expect(screen.getAllByText('未登録')).toHaveLength(2)
  })

  it('電源・Wi-Fi は独立に判定される（片方だけ登録されたケース）', () => {
    // wifi あり・power 未登録
    render(<MobileFacilityCard result={{ type: 'node', id: 49, tags: { amenity: 'cafe', name: 'H', internet_access: 'wired' } }} onOpen={vi.fn()} />)
    expect(screen.getByText('📶 あり')).toBeTruthy()
    expect(screen.getByText('未登録')).toBeTruthy()
    cleanup()
    // wifi なし・power あり
    render(<MobileFacilityCard result={{ type: 'node', id: 50, tags: { amenity: 'cafe', name: 'I', internet_access: 'no', power_supply: 'yes' } }} onOpen={vi.fn()} />)
    expect(screen.getByText('📶 なし')).toBeTruthy()
    expect(screen.getByText('⚡ あり')).toBeTruthy()
  })

  it('既存の表示（基本項目・- の表記）は壊れない（COFFEE: 電話・Webサイト未登録で「-」2つ）', () => {
    render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    expect(screen.getAllByText('-')).toHaveLength(2)
    expect(screen.getByText('電話')).toBeTruthy()
    expect(screen.getByText('Webサイト')).toBeTruthy()
  })

  it('生タグ値（wlan 等）は表示しない', () => {
    render(<MobileFacilityCard result={{ type: 'node', id: 51, tags: { amenity: 'cafe', name: 'J', internet_access: 'wlan', 'socket:count': '2' } }} onOpen={vi.fn()} />)
    expect(screen.queryByText(/^wlan$/)).toBeNull()
    expect(screen.queryByText(/^2$/)).toBeNull()
  })
})

// ===== 施設名の左のアイコン（コミュニティマップメーカー由来の対応表） =====
describe('MobileFacilityCard: 施設名の左のアイコン', () => {
  const iconImg = (container) => container.querySelector('img')

  it('OSMタグから対応表で決まったアイコン画像が名前の左に表示される（cafe → cafe.png）', () => {
    const { container } = render(<MobileFacilityCard result={COFFEE} onOpen={vi.fn()} />)
    const img = iconImg(container)
    expect(img).toBeTruthy()
    expect(img.alt).toBe('')
    expect(img.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}icons/cafe.png`)
    // 名前の左側（h3 の前に DOM 上にある）
    const h3 = container.querySelector('h3')
    expect(img.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 高さ 24px（h-6）
    expect(img.className).toContain('h-6')
  })

  it('subtag 判定が効く（寺院+religion=buddhist → buddhist.png）', () => {
    const { container } = render(
      <MobileFacilityCard result={{ type: 'node', id: 60, tags: { name: '某寺', amenity: 'place_of_worship', religion: 'buddhist' } }} onOpen={vi.fn()} />
    )
    expect(iconImg(container).getAttribute('src')).toBe(`${import.meta.env.BASE_URL}icons/buddhist.png`)
  })

  it('タグが無い・対応表に無い場合は fallback アイコン（marker-stroked.png）を表示する', () => {
    const { container } = render(
      <MobileFacilityCard result={{ type: 'node', id: 61, tags: { name: '謎の施設', foo: 'bar' } }} onOpen={vi.fn()} />
    )
    expect(iconImg(container).getAttribute('src')).toBe(`${import.meta.env.BASE_URL}icons/marker-stroked.png`)
  })
})
