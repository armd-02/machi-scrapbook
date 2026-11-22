/**
 * OSM Note作成URL（座標指定）
 */
export function buildNoteUrl(lat, lon) {
  return `https://www.openstreetmap.org/notes/new?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`
}

/**
 * OSM要素ページURL
 */
export function buildOsmElementUrl(result) {
  if (result && result.type && result.id != null) {
    return `https://www.openstreetmap.org/${result.type}/${result.id}`
  }
  return 'https://www.openstreetmap.org'
}

/** OSMの地図中心とズームを指定し、選択中の地物があればそのページを開く。 */
export function buildOsmViewportUrl({ lat, lon, zoom }, selectedKey) {
  const element = /^(node|way|relation)\/([1-9]\d*)$/.exec(selectedKey ?? '')
  const base = element
    ? buildOsmElementUrl({ type: element[1], id: element[2] })
    : `${buildOsmElementUrl()}/`
  // OSMのパーマリンクではズームを整数で指定する。
  return `${base}#map=${Math.round(zoom)}/${lat.toFixed(7)}/${lon.toFixed(7)}`
}
