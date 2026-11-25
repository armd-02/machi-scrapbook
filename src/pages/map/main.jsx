import React from 'react'
import ReactDOM from 'react-dom/client'
import PublicMapPage from './PublicMapPage'
import '../../styles/index.css'
// (#maplibre v6) ESM のみ・ワーカー別ファイルのため、Map 生成前に
// setWorkerUrl を一度だけ呼ぶ。どの地図コンポーネントより先に実行させる。
import '../../utils/maplibreSetup'
import { installPullToRefreshGuard } from '../../utils/pullToRefreshGuard'
import { installPageZoomGuard } from '../../utils/pageZoomGuard'

// モバイルブラウザのプル・トゥ・リフレッシュ防止（メインアプリと同じ）
installPullToRefreshGuard()

// モバイルブラウザのページ全体ズーム防止（メインアプリと同じ）
installPageZoomGuard()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PublicMapPage />
  </React.StrictMode>
)
