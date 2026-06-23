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
