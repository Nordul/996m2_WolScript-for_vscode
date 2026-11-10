import * as XLSX from 'xlsx';
import { MerchantItem, MerchantModel, MERCHANT_MIN_COLUMNS, isEmptyField } from './merchantModel';

export interface MerchantWorkbook {
  model: MerchantModel;
  workbook: XLSX.WorkBook;
  sheetName: string;
}

function isHeader(cells: string[]): boolean {
  const normalized = cells.map((cell) => cell.trim().toLowerCase());
  const hasFile = normalized.some((cell) => cell.includes('文件名') || cell.includes('脚本') || /^file(?:name)?$/.test(cell));
  const hasMap = normalized.some((cell) => cell.includes('地图') || /^map(?:id|name)?$/.test(cell));
  const hasNpc = normalized.some((cell) => cell.includes('npc') || cell.includes('名称') || cell.includes('形象'));
  return hasFile && hasMap && hasNpc;
}

function itemFromCells(cells: string[]): MerchantItem {
  const fields = cells.map((cell) => cell.trim());
  while (fields.length && fields[fields.length - 1] === '') fields.pop();
  if (!fields.length) return { type: 'raw', text: '' };
  const text = fields.join('\t');
  const first = fields[0];
  if (first.startsWith(';') || first.startsWith('；') || first.startsWith('//')
    || fields.length < MERCHANT_MIN_COLUMNS || isHeader(fields)) {
    return { type: 'raw', text };
  }
  return { type: 'row', row: { fields } };
}

function readSheet(workbook: XLSX.WorkBook, sheetName: string): MerchantModel {
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

export function parseMerchantWorkbook(data: Uint8Array): MerchantWorkbook {
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  if (!workbook.SheetNames.length) throw new Error('Excel 中没有工作表');
  let fallback: MerchantWorkbook | undefined;
  for (const sheetName of workbook.SheetNames) {
    const parsed = { model: readSheet(workbook, sheetName), workbook, sheetName };
    if (!fallback) fallback = parsed;
    if (parsed.model.items.some((item) => item.type === 'row')) return parsed;
  }
  return fallback!;
}

export function serializeMerchantWorkbook(
  model: MerchantModel,
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
