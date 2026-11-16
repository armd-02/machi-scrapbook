import { describe, it, expect } from 'vitest'
import {
  BARRIER_FREE_CATEGORY,
  BARRIER_FREE_PURPOSE,
  isBarrierFreeCriteria,
  toStandardResults,
  parseBarrierFreeResponse,
  barrierFreeTypeLabel,
  tactileStatus,
  lengthLabel,
  signalLabels,
  filterByBbox,
  kerbHeightClass
} from '../barrierFreeResults'

/**
 * (#62) バリアフリー検索 第3ピース:
 * 結果の正規化（toStandardResults / parseBarrierFreeResponse）と
 * 一覧表示用ユーティリティ（ラベル・点字ブロック・長さ・案内）をテストする。
 */

// ===== パース済み要素（parseBarrierFreeElements の出力形状） =====
const footway = {
  kind: 'way',
  osmId: 'way/100',
  geometry: [[135.0, 34.0], [135.01, 34.01], [135.02, 34.0]],
  tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' },
  tactile: 'yes',
  lengthM: 152
}

const kerbNode = {
  kind: 'node',
  osmId: 'node/200',
  geometry: [135.1, 34.1],
  tags: { barrier: 'kerb' },
  kerb: null,
  hasSound: false,
  hasVibration: false,
  tactile: null
}

const soundNode = {
  kind: 'node',
  osmId: 'node/300',
  geometry: [135.2, 34.2],
  tags: { traffic_signals: 'sound', 'traffic_signals:sound': 'yes' },
  kerb: null,
  hasSound: true,
  hasVibration: false,
  tactile: null
}

/** 整形済み要素1つを共通結果形状に変換するヘルパー */
const standard = (el) => toStandardResults([el])[0]

describe('isBarrierFreeCriteria', () => {
  it('カテゴリが barrier_free なら true（目的なしでも）', () => {
    expect(isBarrierFreeCriteria('barrier_free', '')).toBe(true)
  })
  it('目的が「バリアフリー」なら true（カテゴリなしでも）', () => {
    expect(isBarrierFreeCriteria('', 'バリアフリー')).toBe(true)
  })
  it('通常のカテゴリ・目的は false', () => {
    expect(isBarrierFreeCriteria('cafe', '')).toBe(false)
    expect(isBarrierFreeCriteria('', '遊ぶ')).toBe(false)
    expect(isBarrierFreeCriteria(undefined, undefined)).toBe(false)
  })
  it('定数がカテゴリid・目的名と一致する', () => {
    expect(BARRIER_FREE_CATEGORY).toBe('barrier_free')
    expect(BARRIER_FREE_PURPOSE).toBe('バリアフリー')
  })
})

describe('toStandardResults', () => {
  it('way を共通結果形状に正規化する（id/type/lat/lon/name/osmId/bf）', () => {
    const [r] = toStandardResults([footway])
    expect(r.type).toBe('way')
    expect(r.id).toBe(100)
    expect(r.osmId).toBe('way/100')
    expect(r.tags).toBe(footway.tags)
    expect(r.name).toBe('中央通り歩道')
    // lat/lon は頂点の平均（近似中心点）
    expect(r.lon).toBeCloseTo((135.0 + 135.01 + 135.02) / 3, 10)
    expect(r.lat).toBeCloseTo((34.0 + 34.01 + 34.0) / 3, 10)
    expect(r.bf.kind).toBe('way')
    expect(r.bf.lengthM).toBe(152)
    expect(r.bf.tactile).toBe('yes')
    expect(r.bf.geometry).toBe(footway.geometry)
    // way には案内信号・縁石の情報がない
    expect(r.bf.hasSound).toBe(false)
    expect(r.bf.hasVibration).toBe(false)
  })

  it('node を共通結果形状に正規化する（正確な lat/lon）', () => {
    const [r] = toStandardResults([kerbNode])
    expect(r.type).toBe('node')
    expect(r.id).toBe(200)
    expect(r.lat).toBe(34.1)
    expect(r.lon).toBe(135.1)
    expect(r.name).toBeNull()
    expect(r.bf.kind).toBe('node')
    expect(r.bf.lengthM).toBeNull()
    expect(r.bf.hasSound).toBe(false)
  })

  it('name タグが無い場合は name:ja を使う', () => {
    const [r] = toStandardResults([{
      ...kerbNode,
      tags: { barrier: 'kerb', 'name:ja': '駅前交差点' }
    }])
    expect(r.name).toBe('駅前交差点')
  })

  it('name 系タグが皆無なら name は null', () => {
    const [r] = toStandardResults([footway])
    expect(toStandardResults([{ ...footway, tags: { highway: 'footway' } }])[0].name).toBeNull()
    expect(r.name).toBe('中央通り歩道')
  })

  it('空・未定義の入力は空配列を返す', () => {
    expect(toStandardResults([])).toEqual([])
    expect(toStandardResults(undefined)).toEqual([])
  })

  it('混在した要素も全て変換される', () => {
    const out = toStandardResults([footway, kerbNode, soundNode])
    expect(out).toHaveLength(3)
    expect(out.map((r) => r.type)).toEqual(['way', 'node', 'node'])
    expect(out.map((r) => r.id)).toEqual([100, 200, 300])
  })
})

describe('parseBarrierFreeResponse', () => {
  it('Overpass応答JSONを共通結果形状にパースする（executeOverpassQueryのparse用）', () => {
    const data = {
      version: 0.6,
      elements: [
        {
          type: 'way',
          id: 100,
          tags: { highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' },
          geometry: [
            { lon: 135.0, lat: 34.0 },
            { lon: 135.01, lat: 34.01 }
          ]
        },
        {
          type: 'node',
          id: 300,
          tags: { traffic_signals: 'sound', 'traffic_signals:sound': 'yes' },
          lat: 34.2,
          lon: 135.2
        },
        // geometry が無いウェイは除外される（parseBarrierFreeElements の仕様）
        { type: 'way', id: 999, tags: { highway: 'footway' } }
      ]
    }
    const out = parseBarrierFreeResponse(data)
    expect(out).toHaveLength(2)
    const [way, node] = out
    // SET_RESULTS に渡される共通結果形状（id/type/tags/lat/lon/name/osmId/bf）
    expect(way.type).toBe('way')
    expect(way.id).toBe(100)
    expect(way.osmId).toBe('way/100')
    expect(way.name).toBe('中央通り歩道')
    expect(way.tags).toEqual({ highway: 'footway', tactile_paving: 'yes', name: '中央通り歩道' })
    expect(way.bf.tactile).toBe('yes')
    expect(way.bf.lengthM).toBeGreaterThan(0)
    expect(node.type).toBe('node')
    expect(node.id).toBe(300)
    expect(node.osmId).toBe('node/300')
    expect(node.bf.hasSound).toBe(true)
    expect(node.lat).toBe(34.2)
  })

  it('data が空なら空配列を返す', () => {
    expect(parseBarrierFreeResponse(null)).toEqual([])
    expect(parseBarrierFreeResponse({})).toEqual([])
    expect(parseBarrierFreeResponse({ elements: [] })).toEqual([])
  })
})

describe('barrierFreeTypeLabel', () => {
  it('footway → 歩道', () => {
    expect(barrierFreeTypeLabel(standard(footway))).toBe('歩道')
  })
  it('path → 歩行者用通路', () => {
    expect(barrierFreeTypeLabel(standard({
      ...footway,
      osmId: 'way/101',
      tags: { highway: 'path' }
    }))).toBe('歩行者用通路')
  })
  it('それ以外の highway 値 → 通路(タグ値)', () => {
    expect(barrierFreeTypeLabel(standard({
      ...footway,
      osmId: 'way/102',
      tags: { highway: 'steps' }
    }))).toBe('通路(steps)')
  })
  it('barrier=kerb のノード → 縁石', () => {
    expect(barrierFreeTypeLabel(standard(kerbNode))).toBe('縁石')
  })
  it('kerb タグのノード → 縁石', () => {
    expect(barrierFreeTypeLabel(standard({
      ...kerbNode,
      osmId: 'node/201',
      tags: { kerb: 'yes' }
    }))).toBe('縁石')
  })
  it('音声案内信号ノード → 音声案内信号', () => {
    expect(barrierFreeTypeLabel(standard(soundNode))).toBe('音声案内信号')
  })
  it('振動案内信号ノード → 振動案内信号', () => {
    expect(barrierFreeTypeLabel(standard({
      ...soundNode,
      osmId: 'node/301',
      tags: { 'traffic_signals:vibration': 'yes' },
      hasSound: false,
      hasVibration: true
    }))).toBe('振動案内信号')
  })
  it('音+振動のノード → 音・振動案内信号', () => {
    expect(barrierFreeTypeLabel(standard({
      ...soundNode,
      osmId: 'node/302',
      hasVibration: true
    }))).toBe('音・振動案内信号')
  })
  it('識別できないノード → バリアフリー要素', () => {
    expect(barrierFreeTypeLabel(standard({
      ...kerbNode,
      osmId: 'node/202',
      tags: {}
    }))).toBe('バリアフリー要素')
  })
  it('undefined でもクラッシュしない', () => {
    expect(barrierFreeTypeLabel(undefined)).toBe('バリアフリー要素')
  })
})

// ===== 縁石の高さ分類（kerbHeightClass） =====

/** 共通結果形状の縁石ノードを作るヘルパー（bf.kerb と tags を指定） */
const kerbResult = (tags = {}, kerb = null) => ({
  type: 'node',
  id: 1,
  tags,
  bf: { kind: 'node', tactile: null, lengthM: null, kerb, hasSound: false, hasVibration: false, geometry: [135.0, 34.0] }
})

describe('kerbHeightClass', () => {
  it('bf.kerb=flush → flat（段差なし）', () => {
    expect(kerbHeightClass(kerbResult({}, 'flush'))).toBe('flat')
  })

  it('kerb:height が 0 → flat（高さが登録されていればそれが優先）', () => {
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '0' }, null))).toBe('flat')
    // 高さ0が登録されていれば、bf.kerb が raised であっても flat
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '0' }, 'raised'))).toBe('flat')
  })

  it('kerb:height が 0 より大で 0.03 以下 → low（低め）', () => {
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '0.01' }, null))).toBe('low')
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '0.02' }, null))).toBe('low')
  })

  it('kerb:height が 0.03（境界値）→ low', () => {
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '0.03' }, null))).toBe('low')
  })

  it('kerb:height が 0.03 より大 → high（高め）', () => {
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '0.031' }, null))).toBe('high')
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '0.05' }, null))).toBe('high')
  })

  it('高さが未記録の場合は bf.kerb=lowered → low', () => {
    expect(kerbHeightClass(kerbResult({}, 'lowered'))).toBe('low')
  })

  it('高さが未記録の場合は bf.kerb=raised → high', () => {
    expect(kerbHeightClass(kerbResult({}, 'raised'))).toBe('high')
  })

  it('flush/lowered/raised 以外の kerb 値（例: cut）→ unknown', () => {
    expect(kerbHeightClass(kerbResult({}, 'cut'))).toBe('unknown')
  })

  it('barrier=kerb のみ（kerb 値・高さとも未記録）→ unknown', () => {
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb' }, null))).toBe('unknown')
  })

  it('kerb:height が数値解釈不可なら kerb 値で判定にフォールバックする', () => {
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': 'abc' }, 'flush'))).toBe('flat')
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '' }, 'lowered'))).toBe('low')
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': 'abc' }, null))).toBe('unknown')
  })

  it('kerb:height が負数（不正値）なら unknown', () => {
    expect(kerbHeightClass(kerbResult({ barrier: 'kerb', 'kerb:height': '-1' }, null))).toBe('unknown')
  })

  it('tags.kerb のみ（bf.kerb が null）でも判定される', () => {
    const r = kerbResult({ barrier: 'kerb', kerb: 'raised' }, null)
    expect(kerbHeightClass(r)).toBe('high')
  })

  it('縁石でない要素は null を返す', () => {
    // 歩道ウェイ（bf は持つが縁石ではない）
    expect(kerbHeightClass({ type: 'way', id: 2, tags: { highway: 'footway' }, bf: { kind: 'way', tactile: 'yes', kerb: null } })).toBeNull()
    // 案内信号ノード（bf は持つが縁石ではない）
    expect(kerbHeightClass({ type: 'node', id: 3, tags: { 'traffic_signals:sound': 'yes' }, bf: { kind: 'node', kerb: null, hasSound: true, hasVibration: false } })).toBeNull()
    // bf を持たないPOI
    expect(kerbHeightClass({ type: 'node', id: 4, tags: { amenity: 'cafe' } })).toBeNull()
  })

  it('undefined / 空オブジェクトでもクラッシュしない', () => {
    expect(kerbHeightClass(undefined)).toBeNull()
    expect(kerbHeightClass({})).toBeNull()
  })
})

describe('tactileStatus', () => {
  it('tactile_paving=yes → 有', () => {
    expect(tactileStatus(standard(footway))).toBe('有')
  })
  it('tactile_paving=no → 無', () => {
    expect(tactileStatus(standard({ ...footway, tactile: 'no' }))).toBe('無')
  })
  it('未登録（null）→ null', () => {
    expect(tactileStatus(standard(kerbNode))).toBeNull()
  })
})

describe('lengthLabel', () => {
  it('way は四捨五入した m 表記', () => {
    expect(lengthLabel(standard(footway))).toBe('152 m')
    expect(lengthLabel(standard({ ...footway, lengthM: 12.4 }))).toBe('12 m')
  })
  it('node は null', () => {
    expect(lengthLabel(standard(kerbNode))).toBeNull()
  })
})

describe('signalLabels', () => {
  it('音声のみ → ["音声"]', () => {
    expect(signalLabels(standard(soundNode))).toEqual(['音声'])
  })
  it('両方 → ["音声", "振動"]', () => {
    expect(signalLabels(standard({ ...soundNode, hasVibration: true })))
      .toEqual(['音声', '振動'])
  })
  it('無ければ空配列', () => {
    expect(signalLabels(standard(kerbNode))).toEqual([])
  })
})

describe('filterByBbox', () => {
  // 検索範囲: 135.0–135.1 (lon) / 34.0–34.1 (lat)
  const bbox = { south: 34.0, west: 135.0, north: 34.1, east: 135.1 }

  const makeWay = (geometry, id = 100) => standard({
    ...footway,
    osmId: `way/${id}`,
    geometry
  })
  const makeNode = (lon, lat, id = 200) => standard({
    ...kerbNode,
    osmId: `node/${id}`,
    geometry: [lon, lat]
  })

  it('範囲外（完全に外側）のウェイは落ちる', () => {
    const out = filterByBbox([makeWay([[135.2, 34.2], [135.3, 34.2]])], bbox)
    expect(out).toHaveLength(0)
  })

  it('境界を横切るウェイ（両端が範囲外だが線分がbboxと交差）は残る', () => {
    // lat 34.05 の水平線: lon 134.9 → 135.2 は bbox の西・東境界をまたぐ
    const out = filterByBbox([makeWay([[134.9, 34.05], [135.2, 34.05]])], bbox)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(100)
  })

  it('いずれかの頂点が範囲内のウェイは残る', () => {
    const out = filterByBbox([makeWay([[135.05, 34.05], [135.3, 34.3]])], bbox)
    expect(out).toHaveLength(1)
  })

  it('完全に外側のウェイが混ざる場合は外側のみが落ちる', () => {
    const out = filterByBbox([
      makeWay([[135.0, 34.05], [135.05, 34.05]], 101),  // 範囲内 → 残る
      makeWay([[135.2, 34.05], [135.2, 34.5]], 102)     // lon 135.2 は常に範囲外 → 落ちる
    ], bbox)
    expect(out.map((r) => r.id)).toEqual([101])
  })

  it('範囲外のノードは落ちる', () => {
    const out = filterByBbox([makeNode(135.2, 34.2)], bbox)
    expect(out).toHaveLength(0)
  })

  it('範囲内のノードは残る', () => {
    const out = filterByBbox([makeNode(135.05, 34.05)], bbox)
    expect(out).toHaveLength(1)
    expect(out[0].lon).toBe(135.05)
  })

  it('境界上のノードは残る（境界を含む）', () => {
    const out = filterByBbox([makeNode(135.0, 34.0, 201)], bbox)
    expect(out).toHaveLength(1)
  })

  it('ウェイは頂点平均（近似中心）ではなく線分で判定する', () => {
    // 西・南・東の外側を回り込む V 字型ウェイ。
    // 頂点平均は (135.05, 34.0) で bbox 内（境界を含む）に入るが、
    // いかなる頂点も bbox 内になく、線分も bbox と交差しないため落とす。
    const geom = [[134.9, 34.05], [135.05, 33.9], [135.2, 34.05]]
    const way = makeWay(geom)
    // 平均中心が bbox 内（境界上）であることを確認（平均で判定すると残る）
    expect(way.lon).toBeCloseTo(135.05, 10)
    expect(way.lat).toBeCloseTo(34.0, 10)
    const out = filterByBbox([way], bbox)
    expect(out).toHaveLength(0)
  })

  it('混在した結果を正しく切り取る（範囲外ウェイ・範囲外ノードが落ちる）', () => {
    const out = filterByBbox([
      makeWay([[135.2, 34.2], [135.3, 34.2]], 100),      // 外 → 落ちる
      makeWay([[134.9, 34.05], [135.2, 34.05]], 101),    // 横切り → 残る
      makeNode(135.2, 34.2, 200),                        // 外 → 落ちる
      makeNode(135.05, 34.05, 201)                       // 内 → 残る
    ], bbox)
    expect(out.map((r) => r.osmId)).toEqual(['way/101', 'node/201'])
  })

  it('空配列・undefined は空配列を返す', () => {
    expect(filterByBbox([], bbox)).toEqual([])
    expect(filterByBbox(undefined, bbox)).toEqual([])
  })

  it('bbox が無効な場合はフィルタせずそのまま返す', () => {
    const results = [makeNode(135.2, 34.2)]
    expect(filterByBbox(results, null)).toBe(results)
    // 縮退bbox（south >= north）は無効
    expect(filterByBbox(results, { south: 34.2, west: 135.0, north: 34.0, east: 135.1 })).toBe(results)
  })
})
