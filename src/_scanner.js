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
