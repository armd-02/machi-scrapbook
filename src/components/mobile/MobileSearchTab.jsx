import React, { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { useSearch } from '../../hooks/useSearch'
import { getMapInstance } from '../../hooks/useMapRef'
import { buildSearchCriteria } from '../../utils/searchCriteria'
import { boundsToBbox } from '../../utils/searchBbox'
import { checkBboxSize, geocode } from '../../utils/geo'
import SimpleSearch from '../SimpleSearch'
import MunicipalitySearch from '../MunicipalitySearch'
import AdvancedSearch from '../AdvancedSearch'
import SearchActionButton from '../SearchActionButton'
import ShareButton from '../ShareButton'
import MapView from '../MapView'
import { QuickTopIntro, QuickTopTiles } from './MobileQuickTop'
import BarrierFreeLegend from '../BarrierFreeLegend'
import PoiDescription from '../PoiDescription'
import { useDraggableHeight, MAP_HEIGHT_STORAGE_KEY_MOBILE } from '../../hooks/useDraggableHeight'

/**
 * (#59) モバイル「検索」タブ
 *
 * 入力順（優先度順）: 1) エリア 2) 施設カテゴリ 3) 施設名・キーワード 4) 検索実行
 * - (#60) 地図モードでは画面上部に地図を表示。地図を移動・拡大することで
 *   検索範囲を同一画面で指定できる（独立した「地図」タブは廃止）
 * - (#63) 初期表示は「一般向けトップ」（QuickTopIntro + 目的タイル）。
 *   「くわしく探す」で従来の検索フォーム（view='form'）へ切替、フォーム側から
 *   「トップへ戻る」でトップへ戻れる。地図は両ビューで同一の単一インスタンス
 *   （ツリー内で安定した位置に描画するため再マウントせず、位置・範囲を引き継ぐ）。
 *   自治体モードでは地図ブロックは hidden で非表示（マウントは維持）。
 * - (top) 場所入力（QuickTopIntro）のすぐ下・地図（mapBlock）の上に「都道府県から探す」
 *   折りたたみセクション（既定は閉じた状態）。
 *   見出しタップで MunicipalitySearch（variant="mobile"：都道府県→市区町村→任意でカテゴリ等）
 *   が展開され、「検索する」で自治体モードの検索を実行する（#47 パターンを自治体モードに
 *   応用: 更新後の状態スナップショット → buildSearchCriteria → search()）。検索成功時の
 *   一覧タブ自動切替は既存の挙動のまま。
 * - 詳細条件は「条件を追加」で展開する段階的開示（AdvancedSearch）
 * - 「検索する」ボタンはスロールームの外（ヘッダー横並び方式のP0再発防止）
 * - 地図の移動でOverpass検索は実行されない（明示的な押下のみ）
 * - 検索中は「中止」でキャンセル可能
 */
export default function MobileSearchTab({ view = 'top', onViewChange = () => {}, onViewResults, onMarkerClick = null }) {
  const { state, dispatch } = useApp()
  const { search, cancel } = useSearch()
  const { searchSource, searchMode, bbox, selectedMunicipality } = state
  const [boundsVersion, setBoundsVersion] = useState(0)

  // (#63) 場所指定（クイックトップの地名入力）。親コンポーネントがview切替に
  // 関係なく同じインスタンスを維持するため、入力状態はこのコンポーネントが保持する
  const [placeQuery, setPlaceQuery] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState(null)
  const [movedName, setMovedName] = useState(null)

  // (top) 「都道府県から探す」折りたたみセクションの開閉（既定は閉じた状態）
  const [muniSectionOpen, setMuniSectionOpen] = useState(false)

  // 地名をgeocodeして地図の表示範囲を移動（既存機構の再利用: geocode + jumpTo）
  const handlePlaceMove = async () => {
    const q = placeQuery.trim()
    if (!q || moving) return
    setMoving(true)
    setMoveError(null)
    setMovedName(null)
    try {
      const result = await geocode(q)
      if (!result) {
        setMoveError('場所が見つかりませんでした。別の表記で試してください。')
        return
      }
      const map = getMapInstance()
      if (map) {
        // MapToolbarと同じ方針: 最小ズーム15で地点に寄り添う
        map.jumpTo({ center: [result.lon, result.lat], zoom: Math.max(map.getZoom(), 15) })
      }
      setMovedName(result.displayName)
      setPlaceQuery('')
    } catch (error) {
      setMoveError(error.message || '地名検索に失敗しました')
    } finally {
      setMoving(false)
    }
  }

  // (#63) 目的タイル: 目的・カテゴリ条件で即検索（成功で親がリストタブへ切替）
  const handleTileTap = (tile) => {
    if (state.status === 'loading') return
    const conditions = tile.purpose
      ? { category: '', cuisine: '', keyword: '', purpose: tile.purpose }
      : { category: tile.category, cuisine: '', keyword: '', purpose: '' }

    // トップは常に地図表示範囲で検索する。自治体モードなら先に地図モードへ切替
    if (state.searchSource !== 'map') {
      dispatch({ type: 'SET_SEARCH_SOURCE', payload: 'map' })
    }
    dispatch({ type: 'SET_SIMPLE_SEARCH', payload: conditions })

    // stale-state競合を避けるため、更新後の状態からスナップショットを構築 (#47)
    // 地図が非表示（hidden）の場合getBoundsは縮退するため、表示中のときのみ採用。
    // 非表示時は buildSearchCriteria 側で前回範囲(state.bbox)にフォールバックする
    const mapBounds = state.searchSource === 'map' ? readMapBounds() : null
    const next = {
      ...state,
      searchSource: 'map',
      simpleSearch: { ...state.simpleSearch, ...conditions }
    }
    search(buildSearchCriteria(next, mapBounds ? { mapBounds } : {}))
  }

  // (top) 自治体セクションの「検索する」: #47 パターン（更新後の状態スナップショット →
  // buildSearchCriteria → search()）を自治体モードに応用。
  // 通常はソースが municipality でセクション内の条件は既に state に反映済みなので
  // state をそのまま読む。ソースが map（目的タイルや「地図で見る」で切替された流れ）の
  // 場合は、まず municipality へ切替し、直後にセクション内で設定された条件をそのまま
  // 再dispatchして、reducer の #49 引き継ぎ（last-wins）による上書きを防ぐ。
  // これによりスナップショットと dispatch 後の状態が一致する。
  const handleMuniSectionSearch = () => {
    if (state.status === 'loading') return
    const ms = state.municipalitySearch || { category: '', keyword: '', cuisine: '', purpose: '' }
    let next = state
    if (state.searchSource !== 'municipality') {
      dispatch({ type: 'SET_SEARCH_SOURCE', payload: 'municipality' })
      dispatch({ type: 'SET_MUNICIPALITY_SEARCH', payload: { ...ms } })
      next = { ...state, searchSource: 'municipality' }
    }
    const criteria = buildSearchCriteria(next)
    if (criteria.ok !== true) return
    search(criteria)
  }
  // 地図上のマーカータップで選択されたPOI（説明枠の表示用）
  const [tappedPoi, setTappedPoi] = useState(null)
  useEffect(() => {
    if (state.status === 'success') setTappedPoi(null)
  }, [state.results, state.status])
  // 地図の高さをドラッグで変更（既定240px）。
  // 高さ変更に合わせて map.resize() を呼ぶことで、MapLibre の描画が
  // ドラッグに追随する（MapView側のResizeObserverは2重の安全策）
  const handleMapResize = () => {
    const map = getMapInstance()
    if (map && typeof map.resize === 'function') map.resize()
  }
  const mapHeight = useDraggableHeight({ defaultHeight: 240, minHeight: 160, maxHeight: 480, storageKey: MAP_HEIGHT_STORAGE_KEY_MOBILE, onResize: handleMapResize })

  const switchSource = (source) => {
    if (source === state.searchSource) return
    dispatch({ type: 'SET_SEARCH_SOURCE', payload: source })
    if (source === 'map') dispatch({ type: 'SET_MUNICIPALITY', payload: null })
  }

  const setMode = (mode) => {
    dispatch({ type: 'SET_SEARCH_MODE', payload: mode })
  }

  // 地図が動いた場合（地理コード等）に範囲情報を再計算
  // （地図のアンマウント/再マウントに追従させるため searchSource を依存に含める）
  useEffect(() => {
    if (searchSource !== 'map') return undefined
    const map = getMapInstance()
    if (!map || typeof map.on !== 'function' || typeof map.off !== 'function') return undefined
    const update = () => setBoundsVersion((v) => v + 1)
    map.on('moveend', update)
    map.on('zoomend', update)
    return () => {
      map.off('moveend', update)
      map.off('zoomend', update)
    }
  }, [searchSource])

  const isAdvanced = searchMode === 'advanced'

  // 地図の現在表示範囲を読む（生LatLngBounds。buildSearchCriteria側でBBOX変換する）
  const readMapBounds = () => {
    const map = getMapInstance()
    return map && typeof map.getBounds === 'function' ? map.getBounds() : null
  }

  // 検索条件スナップショット（ボタンの無効判定・ヒント表示用）
  // 地図インスタンスはマウント後のeffectで登録されるため、state変化の
  // 再レンダリングで初めて取得できる（元の挙動を維持）
  const criteria = useMemo(() => {
    const map = getMapInstance()
    const mapBounds =
      searchSource === 'map' && map && typeof map.getBounds === 'function' ? map.getBounds() : null
    return buildSearchCriteria(state, mapBounds ? { mapBounds } : {})
  }, [state, searchSource, boundsVersion, bbox, selectedMunicipality])

  // (top) 自治体セクション「検索する」ボタンの無効判定（自治体モードの条件スナップショット）。
  // 実行時の handleMuniSectionSearch と同じ入力（セクション内条件＋選択自治体BBOX）で判定する
  const muniCriteria = useMemo(() => {
    const next = state.searchSource === 'municipality' ? state : { ...state, searchSource: 'municipality' }
    return buildSearchCriteria(next)
  }, [state])

  // 表示用のBBOX（縮退・逆順の場合はnull＝未設定扱い）
  // 毎レンダリングで読むことで、マウント後の地図取得にも追従する
  const mapBbox = (() => {
    if (searchSource !== 'map') return null
    const map = getMapInstance()
    return map && typeof map.getBounds === 'function' ? boundsToBbox(map.getBounds()) : null
  })()

  const handleSearch = () => {
    // クリック時点で地図表示範囲を新鮮に読み取る
    const mapBounds = searchSource === 'map' ? readMapBounds() : null
    const c = buildSearchCriteria(state, mapBounds ? { mapBounds } : {})
    if (c.ok !== true) return
    search(c)
  }

  const sourceBtn = (id, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={searchSource === id}
      onClick={() => switchSource(id)}
      className={`min-h-[44px] text-sm rounded-lg transition-colors ${
        searchSource === id
          ? 'bg-white text-slate-800 shadow-sm font-medium'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  )

  // 地図ブロック（両ビュー共通・ツリー内で安定した位置＝2番目の子要素）。
  // 同一のJSX要素を同じ位置に描画し続けることで、トップ⇄フォーム切替時に
  // MapViewが再マウントされず、地図の位置・表示範囲が引き継がれる (#63)。
  // 自治体モードでは hidden で非表示（マウントは維持。表示復帰時のresizeは
  // MapView側のResizeObserverが処理する #60）
  const mapBlock = (
    <div hidden={searchSource !== 'map'} className="rounded-xl overflow-hidden border border-slate-200">
      <div className="relative h-[240px]" style={mapHeight.containerStyle}>
        <MapView
          onMarkerClick={onMarkerClick}
          onMarkerTap={(result) => {
            setTappedPoi(result)
            dispatch({ type: 'SET_ACTIVE_RESULT', payload: `${result.type}/${result.id}` })
          }}
          // (#63) トップは独自の場所入力を持つため地図上の地名ツールバーを省略
          showToolbar={view === 'form'}
        />
      </div>
      {/* 高さドラッグハンドル（PC版と同一のフック） */}
      <div
        {...mapHeight.handleProps}
        className="h-7 bg-slate-100 border-t border-slate-200 flex items-center justify-center"
      >
        <span className="w-8 h-1 rounded-full bg-slate-300" />
      </div>
    </div>
  )

  // 従来フォームの冒頭: トップへ戻る導線 ＋ 検索ソース切替 ＋（自治体モード）
  const formHeader = (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onViewChange('top')}
        className="min-h-[44px] w-full flex items-center justify-center gap-1 text-sm font-medium text-primary-600 bg-white border border-primary-200 rounded-xl hover:bg-primary-50"
      >
        ← トップへ戻る
      </button>
      <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1" role="tablist" aria-label="検索モード">
        {sourceBtn('municipality', '自治体から探す')}
        {sourceBtn('map', '地図から探す')}
      </div>
      {searchSource === 'municipality' && (
        /* エリア(都道府県・市区町村)＋カテゴリ・料理・キーワードをMunicipalitySearchが一括表示 */
        <MunicipalitySearch variant="mobile" />
      )}
    </div>
  )

  // 従来フォームの地図以降の内容（凡例・エリア・カテゴリ/キーワード・切替）
  const formBody = searchSource === 'map' && (
    <>
      {/* 凡例＋POI説明枠（横並び。狭い画面では折り返し） */}
      <div className="flex flex-wrap gap-2">
        <BarrierFreeLegend />
        <div className="flex-1 min-w-[200px]">
          <PoiDescription tappedPoi={tappedPoi} />
        </div>
      </div>

      {/* エリア */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl p-3" aria-label="検索範囲">
        <h2 className="text-[11px] font-medium text-slate-500 mb-1.5">どの街・エリアで探す？</h2>
        <AreaCard state={state} liveBounds={mapBbox} />
      </section>

      {/* カテゴリ / キーワード */}
      {isAdvanced ? <AdvancedSearch /> : <SimpleSearch variant="mobile" />}

      {/* 詳細条件の段階的開示 */}
      <button
        type="button"
        onClick={() => setMode(isAdvanced ? 'simple' : 'advanced')}
        className="w-full min-h-[44px] text-sm font-medium text-primary-600 bg-white border border-primary-200 rounded-xl hover:bg-primary-50"
      >
        {isAdvanced ? '− 簡易検索に戻る' : '＋ 条件を追加（詳細検索）'}
      </button>
    </>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
        {/* (#63) 一般向けトップ ⇄ 従来検索フォーム */}
        {view === 'top' ? (
          /* 説明・場所入力と「都道府県から探す」セクションを1つのラッパー要素にまとめる。
             これにより mapBlock はトップ・フォーム両ビューで2番目の子という安定した
             位置に描画され、トップ⇄フォーム切替時に MapView が再マウントされない (#63) */
          <div className="space-y-3">
            <QuickTopIntro
              placeQuery={placeQuery}
              onPlaceQueryChange={setPlaceQuery}
              moving={moving}
              moveError={moveError}
              movedName={movedName}
              onPlaceMove={handlePlaceMove}
              disabled={state.status === 'loading'}
            />

            {/* (top) 「都道府県から探す」入口: 折りたたみセクション（既定は閉じた状態、見出しタップで開閉）
                overflow-hidden は付けない（市区町村サジェスト一覧が position:absolute で
                セクション下端を越えて地図上に伸びるため、クリップされてしまう）。
                角丸は内部要素がパディング内で収まるため外側のクリップが不要。
                relative z-30: 地図（mapBlock）より上側の重なり順にし、サジェスト一覧が
                地図に隠れないようにする */}
            <section className="bg-white rounded-xl shadow-sm relative z-30" aria-label="都道府県から探す">
              <button
                type="button"
                onClick={() => setMuniSectionOpen((o) => !o)}
                aria-expanded={muniSectionOpen}
                className="w-full min-h-[44px] px-3 py-2 flex items-center justify-between text-sm font-medium text-slate-700"
              >
                <span>都道府県から探す</span>
                <span className="text-xs text-slate-500">{muniSectionOpen ? '▴ 閉じる' : '▾ 開く'}</span>
              </button>
              {muniSectionOpen && (
                <div className="p-3 space-y-3 border-t border-slate-100">
                  {/* 従来フォームと同一の MunicipalitySearch（モバイル変種）を内嵌 */}
                  <MunicipalitySearch variant="mobile" />
                  <button
                    type="button"
                    onClick={handleMuniSectionSearch}
                    disabled={state.status === 'loading' || muniCriteria.ok !== true}
                    className="w-full min-h-[44px] text-sm font-medium bg-primary-600 text-white rounded-lg disabled:opacity-50"
                  >
                    検索する
                  </button>
                </div>
              )}
            </section>
          </div>
        ) : (
          formHeader
        )}

        {mapBlock}

        {view === 'top' ? (
          <QuickTopTiles
            onTileTap={handleTileTap}
            onOpenDetailed={() => onViewChange('form')}
            disabled={state.status === 'loading'}
          />
        ) : (
          formBody
        )}

        <ShareButton />
      </div>

      {/* 検索実行（スロールームの外に固定 — P0 再発防止）。フォーム表示時のみ */}
      {view === 'form' && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <SearchActionButton
            fullWidth
            criteria={criteria}
            status={state.status}
            onSearch={handleSearch}
            onCancel={cancel}
            label={searchSource === 'map' ? 'この表示範囲で検索' : '検索する'}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 検索範囲カード
 * - 地図モード: 地図の現在表示範囲（liveBounds）を優先表示
 * - 地図が未準備（非表示など）の場合は前回検索範囲にフォールバック
 * - 未設定時は設定方法のヒント、範囲が大きすぎる場合は警告
 */
function AreaCard({ state, liveBounds = null }) {
  const { bbox, searchSource } = state
  const isLive = searchSource === 'map' && !!liveBounds
  const shown = isLive ? liveBounds : bbox
  const info = shown ? checkBboxSize(shown) : null
  return (
    <div className="space-y-0.5">
      <span className="text-sm text-slate-700">地図の現在表示範囲</span>
      <span className="block text-[11px] text-slate-500">
        地図を移動・拡大して、検索したい範囲を設定できます。
      </span>
      {shown && (
        <span className="block font-mono text-[10px] text-slate-400 break-all">
          {isLive ? '検索範囲: ' : '直前: '}{shown.south}, {shown.west} 〜 {shown.north}, {shown.east}
          {info && `（約${Math.round(info.areaKm2).toLocaleString()} km²）`}
        </span>
      )}
      {info && info.message && (
        <span className={`block text-[11px] ${info.tooLarge ? 'text-red-600' : 'text-amber-600'}`}>
          {info.message}
        </span>
      )}
    </div>
  )
}
