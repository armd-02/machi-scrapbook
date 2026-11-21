/**
 * stationCandidates.js のユニットテスト
 *
 * - loadStationFile: stations.json の読み込み（BASE_URL 付き）・モジュール
 *   キャッシュ（再フォーカス時の再取得防止）・失敗時の空配列（従来動作）
 * - stationFileToCandidates: [名前, 緯度, 経度, 種別] → 候補変換（種別ラベル・
 *   不正行の除外）
 * - matchStationCandidates: 部分一致・「駅」なし入力で駅名に一致・
 *   路面電車・ケーブルカーの部分一致
 * - combineSuggestCandidates: 駅候補＋周辺候補の結合（位置があれば距離順・
 *   なければ駅→周辺の順・上限8件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 駅ファイルのフィクスチャ行（[名前, 緯度, 経度, 種別]。種別: 0=駅・
// 1=路面電車・2=ケーブルカー）
const FIXTURE_ROWS = [
  ['大阪駅', 34.70001, 135.49501, 0],
  ['摂津富田駅', 34.718, 135.52, 0],
  ['東京駅', 35.688, 139.766, 0],
  ['西長田ゆりの里', 34.702, 135.49, 1],
  ['美智駅', 34.29, 135.29, 2],
]

/** 指定の行を返す fetch モックをインストールする */
function mockFetchOk(rows) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => rows,
  })
}

describe('loadStationFile', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('stations.json を読み込み、行の配列を返す（BASE_URL 付きURL）', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_ROWS,
    })
    const { loadStationFile } = await import('../stationCandidates')
    const rows = await loadStationFile()
    expect(rows).toEqual(FIXTURE_ROWS)
    // import.meta.env.BASE_URL 付きで data/stations.json を叩く
    expect(fetchMock.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}data/stations.json`)
  })

  it('モジュールキャッシュで再呼び出し時に再取得しない', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_ROWS,
    })
    const { loadStationFile } = await import('../stationCandidates')
    await loadStationFile()
    await loadStationFile()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('読み込み失敗（404）時は空配列を返す（従来動作・例外にしない）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    })
    const { loadStationFile } = await import('../stationCandidates')
    await expect(loadStationFile()).resolves.toEqual([])
  })

  it('fetch 自体が例外を送出しても空配列を返す', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const { loadStationFile } = await import('../stationCandidates')
    await expect(loadStationFile()).resolves.toEqual([])
  })

  it('形式不正（配列でない）応答は空配列を返す', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stations: FIXTURE_ROWS }),
    })
    const { loadStationFile } = await import('../stationCandidates')
    await expect(loadStationFile()).resolves.toEqual([])
  })
})

describe('stationFileToCandidates', () => {
  it('行を候補に変換する（種別コード→ラベル・displayName 付与）', async () => {
    const { stationFileToCandidates } = await import('../stationCandidates')
    const cands = stationFileToCandidates(FIXTURE_ROWS)
    expect(cands).toHaveLength(5)
    expect(cands[0]).toEqual({
      name: '大阪駅',
      lat: 34.70001,
      lon: 135.49501,
      kind: '駅',
      displayName: '大阪駅',
      prefecture: '',
      city: '',
    })
    expect(cands[3].kind).toBe('路面電車')
    expect(cands[4].kind).toBe('ケーブルカー')
  })

  it('形式不正な行は除外する', async () => {
    const { stationFileToCandidates } = await import('../stationCandidates')
    const rows = [
      ['大阪駅', 34.7, 135.5, 0],
      ['ア', 34.7, 135.5, 0], // 名前が1文字（実データに呉・津などがあるため採用）
      [null, 34.7, 135.5, 0], // 名前が文字列でない
      ['駅X', '34.7', 135.5, 0], // 緯度が数値でない
      ['駅Y', 34.7, 135.5, 9], // 未知の種別
      ['駅Z', 34.7, 135.5], // 要素不足
    ]
    const cands = stationFileToCandidates(rows)
    expect(cands.map((c) => c.name)).toEqual(['大阪駅', 'ア'])
  })

  it('null・空配列は空配列を返す', async () => {
    const { stationFileToCandidates } = await import('../stationCandidates')
    expect(stationFileToCandidates(null)).toEqual([])
    expect(stationFileToCandidates([])).toEqual([])
  })
})

describe('matchStationCandidates', () => {
  async function candidates() {
    const { stationFileToCandidates } = await import('../stationCandidates')
    return stationFileToCandidates(FIXTURE_ROWS)
  }

  it('遠方の駅が名前の一部で候補に出る（「東京」で東京駅）', async () => {
    const { matchStationCandidates } = await import('../stationCandidates')
    const matched = matchStationCandidates(await candidates(), '東京')
    expect(matched.map((c) => c.name)).toEqual(['東京駅'])
  })

  it('「駅」を付けなくても駅名に一致する（「大阪」で大阪駅）', async () => {
    const { matchStationCandidates } = await import('../stationCandidates')
    const matched = matchStationCandidates(await candidates(), '大阪')
    expect(matched.map((c) => c.name)).toEqual(['大阪駅'])
  })

  it('駅名の「駅」を外した入力でも駅に当たる（「摂津富田」で摂津富田駅）', async () => {
    const { matchStationCandidates } = await import('../stationCandidates')
    const matched = matchStationCandidates(await candidates(), '摂津富田')
    expect(matched.map((c) => c.name)).toEqual(['摂津富田駅'])
  })

  it('路面電車の停留所（名前に「駅」が付かない）が部分一致で出る', async () => {
    const { matchStationCandidates } = await import('../stationCandidates')
    const matched = matchStationCandidates(await candidates(), 'ゆりの里')
    expect(matched.map((c) => c.name)).toEqual(['西長田ゆりの里'])
    expect(matched[0].kind).toBe('路面電車')
  })

  it('ケーブルカーの駅が部分一致で出る', async () => {
    const { matchStationCandidates } = await import('../stationCandidates')
    const matched = matchStationCandidates(await candidates(), '美智')
    expect(matched.map((c) => c.name)).toEqual(['美智駅'])
    expect(matched[0].kind).toBe('ケーブルカー')
  })

  it('1文字の駅名（実データに呉・津などがある）は2文字の入力から候補に出る', async () => {
    const { stationFileToCandidates, matchStationCandidates } = await import('../stationCandidates')
    const cands = stationFileToCandidates([['呉', 34.37, 132.45, 0]])
    expect(cands.map((c) => c.name)).toEqual(['呉'])
    const matched = matchStationCandidates(cands, '呉市')
    expect(matched.map((c) => c.name)).toEqual(['呉'])
  })

  it('2文字未満の入力は空配列を返す', async () => {
    const { matchStationCandidates } = await import('../stationCandidates')
    expect(matchStationCandidates(await candidates(), '大')).toEqual([])
    expect(matchStationCandidates(await candidates(), '')).toEqual([])
  })
})

describe('combineSuggestCandidates', () => {
  const station = (name, lat, lon, kind = '駅') => ({
    name, lat, lon, kind, displayName: name, prefecture: '', city: ''
  })
  const area = (name, lat, lon) => ({
    name, lat, lon, kind: '地区', displayName: name, prefecture: '', city: '', distanceKm: 0
  })

  it('現在地がある場合: 駅候補にも距離を付けて距離順に結合する', async () => {
    const { combineSuggestCandidates } = await import('../stationCandidates')
    const center = { lat: 34.7, lon: 135.5 }
    const stations = [station('東京駅', 35.688, 139.766)]
    const nearby = [area('近い町', 34.701, 135.501)]
    const merged = combineSuggestCandidates(stations, nearby, center)
    // 近い町（約150m）が東京駅（約400km）より先になる
    expect(merged.map((c) => c.name)).toEqual(['近い町', '東京駅'])
    expect(merged[1].distanceKm).toBeGreaterThan(300)
  })

  it('現在地がない場合: 駅候補→周辺候補の順に結合する', async () => {
    const { combineSuggestCandidates } = await import('../stationCandidates')
    const merged = combineSuggestCandidates(
      [station('大阪駅', 34.7, 135.49)],
      [area('某町', 34.701, 135.5)],
      null
    )
    expect(merged.map((c) => c.name)).toEqual(['大阪駅', '某町'])
  })

  it('表示上限（8件）に絞る', async () => {
    const { combineSuggestCandidates } = await import('../stationCandidates')
    const stations = Array.from({ length: 6 }, (_, i) =>
      station(`駅${i + 1}`, 34.7 + i * 0.01, 135.5)
    )
    const nearby = Array.from({ length: 5 }, (_, i) =>
      area(`町${i + 1}`, 34.7 + i * 0.01, 135.501)
    )
    const merged = combineSuggestCandidates(stations, nearby, null)
    expect(merged).toHaveLength(8)
  })

  it('片方（または両方）が空でも結合できる', async () => {
    const { combineSuggestCandidates } = await import('../stationCandidates')
    expect(combineSuggestCandidates([], [area('某町', 34.7, 135.5)], null).map((c) => c.name))
      .toEqual(['某町'])
    expect(combineSuggestCandidates([station('大阪駅', 34.7, 135.49)], [], null).map((c) => c.name))
      .toEqual(['大阪駅'])
    expect(combineSuggestCandidates([], [], null)).toEqual([])
  })
})
