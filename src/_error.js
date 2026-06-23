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
