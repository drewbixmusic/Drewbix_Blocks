// ══════════════════════════════════════════════════════════════
// SUBFLOW MODULE — executes a saved function (sub-graph)
// ══════════════════════════════════════════════════════════════

function normalize(inp) {
  if (!inp) return [];
  if (!Array.isArray(inp)) return [inp];
  return inp;
}

/**
 * runSubflow — loads a saved function definition by name and executes it
 * via the provided engine runner.
 *
 * @param {object} node  - the subflow node
 * @param {object} ctx   - execution context with cfg, inputs, functions, runSubgraph
 */
export async function runSubflow(node, { cfg, inputs, functions, runSubgraph, setHeaders }) {
  const fnName = cfg.fn_name || '';
  if (!fnName) throw new Error('Subflow: no function selected');

  const fn = functions?.[fnName];
  if (!fn) throw new Error(`Subflow: function "${fnName}" not found`);

  const inputData = normalize(
    inputs.data || inputs.filtered_data || inputs.joined_data || []
  );

  // Execute the sub-graph with the function's node/edge definition
  // runSubgraph is provided by engine.js and returns { data, _rows, _headers }
  const result = await runSubgraph(fn, inputData, inputs);

  const rows = normalize(result?.data || result?._rows || []);
  if (rows.length && result?._headers) {
    setHeaders(result._headers);
  } else if (rows.length) {
    setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  }

  return { data: rows, _rows: rows };
}
