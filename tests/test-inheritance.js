'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// Basic single inheritance
{
  const src = `#!aml\nBase := { hardness := 5 drop := gravel }\nStone : Base := { hardness := 8 name := Stone }`;
  const root = parse(src);
  assert.strictEqual(root.get('Stone').get('hardness').asInt(),  8);
  assert.strictEqual(root.get('Stone').get('drop').asString(),   'gravel');
  assert.strictEqual(root.get('Stone').get('name').asString(),   'Stone');
  console.log('✓ basic single inheritance');
}

// Inherited fields
{
  const src = `#!aml\nBase := { a := 1 b := 2 c := 3 }\nChild : Base := { b := 99 }`;
  const root = parse(src);
  assert.strictEqual(root.get('Child').get('a').asInt(), 1);
  assert.strictEqual(root.get('Child').get('b').asInt(), 99);
  assert.strictEqual(root.get('Child').get('c').asInt(), 3);
  console.log('✓ inherited fields accessible on derived');
}

// Base not mutated
{
  const src = `#!aml\nBase := { x := 10 }\nChild : Base := { x := 99 }`;
  const root = parse(src);
  assert.strictEqual(root.get('Base').get('x').asInt(),  10);
  assert.strictEqual(root.get('Child').get('x').asInt(), 99);
  console.log('✓ base not mutated by child override');
}

// hasBase / baseIdentifier
{
  const src = `#!aml\nBase := { x := 1 }\nChild : Base := { y := 2 }`;
  const root = parse(src);
  assert.strictEqual(root.get('Child').hasBase,        true);
  assert.strictEqual(root.get('Child').baseIdentifier, 'Base');
  assert.strictEqual(root.get('Base').hasBase,         false);
  assert.strictEqual(root.get('Base').baseIdentifier,  null);
  console.log('✓ hasBase and baseIdentifier');
}

// is() walks full chain
{
  const src = `#!aml\nRoot := { v := 1 }\nMid : Root := { v := 2 }\nLeaf : Mid := { v := 3 }`;
  const root = parse(src);
  assert.strictEqual(root.get('Leaf').is('Mid'),  true);
  assert.strictEqual(root.get('Leaf').is('Root'), true);
  assert.strictEqual(root.get('Leaf').is('Nope'), false);
  assert.strictEqual(root.get('Mid').is('Root'),  true);
  assert.strictEqual(root.get('Mid').is('Leaf'),  false);
  console.log('✓ is() walks full chain');
}

// Deep chain: Leaf : Mid : Root
{
  const src = `#!aml\nRoot := { a := 1 b := 2 c := 3 }\nMid : Root := { b := 20 d := 4 }\nLeaf : Mid := { c := 300 e := 5 }`;
  const root = parse(src);
  assert.strictEqual(root.get('Leaf').get('a').asInt(), 1);
  assert.strictEqual(root.get('Leaf').get('b').asInt(), 20);
  assert.strictEqual(root.get('Leaf').get('c').asInt(), 300);
  assert.strictEqual(root.get('Leaf').get('d').asInt(), 4);
  assert.strictEqual(root.get('Leaf').get('e').asInt(), 5);
  console.log('✓ deep inheritance chain (3 levels)');
}

// Self-inheritance cycle
{
  const result = anvl.parse(`#!aml\nA : A := { x := 1 }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError().message.toLowerCase().includes('cycle'));
  console.log('✓ self-inheritance cycle detected');
}

// Two-node cycle
{
  const result = anvl.parse(`#!aml\nA : B := { x := 1 }\nB : A := { y := 2 }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError().message.toLowerCase().includes('cycle'));
  console.log('✓ two-node cycle detected');
}

// Deep cycle
{
  const result = anvl.parse(`#!aml\nA : B := {x:=1}\nB : C := {y:=2}\nC : A := {z:=3}`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError().message.toLowerCase().includes('cycle'));
  console.log('✓ deep cycle detected');
}

// Unknown base
{
  const result = anvl.parse(`#!aml\nFoo : Missing := { x := 1 }`);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ unknown base type returns error');
}

// Multiple children — independent
{
  const src = `#!aml\nBase := { color := red size := 10 }\nChildA : Base := { color := blue }\nChildB : Base := { size := 99 }`;
  const root = parse(src);
  assert.strictEqual(root.get('ChildA').get('color').asString(), 'blue');
  assert.strictEqual(root.get('ChildA').get('size').asInt(),     10);
  assert.strictEqual(root.get('ChildB').get('color').asString(), 'red');
  assert.strictEqual(root.get('ChildB').get('size').asInt(),     99);
  assert.strictEqual(root.get('Base').get('color').asString(),   'red');
  assert.strictEqual(root.get('Base').get('size').asInt(),       10);
  console.log('✓ multiple children of same base are independent');
}

console.log('\n✓ All inheritance tests passed');
