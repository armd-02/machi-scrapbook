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
 * 現在位置の取得はアプリ側タイマーで必ず確定する（ブラウザのコールバックが
 * 呼ばれないハングの場合でも GEO_TIMEOUT_MS 後に null で確定するため、
 * 'locating' に永久に詰まることはない）。失敗・タイムアウト後も、明示的な
 * ユーザー操作（フォーカス・「地名検索」押下）のタイミングで再取得を再試行
 * する（進行中リクエストの共有・重複防止は維持）。取得のたびに許可プロンプト
 * を連発しないように、進行中リクエストの共有（pendingRef）で重複を抑える。
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
 *     未開始ならその場で取得を開始して待つ。過去の失敗だけで恒久的に諦めず、
 *     この押下という明示的なユーザー操作のタイミングで再試行する。ユーザーを
 *     長時間ブロックしない — アプリ側タイマーで必ず GEO_TIMEOUT_MS 内に確定）
 */
export function useNearbyPlaceCandidates() {
  const [status, setStatus] = useState('idle')
  const [candidates, setCandidates] = useState([])
  const [error, setError] = useState(null)
  // 現在位置（{ lat, lon }）。値が変化した場合のみ更新してオブジェクトの
  // アイデンティティを安定させる（レンダリングごとに新しいオブジェクトを
  // 生成すると、center を依存配列にするエフェクトが無限ループする）
  const [center, setCenter] = useState(null)
  // キャッシュ（再レンダリングで失われないように ref）。{ lat, lon, candidates }
  const cacheRef = useRef(null)
  // 最後に取得した現在位置（Overpass 取得の成否・完了と切り離して保持）。
  // { lat, lon }
  const positionRef = useRef(null)
  // 位置取得進行中の Promise（request と awaitPosition が共有する）
  const pendingRef = useRef(null)
  // 取得中のフラグ（フォーカスが連続して起きても重複リクエストを防ぐ）
  const busyRef = useRef(false)

  const getPosition = () =>
    new Promise((resolve) => {
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null
      if (!geo || typeof geo.getCurrentPosition !== 'function') {
        resolve(null)
        return
      }
      // アプリ側タイマーの保証: ブラウザが成功・エラーのどちらのコールバックも
      // 呼ばない場合（例: 許可プロンプトが未回答の間でブラウザ自身の timeout
      // が進まない）でも、GEO_TIMEOUT_MS 後に必ず null で確定する。
      // これにより 'locating' に永久に詰まること・busy フラグが解放されない
      // ことを防ぐ
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          resolve(null)
        }
      }, GEO_TIMEOUT_MS)
      const settle = (value) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
      }
      geo.getCurrentPosition(
        (pos) => settle({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => settle(null),
        {
          enableHighAccuracy: false,
          timeout: GEO_TIMEOUT_MS,
          maximumAge: POSITION_MAX_AGE_MS
        }
      )
    })

  // 現在位置の取得を開始する（進行中の取得があればその Promise を共有する）。
  // 成功なら positionRef に保存する。失敗・タイムアウトでも Promise は確定し、
  // 次回の明示的なユーザー操作（フォーカス・検索押下）で再取得できる
  const startPosition = () => {
    if (pendingRef.current) return pendingRef.current
    const p = (async () => {
      const pos = await getPosition()
      pendingRef.current = null
      if (pos) {
        positionRef.current = pos
      }
      return pos
    })()
    pendingRef.current = p
    return p
  }

  /**
   * 現在位置の取得が確定するまで待つ（「地名検索」の viewbox 付け用）。
   * - 既に取れていれば即返す
   * - 取得が進行中ならその成否を待つ（重複取得しない）
   * - 未取得・過去の失敗ならその場で取得を開始して確定を待つ
   *   （過去の失敗だけで恒久的に諦めない。この呼び出しは「地名検索」押下という
   *    明示的なユーザー操作なので再試行してよい。進行中の共有でプロンプト連発は
   *    防ぎ、アプリ側タイマーで必ず GEO_TIMEOUT_MS 内に確定する）
   * @returns {Promise<{ lat: number, lon: number }|null>}
   */
  const awaitPosition = useCallback(() => {
    if (positionRef.current) return Promise.resolve(positionRef.current)
    if (pendingRef.current) return pendingRef.current
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
  // （「位置が取れているのに center が null」にならないようにする）。
  // 値が同じなら状態を更新しない（レンダリングフェーズの状態調整・
  // ガード付きで無限ループを防ぐ）
  const centerPos = cacheRef.current || positionRef.current
  const centerKey = centerPos ? `${centerPos.lat},${centerPos.lon}` : ''
  const currentKey = center ? `${center.lat},${center.lon}` : ''
  if (currentKey !== centerKey) {
    setCenter(centerPos ? { lat: centerPos.lat, lon: centerPos.lon } : null)
  }

  return { status, candidates, error, center, request, awaitPosition }
}
