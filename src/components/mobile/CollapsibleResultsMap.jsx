import React, { useEffect, useState } from 'react'
import MobileResultsMap from './MobileResultsMap'
import { buildOsmViewportUrl } from '../../utils/editLinks'

function getViewport(map) {
  const center = map.getCenter()
  const { lat, lng } = center.wrap?.() ?? center
  return { lat, lon: lng, zoom: map.getZoom() }
}

/**
 * (抽出) 折りたたみ式の結果マップ（検索結果画面・まちメモ帳一覧画面で共用）
 *
 * MobileListTab のローカルコンポーネントとして実装していたものを、
 * まちメモ帳の一覧画面でも同じ地図（MobileResultsMap）を使えるように
 * 共有コンポーネントとして抽出した。
 *
 * 初期状態は initiallyOpen で決める（既定は折りたたみ・地図非表示。
 * バリアフリー側は initiallyOpen を true にして初期「開く」）。
 * 見出しボタン「地図を表示／地図を隠す」で開閉する。折りたたんでいる間は
 * MobileResultsMap をマウントしない（地図を生成しない）。展開すると地図が
 * 新規マウントされ、ピン範囲にfitBoundsされる（地図の高さ設定は
 * MobileResultsMap 内で従来どおり維持される）。
 *
 * - 地図上のピンや線を選ぶと onMarkerClick(result) を呼び出し、対応するカードへ移動する。
 *
 * - title: 見出しテキスト（検索結果画面は「検索結果マップ」、メモ帳一覧は
 *   「メモマップ」）。既定は「検索結果マップ」。
 * - results / bbox: 検索結果の絞り込み後のデータやメモ帳のデータを渡せる。
 *
 * 折りたたみ状態はこのコンポーネントのローカルstateに置く。親のフック構成
 * （早期returnとuseMemoの順序）を変えずに済むため、切替によるフック数の
 * 変化で React がエラーを出すのを避ける。
 */
export default function CollapsibleResultsMap({
  kind = 'poi',
  initiallyOpen = false,
  onMarkerClick = null,
  selection = null,
  title = '検索結果マップ',
  results = null,
  fitPoiDensity,
  bbox = null,
  heightStorageKey = null,
  showOsmLink = false,
}) {
  const [visible, setVisible] = useState(initiallyOpen)
  const [map, setMap] = useState(null)
  const [viewport, setViewport] = useState(null)
  useEffect(() => {
    if (selection?.geometry || (Number.isFinite(selection?.lon) && Number.isFinite(selection?.lat))) {
      setVisible(true)
    }
  }, [selection])
  useEffect(() => {
    if (!map) return
    const updateViewport = () => setViewport(getViewport(map))
    updateViewport()
    map.on('moveend', updateViewport)
    return () => map.off('moveend', updateViewport)
  }, [map])
  const osmLink = visible && map && viewport ? buildOsmViewportUrl(viewport, selection?.key) : null
  const updateOsmLink = (event) => {
    event.currentTarget.href = buildOsmViewportUrl(getViewport(map), selection?.key)
  }

  return (
    <div className="results-map-panel bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-expanded={visible}
          className="flex-1 min-h-[44px] px-3 py-2 flex items-center justify-between gap-2 text-sm font-medium text-slate-700"
        >
          <span>🗺️ {title}</span>
          <span className="shrink-0 text-xs text-slate-500">{visible ? '地図を隠す' : '地図を表示'}</span>
        </button>
        {showOsmLink && (osmLink ? (
          <a
            href={osmLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="OpenStreetMapで開く"
            title="OpenStreetMapで開く"
            onClick={updateOsmLink}
            onAuxClick={updateOsmLink}
            className="grid h-11 w-11 shrink-0 place-items-center text-lg text-primary-700 hover:bg-slate-100"
          >
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span
            role="link"
            aria-disabled="true"
            aria-label="OpenStreetMapで開く"
            title="地図を表示するとOpenStreetMapで開けます"
            className="grid h-11 w-11 shrink-0 place-items-center text-lg text-slate-400"
          >
            <span aria-hidden="true">↗</span>
          </span>
        ))}
      </div>
      {visible && (
        <MobileResultsMap
          kind={kind}
          onMapReady={showOsmLink ? setMap : null}
          onMarkerClick={onMarkerClick}
          selection={selection}
          results={results}
          fitPoiDensity={fitPoiDensity}
          bbox={bbox}
          heightStorageKey={heightStorageKey}
        />
      )}
    </div>
  )
}
