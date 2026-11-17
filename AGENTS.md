# まちデータ帳 (osm-data-explorer) 開発メモ

OSM施設検索アプリ。React + Vite + MapLibre GL。公開サイトは GitHub Pages（main への push で自動デプロイ）。

## コマンド
- テスト: `npm test`（全件実行）
- ビルド: `npm run build`

## 作業の決まりごと
- **git commit・push・デプロイ（公開）は、ユーザーの「公開して」という明示的な指示があるまで絶対にしない。** 作業が終わったら、未コミットの状態で完了報告をして止まり、公開の指示を待つこと。
- 指示は小分けで1件ずつ届く。1件が終わったら報告して止まり、次の作業を勝手に始めない。
- 指示された範囲以外のファイルを変更しない。
- テストが失敗したら、失敗したまま報告すること（仕様を変えて無理に通さない）。

## 現在の主な状態
- 地図は MapLibre GL に移行済み。ベースマップは community_mapmaker 由来のベクタタイル GL スタイル（osmfj_poi.json を src/styles/ にvendorし、mapStyle.js が読み込んで center/zoom/bearing/pitch を除去した BASEMAP_STYLE を共有スタイルとしてexport。OSMFJタイル・OpenMapTilesスキーマ・maxzoom 14・POIラベルz14〜表示・building-3dは残す）。グリフは {fontstack}/{range}.pbf 形式を使う。全地図コンポーネントは maxPitch: 0 / pitchWithRotate: false を指定し平面（top-down）表示を強制する（回転 dragRotate/touchZoomRotate は従来どおり有効）。
- ヘッダーは共通コンポーネント AppHeader.jsx（モバイル・PCの両シェルが使用）。アイコン＋タイトル（押下でトップへ、goTop は各シェル側）＋右端にハンバーガーメニュー HeaderMenu: 一覧を保存（CSV）・GeoJSON（高度な形式）・まちメモ帳をすべて削除（2段階確認）。旧ExportBar（一覧タブ・その他タブの保存ボタン）は削除済み。全消去は useMemocho の remove を全アイテムに適用する方式（MemochoSection の onDeleteAll と同じ・2段階確認・window.confirm 不使用）。CSV/GeoJSON 項目には保存件数表記（「N件を保存します」／フィルタ時「全M件中、N件を保存します」・無効時「0件を保存します」）を付す。メニューはヘッダーにあるため全タブで利用可能。
- テストは 1356 件・84ファイル（2026-11-24 時点）。ヘッダーメニューの開閉・項目の有効/無効・全消去の2段階確認・全タブでの利用（mobileLayout/pcLayout）・全消去後のメモ帳0件表示（headerWipeMemochoSync）を検証。
- 新機能「CSVアップロード→osmid近似照合→ダウンロード」は実装済み（取込・行揃え照合・元のCSVへのlat/lon/osmid書き込み・フォールバック）。未コミット。
