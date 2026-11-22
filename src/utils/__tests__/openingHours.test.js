/**
 * opening_hours 日本語化（表示用）のテスト
 *
 * 変換例・フォールバック・空入力の挙動を確認する。
 * データ自体（元の opening_hours 値）は変更しない。表示のみ変換する。
 */
import { describe, it, expect } from 'vitest'
import { formatOpeningHoursJa } from '../openingHours'

describe('formatOpeningHoursJa', () => {
  it('複数行表示では曜日区分ごとに改行し、同じ曜日の複数の時間帯はまとめる', () => {
    expect(formatOpeningHoursJa(
      'Mo-Th 14:00-02:00, Fr-Sa 14:00-03:00, Su 13:00-24:00; PH 09:00-12:00,13:00-17:00',
      { multiline: true },
    )).toBe('月〜木 14:00〜2:00\n金〜土 14:00〜3:00\n日 13:00〜24:00\n祝日 9:00〜12:00,13:00〜17:00')
  })

  it('空・null・undefined はそのまま返す（呼び出し側の truthy 判定を壊さない）', () => {
    expect(formatOpeningHoursJa('')).toBe('')
    expect(formatOpeningHoursJa(null)).toBeNull()
    expect(formatOpeningHoursJa(undefined)).toBeUndefined()
  })

  it('曜日範囲: Mo-Fr → 月〜金', () => {
    expect(formatOpeningHoursJa('Mo-Fr')).toBe('月〜金')
  })

  it('曜日範囲+時刻範囲: 時の先行ゼロを取る', () => {
    expect(formatOpeningHoursJa('Mo-Fr 09:00-17:00')).toBe('月〜金 9:00〜17:00')
  })

  it('複数ルールは;で分割し、／でつなぐ', () => {
    expect(formatOpeningHoursJa('Mo-Fr 09:00-17:00; Sa 09:00-12:00')).toBe(
      '月〜金 9:00〜17:00／土 9:00〜12:00'
    )
  })

  it('カンマ区切りの曜日は・でつなぐ', () => {
    expect(formatOpeningHoursJa('Sa,Su 10:00-15:00')).toBe('土・日 10:00〜15:00')
  })

  it('PH off → 祝日 休み', () => {
    expect(formatOpeningHoursJa('PH off')).toBe('祝日 休み')
  })

  it('24/7 → 24時間営業', () => {
    expect(formatOpeningHoursJa('24/7')).toBe('24時間営業')
    // 複合値の中にある 24/7 ルールも変換される
    expect(formatOpeningHoursJa('Mo 12:00; 24/7')).toBe('月 12:00／24時間営業')
  })

  it('時刻の後ろの+（HH:MM+）は「〜」で結ぶ', () => {
    expect(formatOpeningHoursJa('Mo 09:00+')).toBe('月 9:00〜')
  })

  it('変換できない複雑な構文は原文のまま（フォールバック）', () => {
    // 月名を含む
    expect(formatOpeningHoursJa('Jan-Mar Mo 09:00-17:00')).toBe('Jan-Mar Mo 09:00-17:00')
    // week 指定
    expect(formatOpeningHoursJa('week 1 Mo 09:00-17:00')).toBe('week 1 Mo 09:00-17:00')
    // sunrise/sunset
    expect(formatOpeningHoursJa('sunrise-sunset')).toBe('sunrise-sunset')
    // 引用符コメント
    expect(formatOpeningHoursJa('Mo-Fr 09:00-17:00 "lunch break"')).toBe(
      'Mo-Fr 09:00-17:00 "lunch break"'
    )
  })

  it('変換できるルールとできないルールが混ざると、できない側だけ原文のまま', () => {
    // フォールバックはルールごと原文に戻す（部分的な変換は残さない）
    expect(formatOpeningHoursJa('Mo-Fr 09:00-17:00; week 1 09:00-17:00')).toBe(
      '月〜金 9:00〜17:00／week 1 09:00-17:00'
    )
  })
})
