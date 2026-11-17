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
- ヘッダーは共通コンポーネント AppHeader.jsx（モバイル・PCの両シェルが使用）。アイコン＋タイトル（押下でトップへ、goTop は各シェル側）＋右端にハンバーガーメニュー HeaderMenu: 一覧を保存（CSV）・GeoJSON（高度な形式）・まちメモ帳をJSONで書き出し・まちメモ帳をCSVで書き出し（末尾に memo/rating 列）・まちメモ帳を読み込み・まちメモ帳をすべて削除（2段階確認）。旧ExportBar（一覧タブ・その他タブの保存ボタン）と、MemochoSection 内のセクション☰メニュー（書き出し・読み込み・全消去）は削除済み（#79 でヘッダーの1つのメニューに統一）。全消去は useMemocho の remove を全アイテムに適用する方式（MemochoSection の onDeleteAll と同じ・2段階確認・window.confirm 不使用）。CSV/GeoJSON 項目には保存件数表記（「N件を保存します」／フィルタ時「全M件中、N件を保存します」・無効時「0件を保存します」）を付す。メニューはヘッダーにあるため全タブで利用可能。メニューは [検索結果] と [まちメモ帳] の2グループ見出し（aria-hidden）＋区切り線で整理（#80）。全消去は危険操作として従来どおり赤字で区別表示。操作後のフィードバック（書き出し・読み込みの結果/エラー・全消去成功）はメニューの位置に role="status" のメッセージで表示（成功=✓・エラー=⚠️ アイコン、✕で閉じる、狭い画面ではみ出ないよう max-width 付き）。
- 施設詳細シート（MobileFacilityDetail）: 2段階（half/full）シートと取っ手のドラッグ/タップ切替を廃止（実機フィードバック: 取っ手ドラッグが遅く体感が重い）。開いた時点で 85dvh の固定高さ（h-[85dvh]）とし、全項目（基本4項目・カテゴリ追加項目・メール/FAX・SNS・バリアフリー情報・座標・OSMリンク）を最初から表示する。シートは flex column: ヘッダー（auto）→ 地図エリア（座標がある場合のみ・flex-1・最小高さ220px・スクロール領域の外）→ 情報エリア（flex-1・overflow-y-auto）→ フッター（auto・常に最下部に固定）。地図はスクロール領域の外に置くため情報スクロールと地図操作が競合しない。地図エリアは flex-1 でシート高さに応じて伸縮し、MiniLocationMap は height: 100% でエリア全体を満たす（MapLibre の組み込み ResizeObserver が伸縮を自動追従）。座標が無い施設は地図エリア自体を出さず、その分情報エリアが広がる。取っ手のバーは撤去。「本体地図で見る」導線（onShowOnMap prop・タップ用ラッパー role=button・ラベル）は廃止済み: 詳細内地図がインタラクティブになったため不要。MobileShell/PcShell 側の showOnMap 実装（詳細を閉じてタブ切替・SET_SEARCH_SOURCE 'map'・resize＋easeTo）も削除済み（両シェルで dispatch が未使用になったため useApp のデストラクチャからも除去）。
- 詳細内地図（MiniLocationMap）はインタラクティブ: ドラッグで移動、ピンチ/ホイールでズーム（pointer-events: none を撤去）。回転（bearing）とpitchは全地図の方針どおり無効（dragRotate: false、touchZoomRotate.disableRotation() で捻り回転のみ無効化しピンチズームは有効、maxPitch: 0 / pitchWithRotate: false、keyboard: false）。maplibreMock に touchZoomRotate スタブを追加済み。
- まちメモ帳のアイテムに ★1〜5 の評価（rating: 0〜5 の整数、0 ＝ 未評価）を追加済み。データ層（memocho.js）: addMemocho は rating: 0 で初期化、updateRating は 0〜5 の整数以外で無変更、normalizeItem は欠落/不正を 0 に落とす寛容な方式。useMemocho フックに setRating を追加。JSON 書き出しは items 丸ごとなので rating 自動含まれ、JSON 読み込みは normalizeItem で検証される。CSV 書き出しは toCSV の includeRating オプションで末尾に rating 列を追加（CSV 読み込み経路は存在しない）。UI: MemochoCard のメモ欄の上に星5つのボタン行（評価分★・残り☆、タップでその値を設定、現在の値と同じ星をタップすると 0 に解除、aria-label/aria-pressed で状態表現）。対象外: 評価での並び替え・絞り込み、検索結果カードや詳細シートへの星表示（実装してない）。未コミット。
- テストは 1387 件・84ファイル（2026-11-18 時点）。
ヘッダーメニューの開閉・項目の有効/無効・全消去の2段階確認・全タブでの利用（mobileLayout/pcLayout）・全消去後のメモ帳0件表示（headerWipeMemochoSync）・まちメモ帳書き出しのBlob内容検証・読み込みの合流/エラー・グループ見出し2つと全消去の赤字表示（HeaderMenu.test）を検証。MemochoSection.test は表示・メモ編集・評価（星5つ）・サムネイル・削除をカバー。
- 新機能「CSVアップロード→osmid近似照合→ダウンロード」は実装済み（取込・行揃え照合・元のCSVへのlat/lon/osmid書き込み・フォールバック）。未コミット。
