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
 * @returns {object}
 *   status: 'idle' | 'locating' | 'fetching' | 'ready' | 'denied' | 'error'
 *   candidates: キャッシュされた周辺候補（取得不能なら空配列）
 *   error: 周辺候補取得失敗の理由（status 'error' のとき）
 *   center: キャッシュに使った現在位置 { lat, lon }（無ければ null）。
 *     「地名検索」の viewbox 付けに使う
 *   request: () => Promise<void> — 入力欄フォーカス時に呼ぶ
 */
export function useNearbyPlaceCandidates() {
  const [status, setStatus] = useState('idle')
  const [candidates, setCandidates] = useState([])
  const [error, setError] = useState(null)
  // キャッシュ（再レンダリングで失われないように ref）。{ lat, lon, candidates }
  const cacheRef = useRef(null)
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

  const request = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)

    // ① 現在位置の取得
    const pos = await getPosition()
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

  const center = cacheRef.current
    ? { lat: cacheRef.current.lat, lon: cacheRef.current.lon }
    : null

  return { status, candidates, error, center, request }
}
