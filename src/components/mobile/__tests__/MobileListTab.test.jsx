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
import { facilityIconUrl, getFacilityIcon, FALLBACK_ICON } from '../../../utils/facilityIcon'
import { resetMemochoStore } from '../../../hooks/useMemocho'
import { resetScrapbooksStore } from '../../../hooks/useScrapbooks'
import { MEMOCHO_STORAGE_KEY, loadMemocho } from '../../../utils/memocho'
import { SCRAPBOOKS_STORAGE_KEY } from '../../../utils/scrapbooks'

// 実際のOverpass正規化と同様に tags.name → 顶层name にコピーする
// MapLibre GLはWebGLが必要でjsdomでは初期化できないためモジュール全体をモックする。
// (修正) 一覧タブに MobileResultsMap を埋め込んだため必須。
const mockState = vi.hoisted(() => ({ api: null }))
vi.mock('maplibre-gl', async () => {
  const mod = await import('../../../test/maplibreMock')
  mockState.api = mod.createMapLibreMock()
  return mockState.api
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
      {children || <MobileListTab />}
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
    const select = screen.getByRole('combobox', { name: '種別詳細で絞り込む' })
    fireEvent.change(select, { target: { value: 'cafe' } })

    expect(log.some(a => a.type === 'SET_SIMPLE_SEARCH' && a.payload.category === 'cafe')).toBe(true)
    expect(screen.queryByText('中央公園')).toBeNull()
    expect(screen.getByRole('combobox', { name: '種別詳細で絞り込む' }).value).toBe('cafe')
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
    const select = screen.getByRole('combobox', { name: '種別詳細で絞り込む' })
    fireEvent.change(select, { target: { value: 'park' } })

    expect(log.some(a => a.type === 'SET_MUNICIPALITY_SEARCH' && a.payload.category === 'park')).toBe(true)
    expect(log.some(a => a.type === 'SET_SIMPLE_SEARCH')).toBe(false)
    expect(screen.getByRole('combobox', { name: '種別詳細で絞り込む' }).value).toBe('park')
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

    const select = screen.getByRole('combobox', { name: '種別詳細で絞り込む' })
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

describe('MobileListTab: カテゴリ選択肢は取得データに基づいて絞り込まれる (#44)', () => {
  it('結果に出現したカテゴリのみを件数付きで表示する', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    const select = screen.getByRole('combobox', { name: '種別詳細で絞り込む' })
    const optTexts = [...select.options].map((o) => o.textContent)
    expect(optTexts).toContain('種別詳細: すべて（2件）')
    expect(optTexts).toContain('カフェ（1件）')
    expect(optTexts).toContain('公園・広場（1件）')
    expect(optTexts.some((t) => t.startsWith('レストラン'))).toBe(false)
  })

  it('結果なしときはカテゴリセレクト自体が表示されない（フィルタバー非表示）', () => {
    render(<Harness />)
    expect(screen.queryByRole('combobox', { name: '種別詳細で絞り込む' })).toBeNull()
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
  return document.getElementById(`barrier-free-card-${osmId}`)
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
  it('専用カードにタイプ・点字ブロック・長さを表示する', () => {
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
    expect(cardOf('way/100')).toBeTruthy()
    expect(screen.queryByText('way/100')).toBeNull()
    expect(screen.queryByText('node/200')).toBeNull()
    expect(screen.queryByRole('link', { name: /iDで編集/ })).toBeNull()
  })

  it('施設向けのコントロール（カテゴリ選択・Webサイトチェック）は表示しない', () => {
    render(<Harness preActions={bfMobileActions()} />)
    expect(screen.queryByRole('combobox', { name: '種別詳細で絞り込む' })).toBeNull()
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

  it('縁石の高さがあれば優先し、なければ lowered を日本語で表示する', () => {
    const measured = bfKerbNodeFixture(312, 'lowered')
    measured.tags['kerb:height'] = '0.045'
    render(<Harness preActions={bfMobileActions([
      measured,
      bfKerbNodeFixture(313, 'lowered'),
    ])} />)

    expect(screen.getByText('縁石 4.5 cm')).toBeTruthy()
    expect(screen.getByText('縁石 低め（3 cm以下）')).toBeTruthy()
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
    expect(within(cardOf('way/320')).getByText('横断歩道')).toBeTruthy()
    expect(within(cardOf('way/321')).queryByText('横断歩道')).toBeNull()
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

  it('追加対象でアイコンが対応表にある場合はアイコンを表示する（fallback は出さない）', () => {
    const cases = [
      { id: 330, tags: { highway: 'elevator' } },
      { id: 331, tags: { amenity: 'toilets' } },
      { id: 332, tags: { highway: 'steps' } },
      { id: 333, tags: { highway: 'footway', tactile_paving: 'yes' } },
      { id: 334, tags: { 'ramp:wheelchair': 'yes' } },
    ]
    render(<Harness preActions={bfMobileActions(cases.map((c) => bfWayFixture(c.id, c.tags, null)))} />)

    for (const c of cases) {
      const card = cardOf(`way/${c.id}`)
      const img = card.querySelector('img')
      const hasIcon = getFacilityIcon(c.tags) !== FALLBACK_ICON
      if (hasIcon) {
        expect(img).toBeTruthy()
        expect(img.getAttribute('src')).toContain('icons/')
      } else {
        expect(img).toBeNull()
      }
    }
    // 既知: エレベーターは対応表にあり（アイコン表示）、歩道は fallback（アイコンなし）
    expect(cardOf('way/330').querySelector('img')).toBeTruthy()
    expect(cardOf('way/333').querySelector('img')).toBeNull()
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

  it('OSMリンクは地図の中心・ズームと選択した施設に追従する', async () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: poiWithCoords },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    const osmLink = () => screen.getByRole('link', { name: 'OpenStreetMapで開く' })
    expect(osmLink().getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    await waitFor(() => expect(osmLink().getAttribute('href')).toContain('#map='))

    const map = mockState.api._state.maps.at(-1)
    map.getCenter = () => ({ lat: 34.70123, lng: 135.50678 })
    map.getZoom = () => 16.8
    act(() => { map.fire('moveend') })
    const view = '#map=17/34.7012300/135.5067800'
    expect(osmLink().getAttribute('href')).toBe(`https://www.openstreetmap.org/${view}`)
    expect(osmLink().getAttribute('target')).toBe('_blank')

    const cafe = screen.getByRole('button', { name: 'カフェAを地図で選択' })
    fireEvent.click(cafe)
    expect(osmLink().getAttribute('href')).toBe(`https://www.openstreetmap.org/node/30${view}`)
    fireEvent.click(cafe)
    expect(osmLink().getAttribute('href')).toBe(`https://www.openstreetmap.org/${view}`)
  })

  it('一覧のWi-Fi・電源・車椅子・料理ジャンルの絞り込みを地図のピンにも反映する', async () => {
    const [cafe, park] = poiWithCoords
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [
        { ...cafe, tags: { ...cafe.tags, internet_access: 'wlan', wheelchair: 'yes', cuisine: 'coffee' } },
        { ...park, tags: { ...park.tags, power_supply: 'yes', cuisine: 'japanese' } },
      ] },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    const map = mockState.api._state.maps.at(-1)
    const expectPins = (...keys) => waitFor(() => {
      expect(map._lastGeoJSON?.data.features.map((f) => f.properties.key)).toEqual(keys)
    })
    await expectPins('node/30', 'node/31')

    const wifi = screen.getByRole('checkbox', { name: 'Wi-Fi' })
    const power = screen.getByRole('checkbox', { name: '電源' })
    const wheelchair = screen.getByRole('checkbox', { name: '車椅子' })
    fireEvent.click(cuisineHeader())
    expect(screen.getByRole('button', { name: '和食（1件）' })).toBeTruthy()
    fireEvent.click(wifi)
    await expectPins('node/30')
    expect(screen.queryByRole('button', { name: '和食（1件）' })).toBeNull()
    fireEvent.click(power)
    await expectPins()
    fireEvent.click(wifi)
    await expectPins('node/31')
    expect(screen.getByRole('button', { name: '和食（1件）' })).toBeTruthy()
    fireEvent.click(power)
    fireEvent.click(wheelchair)
    await expectPins('node/30')
    expect(screen.queryByRole('button', { name: '和食（1件）' })).toBeNull()
    fireEvent.click(wheelchair)
    const japanese = screen.getByRole('button', { name: '和食（1件）' })
    fireEvent.click(japanese)
    await expectPins('node/31')
    fireEvent.click(wifi)
    await expectPins()
    fireEvent.click(screen.getByRole('button', { name: '和食（0件）' }))
    await expectPins('node/30')
    fireEvent.click(wifi)
    await expectPins('node/30', 'node/31')
    expect(mockState.api._state.maps.at(-1)).toBe(map)
  })

  it('施設カードを選ぶと地図を開き、選んだピンにズームする', async () => {
    const [cafe, park] = poiWithCoords
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: [cafe, { ...park, tags: { ...park.tags, website: 'https://park.example' } }] },
        { type: 'SET_STATUS', payload: 'success' }
      ]} />
    )

    expect(screen.queryByRole('application', { name: '検索結果マップ' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'カフェAを地図で選択' }))
    expect(screen.getByRole('button', { name: /地図を隠す/ }).getAttribute('aria-expanded')).toBe('true')
    const map = mockState.api._state.maps.at(-1)
    await waitFor(() => expect(map._lastGeoJSON?.data.features).toHaveLength(2))

    const backgroundFilter = (instance) => instance._layers.find((layer) => layer.id === 'poi-selected-background').filter
    const selectedKeyFilter = (key) => ['==', ['get', 'key'], key]
    const focusCalls = (instance) => instance._calls
      .filter((call) => call.name === 'easeTo')
      .map((call) => call.args[0])
    expect(backgroundFilter(map)).toEqual(selectedKeyFilter('node/30'))
    expect(focusCalls(map)).toEqual([{ center: [135.5, 34.7], zoom: 17 }])

    const parkCard = document.getElementById('facility-card-node/31')
    fireEvent.click(within(parkCard).getByRole('link', { name: /公式サイト/ }))
    expect(backgroundFilter(map)).toEqual(selectedKeyFilter('node/30'))
    expect(focusCalls(map)).toHaveLength(1)

    fireEvent.click(within(parkCard).getByText('電話'))
    expect(backgroundFilter(map)).toEqual(selectedKeyFilter('node/31'))
    expect(focusCalls(map).at(-1)).toEqual({ center: [135.51, 34.71], zoom: 17 })
    map.getZoom = () => 19
    fireEvent.click(parkCard)
    expect(backgroundFilter(map)).toEqual(selectedKeyFilter(''))
    expect(parkCard.className).not.toContain('ring-primary-500')
    fireEvent.click(parkCard)
    expect(focusCalls(map).at(-1)).toEqual({ center: [135.51, 34.71], zoom: 19 })
    expect(map._calls.filter((call) => call.name === 'fitBounds')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /地図を隠す/ }))
    expect(screen.queryByRole('application', { name: '検索結果マップ' })).toBeNull()
    fireEvent.click(parkCard)
    expect(screen.queryByRole('application', { name: '検索結果マップ' })).toBeNull()
    fireEvent.click(parkCard)
    expect(screen.getByRole('application', { name: '検索結果マップ' })).toBeTruthy()
    const reopened = mockState.api._state.maps.at(-1)
    await waitFor(() => expect(reopened._lastGeoJSON?.data.features).toHaveLength(2))
    expect(backgroundFilter(reopened)).toEqual(selectedKeyFilter('node/31'))
    expect(focusCalls(reopened)).toEqual([{ center: [135.51, 34.71], zoom: 17 }])
  })

  it('POI: 結果マップのピンタップで一覧を対応する施設カードへスクロールして選択状態にする（詳細シートは開かない）', async () => {
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: poiWithCoords },
        { type: 'SET_STATUS', payload: 'success' }
      ]} />
    )

    // 折りたたみを展開して結果マップをマウントし、結果の設定を待つ
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      expect(map._lastGeoJSON?.data?.features?.length).toBe(2)
    })

    // ピン（カフェA node/30）をタップ → アイコンレイヤのclickイベントを発火
    const map = mockState.api._state.maps.at(-1)
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/30')
    expect(feature).toBeTruthy()
    expect(feature.properties.icon).toBe('cafe.png')
    const card = document.getElementById('facility-card-node/30')
    const list = card.closest('.overflow-y-auto')
    expect(list).toBeTruthy()
    expect(list.contains(screen.getByRole('application', { name: '検索結果マップ' }))).toBe(false)
    expect(list.contains(screen.getByRole('button', { name: /地図を隠す/ }))).toBe(false)
    list.scrollTo = vi.fn()
    list.scrollTop = 40
    Object.defineProperty(list, 'clientHeight', { value: 300 })
    list.getBoundingClientRect = () => ({ top: 280 })
    card.getBoundingClientRect = () => ({ top: 800, height: 100 })
    act(() => {
      map.fire('click', 'poi-icon', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    // 対応するカード（id: facility-card-node/30）へスクロールして選択状態にする
    expect(list.scrollTo).toHaveBeenCalledWith({ top: 460, behavior: 'smooth' })
    expect(card).toBeTruthy()
    expect(card.className).toContain('ring-primary-500')
    expect(card.className).toContain('border-primary-400')
    // 他のカードは選択されない
    expect(document.getElementById('facility-card-node/31').className).not.toContain('ring-primary-500')
  })

  it('POI: フォールバック点（アイコン読込失敗）のタップでも対応するカードが選択される', async () => {
    mockState.api.setImageLoadFailures([facilityIconUrl('cafe.png')])
    render(
      <Harness preActions={[
        { type: 'SET_RESULTS', payload: poiWithCoords },
        { type: 'SET_STATUS', payload: 'success' }
      ]} />
    )

    // 折りたたみを展開して結果マップをマウントし、結果の設定を待つ
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      expect(map._lastGeoJSON?.data?.features?.length).toBe(2)
    })

    // カフェAのアイコン読込失敗 → フォールバック点（properties.icon が空）
    const map = mockState.api._state.maps.at(-1)
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/30')
    expect(feature.properties.icon).toBe('')
    act(() => {
      map.fire('click', 'poi-fallback', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })

    const card = document.getElementById('facility-card-node/30')
    expect(card.className).toContain('ring-primary-500')
  })

  it('POI: 再検索（結果の置換）で選択がクリアされる', async () => {
    let dispatchRef
    function Inner() {
      const [state, dispatch] = React.useReducer(
        appReducer,
        [{ type: 'SET_RESULTS', payload: poiWithCoords }, { type: 'SET_STATUS', payload: 'success' }],
        (acts) => acts.reduce((s, a) => appReducer(s, a), createInitialState())
      )
      dispatchRef = dispatch
      return (
        <AppContext.Provider value={{ state, dispatch }}>
          <MobileListTab />
        </AppContext.Provider>
      )
    }
    render(<Inner />)

    // 折りたたみを展開して結果マップをマウントし、結果の設定を待つ
    fireEvent.click(screen.getByRole('button', { name: /地図を表示/ }))
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      expect(map._lastGeoJSON?.data?.features?.length).toBe(2)
    })

    // ピン（カフェA node/30）をタップ → カードが選択される
    const map = mockState.api._state.maps.at(-1)
    const feature = map._lastGeoJSON.data.features.find((f) => f.properties.key === 'node/30')
    act(() => {
      map.fire('click', 'poi-icon', {
        features: [feature],
        lngLat: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
      })
    })
    expect(document.getElementById('facility-card-node/30').className).toContain('ring-primary-500')

    // 再検索（新しい結果に置き換え）→ 選択がクリアされる
    await act(async () => {
      dispatchRef({ type: 'SET_RESULTS', payload: [park] })
    })
    expect(document.getElementById('facility-card-node/30')).toBeNull()
    const card = screen.getByRole('heading', { name: '中央公園' }).closest('[id^="facility-card-"]')
    expect(card.className).not.toContain('ring-primary-500')
  })

  it('バリアフリー検索結果: 初期は開いている状態（初期open）。線・点の結果範囲にフィットされ、凡例は常時表示', async () => {
    render(<Harness preActions={bfMobileActions()} />)

    // 初期状態は展開: 地図が表示され、トグルは「地図を隠す」（aria-expanded=true）
    const mapCanvas = screen.getByRole('application', { name: 'バリアフリー要素マップ' })
    const toggle = screen.getByRole('button', { name: /地図を隠す/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // 凡例は地図ブロック側（固定領域）にあるため、リストのスクロール領域には入らない
    expect(screen.getByText('凡例').closest('.overflow-y-auto')).toBeNull()
    // 凡例と地図は同じ地図ブロック内（地図を折りたたんでも凡例は残る）
    const mapBlock = screen.getByText('凡例').closest('.shrink-0')
    expect(mapBlock).toBeTruthy()
    expect(mapBlock.contains(mapCanvas)).toBe(true)
    expect(screen.getByText('凡例').nextElementSibling.className).toContain('grid-cols-2')

    // 線（LineString）・ウェイ中点アイコン・点（Point）が設定され、結果範囲にfitBoundsされる
    await waitFor(async () => {
      const map = mockState.api._state.maps.at(-1)
      const features = map._lastGeoJSON?.data?.features || []
      expect(features.length).toBe(3)
      expect(features.map((f) => f.geometry.type).sort()).toEqual(['LineString', 'Point', 'Point'])
    })
    const map = mockState.api._state.maps.at(-1)
    // 線（135.0〜135.02, 34.0〜34.01）と点（135.1, 34.1）を含む範囲
    const fit = map._calls.find((c) => c.name === 'fitBounds')
    expect(fit.args[0]).toEqual([[135.0, 34.0], [135.1, 34.1]])

    fireEvent.change(screen.getByRole('combobox', { name: '要素種別で絞り込む' }), { target: { value: 'node' } })
    await waitFor(() => expect(map._lastGeoJSON.data.features.map((f) => f.geometry.type)).toEqual(['Point']))
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
      expect(map._lastGeoJSON?.data?.features?.length).toBe(3)
    })
    const map = mockState.api._state.maps.at(-1)
    expect(screen.getByRole('application', { name: 'バリアフリー要素マップ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /地図を隠す/ }).getAttribute('aria-expanded')).toBe('true')
    const fit = map._calls.find((c) => c.name === 'fitBounds')
    expect(fit.args[0]).toEqual([[135.0, 34.0], [135.1, 34.1]])
  })

  it('バリアフリーのカードを選ぶと地図が開き、対応する線や点を強調する', async () => {
    render(<Harness preActions={bfMobileActions()} />)
    fireEvent.click(screen.getByRole('button', { name: /地図を隠す/ }))
    fireEvent.keyDown(screen.getByRole('button', { name: '中央通り歩道を地図で選択' }), { key: 'Enter' })
    expect(screen.getByRole('application', { name: 'バリアフリー要素マップ' })).toBeTruthy()

    const map = mockState.api._state.maps.at(-1)
    await waitFor(() => expect(map._lastGeoJSON?.data.features).toHaveLength(3))
    const highlight = (id) => map._layers.find((layer) => layer.id === id).filter
    const keyFilter = (key) => ['==', ['get', 'key'], key]
    expect(highlight('bf-selected-line')).toEqual(['all', ['==', ['get', 'kind'], 'way'], keyFilter('way/100')])
    expect(screen.getByRole('link', { name: 'OpenStreetMapで開く' }).getAttribute('href'))
      .toMatch(/^https:\/\/www\.openstreetmap\.org\/way\/100#map=/)
    expect(cardOf('way/100').className).toContain('ring-primary-500')
    expect(map._calls.filter((c) => c.name === 'fitBounds').at(-1).args[0]).toEqual([[135.0, 34.0], [135.02, 34.01]])

    fireEvent.click(screen.getByRole('button', { name: '縁石を地図で選択' }))
    expect(highlight('bf-selected-node')).toEqual(['all', ['==', ['get', 'kind'], 'node'], keyFilter('node/200')])
    expect(cardOf('way/100').className).not.toContain('ring-primary-500')
    expect(cardOf('node/200').className).toContain('ring-primary-500')
    expect(map._calls.filter((c) => c.name === 'easeTo').at(-1).args[0]).toMatchObject({ center: [135.1, 34.1], zoom: 17 })

    fireEvent.click(screen.getByRole('button', { name: '縁石を地図で選択' }))
    expect(cardOf('node/200').getAttribute('aria-pressed')).toBe('false')
    expect(highlight('bf-selected-node')).toEqual(['all', ['==', ['get', 'kind'], 'node'], keyFilter('')])
    fireEvent.click(screen.getByRole('button', { name: '縁石を地図で選択' }))

    fireEvent.change(screen.getByRole('combobox', { name: '要素種別で絞り込む' }), { target: { value: 'way' } })
    expect(highlight('bf-selected-node')).toEqual(['all', ['==', ['get', 'kind'], 'node'], keyFilter('')])
  })

  it('バリアフリー地図の地物を選ぶと、固定された地図の下で対応カードへスクロールする', async () => {
    render(<Harness preActions={bfMobileActions()} />)
    const map = mockState.api._state.maps.at(-1)
    await waitFor(() => expect(map._lastGeoJSON?.data.features).toHaveLength(3))
    const card = document.getElementById('barrier-free-card-node/200')
    const list = card.closest('.overflow-y-auto')
    list.scrollTo = vi.fn()
    Object.defineProperty(list, 'clientHeight', { value: 300 })
    list.getBoundingClientRect = () => ({ top: 300 })
    card.getBoundingClientRect = () => ({ top: 800, height: 100 })

    const point = map._lastGeoJSON.data.features.find((feature) => feature.properties.key === 'node/200')
    act(() => { map.fire('click', 'bf-node', { features: [point] }) })

    expect(card.getAttribute('aria-pressed')).toBe('true')
    expect(list.scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' })
    expect(map._layers.find((layer) => layer.id === 'bf-selected-node').filter)
      .toEqual(['all', ['==', ['get', 'kind'], 'node'], ['==', ['get', 'key'], 'node/200']])
    expect(map._calls.filter((call) => call.name === 'easeTo')).toHaveLength(0)
  })
})

// ===== 料理ジャンルチップ（cuisine、POI一覧） =====
const ramenCafe = { type: 'node', id: 140, name: 'ラーメン店A', tags: { amenity: 'restaurant', cuisine: 'ramen', name: 'ラーメン店A' } }
const sushiShop = { type: 'node', id: 141, name: '寿司屋B', tags: { amenity: 'restaurant', cuisine: 'sushi', name: '寿司屋B' } }
const multiShop = { type: 'node', id: 142, name: 'ラーメン&Sushi C', tags: { amenity: 'restaurant', cuisine: 'ramen;sushi', name: 'ラーメン&Sushi C' } }
const CUISINE_RESULTS = [ramenCafe, sushiShop, multiShop]

// 折りたたみ見出し行（「料理ジャンル」＋開閉トグル）。選択中ラベル有無の両方で一致する。
const cuisineHeader = () => screen.queryByRole('button', { name: /料理ジャンル/ })

describe('MobileListTab: 料理ジャンルチップ（POI一覧）', () => {
  it('結果にcuisineタグがあれば、見出し行から展開して日本語ラベルと件数付きチップ行が表示される', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)

    // 初期状態: 見出し行は表示されるがチップ群は折りたたみ（group が DOM に無い）
    expect(cuisineHeader()).toBeTruthy()
    expect(screen.queryByRole('group', { name: '料理ジャンル' })).toBeNull()
    // 見出し行をタップして展開するとチップ行が表示される
    fireEvent.click(cuisineHeader())
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

    fireEvent.click(cuisineHeader())
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

    fireEvent.click(cuisineHeader())
    fireEvent.click(screen.getByRole('button', { name: /ラーメン（2件）/ }))
    expect(screen.queryByText('寿司屋B')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /ラーメン（2件）/ }))
    await waitFor(() => {
      expect(screen.getByText('寿司屋B')).toBeTruthy()
    })
    expect(screen.getByText(/3件中、3件を表示/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /ラーメン（2件）/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('結果にcuisineタグが無ければチップ行は表示されない（見出し行も含めて行ごと非表示）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
      { type: 'SET_STATUS', payload: 'success' }
    ]} />)
    expect(cuisineHeader()).toBeNull()
    expect(screen.queryByRole('group', { name: '料理ジャンル' })).toBeNull()
  })

  it('折りたたみ状態で料理ジャンルを選択済みの場合、見出し行に選択中ジャンルのラベルが表示される', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: CUISINE_RESULTS },
      { type: 'SET_STATUS', payload: 'success' },
      { type: 'SET_RESULT_FILTERS', payload: { cuisine: 'ramen' } }
    ]} />)

    // 折りたたみ＋選択中: 見出し行は「料理ジャンル：ラーメン」・チップ群は DOM に無い
    const header = cuisineHeader()
    expect(header).toBeTruthy()
    expect(header.textContent).toContain('料理ジャンル：ラーメン')
    expect(screen.queryByRole('group', { name: '料理ジャンル' })).toBeNull()
    expect(header.getAttribute('aria-expanded')).toBe('false')

    // 展開するとチップ行が出て、選択中チップは押下表示のまま
    fireEvent.click(header)
    const group = screen.getByRole('group', { name: '料理ジャンル' })
    expect(within(group).getByRole('button', { name: 'ラーメン（2件）' }).getAttribute('aria-pressed')).toBe('true')
    expect(header.getAttribute('aria-expanded')).toBe('true')
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

    expect(cardOf('node/501')).toBeTruthy()
    for (const id of ['node/502', 'node/503', 'node/504', 'node/505', 'way/506']) {
      expect(screen.queryByText(id)).toBeNull()
    }
    expect(screen.getByText(/6件中、1件を表示/)).toBeTruthy()
  })

  it('「低め（3cm以下）」: lowered と kerb:height 0.03以下の縁石だけ残る', () => {
    const lowHeight = { ...bfKerbNodeFixture(507, null), tags: { barrier: 'kerb', 'kerb:height': '0.03' } }
    render(<Harness preActions={bfMobileActions([bfKerbLowered502, bfKerbHeight505, lowHeight, bfFootway506])} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'low' } })

    expect(cardOf('node/502')).toBeTruthy()
    expect(cardOf('node/507')).toBeTruthy()
    expect(cardOf('node/505')).toBeNull()
    expect(cardOf('way/506')).toBeNull()
    expect(screen.getByText(/4件中、2件を表示/)).toBeTruthy()
  })

  it('「高め（3cm超）」: raised と kerb:height 0.03超の縁石だけ残る', () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'high' } })

    expect(cardOf('node/503')).toBeTruthy()
    expect(cardOf('node/505')).toBeTruthy()
    expect(cardOf('node/501')).toBeNull()
    expect(cardOf('node/502')).toBeNull()
    expect(cardOf('way/506')).toBeNull()
    expect(screen.getByText(/6件中、2件を表示/)).toBeTruthy()
  })

  it('「未記録」: 高さもkerb値も無い縁石要素だけ残る', () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'unknown' } })

    expect(cardOf('node/504')).toBeTruthy()
    for (const id of ['node/501', 'node/502', 'node/503', 'node/505', 'way/506']) {
      expect(screen.queryByText(id)).toBeNull()
    }
  })

  it('「すべて」に戻すと全件が再表示される', async () => {
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'flat' } })
    expect(cardOf('way/506')).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'any' } })
    await waitFor(() => {
      expect(cardOf('way/506')).toBeTruthy()
    })
    expect(screen.getByText(/6件中、6件を表示/)).toBeTruthy()
  })

  it('リセットで kerbHeight も any に戻り全件が表示される', async () => {
    const log = []
    render(<Harness preActions={bfMobileActions(KERB_BF_RESULTS)} log={log} />)

    fireEvent.change(screen.getByRole('combobox', { name: '縁石の高さ' }), { target: { value: 'flat' } })
    expect(cardOf('way/506')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))
    expect(log.some((a) => a.type === 'SET_RESULT_FILTERS' && a.payload.kerbHeight === 'any')).toBe(true)
    await waitFor(() => {
      expect(cardOf('way/506')).toBeTruthy()
      expect(cardOf('node/504')).toBeTruthy()
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

// ===== (作業スペース系) 電源・Wi-Fi 集計 =====
describe('MobileListTab: 作業スペース系の電源・Wi-Fi 集計', () => {
  const cafeA = { type: 'node', id: 1, name: 'カフェA', tags: { amenity: 'cafe', name: 'カフェA', internet_access: 'wlan', socket: 'yes' } }
  const cafeB = { type: 'node', id: 2, name: 'カフェB', tags: { amenity: 'cafe', name: 'カフェB' } }
  const ramen = { type: 'node', id: 3, name: 'ラーメンC', tags: { amenity: 'restaurant', name: 'ラーメンC', internet_access: 'wlan' } }

  it('表示中の一覧の対象施設を母数として集計が表示される（対象外は含まれない）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeA, cafeB, ramen] },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    // 母数=対象2件（cafe）。restaurant の wifi は集計に含まれない
    expect(screen.getByText('⚡ 電源あり 1件（50%）')).toBeTruthy()
    expect(screen.getByText('📶 Wi-Fi あり 1件（50%）')).toBeTruthy()
  })

  it('フィルタ適用後の一覧を追従する（絞り込みで母数が変わる）', () => {
    const library = { type: 'node', id: 4, name: '図書館D', tags: { amenity: 'library', name: '図書館D', internet_access: 'wlan' } }
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeA, library] },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    // フィルタ前: 母数2・wifiあり2件（100%）
    expect(screen.getByText('📶 Wi-Fi あり 2件（100%）')).toBeTruthy()
    // 名前フィルタ「カフェ」→ カフェAのみ → 母数1
    fireEvent.change(screen.getByRole('textbox', { name: '名前・メモで絞り込む' }), { target: { value: 'カフェ' } })
    expect(screen.getByText('📶 Wi-Fi あり 1件（100%）')).toBeTruthy()
    expect(screen.queryByText('図書館D')).toBeNull()
  })

  it('絞り込みで対象施設が0件になると集計自体が表示されない', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeA, ramen] },
      { type: 'SET_STATUS', payload: 'success' },
      { type: 'SET_RESULT_FILTERS', payload: { catFilter: 'restaurant' } },
    ]} />)
    // ramen のみ表示（対象外）→ 集計は出ない
    expect(screen.queryByText(/⚡ 電源あり \d+件/)).toBeNull()
    expect(screen.queryByText(/📶 Wi-Fi あり \d+件/)).toBeNull()
    expect(screen.getByText('ラーメンC')).toBeTruthy()
  })
})

// ===== (共通フィルタバー) POI一覧の新規チップ行 =====
//
// WiFi・電源・車椅子対応の3行は検索一覧とまちメモ帳で共用の
// ResultFilterBar コンポーネント（ResultFilterBar.jsx）で描画される。
// ここでは POI 一覧側で正しく表示され、3状態判定（wifiStatus /
// powerStatus / matchesWheelchair）に従って絞り込みが効くことを検証する。
const CAFE_WIFI_ALL = { type: 'node', id: 71, name: 'カフェG', tags: { amenity: 'cafe', name: 'カフェG', internet_access: 'wireless', power_supply: 'yes', wheelchair: 'yes' } }
const CAFE_PLAIN = { type: 'node', id: 72, name: 'カフェH', tags: { amenity: 'cafe', name: 'カフェH' } }
const CAFE_LIMITED = { type: 'node', id: 74, name: 'カフェJ', tags: { amenity: 'cafe', name: 'カフェJ', wheelchair: 'limited' } }
const RAMEN_SOCKET = { type: 'node', id: 73, name: 'ラーメンI', tags: { amenity: 'restaurant', name: 'ラーメンI', internet_access: 'no', 'socket:indoor': 'yes', wheelchair: 'designated' } }
const FILTERBAR_ITEMS = [CAFE_WIFI_ALL, CAFE_PLAIN, CAFE_LIMITED, RAMEN_SOCKET]

describe('MobileListTab: 共通フィルタバー（POI一覧のWiFi・電源・車椅子行）', () => {
  it('POI一覧バーに WiFi・電源・車椅子対応 の行が出て、初期はすべて「すべて」', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)

    // 設備行: Wi-Fi・電源・車椅子を1行に統合（WifiPowerRow）
    const wp = screen.getByRole('group', { name: '設備で絞る' })
    const wc = within(wp).getByRole('checkbox', { name: '車椅子' })

    // デフォルト: 3つのチェックボックスは未選択（絞り込みなし）
    expect(within(wp).getByRole('checkbox', { name: 'Wi-Fi' }).checked).toBe(false)
    expect(within(wp).getByRole('checkbox', { name: '電源' }).checked).toBe(false)
    expect(wc).toBeTruthy()
    expect(wc.checked).toBe(false)
    // 「なし」絞り込みは廃止: なし系チェックボックスは存在しない
    expect(within(wp).queryByRole('checkbox', { name: 'WiFiなし' })).toBeNull()
    expect(within(wp).queryByRole('checkbox', { name: '電源なし' })).toBeNull()
  })

  it('全フィルタ行に「アイコン＋見出し」が付く（id 27 統一。設備=📶）', () => {
    render(<Harness preActions={[ 
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)

    // 設備行: 見出しにアイコン(📶)＋文言「設備」
    const wp = screen.getByRole('group', { name: '設備で絞る' })
    const wpHeading = wp.previousElementSibling
    expect(wpHeading.textContent).toContain('設備')
    expect(wpHeading.textContent).toContain('📶')
    // 統一見出しスタイル（text-sm font-medium text-slate-700・min-h-[44px]）
    expect(wpHeading.className).toContain('text-sm font-medium text-slate-700')
    expect(wpHeading.className).toContain('min-h-[44px]')

    // 3つのチェックボックス（Wi-Fi・電源・車椅子）が同じグループ内・「あり」は付かない
    expect(within(wp).getByRole('checkbox', { name: 'Wi-Fi' })).toBeTruthy()
    expect(within(wp).getByRole('checkbox', { name: '電源' })).toBeTruthy()
    expect(within(wp).getByRole('checkbox', { name: '車椅子' })).toBeTruthy()
  })

  it('id 27: 入力・セレクト系行（キーワード🔍/種別詳細📁/並び順↕️）にもアイコン＋見出しが付く（キーワードは文言なし・アイコンのみ）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)

    // キーワード（🔍）: 見出し文言「キーワード」は除去され、アイコンのみが残る
    //（意味はプレースホルダ「名前・メモで絞り込む」が担う。行の右側は
    //  フィルタクリアシンボルの固定スロット）
    const kwInput = screen.getByRole('textbox', { name: '名前・メモで絞り込む' })
    const kwHeading = kwInput.previousElementSibling
    expect(kwHeading.textContent).toContain('🔍')
    expect(kwHeading.textContent).not.toContain('キーワード')
    expect(kwHeading.className).toContain('min-h-[44px]')

    // カテゴリ（📁）
    const catSelect = screen.getByRole('combobox', { name: '種別詳細で絞り込む' })
    const catHeading = catSelect.previousElementSibling
    expect(catHeading.textContent).toContain('📁')
    expect(catHeading.textContent).toContain('種別詳細')

    // 並び順（↕️）
    const sortSelect = screen.getByRole('combobox', { name: '並び順' })
    const sortHeading = sortSelect.previousElementSibling
    expect(sortHeading.textContent).toContain('↕️')
    expect(sortHeading.textContent).toContain('並び順')
  })

  it('WiFiあり: 登録済みで "no" でないものだけ残る（「なし」絞り込みは廃止）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    const wp = screen.getByRole('group', { name: '設備で絞る' })

    fireEvent.click(within(wp).getByRole('checkbox', { name: 'Wi-Fi' }))
    expect(screen.getByText('カフェG')).toBeTruthy()
    expect(screen.queryByText('カフェH')).toBeNull() // 未登録
    expect(screen.queryByText('ラーメンI')).toBeNull() // 'no'
  })

  it("電源あり: power_supply=yes または socket 系キーが設定済み（no 以外）のものだけ残る", () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    const wp = screen.getByRole('group', { name: '設備で絞る' })

    fireEvent.click(within(wp).getByRole('checkbox', { name: '電源' }))
    expect(screen.getByText('カフェG')).toBeTruthy() // power_supply=yes
    expect(screen.getByText('ラーメンI')).toBeTruthy() // socket:indoor=yes
    expect(screen.queryByText('カフェH')).toBeNull() // 未登録
  })

  it('車椅子: チェックで「一部対応以上」（gte_partial）、外すと「すべて」（all）', () => {
    render(<Harness preActions={[ 
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    const wp = screen.getByRole('group', { name: '設備で絞る' })

    // 一部対応以上 → yes/designated/limited が残る（未登録は除外）
    fireEvent.click(within(wp).getByRole('checkbox', { name: '車椅子' }))
    expect(screen.getByText('カフェG')).toBeTruthy() // yes
    expect(screen.getByText('カフェJ')).toBeTruthy() // limited
    expect(screen.getByText('ラーメンI')).toBeTruthy() // designated
    expect(screen.queryByText('カフェH')).toBeNull() // 未登録

    // 解除 → 全件（4件）
    fireEvent.click(within(wp).getByRole('checkbox', { name: '車椅子' }))
    expect(screen.getByText('カフェH')).toBeTruthy()
  })
})

describe('MobileListTab: 横長コンパクトフィルタバー（id 28。1行1コントロール＋チップ横スクロール）', () => {
  it('チップ行は1行で横スクロールし、縦に改行しない（設備）。車椅子はチェックボックス', () => {
    render(<Harness preActions={[ 
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)

    for (const name of ['設備で絞る']) {
      const group = screen.getByRole('group', { name })
      // チップ群は1行で横スクロール（overflow-x-auto・flex は nowrap の意図）。改行用 flex-wrap は無い
      expect(group.className).toContain('overflow-x-auto')
      expect(group.className).toContain('flex')
      expect(group.className).not.toContain('flex-wrap')
      // 見出しはチップ群と同じ行（row）に横並び。row は flex の1行容器
      const row = group.parentElement
      expect(row.className).toContain('flex')
      expect(row.className).toContain('min-h-[44px]')
      expect(group.previousElementSibling).toBeTruthy() // 見出しが直前の子
      expect(group.previousElementSibling.className).toContain('min-h-[44px]')
    }

    // 設備行: チェックボックス群は横スクロールの1行で、見出し（📶 設備）が同じ行に並ぶ
    const wc = screen.getByRole('checkbox', { name: '車椅子' })
    const wcGroup = wc.parentElement.parentElement
    expect(wcGroup.className).toContain('flex')
    expect(wcGroup.className).toContain('overflow-x-auto')
    expect(wcGroup.className).not.toContain('flex-wrap')
    expect(wcGroup.previousElementSibling).toBeTruthy() // 見出しが直前の子
    expect(wcGroup.previousElementSibling.className).toContain('min-h-[44px]')
  })

  it('入力・セレクト行も横長の1行で、見出し（アイコン＋文言）がコントロールの右隣に並ぶ', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)

    // キーワード入力行: 見出し（🔍アイコンのみ・文言は除去）＋入力が同じ flex 行、
    // 右側にフィルタクリアシンボルの固定スロットを確保
    const kw = screen.getByRole('textbox', { name: '名前・メモで絞り込む' })
    expect(kw.parentElement.className).toContain('flex')
    expect(kw.parentElement.className).toContain('min-h-[44px]')
    const kwHeading = kw.previousElementSibling
    expect(kwHeading).toBeTruthy()
    expect(kwHeading.textContent).toContain('🔍')
    expect(kwHeading.textContent).not.toContain('キーワード')
    // クリアスロット（w-9）が入力欄の右側に常時確保される
    expect(kw.parentElement.lastElementChild.className).toContain('w-9')

    // カテゴリ・並び順セレクト: 見出し（アイコン＋文言）がセレクトの右隣に並ぶ
    const cat = screen.getByRole('combobox', { name: '種別詳細で絞り込む' })
    expect(cat.parentElement.className).toContain('flex')
    expect(cat.previousElementSibling.textContent).toContain('種別詳細')
    expect(cat.previousElementSibling.textContent).toContain('📁')
    const sort = screen.getByRole('combobox', { name: '並び順' })
    expect(sort.parentElement.className).toContain('flex')
    expect(sort.previousElementSibling.textContent).toContain('並び順')
    expect(sort.previousElementSibling.textContent).toContain('↕️')
  })

  it('バリアフリー一覧: 要素種別セレクトとリセットが1行に横並びし、種別見出しはセレクトの右隣', () => {
    render(<Harness preActions={bfMobileActions()} />)

    // バリアフリー一覧には施設向けのカテゴリ・未登録セレクトは出ない
    expect(screen.queryByRole('combobox', { name: '種別詳細で絞り込む' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: '属性の欠落で絞る' })).toBeNull()

    const type = screen.getByRole('combobox', { name: '要素種別で絞り込む' })
    const reset = screen.getByRole('button', { name: 'リセット' })
    // 種別セレクト行とリセットは同じ flex 行（1行に横並び）。
    // リセットの直前の子が種別セレクト行（row）なら、両者は同じ flex 行の隣り合う子
    const typeRow = type.parentElement // FilterSelect の row（見出し＋セレクト）
    expect(typeRow).toBe(reset.previousElementSibling)
    expect(reset.parentElement.className).toContain('flex') // 両方を収める flex 行
    // 見出し（📏 要素種別）はセレクトの右隣に並ぶ
    expect(type.previousElementSibling.textContent).toContain('要素種別')
    expect(type.previousElementSibling.textContent).toContain('📏')
  })
})

describe('MobileListTab: キーワード行のフィルタクリアシンボル（✕）', () => {
  it('フィルタ未使用: シンボルは出ないが固定スロットは確保済み（レイアウトがずれない）', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)

    // シンボルは出ない
    expect(screen.queryByRole('button', { name: 'フィルタをクリア' })).toBeNull()
    // キーワード行は 見出し（🔍のみ）＋入力欄＋スロット（w-9） の3要素で固定
    const kwRow = screen.getByRole('textbox', { name: '名前・メモで絞り込む' }).parentElement
    expect(kwRow.childElementCount).toBe(3)
    expect(kwRow.lastElementChild.className).toContain('w-9')
  })

  it('フィルタ適用中: キーワード行の右側にシンボル（✕・aria-label「フィルタをクリア」）が出て、クリックで全フィルタがリセットされる', () => {
    const log = []
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: FILTERBAR_ITEMS },
      { type: 'SET_STATUS', payload: 'success' },
    ]} log={log} />)

    // キーワードフィルタを適用（ラーメンI に一致）→ シンボルが出る
    fireEvent.change(screen.getByRole('textbox', { name: '名前・メモで絞り込む' }), { target: { value: 'ラーメン' } })
    const clearBtn = screen.getByRole('button', { name: 'フィルタをクリア' })
    expect(clearBtn).toBeTruthy()
    // キーワード行の右端の確保済みスロット内・ツールチップと aria-label で「フィルタをクリア」
    const kwRow = screen.getByRole('textbox', { name: '名前・メモで絞り込む' }).parentElement
    expect(clearBtn.parentElement).toBe(kwRow.lastElementChild)
    expect(clearBtn.title).toBe('フィルタをクリア')

    // クリック → 全フィルタが一度にリセットされる
    fireEvent.click(clearBtn)
    expect(screen.getByRole('textbox', { name: '名前・メモで絞り込む' }).value).toBe('')
    expect(screen.queryByRole('button', { name: 'フィルタをクリア' })).toBeNull()
    // リセットで dispatch された SET_RESULT_FILTERS は既定値（nameFilter 空・wifi all）
    const setActs = log.filter((a) => a.type === 'SET_RESULT_FILTERS')
    const last = setActs[setActs.length - 1]
    expect(last.payload.nameFilter).toBe('')
    expect(last.payload.wifi).toBe('all')
  })

  it('バリアフリー一覧: キーワード行の右側にもシンボルが出る（カテゴリ・目的は検索条件なので集計しない）', () => {
    render(<Harness preActions={bfMobileActions()} />)

    // 絞り込みなし: シンボルは出ない・スロットは確保済み
    expect(screen.queryByRole('button', { name: 'フィルタをクリア' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '名前・メモで絞り込む' }).parentElement.lastElementChild.className).toContain('w-9')

    // 要素種別で絞り込む（way: 歩道1件が残る）→ シンボルが出る
    fireEvent.change(screen.getByRole('combobox', { name: '要素種別で絞り込む' }), { target: { value: 'way' } })
    const clearBtn = screen.getByRole('button', { name: 'フィルタをクリア' })
    expect(clearBtn).toBeTruthy()
    const kwRow = screen.getByRole('textbox', { name: '名前・メモで絞り込む' }).parentElement
    expect(clearBtn.parentElement).toBe(kwRow.lastElementChild)
  })
})

describe('MobileListTab: 検索の共有ボタン（ピースN）', () => {
  const poiActions = [
    { type: 'SET_SEARCH_SOURCE', payload: 'map' },
    { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
    { type: 'SET_STATUS', payload: 'success' },
  ]

  it('結果があるときは件数表示の右側に「📎 検索を共有」ボタンが横並びで表示される', () => {
    render(<Harness preActions={poiActions} />)

    const countText = screen.getByText('2件中、2件を表示')
    const shareBtn = screen.getByRole('button', { name: /検索を共有/ })
    expect(shareBtn).toBeTruthy()

    // 同じ行（flexコンテナ）内にあり、件数テキストの後に配置される
    const row = countText.parentElement
    expect(row.classList.contains('flex')).toBe(true)
    expect(row.contains(shareBtn)).toBe(true)
    expect((countText.compareDocumentPosition(shareBtn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
  })

  it('tooltip の文言は「共有したURLを開くと…」になっている', () => {
    render(<Harness preActions={poiActions} />)

    expect(screen.getByText(/共有したURLを開くと同じ画面・条件・絞り込みで開けますが/)).toBeTruthy()
    expect(screen.queryByText(/共有URLを開くと/)).toBeNull()
  })

  it('結果が0件のときは共有ボタンは表示されない', () => {
    render(<Harness preActions={[
      { type: 'SET_SEARCH_SOURCE', payload: 'map' },
      { type: 'SET_RESULTS', payload: [] },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)

    expect(screen.queryByRole('button', { name: /検索を共有/ })).toBeNull()
  })

  it('バリアフリー一覧には共有ボタンが出ない（共有URLは検索条件のエンコードのみ）', () => {
    render(<Harness preActions={bfMobileActions()} />)

    expect(screen.queryByRole('button', { name: /検索を共有/ })).toBeNull()
  })
})

describe('MobileListTab: メモ帳の登録先', () => {
  const preActions = [
    { type: 'SET_RESULTS', payload: [cafeWithWeb, park] },
    { type: 'SET_STATUS', payload: 'success' },
  ]

  beforeEach(() => {
    localStorage.removeItem(MEMOCHO_STORAGE_KEY)
    localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify([{ id: 'outing', name: 'お出かけ' }]))
    resetMemochoStore()
    resetScrapbooksStore()
  })

  afterEach(() => {
    localStorage.removeItem(MEMOCHO_STORAGE_KEY)
    localStorage.removeItem(SCRAPBOOKS_STORAGE_KEY)
    resetMemochoStore()
    resetScrapbooksStore()
  })

  it('カードの直前で登録先を選び、選択した冊子に追加する', () => {
    render(<Harness preActions={preActions} />)

    const destination = screen.getByRole('combobox', { name: /メモ帳の登録先/ })
    const card = document.getElementById('facility-card-node/1')
    expect(card.parentElement.previousElementSibling.contains(destination)).toBe(true)
    expect(destination.value).toBe('default')
    fireEvent.change(destination, { target: { value: 'outing' } })
    fireEvent.click(within(card).getByRole('button', { name: /メモ帳に追加/ }))
    expect(loadMemocho()).toEqual([expect.objectContaining({ id: 1, bookId: 'outing' })])
    expect(within(card).getByRole('button', { name: /メモ帳から削除/ })).toBeTruthy()
  })

  it('ごみ箱にある施設を選択した冊子に復元し、元のメモを引き継ぐ', () => {
    localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify([{
      ...cafeWithWeb,
      bookId: 'default',
      memo: '保存したメモ',
      deletedAt: new Date().toISOString(),
    }]))
    render(<Harness preActions={preActions} />)

    fireEvent.change(screen.getByRole('combobox', { name: /メモ帳の登録先/ }), {
      target: { value: 'outing' },
    })
    const card = document.getElementById('facility-card-node/1')
    fireEvent.click(within(card).getByRole('button', { name: /メモ帳に追加/ }))

    const [item] = loadMemocho()
    expect(loadMemocho()).toHaveLength(1)
    expect(item).toMatchObject({ id: 1, bookId: 'outing', memo: '保存したメモ' })
    expect(item.deletedAt).toBeUndefined()
  })
})

describe('MobileListTab: カード列数の仕様を3画面で統一しCSSを共通化（ピースP）', () => {
  it('POI一覧とバリアフリー一覧のカード一覧は共通の .card-grid を使う', () => {
    render(<Harness preActions={[
      { type: 'SET_RESULTS', payload: [cafeWithWeb] },
      { type: 'SET_STATUS', payload: 'success' },
    ]} />)
    // POI一覧: カードの親が共通グリッド
    const poiCard = document.getElementById('facility-card-node/1')
    expect(poiCard).toBeTruthy()
    expect(poiCard.closest('.card-grid')).toBeTruthy()

    cleanup()
    render(<Harness preActions={bfMobileActions()} />)
    // バリアフリー一覧: 同じ共通グリッド
    const bfCard = document.getElementById('barrier-free-card-node/200')
    expect(bfCard).toBeTruthy()
    expect(bfCard.closest('.card-grid')).toBeTruthy()
  })
})
