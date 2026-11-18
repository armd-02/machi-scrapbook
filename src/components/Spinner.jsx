import React from 'react'

/**
 * 処理中を示すスピナー（ぐるぐる）。
 * アプリ既存のCSSスピナー（SearchActionButton・StatusBanner）と同一スタイル。
 * 装飾要素なので aria-hidden。
 */
export default function Spinner() {
  return (
    <div
      className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"
      aria-hidden="true"
    />
  )
}
