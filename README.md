# まちのスクラップブック（開発リポジトリ名: machi-scrapbook）

**「地図や自治体から、お店・施設の情報を探して保存」**できる、誰でも使いやすい地域のデータ帳を目指すWebサービスです。

場所の名前や市区町村から、あるいは地図の範囲から、OpenStreetMap（OSM）由来のお店・施設を検索し、住所・連絡先・公式サイトなどの確認、絞り込み、CSV/GeoJSONダウンロードができます。気になる施設は「まちメモ帳」に保存して、メモを付けて持ち歩けます。基本操作にOSMタグやOverpass QLの知識は要求しません。

もう一つのテーマは、**登録が不足している情報を可視化すること**です。電話番号やWebサイトが未登録の施設は「-」と表示され、バリアフリー情報は登録状況の集計とあわせて確認できます。「載っていない」ことが分かるのが、このサービスの大事な役割です。

- **主な利用者**：地域住民、街歩き・イベントの企画者、地域団体、学校、地域情報の制作者など。
- **基本の使い方**：場所と目的（食べる・買う・病院など）を選ぶ → 店舗・施設を一覧で見る → 種類や条件で絞る → 公式サイトを開く／メモ帳に保存する／CSVで持ち帰る。
- **補助機能**：手元の店名リストをOSMの候補と照合し、確認した店の緯度・経度をCSVに付ける。
- **OSMの位置付け**：利用者が意識するのは出典・ライセンス表記など必要な場面のみ。掲載情報が現実の施設を網羅するとは限りません。

**[サイトを開く](https://armd-02.github.io/machi-scrapbook/)** · **[ロードマップIssue #16](https://github.com/armd-02/machi-scrapbook/issues/16)**

## 開発ロードマップ（2026年11月17日時点）

完成済みの実装と、実際のイベントで使用可能なことの検証は区別しています。地域ポータルは将来構想とします。

| 段階 | 優先する成果 | 状態 |
| --- | --- | --- |
| **M0：店名→座標付きCSV** | 2026年11月の「ひがよどアートフェス」向けオンラインマップ用。店名一覧から候補を確認・確定し、座標・OSM ID付きCSVを出力 | **実装・公開済み**。実際の店舗名簿で全工程を使用済み（[#42](https://github.com/armd-02/machi-scrapbook/issues/42)） |
| **M1：自治体別施設検索** | 都道府県→基礎自治体を選び、**自治体BBOX**で店舗・施設の一覧を取得。地図の表示範囲から検索する機能も残す | **実装・公開済み**（[#44](https://github.com/armd-02/machi-scrapbook/issues/44)） |
| **M1.1：行政区域内検索** | Overpassのareaデータが利用可能になった後、自治体境界に従って検索する | **環境整備後**。M1の完成を待たせない |
| **M2：Wikidata連携** | OSMの`wikidata`タグなどを手掛かりに、Wikidata、Wikipedia、Wikimedia Commonsの関連情報・写真へつなぐ | 将来構想 |
| **M3：街ごとのポータル** | 市区町村・駅周辺などの地域ページを固定URLで提供。施設一覧は定期更新を検討 | 将来構想 |
| **M4：地域住民による情報追加** | LocalWikiのように紹介文・歴史・写真等を編集できるようにし、基本情報はOSMと同期 | 将来構想 |

### M1の検索範囲と自治体データ

自治体名・自治体コード・行政界のOSM relation ID・BBOXは、[OSM Japan Changesの自治体GeoJSON](https://github.com/K-Sakanoshita/osm-japan-changes/blob/main/public/data/municipalities.min.geojson)を基にした軽量な選択用JSON（`public/data/municipalities.json`）として同梱しています。自治体選択時に毎回Overpass APIから境界を取得する必要はありません。

M1では**「自治体を選ぶ」と「検索に使うBBOX」を分離**しています。選択した自治体のBBOXを直接検索条件とし、地図に`fitBounds`した後の表示範囲で置き換えません。地図から検索するモードでは、従来どおり「検索する」を押した時点の表示範囲（または地名で確定した範囲）を使います。

**BBOXは行政区域そのものではありません。** 隣接自治体の施設も含まれ得ますが、結果は検索範囲で切り取って表示します。広すぎる範囲の検索は抑止しており、地名検索では範囲が1,000 km²を超えると検索できません（市区町村そのものを選んだ場合は例外として検索できます）。armd-01のOverpassには現在areaデータが未生成のため、M1ではarea検索を前提とせず、生成後のM1.1で対応します。検索は店舗・公共施設などのPOIを中心とし、道路・建物などを無条件に全件取得しないようにします。

### 将来の地域ポータルとWikidata

目指すのは**「何も編集しなくても基本情報が掲載され、地元の人が編集するほど街の情報が豊かになるポータル」**です。施設の名称・場所・公式サイトなどの基本項目はOSMから更新し、地域固有の紹介・歴史・写真は別データとして保持します。Wikidata QIDは、明示的に対応付いた施設を中心に利用し、名前の一致だけで自動紐付けしません。

長期的には独自の施設IDとOSM型・IDとの紐付け履歴を持ち、閉店した施設を通常の一覧から除外しつつ、地域の記録や編集履歴を残す構造を検討します。**OSMの検索結果から消えただけで閉店と断定しない**方針です。

## 機能

### 探す
- **一般向けトップ**: 場所（地名・駅名など）を入力し、目的タイル（食べる／買う／病院・薬局／役所・手続き／遊ぶ・公園／泊まる／駅・交通／トイレ／学ぶ／バリアフリー）を選んで検索
- **地図から探す**: 地図の表示範囲で検索。場所を入力して確定すると地図が移動し、検索範囲が地図上に線で描かれる
- **自治体から探す**: 都道府県→市区町村を選んで、その範囲で検索
- **くわしく探す**: 日本語カテゴリ + キーワード + OSMタグ条件（AND/OR）・存在/欠損条件
- **表記揺れ対応**: かな→ローマ字変換による部分一致検索
- **URL共有**: 検索条件をURLにエンコード・復元

### バリアフリー
- 「バリアフリー」を選ぶと、歩道（点字ブロックの有無で色分け）・縁石・音響／振動つき信号機などを検索
- 検索範囲内の登録状況を集計表示（例: 点字ブロックの記録がある歩道の割合）
- 視点フィルタ: 車椅子／目の不自由な方／子ども連れ／お年寄り（登録が確認できる施設だけに絞る）
- 縁石の高さでの絞り込み、未登録項目（電話・Webサイトなど）での絞り込み

### 結果の確認と保存
- 地図上のマーカー + 一覧カードの連動表示。詳細画面から経路検索（Googleマップ）やOpenStreetMapの施設ページを開ける
- 電話・Webサイトは未登録でも「-」と表示し、不足が分かるようにしている
- 営業時間は日本語表記に整形して表示
- **まちメモ帳**: 施設をブラウザ内（localStorage）に保存し、メモを付けられる。地図サムネイルつきカードで一覧でき、JSONとCSVへの書き出し、JSONからの読み込みに対応

### 公開地図への同期

1. [コミュニティマップメーカー](https://cmapmaker.openacrossbase.net/register.html?app_key=machi-scrapbook)で OpenStreetMap アカウントを登録し、「まちのスクラップブック」プロジェクトに参加します。既存アカウントは[マイページ](https://cmapmaker.openacrossbase.net/mypage.html)で OSM と連携できます。
2. まちメモ帳で公開にしたスクラップブックを選び、「公開地図へ反映」を押します。
3. 「OpenStreetMap でログイン」を押し、必要に応じてログインと連携の許可を行います。アプリへ戻ると同期が始まります。同期後は「URLをコピー」から自分の公開地図を共有できます。

### 分析・出力
- **集計**: カテゴリ別の件数、タグ・属性の登録状況
- **CSV出力**: ヘッダーメニューから。UTF-8 BOM（Excel対応）・数式注入対策。絞り込み後の表示分が対象
- **GeoJSON出力**: ヘッダーメニューから。地理情報システムで利用可能
- **店名→座標CSV**: 店名リストをOSM候補と照合し、確認済みの店舗について緯度・経度、OSM型とIDを含む地図作成用CSVを出力

### OSMデータの確認と報告
- 検索結果が0件の場合に周辺のOSM地図やNote作成画面を開ける
- データ品質・出典・API制約の明示

## M0：店名リストから座標付きCSVを作る（2026年11月「ひがよどアートフェス」向け）

1. 対象地域で、カフェや店舗など必要な種類の施設を検索する。
2. 「その他」タブの「店名→座標CSV」へ移動し、1行1店舗名を貼り付けるか、CSV/TSVを読み込む（照合キーにする列は選択可能）。
3. 「照合」で候補一覧を作り、候補の位置を地図で確認して「確定」を押す。
4. 「地図用CSV」をクリックして `name,lat,lon,status,matched_name,osm_type,osm_id,osm_url,source` をダウンロードする。

> 現在のM0実装は、**先に対象地域の施設をOverpassで検索する方式**です。店名リストだけを渡すと全国から自動探索する機能ではありません。

**誤った地図ピンを避けるため、未確認候補や候補なしの行は座標・OSM IDを空欄のまま出力します。** CSVは入力行の順序を保持します。地図へインポートする場合は、`status=確認済み` の行だけを利用してください。way/relationの位置は代表座標であり、入口の位置を保証するものではありません。

地図にOSM由来データを使用する場合は、地図等にOpenStreetMap contributorsへの帰属表示を行い、ODbLの条件を確認してください。

## 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | React 18 (JavaScript) |
| ビルドツール | Vite 6 |
| 地図 | MapLibre GL JS 4（ベース地図はOpenStreetMap Japanのベクタタイル `osmfj_poi` スタイル） |
| スタイル | Tailwind CSS 4 |
| 状態管理 | React Context + useReducer |
| データソース | Overpass API / Nominatim |
| テスト | Vitest |
| 公開 | GitHub Pages |

画面はモバイル（下部4タブ: 検索／一覧／メモ帳／その他）とPC（左ペイン=検索、右ペイン=一覧／メモ帳の2ペイン）で共通のコンポーネントを使っています。

## セットアップ

```bash
# 依存関係のインストール
npm ci

# 開発サーバー
npm run dev

# テスト
npm test

# 本番ビルド
npm run build

# プレビュー
npm run preview
```

## 設定

Overpass APIエンドポイントや制限値は `src/config.js` で変更できます。エンドポイントは複数候補を持ち、失敗時は順にフォールバックします（既定は自前プロキシ、次に公式、次に private.coffee）。

```javascript
export const APP_CONFIG = {
  overpassEndpoint: 'custom', // 既定値。'custom' | 'public' | 'private_coffee'
  maxResults: 5000,
  totalTimeoutMs: 90000,      // 検索全体の時間予算
  perAttemptTimeoutMs: 30000, // エンドポイント1件あたりの上限
  cacheEnabled: true,
  cacheMaxEntries: 20,
  nominatimRateLimitMs: 1000
}
```

なお、地名検索の範囲ガード（1,000 km²）は `src/utils/geo.js` 側で判定しています。

## プロジェクト構造（構成マップ）

ソースを読むときの目次です。まず「読み方の原則」と「何を見たいときはどこ」を見て、必要な場所だけ開いてください。

### 読み方の原則

- `components/` = 見た目と操作の部品。`components/mobile/` は画面単位の部品で、PC表示でも左ペインに流用される（名前は mobile だが共用）
- `hooks/` `state/` `context/` = 画面を持たない「状態と振る舞い」
- `utils/` = 計算だけの道具。画面も状態も持たない
- `data/` = 固定データの定義
- どのフォルダにも `__tests__/` があるのは、テストを対象ファイルの隣に置く決まりのため。本体87ファイルに対してテストが91ファイルある

### 何を見たいときはどこ

| 見たいもの | 場所 |
|---|---|
| 画面の見た目・文言 | `src/components/`（スマホ画面は `src/components/mobile/`） |
| カテゴリの種類・並び順 | `src/data/categories.js` |
| 検索の動き | `src/hooks/useSearch.js` と `src/state/appReducer.js` |
| 地図そのもの | `src/components/MapView.jsx` |
| 地図の見た目（色・スタイル） | `src/styles/osmfj_poi.json` と `src/utils/mapStyle.js` |
| メモ帳の保存データの形式 | `src/utils/memocho.js`（保存先はブラウザの localStorage） |
| 検索条件をURLで共有する仕組み | `src/utils/urlState.js` |
| Overpassへの問い合わせ | `src/utils/overpass.js` |
| 接続先などの設定 | `src/config.js` |

### 全体像

```
src/
├── main.jsx                 # 起動入口（引っ張り更新の防止など初期処理）
├── App.jsx                  # 画面幅で MobileShell / PcShell を切替、URLから状態を復元
├── config.js                # 設定（Overpass接続先などのエンドポイント・制限値）
├── components/              # 共通部品
│   ├── AboutPanel.jsx           # 「まちのスクラップブックとは」（データ品質・出典・制約）
│   ├── AdvancedSearch.jsx       # 詳細検索のタグ条件入力
│   ├── AppHeader.jsx            # 共通ヘッダー（タイトル＋ハンバーガーメニュー）
│   ├── AttributeCompleteness.jsx # 属性の充足率表示
│   ├── BarrierFreeLegend.jsx    # バリアフリー検索の地図凡例
│   ├── BatchMatchMap.jsx        # 店名→座標CSV照合の確認用ミニ地図
│   ├── CategoryPicker.jsx       # 目的チップ＋カテゴリ選択（PC・モバイル共通）
│   ├── CategorySummaryTable.jsx # カテゴリ別集計テーブル
│   ├── EditPanel.jsx            # OSM編集・Note作成への導線（結果0件のときなど）
│   ├── GeocodeCandidateList.jsx # 地名ジオコードの候補リスト
│   ├── HeaderMenu.jsx           # ハンバーガーメニューの中身（保存・メモ帳操作）
│   ├── MapView.jsx              # 本体地図（MapLibre、検索範囲の描画つき）
│   ├── MunicipalitySearch.jsx   # 都道府県タイル＋市区町村サジェストで探す
│   ├── PlaceNameInput.jsx       # 地名・駅名の入力欄（トップと地図タブで共用）
│   ├── PoiDescription.jsx       # 地図でタップしたPOIの説明枠
│   ├── PrefectureTileMap.jsx    # 都道府県のブロック地図（タイルグリッド）
│   ├── ResultFilterBar.jsx      # 一覧とメモ帳で共用のフィルタバー
│   ├── SearchActionButton.jsx   # 検索／キャンセルボタン
│   ├── ShareButton.jsx          # 検索条件の共有ボタン
│   ├── SimpleSearch.jsx         # PC向け簡易検索フォーム
│   ├── Spinner.jsx              # 処理中スピナー
│   ├── StatisticsPanel.jsx      # 集計・分類・属性欠損の分析パネル
│   ├── StatusBanner.jsx         # 状態メッセージの帯表示
│   ├── WorkspacePowerWifiSummary.jsx # 作業スペース系の電源・Wi-Fi集計
│   └── mobile/              # 画面単位の部品（PC左ペインでも使う）
│       ├── MobileShell.jsx      # スマホ全体レイアウト（下部ナビつき）
│       ├── PcShell.jsx          # PC全体レイアウト（2ペイン）
│       ├── MobileBottomNav.jsx  # スマホ下部ナビ（4タブ）
│       ├── MobileQuickTop.jsx   # 一般向けトップ（タイル＋地名入力）
│       ├── MobileSearchTab.jsx  # 検索タブ（トップ／くわしく探すフォーム）
│       ├── MobileListTab.jsx    # 一覧タブ（結果カード＋結果マップ）
│       ├── MobileResultsMap.jsx # 一覧タブ上部の結果マップ
│       ├── MobileFacilityCard.jsx   # 施設カード
│       ├── MobileFacilityDetail.jsx # 施設詳細シート
│       ├── MiniLocationMap.jsx  # 施設詳細内の小さい地図
│       ├── MemochoSection.jsx   # まちメモ帳タブ
│       ├── MemochoTrash.jsx     # メモ帳のごみ箱
│       ├── MobileBatchMatch.jsx # 店名→座標CSVの画面
│       ├── MobileOtherTab.jsx   # 「その他」タブ
│       ├── BarrierFreeSummary.jsx # バリアフリーのデータ充実度表示
│       └── AppIcon.jsx          # アプリアイコン
├── context/
│   ├── AppContext.js        # アプリ全体の状態を配る仕組み
│   └── BatchMatchContext.jsx # 一括照合の状態保持（タブ切替で消えないように）
├── state/
│   └── appReducer.js        # 検索・結果などの状態の変化ルール
├── data/
│   └── categories.js        # 日本語カテゴリとOSMタグの対応定義
├── hooks/
│   ├── useSearch.js         # 検索の実行（キャンセル・キャッシュつき）
│   ├── useMemocho.js        # メモ帳の保存と読み出し
│   ├── useMapRef.js         # 地図インスタンスの共有
│   ├── useIsMobile.js       # 画面幅によるモバイル判定
│   └── useDraggableHeight.js # 地図の高さのドラッグ調整
├── styles/
│   ├── index.css            # 全体のCSS
│   └── osmfj_poi.json       # ベース地図のベクタスタイル定義
├── utils/                   # 計算だけの道具（画面を持たない）
│   ├── overpass.js          # Overpass APIのクエリ生成・実行・キャッシュ
│   ├── geo.js               # 地理計算とNominatimジオコード
│   ├── searchBbox.js        # 検索範囲（BBOX）の決定
│   ├── searchCriteria.js    # 検索条件のスナップショット生成
│   ├── urlState.js          # 検索条件のURLエンコード／デコード
│   ├── municipalities.js    # 自治体データの読み込み・照合（サジェスト用）
│   ├── categoryMatch.js     # カテゴリ一致の判定
│   ├── categoryProfiles.js  # カテゴリ別の情報設計
│   ├── resultCategories.js  # 結果のカテゴリ集計
│   ├── resultFilters.js     # 検索結果の表示フィルタ
│   ├── facilityLabels.js    # OSMタグ→日本語の施設タイプラベル
│   ├── poiDescription.js    # POI説明文の生成
│   ├── accessibility.js     # バリアフリータグの解釈→日本語表示
│   ├── barrierFree.js       # バリアフリー検索のクエリ生成・整形
│   ├── barrierFreeGeoJSON.js # バリアフリー結果の地図描画用GeoJSON変換
│   ├── barrierFreeResults.js # バリアフリー結果の正規化と一覧表示
│   ├── barrierFreeSummary.js # バリアフリーのデータ充実度集計
│   ├── memocho.js           # メモ帳のデータ形式と保存層
│   ├── memochoFilters.js    # メモ帳の絞り込み
│   ├── mapCapture.js        # メモ帳カード用の地図サムネイル生成
│   ├── mapStyle.js          # ベース地図スタイルの読み込み
│   ├── batchMatch.js        # 店名リストの一括照合
│   ├── nameVariants.js      # 店名の表記ゆれ照合キー
│   ├── csvParse.js          # CSVの読み取り（RFC4180準拠）
│   ├── locationCsv.js       # 地図制作用の座標付きCSV生成
│   ├── export.js            # 検索結果のCSV／GeoJSON出力
│   ├── editLinks.js         # OSM／iD編集リンクの生成
│   ├── openingHours.js      # opening_hoursの日本語化（表示用）
│   ├── powerWifi.js         # 電源・Wi-Fi状況の3状態判定
│   ├── statistics.js        # 検索結果の集計・分類・属性欠損分析
│   ├── linkify.js           # メモ文字列内のURLリンク化
│   ├── verifyIds.js         # 前年度OSM ID対応表の読み込みと再検証
│   ├── pageZoomGuard.js     # ページズーム防止（モバイルブラウザ対応）
│   └── pullToRefreshGuard.js # 引っ張り更新の防止（モバイルブラウザ対応）
└── test/
    └── maplibreMock.js      # テスト用の地図モック

public/
├── data/municipalities.json # 自治体データ（名称・コード・範囲）
└── assets/                  # 画像などの静的ファイル
```


## データ出典

- **OpenStreetMap** (© OpenStreetMap contributors)
- ライセンス: [Open Database License (ODbL)](https://www.openstreetmap.org/copyright)
- ベース地図のベクタタイルは OpenStreetMap Japan の配信（tile.openstreetmap.jp）を利用
- データは取得時点のスナップショットであり、現地状態と異なる場合があります

## 利用上の注意

- 検索結果が0件でも「OSMに未登録」とは限りません（表記違いの可能性）
- Overpass APIにレート制限・タイムアウトがあります
- 地名検索では、範囲が1,000 km²を超える場合は検索できません（市区町村そのものを選んだ場合を除く）
- 大量の結果や広い範囲では部分取得になる場合があります
- 出力ファイルには出典・取得日時が自動的に含まれます

## ライセンス

[MIT License](LICENSE)
