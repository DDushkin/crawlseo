import { normalizeSitePageUrl, normalizeTargetQuery } from "./pages";

export type ImportRow = { url: string; query?: string; pageType?: string; intent?: string; notes?: string };

export function parseCsvTable(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = input.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unclosed quoted CSV cell");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function preparePageMapImport(siteDomain: string, rows: ImportRow[], country = "UA", language = "uk") {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) throw new Error("Import 1–500 rows at a time");
  if (typeof country !== "string" || typeof language !== "string" ||
      !/^[A-Z]{2}$/.test(country) || !/^[a-z]{2}$/.test(language)) throw new Error("Invalid market");
  const pages = new Map<string, { url: string; pageType: string | null }>();
  const targets = new Map<string, { url: string; query: string; intent: string | null; notes: string | null; country: string; language: string }>();
  rows.forEach((row, index) => {
    try {
      if (!row || typeof row.url !== "string") throw new Error("missing URL");
      const url = normalizeSitePageUrl(siteDomain, row.url);
      const pageType = row.pageType?.trim() || null;
      const intent = row.intent?.trim() || null;
      const notes = row.notes?.trim() || null;
      if ((pageType?.length ?? 0) > 60 || (intent?.length ?? 0) > 80 || (notes?.length ?? 0) > 2000) throw new Error("field too long");
      if (!pages.has(url)) pages.set(url, { url, pageType });
      if (row.query?.trim()) {
        const query = normalizeTargetQuery(row.query);
        const key = `${query}\0${country}\0${language}`;
        const prior = targets.get(key);
        if (prior && prior.url !== url) throw new Error(`query maps to multiple pages: ${query}`);
        if (!prior) targets.set(key, { url, query, intent, notes, country, language });
      }
    } catch (error) { throw new Error(`Row ${index + 1}: ${error instanceof Error ? error.message : "invalid row"}`); }
  });
  return { pages: [...pages.values()], targets: [...targets.values()] };
}

function spreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return spreadsheetCell(value.result);
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => spreadsheetCell(part?.text)).join("");
  }
  return "";
}

export async function parseImportFile(file: File) {
  if (file.size > 1024 * 1024) throw new Error("File must be 1 MB or smaller");
  let rows: string[][];
  if (/\.csv$/i.test(file.name)) rows = parseCsvTable(await file.text());
  else if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("Workbook has no worksheet");
    if (worksheet.rowCount > 1001 || worksheet.columnCount > 100) throw new Error("Workbook is too large");
    rows = [];
    worksheet.eachRow((row) => {
      const values: string[] = [];
      for (let col = 1; col <= Math.min(worksheet.columnCount, 100); col++) values.push(spreadsheetCell(row.getCell(col).value).slice(0, 2000));
      rows.push(values);
    });
  } else throw new Error("Choose a CSV or XLSX file");
  if (!rows.length || rows.length > 1001) throw new Error("Import up to 1,000 worksheet rows");
  return { headers: rows[0].slice(0, 100), rows: rows.slice(1, 1001).map((row) => row.slice(0, 100)) };
}
