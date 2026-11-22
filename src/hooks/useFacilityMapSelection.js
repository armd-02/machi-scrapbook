import { useCallback, useEffect, useMemo, useState } from 'react'
import { memochoKeyOf } from '../utils/memocho'

// 施設カードと地図のピンで、選択状態を共有する。
export function useFacilityMapSelection(visibleItems, resetKey) {
  const [selection, setSelection] = useState(null)
  const visibleKeys = useMemo(() => new Set(visibleItems.map(memochoKeyOf)), [visibleItems])
  const visibleSelection = visibleKeys.has(selection?.key) ? selection : null

  useEffect(() => {
    setSelection(null)
  }, [resetKey])
  useEffect(() => {
    if (selection && !visibleSelection) setSelection(null)
  }, [selection, visibleSelection])

  const selectFacility = (item, geometry) => {
    const key = memochoKeyOf(item)
    const next = geometry ? { key, geometry } : { key, lon: item.lon, lat: item.lat }
    setSelection((previous) => previous?.key === key ? null : next)
  }
  const selectPin = useCallback((item) => {
    const key = memochoKeyOf(item)
    if (!visibleKeys.has(key)) return null
    setSelection({ key })
    return key
  }, [visibleKeys])

  return { selection: visibleSelection, selectedKey: visibleSelection?.key, selectFacility, selectPin }
}
