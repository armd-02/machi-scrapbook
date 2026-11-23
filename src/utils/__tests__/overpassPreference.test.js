// @vitest-environment jsdom
/**
 * overpassPreference.js — Overpass API 第一候補エンドポイントのユーザー選択
 *
 * - 未保存・不正値・localStorage 不可の場合は既定 'custom'（標準）
 * - setOverpassPreference で保存した値が getOverpassPreference で読み戻せる
 * - 選択可能でないID（private_coffee 等）は保存されない
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  OVERPASS_PREFERENCE_KEY,
  OVERPASS_PREFERENCE_OPTIONS,
  SELECTABLE_ENDPOINTS,
  getOverpassPreference,
  setOverpassPreference
} from '../overpassPreference'
import { DEFAULT_ENDPOINT } from '../../config'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('overpassPreference: 既定値', () => {
  it('未保存の場合は既定（標準 = custom）を返す', () => {
    expect(getOverpassPreference()).toBe('custom')
    expect(DEFAULT_ENDPOINT).toBe('custom')
  })

  it('不正な値が保存されている場合は既定を返す', () => {
    localStorage.setItem(OVERPASS_PREFERENCE_KEY, 'private_coffee')
    expect(getOverpassPreference()).toBe('custom')
    localStorage.setItem(OVERPASS_PREFERENCE_KEY, 'garbage')
    expect(getOverpassPreference()).toBe('custom')
  })

  it('localStorage が使えない環境でも既定を返す（例外を投げない）', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(getOverpassPreference()).toBe('custom')
  })
})

describe('overpassPreference: 保存・読み戻し', () => {
  it('setOverpassPreference("public") で保存し、getOverpassPreference で "public" が読み戻せる', () => {
    expect(setOverpassPreference('public')).toBe(true)
    expect(localStorage.getItem(OVERPASS_PREFERENCE_KEY)).toBe('public')
    expect(getOverpassPreference()).toBe('public')
  })

  it('setOverpassPreference("custom") で既定に戻せる', () => {
    setOverpassPreference('public')
    expect(setOverpassPreference('custom')).toBe(true)
    expect(getOverpassPreference()).toBe('custom')
  })

  it('選択可能でないIDは保存されず false を返す', () => {
    expect(setOverpassPreference('private_coffee')).toBe(false)
    expect(setOverpassPreference('garbage')).toBe(false)
    expect(setOverpassPreference(null)).toBe(false)
    expect(localStorage.getItem(OVERPASS_PREFERENCE_KEY)).toBeNull()
    expect(getOverpassPreference()).toBe('custom')
  })

  it('localStorage 保存に失敗しても false を返す（例外は投げない）', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(setOverpassPreference('public')).toBe(false)
    expect(getOverpassPreference()).toBe('custom')
  })
})

describe('overpassPreference: 選択肢の定義', () => {
  it('選択可能なのは custom（標準）と public（海外）の2つのみ', () => {
    expect(SELECTABLE_ENDPOINTS).toEqual(['custom', 'public'])
  })

  it('メニュー表示オプションは「標準」= custom / 「海外」= public', () => {
    expect(OVERPASS_PREFERENCE_OPTIONS).toEqual([
      { id: 'custom', label: '標準' },
      { id: 'public', label: '海外' }
    ])
  })
})
