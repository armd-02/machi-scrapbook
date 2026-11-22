import { describe, it, expect, vi, beforeEach } from 'vitest'
import { queueThumb, getCachedThumb, resetThumbState } from '../resultThumbs'
import * as mapCapture from '../mapCapture'

// captureMapImage だけモック（タイル取得をネットワークに頼らない）
vi.mock('../mapCapture', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, captureMapImage: vi.fn() }
})

// 解決タイミングを外部から制御する Promise
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  resetThumbState()
  vi.clearAllMocks()
})

describe('queueThumb（逐次キュー＋メモリキャッシュ）', () => {
  it('サムネイルを生成して dataURL を返す', async () => {
    mapCapture.captureMapImage.mockResolvedValue('data:image/jpeg;base64,AAA')
    const p = queueThumb('node/1', 34.8, 135.5)
    await vi.waitFor(() => expect(mapCapture.captureMapImage).toHaveBeenCalledWith(34.8, 135.5))
    await expect(p).resolves.toBe('data:image/jpeg;base64,AAA')
  })

  it('同一キーは再生成しない（メモリキャッシュ命中で即返す）', async () => {
    mapCapture.captureMapImage.mockResolvedValue('data:image/jpeg;base64,AAA')
    const p1 = queueThumb('node/1', 34.8, 135.5)
    await p1
    const p2 = queueThumb('node/1', 34.8, 135.5)
    await expect(p2).resolves.toBe('data:image/jpeg;base64,AAA')
    // 生成は1回のみ
    expect(mapCapture.captureMapImage).toHaveBeenCalledTimes(1)
  })

  it('生成中のキーの二回目の呼び出しは同じ Promise を共有する（重複生成しない）', async () => {
    const d = deferred()
    mapCapture.captureMapImage.mockReturnValue(d.promise)
    const p1 = queueThumb('node/1', 34.8, 135.5)
    const p2 = queueThumb('node/1', 34.8, 135.5)
    d.resolve('data:image/jpeg;base64,AAA')
    await expect(p1).resolves.toBe('data:image/jpeg;base64,AAA')
    await expect(p2).resolves.toBe('data:image/jpeg;base64,AAA')
    expect(mapCapture.captureMapImage).toHaveBeenCalledTimes(1)
  })

  it('逐次キュー: 2件目の生成は1件目が完了してから始める（同時送出しない）', async () => {
    const d1 = deferred()
    let secondStarted = false
    mapCapture.captureMapImage.mockImplementation((lat) => {
      if (lat === 34.8) return d1.promise // 1件目（node/1）
      secondStarted = true
      return Promise.resolve('data:image/jpeg;base64,BBB') // 2件目（node/2）
    })
    const pA = queueThumb('node/1', 34.8, 135.5)
    const pB = queueThumb('node/2', 34.9, 135.6)
    // マイクロタスクを flush して1件目を開始させる
    await Promise.resolve()
    await Promise.resolve()
    // 1件目が未完なので2件目はまだ始まっていない
    expect(secondStarted).toBe(false)
    // 1件目を完了させる
    d1.resolve('data:image/jpeg;base64,AAA')
    await pA
    await Promise.resolve()
    await Promise.resolve()
    // 1件目完了後に2件目が始まる
    expect(secondStarted).toBe(true)
    await expect(pA).resolves.toBe('data:image/jpeg;base64,AAA')
    await expect(pB).resolves.toBe('data:image/jpeg;base64,BBB')
  })

  it('生成失敗（null）はキャッシュされ、セッション内でリトライしない', async () => {
    mapCapture.captureMapImage.mockResolvedValue(null)
    const p1 = queueThumb('node/1', 34.8, 135.5)
    await expect(p1).resolves.toBeNull()
    const p2 = queueThumb('node/1', 34.8, 135.5)
    await expect(p2).resolves.toBeNull()
    // 失敗してもリトライしない（生成は1回のみ）
    expect(mapCapture.captureMapImage).toHaveBeenCalledTimes(1)
  })
})

describe('getCachedThumb', () => {
  it('未生成のキーは undefined を返す', () => {
    expect(getCachedThumb('node/99')).toBeUndefined()
  })

  it('生成完了後は dataURL を返す', async () => {
    mapCapture.captureMapImage.mockResolvedValue('data:image/jpeg;base64,AAA')
    await queueThumb('node/1', 34.8, 135.5)
    expect(getCachedThumb('node/1')).toBe('data:image/jpeg;base64,AAA')
  })

  it('失敗は null を返す（undefined=未生成 と区別できる）', async () => {
    mapCapture.captureMapImage.mockResolvedValue(null)
    await queueThumb('node/1', 34.8, 135.5)
    expect(getCachedThumb('node/1')).toBeNull()
  })
})

describe('resetThumbState（テスト用）', () => {
  it('キャッシュをクリアする（以降は再生成される）', async () => {
    mapCapture.captureMapImage.mockResolvedValue('data:image/jpeg;base64,AAA')
    await queueThumb('node/1', 34.8, 135.5)
    expect(mapCapture.captureMapImage).toHaveBeenCalledTimes(1)
    resetThumbState()
    await queueThumb('node/1', 34.8, 135.5)
    expect(mapCapture.captureMapImage).toHaveBeenCalledTimes(2)
  })
})
