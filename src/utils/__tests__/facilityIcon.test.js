import { describe, it, expect } from 'vitest'
import { getFacilityIcon, facilityIconUrl, normalizeIconName } from '../facilityIcon'
import { MARKER_KEY_ORDER } from '../../data/markerIcons'

// コミュニティマップメーカー（cmapmaker）の poilib.js getIcon 挙動と一致させるための単体テスト。
// 対応表（markerIcons.js）の実値を使って判定の優先順を検証する。

describe('getFacilityIcon: 判定の優先順', () => {
  it('通常タグ: 対応表にヒットするアイコンを返す', () => {
    expect(getFacilityIcon({ amenity: 'cafe' })).toBe('cafe.png')
    expect(getFacilityIcon({ amenity: 'bank' })).toBe('bank-JP.png')
    expect(getFacilityIcon({ shop: 'convenience' })).toBe('shopping-basket.png')
  })

  it('subtag が通常タグより優先される', () => {
    // tourism=artwork は通常タグでは art-gallery.png だが、
    // subtag（tourism=artwork + artwork_type=statue）が優先されて statue.png
    const tags = { tourism: 'artwork', artwork_type: 'statue' }
    expect(getFacilityIcon(tags)).toBe('statue.png')
    // subtag の条件（tourism=artwork）を満たさなければ通常タグに戻る
    expect(getFacilityIcon({ tourism: 'artwork' })).toBe('art-gallery.png')
    // subtag の条件キーが別値なら subtag は効かない
    expect(getFacilityIcon({ tourism: 'museum', artwork_type: 'statue' })).not.toBe('statue.png')
  })

  it('subtag: 宗教別の寺院・神社（amenity=place_of_worship + religion）', () => {
    expect(getFacilityIcon({ amenity: 'place_of_worship', religion: 'buddhist' })).toBe('buddhist.png')
    expect(getFacilityIcon({ amenity: 'place_of_worship', religion: 'shinto' })).toBe('torii.png')
  })

  it('キー優先順（MARKER_KEY_ORDER）に従う', () => {
    // amenity は shop より優先順が上 → amenity のアイコン
    const iAmenity = MARKER_KEY_ORDER.indexOf('amenity')
    const iShop = MARKER_KEY_ORDER.indexOf('shop')
    expect(iAmenity).toBeLessThan(iShop)
    expect(getFacilityIcon({ amenity: 'cafe', shop: 'convenience' })).toBe('cafe.png')
    // amenity の値が対応表に無ければ、次の優先キー（shop）へ進む
    expect(getFacilityIcon({ amenity: '未登録の値', shop: 'convenience' })).toBe('shopping-basket.png')
  })

  it('building は最後に回される（施設の用途を優先）', () => {
    // building=office（town_hall.png）より amenity=cafe（cafe.png）が優先
    expect(getFacilityIcon({ building: 'office', amenity: 'cafe' })).toBe('cafe.png')
    // building のみなら最後に回された building のアイコンが使われる
    expect(getFacilityIcon({ building: 'museum' })).toBe('museum.png')
  })

  it('対応表に無い値・タグ無しは fallback になる', () => {
    expect(getFacilityIcon({ amenity: 'cafe' })).not.toBe('marker-stroked.png')
    expect(getFacilityIcon({})).toBe('marker-stroked.png')
    expect(getFacilityIcon(undefined)).toBe('marker-stroked.png')
    expect(getFacilityIcon({ foo: 'bar' })).toBe('marker-stroked.png')
  })

  it('{ tags: {...} } 形状のオブジェクトでも内側の tags を使う（コピー元と同じ許容）', () => {
    expect(getFacilityIcon({ tags: { amenity: 'cafe' } })).toBe('cafe.png')
  })
})

describe('normalizeIconName: .svg → .png', () => {
  it('.svg で終わる名前は .png に置き換わる', () => {
    expect(normalizeIconName('icon.svg')).toBe('icon.png')
  })

  it('.png・空・falsy はそのまま（空文字）', () => {
    expect(normalizeIconName('icon.png')).toBe('icon.png')
    expect(normalizeIconName('')).toBe('')
    expect(normalizeIconName(null)).toBe('')
    expect(normalizeIconName(undefined)).toBe('')
  })
})

describe('facilityIconUrl: base を考慮した URL 組み立て', () => {
  it('import.meta.env.BASE_URL + icons/<ファイル名> を返す', () => {
    expect(facilityIconUrl('cafe.png')).toBe(`${import.meta.env.BASE_URL}icons/cafe.png`)
  })
})
