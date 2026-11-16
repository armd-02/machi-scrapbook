// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import MobileFacilityDetail from '../MobileFacilityDetail'

/**
 * (#59) 施設詳細ボトムシート
 * - role="dialog" + aria-modal + 名称付きaria-label
 * - 施設名＋カテゴリチップ（facilityTypeLabel・カードと同じ見た目）
 * - 基本行はカードと同じラベル付き行の形式（住所/電話/営業時間/Webサイト）
 *   - 住所・営業時間は登録済みの情報のみ表示
 *   - 電話・Webサイトは常時表示。登録あればtel:リンク／外部リンク
 *     （target=_blank + rel=noopener）、なければ「-」
 * - カテゴリ別追加項目（keyInfoFor の items を基本4項目・wheelchair で除外）
 * - メール・FAX（登録時のみ）・SNSリンク（タグがある場合のみ）
 * - OSMリンク。タグ一覧（<details>折りたたみ）は廃止
 * - フッター: 「経路検索」（座標がある場合のみ）・「iDで編集」。「閉じる」は右上の✕ボタン
 * (#62)
 * - 座標がある場合、シート上部（スクロール領域先頭）に位置マップ（MiniLocationMap）＋マーカー
 * - 座標がない場合はマップも非表示
 * - 「地図で見る」ボタンは削除済み（シート内に位置マップが表示されるため不要）
 */

// vi.mockファクトリはファイル先頭にホイスされるため、共通モックは動的importで参照。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return { default: mockState.api }
})

beforeEach(() => {
  if (mockState.api) mockState.api.resetState()
})

afterEach(() => cleanup())

const FULL = {
  type: 'node', id: 1001, lat: 34.85, lon: 135.5,
  name: 'テスト珈琲店', // overpass.js が tags.name を上位に正規化した結果を模す
  tags: {
    name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee',
    'addr:city': '大阪市', 'addr:suburb': '梅田', 'addr:street': '1-1',
    phone: '+81-6-1234-5678', website: 'https://example.com/coffee',
  },
}

function renderDetail(result = FULL, props = {}) {
  return render(
    <MobileFacilityDetail
      detail={{ result }}
      onClose={props.onClose || vi.fn()}
    />
  )
}

describe('MobileFacilityDetail', () => {
  it('ボトムシートは role="dialog" + aria-modal で名称を付ける', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog', { name: '施設詳細: テスト珈琲店' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('住所・電話・Webサイトがカードと同じラベル付き行で表示される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/大阪市 梅田 1-1/)).toBeTruthy()

    // 電話: 電話ラベル付きのtel:リンク
    const phoneLink = within(dialog).getByRole('link', { name: /^電話/ })
    expect(phoneLink.getAttribute('href')).toBe('tel:+81-6-1234-5678')

    // Webサイト: Webサイトラベル付きの外部リンク（target=_blank + rel=noopener）
    const webLink = within(dialog).getByRole('link', { name: /^Webサイト/ })
    expect(webLink.getAttribute('href')).toBe('https://example.com/coffee')
    expect(webLink.getAttribute('target')).toBe('_blank')
    expect(webLink.getAttribute('rel')).toContain('noopener')
  })

  it('OSM ID・座標・OSMリンクが表示される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('node/1001')).toBeTruthy()
    expect(within(dialog).getByText(/34.85, 135.5/)).toBeTruthy()
    const osmLink = within(dialog).getByRole('link', { name: /OSMで見る/ })
    expect(osmLink.getAttribute('href')).toBe('https://www.openstreetmap.org/node/1001')
  })

  it('カテゴリチップ（facilityTypeLabel）は名前の近くにカードと同じ見目で表示される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    const chip = within(dialog).getByText('カフェ')
    // カードと同じチップ見た目（text-[11px] text-primary-700 bg-primary-50）
    expect(chip.className).toContain('text-[11px]')
    expect(chip.className).toContain('text-primary-700')
    expect(chip.className).toContain('bg-primary-50')
    // ヘッダー（施設名と同一ブロック）に表示される
    expect(chip.closest('.border-b')).toBeTruthy()
  })

  it('カテゴリ別の追加項目（keyInfoFor）は基本4項目を除外して表示される', () => {
    renderDetail() // cafe: cuisine が追加項目
    const dialog = screen.getByRole('dialog')
    // cafeプロファイルの追加項目 cuisine が表示される
    expect(within(dialog).getByText('🍴 coffee')).toBeTruthy()
    // 基本4項目は基本行で1回のみ（追加項目に二重表示されない）
    expect(within(dialog).getAllByText(/📞 \+81-6-1234-5678/)).toHaveLength(1)
    expect(within(dialog).getAllByText(/大阪市 梅田 1-1/)).toHaveLength(1)
  })

  it('タグ一覧（<details>）は表示されない', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText(/タグ一覧/)).toBeNull()
    expect(dialog.querySelector('details')).toBeNull()
  })

  it('電話・Webサイトは未登録でも常時行を表示し「-」と表記する（リンクは生成しない）', () => {
    renderDetail({ type: 'node', id: 9, lat: 34.8, lon: 135.5, tags: { amenity: 'bench' } })
    const dialog = screen.getByRole('dialog')
    // 電話・Webサイト行は常時表示（未登録なら「-」）
    expect(within(dialog).getByText('電話')).toBeTruthy()
    expect(within(dialog).getByText('Webサイト')).toBeTruthy()
    expect(within(dialog).getAllByText('-')).toHaveLength(2)
    // 未登録なのでtel:リンク・外部リンクは出ない
    expect(within(dialog).queryByRole('link', { name: /^電話/ })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: /^Webサイト/ })).toBeNull()
    // フッターは「経路検索」（座標があるため）、「閉じる」は右上の✕ボタン
    expect(within(dialog).getByRole('link', { name: /経路検索/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeTruthy()
  })

  it('座標がない要素では「経路検索」リンクが表示されず、iDで編集・閉じるが残る', () => {
    renderDetail({ type: 'node', id: 9, tags: { amenity: 'bench' } })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('link', { name: /経路検索/ })).toBeNull()
    expect(within(dialog).getByRole('link', { name: /iDで編集/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeTruthy()
  })

  it('「閉じる」で onClose が呼ばれる', () => {
    const onClose = vi.fn()
    renderDetail(FULL, { onClose })
    const dialog = screen.getByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('背景クリックで onClose が呼ばれる', () => {
    const onClose = vi.fn()
    renderDetail(FULL, { onClose })
    // 背景（presentation層のブラックオーバーレイ）
    const backdrop = document.querySelector('.bg-black\\/40')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('営業時間・メール・FAXは登録済みのみ表示される', () => {
    renderDetail({
      type: 'node', id: 7, lat: 34.8, lon: 135.5,
      tags: {
        amenity: 'pharmacy',
        opening_hours: 'Mo-Fr 09:00-19:00; Sa 09:00-13:00',
        'contact:email': 'shop@example.com',
        'contact:fax': '+81-6-9999-8888'
      }
    })
    const dialog = screen.getByRole('dialog')
    // 営業時間値が営業時間行（🕐 付き）に表示される（表示のみ日本語化。データは元の値のまま）
    expect(within(dialog).getByText(/月〜金 9:00〜19:00／土 9:00〜13:00/)).toBeTruthy()
    const mail = within(dialog).getByRole('link', { name: /shop@example.com/ })
    expect(mail.getAttribute('href')).toBe('mailto:shop@example.com')
    expect(within(dialog).getByText(/FAX: \+81-6-9999-8888/)).toBeTruthy()
  })
})

describe('MobileFacilityDetail: iD編集導線 (B3)', () => {
  it('フッターに「iDで編集」リンクがあり、要素ディープリンクを指す', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    const idLink = within(dialog).getByRole('link', { name: /iDで編集/ })
    expect(idLink.getAttribute('href')).toBe('https://www.openstreetmap.org/edit?node=node%2F1001')
    expect(idLink.getAttribute('target')).toBe('_blank')
    expect(idLink.getAttribute('rel')).toContain('noopener')
  })

  it('座標がない要素でもiDリンクは表示される', () => {
    renderDetail({ type: 'way', id: 8, tags: { amenity: 'supermarket' } })
    const dialog = screen.getByRole('dialog')
    const idLink = within(dialog).getByRole('link', { name: /iDで編集/ })
    expect(idLink.getAttribute('href')).toBe('https://www.openstreetmap.org/edit?node=way%2F8')
  })
})

describe('MobileFacilityDetail: 位置マップ（#62）', () => {
  it('座標がある場合、施設座標を中心に位置マップが表示される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    // マップ本体（role=img）が存在する
    const mapEl = within(dialog).getByRole('img')
    expect(mapEl).toBeTruthy()
    // モック経由でMap作成の座標・マーカーを検証
    const map = mockState.api._state.maps[0]
    expect(map).toBeTruthy()
    expect(map._options.center).toEqual([135.5, 34.85]) // [lng, lat]順
    expect(mockState.api._state.markers[0]._lngLat).toEqual([135.5, 34.85])
  })

  it('座標がある場合、位置マップはスクロール領域の先頭に表示される', () => {
    renderDetail()
    // スクロール可能な本文コンテナの最初の子要素がマップ本体
    const content = document.querySelector('.overflow-y-auto')
    expect(content).toBeTruthy()
    const mapEl = content.firstElementChild
    expect(mapEl.getAttribute('role')).toBe('img')
    expect(mapEl.getAttribute('aria-label')).toContain('位置マップ')
  })

  it('座標がない要素では位置マップも非表示', () => {
    renderDetail({ type: 'node', id: 9, tags: { amenity: 'bench' } })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('img')).toBeNull()
    expect(mockState.api._state.maps).toHaveLength(0)
  })

  it('位置マップの追加でアクション（経路検索/iDで編集/閉じる）は維持される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: /経路検索/ })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /iDで編集/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeTruthy()
  })

  it('フッターに「地図で見る」ボタンは存在しない（シート内に位置マップが表示されるため）', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '地図で見る' })).toBeNull()
    // 位置マップ自体は表示されたまま
    expect(within(dialog).getByRole('img', { name: /位置マップ/ })).toBeTruthy()
  })
})

describe('MobileFacilityDetail: 経路検索ボタン', () => {
  it('座標がある場合、フッターに「経路検索」リンクが表示される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    const link = within(dialog).getByRole('link', { name: /経路検索/ })
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=34.85,135.5')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('座標がない要素では「経路検索」リンクが表示されない', () => {
    renderDetail({ type: 'node', id: 9, tags: { amenity: 'bench' } })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('link', { name: /経路検索/ })).toBeNull()
  })

  it('アクションは経路検索/iDで編集/閉じる（右上✕）で、「地図で見る」は含まれない', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '地図で見る' })).toBeNull()
    expect(within(dialog).getByRole('link', { name: /経路検索/ })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /iDで編集/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeTruthy()
  })
})

describe('MobileFacilityDetail: バリアフリー情報（#61）', () => {
  it('wheelchair=yes なら「車椅子対応」バッジが表示される', () => {
    renderDetail({
      type: 'node', id: 5, lat: 34.8, lon: 135.5,
      tags: { amenity: 'restaurant', wheelchair: 'yes' }
    })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/バリアフリー情報/)).toBeTruthy()
    expect(within(dialog).getByText('車椅子対応')).toBeTruthy()
  })

  it('wheelchair=limited + 説明（:ja優先）がnoteとして表示される', () => {
    renderDetail({
      type: 'node', id: 6, lat: 34.8, lon: 135.5,
      tags: {
        amenity: 'cinema',
        wheelchair: 'limited',
        'wheelchair:description': 'steps at main entrance',
        'wheelchair:description:ja': '正面入口に段差あり（7cm未満）'
      }
    })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('車椅子一部対応')).toBeTruthy()
    // 説明はバリアフリーセクションのnoteに出る（タグ一覧は廃止されたため1箇所のみ）
    expect(within(dialog).getAllByText('正面入口に段差あり（7cm未満）')).toHaveLength(1)
  })

  it('トイレ・駐車・エレベーター等の複数項目が並ぶ', () => {
    renderDetail({
      type: 'way', id: 8, lat: 34.8, lon: 135.5,
      tags: {
        amenity: 'supermarket',
        wheelchair: 'yes',
        'toilets:wheelchair': 'no',
        'capacity:disabled': '2',
        elevator: 'yes', 'elevator:count': '1',
        tactile_paving: 'yes'
      }
    })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('車椅子対応')).toBeTruthy()
    expect(within(dialog).getByText('バリアフリートイレ')).toBeTruthy()
    expect(within(dialog).getByText('なし')).toBeTruthy()
    expect(within(dialog).getByText('2台')).toBeTruthy()
    expect(within(dialog).getByText('エレベーター')).toBeTruthy()
    expect(within(dialog).getByText('点字ブロック')).toBeTruthy()
  })

  it('バリアフリータグがなければセクション自体が表示されない', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText(/バリアフリー情報/)).toBeNull()
  })
})

describe('MobileFacilityDetail: SNSリンク', () => {
  it('SNSタグが登録されている場合のみ、正しいURLでラベル付き外部リンクが表示される', () => {
    renderDetail({
      type: 'node', id: 3, lat: 34.8, lon: 135.5,
      tags: {
        amenity: 'cafe',
        phone: '+81-6-1234-5678',
        website: 'https://example.com/coffee',
        'contact:instagram': 'saka.cafe',           // アカウント名
        'contact:facebook': 'https://www.facebook.com/saka.cafe', // http値はそのまま
        'contact:twitter': '@saka',                 // 先頭@除去してx.com/<名>
        'contact:youtube': 'saka.channel'           // アカウント名
      }
    })
    const dialog = screen.getByRole('dialog')

    // アカウント名 → https://<ドメイン>/<名>（先頭@除去）
    const insta = within(dialog).getByRole('link', { name: /^Instagram/ })
    expect(insta.getAttribute('href')).toBe('https://instagram.com/saka.cafe')
    // http値はそのままURLとして使用
    const fb = within(dialog).getByRole('link', { name: /^Facebook/ })
    expect(fb.getAttribute('href')).toBe('https://www.facebook.com/saka.cafe')
    const x = within(dialog).getByRole('link', { name: /^X/ })
    expect(x.getAttribute('href')).toBe('https://x.com/saka')
    const yt = within(dialog).getByRole('link', { name: /^YouTube/ })
    expect(yt.getAttribute('href')).toBe('https://youtube.com/saka.channel')

    // すべて外部リンク（target=_blank + rel=noopener）
    for (const link of [insta, fb, x, yt]) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
    }
    // 表示テキストはアカウント名（先頭@なし）
    expect(x.textContent).toContain('saka')
    expect(insta.textContent).toContain('saka.cafe')
  })

  it('SNSタグが登録されていない場合はSNSリンクが表示されない', () => {
    renderDetail() // FULL: SNSタグなし
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('link', { name: /^Instagram/ })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: /^Facebook/ })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: /^X/ })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: /^YouTube/ })).toBeNull()
  })

  it('登録済みのSNSは一部だけならその分のみ表示される', () => {
    renderDetail({
      type: 'node', id: 4, lat: 34.8, lon: 135.5,
      tags: { amenity: 'bar', 'contact:instagram': '@bar.japan' }
    })
    const dialog = screen.getByRole('dialog')
    const insta = within(dialog).getByRole('link', { name: /^Instagram/ })
    expect(insta.getAttribute('href')).toBe('https://instagram.com/bar.japan')
    expect(within(dialog).queryByRole('link', { name: /^Facebook/ })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: /^X/ })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: /^YouTube/ })).toBeNull()
  })
})
