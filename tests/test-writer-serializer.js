'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// ---------------------------------------------------------------------------
// Writer — basic scalars round-trip through re-parse
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { name := hello port := 8080 ratio := 1.5 flag := true n := null }`);
  const out  = anvl.write(root);
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('name').asString(), 'hello');
  assert.strictEqual(root2.get('Foo').get('port').asInt(),    8080);
  assert.strictEqual(root2.get('Foo').get('ratio').asFloat(), 1.5);
  assert.strictEqual(root2.get('Foo').get('flag').asBool(),   true);
  assert.strictEqual(root2.get('Foo').get('n').isNull(),      true);
  console.log('✓ writer basic scalars round-trip');
}

// ---------------------------------------------------------------------------
// Writer — string quoting policy
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { bare := hello quoted := "hello world" }`);
  const out  = anvl.write(root);
  assert.ok(out.includes('bare := hello'));        // no quotes needed
  assert.ok(out.includes('quoted := "hello world"')); // quotes needed (space)
  console.log('✓ writer string quoting policy — bare vs quoted');
}

// ---------------------------------------------------------------------------
// Writer — quoteAllStrings option
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { bare := hello }`);
  const out  = anvl.write(root, { quoteAllStrings: true });
  assert.ok(out.includes('"hello"'));
  console.log('✓ writer quoteAllStrings forces quotes');
}

// ---------------------------------------------------------------------------
// Writer — hex color and selector
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { color := #FF0000 target := #input-sku }`);
  const out  = anvl.write(root);
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('color').asString(),    '#FF0000');
  assert.strictEqual(root2.get('Foo').get('target').asSelector(), '#input-sku');
  console.log('✓ writer hex color and selector round-trip');
}

// ---------------------------------------------------------------------------
// Writer — arrays and tuples round-trip
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { tags := [alpha, beta, gamma] spawn := (0, 64, -200) }`);
  const out  = anvl.write(root);
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('tags').at(1).asString(), 'beta');
  assert.strictEqual(root2.get('Foo').get('spawn').at(2).asInt(),   -200);
  console.log('✓ writer arrays and tuples round-trip');
}

// ---------------------------------------------------------------------------
// Writer — nested objects round-trip
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { addr := { host := localhost port := 8080 } }`);
  const out  = anvl.write(root);
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('addr').get('host').asString(), 'localhost');
  assert.strictEqual(root2.get('Foo').get('addr').get('port').asInt(),    8080);
  console.log('✓ writer nested objects round-trip');
}

// ---------------------------------------------------------------------------
// Writer — inheritance preserved
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nBase := { x := 1 }\nChild : Base := { y := 2 }`);
  const out  = anvl.write(root);
  assert.ok(out.includes('Child : Base'));
  const root2 = parse(out);
  assert.strictEqual(root2.get('Child').get('x').asInt(), 1); // inherited
  assert.strictEqual(root2.get('Child').get('y').asInt(), 2); // own
  console.log('✓ writer preserves inheritance syntax');
}

// ---------------------------------------------------------------------------
// Writer — attributes preserved
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo @[version=2, experimental] := { x := 1 }`);
  const out  = anvl.write(root);
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').attribute('version'),         '2');
  assert.strictEqual(root2.get('Foo').hasAttribute('experimental'), true);
  console.log('✓ writer preserves attributes');
}

// ---------------------------------------------------------------------------
// Writer — blob round-trip
// ---------------------------------------------------------------------------
{
  const root = parse('#!aml\nFoo := { notes := @md`**bold** text` raw := `plain` }');
  const out  = anvl.write(root);
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('notes').blobTag,    'md');
  assert.strictEqual(root2.get('Foo').get('notes').asString(), '**bold** text');
  assert.strictEqual(root2.get('Foo').get('raw').blobTag,      null);
  assert.strictEqual(root2.get('Foo').get('raw').asString(),   'plain');
  console.log('✓ writer blob round-trip');
}

// ---------------------------------------------------------------------------
// Writer — VarRef preserve mode (default)
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { source := $record.vehicle_id }`);
  const out  = anvl.write(root);
  assert.ok(out.includes('$record.vehicle_id'));
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('source').type,     anvl.AnvilValueType.VarRef);
  assert.strictEqual(root2.get('Foo').get('source')._varPath, 'record.vehicle_id');
  console.log('✓ writer preserve mode keeps VarRef syntax');
}

// ---------------------------------------------------------------------------
// Writer — VarRef callable preserve mode
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { total := $sum($record.parts_cost, $record.labor_cost) }`);
  const out  = anvl.write(root);
  assert.ok(out.includes('$sum($record.parts_cost, $record.labor_cost)'));
  console.log('✓ writer preserve mode keeps callable VarRef syntax');
}

// ---------------------------------------------------------------------------
// Writer — snapshot mode resolves bound VarRef
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { source := $record.vehicle_id }`);
  const resolver = root.getResolver();
  resolver.bind('record', { vehicle_id: 'V-001' });
  const out = anvl.write(root, { mode: 'snapshot', resolver });
  assert.ok(out.includes('V-001'));
  assert.ok(!out.includes('$record'));
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('source').asString(), 'V-001');
  console.log('✓ writer snapshot mode resolves bound VarRef');
}

// ---------------------------------------------------------------------------
// Writer — snapshot mode resolves static var
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nvars { atlas := terrain.png }\nBlock := { texture := $atlas }`);
  const resolver = root.getResolver();
  const out = anvl.write(root, { mode: 'snapshot', resolver });
  const root2 = parse(out);
  assert.strictEqual(root2.get('Block').get('texture').asString(), 'terrain.png');
  console.log('✓ writer snapshot mode resolves static var');
}

// ---------------------------------------------------------------------------
// Writer — snapshot mode, unbound VarRef becomes quoted source syntax
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { source := $record.vehicle_id }`);
  const resolver = root.getResolver(); // nothing bound
  const out = anvl.write(root, { mode: 'snapshot', resolver });
  assert.ok(out.includes('"$record.vehicle_id"'));
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('source').asString(), '$record.vehicle_id');
  console.log('✓ writer snapshot mode — unbound VarRef becomes quoted source syntax');
}

// ---------------------------------------------------------------------------
// Writer — snapshot mode requires resolver
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { x := 1 }`);
  assert.throws(() => anvl.write(root, { mode: 'snapshot' }), /resolver/);
  console.log('✓ writer snapshot mode requires resolver');
}

// ---------------------------------------------------------------------------
// Writer — minified output
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { x := 1 y := 2 }`);
  const out  = anvl.write(root, { minified: true });
  assert.ok(!out.includes('\n'));
  const root2 = parse(out);
  assert.strictEqual(root2.get('Foo').get('x').asInt(), 1);
  assert.strictEqual(root2.get('Foo').get('y').asInt(), 2);
  console.log('✓ writer minified output');
}

// ---------------------------------------------------------------------------
// Serializer — deserialize basic object
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { name := hello port := 8080 ratio := 1.5 flag := true n := null }`);
  const obj  = anvl.deserialize(root.get('Foo'));
  assert.deepStrictEqual(obj, { name: 'hello', port: 8080, ratio: 1.5, flag: true, n: null });
  console.log('✓ serializer deserialize basic object');
}

// ---------------------------------------------------------------------------
// Serializer — deserialize arrays and tuples
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { tags := [a, b, c] spawn := (0, 64, -200) }`);
  const obj  = anvl.deserialize(root.get('Foo'));
  assert.deepStrictEqual(obj, { tags: ['a', 'b', 'c'], spawn: [0, 64, -200] });
  console.log('✓ serializer deserialize arrays and tuples');
}

// ---------------------------------------------------------------------------
// Serializer — deserialize nested objects
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { addr := { host := localhost port := 8080 } }`);
  const obj  = anvl.deserialize(root.get('Foo'));
  assert.deepStrictEqual(obj, { addr: { host: 'localhost', port: 8080 } });
  console.log('✓ serializer deserialize nested objects');
}

// ---------------------------------------------------------------------------
// Serializer — deserialize hex color and selector
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { color := #FF0000 target := #input-sku }`);
  const obj  = anvl.deserialize(root.get('Foo'));
  assert.deepStrictEqual(obj, { color: '#FF0000', target: '#input-sku' });
  console.log('✓ serializer deserialize hex color and selector');
}

// ---------------------------------------------------------------------------
// Serializer — VarRef with resolver
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { source := $record.vehicle_id }`);
  const resolver = root.getResolver();
  resolver.bind('record', { vehicle_id: 'V-001' });
  const obj = anvl.deserialize(root.get('Foo'), { resolver });
  assert.deepStrictEqual(obj, { source: 'V-001' });
  console.log('✓ serializer deserialize resolves VarRef via resolver');
}

// ---------------------------------------------------------------------------
// Serializer — VarRef without resolver becomes source syntax string
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { source := $record.vehicle_id }`);
  const obj  = anvl.deserialize(root.get('Foo'));
  assert.deepStrictEqual(obj, { source: '$record.vehicle_id' });
  console.log('✓ serializer deserialize without resolver — VarRef as source syntax');
}

// ---------------------------------------------------------------------------
// Serializer — unbound VarRef with resolver becomes source syntax string
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { source := $record.vehicle_id }`);
  const resolver = root.getResolver(); // nothing bound
  const obj = anvl.deserialize(root.get('Foo'), { resolver });
  assert.deepStrictEqual(obj, { source: '$record.vehicle_id' });
  console.log('✓ serializer deserialize unbound VarRef with resolver — source syntax');
}

// ---------------------------------------------------------------------------
// Serializer — callable VarRef resolves with resolver
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { total := $sum($record.parts_cost, $record.labor_cost) }`);
  const resolver = root.getResolver();
  resolver.bind('record', { parts_cost: 150, labor_cost: 75 });
  resolver.register('sum', (...args) => args.reduce((a, b) => a + b, 0));
  const obj = anvl.deserialize(root.get('Foo'), { resolver });
  assert.deepStrictEqual(obj, { total: 225 });
  console.log('✓ serializer deserialize resolves callable VarRef');
}

// ---------------------------------------------------------------------------
// Serializer — blob deserializes to string
// ---------------------------------------------------------------------------
{
  const root = parse('#!aml\nFoo := { notes := @md`**bold**` }');
  const obj  = anvl.deserialize(root.get('Foo'));
  assert.deepStrictEqual(obj, { notes: '**bold**' });
  console.log('✓ serializer deserialize blob to string');
}

// ---------------------------------------------------------------------------
// Serializer — inheritance flattens via lazy merge
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nBase := { a := 1 b := 2 }\nChild : Base := { b := 99 }`);
  const obj  = anvl.deserialize(root.get('Child'));
  assert.deepStrictEqual(obj, { a: 1, b: 99 });
  console.log('✓ serializer deserialize flattens inherited fields');
}

console.log('\n✓ All writer and serializer tests passed');
