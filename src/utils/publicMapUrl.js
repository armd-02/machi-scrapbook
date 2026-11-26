export function publicMapUrl(userId, bookName) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  // 公開マップの userid にはメールアドレスを指定できない。
  if (id === '' || id.includes('@')) return null
  const book = typeof bookName === 'string' && bookName !== ''
    ? `&book=${encodeURIComponent(bookName)}`
    : ''
  return `https://machi-scrapbook.openacrossbase.net/map/?userid=${encodeURIComponent(id)}${book}`
}
