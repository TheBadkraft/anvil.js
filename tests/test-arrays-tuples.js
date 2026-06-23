'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// Basic array via at()
{
  const root = parse(`#!aml\nFoo := { tags := [alpha, beta, gamma] }`);
  const tags = root.get('Foo').get('tags');
  assert.strictEqual(tags.type,              anvl.AnvilValueType.Array);
  assert.strictEqual(tags.at(0).asString(),  'alpha');
  assert.strictEqual(tags.at(1).asString(),  'beta');
  assert.strictEqual(tags.at(2).asString(),  'gamma');
  assert.strictEqual(tags.count,             3);
  console.log('✓ basic array via at()');
}

// Array iteration
{
  const root = parse(`#!aml\nFoo := { ids := [1, 2, 3] }`);
  const vals = [];
  for (const el of root.get('Foo').get('ids')) vals.push(el.asInt());
  assert.deepStrictEqual(vals, [1, 2, 3]);
  console.log('✓ array iteration');
}

// Array mixed types
{
  const root = parse(`#!aml\nFoo := { mixed := ["hello", 42, true, 3.14] }`);
  const m = root.get('Foo').get('mixed');
  assert.strictEqual(m.at(0).asString(), 'hello');
  assert.strictEqual(m.at(1).asInt(),    42);
  assert.strictEqual(m.at(2).asBool(),   true);
  assert.strictEqual(m.at(3).asFloat(),  3.14);
  console.log('✓ array of mixed scalar types');
}

// Empty array is a parse error
{
  const result = anvl.parse(`#!aml\nFoo := { empty := [] }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ empty array is a parse error');
}

// Empty tuple is a parse error
{
  const result = anvl.parse(`#!aml\nFoo := { empty := () }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ empty tuple is a parse error');
}

// Single-element tuple is a parse error
{
  const result = anvl.parse(`#!aml\nFoo := { single := (42) }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ single-element tuple is a parse error');
}
// at() out of range throws IndexError
{
  const root = parse(`#!aml\nFoo := { tags := [a, b] }`);
  assert.throws(() => root.get('Foo').get('tags').at(5), anvl.IndexError);
  console.log('✓ at() out-of-range throws IndexError');
}

// Basic tuple via at()
{
  const root  = parse(`#!aml\nFoo := { spawn := (0, 64, -200) }`);
  const spawn = root.get('Foo').get('spawn');
  assert.strictEqual(spawn.type,         anvl.AnvilValueType.Tuple);
  assert.strictEqual(spawn.at(0).asInt(), 0);
  assert.strictEqual(spawn.at(1).asInt(), 64);
  assert.strictEqual(spawn.at(2).asInt(), -200);
  assert.strictEqual(spawn.count,         3);
  console.log('✓ basic tuple via at()');
}

// Tuple iteration
{
  const root  = parse(`#!aml\nFoo := { color := (255, 128, 0) }`);
  const vals  = [];
  for (const el of root.get('Foo').get('color')) vals.push(el.asInt());
  assert.deepStrictEqual(vals, [255, 128, 0]);
  console.log('✓ tuple iteration');
}

// Tuple mixed types
{
  const root = parse(`#!aml\nFoo := { rec := ("Notch", 100, true) }`);
  const rec  = root.get('Foo').get('rec');
  assert.strictEqual(rec.at(0).asString(), 'Notch');
  assert.strictEqual(rec.at(1).asInt(),    100);
  assert.strictEqual(rec.at(2).asBool(),   true);
  console.log('✓ tuple of mixed types');
}


// at() on Scalar throws
{
  const root = parse(`#!aml\nFoo := { name := hello }`);
  assert.throws(() => root.get('Foo').get('name').at(0), anvl.InvalidOperationError);
  console.log('✓ at() on Scalar throws');
}

// Top-level array statement
{
  const root = parse(`#!aml\nRules := ["pvp", "keepInventory=false"]`);
  assert.strictEqual(root.get('Rules').at(0).asString(), 'pvp');
  assert.strictEqual(root.get('Rules').at(1).asString(), 'keepInventory=false');
  console.log('✓ top-level array statement');
}

// Top-level tuple statement
{
  const root = parse(`#!aml\nPoint := (10, 20, 30)`);
  assert.strictEqual(root.get('Point').at(0).asInt(), 10);
  assert.strictEqual(root.get('Point').at(1).asInt(), 20);
  assert.strictEqual(root.get('Point').at(2).asInt(), 30);
  console.log('✓ top-level tuple statement');
}

console.log('\n✓ All array/tuple tests passed');
