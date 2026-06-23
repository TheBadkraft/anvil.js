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
