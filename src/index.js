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
