import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// maplibre-gl v6 は ESM のみで、レンダリング・タイル処理用のワーカーが
// 別ファイル（maplibre-gl-worker.mjs）になった。
//
// 本番ビルド: Vite がワーカーを独立チャンクにバンドルする（?worker&url）。
//   dist/assets/maplibre-gl-worker-*.js として出力され、setWorkerUrl に指定する。
//
// デベロッパーサーバー: ?worker&url の変換はワーカーファイル先頭に
//   `import ... from "/@vite/client"`（HMR クライアント）を注入する。
//   dev ではワーカーが classic として生成される（Worker 生成をトレースして確認。
//   pre-bundle キャッシュの新旧とは無関係）ため、この import 文が
//   `Cannot use import statement outside a module` で失敗し地図が白くなる。
//   そのため dev だけ public/ に置いた生のワーカーファイル（import/export 無しで
//   classic・module どちらでも読める）をそのまま使う。Vite は public/ を
//   変換せずに配信するため HMR 注入を避けられる。
if (import.meta.env.DEV) {
  setWorkerUrl(import.meta.env.BASE_URL + 'maplibre-gl-worker.mjs')
} else {
  setWorkerUrl(workerUrl)
}

export {}
