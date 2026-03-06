// ── Data Import Module ─────────────────────────────────────────────────────
// Reads pre-parsed data stored in cfg._importedData at run time.
// The actual parsing happens in the Inspector panel (DataImportPanel.jsx).

export function runDataImport(node, { cfg, setHeaders }) {
  const rows = cfg._importedData || [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { data: [], _rows: [], _importEmpty: true };
  }
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}
