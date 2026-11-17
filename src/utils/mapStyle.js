/**
 * OSMベクタタイルベースマップスタイル（MapLibre GL用）
 *
 * ベースマップスタイルは community_mapmaker の osmfj_poi.json を本リポジトリに
 * vendor したもの（src/styles/osmfj_poi.json、完全な MapLibre スタイル・
 * version 8・159レイヤー）をJSモジュールとして読み込み、トップレベルの
 * カメラフィールド（center / zoom / bearing / pitch）を除去したものを
 * 共有ベースマップスタイル BASEMAP_STYLE として export する。地図コンポーネント
 * （MapView / MobileResultsMap / MiniLocationMap / BatchMatchMap）はこれを
 * Mapオプションの style（オブジェクト）として使う。
 *
 * カメラフィールド除去の理由: community_mapmaker 元のファイルにはトップレベルに
 * pitch: 30 / bearing: 0 / center（大阪）/ zoom: 16 が含まれる。MapLibre は
 * スタイルロード時にスタイルに宣言されたカメラプロパティを適用するため、除去
 * しないとアプリ自身のカメラ指定（initialCamera・fitBounds等）が上書きされ、
 * 地図が30°傾いた状態で起動してしまう。除去はここで（JSONファイルを直接編集
 * するのではなく）mapStyle.js 側で行う。community_mapmaker 側から再同期する
 * ときはファイルをそのままコピーし直せばよく、除去漏れは mapStyle.test.js が
 * ガードする。
 *
 * スタイルの構成:
 * - source: "openmaptiles"（type: vector）のみ。url は
 *   https://tile.openstreetmap.jp/data/planet.json（OSMFJ / TileServer GL、
 *   OpenMapTilesスキーマのベクタタイル、maxzoom 14）
 * - glyphs: {fontstack}/{range}.pbf（MapLibreは {fontstack}/{range} トークンを
 *   必須とする。クラスタ件数テキストの表示条件）
 * - sprite: tile.openstreetmap.jp の osm-bright sprite
 * - attribution: "Hosted by OSMFJ (with Poi) | © OpenStreetMap"
 *   （AttributionControl が表示）
 * - OSMのPOI（施設）を z14 以降でラベル表示するレイヤ群
 *   （poi_z14/15/16、poi_transit 等）を含む。OSM施設検索ツールである本アプリ
 *   に合わせたベースマップ。
 * - building-3d レイヤ（fill-extrusion）はそのまま残す。アプリは3D視点を
 *   使わない（pitch 0）ため実質平面表示になる（再同期時も除去しない）。
 *
 * スタイルはJSバンドルに含まれるため、MapLibre がリモートのスタイル文書を
 * 取得する必要はなく、初期描画がネットワーク遅延の影響を受けにくい。
 * タイル・グリフ・sprite は実行時に tile.openstreetmap.jp から取得する。
 *
 * アプリ自身のデータ（検索結果・クラスタ・BBOX矩形・バリアフリー線等）は
 * style load 後に独立した GeoJSON ソース/レイヤとして追加するため、
 * ベースマップスタイル自体には依存しない。
 */
import osmfjPoiStyle from '../styles/osmfj_poi.json'

// トップレベルのカメラフィールド（center / zoom / bearing / pitch）を除去。
// 上記「カメラフィールド除去の理由」を参照。残りはそのまま共有スタイルとして使う。
const { center, zoom, bearing, pitch, ...BASEMAP_STYLE } = osmfjPoiStyle

export { BASEMAP_STYLE }
export default BASEMAP_STYLE
