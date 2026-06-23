'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// vars block — literal scalar entries accessible via hasVar/var
{
  const src = `#!aml\nvars { color := red size := 42 debug := true }`;
  const root = parse(src);
  assert.strictEqual(root.hasVar('color'), true);
  assert.strictEqual(root.hasVar('size'),  true);
  assert.strictEqual(root.hasVar('nope'),  false);
  assert.strictEqual(root.var('color').asString(), 'red');
  assert.strictEqual(root.var('size').asInt(),     42);
  assert.strictEqual(root.var('debug').asBool(),   true);
  assert.strictEqual(root.var('nope'),             null);
  console.log('✓ vars block literal entries accessible via hasVar/var');
}

// VarRef in field — node is VarRef type, not resolved
{
  const src = `
#!aml
vars { atlas := terrain.png }
Block := { texture := $atlas }
`;
  const root = parse(src);
  const node = root.get('Block').get('texture');
  assert.strictEqual(node.type,      anvl.AnvilValueType.VarRef);
  assert.strictEqual(node._varKind,  'ref');
  assert.strictEqual(node._varPath,  'atlas');
  console.log('✓ VarRef in field — node preserved as VarRef, not resolved');
}

// VarRef asString — returns path representation
{
  const src = `#!aml\nFoo := { src := $record.vehicle_id }`;
  const root = parse(src);
  const node = root.get('Foo').get('src');
  assert.strictEqual(node.type,     anvl.AnvilValueType.VarRef);
  assert.strictEqual(node.asString(), '$record.vehicle_id');
  console.log('✓ VarRef asString returns path representation');
}

// Dotted path VarRef
{
  const src = `#!aml\nFoo := { source := $record.vehicle_id }`;
  const root = parse(src);
  const node = root.get('Foo').get('source');
  assert.strictEqual(node.type,     anvl.AnvilValueType.VarRef);
  assert.strictEqual(node._varKind, 'ref');
  assert.strictEqual(node._varPath, 'record.vehicle_id');
  console.log('✓ dotted path VarRef — path preserved as string');
}

// Callable VarRef
{
  const src = `#!aml\nFoo := { total := $sum($record.parts_cost, $record.labor_cost) }`;
  const root = parse(src);
  const node = root.get('Foo').get('total');
  assert.strictEqual(node.type,        anvl.AnvilValueType.VarRef);
  assert.strictEqual(node._varKind,    'call');
  assert.strictEqual(node._varName,    'sum');
  assert.strictEqual(node._varArgs.length, 2);
  assert.strictEqual(node._varArgs[0]._varPath, 'record.parts_cost');
  assert.strictEqual(node._varArgs[1]._varPath, 'record.labor_cost');
  console.log('✓ callable VarRef — name and args preserved');
}

// VarRef in vars block — cross-ref
{
  const src = `
#!aml
vars {
  base_path := assets
  tex_path  := $base_path
}
`;
  const root = parse(src);
  assert.strictEqual(root.var('base_path').asString(), 'assets');
  assert.strictEqual(root.var('tex_path').type,        anvl.AnvilValueType.VarRef);
  assert.strictEqual(root.var('tex_path')._varPath,    'base_path');
  console.log('✓ VarRef in vars block — cross-ref preserved as VarRef');
}

// Unknown VarRef — no longer a parse error, just registered
{
  const root = parse(`#!aml\nFoo := { x := $unknown }`);
  assert.ok(root !== null);
  const node = root.get('Foo').get('x');
  assert.strictEqual(node.type,     anvl.AnvilValueType.VarRef);
  assert.strictEqual(node._varPath, 'unknown');
  console.log('✓ unknown VarRef — not a parse error, registered as-is');
}

console.log('\n✓ All vars tests passed');
