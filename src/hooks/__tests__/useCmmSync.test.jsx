// @vitest-environment jsdom
/**
 * (CMM同期、ピースC) useCmmSync フックのテスト
 *
 * syncMemos（cmmSync.js）だけをモックし、フック側の「結果適用・状態管理・
 * 最終同期時刻の保存」を検証する。ネットワークにはアクセスしない。
 *
 * 検証内容:
 * - runSync は 現在のメモ・ブック・墓碑・認証情報・lastSyncAt を syncMemos に渡す
 * - created/updated → 対応するメモに cmmId と cmmUpdatedAt が保存される
 * - deleted → 墓碑リストから除去され、その cmmId を持つメモの cmmId もクリアされる
 * - imported update-memo → 既存メモにリモートの新しい内容が反映される
 * - imported new-memo → 共有メモとして追加される
 * - new-memo で未知のブック名（createBook）→ 新しいブックが作成され公開される
 * - new-memo でキーが重複 → 追加されない
 * - lastSyncAt → localStorage（machi-cmm-last-sync-v1）に保存され state へ反映
 * - syncMemos が例外を投げたら → 空の結果＋errors にエラー、lastSyncAt は更新されない
 * - 認証情報は localStorage に保存されない（呼び出し引数として一度だけ渡される）
 * - syncing フラグが同期実行中に true、完了後に false
 * - dismissResult で結果がクリアされる
 * - loadLastSyncAt / saveLastSyncAt のユニット挙動
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCmmSync, CMM_LAST_SYNC_KEY, loadLastSyncAt, saveLastSyncAt } from '../useCmmSync'
import { syncMemos, CmmError } from '../../utils/cmmSync'
import { resetMemochoStore } from '../useMemocho'
import { resetScrapbooksStore } from '../useScrapbooks'
import { loadMemocho, MEMOCHO_STORAGE_KEY } from '../../utils/memocho'
import { loadScrapbooks, SCRAPBOOKS_STORAGE_KEY } from '../../utils/scrapbooks'
import { CMM_TOMBSTONE_KEY, loadCmmTombstones } from '../../utils/cmmTombstones'

vi.mock('../../utils/cmmSync', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, syncMemos: vi.fn() }
})

function makeMemo(overrides = {}) {
  return {
    type: 'node',
    id: 1001,
    name: 'テスト珈琲店',
    lat: 34.85,
    lon: 135.5,
    memo: '',
    rating: 0,
    bookId: 'default',
    ...overrides,
  }
}

function seedMemos(items) {
  localStorage.setItem(MEMOCHO_STORAGE_KEY, JSON.stringify(items))
}

function seedBooks(books) {
  localStorage.setItem(SCRAPBOOKS_STORAGE_KEY, JSON.stringify(books))
}

function seedTombstones(ids) {
  localStorage.setItem(CMM_TOMBSTONE_KEY, JSON.stringify(ids))
}

const okResult = (overrides = {}) => ({
  created: [],
  updated: [],
  deleted: [],
  imported: [],
  errors: [],
  lastSyncAt: '2026-01-18T14:32:00Z',
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  resetMemochoStore()
  resetScrapbooksStore()
  vi.clearAllMocks()
  syncMemos.mockResolvedValue(okResult())
})

afterEach(() => {
  localStorage.clear()
  resetMemochoStore()
  resetScrapbooksStore()
  vi.restoreAllMocks()
})

describe('runSync の引数', () => {
  it('現在のメモ・ブック・墓碑・認証情報・lastSyncAt を syncMemos に渡す', async () => {
    seedMemos([makeMemo()])
    seedBooks([{ id: 'default', name: 'デフォルト', createdAt: '2026-01-01T00:00:00Z', public: true }])
    seedTombstones(['act/9'])

    const { result } = renderHook(() => useCmmSync())
    await act(async () => {
      await result.current.runSync({ username: 'user', password: 'pass' })
    })

    expect(syncMemos).toHaveBeenCalledTimes(1)
    expect(syncMemos).toHaveBeenCalledWith({
      memos: expect.arrayContaining([expect.objectContaining({ type: 'node', id: 1001 })]),
      books: expect.arrayContaining([expect.objectContaining({ id: 'default', public: true })]),
      tombstones: ['act/9'],
      credentials: { username: 'user', password: 'pass' },
      lastSyncAt: null,
    })
  })

  it('localStorage に保存済みの最終同期時刻を lastSyncAt として渡す', async () => {
    localStorage.setItem(CMM_LAST_SYNC_KEY, JSON.stringify('2026-01-01T00:00:00Z'))
    const { result } = renderHook(() => useCmmSync())
    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })
    expect(syncMemos).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncAt: '2026-01-01T00:00:00Z' })
    )
  })
})

describe('同期結果の適用', () => {
  it('created → 対応するメモに cmmId と cmmUpdatedAt が保存される', async () => {
    seedMemos([makeMemo()])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({ created: [{ id: 'act/11', osmid: 'node/1001', updated_at: '2026-01-18T14:32:00Z' }] })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 1001)
    expect(item.cmmId).toBe('act/11')
    expect(item.cmmUpdatedAt).toBe('2026-01-18T14:32:00Z')
  })

  it('updated → 同様に cmmId と cmmUpdatedAt が保存される', async () => {
    seedMemos([makeMemo({ cmmId: 'act/12' })])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({ updated: [{ id: 'act/12', osmid: 'node/1001', updated_at: '2026-01-19T00:00:00Z' }] })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 1001)
    expect(item.cmmId).toBe('act/12')
    expect(item.cmmUpdatedAt).toBe('2026-01-19T00:00:00Z')
  })

  it('deleted → 墓碑リストから除去され、その cmmId を持つメモの cmmId もクリアされる', async () => {
    seedMemos([makeMemo({ cmmId: 'act/5' })])
    seedTombstones(['act/5', 'act/9'])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(okResult({ deleted: ['act/5'] }))

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    expect(loadCmmTombstones()).toEqual(['act/9'])
    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 1001)
    expect(item.cmmId).toBe('')
  })

  it('imported update-memo → 既存メモにリモートの新しい内容が反映される', async () => {
    seedMemos([makeMemo()])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'update-memo',
            key: 'node/1001',
            cmmId: 'act/21',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '改名珈琲店',
            memo: 'リモートのメモ',
            rating: 4,
            bookName: 'デフォルト',
            bookId: 'default',
            createBook: false,
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 1001)
    expect(item.name).toBe('改名珈琲店')
    expect(item.memo).toBe('リモートのメモ')
    expect(item.rating).toBe(4)
    expect(item.cmmId).toBe('act/21')
    expect(item.cmmUpdatedAt).toBe('2026-02-01T00:00:00Z')
  })

  it('imported new-memo → 共有メモとして追加される', async () => {
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'new-memo',
            key: 'way/2002',
            cmmId: 'act/31',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '遠くの公園',
            memo: '',
            rating: 0,
            bookName: 'デフォルト',
            bookId: 'default',
            createBook: false,
            lat: 35.0,
            lon: 135.77,
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const items = loadMemocho()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'way',
      id: 2002,
      name: '遠くの公園',
      lat: 35.0,
      lon: 135.77,
      bookId: 'default',
      cmmId: 'act/31',
      cmmUpdatedAt: '2026-02-01T00:00:00Z',
    })
  })

  it('(ピースG0) imported new-memo に tags がある → メモに tags が保存される', async () => {
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'new-memo',
            key: 'node/3003',
            cmmId: 'act/41',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '喫茶店',
            memo: '',
            rating: 0,
            bookName: 'デフォルト',
            bookId: 'default',
            createBook: false,
            lat: 35.0,
            lon: 135.77,
            tags: { amenity: 'cafe', 'name:ja': '喫茶店' },
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 3003)
    expect(item).toMatchObject({ name: '喫茶店', cmmId: 'act/41' })
    expect(item.tags).toEqual({ amenity: 'cafe', 'name:ja': '喫茶店' })
  })

  it('(ピースG0) imported new-memo に tags が無さ → 従来どおり tags: null', async () => {
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'new-memo',
            key: 'node/3004',
            cmmId: 'act/42',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '旧投稿',
            memo: '',
            rating: 0,
            bookName: 'デフォルト',
            bookId: 'default',
            createBook: false,
            lat: 35.0,
            lon: 135.77,
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 3004)
    expect(item.tags).toBeNull()
  })

  it('(ピースG0) imported update-memo に tags がある → 既存メモの tags が更新される', async () => {
    seedMemos([makeMemo({ tags: { amenity: 'cafe' } })])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'update-memo',
            key: 'node/1001',
            cmmId: 'act/21',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '改名珈琲店',
            memo: 'リモートのメモ',
            rating: 4,
            bookName: 'デフォルト',
            bookId: 'default',
            createBook: false,
            tags: { amenity: 'cafe', wheelchair: 'yes' },
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 1001)
    expect(item.tags).toEqual({ amenity: 'cafe', wheelchair: 'yes' })
  })

  it('(ピースG0) imported update-memo に tags が無さ → ローカル側の tags は維持される', async () => {
    seedMemos([makeMemo({ tags: { amenity: 'cafe' } })])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'update-memo',
            key: 'node/1001',
            cmmId: 'act/21',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '改名珈琲店',
            memo: 'リモートのメモ',
            rating: 4,
            bookName: 'デフォルト',
            bookId: 'default',
            createBook: false,
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const item = loadMemocho().find((it) => it.type === 'node' && it.id === 1001)
    expect(item.name).toBe('改名珈琲店')
    expect(item.tags).toEqual({ amenity: 'cafe' })
  })

  it('new-memo で未知のブック名（createBook）→ 新しいブックが作成され公開される', async () => {
    seedBooks([{ id: 'default', name: 'デフォルト', createdAt: '2026-01-01T00:00:00Z', public: false }])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'new-memo',
            key: 'way/2002',
            cmmId: 'act/31',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '遠くの公園',
            memo: '',
            rating: 0,
            bookName: 'ハイキング',
            bookId: null,
            createBook: true,
            lat: 35.0,
            lon: 135.77,
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const books = loadScrapbooks()
    const hiking = books.find((b) => b.name === 'ハイキング')
    expect(hiking).toBeTruthy()
    expect(hiking.public).toBe(true)
    const item = loadMemocho().find((it) => it.type === 'way' && it.id === 2002)
    expect(item.bookId).toBe(hiking.id)
  })

  // (ピースH) 上限（100冊）に達していて新規ブックが作れない場合、
  // メモは取り込まれ「デフォルト」に入る
  it('new-memo（createBook）で上限（100冊）に達している → ブックは作られずメモは「デフォルト」に入る', async () => {
    // デフォルト＋99冊（合計100冊）をシード
    const books = [{ id: 'default', name: 'デフォルト', createdAt: '2026-01-01T00:00:00Z', public: false }]
    for (let i = 1; i < 100; i += 1) {
      books.push({ id: `sb_${String(i).padStart(3, '0')}`, name: `カテゴリ${i}`, createdAt: null, public: false })
    }
    seedBooks(books)
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'new-memo',
            key: 'way/2002',
            cmmId: 'act/31',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '遠くの公園',
            memo: '',
            rating: 0,
            bookName: 'ハイキング',
            bookId: null,
            createBook: true,
            lat: 35.0,
            lon: 135.77,
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    // ブックは100冊のまま（「ハイキング」は作られない）
    const storedBooks = loadScrapbooks()
    expect(storedBooks).toHaveLength(100)
    expect(storedBooks.some((b) => b.name === 'ハイキング')).toBe(false)
    // メモは「デフォルト」に追加される
    const item = loadMemocho().find((it) => it.type === 'way' && it.id === 2002)
    expect(item).toBeTruthy()
    expect(item.bookId).toBe('default')
    expect(item.cmmId).toBe('act/31')
  })

  it('new-memo でキーが重複 → 追加されない', async () => {
    seedMemos([makeMemo({ type: 'way', id: 2002, name: '既存の公園' })])
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockResolvedValue(
      okResult({
        imported: [
          {
            type: 'new-memo',
            key: 'way/2002',
            cmmId: 'act/31',
            cmmUpdatedAt: '2026-02-01T00:00:00Z',
            name: '遠くの公園',
            memo: '',
            rating: 0,
            bookName: 'デフォルト',
            bookId: 'default',
            createBook: false,
            lat: 35.0,
            lon: 135.77,
          },
        ],
      })
    )

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    const items = loadMemocho()
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('既存の公園')
  })
})

describe('最終同期時刻', () => {
  it('成功したら localStorage（machi-cmm-last-sync-v1）に保存され state へ反映される', async () => {
    const { result } = renderHook(() => useCmmSync())
    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    expect(loadLastSyncAt()).toBe('2026-01-18T14:32:00Z')
    expect(JSON.parse(localStorage.getItem(CMM_LAST_SYNC_KEY))).toBe('2026-01-18T14:32:00Z')
    expect(result.current.lastSyncAt).toBe('2026-01-18T14:32:00Z')
  })

  it('saveLastSyncAt(null) だと何も保存されない', () => {
    saveLastSyncAt(null)
    expect(localStorage.getItem(CMM_LAST_SYNC_KEY)).toBeNull()
    expect(loadLastSyncAt()).toBeNull()
  })

  it('壊れた保存値は loadLastSyncAt が null で返す', () => {
    localStorage.setItem(CMM_LAST_SYNC_KEY, '{壊れたJSON')
    expect(loadLastSyncAt()).toBeNull()
  })
})

describe('エラー時の挙動', () => {
  it('syncMemos が CmmError を投げたら → 空の結果＋errors、lastSyncAt は更新されない', async () => {
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockRejectedValue(new CmmError({ kind: 'auth', message: '認証に失敗しました' }))

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'wrong' })
    })

    expect(result.current.status).toBe('done')
    expect(result.current.result.errors).toEqual([
      expect.objectContaining({ kind: 'auth', message: '認証に失敗しました' }),
    ])
    expect(result.current.lastSyncAt).toBeNull()
    expect(localStorage.getItem(CMM_LAST_SYNC_KEY)).toBeNull()
  })

  it('syncMemos が network エラーを投げても runSync 自体は投げない', async () => {
    const { result } = renderHook(() => useCmmSync())
    syncMemos.mockRejectedValue(new CmmError({ kind: 'network', message: '通信エラー' }))

    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })

    expect(result.current.result.errors).toEqual([expect.objectContaining({ kind: 'network' })])
  })
})

describe('状態管理', () => {
  it('syncing フラグが同期実行中に true、完了後に false になる', async () => {
    let resolveSync
    syncMemos.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = () => resolve(okResult())
        })
    )
    const { result } = renderHook(() => useCmmSync())

    let pending
    act(() => {
      pending = result.current.runSync({ username: 'u', password: 'p' })
    })
    await waitFor(() => expect(result.current.syncing).toBe(true))

    await act(async () => {
      resolveSync()
      await pending
    })
    expect(result.current.syncing).toBe(false)
    expect(result.current.status).toBe('done')
  })

  it('dismissResult で結果がクリアされ idle に戻る', async () => {
    const { result } = renderHook(() => useCmmSync())
    await act(async () => {
      await result.current.runSync({ username: 'u', password: 'p' })
    })
    expect(result.current.result).not.toBeNull()

    act(() => {
      result.current.dismissResult()
    })
    expect(result.current.result).toBeNull()
    expect(result.current.status).toBe('idle')
  })

  it('認証情報は localStorage に保存されない', async () => {
    const { result } = renderHook(() => useCmmSync())
    await act(async () => {
      await result.current.runSync({ username: 'someuser', password: 'super-secret-pass' })
    })

    for (const [key, value] of Object.entries(localStorage)) {
      expect(value).not.toContain('super-secret-pass')
    }
    expect(localStorage.getItem('machi-cmm-credentials')).toBeNull()
  })
})
