import * as XLSX from 'xlsx';
import { MonGenItem, MonGenModel, isEmptyField } from './monGenModel';

export interface MonGenWorkbook {
  model: MonGenModel;
  workbook: XLSX.WorkBook;
  sheetName: string;
}

function isHeader(cells: string[]): boolean {
  const normalized = cells.map((cell) => cell.trim().toLowerCase());
  const hasMap = normalized.some((cell) => cell.includes('地图') || /^map(?:id)?$/.test(cell));
  const hasMonster = normalized.some((cell) => cell.includes('怪物') || /^mon(?:ster)?(?:name)?$/.test(cell));
  const hasCount = normalized.some((cell) => cell.includes('数量') || cell === 'count');
  return hasMap && hasMonster && hasCount;
}

function itemFromCells(cells: string[]): MonGenItem {
  const fields = cells.map((cell) => cell.trim());
  while (fields.length && fields[fields.length - 1] === '') fields.pop();
  if (!fields.length) return { type: 'raw', text: '' };
  const text = fields.join('\t');
  const first = fields[0];
  if (first.startsWith(';') || first.startsWith('；') || first.startsWith('//') || fields.length < 7 || isHeader(fields)) {
    return { type: 'raw', text };
  }
  return { type: 'row', row: { fields } };
}

function readSheet(workbook: XLSX.WorkBook, sheetName: string): MonGenModel {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });
  return {
    items: rows.map((row) => itemFromCells(row.map((cell) => cell === null || cell === undefined ? '' : String(cell)))),
  };
}

export function parseMonGenWorkbook(data: Uint8Array): MonGenWorkbook {
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  if (!workbook.SheetNames.length) throw new Error('Excel 中没有工作表');
  let fallback: MonGenWorkbook | undefined;
  for (const sheetName of workbook.SheetNames) {
    const parsed = { model: readSheet(workbook, sheetName), workbook, sheetName };
    if (!fallback) fallback = parsed;
    if (parsed.model.items.some((item) => item.type === 'row')) return parsed;
  }
  return fallback!;
}

export function serializeMonGenWorkbook(
  model: MonGenModel,
  workbook: XLSX.WorkBook,
  sheetName: string,
): Uint8Array {
  const rows = model.items.map((item) => {
    if (item.type === 'raw') return item.text.split('\t');
    const fields = item.row.fields.map((field) => field.trim());
    while (fields.length && isEmptyField(fields[fields.length - 1])) fields.pop();
    return fields.map((field) => field === ';' ? '' : field);
  });
  const previous = workbook.Sheets[sheetName];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (previous && previous['!cols']) sheet['!cols'] = previous['!cols'];
  workbook.Sheets[sheetName] = sheet;
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xls' });
  return output instanceof Uint8Array ? output : new Uint8Array(output);
}
