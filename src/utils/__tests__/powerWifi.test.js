// @vitest-environment jsdom
/**
 * (作業スペース系 電源・Wi-Fi) src/utils/powerWifi.js のテスト
 *
 * 電源・Wi-Fi の 3状態判定（'yes' / 'no' / 'unknown'＝未登録）の単体テスト。
 * 判定基準（指示どおり）:
 * - Wi-Fi: あり＝internet_access が設定されていて（非空）'no' でない、
 *          無し＝'no'、それ以外は未登録
 * - 電源:  あり＝power_supply が 'yes' または socket 系キー（socket /
 *          socket:*）が 'no' 以外（非空）、無し＝power_supply 'no' または
 *          socket 'no'、それ以外は未登録（yes が優先）
 *
 * 取得側の変更は不要（Overpass の out body がタグ一式を返す）ため、
 * ここは純粋関数のみを検証する。表示・集計の結合テストは後の指示で追加する。
 */
import { describe, it, expect } from 'vitest'
import { wifiStatus, powerStatus, powerWifiStatus, isWorkspaceFacility, summarizeWorkspacePowerWifi } from '../powerWifi'

describe('wifiStatus（internet_access の 3状態判定）', () => {
  it("設定されていて 'no' でない値は 'yes'（あり）", () => {
    for (const v of ['wlan', 'wireless', 'wired', 'yes', 'proprietary', 'pay', 'terminal']) {
      expect(wifiStatus({ internet_access: v })).toBe('yes')
    }
  })

  it("'no' は 'no'（なし）", () => {
    expect(wifiStatus({ internet_access: 'no' })).toBe('no')
  })

  it('未設定・空文字は「unknown」（未登録）', () => {
    expect(wifiStatus({})).toBe('unknown')
    expect(wifiStatus({ amenity: 'cafe' })).toBe('unknown')
    expect(wifiStatus({ internet_access: '' })).toBe('unknown')
  })

  it('非文字列の値は未登録扱い', () => {
    expect(wifiStatus({ internet_access: 1 })).toBe('unknown')
  })

  it('tags が無い（null/undefined）場合は「unknown」・例外にならない', () => {
    expect(wifiStatus(null)).toBe('unknown')
    expect(wifiStatus(undefined)).toBe('unknown')
  })
})

describe('powerStatus（power_supply ＋ socket 系キーの 3状態判定）', () => {
  it("power_supply が 'yes' であれば 'yes'（socket 関係なく）", () => {
    expect(powerStatus({ power_supply: 'yes' })).toBe('yes')
    expect(powerStatus({ power_supply: 'yes', socket: 'no' })).toBe('yes') // yes が優先
  })

  it("socket が 'no' 以外（非空）の値なら 'yes'", () => {
    expect(powerStatus({ socket: 'yes' })).toBe('yes')
    expect(powerStatus({ socket: '2' })).toBe('yes')
    expect(powerStatus({ socket: 'wired' })).toBe('yes')
  })

  it("socket 系サブキー（'socket:' 始まり）が 'no' 以外（非空）なら 'yes'", () => {
    expect(powerStatus({ 'socket:count': '4' })).toBe('yes')
    expect(powerStatus({ 'socket:type': 'AC' })).toBe('yes')
    expect(powerStatus({ 'socket:position': 'tables' })).toBe('yes')
  })

  it("power_supply が 'no' のみなら 'no'（なし）", () => {
    expect(powerStatus({ power_supply: 'no' })).toBe('no')
  })

  it("socket が 'no' のみなら 'no'（なし）", () => {
    expect(powerStatus({ socket: 'no' })).toBe('no')
  })

  it("yes と no の両方に該当する場合は 'yes' が優先", () => {
    // socket='no' だが socket 系サブキーが 'no' 以外 → yes
    expect(powerStatus({ socket: 'no', 'socket:count': '2' })).toBe('yes')
    // power_supply='no' だが socket 系が 'no' 以外 → yes
    expect(powerStatus({ power_supply: 'no', 'socket:count': '2' })).toBe('yes')
  })

  it('電源系タグが未設定・空文字なら「unknown」（未登録）', () => {
    expect(powerStatus({})).toBe('unknown')
    expect(powerStatus({ amenity: 'library' })).toBe('unknown')
    expect(powerStatus({ socket: '' })).toBe('unknown')
    expect(powerStatus({ 'socket:count': '' })).toBe('unknown')
    expect(powerStatus({ power_supply: '' })).toBe('unknown')
  })

  it("power_supply の 'no' 以外の値（'batteries' 等）は単独では何も意味しない", () => {
    expect(powerStatus({ power_supply: 'batteries' })).toBe('unknown')
    expect(powerStatus({ power_supply: 'usb' })).toBe('unknown')
  })

  it('非文字列の値は登録済みと数えない', () => {
    expect(powerStatus({ socket: 2 })).toBe('unknown')
    expect(powerStatus({ 'socket:count': 4 })).toBe('unknown')
  })

  it('tags が無い（null/undefined）場合は「unknown」・例外にならない', () => {
    expect(powerStatus(null)).toBe('unknown')
    expect(powerStatus(undefined)).toBe('unknown')
  })

  it('socket 系サブキーが値 "no" の場合: "yes" でも "no" でも数えない（"no" 判定は主キーのみ）', () => {
    // サブキー単独で 'no' → 未登録（unknown）
    expect(powerStatus({ 'socket:count': 'no' })).toBe('unknown')
    // サブキー 'no' ＋ socket 'no' → 'no'（no は主キー socket 由来）
    expect(powerStatus({ socket: 'no', 'socket:count': 'no' })).toBe('no')
    // サブキー 'no' ＋ power_supply 'no' → 'no'
    expect(powerStatus({ power_supply: 'no', 'socket:type': 'no' })).toBe('no')
    // 対照: サブキー 'no' と他のサブキーが 'no' 以外 → 'yes'（yes が優先）
    expect(powerStatus({ 'socket:count': 'no', 'socket:type': 'AC' })).toBe('yes')
  })

  it('非文字列の power_supply は判定に影響しない（"yes"/"no" の完全一致のみ）', () => {
    expect(powerStatus({ power_supply: 1 })).toBe('unknown')
    expect(powerStatus({ power_supply: 1, socket: 'yes' })).toBe('yes')
    expect(powerStatus({ power_supply: 0, socket: 'no' })).toBe('no')
  })
})

describe('powerWifiStatus（まとめ関数）', () => {
  it('両方の状況を返す', () => {
    expect(powerWifiStatus({ internet_access: 'wlan', socket: 'yes' })).toEqual({ power: 'yes', wifi: 'yes' })
    expect(powerWifiStatus({ internet_access: 'no', power_supply: 'no' })).toEqual({ power: 'no', wifi: 'no' })
    expect(powerWifiStatus({})).toEqual({ power: 'unknown', wifi: 'unknown' })
  })

  it('電源・Wi-Fi は独立に判定される（片方だけ登録されたケース）', () => {
    expect(powerWifiStatus({ internet_access: 'wlan' })).toEqual({ power: 'unknown', wifi: 'yes' })
    expect(powerWifiStatus({ 'socket:count': '2' })).toEqual({ power: 'yes', wifi: 'unknown' })
    expect(powerWifiStatus({ internet_access: 'no', socket: 'yes' })).toEqual({ power: 'yes', wifi: 'no' })
  })

  it('tags が無い場合は両方「unknown」', () => {
    expect(powerWifiStatus(null)).toEqual({ power: 'unknown', wifi: 'unknown' })
    expect(powerWifiStatus(undefined)).toEqual({ power: 'unknown', wifi: 'unknown' })
  })
})

describe('isWorkspaceFacility（電源・Wi-Fi 表示の対象施設判定）', () => {
  it('4種の条件のいずれかに一致すれば true（OR 結合）', () => {
    expect(isWorkspaceFacility({ amenity: 'cafe' })).toBe(true)
    expect(isWorkspaceFacility({ amenity: 'library' })).toBe(true)
    expect(isWorkspaceFacility({ amenity: 'internet_cafe' })).toBe(true)
    expect(isWorkspaceFacility({ office: 'coworking' })).toBe(true)
    // 複数条件が同時に成り立っても true
    expect(isWorkspaceFacility({ amenity: 'cafe', office: 'coworking' })).toBe(true)
  })

  it('対象外は false（レストラン・コンビニ・他の amenity/office）', () => {
    expect(isWorkspaceFacility({ amenity: 'restaurant' })).toBe(false)
    expect(isWorkspaceFacility({ amenity: 'fast_food' })).toBe(false)
    expect(isWorkspaceFacility({ amenity: 'bar' })).toBe(false)
    expect(isWorkspaceFacility({ amenity: 'public_building' })).toBe(false)
    expect(isWorkspaceFacility({ amenity: 'community_centre' })).toBe(false)
    expect(isWorkspaceFacility({ amenity: 'internet_café' })).toBe(false) // 異符号・部分一致は不可
    expect(isWorkspaceFacility({ office: 'company' })).toBe(false)
    expect(isWorkspaceFacility({ office: 'education' })).toBe(false)
    expect(isWorkspaceFacility({ shop: 'cafe' })).toBe(false) // shop 側のカフェは対象外
  })

  it('値は完全一致（大小文字・前後空白に敏感）', () => {
    expect(isWorkspaceFacility({ amenity: 'Cafe' })).toBe(false)
    expect(isWorkspaceFacility({ amenity: ' cafe' })).toBe(false)
    expect(isWorkspaceFacility({ office: 'Coworking' })).toBe(false)
  })

  it('tags が無い（null/undefined）場合は false・例外にならない', () => {
    expect(isWorkspaceFacility(null)).toBe(false)
    expect(isWorkspaceFacility(undefined)).toBe(false)
    expect(isWorkspaceFacility({})).toBe(false)
  })
})

describe('summarizeWorkspacePowerWifi（対象施設の電源・Wi-Fi 集計）', () => {
  const mk = (id, tags) => ({ type: 'node', id, tags })

  it('対象施設が0件のときは null（集計自体を表示しない）', () => {
    expect(summarizeWorkspacePowerWifi([])).toBeNull()
    expect(summarizeWorkspacePowerWifi(null)).toBeNull()
    expect(summarizeWorkspacePowerWifi([mk(1, { amenity: 'restaurant' }), mk(2, { shop: 'convenience' })])).toBeNull()
  })

  it('母数は対象施設のみ（対象外は母数・集計両方から除外）', () => {
    const results = [
      mk(1, { amenity: 'cafe', internet_access: 'wlan' }),         // 対象・wifi あり
      mk(2, { amenity: 'restaurant', internet_access: 'wlan' }),   // 対象外・除外
      mk(3, { amenity: 'cafe' }),                                   // 対象・両方未登録
    ]
    const s = summarizeWorkspacePowerWifi(results)
    expect(s.total).toBe(2)
    expect(s.wifiPresent).toBe(1)
    expect(s.wifiPct).toBe(50)
    expect(s.powerPresent).toBe(0)
    expect(s.powerPct).toBe(0)
  })

  it('「あり」は "yes" のみをカウント（"no"・未登録は数えない）', () => {
    const results = [
      mk(1, { amenity: 'library', internet_access: 'wlan' }),  // wifi あり
      mk(2, { amenity: 'library', internet_access: 'no' }),    // wifi なし
      mk(3, { amenity: 'library' }),                           // wifi 未登録
      mk(4, { amenity: 'cafe', power_supply: 'yes' }),         // 電源 あり
      mk(5, { amenity: 'cafe', power_supply: 'no' }),          // 電源 なし
    ]
    const s = summarizeWorkspacePowerWifi(results)
    expect(s.total).toBe(5)
    expect(s.wifiPresent).toBe(1)
    expect(s.wifiPct).toBe(20)
    expect(s.powerPresent).toBe(1)
    expect(s.powerPct).toBe(20)
  })

  it('全件ありなら 100%', () => {
    const s = summarizeWorkspacePowerWifi([
      mk(1, { amenity: 'cafe', internet_access: 'wlan', socket: 'yes' }),
      mk(2, { amenity: 'library', internet_access: 'wired', 'socket:count': '2' }),
    ])
    expect(s).toEqual({ total: 2, powerPresent: 2, powerPct: 100, wifiPresent: 2, wifiPct: 100 })
  })

  it('割合は四捨五入（1/3 → 33%）', () => {
    const s = summarizeWorkspacePowerWifi([
      mk(1, { amenity: 'cafe', internet_access: 'wlan' }),
      mk(2, { amenity: 'cafe' }),
      mk(3, { amenity: 'cafe' }),
    ])
    expect(s.wifiPct).toBe(33)
  })

  it('配列内の null 要素は無視され例外にならない', () => {
    const s = summarizeWorkspacePowerWifi([null, mk(1, { amenity: 'cafe', internet_access: 'wlan' }), undefined])
    expect(s.total).toBe(1)
    expect(s.wifiPresent).toBe(1)
  })

  it('割合の丸め境界（x.5 は切り上げ: 1/8 → 13% / 2/3 → 67%）', () => {
    const s1 = summarizeWorkspacePowerWifi([
      mk(1, { amenity: 'cafe', internet_access: 'wlan' }),
      mk(2, { amenity: 'cafe' }),
      mk(3, { amenity: 'cafe' }),
      mk(4, { amenity: 'cafe' }),
      mk(5, { amenity: 'cafe' }),
      mk(6, { amenity: 'cafe' }),
      mk(7, { amenity: 'cafe' }),
      mk(8, { amenity: 'cafe' }),
    ])
    expect(s1.wifiPct).toBe(13) // 1/8 = 12.5% → Math.round → 13
    const s2 = summarizeWorkspacePowerWifi([
      mk(1, { amenity: 'cafe', internet_access: 'wlan' }),
      mk(2, { amenity: 'cafe', internet_access: 'wired' }),
      mk(3, { amenity: 'cafe' }),
    ])
    expect(s2.wifiPct).toBe(67) // 2/3 = 66.67% → 67
  })
})
