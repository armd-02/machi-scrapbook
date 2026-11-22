import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
// (#maplibre v6) ESM のみ・ワーカー別ファイルのため、Map 生成前に
// setWorkerUrl を一度だけ呼ぶ。どの地図コンポーネントより先に実行させる。
import './utils/maplibreSetup'
import { installPullToRefreshGuard } from './utils/pullToRefreshGuard'
import { installPageZoomGuard } from './utils/pageZoomGuard'

// (#61) モバイルブラウザのプル・トゥ・リフレッシュ防止:
// 画面を下に引っ張り過ぎるとページがリロードされ、検索結果や入力内容が
// 消える。CSS（overscroll-behavior-y: none）＋ JS ガードの2層で止める。
installPullToRefreshGuard()

// モバイルブラウザのページ全体ズーム（ピンチイン・ピンチアウト）防止:
// 地図以外のエリアでピンチするとページ全体が拡大・縮小される。
// CSS（html/body の touch-action: pan-x pan-y）＋ JS ガードの2層で止める。
// 地図のピンチズームは MapLibre が canvas 側で処理するため影響しない。
installPageZoomGuard()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
