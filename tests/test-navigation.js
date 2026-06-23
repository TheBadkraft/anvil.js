'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

const SRC = `
#!aml
Server := {
  host    := localhost
  port    := 8080
  debug   := false
  timeout := 5.0
}
`;

// Direct field access via get()
{
  const root = parse(SRC);
  assert.strictEqual(root.get('Server').get('host').asString(),    'localhost');
  assert.strictEqual(root.get('Server').get('port').asInt(),       8080);
  assert.strictEqual(root.get('Server').get('debug').asBool(),     false);
  assert.strictEqual(root.get('Server').get('timeout').asFloat(),  5.0);
  console.log('✓ direct field access via get()');
}

// field() throws KeyError on missing
{
  const root = parse(SRC);
  assert.throws(() => root.get('Server').field('missing'), anvl.KeyError);
  assert.throws(() => root.field('NotHere'),               anvl.KeyError);
  console.log('✓ field() throws KeyError on missing');
}

// get() returns null on missing — never throws
{
  const root = parse(SRC);
  assert.ok(root.get('Server').get('host') !== null);
  assert.strictEqual(root.get('Server').get('missing'), null);
  assert.strictEqual(root.get('NotHere'),               null);
  console.log('✓ get() returns null on missing');
}

// Typed safe access with defaults
{
  const root = parse(SRC);
  const srv  = root.get('Server');
  assert.strictEqual(srv.getString('host',    'x'),   'localhost');
  assert.strictEqual(srv.getString('missing', 'def'), 'def');
  assert.strictEqual(srv.getInt('port',       0),     8080);
  assert.strictEqual(srv.getInt('missing',    99),    99);
  assert.strictEqual(srv.getBool('debug',     true),  false);
  assert.strictEqual(srv.getBool('missing',   true),  true);
  assert.strictEqual(srv.getFloat('timeout',  0),     5.0);
  assert.strictEqual(srv.getFloat('missing',  -1.0),  -1.0);
  console.log('✓ typed safe access with defaults');
}

// has() membership
{
  const root = parse(SRC);
  assert.strictEqual(root.get('Server').has('host'),    true);
  assert.strictEqual(root.get('Server').has('missing'), false);
  console.log('✓ has() membership test');
}

// keys() — declaration order
{
  const root = parse(SRC);
  assert.deepStrictEqual(root.get('Server').keys(), ['host', 'port', 'debug', 'timeout']);
  console.log('✓ keys() in declaration order');
}

// entries() iteration
{
  const root  = parse(SRC);
  const pairs = [...root.get('Server').entries()];
  assert.strictEqual(pairs[0][0], 'host');
  assert.strictEqual(pairs[0][1].asString(), 'localhost');
  assert.strictEqual(pairs.length, 4);
  console.log('✓ entries() iteration');
}

// for...of on Object yields values
{
  const root   = parse(SRC);
  const values = [];
  for (const v of root.get('Server')) values.push(v.type);
  assert.strictEqual(values.length, 4);
  assert.ok(values.every(t => t === anvl.AnvilValueType.Scalar));
  console.log('✓ for...of on Object yields values');
}

// count property
{
  const root = parse(SRC);
  assert.strictEqual(root.get('Server').count, 4);
  console.log('✓ count property');
}

// empty object is a parse error
{
  const result = anvl.parse(`#!aml\nFoo := {}`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ empty object is a parse error');
}

// node.type inspection
{
  const root = parse(SRC);
  assert.strictEqual(root.get('Server').type,            anvl.AnvilValueType.Object);
  assert.strictEqual(root.get('Server').get('port').type, anvl.AnvilValueType.Scalar);
  console.log('✓ node.type inspection');
}

// at() on Object throws
{
  const root = parse(SRC);
  assert.throws(() => root.get('Server').at(0), anvl.InvalidOperationError);
  console.log('✓ at() on Object throws InvalidOperationError');
}

// keys()/entries() on non-Object throws
{
  const root = parse(SRC);
  assert.throws(() => root.get('Server').get('host').keys(),    anvl.InvalidOperationError);
  assert.throws(() => [...root.get('Server').get('host').entries()], anvl.InvalidOperationError);
  console.log('✓ keys()/entries() on non-Object throws');
}

// Fields named after node properties — no collision
{
  const src = `#!aml\nFoo := { type := warrior kind := mage count := 5 hasBase := true }`;
  const root = parse(src);
  assert.strictEqual(root.get('Foo').get('type').asString(),    'warrior');
  assert.strictEqual(root.get('Foo').get('kind').asString(),    'mage');
  assert.strictEqual(root.get('Foo').get('count').asInt(),      5);
  assert.strictEqual(root.get('Foo').get('hasBase').asBool(),   true);
  console.log('✓ fields named type/kind/count/hasBase — no collision');
}

console.log('\n✓ All navigation tests passed');
