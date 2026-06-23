'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// Unquoted string
{
  const root = parse(`#!aml\nFoo := { name := hello }`);
  assert.strictEqual(root.get('Foo').get('name').asString(), 'hello');
  assert.strictEqual(root.get('Foo').get('name').type, anvl.AnvilValueType.Scalar);
  assert.strictEqual(root.get('Foo').get('name').kind, anvl.ScalarKind.String);
  console.log('✓ unquoted string');
}

// Quoted string
{
  const root = parse(`#!aml\nFoo := { msg := "hello world" }`);
  assert.strictEqual(root.get('Foo').get('msg').asString(), 'hello world');
  console.log('✓ quoted string');
}

// String escape sequences
{
  const root = parse(`#!aml\nFoo := { a := "line1\\nline2" b := "tab\\there" c := "quote\\"x\\"" }`);
  assert.strictEqual(root.get('Foo').get('a').asString(), 'line1\nline2');
  assert.strictEqual(root.get('Foo').get('b').asString(), 'tab\there');
  assert.strictEqual(root.get('Foo').get('c').asString(), 'quote"x"');
  console.log('✓ string escape sequences');
}

// Integer
{
  const root = parse(`#!aml\nFoo := { port := 8080 neg := -7 zero := 0 }`);
  assert.strictEqual(root.get('Foo').get('port').asInt(),  8080);
  assert.strictEqual(root.get('Foo').get('neg').asInt(),   -7);
  assert.strictEqual(root.get('Foo').get('zero').asInt(),  0);
  assert.strictEqual(root.get('Foo').get('port').asString(), '8080');
  console.log('✓ integer');
}

// Float
{
  const root = parse(`#!aml\nFoo := { f := 3.14 neg := -0.5 }`);
  assert.strictEqual(root.get('Foo').get('f').asFloat(),   3.14);
  assert.strictEqual(root.get('Foo').get('neg').asFloat(), -0.5);
  assert.strictEqual(root.get('Foo').get('f').asString(),  '3.14');
  console.log('✓ float');
}

// Boolean
{
  const root = parse(`#!aml\nFoo := { t := true f := false }`);
  assert.strictEqual(root.get('Foo').get('t').asBool(), true);
  assert.strictEqual(root.get('Foo').get('f').asBool(), false);
  assert.strictEqual(root.get('Foo').get('t').asString(), 'true');
  assert.strictEqual(root.get('Foo').get('f').asString(), 'false');
  console.log('✓ boolean');
}

// Null
{
  const root = parse(`#!aml\nFoo := { n := null }`);
  assert.strictEqual(root.get('Foo').get('n').isNull(), true);
  assert.strictEqual(root.get('Foo').get('n').asString(), 'null');
  console.log('✓ null');
}

// Hex color 6-digit
{
  const root = parse(`#!aml\nFoo := { c := #FFFFFF }`);
  assert.strictEqual(root.get('Foo').get('c').asString(), '#FFFFFF');
  assert.strictEqual(root.get('Foo').get('c').asInt(),    16777215);
  assert.strictEqual(root.get('Foo').get('c').kind,       anvl.ScalarKind.Hex);
  console.log('✓ hex color 6-digit');
}

// Hex color 3-digit
{
  const root = parse(`#!aml\nFoo := { c := #FFF }`);
  assert.strictEqual(root.get('Foo').get('c').asString(), '#FFFFFF');
  assert.strictEqual(root.get('Foo').get('c').asInt(),    16777215);
  console.log('✓ hex color 3-digit expanded');
}

// Hex color lowercase canonicalised
{
  const root = parse(`#!aml\nFoo := { c := #1a2b3c }`);
  assert.strictEqual(root.get('Foo').get('c').asString(), '#1A2B3C');
  assert.strictEqual(root.get('Foo').get('c').asInt(),    1715004);
  console.log('✓ hex color lowercase canonicalised');
}

// Type errors
{
  const root = parse(`#!aml\nFoo := { s := hello n := 42 }`);
  assert.throws(() => root.get('Foo').get('s').asInt(),   anvl.InvalidOperationError);
  assert.throws(() => root.get('Foo').get('s').asFloat(), anvl.InvalidOperationError);
  assert.throws(() => root.get('Foo').get('s').asBool(),  anvl.InvalidOperationError);
  assert.throws(() => root.get('Foo').get('n').asFloat(), anvl.InvalidOperationError);
  assert.throws(() => root.get('Foo').get('n').asBool(),  anvl.InvalidOperationError);
  console.log('✓ type errors on wrong as*() calls');
}

// asString() on non-Scalar throws
{
  const root = parse(`#!aml\nFoo := { obj := { x := 1 } }`);
  assert.throws(() => root.get('Foo').get('obj').asString(), anvl.InvalidOperationError);
  console.log('✓ asString() on Object throws');
}

// isNull() never throws
{
  const root = parse(`#!aml\nFoo := { n := null s := hello }`);
  assert.strictEqual(root.get('Foo').get('n').isNull(), true);
  assert.strictEqual(root.get('Foo').get('s').isNull(), false);
  assert.doesNotThrow(() => root.get('Foo').isNull());
  console.log('✓ isNull() never throws');
}

// Bare # is a parse error
{
  const result = anvl.parse(`#!aml\nFoo := { c := # }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ bare # is a parse error');
}

// Field named 'type' — no collision
{
  const root = parse(`#!aml\nFoo := { type := warrior size := 10 count := 5 attributes := loud }`);
  assert.strictEqual(root.get('Foo').get('type').asString(),       'warrior');
  assert.strictEqual(root.get('Foo').get('size').asInt(),          10);
  assert.strictEqual(root.get('Foo').get('count').asInt(),         5);
  assert.strictEqual(root.get('Foo').get('attributes').asString(), 'loud');
  console.log('✓ reserved-name fields: type, size, count, attributes — no collision');
}

console.log('\n✓ All scalar tests passed');
