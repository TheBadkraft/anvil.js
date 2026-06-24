'use strict';

/**
 * index.js — Anvil.JS public entry point
 *
 * Bridges the native C parser (build/Release/anvil.node) to the
 * JavaScript AnvilNode API. The C binder produces a plain AnvilTree
 * object; this module wraps it in AnvilNode and exposes the public API.
 *
 * Exports: parse, load, lastError, write, deserialize,
 *          AnvilValueType, ScalarKind
 */

// ── Native binding ────────────────────────────────────────────────────
const binder      = require('../build/Release/anvil');

// ── JS layer ─────────────────────────────────────────────────────────
const { AnvilNode } = require('./_node');
const { write }     = require('./_writer');
const { deserialize } = require('./_serializer');

// ── Enums ───────────────────────────────────────────────────────────
// These mirror the C anvl_value_type enum, lowercased to match
// the string values produced by binder.c's build_value().
const AnvilValueType = {
  Scalar: 'scalar',
  Object: 'object',
  Array:  'array',
  Tuple:  'tuple',
  Blob:   'blob',
  VarRef: 'varref',
};
// Scalar sub-kinds — inferred by _node.js from the raw text value.
// The C parser does not tag scalar sub-types; _node.js classifies them.
const ScalarKind = {
  String:   'String',
  Int:      'Int',
  Float:    'Float',
  Bool:     'Bool',
  Null:     'Null',
  Hex:      'Hex',
  Selector: 'Selector',
};

function makeRoot(tree) {
  if (!tree) return null;

  const stmtMap   = new Map();
  const stmtOrder = [];
  for (const stmt of tree.stmts) {
    stmtMap.set(stmt.name, stmt);
    stmtOrder.push(stmt.name);
  }

  const rootValue = { kind: 'object', fields: [], attrs: tree.attrs || {} };
  const root = new AnvilNode(rootValue, null);

  root.get = (key) => {
    const stmt = stmtMap.get(key);
    if (!stmt) return null;
    return new AnvilNode(stmt.value, stmt);
  };
  root.has     = (key) => stmtMap.has(key);
  root.require = (key) => {
    const v = root.get(key);
    if (!v) { const e = new Error(`'${key}' not found`); e.name = 'KeyError'; throw e; }
    return v;
  };
  root.keys    = function*() { for (const k of stmtOrder) yield k; };
  root.entries = function*() { for (const k of stmtOrder) yield [k, root.get(k)]; };
  root[Symbol.iterator] = function() { return root.entries(); };
  root._dialect = tree.dialect;
  root._stmts   = tree.stmts;
  root._registry = stmtMap;

  return root;
}
function parse(source, path = null) { 
  return makeRoot(binder.parse(source, path)); 
}
function load(filePath) { 
  return makeRoot(binder.load(filePath));  
}
function lastError() {
  const e = binder.lastError();
  if (!e) return null;
  return { message: e.message, line: e.line, column: e.column, path: e.path,
           toString() { return e.message; } };
}

module.exports = { 
  parse, load, lastError, write, deserialize };
