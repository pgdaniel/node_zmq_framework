// Minimal RFC-4180-ish CSV parsing/writing for csv_reader.js and
// csv_writer.js — deliberately not a full spec implementation (e.g. no
// handling for a quoted field that spans a literal newline split across
// separate parse calls), just what "simple CSV in, simple CSV out" needs:
// quoted fields, embedded commas, escaped quotes (""), no extra
// dependency for something this small.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else if (c === "\r") {
      // ignore — a following \n (CRLF) handles the row break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

export function csvField(value) {
  const s = String(value ?? "");
  if (/["\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values) {
  return values.map(csvField).join(",") + "\n";
}
