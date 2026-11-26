// @vitest-environment jsdom
/**
 * (ピースG1) 公開マップページ（/map/）のテスト
 *
 * fetch をモックしてネットワークには一切アクセスしない。
 * maplibre-gl は共通モック（maplibreMock）、地図サムネイル生成
 * （mapCapture）もモックする。
 *
 * 検証内容:
 * - userid 指定 → カードと地図ピンが描画される（ピンは tags のアイコン）
 * - tags がアイコン・種別ラベルを決定する（cafe → カフェ・cafe.png）
 * - userid なし → 案内文が表示され、データ取得はされない
 * - tags の無いアイテム → フォールバックアイコンでカードが表示される
 * - 座標の無いアイテム → カードは表示されるが地図ピンは出ない
 * - 取得失敗 → role="alert" でエラー表示
 * - 件数0 → 「見つかりませんでした」表示
 *
 * (ピースG2)
 * - フィルタ（キーワード）でカード一覧と地図ピンの両方が絞り込まれる
 * - 絞り込みで0件 → 案内文＋「フィルタをリセット」で復旧
 * - 「メモ帳に追加」タップ → この端末のメモ帳に保存（投稿の tags を含む）
 * - 登録済み施設 → 「登録済み」表示・タップで削除（ごみ箱）
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import PublicMapPage from '../PublicMapPage'
import { MEMOCHO_STORAGE_KEY } from '../../../utils/memocho'
import { resetMemochoStore } from '../../../hooks/useMemocho'

const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
})

vi.mock('../../../utils/mapCapture', () => ({
  captureMapImage: vi.fn(async () => 'data:image/jpeg;base64,QUJD'),
}))

function makeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

/** activities.php のレスポンスを返す fetch モック（calls にURLを記録） */
function mockFetch(activities, { calls, status = 200, body } = {}) {
  const mock = vi.fn(async (url) => {
    if (calls) calls.push(String(url))
    const u = String(url)
    if (!u.includes('/api/activities.php')) throw new Error(`unexpected url: ${u}`)
    return makeResponse(status, body ?? activities)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** CMM Activity フィクスチャ（スキーマフィールドはトップレベル展開） */
function makeActivity(overrides = {}) {
  return {
    id: 1,
    app_key: 'machi-scrapbook',
    activity_key: 'node/1001',
    osmid: 'node/1001',
    name: 'テスト珈琲店',
    memo: '',
    rating: null,
    book: null,
    tags: JSON.stringify({ amenity: 'cafe', name: 'テスト珈琲店' }),
    latitude: 34.85,
    longitude: 135.5,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setUrl(path) {
  window.history.pushState({}, '', path)
}

// 地図はマウント後の effect で非同期に生成される（モックの load は
// queueMicrotask）。高負荷時（全件テスト実行）に生成がカード表示より
// 遅れることがあるため、生成を待ってから返す
async function getMap() {
  await waitFor(() => {
    if (!mockState.api._state.maps.at(-1)) throw new Error('マップがまだ生成されていません')
  }, 3000)
  return mockState.api._state.maps.at(-1)
}

beforeEach(() => {
  setUrl('/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('userid 指定', () => {
  it('カードと地図ピンが描画される', async () => {
    const calls = []
    mockFetch([
      makeActivity(),
      makeActivity({
        id: 2,
        activity_key: 'node/2002',
        osmid: 'node/2002',
        name: 'テスト図書館',
        tags: JSON.stringify({ amenity: 'library', name: 'テスト図書館' }),
        latitude: 34.86,
        longitude: 135.51,
      }),
    ], { calls })
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    // カードが描画される
    expect(await screen.findByText('テスト珈琲店')).toBeTruthy()
    expect(screen.getByText('テスト図書館')).toBeTruthy()
    // userid 付きで CMM 一覧を取得している
    expect(calls.some((u) => u.includes('/api/activities.php') && u.includes('userid=testuser'))).toBe(true)

    // 地図ピン: 最後の setData GeoJSON に2機能・tags 由来のアイコン名
    const map = await getMap()
    await waitFor(() => {
      expect(map._lastGeoJSON.data.features).toHaveLength(2)
    }, 3000)
    const cafe = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/1001')
    expect(cafe.properties.icon).toBe('cafe.png')
    const library = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/2002')
    expect(library.properties.icon).toBe('library.png')
  })

  it('tags がアイコンと種別ラベルを決定する', async () => {
    mockFetch([makeActivity()])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    const name = await screen.findByText('テスト珈琲店')
    // 施設アイコン（amenity=cafe → cafe.png）
    const iconImg = name.parentElement.querySelector('img')
    expect(iconImg.getAttribute('src')).toBe('/icons/cafe.png')
    // 種別ラベル（コンパクットモードでは「施設情報」セクション内に折りたたまれる）
    fireEvent.click(screen.getByRole('button', { name: /施設情報/ }))
    expect(await screen.findByText('カフェ')).toBeTruthy()
  })

  it('ページタイトルにユーザーIDが表示される', async () => {
    mockFetch([makeActivity()])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    await screen.findByText('テスト珈琲店')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('testuserさんの公開マップ')
  })

  it('ピンタップで対応カードが選択される', async () => {
    mockFetch([makeActivity(), makeActivity({
      id: 2,
      activity_key: 'node/2002',
      osmid: 'node/2002',
      name: 'テスト図書館',
      tags: JSON.stringify({ amenity: 'library' }),
      latitude: 34.86,
      longitude: 135.51,
    })])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)
    // カードが表示された（= このテスト用の地図がマウントされた）のを待つ
    await screen.findByText('テスト図書館')
    const map = await getMap()
    await waitFor(() => {
      expect(map._lastGeoJSON.data.features).toHaveLength(2)
    }, 3000)

    // ピン（poi-icon レイヤ）をクリック
    map.fire('click', 'poi-icon', { features: [{ properties: { key: 'node/2002' } }] })
    await waitFor(() => {
      expect(document.getElementById('map-card-node/2002').className).toContain('ring-primary-500')
    })
  })

  it('メモ・評価・ブックが読み取り専用で表示される', async () => {
    mockFetch([makeActivity({ memo: '窓際がおすすめ', rating: '5', book: 'お気に入り' })])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    await screen.findByText('テスト珈琲店')
    expect(screen.getByText('窓際がおすすめ')).toBeTruthy()
    expect(screen.getByText('お気に入り')).toBeTruthy()
    expect(screen.getByText('★★★★★')).toBeTruthy()
  })
})

describe('userid なし', () => {
  it('案内文が表示され、データ取得はされない', async () => {
    const calls = []
    mockFetch([], { calls })
    setUrl('/map/')
    render(<PublicMapPage />)

    expect(screen.getByText('ユーザーIDをURLに指定してください')).toBeTruthy()
    expect(screen.getByText('userid')).toBeTruthy()
    // 非同期呼び出しが入る余地を置いてから未取得を確認
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toEqual([])
  })
})

describe('データの変換', () => {
  it('tags の無いアイテムはフォールバックアイコンでカードが表示される', async () => {
    mockFetch([makeActivity({ tags: null })])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    const name = await screen.findByText('テスト珈琲店')
    const iconImg = name.parentElement.querySelector('img')
    expect(iconImg.getAttribute('src')).toBe('/icons/marker-stroked.png')
  })

  it('osmid が不正な Activity はカードに出ない', async () => {
    mockFetch([
      makeActivity(),
      makeActivity({ id: 9, activity_key: 'building/9', osmid: 'building/9', name: '不正osmid' }),
    ])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    expect(await screen.findByText('テスト珈琲店')).toBeTruthy()
    expect(screen.queryByText('不正osmid')).toBeNull()
  })

  it('座標の無いアイテムはカードは表示されるが地図ピンは出ない', async () => {
    mockFetch([
      makeActivity({ latitude: null, longitude: null }),
      makeActivity({
        id: 2,
        activity_key: 'node/2002',
        osmid: 'node/2002',
        name: 'テスト図書館',
        tags: JSON.stringify({ amenity: 'library' }),
        latitude: 34.86,
        longitude: 135.51,
      }),
    ])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    // 両方ともカードが出る
    expect(await screen.findByText('テスト珈琲店')).toBeTruthy()
    expect(screen.getByText('テスト図書館')).toBeTruthy()
    // ピンは座標のある1件のみ
    const map = await getMap()
    await waitFor(() => {
      expect(map._lastGeoJSON.data.features).toHaveLength(1)
    })
    expect(map._lastGeoJSON.data.features[0].properties.key).toBe('node/2002')
  })

  it('件数0の場合は「見つかりませんでした」表示', async () => {
    mockFetch([])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    expect(await screen.findByText(/公開データが見つかりませんでした/)).toBeTruthy()
  })
})

describe('エラー', () => {
  it('取得失敗は role="alert" で表示される', async () => {
    mockFetch(null, { status: 404, body: { code: 'project_not_found', message: 'プロジェクトが見つかりません' } })
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('プロジェクトが見つかりません')
  })

  it('ネットワークエラーも role="alert" で表示される', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('読み込めませんでした')
  })
})

describe('ピースG2: フィルタ・メモ帳追加', () => {
  // 「メモ帳に追加」は端末のメモ帳（モジュールストア＋localStorage）を変更するため、
  // テスト間で隔離する
  beforeEach(() => {
    localStorage.clear()
    resetMemochoStore()
  })
  afterEach(() => {
    localStorage.clear()
    resetMemochoStore()
  })

  it('キーワード絞り込みでカード一覧と地図ピンの両方が絞られる', async () => {
    mockFetch([
      makeActivity({ tags: JSON.stringify({ amenity: 'cafe', name: 'テスト珈琲店', internet_access: 'yes' }) }),
      makeActivity({
        id: 2,
        activity_key: 'node/2002',
        osmid: 'node/2002',
        name: 'テスト図書館',
        tags: JSON.stringify({ amenity: 'library', name: 'テスト図書館' }),
        latitude: 34.86,
        longitude: 135.51,
      }),
    ])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)
    expect(await screen.findByText('テスト珈琲店')).toBeTruthy()
    expect(screen.getByText('テスト図書館')).toBeTruthy()

    // キーワード「珈琲」で絞り込む
    fireEvent.change(
      screen.getByRole('textbox', { name: '名前・メモで絞り込む' }),
      { target: { value: '珈琲' } },
    )

    // カード一覧: カフェだけ残る
    expect(screen.getByText('テスト珈琲店')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('テスト図書館')).toBeNull())
    // 件数表示: 「全2件中、1件を表示」
    expect(screen.getByText('全2件中、1件を表示')).toBeTruthy()
    // 地図ピンも絞られる（GeoJSON にカフェだけ）
    const map = await getMap()
    await waitFor(() => {
      expect(map._lastGeoJSON.data.features).toHaveLength(1)
    })
    expect(map._lastGeoJSON.data.features[0].properties.key).toBe('node/1001')
  })

  it('絞り込みで0件のときは案内文が出て、リセットで復旧する', async () => {
    mockFetch([makeActivity()])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)
    await screen.findByText('テスト珈琲店')

    fireEvent.change(
      screen.getByRole('textbox', { name: '名前・メモで絞り込む' }),
      { target: { value: '図書館' } },
    )
    expect(await screen.findByText('現在の絞り込み条件に一致するアイテムはありません。')).toBeTruthy()
    expect(screen.queryByText('テスト珈琲店')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'フィルタをリセット' }))
    expect(await screen.findByText('テスト珈琲店')).toBeTruthy()
    expect(screen.getByText('1件')).toBeTruthy()
  })

  it('「メモ帳に追加」でこの端末のメモ帳に保存される（tags を含む）', async () => {
    mockFetch([makeActivity({
      tags: JSON.stringify({
        amenity: 'cafe',
        name: 'テスト珈琲店',
        internet_access: 'yes',
        opening_hours: '09/01-17/12',
      }),
    })])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)
    await screen.findByText('テスト珈琲店')

    // 「メモ帳に追加」ボタンがある（検索結果カードと同じトグル）
    fireEvent.click(await screen.findByRole('button', { name: /メモ帳に追加/ }))

    // ボタンが「登録済み」に切り替わる
    expect(await screen.findByRole('button', { name: /登録済み/ })).toBeTruthy()

    // localStorage のメモ帳に、投稿の tags を含むアイテムが保存される
    const stored = JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
    const item = stored.find((i) => i.type === 'node' && i.id === 1001)
    expect(item).toBeTruthy()
    expect(item.name).toBe('テスト珈琲店')
    expect(item.tags).toEqual({
      amenity: 'cafe',
      name: 'テスト珈琲店',
      internet_access: 'yes',
      opening_hours: '09/01-17/12',
    })
    expect(item.memo).toBe('')
    expect(item.rating).toBe(0)
  })

  it('登録済みの施設は「登録済み」表示で、タップで削除される（検索結果と同じ扱い）', async () => {
    // 事前登録: 端末のメモ帳に node/1001 が入っている
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([
      {
        type: 'node',
        id: 1001,
        name: 'テスト珈琲店',
        lat: 34.85,
        lon: 135.5,
        tags: { amenity: 'cafe', name: 'テスト珈琲店' },
        memo: '',
        rating: 0,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ]))
    mockFetch([makeActivity()])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    // 初回表示が「登録済み」
    expect(await screen.findByRole('button', { name: /登録済み/ })).toBeTruthy()

    // タップするとごみ箱へ移動し、ボタンが「メモ帳に追加」に戻る
    fireEvent.click(screen.getByRole('button', { name: /登録済み/ }))
    expect(await screen.findByRole('button', { name: /メモ帳に追加/ })).toBeTruthy()
    const stored = JSON.parse(localStorage.getItem(MEMOCHO_STORAGE_KEY))
    const item = stored.find((i) => i.type === 'node' && i.id === 1001)
    expect(item.deletedAt).toBeTruthy()
  })
})

describe('公開マップ: カード列数の仕様を3画面で統一しCSSを共通化（ピースP）', () => {
  it('カード一覧は共通の .card-grid を使い、スクロールコンテナに container-type: inline-size がある', async () => {
    mockFetch([makeActivity()])
    setUrl('/map/?userid=testuser')
    render(<PublicMapPage />)

    await screen.findByText('テスト珈琲店')
    const cardList = screen.getByText('テスト珈琲店').closest('ul')
    expect(cardList).toBeTruthy()
    expect(cardList.className).toContain('card-grid')
    // コンテナクエリのため、一覧のスクロールコンテナが container になっている
    expect(cardList.parentElement.className).toContain('[container-type:inline-size]')
  })
})
