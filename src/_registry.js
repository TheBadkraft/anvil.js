'use strict';

const { AnvilResolverError } = require('./_error');

// ---------------------------------------------------------------------------
// Registry
//
// Two responsibilities:
//   1. Catalogue all VarRef nodes encountered during parsing (never resolve them)
//   2. Wire inheritance — Kahn topological sort + _baseNode references
//
// The registry is owned by the root node. Consumers get a Resolver via
// root.getResolver(), which is injected with this registry.
// ---------------------------------------------------------------------------
class Registry {
  constructor() {
    // All VarRef nodes encountered during parsing
    // Each entry: { node, path, kind, args }
    //   kind: 'ref' | 'call'
    //   path: dotted string e.g. "atlas", "record.vehicle_id"
    //   args: VarRef[] for callables, null for refs
    this._refs = [];

    // vars map — name → scalar AnvilNode (static values)
    this._vars = new Map();
  }

  // Called by parser for every VarRef node encountered
  register(node) {
    this._refs.push(node);
  }

  // Called by parser after parsing vars block
  setVars(vars) {
    this._vars = vars;
  }

  // All catalogued VarRef nodes
  get refs() { return this._refs; }

  // vars map
  get vars() { return this._vars; }
}

// ---------------------------------------------------------------------------
// wireInheritance()
//
// Validates base names, detects cycles via Kahn's algorithm,
// sets _baseNode on derived statements.
// ---------------------------------------------------------------------------
function wireInheritance(inheritancePairs, statements) {
  if (inheritancePairs.length === 0) return;

  // Validate all base names exist and are not anonymous
  for (const [child, base] of inheritancePairs) {
    if (!statements.has(base)) {
      throw new AnvilResolverError(
        `Unknown base type "${base}" in "${child} : ${base}"`
      );
    }
    if (statements.get(base)._anonymous) {
      throw new AnvilResolverError(
        `Cannot inherit from anonymous block "${base}" in "${child} : ${base}"`
      );
    }
  }

  // Build adjacency graph
  const allNodes = new Set();
  const inDegree = new Map();
  const children = new Map();

  for (const [child, base] of inheritancePairs) {
    allNodes.add(child);
    allNodes.add(base);
  }

  for (const name of allNodes) {
    inDegree.set(name, 0);
    children.set(name, []);
  }

  for (const [child, base] of inheritancePairs) {
    children.get(base).push(child);
    inDegree.set(child, (inDegree.get(child) || 0) + 1);
  }

  // Kahn's algorithm
  const queue   = [];
  const visited = new Set();

  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  while (queue.length > 0) {
    const name = queue.shift();
    visited.add(name);
    for (const child of (children.get(name) || [])) {
      const newDeg = inDegree.get(child) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  if (visited.size < allNodes.size) {
    const cycleMembers = [...allNodes].filter(n => !visited.has(n));
    throw new AnvilResolverError(
      `Inheritance cycle detected involving: ${cycleMembers.join(', ')}`
    );
  }

  // Wire _baseNode references
  for (const [child, base] of inheritancePairs) {
    const childNode = statements.get(child);
    const baseNode  = statements.get(base);
    childNode._baseNode = baseNode;
    childNode._resolved = false;
  }
}

module.exports = { Registry, wireInheritance };
