// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MobileFacilityCard, { facilityName, formatAddress, safeWebsite } from '../MobileFacilityCard'
import { facilityTypeLabel } from '../../../utils/facilityLabels'

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
 * - カード全体タップで onOpen(result)
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
    expect(facilityName({})).toBe('名前のない要素')
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
    expect(screen.getByRole('heading', { name: '名前のない要素' })).toBeTruthy()
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

  it('カード全体タップで onOpen(result) が呼ばれる', () => {
    const onOpen = vi.fn()
    render(<MobileFacilityCard result={COFFEE} onOpen={onOpen} />)
    // 施設名（h3）はカードdivの内側なので、クリックはカード全体onClickへ伝播する
    fireEvent.click(screen.getByRole('heading', { name: 'テスト珈琲店' }))
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
