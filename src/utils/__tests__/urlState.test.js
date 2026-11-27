// @vitest-environment jsdom
/**
 * URL状態エンコード/デコードの回帰テスト（Issue #22）
 * - コロンを含むキー（addr:street）が正しく復元される
 * - JSON形式のタグエンコード
 * - BBOXバリデーション
 */
import { describe, it, expect } from 'vitest'
import { encodeStateToURL, decodeURLToState, generateShareURL } from '../urlState'

describe('encodeStateToURL / decodeURLToState', () => {
  it('コロンを含むタグキー（addr:street）が正しく復元される', () => {
    const state = {
      searchMode: 'advanced',
      advancedSearch: {
        tags: [
          { key: 'addr:street', value: '', mode: 'exists' },
          { key: 'amenity', value: 'cafe', mode: 'equals' }
        ],
        keyword: '',
        useAnd: true
      }
    }
    const qs = encodeStateToURL(state)
    const decoded = decodeURLToState('?' + qs)

    expect(decoded.searchMode).toBe('advanced')
    expect(decoded.advancedSearch.tags).toHaveLength(2)
    
    // addr:street がコロンを保持して復元される
    const streetTag = decoded.advancedSearch.tags.find(t => t.key === 'addr:street')
    expect(streetTag).toBeDefined()
    expect(streetTag.mode).toBe('exists')
    
    // amenity=cafe も正常
    const amenityTag = decoded.advancedSearch.tags.find(t => t.key === 'amenity')
    expect(amenityTag.value).toBe('cafe')
    expect(amenityTag.mode).toBe('equals')
  })

  it('複数タグのANDが正しく復元される', () => {
    const state = {
      searchMode: 'advanced',
      advancedSearch: {
        tags: [
          { key: 'amenity', value: 'restaurant', mode: 'equals' },
          { key: 'cuisine', value: 'ramen', mode: 'equals' },
          { key: 'name:ja', value: '', mode: 'exists' }
        ],
        keyword: '',
        useAnd: true
      }
    }
    const qs = encodeStateToURL(state)
    const decoded = decodeURLToState('?' + qs)

    expect(decoded.advancedSearch.tags).toHaveLength(3)
    expect(decoded.advancedSearch.tags[0]).toEqual({ key: 'amenity', value: 'restaurant', mode: 'equals' })
    expect(decoded.advancedSearch.tags[1]).toEqual({ key: 'cuisine', value: 'ramen', mode: 'equals' })
    expect(decoded.advancedSearch.tags[2]).toEqual({ key: 'name:ja', value: '', mode: 'exists' })
    expect(decoded.advancedSearch.useAnd).toBe(true)
  })

  it('name:ja のようなコロン含むキーが正しく復元される', () => {
    const state = {
      searchMode: 'advanced',
      advancedSearch: {
        tags: [{ key: 'name:ja', value: 'テストカフェ', mode: 'equals' }],
        keyword: '',
        useAnd: true
      }
    }
    const qs = encodeStateToURL(state)
    const decoded = decodeURLToState('?' + qs)

    expect(decoded.advancedSearch.tags[0].key).toBe('name:ja')
    expect(decoded.advancedSearch.tags[0].value).toBe('テストカフェ')
  })

  it('BBOXが正しく復元される', () => {
    const state = {
      searchMode: 'simple',
      simpleSearch: { category: 'cafe', keyword: '', location: '' },
      bbox: { south: 35.676, west: 139.748, north: 35.678, east: 139.750 }
    }
    const qs = encodeStateToURL(state)
    const decoded = decodeURLToState('?' + qs)

    expect(decoded.bbox).toBeDefined()
    expect(decoded.bbox.south).toBeCloseTo(35.676, 5)
    expect(decoded.bbox.west).toBeCloseTo(139.748, 5)
    expect(decoded.bbox.north).toBeCloseTo(35.678, 5)
    expect(decoded.bbox.east).toBeCloseTo(139.750, 5)
  })

  it('無効なBBOX（south >= north）は復元されない', () => {
    const params = new URLSearchParams()
    params.set('b', '35.7,139.7,35.6,139.8')  // south > north
    const decoded = decodeURLToState('?' + params.toString())
    expect(decoded?.bbox).toBeUndefined()
  })

  it('範囲外のBBOX（lat > 90）は復元されない', () => {
    const params = new URLSearchParams()
    params.set('b', '95.0,139.7,96.0,139.8')  // lat > 90
    const decoded = decodeURLToState('?' + params.toString())
    expect(decoded?.bbox).toBeUndefined()
  })

  it('空パラメータはnullを返す', () => {
    expect(decodeURLToState('')).toBeNull()
    expect(decodeURLToState('?')).toBeNull()
  })

  it('目的スコープ（p）がURLにエンコードされ復元される (#44)', () => {
    const state = {
      searchSource: 'map',
      searchMode: 'simple',
      simpleSearch: { category: '', keyword: '', location: '', cuisine: '', purpose: '遊ぶ・巡る' },
      advancedSearch: { tags: [], keyword: '', useAnd: true },
      municipalitySearch: { category: '', cuisine: '', purpose: '' },
      selectedMunicipality: null,
      bbox: { south: 34.7, west: 135.5, north: 34.72, east: 135.52 }
    }
    const qs = encodeStateToURL(state)
    expect(qs).toContain('p=' + encodeURIComponent('遊ぶ・巡る'))
    const decoded = decodeURLToState('?' + qs)
    expect(decoded.simpleSearch.purpose).toBe('遊ぶ・巡る')
  })

  it('自治体モードの目的スコープも復元される (#44)', () => {
    const state = {
      searchSource: 'municipality',
      searchMode: 'simple',
      simpleSearch: { category: '', keyword: '', location: '', cuisine: '', purpose: '' },
      advancedSearch: { tags: [], keyword: '', useAnd: true },
      municipalitySearch: { category: '', cuisine: '', purpose: '公共施設' },
      selectedMunicipality: { code: '272078', name: '高槻市', bbox: { south: 34.7, west: 135.5, north: 34.72, east: 135.52 } },
      bbox: null
    }
    const qs = encodeStateToURL(state)
    expect(qs).toContain('p=' + encodeURIComponent('公共施設'))
    const decoded = decodeURLToState('?' + qs)
    expect(decoded.municipalitySearch.purpose).toBe('公共施設')
  })
})

describe('encodeStateToURL / decodeURLToState: 一覧フィルタ (A2)', () => {
  const baseFilters = { nameFilter: '', typeFilter: 'all', catFilter: '', purposeFilter: '', sortDir: 'none' }
  const baseState = {
    searchMode: 'simple',
    simpleSearch: { category: '', keyword: '', location: '', cuisine: '', purpose: '' },
    resultFilters: baseFilters
  }

  it('アクティブなフィルタのみをエンコードする（デフォルト値は省略）', () => {
    const state = { ...baseState, resultFilters: { ...baseFilters, nameFilter: 'coffee' } }
    const qs = encodeStateToURL(state)
    expect(qs).toContain('nf=coffee')
    expect(qs).not.toContain('tf=')
    expect(qs).not.toContain('wo=')
    const decoded = decodeURLToState('?' + qs)
    expect(decoded.resultFilters).toEqual({ nameFilter: 'coffee' })
  })

  it('全フィルタパラメータがround-tripする', () => {
    const state = { ...baseState, resultFilters: { nameFilter: 'test', typeFilter: 'way', sortDir: 'desc' } }
    const qs = encodeStateToURL(state)
    const decoded = decodeURLToState('?' + qs)
    expect(decoded.resultFilters).toEqual({ nameFilter: 'test', typeFilter: 'way', sortDir: 'desc' })
  })

  it('catFilter/purposeFilter（フォームミラー）はエンコード対象外である', () => {
    const state = { ...baseState, resultFilters: { ...baseFilters, catFilter: 'cafe', purposeFilter: '食べる' } }
    const qs = encodeStateToURL(state)
    expect(qs).not.toContain('cf=')
    expect(qs).not.toContain('pf=')
    expect(decodeURLToState('?' + qs)).toBeNull()
  })

  it('無効な値はデコード時に無視される', () => {
    const p = new URLSearchParams({ cf: 'nope', tf: 'point', pf: 'xyz' })
    expect(decodeURLToState('?' + p.toString())).toBeNull()
  })

  it('旧形式の共有URL（フィルタパラメータなし）には影響しない', () => {
    const decoded = decodeURLToState('?c=cafe&k=coffee')
    expect(decoded.resultFilters).toBeUndefined()
  })

  it('自治体モードでもフィルタをエンコード・復元できる', () => {
    const state = {
      searchSource: 'municipality',
      selectedMunicipality: { code: '27', name: '吹田市', bbox: null },
      municipalitySearch: { category: 'cafe', cuisine: '', purpose: '' },
      resultFilters: { ...baseFilters, nameFilter: 'スターバックス' }
    }
    const qs = encodeStateToURL(state)
    const decoded = decodeURLToState('?' + qs)
    // #xx: 旧自治体モードURLは地図モードとして復元される
    expect(decoded.searchSource).toBe('map')
    expect(decoded.resultFilters).toEqual({ nameFilter: 'スターバックス' })
  })
})

/**
 * (#80) 画面パラメータ（view）のエンコード/デコード
 */
describe('encodeStateToURL / decodeURLToState: 画面 view (#80)', () => {
  const baseState = {
    searchMode: 'simple',
    simpleSearch: { category: '', keyword: '', cuisine: '', purpose: '' },
    advancedSearch: { tags: [], keyword: '', useAnd: true },
    bbox: null,
    searchSource: 'map'
  }

  it('top（既定値）はURLに書き込まれない', () => {
    const qs = encodeStateToURL({ ...baseState, screen: 'top' })
    expect(qs).not.toContain('view=')
    const plain = encodeStateToURL({ ...baseState, screen: undefined })
    expect(plain).not.toContain('view=')
  })

  it('form / list / memo / other は view パラメータとして書き込まれる', () => {
    for (const s of ['form', 'list', 'memo', 'other']) {
      const qs = encodeStateToURL({ ...baseState, screen: s })
      expect(new URLSearchParams(qs).get('view')).toBe(s)
    }
  })

  it('view のみ（検索条件なし）でもデコードされて画面が復元される', () => {
    const decoded = decodeURLToState('?view=memo')
    expect(decoded).not.toBeNull()
    expect(decoded.screen).toBe('memo')
    expect(decoded.simpleSearch).toBeUndefined()
  })

  it('view と検索条件が共存するURLでも両方正しく復元される', () => {
    const decoded = decodeURLToState('?view=form&c=cafe&k=コーヒー')
    expect(decoded.screen).toBe('form')
    expect(decoded.simpleSearch).toEqual({ category: 'cafe', keyword: 'コーヒー', cuisine: '', purpose: '' })
  })

  it('view=top が明示されていても screen=top に復元される', () => {
    const decoded = decodeURLToState('?view=top&c=cafe')
    expect(decoded.screen).toBe('top')
    expect(decoded.simpleSearch.category).toBe('cafe')
  })

  it('無効な view 値は無視される（画面は復元されない）', () => {
    const decoded = decodeURLToState('?view=xyz')
    expect(decoded).toBeNull()
    const withCond = decodeURLToState('?view=xyz&c=cafe')
    expect(withCond.screen).toBeUndefined()
    expect(withCond.simpleSearch.category).toBe('cafe')
  })

  it('generateShareURL に画面が含まれる', () => {
    const url = generateShareURL({ ...baseState, screen: 'form' })
    expect(new URLSearchParams(url.split('?')[1]).get('view')).toBe('form')
    const urlTop = generateShareURL({ ...baseState, screen: 'top' })
    expect(urlTop).not.toContain('view=')
  })
})
