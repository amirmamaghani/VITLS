/** Browser-side downloads: the Data page assembles CSV/JSON from the rows it already holds; no server endpoint. */
export function downloadFile(name: string, mime: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Flat rows → CSV with a header from the union of keys, in first-seen order. */
export function toCsv(rows: Record<string, unknown>[]): string {
  const keys: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  return [keys.join(","), ...rows.map((row) => keys.map((key) => cell(row[key])).join(","))].join("\n");
}
