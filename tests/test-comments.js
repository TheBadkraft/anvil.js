'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// Single-line comments
{
  const src = `
#!aml
// This is a comment
Foo := {
  x := 1  // inline comment
  // another comment
  y := 2
}
`;
  const root = parse(src);
  assert.strictEqual(root.get('Foo').get('x').asInt(), 1);
  assert.strictEqual(root.get('Foo').get('y').asInt(), 2);
  console.log('✓ single-line comments ignored');
}

// Multi-line block comments
{
  const src = `
#!aml
/* This is a
   multi-line comment */
Foo := {
  x := /* inline block */ 42
  y := 99
}
`;
  const root = parse(src);
  assert.strictEqual(root.get('Foo').get('x').asInt(), 42);
  assert.strictEqual(root.get('Foo').get('y').asInt(), 99);
  console.log('✓ multi-line block comments ignored');
}

// Unterminated block comment
{
  const result = anvl.parse(`#!aml\n/* unterminated\nFoo := { x := 1 }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ unterminated block comment is a parse error');
}

// # is NOT a comment
{
  const result = anvl.parse(`#!aml\nFoo := { x := 1 }\n# this is NOT a comment`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ bare # (not hex color) is a parse error');
}

// #RRGGBB is valid — not a comment
{
  const root = parse(`#!aml\nFoo := { color := #FF0000 }`);
  assert.strictEqual(root.get('Foo').get('color').asString(), '#FF0000');
  console.log('✓ #RRGGBB not mistaken for comment');
}

// Comments before and inside vars block
{
  const src = `
#!aml
// pre-vars comment
vars {
  /* block comment inside vars */ x := 10
}
// post-vars comment
Foo := { val := $x }
`;
  const root = parse(src);
  const resolver = root.getResolver();
  const node = root.get('Foo').get('val');
  assert.strictEqual(node.type,            anvl.AnvilValueType.VarRef);
  assert.strictEqual(resolver.evaluate(node), '10'); // static var resolves as string
  console.log('✓ comments before and inside vars block');
}

console.log('\n✓ All comment tests passed');
