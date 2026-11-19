/**
 * parseWorkbook turns an uploaded .xlsx/.csv into child import rows. These
 * tests build real files with SheetJS itself, so they also guard against a
 * regression when the xlsx dependency is upgraded.
 */
import { describe, it, expect, vi } from 'vitest'
import { utils, write } from 'xlsx'

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(),
  getStorageBucket: vi.fn(),
}))

import { parseWorkbook } from '../childrenImport.routes.js'

function xlsxBuffer(rows: unknown[][]): Buffer {
  const book = utils.book_new()
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), 'Sheet1')
  return write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('parseWorkbook', () => {
  it('maps Russian headers from an .xlsx file and normalizes gender and phone', () => {
    const buffer = xlsxBuffer([
      ['Имя', 'Фамилия', 'Дата рождения', 'Пол', 'Телефон родителя', 'Email родителя'],
      ['Айдана', 'Нурлан', '17.05.2020', 'ж', '+996 555 000 111', 'mama@example.com'],
      ['Тимур', 'Беков', '01.02.2019', 'М', '', ''],
    ])

    const rows = parseWorkbook(buffer)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      firstName: 'Айдана',
      lastName: 'Нурлан',
      dateOfBirth: '17.05.2020',
      gender: 'female',
      contactPhone: '+996 555 000 111',
      contactEmail: 'mama@example.com',
    })
    expect(rows[1]).toMatchObject({ firstName: 'Тимур', gender: 'male' })
  })

  it('converts real date cells to ISO yyyy-mm-dd', () => {
    const buffer = xlsxBuffer([
      ['Имя', 'Дата рождения'],
      ['Алия', new Date(Date.UTC(2020, 4, 17, 12))],
    ])

    const [row] = parseWorkbook(buffer)

    expect(row.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('parses a CSV upload with English headers', () => {
    const csv = Buffer.from('first name,last name,gender,phone\nAmir,Sadyk,male,+996700123456\n')

    const rows = parseWorkbook(csv)

    expect(rows).toEqual([
      { firstName: 'Amir', lastName: 'Sadyk', gender: 'male', contactPhone: '+996700123456' },
    ])
  })

  it('ignores unknown columns and does not let header names pollute prototypes', () => {
    const buffer = xlsxBuffer([
      ['Имя', '__proto__', 'constructor', 'unknown'],
      ['Алия', 'x', 'y', 'z'],
    ])

    const [row] = parseWorkbook(buffer)

    expect(row).toEqual({ firstName: 'Алия' })
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('returns no rows for an empty workbook', () => {
    expect(parseWorkbook(xlsxBuffer([[]]))).toEqual([])
  })
})
