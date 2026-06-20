// Split a large CSV into independently-parseable chunks so each import call stays
// well under the request-size limit. Every chunk repeats the file's preamble
// (metadata + header rows) so the backend's header detection works on each one.
// Dedup (balance-based fingerprints) makes chunked + overlapping imports safe.

const MAX_ROWS_PER_CHUNK = 3000;

export function splitCsv(text: string, maxRows = MAX_ROWS_PER_CHUNK): string[] {
  const lines = text.split(/\r?\n/);

  // Header = first line in the first 20 that mentions "date" and has a delimiter.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    if (/date/i.test(lines[i]) && /[,;\t]/.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  const preamble = lines.slice(0, headerIdx + 1);
  const data = lines.slice(headerIdx + 1).filter((l) => l.trim() !== "");
  if (data.length <= maxRows) return [text];

  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += maxRows) {
    chunks.push([...preamble, ...data.slice(i, i + maxRows)].join("\n"));
  }
  return chunks;
}
