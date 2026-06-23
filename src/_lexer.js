'use strict';

const { TokenType } = require('./_types');
const { AnvilParseError } = require('./_error');

function isDigit(ch)      { return ch >= '0' && ch <= '9'; }
function isHexDigit(ch)   { return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'); }
function isIdentStart(ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'; }
function isIdentCont(ch)  { return isIdentStart(ch) || isDigit(ch) || ch === '-' || ch === '.' || ch === '/'; }
function isWhitespace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'; }

class Lexer {
  constructor(buf) {
    this._buf = buf;
    this._src = buf.str;
    this._pos = 0;
    this._len = buf.length;
  }

  tokenise() {
    const tokens = [];
    while (this._pos < this._len) {
      const tok = this._scanOne();
      if (tok !== null) tokens.push(tok);
    }
    tokens.push({ type: TokenType.EOF, start: this._len, end: this._len });
    return tokens;
  }

  _peek(offset = 0) { return this._src[this._pos + offset] ?? ''; }
  _advance()        { return this._src[this._pos++]; }
  _lineCol(pos)     { return this._buf.lineCol(pos ?? this._pos); }

  _error(msg, pos) {
    const { line, col } = this._lineCol(pos ?? this._pos);
    throw new AnvilParseError(msg, line, col);
  }

  _scanOne() {
    // Skip whitespace
    while (this._pos < this._len && isWhitespace(this._src[this._pos])) this._pos++;
    if (this._pos >= this._len) return null;

    const start = this._pos;
    const ch    = this._src[this._pos];

    // Shebang — #! before any non-whitespace content
    if (ch === '#' && this._peek(1) === '!') {
      let onlyWhitespaceBefore = true;
      for (let i = 0; i < start; i++) {
        if (!isWhitespace(this._src[i])) { onlyWhitespaceBefore = false; break; }
      }
      if (onlyWhitespaceBefore) {
        this._pos += 2;
        while (this._pos < this._len && this._src[this._pos] !== '\n') this._pos++;
        return { type: TokenType.SHEBANG, start, end: this._pos };
      }
    }

    // # — hex color or DOM selector
    if (ch === '#') return this._scanHexOrSelector(start);

    // Comments
    if (ch === '/') {
      if (this._peek(1) === '/') {
        this._pos += 2;
        while (this._pos < this._len && this._src[this._pos] !== '\n') this._pos++;
        return null;
      }
      if (this._peek(1) === '*') {
        this._pos += 2;
        while (this._pos < this._len) {
          if (this._src[this._pos] === '*' && this._peek(1) === '/') { this._pos += 2; return null; }
          this._pos++;
        }
        this._error('Unterminated block comment', start);
      }
      this._error(`Unexpected character '/'`, start);
    }

    // Quoted string
    if (ch === '"') return this._scanString(start);

    // Backtick — untagged blob
    if (ch === '`') return this._scanBlob(start, null);

    // := or :
    if (ch === ':') {
      if (this._peek(1) === '=') { this._pos += 2; return { type: TokenType.ASSIGN, start, end: this._pos }; }
      this._pos++;
      return { type: TokenType.COLON, start, end: this._pos };
    }

    // = (attribute key=value only)
    if (ch === '=') { this._pos++; return { type: TokenType.EQUALS, start, end: this._pos }; }

    // @ — attribute list @[...] or tagged blob @tag`...`
    if (ch === '@') {
      const next = this._peek(1);
      if (next === '[') { this._pos++; return { type: TokenType.AT, start, end: this._pos }; }
      if (isIdentStart(next)) return this._scanTaggedBlob(start);
      this._pos++;
      return { type: TokenType.AT, start, end: this._pos };
    }

    // Structural
    if (ch === '{') { this._pos++; return { type: TokenType.LBRACE,   start, end: this._pos }; }
    if (ch === '}') { this._pos++; return { type: TokenType.RBRACE,   start, end: this._pos }; }
    if (ch === '[') { this._pos++; return { type: TokenType.LBRACKET, start, end: this._pos }; }
    if (ch === ']') { this._pos++; return { type: TokenType.RBRACKET, start, end: this._pos }; }
    if (ch === '(') { this._pos++; return { type: TokenType.LPAREN,   start, end: this._pos }; }
    if (ch === ')') { this._pos++; return { type: TokenType.RPAREN,   start, end: this._pos }; }
    if (ch === ',') { this._pos++; return { type: TokenType.COMMA,    start, end: this._pos }; }
    if (ch === '$') { this._pos++; return { type: TokenType.DOLLAR,   start, end: this._pos }; }

    // Negative number
    if (ch === '-' && isDigit(this._peek(1))) return this._scanNumber(start);

    // Number
    if (isDigit(ch)) return this._scanNumber(start);

    // Identifier / keyword / bare string
    if (isIdentStart(ch)) return this._scanIdent(start);

    this._error(`Unexpected character '${ch}'`, start);
  }

  _scanString(start) {
    this._pos++; // opening "
    while (this._pos < this._len) {
      const c = this._src[this._pos];
      if (c === '\\') { this._pos += 2; continue; }
      if (c === '"')  { this._pos++; return { type: TokenType.STRING, start, end: this._pos }; }
      if (c === '\n') this._error('Unterminated string literal', start);
      this._pos++;
    }
    this._error('Unterminated string literal', start);
  }

  _scanNumber(start) {
    if (this._src[this._pos] === '-') this._pos++;
    while (this._pos < this._len && isDigit(this._src[this._pos])) this._pos++;
    if (this._src[this._pos] === '.' && isDigit(this._src[this._pos + 1] ?? '')) {
      this._pos++;
      while (this._pos < this._len && isDigit(this._src[this._pos])) this._pos++;
      const e = this._src[this._pos];
      if (e === 'e' || e === 'E') {
        this._pos++;
        if (this._src[this._pos] === '+' || this._src[this._pos] === '-') this._pos++;
        while (this._pos < this._len && isDigit(this._src[this._pos])) this._pos++;
      }
      return { type: TokenType.FLOAT, start, end: this._pos };
    }
    return { type: TokenType.INT, start, end: this._pos };
  }

  _scanIdent(start) {
    while (this._pos < this._len && isIdentCont(this._src[this._pos])) this._pos++;
    const text = this._buf.sliceStr(start, this._pos);
    if (text === 'true' || text === 'false') return { type: TokenType.BOOL,  start, end: this._pos };
    if (text === 'null')                      return { type: TokenType.NULL,  start, end: this._pos };
    return { type: TokenType.IDENT, start, end: this._pos };
  }

  _scanTaggedBlob(start) {
    this._pos++; // skip @
    const tagStart = this._pos;
    while (this._pos < this._len && isIdentCont(this._src[this._pos])) this._pos++;
    const tag = this._buf.sliceStr(tagStart, this._pos);
    if (this._src[this._pos] !== '`') {
      const { line, col } = this._lineCol(this._pos);
      throw new AnvilParseError(`Expected backtick after blob tag "@${tag}"`, line, col);
    }
    return this._scanBlob(start, tag);
  }

  _scanBlob(start, tag) {
    this._pos++; // skip opening `
    const contentStart = this._pos;
    while (this._pos < this._len) {
      if (this._src[this._pos] === '`') {
        const contentEnd = this._pos;
        this._pos++; // skip closing `
        const tok = { type: TokenType.BACKTICK, start, end: this._pos };
        tok.contentStart = contentStart;
        tok.contentEnd   = contentEnd;
        tok.tag          = tag;
        return tok;
      }
      this._pos++;
    }
    this._error('Unterminated blob literal', start);
  }

  _scanHexOrSelector(start) {
    const pos = this._pos + 1; // skip #

    // 6-digit hex
    if (pos + 6 <= this._len) {
      const c6 = this._src.slice(pos, pos + 6);
      if ([...c6].every(isHexDigit) && !isIdentCont(this._src[pos + 6] ?? '')) {
        this._pos = pos + 6;
        return { type: TokenType.HEX_COLOR, start, end: this._pos };
      }
    }

    // 3-digit hex
    if (pos + 3 <= this._len) {
      const c3 = this._src.slice(pos, pos + 3);
      if ([...c3].every(isHexDigit) && !isIdentCont(this._src[pos + 3] ?? '')) {
        this._pos = pos + 3;
        return { type: TokenType.HEX_COLOR, start, end: this._pos };
      }
    }

    // DOM selector: #identifier
    if (pos < this._len && isIdentStart(this._src[pos])) {
      this._pos = pos;
      while (this._pos < this._len && isIdentCont(this._src[this._pos])) this._pos++;
      return { type: TokenType.SELECTOR, start, end: this._pos };
    }

    this._error(`Unexpected '#' — expected hex color (#RRGGBB or #RGB) or selector (#identifier)`, start);
  }
}

module.exports = { Lexer };
