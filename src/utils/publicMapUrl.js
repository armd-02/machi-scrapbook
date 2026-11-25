export function publicMapUrl(userId) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  // 公開マップの userid にはメールアドレスを指定できない。
  if (id === '' || id.includes('@')) return null
  return `https://machi-scrapbook.openacrossbase.net/map/?userid=${encodeURIComponent(id)}`
}
