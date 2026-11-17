// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import MobileFacilityDetail from '../MobileFacilityDetail'
import { MEMOCHO_STORAGE_KEY } from '../../../utils/memocho'
import { resetMemochoStore } from '../../../hooks/useMemocho'

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
 * - 座標がある場合、ヘッダーと情報エリアの間（スクロール領域の外）に位置マップ
 *   （MiniLocationMap）＋マーカーを表示。地図エリアは flex-1（最小高さ220px）で
 *   シート高さに応じて伸縮する。地図自体はインタラクティブ（パン/ピンチズーム可、
 *   回転・pitchは無効）
 * - 座標がない場合は地図エリア自体も非表示（その分情報エリアが広がる）
 * - 「地図で見る」ボタンは削除済み（シート内に位置マップが表示されるため不要）
 * 固定高さシート（h-[85dvh]）
 * - 2段階（half/full）シートと取っ手のドラッグ/タップ切替は廃止（実機フィードバック）
 * - 開いた時点で 85dvh の固定高さ。全項目（基本4項目・カテゴリ追加項目・メール/FAX・
 *   SNS・バリアフリー情報・座標・OSMリンク）を最初から表示する
 * - 取っ手のバーは撤去。シートは flex column: ヘッダー（auto）→ 地図エリア
 *   （座標がある場合のみ・flex-1・最小高さ220px・スクロール領域の外）→ 情報エリア
 *   （flex-1・overflow-y-auto）→ フッター（auto・常に最下部に固定）。地図自体は
 *   インタラクティブ（パン/ピンチズーム可・回転・pitch無効）
 * - 「本体地図で見る」導線（onShowOnMap）は廃止: 詳細内地図がインタラクティブに
 *   なったため不要。onShowOnMap prop・role=button ラッパー・「本体地図で見る」
 *   ラベルは削除済み
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
  localStorage.clear()
  resetMemochoStore()
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

  it('OSM ID・座標・OSMリンクが表示される（最初から表示される）', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    // OSM ID（type/id）はヘッダーに表示される
    expect(within(dialog).getByText('node/1001')).toBeTruthy()
    // 座標行・OSMリンクも最初から表示される（2段階廃止）
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
    // 基本4項目は基本行で1回のみ（追加項目に二重表示されない）
    expect(within(dialog).getAllByText(/📞 \+81-6-1234-5678/)).toHaveLength(1)
    expect(within(dialog).getAllByText(/大阪市 梅田 1-1/)).toHaveLength(1)
    // cafeプロファイルの追加項目 cuisine は最初から表示される（2段階廃止）
    expect(within(dialog).getByText('🍴 coffee')).toBeTruthy()
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
    // メール・FAXも最初から表示される（2段階廃止）
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

  it('位置マップはインタラクティブな設定で生成される（パン/ピンチズーム有効・回転・pitch無効）', () => {
    renderDetail()
    const map = mockState.api._state.maps[0]
    expect(map).toBeTruthy()
    // 操作: ドラッグパン・ホイールズーム・ピンチズームは有効、キーボードはオフ
    expect(map._options.dragPan).toBe(true)
    expect(map._options.scrollZoom).toBe(true)
    expect(map._options.touchZoomRotate).toBe(true)
    expect(map._options.keyboard).toBe(false)
    // 回転・pitchは全地図の方針どおり無効
    expect(map._options.dragRotate).toBe(false)
    expect(map._options.maxPitch).toBe(0)
    expect(map._options.pitchWithRotate).toBe(false)
    // ピンチズームの捻り回転のみ無効化（ピンチズーム自体は有効なまま）
    expect(map.touchZoomRotate._rotationDisabled).toBe(true)
  })

  it('座標がある場合、位置マップはスクロール領域の外（ヘッダーと情報エリアの間）に配置される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    // 情報エリア（スクロール領域）は dialog の直接子
    const infoArea = dialog.querySelector('.overflow-y-auto')
    expect(infoArea).toBeTruthy()
    expect(infoArea.className).toContain('flex-1')
    const mapEl = within(dialog).getByRole('img', { name: /位置マップ/ })
    // 地図はスクロール領域の外にある
    expect(infoArea.contains(mapEl)).toBe(false)
    // 地図エリア（ラッパー）は dialog の直接子で、情報エリアより前に来る
    const zone = mapEl.parentElement
    expect(zone.parentElement).toBe(dialog)
    const children = Array.from(dialog.children)
    expect(children.indexOf(zone)).toBeLessThan(children.indexOf(infoArea))
    // 地図エリアは flex-1（シート高さに応じて伸縮）＋最小高さ220px
    expect(zone.className).toContain('flex-1')
    expect(zone.className).toContain('min-h-[220px]')
  })

  it('座標がない要素では地図エリア自体も非表示（その分情報エリアが広がる）', () => {
    renderDetail({ type: 'node', id: 9, tags: { amenity: 'bench' } })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('img')).toBeNull()
    expect(mockState.api._state.maps).toHaveLength(0)
    // flex-1 の子要素は情報エリアのみ（地図エリアの分の高さを情報エリアが占める）
    const flexChildren = Array.from(dialog.children).filter((el) =>
      typeof el.className === 'string' && el.className.includes('flex-1')
    )
    expect(flexChildren).toHaveLength(1)
    expect(flexChildren[0]).toBe(dialog.querySelector('.overflow-y-auto'))
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
    // バリアフリー情報は最初から表示される（2段階廃止）
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

describe('まちメモ帳ボタン（第2ピース・フッター）', () => {
  it('フッターに「メモ帳に追加」ボタンがあり、既存ボタンと同じ並び', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    // 経路検索・iDで編集・メモ帳に追加 の3アクションが並ぶ
    expect(within(dialog).getByRole('link', { name: /経路検索/ })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /iDで編集/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /メモ帳に追加/ })).toBeTruthy()
  })

  it('押すと追加され「メモ帳から削除」に変わり、もう一度押すと元に戻る（toggle）', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    const btn = within(dialog).getByRole('button', { name: /メモ帳に追加/ })
    expect(within(dialog).queryByRole('button', { name: /メモ帳から削除/ })).toBeNull()

    fireEvent.click(btn)
    // 表示が即座に「メモ帳から削除」に変わる
    expect(within(dialog).getByRole('button', { name: /メモ帳から削除/ })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /メモ帳に追加/ })).toBeNull()
    // localStorage にも保存される
    const stored = JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ type: 'node', id: 1001, name: 'テスト珈琲店' })

    // もう一度押すと削除され「メモ帳に追加」に戻る
    fireEvent.click(within(dialog).getByRole('button', { name: /メモ帳から削除/ }))
    expect(within(dialog).getByRole('button', { name: /メモ帳に追加/ })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))).toHaveLength(0)
  })

  it('既存アクション（経路検索・iDで編集・閉じる）はメモ帳ボタンの追加後も維持される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: /経路検索/ })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /iDで編集/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeTruthy()
  })

  it('localStorage に保存済みの施設ではフッター表示が「メモ帳から削除」', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      { type: 'node', id: 1001, name: 'テスト珈琲店', lat: 34.85, lon: 135.5, tags: null, memo: '', addedAt: null },
    ]))
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /メモ帳から削除/ })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /メモ帳に追加/ })).toBeNull()
  })
})

describe('MobileFacilityDetail: 固定高さシート（h-[85dvh]）', () => {
  it('シートは開いた時点で高さ85dvhの固定（h-[85dvh]）', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('h-[85dvh]')
    // max-h（上限指定）ではなく固定高さ
    expect(dialog.className).not.toContain('max-h-[85dvh]')
  })

  it('取っ手のバーは撤去されている（ドラッグ/タップ切替の廃止）', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'シートの大きさを切り替える' })).toBeNull()
  })

  it('全項目が最初から表示される（基本項目・ミニ地図・追加項目・SNS・バリアフリー・座標・OSMリンク・フッター）', () => {
    renderDetail({
      type: 'node', id: 1001, lat: 34.85, lon: 135.5,
      name: 'テスト珈琲店', // overpass.js が tags.name を上位に正規化した結果を模す
      tags: {
        name: 'テスト珈琲店', amenity: 'cafe', cuisine: 'coffee',
        'addr:city': '大阪市', 'addr:suburb': '梅田', 'addr:street': '1-1',
        phone: '+81-6-1234-5678', website: 'https://example.com/coffee',
        'contact:instagram': 'saka.cafe',
        wheelchair: 'yes'
      }
    })
    const dialog = screen.getByRole('dialog')
    // 基本項目
    expect(within(dialog).getByText('テスト珈琲店')).toBeTruthy()
    expect(within(dialog).getByText('カフェ')).toBeTruthy()
    expect(within(dialog).getByText(/大阪市 梅田 1-1/)).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /^電話/ })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /^Webサイト/ })).toBeTruthy()
    // ミニ地図
    expect(within(dialog).getByRole('img', { name: /位置マップ/ })).toBeTruthy()
    // 従来 full のみだった項目も最初から表示される
    expect(within(dialog).getByText('🍴 coffee')).toBeTruthy()
    expect(within(dialog).getByText(/34.85, 135.5/)).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /OSMで見る/ })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /^Instagram/ })).toBeTruthy()
    expect(within(dialog).getByText(/バリアフリー情報/)).toBeTruthy()
    // フッター3ボタン＋閉じる
    expect(within(dialog).getByRole('link', { name: /経路検索/ })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /iDで編集/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /メモ帳に追加/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeTruthy()
  })

  it('情報エリアは flex-1＋内部スクロール、フッターは最下部に固定される', () => {
    renderDetail()
    const dialog = screen.getByRole('dialog')
    // 情報エリア: flex-1（画面に応じて伸縮）+ overflow-y-auto（超過時のみ内部スクロール）
    const infoArea = dialog.querySelector('.overflow-y-auto')
    expect(infoArea).toBeTruthy()
    expect(infoArea.className).toContain('flex-1')
    // フッターはシート（dialog）の最後の直接子要素（最下部に固定）
    const footer = dialog.lastElementChild
    expect(footer.className).toContain('border-t')
    expect(within(footer).getByRole('button', { name: /メモ帳/ })).toBeTruthy()
  })

  it('✕と背景タップで閉じる挙動は現行どおり', () => {
    const onClose = vi.fn()
    renderDetail(FULL, { onClose })
    const dialog = screen.getByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    cleanup()
    const onClose2 = vi.fn()
    renderDetail(FULL, { onClose: onClose2 })
    const backdrop = document.querySelector('.bg-black\\/40')
    fireEvent.click(backdrop)
    expect(onClose2).toHaveBeenCalledTimes(1)
  })
})

describe('MobileFacilityDetail: 「本体地図で見る」導線は廃止（onShowOnMap 削除）', () => {
  it('地図エリアは導線としてタップ可能になっていない（role=button 付与なし・「本体地図で見る」ラベルなし）', () => {
    renderDetail(FULL)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'この施設を本体地図に表示' })).toBeNull()
    expect(within(dialog).queryByText('本体地図で見る')).toBeNull()
    // 地図自体はインタラクティブに表示されたまま（pointer-events: none なし）
    const mapEl = within(dialog).getByRole('img', { name: /位置マップ/ })
    expect(mapEl.className).not.toContain('pointer-events-none')
    expect(mapEl.parentElement.getAttribute('role')).toBeNull()
  })
})
