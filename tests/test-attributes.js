'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// Root flag attribute
{
  const root = parse(`#!aml\n@[experimental]\nFoo := { x := 1 }`);
  assert.strictEqual(root.hasAttribute('experimental'), true);
  assert.strictEqual(root.attribute('experimental'),    null);
  console.log('✓ root flag attribute');
}

// Root key=value attribute
{
  const root = parse(`#!aml\n@[version=2, experimental]\nFoo := { x := 1 }`);
  assert.strictEqual(root.hasAttribute('version'),      true);
  assert.strictEqual(root.attribute('version'),         '2');
  assert.strictEqual(root.hasAttribute('experimental'), true);
  assert.strictEqual(root.attribute('experimental'),    null);
  console.log('✓ root key=value and flag attributes');
}

// Statement attribute
{
  const src = `#!aml\nworld @[seed=1337] := { spawn := (0, 64, 0) }`;
  const root = parse(src);
  assert.strictEqual(root.get('world').hasAttribute('seed'), true);
  assert.strictEqual(root.get('world').attribute('seed'),    '1337');
  console.log('✓ statement attribute key=value');
}

// Field attribute
{
  const src = `#!aml\nworld := { rules @[hardcore] := ["pvp"] }`;
  const root = parse(src);
  assert.strictEqual(root.get('world').get('rules').hasAttribute('hardcore'), true);
  assert.strictEqual(root.get('world').get('rules').attribute('hardcore'),    null);
  console.log('✓ field flag attribute');
}

// Missing attribute
{
  const root = parse(`#!aml\nFoo := { x := 1 }`);
  assert.strictEqual(root.hasAttribute('missing'),          false);
  assert.strictEqual(root.attribute('missing'),             null);
  assert.strictEqual(root.get('Foo').hasAttribute('x'),     false);
  console.log('✓ missing attribute returns false/null');
}

// attributes property — full map
{
  const root  = parse(`#!aml\n@[version=3, beta]\nFoo := { x := 1 }`);
  const attrs = root.attributes;
  assert.strictEqual(attrs['version'], '3');
  assert.strictEqual(attrs['beta'],    null);
  console.log('✓ attributes property returns full map');
}

// Multiple attributes on statement
{
  const src  = `#!aml\nFoo @[tier=2, experimental, priority=10] := { x := 1 }`;
  const root = parse(src);
  assert.strictEqual(root.get('Foo').attribute('tier'),            '2');
  assert.strictEqual(root.get('Foo').hasAttribute('experimental'), true);
  assert.strictEqual(root.get('Foo').attribute('priority'),        '10');
  console.log('✓ multiple attributes on statement');
}

// Attribute on array field
{
  const src  = `#!aml\nFoo := { tags @[required] := [a, b, c] }`;
  const root = parse(src);
  assert.strictEqual(root.get('Foo').get('tags').hasAttribute('required'), true);
  assert.strictEqual(root.get('Foo').get('tags').at(0).asString(),         'a');
  console.log('✓ attribute on array field');
}

console.log('\n✓ All attribute tests passed');
