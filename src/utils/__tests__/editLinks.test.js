import { describe, it, expect } from 'vitest'
import { buildNoteUrl, buildOsmElementUrl, buildOsmViewportUrl } from '../editLinks'

describe('buildNoteUrl / buildOsmElementUrl', () => {
  it('buildNoteUrl は座標付き notes/new URL', () => {
    expect(buildNoteUrl(34.85, 135.5)).toBe(
      'https://www.openstreetmap.org/notes/new?lat=34.850000&lon=135.500000'
    )
  })

  it('buildOsmElementUrl は要素ページURL', () => {
    expect(buildOsmElementUrl({ type: 'node', id: 1001 })).toBe(
      'https://www.openstreetmap.org/node/1001'
    )
  })
})

describe('buildOsmViewportUrl', () => {
  it.each([
    [null, '/'],
    ['node/50', '/node/50'],
    ['way/51', '/way/51'],
  ])('中心座標とズームを保持し、選択 %s をURLに含める', (key, path) => {
    expect(buildOsmViewportUrl({ lat: 34.85, lon: 135.5, zoom: 16.8 }, key))
      .toBe(`https://www.openstreetmap.org${path}#map=17/34.8500000/135.5000000`)
  })
})
