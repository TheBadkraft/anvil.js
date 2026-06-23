'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// ---------------------------------------------------------------------------
// Nested objects in array
// ---------------------------------------------------------------------------
{
  const src = `
#!aml
Weapons := [
  { name := Sword  damage := 15 }
  { name := Axe    damage := 20 }
]
`;
  const root = parse(src);
  assert.strictEqual(root.get('Weapons').at(0).get('name').asString(),   'Sword');
  assert.strictEqual(root.get('Weapons').at(0).get('damage').asInt(),    15);
  assert.strictEqual(root.get('Weapons').at(1).get('name').asString(),   'Axe');
  assert.strictEqual(root.get('Weapons').at(1).get('damage').asInt(),    20);
  console.log('✓ nested objects in array');
}

// ---------------------------------------------------------------------------
// Nested arrays in array
// ---------------------------------------------------------------------------
{
  const src = `#!aml\nGrid := [ [1, 2, 3], [4, 5, 6], [7, 8, 9] ]`;
  const root = parse(src);
  assert.strictEqual(root.get('Grid').at(0).at(0).asInt(), 1);
  assert.strictEqual(root.get('Grid').at(1).at(1).asInt(), 5);
  assert.strictEqual(root.get('Grid').at(2).at(2).asInt(), 9);
  console.log('✓ nested arrays in array');
}

// ---------------------------------------------------------------------------
// Nested tuples in array
// ---------------------------------------------------------------------------
{
  const src = `#!aml\nPoints := [ (0, 64, 0), (10, 64, -5), (20, 64, 10) ]`;
  const root = parse(src);
  assert.strictEqual(root.get('Points').at(0).at(0).asInt(),  0);
  assert.strictEqual(root.get('Points').at(1).at(0).asInt(),  10);
  assert.strictEqual(root.get('Points').at(2).at(2).asInt(),  10);
  assert.strictEqual(root.get('Points').at(0).type, anvl.AnvilValueType.Tuple);
  console.log('✓ nested tuples in array');
}

// ---------------------------------------------------------------------------
// Nested object in tuple
// ---------------------------------------------------------------------------
{
  const src = `#!aml\nPlayer := (Aria, { health := 100  stamina := 50 }, warrior)`;
  const root = parse(src);
  assert.strictEqual(root.get('Player').at(0).asString(),              'Aria');
  assert.strictEqual(root.get('Player').at(1).get('health').asInt(),   100);
  assert.strictEqual(root.get('Player').at(1).get('stamina').asInt(),  50);
  assert.strictEqual(root.get('Player').at(2).asString(),              'warrior');
  console.log('✓ nested object in tuple');
}

// ---------------------------------------------------------------------------
// Nested array in tuple
// ---------------------------------------------------------------------------
{
  const src = `#!aml\nFoo := (hello, [1, 2, 3], world)`;
  const root = parse(src);
  assert.strictEqual(root.get('Foo').at(0).asString(),    'hello');
  assert.strictEqual(root.get('Foo').at(1).at(1).asInt(), 2);
  assert.strictEqual(root.get('Foo').at(2).asString(),    'world');
  console.log('✓ nested array in tuple');
}

// ---------------------------------------------------------------------------
// Mixed nesting — objects containing arrays containing objects
// ---------------------------------------------------------------------------
{
  const src = `
#!aml
Party := {
  name    := Adventurers
  members := [
    { name := Aria   class := warrior  level := 5 }
    { name := Bolt   class := mage     level := 3 }
  ]
}
`;
  const root = parse(src);
  const party = root.get('Party');
  assert.strictEqual(party.get('name').asString(),                      'Adventurers');
  assert.strictEqual(party.get('members').at(0).get('name').asString(), 'Aria');
  assert.strictEqual(party.get('members').at(0).get('level').asInt(),   5);
  assert.strictEqual(party.get('members').at(1).get('class').asString(),'mage');
  console.log('✓ mixed nesting — objects containing arrays containing objects');
}

// ---------------------------------------------------------------------------
// Untagged blob
// ---------------------------------------------------------------------------
{
  const src = 'const src = `#!aml\nFoo := { data := `hello world` }`';
  const root = anvl.parse('#!aml\nFoo := { data := `hello world` }');
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  const node = root.get('Foo').get('data');
  assert.strictEqual(node.type,       anvl.AnvilValueType.Blob);
  assert.strictEqual(node.blobTag,    null);
  assert.strictEqual(node.asString(), 'hello world');
  console.log('✓ untagged blob');
}

// ---------------------------------------------------------------------------
// Tagged blob — @md
// ---------------------------------------------------------------------------
{
  const root = anvl.parse('#!aml\nFoo := { notes := @md`**bold** text` }');
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  const node = root.get('Foo').get('notes');
  assert.strictEqual(node.type,       anvl.AnvilValueType.Blob);
  assert.strictEqual(node.blobTag,    'md');
  assert.strictEqual(node.asString(), '**bold** text');
  console.log('✓ tagged blob @md');
}

// ---------------------------------------------------------------------------
// Tagged blob — @sql
// ---------------------------------------------------------------------------
{
  const root = anvl.parse('#!aml\nFoo := { query := @sql`SELECT * FROM users` }');
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  const node = root.get('Foo').get('query');
  assert.strictEqual(node.type,       anvl.AnvilValueType.Blob);
  assert.strictEqual(node.blobTag,    'sql');
  assert.strictEqual(node.asString(), 'SELECT * FROM users');
  console.log('✓ tagged blob @sql');
}

// ---------------------------------------------------------------------------
// Tagged blob — @png (base64)
// ---------------------------------------------------------------------------
{
  const root = anvl.parse('#!aml\nFoo := { img := @png`iVBORw0KGgo=` }');
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  const node = root.get('Foo').get('img');
  assert.strictEqual(node.type,       anvl.AnvilValueType.Blob);
  assert.strictEqual(node.blobTag,    'png');
  assert.strictEqual(node.asString(), 'iVBORw0KGgo=');
  console.log('✓ tagged blob @png base64');
}

// ---------------------------------------------------------------------------
// Blob as top-level statement value
// ---------------------------------------------------------------------------
{
  const root = anvl.parse('#!aml\nReadme := @md`# Title\nSome content here`');
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  assert.strictEqual(root.get('Readme').blobTag,    'md');
  assert.strictEqual(root.get('Readme').asString(), '# Title\nSome content here');
  console.log('✓ blob as top-level statement');
}

// ---------------------------------------------------------------------------
// Unterminated blob — parse error
// ---------------------------------------------------------------------------
{
  const result = anvl.parse('#!aml\nFoo := { data := `unterminated }');
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError() !== null);
  console.log('✓ unterminated blob is a parse error');
}

// ---------------------------------------------------------------------------
// asBuffer() on blob — zero-copy
// ---------------------------------------------------------------------------
{
  const root = anvl.parse('#!aml\nFoo := { data := `hello` }');
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  const buf = root.get('Foo').get('data').asBuffer();
  assert.ok(buf instanceof Uint8Array);
  assert.strictEqual(buf.length, 5);
  console.log('✓ asBuffer() on blob returns Uint8Array');
}

console.log('\n✓ All nested collections and blob tests passed');
