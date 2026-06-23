(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.anvl = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
'use strict';

// ---------------------------------------------------------------------------
// SourceBuffer
//
// Wraps raw source input. Single UTF-8 decode up front; all subsequent
// access is via character offsets into the decoded string. Zero-copy
// Uint8Array subarray slices for binary/blob access.
//
// Internal — not part of the public API.
// ---------------------------------------------------------------------------
class SourceBuffer {
  /**
   * @param {string | Buffer | Uint8Array} raw  Source input
   * @param {string | null} path                File path, or null for in-memory
   */
  constructor(raw, path = null) {
    this.path = path;

    if (typeof raw === 'string') {
      // Already a JS string — store directly
      this._str = raw;
      // Encode to bytes for zero-copy slice support
      this._bytes = new TextEncoder().encode(raw);
    } else if (raw instanceof Uint8Array) {
      // Buffer (Node.js) extends Uint8Array — same branch handles both
      this._bytes = raw;
      this._str   = new TextDecoder('utf-8').decode(raw);
    } else {
      throw new TypeError('SourceBuffer: raw must be a string, Buffer, or Uint8Array');
    }
  }

  /** Total character length of the source string */
  get length() { return this._str.length; }

  /** Character at offset i */
  charAt(i) { return this._str[i]; }

  /** Character code at offset i */
  charCodeAt(i) { return this._str.charCodeAt(i); }

  /**
   * Allocate a string slice — used only at materialisation time.
   * start/end are character offsets into the decoded string.
   */
  sliceStr(start, end) {
    return this._str.slice(start, end);
  }

  /**
   * Zero-copy Uint8Array subarray over the raw bytes.
   * start/end are BYTE offsets, not character offsets.
   * For ASCII/Latin-1 content they are the same; for multi-byte
   * Unicode you must use byte offsets from the lexer.
   */
  sliceBuffer(byteStart, byteEnd) {
    return this._bytes.subarray(byteStart, byteEnd);
  }

  /**
   * Convert a character offset to 1-based (line, col) for error reporting.
   * O(n) — only called on the error path, never on the hot path.
   */
  lineCol(offset) {
    let line = 1;
    let col  = 1;
    for (let i = 0; i < offset && i < this._str.length; i++) {
      if (this._str[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { line, col };
  }

  /** Expose the raw decoded string for the lexer */
  get str() { return this._str; }
}

module.exports = { SourceBuffer };

},{}],3:[function(require,module,exports){
'use strict';

// ---------------------------------------------------------------------------
// AnvilError — the structured error record stored by lastError()
// ---------------------------------------------------------------------------
class AnvilError {
  constructor(message, line = 0, column = 0, file = null) {
    this.message = message;
    this.line    = line;
    this.column  = column;
    this.file    = file;
  }

  toString() {
    const loc = this.line > 0 ? ` (line ${this.line}, col ${this.column})` : '';
    const src = this.file ? ` in ${this.file}` : '';
    return `${this.message}${loc}${src}`;
  }
}

// ---------------------------------------------------------------------------
// AnvilParseError — thrown by Lexer and Parser; caught by parse()/load()
// ---------------------------------------------------------------------------
class AnvilParseError extends Error {
  constructor(message, line = 0, column = 0) {
    super(message);
    this.name   = 'AnvilParseError';
    this.line   = line;
    this.column = column;
  }
}

// ---------------------------------------------------------------------------
// AnvilResolverError — thrown by Resolver; caught by parse()/load()
// ---------------------------------------------------------------------------
class AnvilResolverError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnvilResolverError';
    // Resolver does not track line/column yet (Milestone 2)
    this.line   = 0;
    this.column = 0;
  }
}

// ---------------------------------------------------------------------------
// InvalidOperationError — thrown by AnvilNode on type mismatch; NOT caught
// Propagates to the consumer — represents a consumer logic error
// ---------------------------------------------------------------------------
class InvalidOperationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidOperationError';
  }
}

// ---------------------------------------------------------------------------
// KeyError — thrown by AnvilNode on missing key; NOT caught
// ---------------------------------------------------------------------------
class KeyError extends Error {
  constructor(key) {
    super(`Key not found: "${key}"`);
    this.name = 'KeyError';
    this.key  = key;
  }
}

// ---------------------------------------------------------------------------
// IndexError — thrown by AnvilNode on out-of-range index; NOT caught
// ---------------------------------------------------------------------------
class IndexError extends Error {
  constructor(index, length) {
    super(`Index ${index} out of range (length ${length})`);
    this.name  = 'IndexError';
    this.index = index;
  }
}

module.exports = {
  AnvilError,
  AnvilParseError,
  AnvilResolverError,
  InvalidOperationError,
  KeyError,
  IndexError,
};

},{}],4:[function(require,module,exports){
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

},{"./_error":3,"./_registry":6,"./_resolver":7,"./_types":10}],5:[function(require,module,exports){
'use strict';

const { Scanner }       = require('./_scanner');
const { AnvilValueType, ScalarKind, AnvilDialect } = require('./_types');
const { AnvilParseError } = require('./_error');
const { makeNode }      = require('./_node');
const { Registry }      = require('./_registry');

// ---------------------------------------------------------------------------
// Parser
//
// Single-pass, character-at-a-time recursive descent parser.
// Uses Scanner for all character reading — no token array, no regex.
// Builds an AnvilNode tree and populates the Registry.
// ---------------------------------------------------------------------------
class Parser {
  constructor(buf) {
    this._scanner         = new Scanner(buf);
    this._registry        = new Registry();
    this.statements       = new Map();
    this.inheritancePairs = [];
    this.dialect          = AnvilDialect.Aml;
  }

  // -------------------------------------------------------------------------
  // Public entry point
  // -------------------------------------------------------------------------
  parse() {
    const s = this._scanner;
    const root = makeNode(AnvilValueType.Object);
    root._fields     = new Map();
    root._fieldOrder = [];
    root._vars       = new Map();
    root._resolved   = true;

    s.skipWhitespaceAndComments();

    // Shebang
    if (s.isShebang()) {
      const shebang = s.readShebang().toLowerCase();
      if      (shebang.includes('amp')) this.dialect = AnvilDialect.Amp;
      else if (shebang.includes('asl')) this.dialect = AnvilDialect.Asl;
      else                              this.dialect = AnvilDialect.Aml;
    }

    s.skipWhitespaceAndComments();

    // Root attributes
    if (s.isAttrList()) {
      root._attrs = s.readAttrList();
    }

    s.skipWhitespaceAndComments();

    // vars block
    if (this._peekKeyword('vars')) {
      this._parseVarsBlock(root);
    }

    // Top-level statements and anonymous blocks
    while (!s.done) {
      s.skipCommas();
      if (s.done) break;
      this._parseTopLevel(root);
      s.skipCommas();
    }

    return root;
  }

  // -------------------------------------------------------------------------
  // vars block
  // -------------------------------------------------------------------------
  _parseVarsBlock(root) {
    const s = this._scanner;
    s.skipWhitespaceAndComments();
    s.readIdent(); // consume 'vars'
    s.skipWhitespaceAndComments();
    s.expect('{');

    const vars = new Map();

    while (!s.done) {
      s.skipCommas();
      s.skipWhitespaceAndComments();
      if (s.peek() === '}') { s.advance(); break; }

      const key = s.readIdent();
      s.skipWhitespaceAndComments();
      s.expectAssign();

      let valNode;
      s.skipWhitespaceAndComments();
      if (s.peek() === '$') {
        valNode = this._parseVarRef();
      } else {
        valNode = this._parseScalarValue();
      }

      vars.set(key, valNode);
      root._vars.set(key, valNode);
    }

    this._registry.setVars(vars);
  }

  // -------------------------------------------------------------------------
  // Top-level dispatcher
  // -------------------------------------------------------------------------
  _parseTopLevel(root) {
    const s = this._scanner;
    s.skipWhitespaceAndComments();

    const name = s.readIdent();

    s.skipWhitespaceAndComments();

    // Optional inheritance
    let baseName = null;
    if (s.peek() === ':' && !s.isAssign()) {
      s.advance(); // consume :
      s.skipWhitespaceAndComments();
      baseName = s.readIdent();
      s.skipWhitespaceAndComments();
    }

    // Optional attributes
    let attrs = null;
    if (s.isAttrList()) {
      attrs = s.readAttrList();
      s.skipWhitespaceAndComments();
    }

    // Anonymous block: IDENT { ... }
    if (s.peek() === '{') {
      const node = this._parseObject();
      node._anonymous = true;
      if (attrs)    node._attrs   = attrs;
      if (baseName) {
        node._baseId = baseName;
        this.inheritancePairs.push([name, baseName]);
      }
      root._fields.set(name, node);
      root._fieldOrder.push(name);
      this.statements.set(name, node);
      return;
    }

    // Regular statement: :=
    s.expectAssign();
    const value = this._parseValue();

    if (attrs)    value._attrs  = attrs;
    if (baseName) {
      value._baseId = baseName;
      this.inheritancePairs.push([name, baseName]);
    }

    root._fields.set(name, value);
    root._fieldOrder.push(name);
    this.statements.set(name, value);
  }

  // -------------------------------------------------------------------------
  // Value dispatcher
  // -------------------------------------------------------------------------
  _parseValue() {
    const s = this._scanner;
    s.skipWhitespaceAndComments();
    const ch = s.peek();

    if (ch === '{') return this._parseObject();
    if (ch === '[') return this._parseArray();
    if (ch === '(') return this._parseTuple();
    if (ch === '$') return this._parseVarRef();
    if (ch === '`' || s.isTaggedBlob()) return this._parseBlob();
    return this._parseScalarValue();
  }

  // -------------------------------------------------------------------------
  // Object: { field* }
  // -------------------------------------------------------------------------
  _parseObject() {
    const s = this._scanner;
    s.expect('{');
    s.skipCommas();
    s.skipWhitespaceAndComments();
    if (s.peek() === '}') {
      s.error('Empty object is not valid — use null instead');
    }

    const node = makeNode(AnvilValueType.Object);
    node._fields     = new Map();
    node._fieldOrder = [];
    node._resolved   = true;

    while (!s.done) {
      s.skipCommas();
      s.skipWhitespaceAndComments();
      if (s.peek() === '}') { s.advance(); break; }

      const key = s.readIdent();
      s.skipWhitespaceAndComments();

      // Optional field attributes
      let attrs = null;
      if (s.isAttrList()) {
        attrs = s.readAttrList();
        s.skipWhitespaceAndComments();
      }

      s.expectAssign();
      const value = this._parseValue();
      if (attrs) value._attrs = attrs;

      node._fields.set(key, value);
      node._fieldOrder.push(key);
    }

    return node;
  }

  // -------------------------------------------------------------------------
  // Array: [ value* ]
  // -------------------------------------------------------------------------
  _parseArray() {
    const s = this._scanner;
    s.expect('[');
    s.skipCommas();
    s.skipWhitespaceAndComments();
    if (s.peek() === ']') {
      s.error('Empty array is not valid — use null instead');
    }

    const node = makeNode(AnvilValueType.Array);
    node._children = [];

    while (!s.done) {
      s.skipCommas();
      s.skipWhitespaceAndComments();
      if (s.peek() === ']') { s.advance(); break; }
      node._children.push(this._parseValue());
      s.skipCommas();
    }

    return node;
  }

  // -------------------------------------------------------------------------
  // Tuple: ( value* )
  // -------------------------------------------------------------------------
  _parseTuple() {
    const s = this._scanner;
    s.expect('(');
    s.skipCommas();
    s.skipWhitespaceAndComments();
    if (s.peek() === ')') {
      s.error('Empty tuple is not valid — use null instead');
    }

    const node = makeNode(AnvilValueType.Tuple);
    node._children = [];

    while (!s.done) {
      s.skipCommas();
      s.skipWhitespaceAndComments();
      if (s.peek() === ')') { s.advance(); break; }
      node._children.push(this._parseValue());
      s.skipCommas();
    }

    if (node._children.length < 2) {
      s.error('Tuple requires a minimum of 2 values');
    }

    return node;
  }

  // -------------------------------------------------------------------------
  // Blob: `...` or @tag`...`
  // -------------------------------------------------------------------------
  _parseBlob() {
    const result = this._scanner.readBlob();
    const node   = makeNode(AnvilValueType.Blob);
    node._buf         = this._scanner._buf;
    node._scalarStart = result.contentStart;
    node._scalarEnd   = result.contentEnd;
    node._blobTag     = result.tag;
    return node;
  }

  // -------------------------------------------------------------------------
  // VarRef: $path, $a.b.c, $fn(args)
  // -------------------------------------------------------------------------
  _parseVarRef() {
    const s      = this._scanner;
    const result = s.readVarRefName();

    if (result.isCall) {
      // Callable: $name(args)
      s.expect('(');
      const args = [];
      while (!s.done) {
        s.skipCommas();
        s.skipWhitespaceAndComments();
        if (s.peek() === ')') { s.advance(); break; }
        if (s.peek() === '$') args.push(this._parseVarRef());
        else                  args.push(this._parseScalarValue());
        s.skipCommas();
      }

      const node = makeNode(AnvilValueType.VarRef);
      node._varKind = 'call';
      node._varName = result.path;
      node._varArgs = args;
      this._registry.register(node);
      return node;
    }

    // Simple or dotted ref
    const node = makeNode(AnvilValueType.VarRef);
    node._varKind = 'ref';
    node._varPath = result.path;
    this._registry.register(node);
    return node;
  }

  // -------------------------------------------------------------------------
  // Scalar value — dispatches on current character
  // -------------------------------------------------------------------------
  _parseScalarValue() {
    const s = this._scanner;
    s.skipWhitespaceAndComments();
    const ch = s.peek();

    // Quoted string
    if (ch === '"') {
      const result = s.readQuotedString();
      return this._makeScalarNode(ScalarKind.String, result.start, result.end, result.text, true);
    }

    // Hex color
    const hexLen = s.hexColorLength();
    if (hexLen > 0) {
      const result = s.readHexColor(hexLen);
      return this._makeScalarNode(ScalarKind.Hex, result.start, result.end, result.text, false);
    }

    // DOM selector
    if (s.isSelector()) {
      const result = s.readSelector();
      return this._makeScalarNode(ScalarKind.Selector, result.start, result.end, result.text, false);
    }

    // Bare value — number, path, filename, ident, keyword
    const result = s.readBareValue();

    switch (result.kind) {
      case 'int':    return this._makeScalarNode(ScalarKind.Int,    result.start, result.end, result.text, false);
      case 'float':  return this._makeScalarNode(ScalarKind.Float,  result.start, result.end, result.text, false);
      case 'bool':   return this._makeScalarNode(ScalarKind.Bool,   result.start, result.end, result.text, false);
      case 'null':   return this._makeScalarNode(ScalarKind.Null,   result.start, result.end, result.text, false);
      default:       return this._makeScalarNode(ScalarKind.String, result.start, result.end, result.text, false);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  _makeScalarNode(kind, start, end, text, isQuoted) {
    const node = makeNode(AnvilValueType.Scalar, kind);
    node._buf         = this._scanner._buf;
    node._scalarStart = start;
    node._scalarEnd   = end;
    node._scalarText  = text;    // pre-extracted text for quoted strings
    node._isQuoted    = isQuoted;
    return node;
  }

  // Peek ahead to detect a keyword without consuming
  _peekKeyword(word) {
    const s = this._scanner;
    s.skipWhitespaceAndComments();
    const saved = s.pos;

    // Check each char of word matches
    for (let i = 0; i < word.length; i++) {
      if (s.peek(i) !== word[i]) return false;
    }

    // Must not be followed by ident-continuation chars
    const after = s.peek(word.length);
    const notIdent = !((after >= 'a' && after <= 'z') || (after >= 'A' && after <= 'Z') ||
                       after === '_' || (after >= '0' && after <= '9') || after === '-');
    return notIdent;
  }
}

module.exports = { Parser };

},{"./_error":3,"./_node":4,"./_registry":6,"./_scanner":8,"./_types":10}],6:[function(require,module,exports){
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

},{"./_error":3}],7:[function(require,module,exports){
'use strict';

const { AnvilValueType } = require('./_types');

// ---------------------------------------------------------------------------
// Resolver
//
// Runtime resolution of VarRef nodes. Injected with the Registry from a
// parsed document. Consumer registers live values and functions against it.
//
// Two tiers:
//   Static  — vars block entries, pre-warmed from registry at construction
//   Dynamic — runtime refs, resolved when consumer calls bind()/register()
//
// Usage:
//   const resolver = root.getResolver();
//   resolver.bind('record', liveRecordObject);
//   resolver.register('sum', (...args) => args.reduce((a, b) => a + b, 0));
//   const value = resolver.evaluate(node);
//   resolver.observe('record.odometer', (newVal) => { ... });
// ---------------------------------------------------------------------------
class Resolver {
  constructor(registry) {
    this._registry = registry;
    this._static   = new Map();   // pre-warmed vars
    this._bindings = new Map();   // namespace → object
    this._functions = new Map();  // name → callable
    this._observers = new Map();  // path → Set<callback>

    this._resolveStatics();
  }

  // Pre-warm vars block entries — topological order for cross-refs
  _resolveStatics() {
    const vars = this._registry.vars;
    if (!vars || vars.size === 0) return;

    const literals = new Map();
    const deferred = new Map();

    for (const [name, node] of vars) {
      if (node.type === AnvilValueType.VarRef) {
        deferred.set(name, node);
      } else {
        literals.set(name, node.asString());
      }
    }

    for (const [name, value] of literals) this._static.set(name, value);

    // Iterative topological resolution for deferred vars
    let remaining = new Map(deferred);
    let maxPasses = remaining.size + 1;
    while (remaining.size > 0 && maxPasses-- > 0) {
      for (const [name, node] of remaining) {
        try {
          const value = this._evaluateVarRef(node);
          if (value !== undefined) {
            this._static.set(name, value);
            remaining.delete(name);
          }
        } catch { /* dependency not yet resolved */ }
      }
    }
  }

  // Register a live object under a namespace for dotted path resolution
  bind(namespace, object) {
    this._bindings.set(namespace, object);
    this._notifyNamespace(namespace);
    return this;
  }

  // Register a callable for $name(...) resolution
  register(name, fn) {
    this._functions.set(name, fn);
    return this;
  }

  // Evaluate a VarRef node to its current value
  evaluate(node) {
    if (!node || node.type !== AnvilValueType.VarRef) return undefined;
    return this._evaluateVarRef(node);
  }

  _evaluateVarRef(node) {
    if (node._varKind === 'call') return this._evaluateCall(node);
    return this._evaluatePath(node._varPath);
  }

  _evaluatePath(path) {
    if (this._static.has(path)) return this._static.get(path);
    const parts = path.split('.');
    if (parts.length === 1) return this._bindings.get(path);
    const [namespace, ...rest] = parts;
    let obj = this._bindings.get(namespace);
    for (const key of rest) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  }

  _evaluateCall(node) {
    const fn = this._functions.get(node._varName);
    if (!fn) return undefined;
    const args = (node._varArgs || []).map(arg => this._evaluateVarRef(arg));
    return fn(...args);
  }

  // Observe a dotted path — callback fires when value changes
  observe(path, callback) {
    if (!this._observers.has(path)) this._observers.set(path, new Set());
    this._observers.get(path).add(callback);
    return this;
  }

  unobserve(path, callback) {
    this._observers.get(path)?.delete(callback);
    return this;
  }

  _notifyNamespace(namespace) {
    for (const [path, callbacks] of this._observers) {
      if (path.split('.')[0] !== namespace) continue;
      const value = this._evaluatePath(path);
      for (const cb of callbacks) cb(value, path);
    }
  }

  // Introspection
  get refPaths()  {
    return this._registry.refs
      .filter(n => n._varKind === 'ref')
      .map(n => n._varPath);
  }

  get callNames() {
    return [...new Set(
      this._registry.refs
        .filter(n => n._varKind === 'call')
        .map(n => n._varName)
    )];
  }

  get statics() { return Object.fromEntries(this._static); }
}

module.exports = { Resolver };

},{"./_types":10}],8:[function(require,module,exports){
'use strict';

const { AnvilParseError } = require('./_error');

// ---------------------------------------------------------------------------
// Scanner
//
// Single-pass, character-at-a-time reader over a SourceBuffer.
// No token array. No regex. Context-aware scanning driven by the parser.
//
// The parser calls purposeful scan methods that answer specific questions
// and consume exactly what they claim. Lookahead methods are named for
// what they're looking for and return actionable results.
// ---------------------------------------------------------------------------

// Character classification — single-character, no regex
function isLetter(ch)     { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'); }
function isDigit(ch)      { return ch >= '0' && ch <= '9'; }
function isHexDigit(ch)   { return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'); }
function isIdentStart(ch) { return isLetter(ch) || ch === '_'; }
function isWhitespace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'; }

// Characters that terminate a bare value token in any context
function isStructural(ch) {
  return ch === '{' || ch === '}' ||
         ch === '[' || ch === ']' ||
         ch === '(' || ch === ')' ||
         ch === ',' || ch === '"' ||
         ch === '`' || ch === '#' ||
         ch === '$' || ch === '@' ||
         ch === ':' || ch === '=';
}

class Scanner {
  constructor(buf) {
    this._buf = buf;
    this._src = buf.str;
    this._len = buf.length;
    this._pos = 0;
  }

  // -------------------------------------------------------------------------
  // Position and basic access
  // -------------------------------------------------------------------------
  get pos()    { return this._pos; }
  get done()   { return this._pos >= this._len; }

  peek(offset = 0) {
    const i = this._pos + offset;
    return i < this._len ? this._src[i] : '';
  }

  advance() {
    return this._pos < this._len ? this._src[this._pos++] : '';
  }

  slice(start, end) {
    return this._buf.sliceStr(start, end);
  }

  lineCol(pos) {
    return this._buf.lineCol(pos ?? this._pos);
  }

  error(msg, pos) {
    const { line, col } = this.lineCol(pos ?? this._pos);
    throw new AnvilParseError(msg, line, col);
  }

  // -------------------------------------------------------------------------
  // Whitespace and comments
  // -------------------------------------------------------------------------
  skipWhitespaceAndComments() {
    while (!this.done) {
      // Whitespace
      if (isWhitespace(this.peek())) {
        this._pos++;
        continue;
      }

      // Single-line comment //
      if (this.peek() === '/' && this.peek(1) === '/') {
        this._pos += 2;
        while (!this.done && this.peek() !== '\n') this._pos++;
        continue;
      }

      // Block comment /* ... */
      if (this.peek() === '/' && this.peek(1) === '*') {
        const start = this._pos;
        this._pos += 2;
        while (!this.done) {
          if (this.peek() === '*' && this.peek(1) === '/') {
            this._pos += 2;
            break;
          }
          this._pos++;
        }
        if (this.done) this.error('Unterminated block comment', start);
        continue;
      }

      break;
    }
  }

  // -------------------------------------------------------------------------
  // Purposeful lookahead — each answers a specific question
  // -------------------------------------------------------------------------

  // Is the current position a shebang (#!) before any non-whitespace?
  isShebang() {
    if (this.peek() !== '#' || this.peek(1) !== '!') return false;
    for (let i = 0; i < this._pos; i++) {
      if (!isWhitespace(this._src[i])) return false;
    }
    return true;
  }

  // Is := at current position?
  isAssign() {
    return this.peek() === ':' && this.peek(1) === '=';
  }

  // Is the current # a hex color?
  // Returns 6, 3, or 0 (not a hex color)
  hexColorLength() {
    if (this.peek() !== '#') return 0;
    // Try 6-digit
    let all6 = true;
    for (let i = 1; i <= 6; i++) {
      if (!isHexDigit(this.peek(i))) { all6 = false; break; }
    }
    if (all6 && !isIdentStart(this.peek(7)) && !isDigit(this.peek(7)) && this.peek(7) !== '-') return 6;
    // Try 3-digit
    let all3 = true;
    for (let i = 1; i <= 3; i++) {
      if (!isHexDigit(this.peek(i))) { all3 = false; break; }
    }
    if (all3 && !isIdentStart(this.peek(4)) && !isDigit(this.peek(4)) && this.peek(4) !== '-') return 3;
    return 0;
  }

  // Is the current # a DOM selector (#identifier)?
  isSelector() {
    return this.peek() === '#' && isIdentStart(this.peek(1));
  }

  // Is the current position a float literal?
  // digits (. digits)? — only true if there ARE digits then . then digit
  isFloat() {
    if (!isDigit(this.peek()) && !(this.peek() === '-' && isDigit(this.peek(1)))) return false;
    let i = this.peek() === '-' ? 1 : 0;
    while (isDigit(this.peek(i))) i++;
    return this.peek(i) === '.' && isDigit(this.peek(i + 1));
  }

  // Is the current position a relative path (../ or ./)?
  isRelativePath() {
    if (this.peek() === '.' && this.peek(1) === '.' && this.peek(2) === '/') return true;
    if (this.peek() === '.' && this.peek(1) === '/') return true;
    return false;
  }

  // Is the current position a tagged blob (@ident`)?
  isTaggedBlob() {
    if (this.peek() !== '@') return false;
    let i = 1;
    if (!isIdentStart(this.peek(i))) return false;
    while (isIdentStart(this.peek(i)) || isDigit(this.peek(i)) || this.peek(i) === '-') i++;
    return this.peek(i) === '`';
  }

  // Is the current position an attribute list (@[)?
  isAttrList() {
    return this.peek() === '@' && this.peek(1) === '[';
  }

  // -------------------------------------------------------------------------
  // Structural character readers
  // -------------------------------------------------------------------------

  // Consume a specific expected character or string, error if not found
  expect(ch) {
    this.skipWhitespaceAndComments();
    if (this.peek() !== ch) {
      this.error(`Expected '${ch}', got '${this.peek() || 'EOF'}'`);
    }
    return this.advance();
  }

  // Consume := (two chars)
  expectAssign() {
    this.skipWhitespaceAndComments();
    if (!this.isAssign()) {
      this.error(`Expected ':=', got '${this.peek()}${this.peek(1)}'`);
    }
    this._pos += 2;
  }

  // Consume optional commas
  skipCommas() {
    while (!this.done) {
      this.skipWhitespaceAndComments();
      if (this.peek() === ',') this._pos++;
      else break;
    }
  }

  // -------------------------------------------------------------------------
  // Token readers — consume and return
  // -------------------------------------------------------------------------

  // Read shebang line — must be called when isShebang() is true
  readShebang() {
    const start = this._pos;
    this._pos += 2; // skip #!
    while (!this.done && this.peek() !== '\n') this._pos++;
    return this.slice(start, this._pos);
  }

  // Read an identifier (letters, digits, underscore, hyphen)
  // Used for: statement names, field names, keyword detection
  readIdent() {
    this.skipWhitespaceAndComments();
    const start = this._pos;
    if (!isIdentStart(this.peek())) {
      this.error(`Expected identifier, got '${this.peek() || 'EOF'}'`);
    }
    this._pos++;
    while (!this.done) {
      const ch = this.peek();
      if (isIdentStart(ch) || isDigit(ch) || ch === '-') this._pos++;
      else break;
    }
    return this.slice(start, this._pos);
  }

  // Read a bare value token — context-aware, no regex
  // Called in value position (after :=, inside [], (), {})
  // Handles: paths (../x, ./x, a/b/c), dotted names (a.b.c),
  //          filenames (foo.tar.gz), version strings (1.2.3),
  //          plain idents, keywords
  readBareValue() {
    this.skipWhitespaceAndComments();
    const start = this._pos;

    // Leading sign for numbers
    if (this.peek() === '-' && isDigit(this.peek(1))) {
      this._pos++;
    }

    // Relative path prefix ../ or ./
    if (this.isRelativePath()) {
      return this._readPathValue(start);
    }

    // Digit-led — int, float, or version/compound (1.2.3, 1.2.3.4)
    if (isDigit(this.peek())) {
      return this._readNumericValue(start);
    }

    // Letter/underscore-led — ident, path, filename, keyword
    if (isIdentStart(this.peek())) {
      return this._readIdentValue(start);
    }

    this.error(`Unexpected character '${this.peek()}' in value position`);
  }

  // Numeric value — reads digits, then decides int vs float vs compound
  _readNumericValue(start) {
    while (!this.done && isDigit(this.peek())) this._pos++;

    // Float: digits . digits
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this._pos++; // consume .
      while (!this.done && isDigit(this.peek())) this._pos++;
      // Optional exponent
      if (this.peek() === 'e' || this.peek() === 'E') {
        this._pos++;
        if (this.peek() === '+' || this.peek() === '-') this._pos++;
        while (!this.done && isDigit(this.peek())) this._pos++;
      }
      // Check for compound (1.2.3) — another dot means it's a bare string
      if (this.peek() === '.') {
        return this._readCompoundValue(start);
      }
      return { kind: 'float', start, end: this._pos, text: this.slice(start, this._pos) };
    }

    // Version/compound: digits . digits . ... (1.2.3)
    if (this.peek() === '.' && !isDigit(this.peek(1))) {
      // dot not followed by digit — could be filename suffix or path
      return this._readCompoundValue(start);
    }

    return { kind: 'int', start, end: this._pos, text: this.slice(start, this._pos) };
  }

  // Ident-led value — ident, keyword, path, filename
  _readIdentValue(start) {
    // Consume ident chars
    while (!this.done) {
      const ch = this.peek();
      if (isIdentStart(ch) || isDigit(ch) || ch === '-') this._pos++;
      else break;
    }

    // Check for path/filename continuation: . or /
    if (this.peek() === '.' || this.peek() === '/') {
      return this._readCompoundValue(start);
    }

    const text = this.slice(start, this._pos);
    // Keyword detection
    if (text === 'true')  return { kind: 'bool', start, end: this._pos, text };
    if (text === 'false') return { kind: 'bool', start, end: this._pos, text };
    if (text === 'null')  return { kind: 'null', start, end: this._pos, text };
    return { kind: 'ident', start, end: this._pos, text };
  }

  // Compound value — paths, filenames, version strings, dotted names
  // Continues consuming . / and ident/digit segments until structural char
  _readCompoundValue(start) {
    while (!this.done) {
      const ch = this.peek();
      if (isIdentStart(ch) || isDigit(ch) || ch === '-' ||
          ch === '.' || ch === '/') {
        this._pos++;
      } else {
        break;
      }
    }
    return { kind: 'string', start, end: this._pos, text: this.slice(start, this._pos) };
  }

  // Path value starting with ./ or ../
  _readPathValue(start) {
    while (!this.done) {
      const ch = this.peek();
      if (isIdentStart(ch) || isDigit(ch) || ch === '-' ||
          ch === '.' || ch === '/') {
        this._pos++;
      } else {
        break;
      }
    }
    return { kind: 'string', start, end: this._pos, text: this.slice(start, this._pos) };
  }

  // Read a quoted string — "..."
  readQuotedString() {
    this.skipWhitespaceAndComments();
    const start = this._pos;
    this.expect('"');
    while (!this.done) {
      const ch = this.peek();
      if (ch === '\\') { this._pos += 2; continue; }
      if (ch === '"')  { this._pos++; break; }
      if (ch === '\n') this.error('Unterminated string literal', start);
      this._pos++;
    }
    return { kind: 'string', start, end: this._pos, text: this.slice(start + 1, this._pos - 1) };
  }

  // Read hex color — call only when hexColorLength() > 0
  readHexColor(len) {
    const start = this._pos;
    this._pos += 1 + len; // # + digits
    return { kind: 'hex', start, end: this._pos, text: this.slice(start, this._pos) };
  }

  // Read selector — call only when isSelector() is true
  readSelector() {
    const start = this._pos;
    this._pos++; // skip #
    while (!this.done) {
      const ch = this.peek();
      if (isIdentStart(ch) || isDigit(ch) || ch === '-') this._pos++;
      else break;
    }
    return { kind: 'selector', start, end: this._pos, text: this.slice(start, this._pos) };
  }

  // Read blob content — tagged @tag`...` or untagged `...`
  readBlob() {
    const start = this._pos;
    let tag = null;

    if (this.peek() === '@') {
      this._pos++; // skip @
      const tagStart = this._pos;
      while (!this.done && (isIdentStart(this.peek()) || isDigit(this.peek()) || this.peek() === '-')) {
        this._pos++;
      }
      tag = this.slice(tagStart, this._pos);
      if (this.peek() !== '`') {
        this.error(`Expected backtick after blob tag "@${tag}"`);
      }
    }

    this._pos++; // skip opening `
    const contentStart = this._pos;
    while (!this.done) {
      if (this.peek() === '`') {
        const contentEnd = this._pos;
        this._pos++; // skip closing `
        return { kind: 'blob', tag, contentStart, contentEnd, start, end: this._pos };
      }
      this._pos++;
    }
    this.error('Unterminated blob literal', start);
  }

  // Read a VarRef path: $ident(.ident)* or $ident(args)
  // Returns the path string and whether it's followed by (
  readVarRefName() {
    this.skipWhitespaceAndComments();
    if (this.peek() !== '$') this.error(`Expected '$', got '${this.peek()}'`);
    this._pos++; // skip $

    const start = this._pos;
    if (!isIdentStart(this.peek())) {
      this.error(`Expected identifier after '$'`);
    }

    // Read first segment
    while (!this.done && (isIdentStart(this.peek()) || isDigit(this.peek()) || this.peek() === '-')) {
      this._pos++;
    }

    // Consume dotted path segments: .ident.ident...
    while (this.peek() === '.') {
      // Only consume if next char after . is a letter/underscore (not a digit — avoids float ambiguity)
      if (isIdentStart(this.peek(1))) {
        this._pos++; // consume .
        while (!this.done && (isIdentStart(this.peek()) || isDigit(this.peek()) || this.peek() === '-')) {
          this._pos++;
        }
      } else {
        break;
      }
    }

    const path = this.slice(start, this._pos);
    const isCall = this.peek() === '(';
    return { path, isCall };
  }

  // Read attribute list content @[key=value, flag, ...]
  // Returns Map<string, string|null>
  readAttrList() {
    this.skipWhitespaceAndComments();
    if (!this.isAttrList()) this.error(`Expected '@['`);
    this._pos += 2; // skip @[

    const attrs = new Map();
    while (!this.done) {
      this.skipWhitespaceAndComments();
      if (this.peek() === ']') { this._pos++; break; }
      if (this.peek() === ',') { this._pos++; continue; }

      // Read key
      const key = this.readIdent();
      this.skipWhitespaceAndComments();

      if (this.peek() === '=') {
        this._pos++; // consume =
        this.skipWhitespaceAndComments();
        // Value — read until , or ]
        const valStart = this._pos;
        while (!this.done && this.peek() !== ',' && this.peek() !== ']') this._pos++;
        attrs.set(key, this.slice(valStart, this._pos).trim());
      } else {
        attrs.set(key, null); // flag
      }
    }
    return attrs;
  }
}

module.exports = { Scanner, isIdentStart, isDigit, isWhitespace, isStructural };

},{"./_error":3}],9:[function(require,module,exports){
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

},{"./_types":10}],10:[function(require,module,exports){
'use strict';

// ---------------------------------------------------------------------------
// TokenType — produced by the Lexer
// ---------------------------------------------------------------------------
const TokenType = Object.freeze({
  SHEBANG:    'SHEBANG',
  IDENT:      'IDENT',
  STRING:     'STRING',
  INT:        'INT',
  FLOAT:      'FLOAT',
  BOOL:       'BOOL',
  NULL:       'NULL',
  HEX_COLOR:  'HEX_COLOR',
  SELECTOR:   'SELECTOR',    // #identifier — DOM selector
  BACKTICK:   'BACKTICK',    // `...` blob content
  ASSIGN:     'ASSIGN',      // :=
  COLON:      'COLON',       // :
  LBRACE:     'LBRACE',      // {
  RBRACE:     'RBRACE',      // }
  LBRACKET:   'LBRACKET',    // [
  RBRACKET:   'RBRACKET',    // ]
  LPAREN:     'LPAREN',      // (
  RPAREN:     'RPAREN',      // )
  DOLLAR:     'DOLLAR',      // $
  AT:         'AT',          // @
  EQUALS:     'EQUALS',      // = (attribute key=value only)
  COMMA:      'COMMA',       // ,
  EOF:        'EOF',
});

// ---------------------------------------------------------------------------
// AnvilValueType — node type as seen by the consumer
// ---------------------------------------------------------------------------
const AnvilValueType = Object.freeze({
  Scalar: 'Scalar',
  Object: 'Object',
  Array:  'Array',
  Tuple:  'Tuple',
  Blob:   'Blob',
  VarRef: 'VarRef',  // deferred reference — resolved by runtime, never by parser
});

// ---------------------------------------------------------------------------
// ScalarKind — sub-type of Scalar nodes
// ---------------------------------------------------------------------------
const ScalarKind = Object.freeze({
  String:   'String',
  Int:      'Int',
  Float:    'Float',
  Bool:     'Bool',
  Null:     'Null',
  Hex:      'Hex',
  Selector: 'Selector',   // #identifier — DOM/CSS selector
});

// ---------------------------------------------------------------------------
// AnvilDialect — detected from shebang
// ---------------------------------------------------------------------------
const AnvilDialect = Object.freeze({
  Aml:     'Aml',
  Amp:     'Amp',
  Asl:     'Asl',
  Unknown: 'Unknown',
});

module.exports = { TokenType, AnvilValueType, ScalarKind, AnvilDialect };

},{}],11:[function(require,module,exports){
'use strict';

const { AnvilValueType, ScalarKind } = require('./_types');

// ---------------------------------------------------------------------------
// Writer
//
// Serializes an AnvilNode tree back to AML text.
//
// Modes:
//   preserve  (default) — VarRefs write back as $path / $a.b / $fn(...)
//   snapshot             — VarRefs resolved via resolver; unbound refs
//                           become their unresolved source syntax as a
//                           quoted string
//
// Options:
//   mode             'preserve' | 'snapshot'   (default 'preserve')
//   resolver         Resolver — required for 'snapshot'
//   indentWidth      number                    (default 2)
//   minified         boolean                   (default false)
//   inlineThreshold  number                    (default 0 — never inline)
//   quoteAllStrings  boolean                   (default false)
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
  mode: 'preserve',
  resolver: null,
  indentWidth: 2,
  minified: false,
  inlineThreshold: 0,
  quoteAllStrings: false,
};

function write(root, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.mode === 'snapshot' && !opts.resolver) {
    throw new Error('Anvil.Writer: snapshot mode requires a resolver');
  }

  const ctx = new WriterContext(opts);
  return ctx.writeRoot(root);
}

// ---------------------------------------------------------------------------
// WriterContext — holds options and formatting state during a write pass
// ---------------------------------------------------------------------------
class WriterContext {
  constructor(opts) {
    this.opts = opts;
  }

  // -------------------------------------------------------------------------
  // Root — vars block, root attributes, top-level statements
  // -------------------------------------------------------------------------
  writeRoot(root) {
    const lines = [];

    // Root attributes
    if (root._attrs && root._attrs.size > 0) {
      lines.push(this.writeAttrList(root._attrs));
    }

    // vars block
    if (root._vars && root._vars.size > 0) {
      lines.push(this.writeVarsBlock(root._vars, 0));
    }

    // Top-level statements / anonymous blocks
    const keys = root._fieldOrder || [];
    const stmts = [];
    for (const key of keys) {
      const node = root._fields.get(key);
      stmts.push(this.writeStatement(key, node, 0));
    }

    if (this.opts.minified) {
      lines.push(stmts.join(','));
    } else {
      lines.push(stmts.join('\n'));
    }

    return lines.filter(l => l.length > 0).join(this.opts.minified ? ',' : '\n');
  }

  // -------------------------------------------------------------------------
  // vars block
  // -------------------------------------------------------------------------
  writeVarsBlock(vars, depth) {
    const ind  = this.indent(depth);
    const ind1 = this.indent(depth + 1);
    const entries = [];

    for (const [name, node] of vars) {
      entries.push(`${ind1}${name}${this.assignOp()}${this.writeValue(node, depth + 1)}`);
    }

    if (this.opts.minified) {
      return `vars{${entries.map(e => e.trim()).join(',')}}`;
    }
    return `vars {\n${entries.join('\n')}\n${ind}}`;
  }

  // -------------------------------------------------------------------------
  // Top-level statement or anonymous block
  //   name (: base)? (@[...])? := value
  //   name (: base)? (@[...])? { ... }   — anonymous block
  // -------------------------------------------------------------------------
  writeStatement(name, node, depth) {
    const ind = this.indent(depth);
    let prefix = `${ind}${name}`;

    if (node.hasBase) {
      prefix += ` : ${node.baseIdentifier}`;
    }

    if (node._attrs && node._attrs.size > 0) {
      prefix += ` ${this.writeAttrList(node._attrs)}`;
    }

    if (node._anonymous) {
      return `${prefix} ${this.writeValue(node, depth)}`;
    }

    return `${prefix}${this.assignOp()}${this.writeValue(node, depth)}`;
  }

  // -------------------------------------------------------------------------
  // Dispatch by node type
  // -------------------------------------------------------------------------
  writeValue(node, depth) {
    switch (node.type) {
      case AnvilValueType.Object: return this.writeObject(node, depth);
      case AnvilValueType.Array:  return this.writeArray(node, depth);
      case AnvilValueType.Tuple:  return this.writeTuple(node, depth);
      case AnvilValueType.Blob:   return this.writeBlob(node);
      case AnvilValueType.VarRef: return this.writeVarRef(node);
      case AnvilValueType.Scalar: return this.writeScalar(node);
      default:
        throw new Error(`Anvil.Writer: unknown node type "${node.type}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Object
  // -------------------------------------------------------------------------
  writeObject(node, depth) {
    const keys = node._fieldOrder || [];

    if (keys.length === 0) return '{}';

    const ind  = this.indent(depth);
    const ind1 = this.indent(depth + 1);

    const fields = keys.map(key => {
      const fieldNode = node._fields.get(key);
      let prefix = `${ind1}${key}`;
      if (fieldNode._attrs && fieldNode._attrs.size > 0) {
        prefix += ` ${this.writeAttrList(fieldNode._attrs)}`;
      }
      return `${prefix}${this.assignOp()}${this.writeValue(fieldNode, depth + 1)}`;
    });

    if (this.opts.minified) {
      return `{${fields.map(f => f.trim()).join(',')}}`;
    }

    if (this.canInline(keys.length)) {
      const inline = fields.map(f => f.trim()).join(', ');
      return `{ ${inline} }`;
    }

    return `{\n${fields.join('\n')}\n${ind}}`;
  }

  // -------------------------------------------------------------------------
  // Array
  // -------------------------------------------------------------------------
  writeArray(node, depth) {
    return this.writeSequence(node, depth, '[', ']');
  }

  // -------------------------------------------------------------------------
  // Tuple
  // -------------------------------------------------------------------------
  writeTuple(node, depth) {
    return this.writeSequence(node, depth, '(', ')');
  }

  writeSequence(node, depth, open, close) {
    const children = node._children || [];
    if (children.length === 0) return `${open}${close}`;

    // If every element is a scalar/varref, inline regardless of count
    const allSimple = children.every(c =>
      c.type === AnvilValueType.Scalar || c.type === AnvilValueType.VarRef
    );

    if (this.opts.minified || allSimple) {
      const items = children.map(c => this.writeValue(c, depth));
      return `${open}${items.join(this.opts.minified ? ',' : ', ')}${close}`;
    }

    // Complex elements (objects/arrays/tuples) — one per line
    const ind  = this.indent(depth);
    const ind1 = this.indent(depth + 1);
    const items = children.map(c => `${ind1}${this.writeValue(c, depth + 1)}`);
    return `${open}\n${items.join('\n')}\n${ind}${close}`;
  }

  // -------------------------------------------------------------------------
  // Blob
  // -------------------------------------------------------------------------
  writeBlob(node) {
    const content = node.asString();
    const tag = node.blobTag;
    return tag ? `@${tag}\`${content}\`` : `\`${content}\``;
  }

  // -------------------------------------------------------------------------
  // Scalar
  // -------------------------------------------------------------------------
  writeScalar(node) {
    switch (node.kind) {
      case ScalarKind.String:
        return this.writeStringValue(node.asString());
      case ScalarKind.Int:
      case ScalarKind.Float:
      case ScalarKind.Bool:
      case ScalarKind.Null:
        return node.asString();
      case ScalarKind.Hex:
        return node.asString(); // canonical #RRGGBB
      case ScalarKind.Selector:
        return node.asSelector(); // #identifier, hash included
      default:
        return node.asString();
    }
  }

  // -------------------------------------------------------------------------
  // String formatting policy
  //   bare if no whitespace/special chars, quoted otherwise
  //   quoteAllStrings forces quotes always
  // -------------------------------------------------------------------------
  writeStringValue(str) {
    if (this.opts.quoteAllStrings || this.needsQuoting(str)) {
      return this.quoteString(str);
    }
    return str;
  }

  needsQuoting(str) {
    if (str.length === 0) return true;
    // Needs quoting if it contains whitespace, or characters that
    // would be misinterpreted by the lexer (commas, braces, etc.)
    return /[\s,{}\[\]()"'`#@$:]/.test(str) ||
           str === 'true' || str === 'false' || str === 'null';
  }

  quoteString(str) {
    const escaped = str
      .replace(/\\/g, '\\\\')
      .replace(/"/g,  '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r');
    return `"${escaped}"`;
  }

  // -------------------------------------------------------------------------
  // VarRef
  //   preserve — re-emit $path / $a.b / $fn(args)
  //   snapshot — resolve via resolver; unbound → unresolved syntax as string
  // -------------------------------------------------------------------------
  writeVarRef(node) {
    if (this.opts.mode === 'preserve') {
      return this.varRefSyntax(node);
    }

    // snapshot mode
    const value = this.opts.resolver.evaluate(node);
    if (value === undefined) {
      // Unbound — write the unresolved source syntax as a quoted string
      return this.quoteString(this.varRefSyntax(node));
    }

    return this.writeResolvedValue(value);
  }

  // Reconstruct $path / $a.b / $fn(args) from node fields
  varRefSyntax(node) {
    if (node._varKind === 'call') {
      const args = (node._varArgs || []).map(a => this.varRefSyntax(a)).join(', ');
      return `$${node._varName}(${args})`;
    }
    return `$${node._varPath}`;
  }

  // Write a resolved JS value back as AML
  writeResolvedValue(value) {
    if (value === null)               return 'null';
    if (typeof value === 'boolean')   return value ? 'true' : 'false';
    if (typeof value === 'number')    return String(value);
    if (typeof value === 'string')    return this.writeStringValue(value);
    // Fallback — stringify
    return this.writeStringValue(String(value));
  }

  // -------------------------------------------------------------------------
  // Attributes — @[key=value, flag]
  // -------------------------------------------------------------------------
  writeAttrList(attrs) {
    const parts = [];
    for (const [key, val] of attrs) {
      if (val === null) parts.push(key);
      else               parts.push(`${key}=${val}`);
    }
    return `@[${parts.join(', ')}]`;
  }

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------
  assignOp() {
    return this.opts.minified ? ':=' : ' := ';
  }

  indent(depth) {
    if (this.opts.minified) return '';
    return ' '.repeat(this.opts.indentWidth * depth);
  }

  canInline(fieldCount) {
    if (this.opts.minified) return false;
    return this.opts.inlineThreshold > 0 && fieldCount <= this.opts.inlineThreshold;
  }
}

module.exports = { write };

},{"./_types":10}],12:[function(require,module,exports){
'use strict';

const { SourceBuffer }    = require('./_buffer');
const { Parser }          = require('./_parser');
const { wireInheritance } = require('./_registry');
const { AnvilError }      = require('./_error');
const { write }           = require('./_writer');
const { deserialize }     = require('./_serializer');

const { AnvilValueType, ScalarKind, AnvilDialect } = require('./_types');
const { InvalidOperationError, KeyError, IndexError } = require('./_error');

let _lastError = null;

function parse(source, path = null) {
  _lastError = null;
  try {
    const buf    = new SourceBuffer(source, path);
    const parser = new Parser(buf);
    const root   = parser.parse();

    root._registry = parser._registry;

    wireInheritance(parser.inheritancePairs, parser.statements);

    return root;
  } catch (err) {
    _lastError = new AnvilError(
      err.message,
      err.line   ?? 0,
      err.column ?? 0,
      path
    );
    return null;
  }
}

function load(filePath) {
  _lastError = null;
  let source;
  try {
    const fs = require('fs');
    source = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    _lastError = new AnvilError(`Cannot read file: ${err.message}`, 0, 0, filePath);
    return null;
  }
  return parse(source, filePath);
}

function lastError() { return _lastError; }

module.exports = {
  parse,
  load,
  lastError,
  write,
  deserialize,
  AnvilValueType,
  ScalarKind,
  AnvilDialect,
  InvalidOperationError,
  KeyError,
  IndexError,
};

},{"./_buffer":2,"./_error":3,"./_parser":5,"./_registry":6,"./_serializer":9,"./_types":10,"./_writer":11,"fs":1}]},{},[12])(12)
});
