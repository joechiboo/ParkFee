import { describe, it, expect } from 'vitest'
import { parseCSV, parseCSVObjects, toCSV } from './csv.js'

describe('CSV 解析／輸出', () => {
  it('基本解析', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('處理引號、欄內逗號與跳脫雙引號', () => {
    expect(parseCSV('a,"b,c","d""e"')).toEqual([['a', 'b,c', 'd"e']])
  })

  it('處理 \\r\\n 與欄內換行', () => {
    expect(parseCSV('a,b\r\n"x\ny",z')).toEqual([
      ['a', 'b'],
      ['x\ny', 'z'],
    ])
  })

  it('去除 BOM', () => {
    expect(parseCSV('﻿a,b')).toEqual([['a', 'b']])
  })

  it('parseCSVObjects 以表頭為鍵、略過空白列', () => {
    const objs = parseCSVObjects('戶號,車號\nH3-6,ABC-1234\n\nH3-7,XYZ-5678\n')
    expect(objs).toEqual([
      { 戶號: 'H3-6', 車號: 'ABC-1234' },
      { 戶號: 'H3-7', 車號: 'XYZ-5678' },
    ])
  })

  it('toCSV 來回一致，特殊字元加引號', () => {
    const objs = [{ a: '1', b: 'x,y' }]
    const csv = toCSV(objs, ['a', 'b'])
    expect(csv).toBe('a,b\r\n1,"x,y"')
    expect(parseCSVObjects(csv)).toEqual(objs)
  })
})
