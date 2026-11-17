/**
 * linkify.js（メモ文字列内の URL セグメント分割）のテスト
 *
 * - http:// / https:// で始まる URL のみ抽出（スキーム無いは対象外）
 * - CJK 句点・空白等は URL の終端（「https://example.com。閉店」→ 。はリンクに含まれない）
 * - 末尾の ASCII 句読点は削ぐ（「https://example.com. 」→ 句点はテキスト側）
 * - 閉じ括弧は URL 内部にバランスした開き括弧がある場合は保持（Wikipedia 風 URL）
 * - 複数 URL・混在・空文字列の処理
 *
 * 純粋関数なので jsdom 不要（node 環境で実行）。
 */
import { describe, it, expect } from 'vitest'
import { linkifySegments } from '../linkify'

const text = (v) => ({ type: 'text', value: v })
const url = (v) => ({ type: 'url', value: v })

describe('linkifySegments: 基本', () => {
  it('URL 無しのテキストは1つの text セグメント', () => {
    expect(linkifySegments('ただのメモ')).toEqual([text('ただのメモ')])
  })

  it('空文字列・null・undefined は空配列', () => {
    expect(linkifySegments('')).toEqual([])
    expect(linkifySegments(null)).toEqual([])
    expect(linkifySegments(undefined)).toEqual([])
  })

  it('URL 単体は1つの url セグメント', () => {
    expect(linkifySegments('https://example.com')).toEqual([url('https://example.com')])
  })

  it('http:// スキームも抽出される', () => {
    expect(linkifySegments('旧 http://example.com へ')).toEqual([
      text('旧 '),
      url('http://example.com'),
      text(' へ'),
    ])
  })

  it('テキスト・URL・テキストの順に分割される', () => {
    expect(linkifySegments('ホーム https://example.com ページ')).toEqual([
      text('ホーム '),
      url('https://example.com'),
      text(' ページ'),
    ])
  })

  it('複数URLが順に抽出される', () => {
    expect(linkifySegments('https://a.com と https://b.com/jp')).toEqual([
      url('https://a.com'),
      text(' と '),
      url('https://b.com/jp'),
    ])
  })
})

describe('linkifySegments: スキーム無いは対象外', () => {
  it('www.example.com はリンク化されない', () => {
    expect(linkifySegments('www.example.com')).toEqual([text('www.example.com')])
  })

  it('ftp:// 等はリンク化されない', () => {
    expect(linkifySegments('ftp://example.com/file')).toEqual([text('ftp://example.com/file')])
  })
})

describe('linkifySegments: 末尾句読点の処理', () => {
  it('CJK 句点が続く URL は句点を含まない（。で終端）', () => {
    expect(linkifySegments('https://example.com。閉店しました')).toEqual([
      url('https://example.com'),
      text('。閉店しました'),
    ])
  })

  it('全角括弧・読点等でも終端となる', () => {
    expect(linkifySegments('参照: https://example.com、確認済み')).toEqual([
      text('参照: '),
      url('https://example.com'),
      text('、確認済み'),
    ])
  })

  it('末尾の ASCII 句点は削がれテキスト側に回る', () => {
    expect(linkifySegments('https://example.com. 閉店')).toEqual([
      url('https://example.com'),
      text('. 閉店'),
    ])
    expect(linkifySegments('https://example.com!')).toEqual([
      url('https://example.com'),
      text('!'),
    ])
  })

  it('URL 内部のドットは保持される（サブドメイン・パス）', () => {
    expect(linkifySegments('https://sub.domain.com/path?q=1')).toEqual([
      url('https://sub.domain.com/path?q=1'),
    ])
  })

  it('カンマで区切られた連続URLは2つのリンクになる', () => {
    expect(linkifySegments('https://a.com,https://b.com')).toEqual([
      url('https://a.com'),
      text(','),
      url('https://b.com'),
    ])
  })
})

describe('linkifySegments: 改行と行末', () => {
  it('URLの後ろに改行が続く場合、改行は URL の終端となり改行ごとテキスト側に回る', () => {
    expect(linkifySegments('参照 https://example.com\n閉店')).toEqual([
      text('参照 '),
      url('https://example.com'),
      text('\n閉店'),
    ])
  })

  it('改行で囲まれた単独行のURLはそのまま抽出される（複数行メモでの行末URL）', () => {
    expect(linkifySegments('1行目\nhttps://example.com\n3行目')).toEqual([
      text('1行目\n'),
      url('https://example.com'),
      text('\n3行目'),
    ])
  })

  it('文字列末尾で終わるURL（末尾句読点無し）はそのまま抽出される', () => {
    expect(linkifySegments('参照 https://example.com')).toEqual([
      text('参照 '),
      url('https://example.com'),
    ])
  })
})

describe('linkifySegments: 括弧のバランス', () => {
  it('バランスした閉じ括弧は URL の一部として保持される', () => {
    expect(linkifySegments('https://en.wikipedia.org/wiki/Cat_(animal)')).toEqual([
      url('https://en.wikipedia.org/wiki/Cat_(animal)'),
    ])
  })

  it('バランスしない末尾の閉じ括弧は削られる', () => {
    expect(linkifySegments('https://example.com) 閉店')).toEqual([
      url('https://example.com'),
      text(') 閉店'),
    ])
  })

  it('全角括弧は URL の文字集合に含まれないため終端となる', () => {
    // （は RFC3986 の URL 文字では無い（エンコードされるべき）ため、そこで URL が切れる
    expect(linkifySegments('https://example.com/（テスト）')).toEqual([
      url('https://example.com/'),
      text('（テスト）'),
    ])
  })
})
