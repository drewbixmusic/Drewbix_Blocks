// ══════════════════════════════════════════════════════════════
// LOGIC GATE MODULES — AND, OR, NAND, NOR, XOR, Inverter
// ══════════════════════════════════════════════════════════════

function row(a, b, result) { return { data: [{ a, b, result }], _rows: [{ a, b, result }] }; }

export function runGateAnd(node, { inputs })      { const { a, b } = inputs; return row(a, b, !!(a && b)); }
export function runGateOr(node, { inputs })       { const { a, b } = inputs; return row(a, b, !!(a || b)); }
export function runGateNand(node, { inputs })     { const { a, b } = inputs; return row(a, b, !(a && b)); }
export function runGateNor(node, { inputs })      { const { a, b } = inputs; return row(a, b, !(a || b)); }
export function runGateXor(node, { inputs })      { const { a, b } = inputs; return row(a, b, !!a !== !!b); }
export function runGateInverter(node, { inputs }) { const { a } = inputs; return { data: [{ a, result: !a }], _rows: [{ a, result: !a }] }; }
