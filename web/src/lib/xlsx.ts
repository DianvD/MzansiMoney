import * as XLSX from "xlsx";

/** Is this an Excel spreadsheet (bank XLSX export)? */
export function isSpreadsheet(file: File): boolean {
  return (
    /\.xlsx?$/i.test(file.name) ||
    file.type.includes("spreadsheet") ||
    file.type.includes("ms-excel")
  );
}

/**
 * Convert the first sheet of an Excel file to CSV text in the browser, so it can
 * flow through the exact same CSV import pipeline (header detection, parsing,
 * dedup). SheetJS is lenient about the slightly-malformed XLSX some banks emit.
 */
export async function xlsxToCsv(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const name = wb.SheetNames[0];
  const sheet = name ? wb.Sheets[name] : undefined;
  if (!sheet) throw new Error("No sheet found in this spreadsheet.");
  return XLSX.utils.sheet_to_csv(sheet);
}
