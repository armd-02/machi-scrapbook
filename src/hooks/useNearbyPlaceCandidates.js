import { useCallback, useRef, useState } from 'react'
import { fetchNearbyCandidates, haversineKm } from '../utils/nearbyCandidates'

// キャッシュの取り直ししきい値（km）。仕様: 位置が1km以上動いたら取り直す
const REFETCH_DISTANCE_KM = 1
// 現在位置の取得タイムアウト（ms）
const GEO_TIMEOUT_MS = 10000
// 現在位置の再利用可能期間（ms）。Geolocation の maximumAge
const POSITION_MAX_AGE_MS = 5 * 60 * 1000

/**
 * 周辺地名候補（駅・地区名・大きな公園）の取得・キャッシュを管理するフック。
 *
 * 地名入力欄にフォーカスしたとき（request を呼んだとき）に:
 *  1. Geolocation API で現在位置を取得する
 *  2. キャッシュのある位置から1km以内なら Overpass を再問い合わせずキャッシュを
 *     使う（「1回だけ送って結果をキャッシュ」・「位置が1km以上動いたら取り直す」）
 *  3. そうでなければ5km圏内の周辺候補を Overpass（既定エンドポイント＋
 *     フォールバック）へ1回問い合わせ、結果をキャッシュする
 *
 * 位置情報が取れない・拒否された場合は周辺候補なし（自治体候補のみ）で
 * 動作する（status: 'denied'）。Overpass の取得失敗時は前のキャッシュが
 * あるならそれを維持する（劣化して動作し続ける）。
 *
 * 現在位置の取得は Overpass 周辺取得の成否・完了とは切り離して保持される
 * （positionRef）。位置が取れていても周辺取得が未完了・失敗の場合に
 * 「位置が取れているのに center が null」になるのを防ぐ（viewbox 付け）。
 *
 * @returns {object}
 *   status: 'idle' | 'locating' | 'fetching' | 'ready' | 'denied' | 'error'
 *   candidates: キャッシュされた周辺候補（取得不能なら空配列）
 *   error: 周辺候補取得失敗の理由（status 'error' のとき）
 *   center: 現在位置 { lat, lon }（無ければ null）。「地名検索」の viewbox
 *     付けに使う。キャッシュ位置があればそれを、なければ最後に取得した
 *     位置を使う
 *   request: () => Promise<void> — 入力欄フォーカス時に呼ぶ
 *   awaitPosition: () => Promise<{ lat, lon }|null> — 「地名検索」押下時に
 *     位置取得の確定を待つ（既に取れていれば即返す。進行中なら確定を待ち、
 *     未開始ならその場で取得を開始して待つ。失敗確定なら即 null。ユーザーを
 *     ブロックしない）
 */
export function useNearbyPlaceCandidates() {
  const [status, setStatus] = useState('idle')
  const [candidates, setCandidates] = useState([])
  const [error, setError] = useState(null)
  // キャッシュ（再レンダリングで失われないように ref）。{ lat, lon, candidates }
  const cacheRef = useRef(null)
  // 最後に取得した現在位置（Overpass 取得の成否・完了と切り離して保持）。
  // { lat, lon }
  const positionRef = useRef(null)
  // 位置取得進行中の Promise（request と awaitPosition が共有する）
  const pendingRef = useRef(null)
  // 位置取得が失敗した（拒否・非対応・タイムアウト）かのフラグ。
  // 失敗確定後は awaitPosition が新しい取得を開始せず即 null を返す
  // （ユーザーをブロックしない）
  const failedRef = useRef(false)
  // 取得中のフラグ（フォーカスが連続して起きても重複リクエストを防ぐ）
  const busyRef = useRef(false)

  const getPosition = () =>
    new Promise((resolve) => {
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null
      if (!geo || typeof geo.getCurrentPosition !== 'function') {
        resolve(null)
        return
      }
      geo.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        {
          enableHighAccuracy: false,
          timeout: GEO_TIMEOUT_MS,
          maximumAge: POSITION_MAX_AGE_MS
        }
      )
    })

  // 現在位置の取得を開始する（進行中の取得があればその Promise を共有する）。
  // 成功なら positionRef に保存、失敗なら failedRef を立てる
  const startPosition = () => {
    if (pendingRef.current) return pendingRef.current
    const p = (async () => {
      const pos = await getPosition()
      pendingRef.current = null
      if (pos) {
        positionRef.current = pos
        failedRef.current = false
      } else {
        failedRef.current = true
      }
      return pos
    })()
    pendingRef.current = p
    return p
  }

  /**
   * 現在位置の取得が確定するまで待つ（「地名検索」の viewbox 付け用）。
   * - 既に取れていれば即返す
   * - 取得が進行中ならその成否を待つ
   * - 過去の取得が失敗済みなら即 null（新しい取得は開始しない）
   * - 未取得ならその場で取得を開始して確定を待つ
   * @returns {Promise<{ lat: number, lon: number }|null>}
   */
  const awaitPosition = useCallback(() => {
    if (positionRef.current) return Promise.resolve(positionRef.current)
    if (pendingRef.current) return pendingRef.current
    if (failedRef.current) return Promise.resolve(null)
    return startPosition()
  }, [])

  const request = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)

    // ① 現在位置の取得（awaitPosition と同じ Promise を共有する）
    setStatus('locating')
    const pos = await startPosition()
    if (!pos) {
      // 位置が得られない（拒否・非対応・タイムアウト）: 周辺候補なしで動作。
      // 以前のキャッシュがある場合はそれを維持する（劣化して動作し続ける）
      if (cacheRef.current) {
        setStatus('ready')
      } else {
        setCandidates([])
        setStatus('denied')
      }
      busyRef.current = false
      return
    }

    // ② キャッシュが有効（位置が1km以内）なら再取得しない
    const cache = cacheRef.current
    if (cache && haversineKm(pos.lat, pos.lon, cache.lat, cache.lon) <= REFETCH_DISTANCE_KM) {
      setStatus('ready')
      busyRef.current = false
      return
    }

    // ③ 周辺候補を Overpass へ1回問い合わせる
    setStatus('fetching')
    const { candidates: fetched, error: fetchError } = await fetchNearbyCandidates(
      pos.lat,
      pos.lon
    )
    if (fetchError) {
      if (cacheRef.current) {
        // 失敗しても前のキャッシュがあれば維持する（劣化して動作し続ける）
        setStatus('ready')
      } else {
        setStatus('error')
        setError(fetchError)
      }
      busyRef.current = false
      return
    }
    cacheRef.current = { lat: pos.lat, lon: pos.lon, candidates: fetched }
    setCandidates(fetched)
    setStatus('ready')
    setError(null)
    busyRef.current = false
  }, [])

  // center: キャッシュ位置があればそれを、なければ最後に取得した位置を使う
  // （「位置が取れているのに center が null」にならないようにする）
  const centerPos = cacheRef.current || positionRef.current
  const center = centerPos
    ? { lat: centerPos.lat, lon: centerPos.lon }
    : null

  return { status, candidates, error, center, request, awaitPosition }
}
