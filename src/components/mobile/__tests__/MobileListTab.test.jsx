// @vitest-environment jsdom
/**
 * (#44) MobileListTab:
 * - カテゴリドロップダウンの操作が検索フォームにdispatchされる（地図/自治体モード両方）
 * - 「フィルタをリセット」で検索フォームのカテゴリ・目的も一緒に解除される
 * - 公式サイトがあればカードに🌐アイコン行が表示される
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, waitFor, act } from '@testing-library/react'
import { AppContext } from '../../../context/AppContext'
import { appReducer, createInitialState } from '../../../state/appReducer'
import MobileListTab from '../MobileListTab'

// 実際のOverpass正規化と同様に tags.name → 顶层name にコピーする
// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
// (修正) 一覧タブに MobileResultsMap を埋め込んだため必須。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return { default: mockState.api }
})

const cafeWithWeb = { type: 'node', id: 1, name: 'カフェA', tags: { amenity: 'cafe', website: 'https://cafe.example.jp', name: 'カフェA' } }
const park = { type: 'node', id: 2, name: '中央公園', tags: { leisure: 'park', name: '中央公園' } }

function Harness({ preActions = [], log = [], children }) {
  const [state, rawDispatch] = React.useReducer(
    appReducer,
    preActions,
    (acts) => acts.reduce((s, a) => appReducer(s, a), createInitialState())
  )
  const dispatch = (a) => {
    log.push(a)
    rawDispatch(a)
  }
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children || <MobileListTab onOpenDetail={vi.fn()} />}
    </AppContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  if (mockState.api) mockState.api.resetState()
})
afterEach(() => cleanup())

describe('MobileListTab: カテゴリ選択=検索フォームと同期 (#44)', () => {
  it('地図モード: ドロップダウンでカテゴリを選ぶとSET_SIMPLE_SEARCHにdispatchされparkが絞られる', () => {
    const log = []
    render(<Harness preActions={[{ type: 'SET_SEARCH_SOURCE', payload: 'map' }, { type: 'SET_RESULTS', payload: [cafeWithWeb, park] }, { type: 'SET_STATUS', payload: 'success' }]} log={log} />)

    expect(screen.getByText('中央公園')).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'カテゴリで絞り込む' })
    fireEvent.change(select, { target: { value: 'cafe' } })

    expect(log.some(a => a.type === 'SET_SIMPLE_SEARCH' && a.payload.category === 'cafe')).toBe(true)
    expect(screen.queryByText('中央公園')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'カテゴリで絞り込む' }).value).toBe('cafe')
  })

  it('自治体モード: ドロップダウンの操作はSET_MUNICIPALITY_SEARCHにdispatchされる', () => {
    const log = []
    render(<Harness
      preActions={[
        { type: 'SET_SEARCH_SOURCE', payload: 'municipality' },
        { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
        { type: 'SET_STATUS', payload: 'success' }
      ]}
      log={log}
    />)
    const select = screen.getByRole('combobox', { name: 'カテゴリで絞り込む' })
    fireEvent.change(select, { target: { value: 'park' } })

    expect(log.some(a => a.type === 'SET_MUNICIPALITY_SEARCH' && a.payload.category === 'park')).toBe(true)
    expect(log.some(a => a.type === 'SET_SIMPLE_SEARCH')).toBe(false)
    expect(screen.getByRole('combobox', { name: 'カテゴリで絞り込む' }).value).toBe('park')
  })

  it('「フィルタをリセット」で検索フォームのカテゴリ・目的も解除される', async () => {
    const log = []
    render(<Harness
      preActions={[
        { type: 'SET_SEARCH_SOURCE', payload: 'map' },
        { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
        { type: 'SET_STATUS', payload: 'success' },
        { type: 'SET_SIMPLE_SEARCH', payload: { category: 'cafe' } },
        { type: 'SET_RESULT_FILTERS', payload: { nameFilter: '存在しない名' } }
      ]}
      log={log}
    />)

    // 条件に一致する施設なし → リセットボタン表示
    expect(screen.getByText(/現在の絞り込み条件に一致する施設はありません/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'フィルタをリセット' }))

    expect(log.some(a => a.type === 'SET_SIMPLE_SEARCH' && a.payload.category === '' && a.payload.purpose === '')).toBe(true)
    expect(log.some(a => a.type === 'SET_RESULT_FILTERS' && a.payload.nameFilter === '' && a.payload.catFilter === '' && a.payload.purposeFilter === '')).toBe(true)

    // 両方（cafe+park）が再び表示される
    await waitFor(() => {
      expect(screen.getByText('カフェA')).toBeTruthy()
      expect(screen.getByText('中央公園')).toBeTruthy()
    })
  })
})

describe('MobileListTab: 公式サイトアイコン', () => {
  it('websiteタグがある施設カードに🌐アイコン行が表示される', () => {
    const log = []
    render(<Harness preActions={[{ type: 'SET_RESULTS', payload: [cafeWithWeb, park] }, { type: 'SET_STATUS', payload: 'success' }]} log={log} />)
    expect(screen.getByText(/公式サイト/)).toBeTruthy()
    // parkカードには出ない
    expect(screen.getAllByText(/公式サイト/)).toHaveLength(1)
  })
})

describe('MobileListTab: 属性の充足率表示 (B1)', () => {
  it('表示中結果の属性充足率が一覧上部に「あり X/Y件」で表示される', () => {
    const cafePhone = { type: 'node', id: 3, name: 'カフェB', tags: { amenity: 'cafe', phone: '06-1111-0000', 'addr:street': '天神3-4-5', name: 'カフェB' } }
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb, cafePhone, park] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    expect(screen.getByText(/電話あり 1\/3件/)).toBeTruthy()
    expect(screen.getByText(/営業時間あり 0\/3件/)).toBeTruthy()
    expect(screen.getByText(/Webサイトあり 1\/3件/)).toBeTruthy()
    expect(screen.getByText(/住所あり 1\/3件/)).toBeTruthy()
  })

  it('カテゴリ絞り込み後に充足率が再計算される', () => {
    const cafePhone = { type: 'node', id: 3, name: 'カフェB', tags: { amenity: 'cafe', phone: '06-1111-0000', name: 'カフェB' } }
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb, cafePhone, park] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    const select = screen.getByRole('combobox', { name: 'カテゴリで絞り込む' })
    fireEvent.change(select, { target: { value: 'cafe' } })

    // park が絞られて 2 件ベースに再計算される
    expect(screen.getByText(/電話あり 1\/2件/)).toBeTruthy()
    expect(screen.getByText(/Webサイトあり 1\/2件/)).toBeTruthy()
  })

  it('結果なし（0件）ときは充足率表示が出ない', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    expect(screen.queryByText(/電話あり/)).toBeNull()
  })
})

describe('MobileListTab: 0件時の導線 (A4)', () => {
  it('未登録絞り込みで0件なら「主要属性が充実しています」として好機伝える', () => {
    const complete = { type: 'node', id: 1, name: '充実カフェ', tags: { amenity: 'cafe', name: '充実カフェ', phone: '06-1111-1111', opening_hours: 'Mo-Su 08:00-20:00', website: 'https://complete.example', 'addr:street': '梅田1-1' } }
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [complete] },
      { type: 'SET_STATUS', payload: 'success' },
      { type: 'SET_RESULT_FILTERS', payload: { missingFilter: 'any' } }
    ]} />)
    expect(screen.getByText(/主要属性が充実しています/)).toBeTruthy()
    expect(screen.queryByText(/現在の絞り込み条件に一致する施設はありません/)).toBeNull()
  })
})

describe('MobileListTab: 属性の欠落絞り込み (B2)', () => {
  const cafeFull = { type: 'node', id: 20, name: '完全カフェ', tags: { amenity: 'cafe', name: '完全カフェ', phone: '06-1111-1111', opening_hours: 'Mo-Fr 09:00-17:00', website: 'https://full.example', 'addr:street': '梅田1-1' } }
  const cafeNoPhone = { type: 'node', id: 21, name: '電話なしカフェ', tags: { amenity: 'cafe', name: '電話なしカフェ', opening_hours: 'Mo-Fr 09:00-17:00', website: 'https://nophone.example', 'addr:street': '梅田2-2' } }

  it('特定属性を選ぶと未登録のカードだけが残り、欠落バッジが出る', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeFull, cafeNoPhone] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    fireEvent.change(screen.getByRole('combobox', { name: '属性の欠落で絞る' }), { target: { value: 'phone' } })

    expect(screen.queryByText('完全カフェ')).toBeNull()
    expect(screen.getByText('電話なしカフェ')).toBeTruthy()
    expect(screen.getByText(/⚠️ 電話 未登録/)).toBeTruthy()
  })

  it('リセットでmissingFilterも解除され全件に戻る', async () => {
    const log = []
    render(<Harness
      preActions={[
        { type: 'SET_RESULTS', payload: [cafeFull, cafeNoPhone] },
        { type: 'SET_STATUS', payload: 'success' },
        { type: 'SET_RESULT_FILTERS', payload: { missingFilter: 'phone', nameFilter: '存在しない名' } }
      ]}
      log={log}
    />)

    expect(screen.queryByText('完全カフェ')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'フィルタをリセット' }))

    expect(log.some(a => a.type === 'SET_RESULT_FILTERS' && a.payload.missingFilter === 'none' && a.payload.nameFilter === '')).toBe(true)
    await waitFor(() => {
      expect(screen.getByText('完全カフェ')).toBeTruthy()
      expect(screen.getByText('電話なしカフェ')).toBeTruthy()
    })
  })
})

describe('MobileListTab: カテゴリ選択肢は取得データに基づいて絞り込まれる (#44)', () => {
  it('結果に出現したカテゴリのみを件数付きで表示する', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    const select = screen.getByRole('combobox', { name: 'カテゴリで絞り込む' })
    const optTexts = [...select.options].map((o) => o.textContent)
    expect(optTexts).toContain('カテゴリ: すべて（2件）')
    expect(optTexts).toContain('カフェ（1件）')
    expect(optTexts).toContain('公園・広場（1件）')
    expect(optTexts.some((t) => t.startsWith('レストラン'))).toBe(false)
  })

  it('結果なしときはカテゴリセレクト自体が表示されない（フィルタバー非表示）', () => {
    render(<Harness />)
    expect(screen.queryByRole('combobox', { name: 'カテゴリで絞り込む' })).toBeNull()
  })
})

// ===== 視点フィルタ（視点で絞るチップ） =====
const cafeWc = { type: 'node', id: 50, name: 'バリアフリーカフェ', tags: { amenity: 'cafe', wheelchair: 'yes', name: 'バリアフリーカフェ' } }
const cafeNoWc = { type: 'node', id: 51, name: '階段カフェ', tags: { amenity: 'cafe', name: '階段カフェ' } }
const cafeDiaper = { type: 'node', id: 52, name: 'オムツ台カフェ', tags: { amenity: 'cafe', diaper: 'yes', name: 'オムツ台カフェ' } }


describe('MobileListTab: 視点フィルタチップ（POI一覧）', () => {
  it('チップ行（すべて/車椅子/目の不自由な方/子ども連れ/お年寄り）がフィルタバーに出る', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWc, cafeNoWc] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    const group = screen.getByRole('group', { name: '視点で絞る' })
    for (const label of ['すべて', '車椅子', '目の不自由な方', '子ども連れ', 'お年寄り']) {
      expect(within(group).getByRole('button', { name: label })).toBeTruthy()
    }
    // 初期状態: 「すべて」が選択済み（aria-pressed=true）、他は false
    expect(within(group).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(group).getByRole('button', { name: '車椅子' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('「Webサイトがあるものだけ」の絞り込みは無い（未登録の絞り込みに一本化）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb, cafeNoWc] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    expect(screen.queryByRole('button', { name: 'Webサイトがあるものだけ' })).toBeNull()
    expect(screen.queryByText('Webサイトがあるものだけ')).toBeNull()
  })

  it('視点フィルタの説明ボタン: モーダルに素人向け説明とタグ詳細が出て、閉じられる', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWc, cafeNoWc] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '視点フィルタの説明' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('視点フィルタについて')).toBeTruthy()
    expect(within(dialog).getByText(/点字ブロックや、音・振動で知らせる信号/)).toBeTruthy()
    expect(within(dialog).getByText(/おむつ替え台や、子ども向けの設備/)).toBeTruthy()
    expect(within(dialog).getByText(/tactile_paving=yes/)).toBeTruthy()
    expect(within(dialog).getByText(/changing_table=yes/)).toBeTruthy()
    expect(within(dialog).getByText(/elevator=yes/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('車椅子チップを選ぶと該当施設だけが残る（aria-pressedも更新される）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWc, cafeNoWc] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    const group = screen.getByRole('group', { name: '視点で絞る' })
    fireEvent.click(within(group).getByRole('button', { name: '車椅子' }))

    expect(screen.getByText('バリアフリーカフェ')).toBeTruthy()
    expect(screen.queryByText('階段カフェ')).toBeNull()
    expect(screen.getByText(/2件中、1件を表示/)).toBeTruthy()
    expect(within(group).getByRole('button', { name: '車椅子' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(group).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('子ども連れチップでは diaper=yes の施設だけが残る（no/未登録は除外）', () => {
    const cafeDiaperNo = { type: 'node', id: 53, name: 'オムツ台なしカフェ', tags: { amenity: 'cafe', diaper: 'no', name: 'オムツ台なしカフェ' } }
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeDiaper, cafeDiaperNo, cafeNoWc] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    fireEvent.click(screen.getByRole('button', { name: '子ども連れ' }))

    expect(screen.getByText('オムツ台カフェ')).toBeTruthy()
    expect(screen.queryByText('オムツ台なしカフェ')).toBeNull()
    expect(screen.queryByText('階段カフェ')).toBeNull()
  })

  it('すべてチップで絞り込みが解除され全件に戻る', async () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWc, cafeNoWc] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    fireEvent.click(screen.getByRole('button', { name: '車椅子' }))
    expect(screen.queryByText('階段カフェ')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'すべて' }))
    await waitFor(() => {
      expect(screen.getByText('バリアフリーカフェ')).toBeTruthy()
      expect(screen.getByText('階段カフェ')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '車椅子' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('「フィルタをリセット」で perspective も none に戻り全件表示される', async () => {
    const log = []
    // wheelchair視点で全件除外される結果セット（0件 → 「フィルタをリセット」ボタン表示）
    render(<Harness
      preActions={[
        { type: 'SET_RESULTS', payload: [cafeNoWc, cafeDiaper] },
        { type: 'SET_STATUS', payload: 'success' },
        { type: 'SET_RESULT_FILTERS', payload: { perspective: 'wheelchair' } }
      ]}
      log={log}
    />)

    // wheelchair視点で0件（車椅子登録のない施設だけ）
    expect(screen.getByText(/現在の絞り込み条件に一致する施設はありません/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'フィルタをリセット' }))

    expect(log.some((a) => a.type === 'SET_RESULT_FILTERS' && a.payload.perspective === 'none')).toBe(true)
    await waitFor(() => {
      expect(screen.getByText('階段カフェ')).toBeTruthy()
      expect(screen.getByText('オムツ台カフェ')).toBeTruthy()
    })
  })
})

// ===== (#62) バリアフリー検索結果 =====
const bfFootway = {
  type: 'way',
  id: 100,
  name: '中央通り歩道',
  lat: 34.003333,
  lon: 135.01,
  tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' },
  osmId: 'way/100',
  bf: { kind: 'way', tactile: 'yes', lengthM: 152, kerb: null, hasSound: false, hasVibration: false, geometry: [[135.0, 34.0], [135.01, 34.01], [135.02, 34.0]] }
}
const bfKerb = {
  type: 'node',
  id: 200,
  name: null,
  lat: 34.1,
  lon: 135.1,
  tags: { barrier: 'kerb' },
  osmId: 'node/200',
  bf: { kind: 'node', tactile: null, lengthM: null, kerb: null, hasSound: false, hasVibration: false, geometry: [135.1, 34.1] }
}
const bfUnnamedFootway = {
  type: 'way',
  id: 101,
  name: null,
  lat: 34.003,
  lon: 135.01,
  tags: { highway: 'footway', tactile_paving: 'yes' },
  osmId: 'way/101',
  bf: { kind: 'way', tactile: 'yes', lengthM: 80, kerb: null, hasSound: false, hasVibration: false, geometry: [[135.0, 34.0], [135.01, 34.0]] }
}

// 新規テスト用のフィクチャ生成ヘルパ
function bfWayFixture(id, tags, tactile) {
  return {
    type: 'way',
    id,
    name: null,
    lat: 34.2,
    lon: 135.2,
    tags,
    osmId: `way/${id}`,
    bf: {
      kind: 'way',
      tactile: tactile ?? null,
      lengthM: 60,
      kerb: null,
      hasSound: false,
      hasVibration: false,
      geometry: [[135.2, 34.2], [135.21, 34.2]]
    }
  }
}
function bfKerbNodeFixture(id, kerb) {
  return {
    type: 'node',
    id,
    name: null,
    lat: 34.3,
    lon: 135.3,
    tags: { barrier: 'kerb', ...(kerb ? { kerb } : {}) },
    osmId: `node/${id}`,
    bf: {
      kind: 'node',
      tactile: null,
      lengthM: null,
      kerb: kerb ?? null,
      hasSound: false,
      hasVibration: false,
      geometry: [135.3, 34.3]
    }
  }
}
const bfSoundNode = {
  type: 'node',
  id: 305,
  name: null,
  lat: 34.4,
  lon: 135.4,
  tags: { 'traffic_signals:sound': 'yes' },
  osmId: 'node/305',
  bf: {
    kind: 'node',
    tactile: null,
    lengthM: null,
    kerb: null,
    hasSound: true,
    hasVibration: false,
    geometry: [135.4, 34.4]
  }
}

// 指定のosmIdのカード要素を取得（凡例等の同じ文字列マッチを除外するため）
function cardOf(osmId) {
  const idEl = screen.getByText(osmId)
  return idEl.closest('.shadow-sm')
}

const BF_MOBILE_RESULTS = [bfFootway, bfKerb]

function bfMobileActions(results = BF_MOBILE_RESULTS) {
  return [
    { type: 'SET_RESULTS', payload: results },
    { type: 'SET_RESULT_KIND', payload: 'barrier_free' },
    { type: 'SET_STATUS', payload: 'success' }
  ]
}

describe('MobileListTab: バリアフリー検索結果 (#62)', () => {
  it('専用カード（タイプ・点字ブロック・長さ・OSM ID・iDリンク）を表示する', () => {
    render(<Harness preActions={bfMobileActions()} />)

    expect(screen.getByText('2件中、2件を表示')).toBeTruthy()
    expect(screen.getByText('歩道')).toBeTruthy()
    expect(screen.getByText('中央通り歩道')).toBeTruthy()
    expect(screen.getByText('点字ブロック 有')).toBeTruthy()
    expect(screen.getByText('152 m')).toBeTruthy()
    // 名称が無い縁石はタイトルが種別ラベル「縁石」、バッジも「縁石」（カード内で計2件）
    const kerbCard = cardOf('node/200')
    expect(within(kerbCard).getAllByText('縁石')).toHaveLength(2)
    expect(within(kerbCard).queryByText('縁石（未記録）')).toBeNull()
    expect(screen.getByText('way/100')).toBeTruthy()
    const links = screen.getAllByRole('link', { name: /iDで編集/ })
    const hrefs = links.map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('https://www.openstreetmap.org/edit?node=way%2F100')
    expect(hrefs).toContain('https://www.openstreetmap.org/edit?node=node%2F200')
  })

  it('施設向けのコントロール（カテゴリ選択・Webサイトチェック）は表示しない', () => {
    render(<Harness preActions={bfMobileActions()} />)
    expect(screen.queryByRole('combobox', { name: 'カテゴリで絞り込む' })).toBeNull()
    expect(screen.queryByText('Webサイトがあるものだけ')).toBeNull()
    expect(screen.queryByRole('combobox', { name: '属性の欠落で絞る' })).toBeNull()
  })

  it('タイプフィルタで node のみを選択すると way 卡片が消える', () => {
    render(<Harness preActions={bfMobileActions()} />)
    expect(screen.getByText('中央通り歩道')).toBeTruthy()

    fireEvent.change(screen.getByRole('combobox', { name: '要素種別で絞り込む' }), { target: { value: 'node' } })

    expect(screen.queryByText('中央通り歩道')).toBeNull()
    expect(within(cardOf('node/200')).getAllByText('縁石')).toHaveLength(2)
  })

  it('名称が無い歩道はタイトルが種別ラベル「歩道」のみで、点字ブロック状態はバッジで出る', () => {
    render(<Harness preActions={bfMobileActions([bfUnnamedFootway])} />)

    // タイトル: 種別ラベルのみ（点字ブロックの状態は含まない）
    expect(screen.getByText('歩道')).toBeTruthy()
    expect(screen.queryByText(/歩道（点字ブロック/)).toBeNull()
    // 点字ブロックの状態はバッジとして表示
    expect(screen.getByText('点字ブロック 有')).toBeTruthy()
    // 長さチップは従来どおり
    expect(screen.getByText('80 m')).toBeTruthy()
  })

  it('歩道の点字ブロックバッジは3状態（有/無/未記録）で濃淡が区別される', () => {
    render(<Harness preActions={bfMobileActions([
      bfWayFixture(301, { highway: 'footway', tactile_paving: 'yes' }, 'yes'),
      bfWayFixture(302, { highway: 'footway', tactile_paving: 'no' }, 'no'),
      bfWayFixture(303, { highway: 'footway' }, null),
    ])} />)

    const yes = screen.getByText('点字ブロック 有')
    const no = screen.getByText('点字ブロック 無')
    const unknown = screen.getByText('点字ブロック 未記録')
    // 有: 緑系 / 無: 赤系（濃いめ）/ 未記録: 赤系（「無」より薄い）
    expect(yes.className).toContain('emerald')
    expect(no.className).toContain('rose-600')
    expect(unknown.className).toContain('rose-400')
  })

  it('案内信号バッジは名称が無名でも表示される', () => {
    render(<Harness preActions={bfMobileActions([bfSoundNode])} />)

    // タイトルは種別ラベルのみ
    expect(screen.getByText('音声案内信号')).toBeTruthy()
    // 名称が無い場合でもバッジが出る
    expect(screen.getByText('音声案内')).toBeTruthy()
  })

  it('縁石ノードでkerbタグの値があれば日本語ラベルが続く', () => {
    render(<Harness preActions={bfMobileActions([
      bfKerbNodeFixture(310, 'low'),
      bfKerbNodeFixture(311, 'flat'),
    ])} />)
    expect(screen.getByText('縁石 低縁石')).toBeTruthy()
    // KERB_VALUE_LABELS に無い値はそのまま表示
    expect(screen.getByText('縁石 フラット')).toBeTruthy()
  })

  it('追加チップ（横断歩道・車椅子・幅・路面）はタグがある場合だけ出る', () => {
    const withTags = bfWayFixture(320, {
      highway: 'footway',
      footway: 'crossing',
      wheelchair: 'limited',
      width: '3',
      surface: 'asphalt',
      tactile_paving: 'yes'
    }, 'yes')
    const plain = bfWayFixture(321, { highway: 'footway', tactile_paving: 'yes' }, 'yes')

    render(<Harness preActions={bfMobileActions([withTags, plain])} />)

    // タグがあるカードにチップが出る
    expect(screen.getByText('横断歩道')).toBeTruthy()
    expect(screen.getByText('車椅子 制限あり')).toBeTruthy()
    expect(screen.getByText('幅 3 m')).toBeTruthy()
    expect(screen.getByText('路面 asphalt')).toBeTruthy()
  })

  it('車椅子タグの値に応じたチップが出る（可/不可/制限あり/その他）', () => {
    render(<Harness preActions={bfMobileActions([
      bfWayFixture(330, { highway: 'footway', wheelchair: 'yes' }, null),
      bfWayFixture(331, { highway: 'footway', wheelchair: 'no' }, null),
      bfWayFixture(332, { highway: 'footway', wheelchair: 'limited' }, null),
      bfWayFixture(333, { highway: 'footway', wheelchair: 'designated' }, null),
    ])} />)
    expect(screen.getByText('車椅子 可')).toBeTruthy()
    expect(screen.getByText('車椅子 不可')).toBeTruthy()
    expect(screen.getByText('車椅子 制限あり')).toBeTruthy()
    expect(screen.getByText('車椅子 designated')).toBeTruthy()
  })

  it('幅が数値らしくない場合は値をそのまま表示する', () => {
    render(<Harness preActions={bfMobileActions([
      bfWayFixture(340, { highway: 'footway', width: 'narrow' }, null),
      bfWayFixture(341, { highway: 'footway', width: '2.5' }, null),
    ])} />)
    expect(screen.getByText('幅 narrow')).toBeTruthy()
    expect(screen.getByText('幅 2.5 m')).toBeTruthy()
  })

  it('リセットで表示フィルタが解除される（フォームのカテゴリは残る）', () => {
    const log = []
    render(<Harness preActions={bfMobileActions()} log={log} />)
    fireEvent.change(screen.getByRole('combobox', { name: '要素種別で絞り込む' }), { target: { value: 'node' } })
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))
    expect(screen.getByText('中央通り歩道')).toBeTruthy()
    // SET_SIMPLE_SEARCH / SET_MUNICIPALITY_SEARCH へのdispatchは無い（検索条件は不変）
    expect(log.some((a) => a.type === 'SET_SIMPLE_SEARCH')).toBe(false)
    expect(log.some((a) => a.type === 'SET_MUNICIPALITY_SEARCH')).toBe(false)
    expect(log.some((a) => a.type === 'SET_RESULT_FILTERS' && a.payload.typeFilter === 'all')).toBe(true)
  })

  it('0件時はバリアフリー向けのメッセージを表示する', () => {
    render(<Harness preActions={bfMobileActions([])} />)
    expect(screen.getByText(/バリアフリー関連の登録がありません/)).toBeTruthy()
  })
})

// ===== (#62 視点フィルタ) バリアフリー一覧 =====
describe('MobileListTab: 視点フィルタチップ（バリアフリー一覧）', () => {
  // bf フィールドに基づく判定が bfFilters（resultFilters 展開）経由で効くことを確認
  const bfTactile = bfWayFixture(401, { highway: 'footway', tactile_paving: 'yes' }, 'yes')
  const bfKerbFlush = bfKerbNodeFixture(402, 'flush')
  const bfPlain = bfWayFixture(403, { highway: 'footway' }, null)
  const bfResults = [bfTactile, bfKerbFlush, bfPlain]

  it('視点チップ行がバリアフリー一覧のフィルタバーにも出る（同じ state を共有）', () => {
    render(<Harness preActions={bfMobileActions(bfResults)} />)
    const group = screen.getByRole('group', { name: '視点で絞る' })
    expect(within(group).getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('目の不自由な方チップ: bf.tactile=yes の歩道だけが残る（kerb・未登録は除外）', () => {
    render(<Harness preActions={bfMobileActions(bfResults)} />)

    fireEvent.click(screen.getByRole('button', { name: '目の不自由な方' }))

    expect(screen.getByText('way/401')).toBeTruthy()
    expect(screen.queryByText('node/402')).toBeNull()
    expect(screen.queryByText('way/403')).toBeNull()
    expect(screen.getByText(/3件中、1件を表示/)).toBeTruthy()
  })

  it('車椅子チップ: bf.kerb=flush の縁石だけが残る（tags/bf 両方の判定が効く）', () => {
    render(<Harness preActions={bfMobileActions(bfResults)} />)

    fireEvent.click(screen.getByRole('button', { name: '車椅子' }))

    expect(screen.getByText('node/402')).toBeTruthy()
    expect(screen.queryByText('way/401')).toBeNull()
    expect(screen.queryByText('way/403')).toBeNull()
  })

  it('リセットで perspective も解除され全件に戻る', async () => {
    const log = []
    render(<Harness preActions={bfMobileActions(bfResults)} log={log} />)

    fireEvent.click(screen.getByRole('button', { name: '車椅子' }))
    expect(screen.queryByText('way/401')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))
    expect(log.some((a) => a.type === 'SET_RESULT_FILTERS' && a.payload.perspective === 'none')).toBe(true)
    await waitFor(() => {
      expect(screen.getByText('way/401')).toBeTruthy()
      expect(screen.getByText('node/402')).toBeTruthy()
      expect(screen.getByText('way/403')).toBeTruthy()
    })
  })
})

// ===== (修正) モバイル結果マップ =====
// 検索成功後に自動で一覧タブへ切り替わるため、一覧タブでも結果の位置を
// マップで確認できることを検証する。
const poiWithCoords = [
  { type: 'node', id: 30, name: 'カフェA', lat: 34.7, lon: 135.5, tags: { amenity: 'cafe', name: 'カフェA' } },
  { type: 'node', id: 31, name: '中央公園', lat: 34.71, lon: 135.51, tags: { leisure: 'park', name: '中央公園' } }
]

describe('MobileListTab: 結果マップ（折りたたみ式・修正）', () => {
  it('POI検索結果: 初期は折りたたみ（地図非表示）で、「地図を表示」を押すと結果範囲にフィットして表示される', async () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: poiWithCoords },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    // 初期状態は折りたたみ: 地図は描画されず、「地図を表示」ボタンが出る
    expect(screen.queryByRole('application', { name: '検索結果マップ' })).toBeNull()
    expect(mockState.api._state.maps).toHaveLength(0)
    const toggle = screen.getByRole('button', { name: /地図を表示/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    // 展開: 地図が表示され、結果座標が設定され、結果範囲にfitBoundsされる
    fireEvent.click(toggle)
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      expect(map._lastGeoJSON?.data?.features?.length).toBe(2)
    })
    const map = mockState.api._state.maps.at(-1)
    expect(map._lastGeoJSON.data.features[0].geometry.coordinates).toEqual([135.5, 34.7])
    // カメラは結果の範囲（extent）にfitBoundsされる
    const fit = map._calls.find((c) => c.name === 'fitBounds')
    expect(fit.args[0]).toEqual([[135.5, 34.7], [135.51, 34.71]])
  })

  it('「地図を隠す」で折りたたみに戻ると地図が非表示になり、マップが破棄される', async () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: poiWithCoords },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    await waitFor(() => expect(mockState.api._state.maps).toHaveLength(1))
    const map = mockState.api._state.maps[0]

    fireEvent.click(screen.getByRole('button', { name: /地図を隠す/ }))
    expect(screen.queryByRole('application', { name: '検索結果マップ' })).toBeNull()
    expect(map._removed).toBe(true)
    expect(screen.getByRole('button', { name: /地図を表示/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('結果がない場合は結果マップ（・折りたたみボタン）が表示されない', () => {
    render(<Harness />)
    expect(screen.queryByRole('application', { name: '検索結果マップ' })).toBeNull()
    expect(screen.queryByRole('button', { name: /地図を表示/ })).toBeNull()
    expect(mockState.api._state.maps).toHaveLength(0)
  })

  it('POI: 結果マップのマーカータップで onOpenDetail(result, "map") が呼ばれる（詳細シート導線）', async () => {
    const onOpenDetail = vi.fn()
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: poiWithCoords },
        { type: 'SET_STATUS', payload: 'success' }
      ]}>
        <MobileListTab onOpenDetail={onOpenDetail} />
      </Harness>
    )

    // 折りたたみを展開して結果マップをマウントし、結果の設定を待つ
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      expect(map._lastGeoJSON?.data?.features?.length).toBe(2)
    })

    // マーカー（カフェA node/30）をタップ → pointレイヤのclickイベントを発火
    const map = mockState.api._state.maps.at(-1)
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/30')
    expect(feature).toBeTruthy()
    act(() => {
      map.fire('click', 'point-circle', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    // 検索タブのマーカータップと同じ引数形式（result, 'map'）で詳細が開かれる
    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    expect(onOpenDetail.mock.calls[0][0]).toEqual(poiWithCoords[0])
    expect(onOpenDetail.mock.calls[0][1]).toBe('map')
  })

  it('バリアフリー検索結果: 初期は開いている状態（初期open）。線・点の結果範囲にフィットされ、凡例は常時表示', async () => {
    render(<Harness preActions={bfMobileActions()} />)

    // 初期状態は展開: 地図が表示され、トグルは「地図を隠す」（aria-expanded=true）
    expect(screen.getByRole('application', { name: 'バリアフリー要素マップ' })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: /地図を隠す/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // 凡例は折りたたみの外なので、常に一緒に表示される
    expect(screen.getByText('凡例')).toBeTruthy()

    // 線（LineString）と点（Point）が設定され、結果範囲にfitBoundsされる
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      const features = map._lastGeoJSON?.data?.features || []
      expect(features.length).toBe(2)
      expect(features.map((f) => f.geometry.type).sort()).toEqual(['LineString', 'Point'])
    })
    const map = mockState.api._state.maps.at(-1)
    // 線（135.0〜135.02, 34.0〜34.01）と点（135.1, 34.1）を含む範囲
    const fit = map._calls.find((c) => c.name === 'fitBounds')
    expect(fit.args[0]).toEqual([[135.0, 34.0], [135.1, 34.1]])
  })

  it('バリアフリー地図: トグルで閉じられる（地図非表示・破棄）し、もう一度開くと結果範囲に再フィットする', async () => {
    render(<Harness preActions={bfMobileActions()} />)

    // 初期は開いている → 「地図を隠す」ボタン
    expect(screen.getByRole('application', { name: 'バリアフリー要素マップ' })).toBeTruthy()
    await waitFor(() => expect(mockState.api._state.maps).toHaveLength(1))
    const firstMap = mockState.api._state.maps[0]

    // 閉じる: 地図がアンマウントされ破棄される。凡例は折りたたみの外なので残る
    fireEvent.click(screen.getByRole('button', { name: /地図を隠す/ }))
    expect(screen.queryByRole('application', { name: 'バリアフリー要素マップ' })).toBeNull()
    expect(firstMap._removed).toBe(true)
    expect(screen.getByRole('button', { name: /地図を表示/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('凡例')).toBeTruthy()

    // 再展開: 地図が新規マウントされ、結果範囲にfitBoundsされる
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      expect(map._lastGeoJSON?.data?.features?.length).toBe(2)
    })
    const map = mockState.api._state.maps.at(-1)
    expect(screen.getByRole('application', { name: 'バリアフリー要素マップ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /地図を隠す/ }).getAttribute('aria-expanded')).toBe('true')
    const fit = map._calls.find((c) => c.name === 'fitBounds')
    expect(fit.args[0]).toEqual([[135.0, 34.0], [135.1, 34.1]])
  })
})

// ===== 料理ジャンルチップ（cuisine、POI一覧） =====
const ramenCafe = { type: 'node', id: 140, name: 'ラーメン店A', tags: { amenity: 'restaurant', cuisine: 'ramen', name: 'ラーメン店A' } }
const sushiShop = { type: 'node', id: 141, name: '寿司屋B', tags: { amenity: 'restaurant', cuisine: 'sushi', name: '寿司屋B' } }
const multiShop = { type: 'node', id: 142, name: 'ラーメン&Sushi C', tags: { amenity: 'restaurant', cuisine: 'ramen;sushi', name: 'ラーメン&Sushi C' } }
const CUISINE_RESULTS = [ramenCafe, sushiShop, multiShop]

describe('MobileListTab: 料理ジャンルチップ（POI一覧）', () => {
  it('結果にcuisineタグがあれば、日本語ラベルと件数付きチップ行が表示される', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    const group = screen.getByRole('group', { name: '料理ジャンル' })
    // ramenは2件（ラーメン店A + C）、sushiも2件（寿司屋B + C）
    const ramenChip = within(group).getByRole('button', { name: /ラーメン（2件）/ })
    expect(ramenChip).toBeTruthy()
    expect(within(group).getByRole('button', { name: /寿司（2件）/ })).toBeTruthy()
    // 初期状態: 何も選択されていない
    expect(ramenChip.getAttribute('aria-pressed')).toBe('false')
  })

  it('チップを選ぶと該当する結果だけ残る（aria-pressedも更新される）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    fireEvent.click(screen.getByRole('button', { name: /ラーメン（2件）/ }))

    expect(screen.getByText('ラーメン店A')).toBeTruthy()
    expect(screen.getByText('ラーメン&Sushi C')).toBeTruthy()
    expect(screen.queryByText('寿司屋B')).toBeNull()
    expect(screen.getByText(/3件中、2件を表示/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /ラーメン（2件）/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /寿司（2件）/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('選択済みチップを再び押すと解除され全件に戻る', async () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    fireEvent.click(screen.getByRole('button', { name: /ラーメン（2件）/ }))
    expect(screen.queryByText('寿司屋B')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /ラーメン（2件）/ }))
    await waitFor(() => {
      expect(screen.getByText('寿司屋B')).toBeTruthy()
    })
    expect(screen.getByText(/3件中、3件を表示/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /ラーメン（2件）/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('結果にcuisineタグが無ければチップ行は表示されない', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    expect(screen.queryByRole('group', { name: '料理ジャンル' })).toBeNull()
  })

  it('「フィルタをリセット」で料理ジャンルの絞り込みも解除される', async () => {
    const log = []
    // cuisine=italian で全件除外される結果セット（0件 → 「フィルタをリセット」ボタン表示）
    render(<Harness
      preActions={[
        { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
        { type: 'SET_STATUS', payload: 'success' },
        { type: 'SET_RESULT_FILTERS', payload: { cuisine: 'italian' } }
      ]}
      log={log}
    />)

    expect(screen.getByText(/現在の絞り込み条件に一致する施設はありません/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'フィルタをリセット' }))

    expect(log.some((a) => a.type === 'SET_RESULT_FILTERS' && a.payload.cuisine === '')).toBe(true)
    await waitFor(() => {
      expect(screen.getByText('ラーメン店A')).toBeTruthy()
      expect(screen.getByText('寿司屋B')).toBeTruthy()
    })
  })
})

// ===== 縁石の高さセレクト（kerbHeight、バリアフリー一覧） =====
const bfKerbFlush501 = bfKerbNodeFixture(501, 'flush')
const bfKerbLowered502 = bfKerbNodeFixture(502, 'lowered')
const bfKerbRaised503 = bfKerbNodeFixture(503, 'raised')
const bfKerbUnknown504 = bfKerbNodeFixture(504, null) // barrier=kerb のみ（未記録）
const bfKerbHeight505 = { ...bfKerbNodeFixture(505, null), tags: { barrier: 'kerb', 'kerb:height': '0.05' } }
const bfFootway506 = bfWayFixture(506, { highway: 'footway', tactile_paving: 'yes' }, 'yes')
const KERB_BF_RESULTS = [bfKerbFlush501, bfKerbLowered502, bfKerbRaised503, bfKerbUnknown504, bfKerbHeight505, bfFootway506]

describe('MobileListTab: 縁石の高さセレクト（バリアフリー一覧）', () => {
  it('「縁石の高さ」セレクトがフィルタバーに出る（すべて/段差なし/低め/高め/未記録）', () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    const select = screen.getByRole('combobox', { name: '縁石の高さ' })
    expect(select.value).toBe('any')
    const optTexts = [...select.options].map((o) => o.textContent)
    expect(optTexts).toEqual([
      '縁石の高さ: すべて',
      '縁石の高さ: 段差なし',
      '縁石の高さ: 低め（3cm以下）',
      '縁石の高さ: 高め（3cm超）',
      '縁石の高さ: 未記録'
    ])
  })

  it('「段差なし」を選ぶと flush の縁石だけ残り、歩道・bf無し・非縁石は除外される', () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'flat' } })

    expect(screen.getByText('node/501')).toBeTruthy()
    for (const id of ['node/502', 'node/503', 'node/504', 'node/505', 'way/506']) {
      expect(screen.queryByText(id)).toBeNull()
    }
    expect(screen.getByText(/6件中、1件を表示/)).toBeTruthy()
  })

  it('「低め（3cm以下）」: lowered と kerb:height 0.03以下の縁石だけ残る', () => {
    const lowHeight = { ...bfKerbNodeFixture(507, null), tags: { barrier: 'kerb', 'kerb:height': '0.03' } }
    render(<Harness preActions={bfMobileActions([bfKerbLowered502, bfKerbHeight505, lowHeight, bfFootway506])} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'low' } })

    expect(screen.getByText('node/502')).toBeTruthy()
    expect(screen.getByText('node/507')).toBeTruthy()
    expect(screen.queryByText('node/505')).toBeNull()
    expect(screen.queryByText('way/506')).toBeNull()
    expect(screen.getByText(/4件中、2件を表示/)).toBeTruthy()
  })

  it('「高め（3cm超）」: raised と kerb:height 0.03超の縁石だけ残る', () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'high' } })

    expect(screen.getByText('node/503')).toBeTruthy()
    expect(screen.getByText('node/505')).toBeTruthy()
    expect(screen.queryByText('node/501')).toBeNull()
    expect(screen.queryByText('node/502')).toBeNull()
    expect(screen.queryByText('way/506')).toBeNull()
    expect(screen.getByText(/6件中、2件を表示/)).toBeTruthy()
  })

  it('「未記録」: 高さもkerb値も無い縁石要素だけ残る', () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'unknown' } })

    expect(screen.getByText('node/504')).toBeTruthy()
    for (const id of ['node/501', 'node/502', 'node/503', 'node/505', 'way/506']) {
      expect(screen.queryByText(id)).toBeNull()
    }
  })

  it('「すべて」に戻すと全件が再表示される', async () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'flat' } })
    expect(screen.queryByText('way/506')).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'any' } })
    await waitFor(() => {
      expect(screen.getByText('way/506')).toBeTruthy()
    })
    expect(screen.getByText(/6件中、6件を表示/)).toBeTruthy()
  })

  it('リセットで kerbHeight も any に戻り全件が表示される', async () => {
    const log = []
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} log={log} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'flat' } })
    expect(screen.queryByText('way/506')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))
    expect(log.some((a) => a.type === 'SET_RESULT_FILTERS' && a.payload.kerbHeight === 'any')).toBe(true)
    await waitFor(() => {
      expect(screen.getByText('way/506')).toBeTruthy()
      expect(screen.getByText('node/504')).toBeTruthy()
    })
  })

  it('cuisine はバリアフリー一覧では適用されない（stale な cuisine で結果が消えない）', () => {
    render(<Harness preActions={[
      ...bfMobileActions(KERB_BF_RESULTS),
      { type: 'SET_RESULT_FILTERS', payload: { cuisine: 'ramen' } }
    ]} />)
    // bfFilters が cuisine を中和するため全6件表示される
    expect(screen.getByText(/6件中、6件を表示/)).toBeTruthy()
  })
})

// ===== 縁石の高さの施設一覧での非表示 =====
describe('MobileListTab: 縁石の高さセレクトは施設一覧に出ない', () => {
  it('POI一覧のフィルタバーに「縁石の高さ」セレクトは存在しない', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    expect(screen.queryByRole('combobox', { name: '縁石の高さ' })).toBeNull()
  })

  it('stale な kerbHeight でも施設一覧の結果は除外されない', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
      { type: 'SET_STATUS', payload: 'success' },
      { type: 'SET_RESULT_FILTERS', payload: { kerbHeight: 'flat' } }
    ]} />)
    // poiFilters が kerbHeight を 'any' に固定するため全3件表示される
    expect(screen.getByText(/3件中、3件を表示/)).toBeTruthy()
  })
})
