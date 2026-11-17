/**
 * まちメモ帳カード用の地図サムネイル生成。
 *
 * カードごとに地図ライブラリを描画すると重いため、OSMタイルから
 * 静止画を1回だけ合成して dataURL 化し、localStorage に保存する。
 * タイルはアプリの地図と同じ tile.openstreetmap.jp を使う
 * （Access-Control-Allow-Origin: * のため canvas が汚染されない）。
 * 生成サイズは 240×240（メモ帳カード右側の 120px 列に合わせた正方形）。
 * 帰属表示は画像に焼き込まず、表示側（MemochoSection）が重ねて出す
 * （切り取り表示でも常に見えるようにするため）。
 */

export const MAP_THUMB_ZOOM = 16
export const MAP_THUMB_WIDTH = 240
export const MAP_THUMB_HEIGHT = 240

const TILE_SIZE = 256
const TILE_URL = 'https://tile.openstreetmap.jp/{z}/{x}/{y}.png'

/**
 * 施設位置が中心になる窓（width×height）について、必要なタイルと
 * 描画オフセットを返す純粋関数。
 *
 * 戻り値: { tiles: [{x, y, dx, dy}], centerX, centerY }
 * - dx/dy はキャンバス座標（タイル左上の位置。負になることもある）
 * - centerX/centerY は施設位置のキャンバス座標（常に窓の中心）
 */
export function tilePlan(lat, lon, zoom = MAP_THUMB_ZOOM, width = MAP_THUMB_WIDTH, height = MAP_THUMB_HEIGHT) {
  const n = 2 ** zoom
  const latRad = (lat * Math.PI) / 180
  // world pixel 座標（タイル1枚=256px の平面）
  const worldX = ((lon + 180) / 360) * n * TILE_SIZE
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE_SIZE

  const left = worldX - width / 2
  const top = worldY - height / 2

  const minTileX = Math.floor(left / TILE_SIZE)
  const maxTileX = Math.floor((left + width - 1) / TILE_SIZE)
  const minTileY = Math.floor(top / TILE_SIZE)
  const maxTileY = Math.floor((top + height - 1) / TILE_SIZE)

  const tiles = []
  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue
      tiles.push({ x, y, dx: x * TILE_SIZE - left, dy: y * TILE_SIZE - top })
    }
  }
  return { tiles, centerX: width / 2, centerY: height / 2 }
}

function loadTileImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function drawPin(ctx, cx, cy) {
  // 涙型ピン: 先端が施設位置（cx, cy）に合うように描く
  ctx.beginPath()
  ctx.moveTo(cx - 6.5, cy - 8)
  ctx.lineTo(cx + 6.5, cy - 8)
  ctx.lineTo(cx, cy)
  ctx.closePath()
  ctx.fillStyle = '#e11d48'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy - 14, 9, 0, Math.PI * 2)
  ctx.fillStyle = '#e11d48'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy - 14, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

/**
 * 施設位置の地図サムネイルを生成し、JPEG の dataURL を返す。
 * 座標が不正・タイル読み込み失敗・canvas 書き出し失敗の場合は null
 * （例外は投げない）。
 */
export async function captureMapImage(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  try {
    const plan = tilePlan(lat, lon)
    if (plan.tiles.length === 0) return null
    const images = await Promise.all(
      plan.tiles.map((t) =>
        loadTileImage(TILE_URL.replace('{z}', MAP_THUMB_ZOOM).replace('{x}', t.x).replace('{y}', t.y)),
      ),
    )
    if (images.some((img) => img === null)) return null

    const canvas = document.createElement('canvas')
    canvas.width = MAP_THUMB_WIDTH
    canvas.height = MAP_THUMB_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#e8e4dc'
    ctx.fillRect(0, 0, MAP_THUMB_WIDTH, MAP_THUMB_HEIGHT)
    plan.tiles.forEach((t, i) => {
      ctx.drawImage(images[i], t.dx, t.dy)
    })
    drawPin(ctx, plan.centerX, plan.centerY)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}
