/**
 * OSMベクタベースマップスタイル（mapStyle.js）のテスト
 *
 * - community_mapmaker 由来のスタイル（src/styles/osmfj_poi.json）が mapStyle.js
 *   で読み込まれ、トップレベルのカメラフィールド（center / zoom / bearing /
 *   pitch）を除去したものが BASEMAP_STYLE として export されているか
 *   → そのままだと MapLibre がスタイルのカメラプロパティを適用し、地図が30°
 *     傾いた状態で起動するため除去が必要（除去漏れのガード）
 * - export された BASEMAP_STYLE が MapLibre のスタイル検証（validateStyleMin）
 *   にエラーなしで通過するか
 *   → glyphs URL に {fontstack} と {range} トークンを必須とする検証が、
 *     旧OpenMapTiles形式（{font}/{font}-{range}）のglyphsで地図が描画され
 *     なかった根本原因。ここで回帰テストする。
 * - スタイルの構成が期待どおりか（source / glyphs / attribution / POIレイヤ）
 * - 実サーバーがベクタタイル・グリフを返すか（ネットワーク統合テスト）
 */
import { describe, it, expect } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { BASEMAP_STYLE } from '../mapStyle'
// vendor した生ファイル（community_mapmaker 元と同様、トップレベルのカメラ
// フィールドを含む。mapStyle.js 側が除去している）。
import rawStyle from '../../styles/osmfj_poi.json'

// ベースマップのベクタタイル（source の TileJSON data/planet.json の tiles URL）
const VECTOR_TILE_URL = 'https://tile.openstreetmap.jp/data/planet/{z}/{x}/{y}.pbf'
const GLYPHS_URL = 'https://tile.openstreetmap.jp/fonts/{fontstack}/{range}.pbf'

// MapViewのクラスタ件数テキストが使うフォント（textFont: ['Noto Sans Regular']）
const CLUSTER_FONTSTACK = 'Noto Sans Regular'

describe('トップレベルのカメラフィールドの除去', () => {
  it('生ファイルにはカメラフィールドが含まれている（除去の必要原因の記録）', () => {
    // community_mapmaker 元ファイルには 3D視点プレビュー用のカメラ指定が
    // トップレベルに含まれる（pitch: 30 / bearing: 0 / center: 大阪 / zoom: 16）。
    expect(rawStyle.pitch).toBe(30)
    expect(rawStyle.bearing).toBe(0)
    expect(rawStyle.zoom).toBe(16)
    expect(Array.isArray(rawStyle.center)).toBe(true)
  })

  it('BASEMAP_STYLE にはトップレベルのカメラフィールドが含まれない', () => {
    for (const key of ['center', 'zoom', 'bearing', 'pitch']) {
      expect(key in BASEMAP_STYLE, `トップレベルに ${key} があってはならない`).toBe(false)
    }
  })

  it('BASEMAP_STYLE は生ファイルからカメラフィールドだけを除いたものと等しい', () => {
    const { center, zoom, bearing, pitch, ...cleaned } = rawStyle
    expect(BASEMAP_STYLE).toEqual(cleaned)
  })
})

describe('MapLibre スタイル検証（地図が描画されるための条件）', () => {
  it('BASEMAP_STYLE は validateStyleMin にエラーなしで通過する（version 8・完全なスタイル）', () => {
    expect(BASEMAP_STYLE.version).toBe(8)
    const errors = validateStyleMin(BASEMAP_STYLE)
    expect(errors.map((e) => e.message)).toEqual([])
  })

  it('sourceは openmaptiles のベクタのみで、OSMFJの planet.json TileJSON を参照する', () => {
    const sources = Object.entries(BASEMAP_STYLE.sources)
    expect(sources).toHaveLength(1)
    const [name, source] = sources[0]
    expect(name).toBe('openmaptiles')
    expect(source.type).toBe('vector')
    expect(source.url).toBe('https://tile.openstreetmap.jp/data/planet.json')
  })

  it('glyphsが {fontstack}/{range}.pbf 形式（クラスタテキストの表示条件）', () => {
    expect(BASEMAP_STYLE.glyphs).toBe(GLYPHS_URL)
  })

  it('帰属表示に OpenStreetMap 表記を含む', () => {
    expect(BASEMAP_STYLE.sources.openmaptiles.attribution).toContain('OpenStreetMap')
  })

  it('OSM POI（施設）のラベルレイヤを含む（本アプリに合わせたベースマップ）', () => {
    const layerIds = BASEMAP_STYLE.layers.map((l) => l.id)
    // 日本語ラベルのPOIレイヤ（z14〜z16）と交通系POIが存在する
    expect(layerIds).toContain('poi_z14-ja')
    expect(layerIds).toContain('poi_z15-ja')
    expect(layerIds).toContain('poi_z16-ja')
    expect(layerIds).toContain('poi_transit-ja')
    // building-3d（fill-extrusion）レイヤはそのまま残す（pitch 0 のため実質平面表示）
    expect(layerIds).toContain('building-3d')
    expect(BASEMAP_STYLE.layers.length).toBeGreaterThan(100)
  })

  it('旧OpenMapTiles形式（{font}/{font}-{range}）のglyphsは検証エラーになる（根因の再現）', () => {
    const broken = {
      version: 8,
      sources: { v: { type: 'vector', tiles: [VECTOR_TILE_URL] } },
      layers: [{ id: 'background', type: 'background', paint: {} }],
      glyphs: 'https://tiles.openmaptiles.org/fonts/{font}/{font}-{range}.pbf'
    }
    const errors = validateStyleMin(broken)
    expect(errors.some((e) => e.message.includes('{fontstack}'))).toBe(true)
  })
})

describe('実サーバーへの疎通（統合テスト）', () => {
  it('ベクタタイルが取得できる（z12 大阪周辺 → 200, protobuf, MVT先頭バイト 0x1a）', async () => {
    const url = VECTOR_TILE_URL
      .replace('{z}', '12')
      .replace('{x}', '1644')
      .replace('{y}', '2352')
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('protobuf')
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(50)
    // MVT（Mapbox Vector Tile）protobuf の先頭は layers フィールド
    // （field 3, wire type 2 → バイト 0x1a）
    expect(buf[0]).toBe(0x1a)
  }, 30000)

  it('グリフが取得できる（クラスタテキスト用フォント Noto Sans Regular / 0-255）', async () => {
    const url = GLYPHS_URL
      .replace('{fontstack}', CLUSTER_FONTSTACK)
      .replace('{range}', '0-255')
    const res = await fetch(url)
    expect(res.status).toBe(200)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(100)
  }, 30000)
})
