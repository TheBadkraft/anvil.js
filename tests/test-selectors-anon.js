'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// ---------------------------------------------------------------------------
// Selector scalar — basic
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { target := #input-sku }`);
  const node = root.get('Foo').get('target');
  assert.strictEqual(node.kind,         anvl.ScalarKind.Selector);
  assert.strictEqual(node.type,         anvl.AnvilValueType.Scalar);
  assert.strictEqual(node.asString(),   '#input-sku');
  assert.strictEqual(node.asSelector(), '#input-sku');
  assert.strictEqual(node.asName(),     'input-sku');
  console.log('✓ selector scalar: asString, asSelector, asName');
}

// ---------------------------------------------------------------------------
// Selector — single word
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { el := #button }`);
  const node = root.get('Foo').get('el');
  assert.strictEqual(node.kind,         anvl.ScalarKind.Selector);
  assert.strictEqual(node.asString(),   '#button');
  assert.strictEqual(node.asSelector(), '#button');
  assert.strictEqual(node.asName(),     'button');
  console.log('✓ selector scalar: single word');
}

// ---------------------------------------------------------------------------
// Selector — underscores
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { el := #label_price }`);
  const node = root.get('Foo').get('el');
  assert.strictEqual(node.asString(),   '#label_price');
  assert.strictEqual(node.asSelector(), '#label_price');
  assert.strictEqual(node.asName(),     'label_price');
  console.log('✓ selector scalar: underscores');
}

// ---------------------------------------------------------------------------
// Hex color not confused for selector
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { color := #FF0000 sel := #input-sku }`);
  assert.strictEqual(root.get('Foo').get('color').kind, anvl.ScalarKind.Hex);
  assert.strictEqual(root.get('Foo').get('sel').kind,   anvl.ScalarKind.Selector);
  console.log('✓ hex color and selector coexist without confusion');
}

// ---------------------------------------------------------------------------
// Selector in array
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { targets := [#input-sku, #label-price, #input-stock] }`);
  const targets = root.get('Foo').get('targets');
  assert.strictEqual(targets.at(0).asSelector(), '#input-sku');
  assert.strictEqual(targets.at(1).asSelector(), '#label-price');
  assert.strictEqual(targets.at(2).asName(),     'input-stock');
  console.log('✓ selectors in array');
}

// ---------------------------------------------------------------------------
// Selector in tuple
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { binding := (#input-sku, twoway) }`);
  assert.strictEqual(root.get('Foo').get('binding').at(0).asSelector(), '#input-sku');
  assert.strictEqual(root.get('Foo').get('binding').at(1).asString(),   'twoway');
  console.log('✓ selector in tuple');
}

// ---------------------------------------------------------------------------
// asSelector() / asName() on non-Selector throws
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nFoo := { x := hello }`);
  assert.throws(() => root.get('Foo').get('x').asSelector(), anvl.InvalidOperationError);
  assert.throws(() => root.get('Foo').get('x').asName(),     anvl.InvalidOperationError);
  console.log('✓ asSelector()/asName() on non-Selector throws');
}

// ---------------------------------------------------------------------------
// Anonymous block — basic
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nconfig { host := localhost port := 8080 }`);
  const node = root.get('config');
  assert.strictEqual(node.type,       anvl.AnvilValueType.Object);
  assert.strictEqual(node._anonymous, true);
  assert.strictEqual(node.get('host').asString(), 'localhost');
  assert.strictEqual(node.get('port').asInt(),    8080);
  console.log('✓ anonymous block parsed and flagged');
}

// ---------------------------------------------------------------------------
// Anonymous block — with attributes
// ---------------------------------------------------------------------------
{
  const root = parse(`#!aml\nconfig @[version=2, stable] { host := localhost }`);
  const node = root.get('config');
  assert.strictEqual(node._anonymous,           true);
  assert.strictEqual(node.hasAttribute('version'), true);
  assert.strictEqual(node.attribute('version'),    '2');
  assert.strictEqual(node.hasAttribute('stable'),  true);
  assert.strictEqual(node.get('host').asString(),  'localhost');
  console.log('✓ anonymous block with attributes');
}

// ---------------------------------------------------------------------------
// Anonymous block — inheriting from named statement
// ---------------------------------------------------------------------------
{
  const src = `
#!aml
BaseConfig := { host := localhost port := 8080 debug := false }
config : BaseConfig { debug := true }
`;
  const root = parse(src);
  const node = root.get('config');
  assert.strictEqual(node._anonymous,               true);
  assert.strictEqual(node.get('host').asString(),   'localhost'); // inherited
  assert.strictEqual(node.get('port').asInt(),      8080);        // inherited
  assert.strictEqual(node.get('debug').asBool(),    true);        // overridden
  console.log('✓ anonymous block inherits from named statement');
}

// ---------------------------------------------------------------------------
// Anonymous block with inheritance AND attributes
// ---------------------------------------------------------------------------
{
  const src = `
#!aml
Base := { x := 1 y := 2 }
derived : Base @[experimental] { y := 99 }
`;
  const root = parse(src);
  const node = root.get('derived');
  assert.strictEqual(node._anonymous,                  true);
  assert.strictEqual(node.get('x').asInt(),            1);
  assert.strictEqual(node.get('y').asInt(),            99);
  assert.strictEqual(node.hasAttribute('experimental'), true);
  console.log('✓ anonymous block with inheritance and attributes');
}

// ---------------------------------------------------------------------------
// Anonymous block cannot be used as a base type
// ---------------------------------------------------------------------------
{
  const src = `
#!aml
anon { x := 1 }
Child : anon := { y := 2 }
`;
  const result = anvl.parse(src);
  assert.strictEqual(result, null);
  assert.ok(anvl.lastError().message.includes('anonymous'));
  console.log('✓ anonymous block cannot be used as base type');
}

// ---------------------------------------------------------------------------
// Anonymous block and statement coexist
// ---------------------------------------------------------------------------
{
  const src = `
#!aml
settings { debug := true }
Server := { host := localhost }
`;
  const root = parse(src);
  assert.strictEqual(root.get('settings').get('debug').asBool(),    true);
  assert.strictEqual(root.get('Server').get('host').asString(), 'localhost');
  console.log('✓ anonymous block and statement coexist');
}

// ---------------------------------------------------------------------------
// Full bindings example
// ---------------------------------------------------------------------------
{
  const src = `
#!aml
bindings {
  sku         := { target := #input-sku,    mode := twoway   }
  price       := { target := #label-price,  mode := readonly }
  stock_count := { target := #input-stock,  mode := twoway   }
}
`;
  const root = parse(src);
  const b = root.get('bindings');
  assert.strictEqual(b._anonymous, true);
  assert.strictEqual(b.get('sku').get('target').asSelector(),         '#input-sku');
  assert.strictEqual(b.get('sku').get('target').asName(),             'input-sku');
  assert.strictEqual(b.get('sku').get('mode').asString(),             'twoway');
  assert.strictEqual(b.get('price').get('target').asSelector(),       '#label-price');
  assert.strictEqual(b.get('price').get('mode').asString(),           'readonly');
  assert.strictEqual(b.get('stock_count').get('target').asSelector(), '#input-stock');
  assert.strictEqual(b.get('stock_count').get('mode').asString(),     'twoway');
  console.log('✓ full bindings anonymous block with selectors');
}

console.log('\n✓ All selector and anonymous block tests passed');
