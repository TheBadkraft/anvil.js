'use strict';

const { AnvilValueType, ScalarKind } = require('./_types');
const { InvalidOperationError, KeyError, IndexError } = require('./_error');

// ---------------------------------------------------------------------------
// AnvilNode
//
// Every value in a parsed document is an AnvilNode.
// One type. Full iteration. Zero friction. Zero collisions.
//
// Field access:   node.get('fieldName')   — any field name, no collisions ever
// Element access: node.at(0)              — array/tuple positional access
// Iteration:      for (const v of node)   — values for Object, elements for Array/Tuple
// ---------------------------------------------------------------------------
class AnvilNode {
  constructor(type, kind = null) {
    this._type        = type;    // AnvilValueType
    this._kind        = kind;    // ScalarKind | null

    // Scalar
    this._scalarStart = 0;
    this._scalarEnd   = 0;
    this._scalarText  = null;   // pre-extracted text (quoted strings)
    this._isQuoted    = false;  // true if value was quoted in source
    this._buf         = null;   // SourceBuffer reference

    // Object fields
    this._fields      = null;    // Map<string, AnvilNode>
    this._fieldOrder  = null;    // string[] — declaration order

    // Array / Tuple elements
    this._children    = null;    // AnvilNode[]

    // Attributes — @[key=value, flag]
    this._attrs       = null;    // Map<string, string|null>

    // Inheritance
    this._baseId      = null;    // string | null — as written in source
    this._baseNode    = null;    // AnvilNode | null — wired by resolver
    this._resolved    = false;   // lazy merge done?

    // Vars (root only)
    this._vars        = null;    // Map<string, AnvilNode>

    // Blob tag (Milestone 2)
    this._blobTag     = null;    // string | null

    // VarRef fields
    this._varKind     = null;    // 'ref' | 'call'
    this._varPath     = null;    // string — dotted path e.g. "record.vehicle_id"
    this._varName     = null;    // string — callable name e.g. "sum"
    this._varArgs     = null;    // AnvilNode[] — callable arguments

    // Registry (root node only)
    this._registry    = null;
  }

  // -------------------------------------------------------------------------
  // Type inspection
  // -------------------------------------------------------------------------
  get type() { return this._type; }
  get kind() { return this._kind; }

  // -------------------------------------------------------------------------
  // Scalar materialisation
  // -------------------------------------------------------------------------
  asString() {
    if (this._type === AnvilValueType.Blob) {
      return this._buf.sliceStr(this._scalarStart, this._scalarEnd);
    }
    if (this._type === AnvilValueType.VarRef) {
      // Return the path/name as written — runtime resolves, not parser
      if (this._varKind === 'call') {
        const args = (this._varArgs || []).map(a => a.asString()).join(', ');
        return `$${this._varName}(${args})`;
      }
      return `$${this._varPath}`;
    }
    this._requireScalar('asString');
    const raw = this._buf.sliceStr(this._scalarStart, this._scalarEnd);

    switch (this._kind) {
      case ScalarKind.String: {
        // New parser pre-extracts quoted string content into _scalarText
        if (this._scalarText !== undefined && this._scalarText !== null) {
          return this._processEscapes(this._scalarText);
        }
        if (raw[0] === '"') {
          return this._processEscapes(raw.slice(1, -1));
        }
        return raw;
      }
      case ScalarKind.Int:
      case ScalarKind.Float:
      case ScalarKind.Bool:
      case ScalarKind.Null:
        return raw;
      case ScalarKind.Hex: {
        const digits = raw.slice(1);
        if (digits.length === 3) {
          const r = digits[0], g = digits[1], b = digits[2];
          return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
        }
        return `#${digits.toUpperCase()}`;
      }
      case ScalarKind.Selector:
        return raw;  // "#input-sku" — exactly as written
      default:
        return raw;
    }
  }

  asInt() {
    this._requireScalar('asInt');
    if (this._kind === ScalarKind.Hex) {
      const digits = this._buf.sliceStr(this._scalarStart + 1, this._scalarEnd);
      const expanded = digits.length === 3
        ? `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
        : digits;
      return parseInt(expanded, 16);
    }
    if (this._kind === ScalarKind.Int) {
      return parseInt(this._buf.sliceStr(this._scalarStart, this._scalarEnd), 10);
    }
    throw new InvalidOperationError(
      `asInt() called on ${this._kind} scalar — only Int and Hex are supported`
    );
  }

  asFloat() {
    this._requireScalar('asFloat');
    if (this._kind === ScalarKind.Float) {
      return parseFloat(this._buf.sliceStr(this._scalarStart, this._scalarEnd));
    }
    throw new InvalidOperationError(
      `asFloat() called on ${this._kind} scalar — only Float is supported`
    );
  }

  asBool() {
    this._requireScalar('asBool');
    if (this._kind === ScalarKind.Bool) {
      return this._buf.sliceStr(this._scalarStart, this._scalarEnd) === 'true';
    }
    throw new InvalidOperationError(
      `asBool() called on ${this._kind} scalar — only Bool is supported`
    );
  }

  isNull() {
    return this._type === AnvilValueType.Scalar && this._kind === ScalarKind.Null;
  }

  // asSelector() — returns "#input-sku" — full selector, hash included, DOM/CSS ready
  asSelector() {
    this._requireScalar('asSelector');
    if (this._kind !== ScalarKind.Selector) {
      throw new InvalidOperationError(
        `asSelector() called on ${this._kind} scalar — only Selector is supported`
      );
    }
    return this._buf.sliceStr(this._scalarStart, this._scalarEnd);
  }

  // asName() — returns "input-sku" — bare identifier, hash stripped
  asName() {
    this._requireScalar('asName');
    if (this._kind !== ScalarKind.Selector) {
      throw new InvalidOperationError(
        `asName() called on ${this._kind} scalar — only Selector is supported`
      );
    }
    const raw = this._buf.sliceStr(this._scalarStart, this._scalarEnd);
    return raw.slice(1); // strip leading #
  }

  // -------------------------------------------------------------------------
  // Zero-copy access
  // -------------------------------------------------------------------------
  asBuffer() {
    if (this._type !== AnvilValueType.Scalar && this._type !== AnvilValueType.Blob) {
      throw new InvalidOperationError(
        `asBuffer() requires Scalar or Blob node, got ${this._type}`
      );
    }
    return this._buf.sliceBuffer(this._scalarStart, this._scalarEnd);
  }

  // -------------------------------------------------------------------------
  // Object field access
  //
  // get(key)  — returns AnvilNode or null (never throws on missing)
  // field(key) — returns AnvilNode, throws KeyError on missing
  // has(key)  — boolean membership test
  // -------------------------------------------------------------------------
  get(key) {
    if (this._type !== AnvilValueType.Object) return null;
    this._ensureResolved();
    return this._fields.get(key) ?? null;
  }

  field(key) {
    this._ensureResolved();
    this._requireObject('field');
    if (!this._fields.has(key)) throw new KeyError(key);
    return this._fields.get(key);
  }

  has(key) {
    if (this._type !== AnvilValueType.Object) return false;
    this._ensureResolved();
    return this._fields.has(key);
  }

  // -------------------------------------------------------------------------
  // Typed safe access with defaults
  // -------------------------------------------------------------------------
  getString(key, defaultValue = '') {
    const node = this.get(key);
    if (node === null) return defaultValue;
    try { return node.asString(); } catch { return defaultValue; }
  }

  getInt(key, defaultValue = 0) {
    const node = this.get(key);
    if (node === null) return defaultValue;
    try { return node.asInt(); } catch { return defaultValue; }
  }

  getFloat(key, defaultValue = 0.0) {
    const node = this.get(key);
    if (node === null) return defaultValue;
    try { return node.asFloat(); } catch { return defaultValue; }
  }

  getBool(key, defaultValue = false) {
    const node = this.get(key);
    if (node === null) return defaultValue;
    try { return node.asBool(); } catch { return defaultValue; }
  }

  // -------------------------------------------------------------------------
  // Array / Tuple positional access
  //
  // at(index) — returns AnvilNode, throws IndexError on out-of-range
  // -------------------------------------------------------------------------
  at(index) {
    if (this._type !== AnvilValueType.Array && this._type !== AnvilValueType.Tuple) {
      throw new InvalidOperationError(
        `at() requires Array or Tuple node, got ${this._type}`
      );
    }
    const children = this._children || [];
    if (index < 0 || index >= children.length) {
      throw new IndexError(index, children.length);
    }
    return children[index];
  }

  // -------------------------------------------------------------------------
  // Iteration and enumeration
  // -------------------------------------------------------------------------
  keys() {
    this._ensureResolved();
    this._requireObject('keys');
    return [...this._fieldOrder];
  }

  * entries() {
    this._ensureResolved();
    this._requireObject('entries');
    for (const k of this._fieldOrder) {
      yield [k, this._fields.get(k)];
    }
  }

  get count() {
    if (this._type === AnvilValueType.Object) {
      this._ensureResolved();
      return this._fields.size;
    }
    if (this._type === AnvilValueType.Array || this._type === AnvilValueType.Tuple) {
      return this._children ? this._children.length : 0;
    }
    return 0;
  }

  [Symbol.iterator]() {
    if (this._type === AnvilValueType.Object) {
      this._ensureResolved();
      const order  = this._fieldOrder;
      const fields = this._fields;
      let i = 0;
      return {
        next() {
          if (i < order.length) return { value: fields.get(order[i++]), done: false };
          return { done: true };
        }
      };
    }
    if (this._type === AnvilValueType.Array || this._type === AnvilValueType.Tuple) {
      const children = this._children || [];
      let i = 0;
      return {
        next() {
          if (i < children.length) return { value: children[i++], done: false };
          return { done: true };
        }
      };
    }
    throw new InvalidOperationError(`Cannot iterate over ${this._type} node`);
  }

  // -------------------------------------------------------------------------
  // Inheritance metadata
  // -------------------------------------------------------------------------
  get hasBase()        { return this._baseId !== null; }
  get baseIdentifier() { return this._baseId; }

  is(typeName) {
    let node = this;
    while (node !== null) {
      if (node._baseId === typeName) return true;
      node = node._baseNode;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Attributes
  // -------------------------------------------------------------------------
  hasAttribute(key) {
    if (!this._attrs) return false;
    return this._attrs.has(key);
  }

  attribute(key) {
    if (!this._attrs) return null;
    return this._attrs.has(key) ? (this._attrs.get(key) ?? null) : null;
  }

  get attributes() {
    if (!this._attrs) return {};
    return Object.fromEntries(this._attrs);
  }

  // -------------------------------------------------------------------------
  // Blob tag (Milestone 2)
  // -------------------------------------------------------------------------
  get blobTag() { return this._blobTag; }

  // -------------------------------------------------------------------------
  // Vars (root node only)
  // -------------------------------------------------------------------------
  hasVar(name) {
    if (!this._vars) return false;
    return this._vars.has(name);
  }

  var(name) {
    if (!this._vars) return null;
    return this._vars.get(name) ?? null;
  }

  // -------------------------------------------------------------------------
  // Resolver (root node only)
  // -------------------------------------------------------------------------
  getResolver() {
    const { Resolver } = require('./_resolver');
    if (!this._registry) {
      const { Registry } = require('./_registry');
      this._registry = new Registry();
    }
    return new Resolver(this._registry);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  _requireScalar(method) {
    if (this._type !== AnvilValueType.Scalar) {
      throw new InvalidOperationError(
        `${method}() requires Scalar node, got ${this._type}`
      );
    }
  }

  _requireObject(method) {
    if (this._type !== AnvilValueType.Object) {
      throw new InvalidOperationError(
        `${method}() requires Object node, got ${this._type}`
      );
    }
  }

  _processEscapes(str) {
    return str
      .replace(/\\n/g,  '\n')
      .replace(/\\t/g,  '\t')
      .replace(/\\r/g,  '\r')
      .replace(/\\"/g,  '"')
      .replace(/\\\\/g, '\\');
  }

  _ensureResolved() {
    if (this._resolved) return;
    this._resolved = true;
    if (!this._baseNode) return;

    this._baseNode._ensureResolved();

    const merged      = new Map(this._baseNode._fields);
    const mergedOrder = [...this._baseNode._fieldOrder];

    for (const key of this._fieldOrder) {
      if (!merged.has(key)) mergedOrder.push(key);
      merged.set(key, this._fields.get(key));
    }

    this._fields     = merged;
    this._fieldOrder = mergedOrder;
  }
}

// ---------------------------------------------------------------------------
// makeNode — plain factory, no Proxy
// ---------------------------------------------------------------------------
function makeNode(type, kind = null) {
  return new AnvilNode(type, kind);
}

module.exports = { AnvilNode, makeNode };
