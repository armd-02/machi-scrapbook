import { isValidBbox } from './searchBbox'

export const PLACE_HISTORY_KEY = 'machi-place-history-v1'
const MAX_PLACES = 10

function validPlace(entry) {
  return typeof entry?.query === 'string' && Boolean(entry.query.trim())
    && typeof entry.displayName === 'string' && Boolean(entry.displayName.trim())
    && isValidBbox(entry.bbox)
    && ['geocode', 'municipality'].includes(entry.bbox.source)
}

export function loadPlaceHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLACE_HISTORY_KEY))
    return Array.isArray(stored) ? stored.filter(validPlace).slice(0, MAX_PLACES) : []
  } catch {
    return []
  }
}

export function rememberPlace(history, entry) {
  if (!validPlace(entry)) return history
  const samePlace = (place) => place.displayName === entry.displayName
    && ['south', 'west', 'north', 'east'].every((edge) => place.bbox[edge] === entry.bbox[edge])
  const next = [entry, ...history.filter((place) => !samePlace(place))].slice(0, MAX_PLACES)
  try {
    localStorage.setItem(PLACE_HISTORY_KEY, JSON.stringify(next))
  } catch {
    // 保存を拒否されても、このページでの地名検索や履歴表示は続ける。
  }
  return next
}
