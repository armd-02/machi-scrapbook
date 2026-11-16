/**
 * municipalities.js のユニットテスト（fetch をモックしネットワークなし）
 *
 * - loadMunicipalities: municipalities.json を取得して配列を返す。
 *   モジュールキャッシュで二重取得しない。失敗時は空配列（例外にしない）
 *   ※ モジュールレベルキャッシュ（cachePromise）がテスト間に残るため、
 *     vi.resetModules() の後に動的importして全新したモジュールを使う
 * - matchMunicipalities: 完全一致が前方一致より先、最大3件、同名自治体を
 *   すべて返す、2文字未満は空
 * - exactMatchMunicipalities: 完全一致のみ（同名はすべて）
 * - municipalityToCandidate: サジェスト候補形状への変換（bbox中心・kind・ラベル）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { geocodeCandidateLabel } from '../geo'
import {
  matchMunicipalities,
  exactMatchMunicipalities,
  municipalityToCandidate
} from '../municipalities'

// fixtures: municipalities.json の1要素と同じ形（name/prefecture/code/bbox/displayName）
const UJI = {
  name: '宇治市', prefecture: '京都府', code: '262048',
  bbox: { south: 34.85793, west: 135.75965, north: 34.95709, east: 135.87992 },
  displayName: '宇治市'
}
const UJI_TAHARA = {
  name: '宇治田原町', prefecture: '京都府', code: '263443',
  bbox: { south: 34.81365, west: 135.82944, north: 34.89238, east: 135.94703 },
  displayName: '宇治田原町'
}
const UJI_MACHI = {
  name: '宇治町', prefecture: '京都府', code: '260999',
  bbox: { south: 34.9, west: 135.8, north: 34.95, east: 135.85 },
  displayName: '宇治町'
}
const UJI_OHASHI = {
  name: '宇治大橋町', prefecture: '京都府', code: '261000',
  bbox: { south: 34.86, west: 135.78, north: 34.9, east: 135.82 },
  displayName: '宇治大橋町'
}
const IDATE_HOKKAIDO = {
  name: '伊達市', prefecture: '北海道', code: '012335',
  bbox: { south: 42.32789, west: 140.5784, north: 42.82731, east: 141.19908 },
  displayName: '伊達市'
}
const IDATE_FUKUSHIMA = {
  name: '伊達市', prefecture: '福島県', code: '072133',
  bbox: { south: 37.68924, west: 140.48632, north: 37.91517, east: 140.73663 },
  displayName: '伊達市'
}
const OSAKA = {
  name: '大阪市', prefecture: '大阪府', code: '27109',
  bbox: { south: 34.56, west: 135.34, north: 34.72, east: 135.52 },
  displayName: '大阪市（都府県）'
}
const OSAKA_KITA = {
  name: '大阪市北区', prefecture: '大阪府', code: '27102',
  bbox: { south: 34.78051, west: 135.47011, north: 34.79045, east: 135.50012 },
  displayName: '大阪市北区'
}

const MUNIS = [UJI, UJI_TAHARA, UJI_MACHI, UJI_OHASHI, IDATE_HOKKAIDO, IDATE_FUKUSHIMA, OSAKA, OSAKA_KITA]

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: new Map(), json: async () => payload }
}

// モジュールキャッシュをリセットして全新した municipalities モジュールを得る
async function freshLoadMunicipalities() {
  vi.resetModules()
  const mod = await import('../municipalities')
  return mod.loadMunicipalities
}

describe('loadMunicipalities', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('municipalities.json を取得して municipalities 配列を返す（URLはBASE_URL+data/municipalities.json）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ count: 8, municipalities: MUNIS }))
    vi.stubGlobal('fetch', fetchMock)
    const loadMunicipalities = await freshLoadMunicipalities()

    const result = await loadMunicipalities()

    expect(result).toEqual(MUNIS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/data/municipalities.json')
  })

  it('モジュールレベルのキャッシュで二重取得しない（同一Promiseを再利用）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ municipalities: MUNIS }))
    vi.stubGlobal('fetch', fetchMock)
    const loadMunicipalities = await freshLoadMunicipalities()

    const p1 = loadMunicipalities()
    const p2 = loadMunicipalities()

    expect(p1).toBe(p2)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(MUNIS)
    expect(r2).toEqual(MUNIS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('レスポンスがok:falseの場合は空配列を返す（例外にしない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 500 })))
    const loadMunicipalities = await freshLoadMunicipalities()

    const result = await loadMunicipalities()
    expect(result).toEqual([])
  })

  it('fetchがreject（ネットワークエラー）の場合は空配列を返す（例外にしない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const loadMunicipalities = await freshLoadMunicipalities()

    const result = await loadMunicipalities()
    expect(result).toEqual([])
  })

  it('municipalitiesキーが無い・配列でない場合は空配列を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ count: 2 })))
    const loadMunicipalities = await freshLoadMunicipalities()
    expect(await loadMunicipalities()).toEqual([])
  })
})

describe('matchMunicipalities', () => {
  it('完全一致（name === q）を先頭に、前方一致をその後に並べる', () => {
    // 完全一致の「大阪市」が先頭、前方一致の「大阪市北区」が続く
    expect(matchMunicipalities(MUNIS, '大阪市').map((m) => m.name))
      .toEqual(['大阪市', '大阪市北区'])
  })

  it('返すのは最大3件', () => {
    // 「宇治」で前方一致する自治体が4件あるが、3件で切られる
    const result = matchMunicipalities(MUNIS, '宇治')
    expect(result).toHaveLength(3)
    expect(result.map((m) => m.name)).toEqual(['宇治市', '宇治田原町', '宇治町'])
  })

  it('同名自治体（完全一致が複数）は両方返す', () => {
    const result = matchMunicipalities(MUNIS, '伊達市')
    // 北海道・福島県の「伊達市」の両方が返される
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.prefecture)).toEqual(['北海道', '福島県'])
  })

  it('2文字未満のqueryは空配列を返す', () => {
    expect(matchMunicipalities(MUNIS, '宇')).toEqual([])
    expect(matchMunicipalities(MUNIS, '')).toEqual([])
    expect(matchMunicipalities(MUNIS, '   ')).toEqual([])
  })

  it('queryの前後空白はtrimして照合する', () => {
    expect(matchMunicipalities(MUNIS, '  宇治  ').map((m) => m.name))
      .toEqual(['宇治市', '宇治田原町', '宇治町'])
  })

  it('municipalitiesが空・非配列の場合は空配列を返す', () => {
    expect(matchMunicipalities([], '宇治')).toEqual([])
    expect(matchMunicipalities(null, '宇治')).toEqual([])
  })
})

describe('exactMatchMunicipalities', () => {
  it('完全一致のみを返す（前方一致は含まれない）', () => {
    // 「宇治」は「宇治市」の前方一致だが完全一致ではない → 含まれない
    expect(exactMatchMunicipalities(MUNIS, '宇治')).toEqual([])
  })

  it('同名自治体（完全一致が複数）はすべて返す', () => {
    const result = exactMatchMunicipalities(MUNIS, '伊達市')
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.prefecture)).toEqual(['北海道', '福島県'])
  })

  it('queryの前後空白はtrimして照合する。空queryは空配列', () => {
    expect(exactMatchMunicipalities(MUNIS, ' 宇治市 ').map((m) => m.name)).toEqual(['宇治市'])
    expect(exactMatchMunicipalities(MUNIS, '')).toEqual([])
  })
})

describe('municipalityToCandidate', () => {
  it('サジェスト候補と同じ形に変換する（lat/lonはbbox中心、kindは「自治体」）', () => {
    expect(municipalityToCandidate(UJI)).toEqual({
      name: '宇治市',
      prefecture: '京都府',
      city: '',
      kind: '自治体',
      lat: (34.85793 + 34.95709) / 2,
      lon: (135.75965 + 135.87992) / 2,
      boundingbox: UJI.bbox,
      displayName: '宇治市'
    })
  })

  it('displayNameが無い場合はnameを使う', () => {
    const m = { name: 'テスト市', prefecture: '京都府', code: '260001', bbox: UJI.bbox }
    expect(municipalityToCandidate(m).displayName).toBe('テスト市')
  })

  it('geocodeCandidateLabelで「宇治市（自治体・京都府）」のラベルになる', () => {
    expect(geocodeCandidateLabel(municipalityToCandidate(UJI))).toBe('宇治市（自治体・京都府）')
  })

  it('bboxが無い場合はlat/lon・boundingboxがnull（例外にならない）', () => {
    const c = municipalityToCandidate({ name: '南鳥島', prefecture: '東京都' })
    expect(c.lat).toBeNull()
    expect(c.lon).toBeNull()
    expect(c.boundingbox).toBeNull()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
