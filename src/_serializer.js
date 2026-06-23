'use strict';

const { AnvilValueType, ScalarKind } = require('./_types');

// ---------------------------------------------------------------------------
// Serializer — deserialize only
//
// Flattens an AnvilNode tree to plain JS objects/arrays/scalars.
//
// VarRefs resolve via the provided resolver. If no resolver is given,
// or if a ref is unbound, it deserializes to its unresolved source
// syntax as a string (e.g. "$record.vehicle_id") — same rule as
// Writer snapshot mode.
//
// serialize() (object → AML) is parked.
// ---------------------------------------------------------------------------

function deserialize(node, options = {}) {
  const resolver = options.resolver || null;
  return deserializeNode(node, resolver);
}

function deserializeNode(node, resolver) {
  switch (node.type) {
    case AnvilValueType.Object: return deserializeObject(node, resolver);
    case AnvilValueType.Array:
    case AnvilValueType.Tuple:  return deserializeSequence(node, resolver);
    case AnvilValueType.Blob:   return node.asString();
    case AnvilValueType.VarRef: return deserializeVarRef(node, resolver);
    case AnvilValueType.Scalar: return deserializeScalar(node);
    default:
      throw new Error(`Anvil.Serializer: unknown node type "${node.type}"`);
  }
}

function deserializeObject(node, resolver) {
  const out = {};
  for (const key of node.keys()) {
    out[key] = deserializeNode(node.get(key), resolver);
  }
  return out;
}

function deserializeSequence(node, resolver) {
  const out = [];
  for (const child of node) {
    out.push(deserializeNode(child, resolver));
  }
  return out;
}

function deserializeScalar(node) {
  switch (node.kind) {
    case ScalarKind.Int:      return node.asInt();
    case ScalarKind.Float:    return node.asFloat();
    case ScalarKind.Bool:     return node.asBool();
    case ScalarKind.Null:     return null;
    case ScalarKind.Hex:      return node.asString();   // "#RRGGBB"
    case ScalarKind.Selector: return node.asSelector();  // "#identifier"
    case ScalarKind.String:
    default:
      return node.asString();
  }
}

// VarRef → resolved value, or unresolved source syntax as a string
function deserializeVarRef(node, resolver) {
  if (!resolver) {
    return varRefSyntax(node);
  }

  const value = resolver.evaluate(node);
  if (value === undefined) {
    return varRefSyntax(node);
  }

  return value;
}

// Reconstruct $path / $a.b / $fn(args) from node fields
function varRefSyntax(node) {
  if (node._varKind === 'call') {
    const args = (node._varArgs || []).map(a => varRefSyntax(a)).join(', ');
    return `$${node._varName}(${args})`;
  }
  return `$${node._varPath}`;
}

module.exports = { deserialize };
