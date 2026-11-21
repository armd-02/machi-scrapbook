/**
 * 日本の駅・路面電車・ケーブルカーのデータを取得して public/data/stations.json
 * を生成する。
 *
 * 用途: 地名入力サジェストの駅候補（全国）をファイル化する。
 * 全国の駅は数が限られ変化も緩やかなため、Overpass に定期的に全国一括で
 * 問い合わせる代わりに、手動でたまにこのスクリプトを再実行してファイルを更新する。
 *
 * 実行方法（リポジトリのルートから・Node 18 以上を想定）:
 *   node scripts/fetch-stations.mjs
 *
 * 仕様:
 * - 取得対象: 名前のある要素（nwr）のうち
 *   - railway=station（種別 0=駅。モノレール・ニュートラムの駅も
 *     railway=station にタグ付けされているためここに含む）
 *   - railway=tram_stop / rail_tram_stop（種別 1=路面電車）
 *   - aerialway=station（種別 2=ケーブルカー・ロープウェイの駅）
 * - 取得範囲: 日本全域（緯度 24.0〜45.6、経度 122.5〜146.1）
 * - 取得先: アプリ既定のエンドポイント（src/config.js の custom = armd-01）。
 *   armd-01 には bbox 面積の上限があり全国一括はエラーになるため、
 *   3°×3° のタイルに分割して取得し結果を結合する。
 *   armd-01 のデータには抜けている範囲（遠洋など）があり、そうした範囲
 *   を含む bbox は HTTP 500 になるため、失敗したタイルは四等分して再取得し、
 *   最小 0.75° まで分割してなお失敗すれば警告を出してスキップする
 *   （データのない海域に駅は存在しない。実測では駅を含む 0.75° タイルは
 *   正常に 200 を返す）
 * - クエリ: armd-01 のパーサは「エリアフィルタ付き for 式を含む union」を
 *   構文エラーで拒否し、複合条件 {A or B} は 0 件を返す（古い Overpass
 *   バージョンの制限）ため、1 タイルにつき2本の単一 for 式クエリを送る:
 *     nwr["railway"~"station|tram_stop"]["name"](bbox)
 *     nwr["aerialway"="station"]["name"](bbox)
 *   前者のアンカーなし正規表現は train_station_entrance も拾うため、
 *   駅・停留所として採用するのは railway ∈ {station, tram_stop,
 *   rail_tram_stop} の要素のみ（その他は除外する）。
 *   out center;（node は自身の座標、way/relation は中心座標）
 * - 重複除去: 要素ID単位の重複を除いたうえで、同種別・同名で約110m以内
 *   （0.11km）の要素を同一駅としてまとめる（周辺候補 prepareNearbyCandidates
 *   と同じ考え方。タイル境界をまたぐ重複もここで吸収）
 * - 出力: public/data/stations.json。容量を抑えるため各要素を
 *   [名前, 緯度, 経度, 種別] の配列形式で書く（種別 0=駅・1=路面電車・
 *   2=ケーブルカー。緯度・経度は小数5桁に丸める）。
 *   生成日時はこのスクリプトのstdoutに残す
 *
 * ビルドには組み込まない（手動運用の生成スクリプト）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVERPASS_ENDPOINTS } from '../src/config.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT_FILE = path.join(ROOT, 'public', 'data', 'stations.json')
const ENDPOINT_URL = OVERPASS_ENDPOINTS.custom.url

// 日本全域の取得範囲
const LAT_MIN = 24.0
const LAT_MAX = 45.6
const LON_MIN = 122.5
const LON_MAX = 146.1
const TILE_DEG = 3 // armd-01 の bbox 面積上限を避けるためのタイルサイズ

// 重複判定の距離しきい値（km）。周辺候補（nearbyCandidates.js）と同一
const DUP_THRESHOLD_KM = 0.11

const EARTH_RADIUS_KM = 6371
const toRad = (d) => (d * Math.PI) / 180
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

const round5 = (n) => Math.round(n * 1e5) / 1e5

/** 3°タイルの bbox 一覧を生成する */
function buildTiles() {
  const tiles = []
  for (let s = LAT_MIN; s < LAT_MAX; s += TILE_DEG) {
    for (let w = LON_MIN; w < LON_MAX; w += TILE_DEG) {
      tiles.push({
        south: s,
        west: w,
        north: Math.min(s + TILE_DEG, LAT_MAX),
        east: Math.min(w + TILE_DEG, LON_MAX)
      })
    }
  }
  return tiles
}

function bboxOf(tile) {
  return `${tile.south.toFixed(4)},${tile.west.toFixed(4)},${tile.north.toFixed(4)},${tile.east.toFixed(4)}`
}

// armd-01 に対応する単一 for 式クエリ2本（union・複合条件は使えない）
const RAILWAY_QUERY = (bbox) =>
  `[out:json][timeout:25];nwr["railway"~"station|tram_stop"]["name"](${bbox});out center;`
const AERIALWAY_QUERY = (bbox) =>
  `[out:json][timeout:25];nwr["aerialway"="station"]["name"](${bbox});out center;`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 再帰分割の下限サイズ（度）。これ以下で失敗したタイルはスキップする
const MIN_TILE_DEG = 0.75
// 取得に失敗してスキップしたタイル（完了報告に含める）
const failedTiles = []

/** 1本のクエリを送る（失敗時は1回リトライ）。成功: 要素配列、失敗: null */
async function fetchQuery(tile, buildQuery) {
  const body = `data=${encodeURIComponent(buildQuery(bboxOf(tile)))}`
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(120000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data.elements || []
    } catch {
      if (attempt < 2) {
        await sleep(1000)
        continue
      }
      return null
    }
  }
  return null
}

/**
 * 1タイルの要素を取得する（失敗時は四等分して再帰的に再取得）。
 * 2本のクエリのいずれかが失敗したらタイル全体を四等分し、0.75° まで
 * 分割してなお失敗すれば警告を出してスキップする。
 * @returns {Promise<Array>} 要素配列（スキップした分は欠落する）
 */
async function processTile(tile) {
  const bbox = bboxOf(tile)
  const [rails, cables] = await Promise.all([
    fetchQuery(tile, RAILWAY_QUERY),
    fetchQuery(tile, AERIALWAY_QUERY)
  ])
  if (rails !== null && cables !== null) {
    return [...rails, ...cables]
  }
  const h = tile.north - tile.south
  const w = tile.east - tile.west
  if (h > MIN_TILE_DEG || w > MIN_TILE_DEG) {
    // 四等分して再取得（データのない範囲を含む bbox は 500 になる）
    const midLat = (tile.south + tile.north) / 2
    const midLon = (tile.west + tile.east) / 2
    const parts = [
      { south: tile.south, west: tile.west, north: midLat, east: midLon },
      { south: tile.south, west: midLon, north: midLat, east: tile.east },
      { south: midLat, west: tile.west, north: tile.north, east: midLon },
      { south: midLat, west: midLon, north: tile.north, east: tile.east }
    ]
    const elements = []
    for (const p of parts) elements.push(...(await processTile(p)))
    return elements
  }
  failedTiles.push(bbox)
  console.log(`\n警告: タイル (${tile.south},${tile.west})-(${tile.north},${tile.east}) を取得できずスキップします`)
  // 片方のクエリが成功していた場合はその分だけでも残す
  return rails !== null ? rails : cables !== null ? cables : []
}

async function main() {
  const tiles = buildTiles()
  console.log(`取得範囲: 緯度 ${LAT_MIN}〜${LAT_MAX}, 経度 ${LON_MIN}〜${LON_MAX}`)
  console.log(`エンドポイント: ${ENDPOINT_URL}`)
  console.log(`タイル数: ${tiles.length}（${TILE_DEG}°×${TILE_DEG}°）`)

  const seenIds = new Set()
  // 同種別・同名の要素をバケットにまとめ、バケット内で距離照合する
  // （全ペア照合の O(n²) を避ける）
  const buckets = new Map()
  const kept = [] // { name, lat, lon, kind }

  let totalElements = 0
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    process.stdout.write(`\rタイル ${i + 1}/${tiles.length} 取得中… `)
    const elements = await processTile(tile)
    totalElements += elements.length
    for (const el of elements) {
      const tags = el.tags || {}
      const name = (tags.name || '').trim()
      if (!name) continue
      // railway の正規表現は train_station_entrance なども拾うため、
      // 採用するタグ値はホワイトリストで絞る
      let kind
      if (tags.aerialway === 'station') kind = 2
      else if (tags.railway === 'tram_stop' || tags.railway === 'rail_tram_stop') kind = 1
      else if (tags.railway === 'station') kind = 0
      else continue
      if (seenIds.has(`${el.type}/${el.id}`)) continue
      seenIds.add(`${el.type}/${el.id}`)
      // out center: node は lat/lon、way/relation は center
      const lat = el.type === 'node' ? el.lat : el.center && el.center.lat
      const lon = el.type === 'node' ? el.lon : el.center && el.center.lon
      if (typeof lat !== 'number' || typeof lon !== 'number') continue
      // 同種別・同名・約110m以内 は同一駅としてまとめる（タイルまたぎ含む）
      const key = `${kind}\u0000${name}`
      const bucket = buckets.get(key)
      if (bucket && bucket.some((p) => haversineKm(p.lat, p.lon, lat, lon) <= DUP_THRESHOLD_KM)) {
        continue
      }
      if (bucket) bucket.push({ lat, lon })
      else buckets.set(key, [{ lat, lon }])
      kept.push({ name, lat, lon, kind })
    }
    // サーバーへの連続リクエストを避けたい場合はここで待たせる
    await sleep(500)
  }
  console.log('\n取得完了')

  // 出力: [名前, 緯度, 経度, 種別] の配列（緯度・経度は小数5桁に丸める）
  const rows = kept.map((k) => [k.name, round5(k.lat), round5(k.lon), k.kind])
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(rows) + '\n', 'utf8')

  const stations = kept.filter((k) => k.kind === 0).length
  const trams = kept.filter((k) => k.kind === 1).length
  const cableCars = kept.filter((k) => k.kind === 2).length
  console.log(`要素ID単位の重複除去・同駅まとめ後: ${kept.length} 件（駅 ${stations} / 路面電車 ${trams} / ケーブルカー ${cableCars}）`)
  console.log(`生要素数: ${totalElements}`)
  console.log(`出力: ${path.relative(ROOT, OUT_FILE)}（${fs.statSync(OUT_FILE).size.toLocaleString()} bytes）`)
  console.log(`生成日時: ${new Date().toISOString()}`)
  if (failedTiles.length) {
    console.log(`取得失敗でスキップしたタイル: ${failedTiles.length} 件`)
    for (const f of failedTiles) console.log(`  - ${f}`)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
