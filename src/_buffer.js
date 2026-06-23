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
