'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// root.getResolver() returns a Resolver
{
  const root     = parse(`#!aml\nFoo := { x := 1 }`);
  const resolver = root.getResolver();
  assert.ok(resolver !== null);
  assert.ok(typeof resolver.bind     === 'function');
  assert.ok(typeof resolver.register === 'function');
  assert.ok(typeof resolver.evaluate === 'function');
  assert.ok(typeof resolver.observe  === 'function');
  console.log('✓ root.getResolver() returns Resolver with correct interface');
}

// Static vars — pre-warmed at construction
{
  const src = `
#!aml
vars { atlas := terrain.png scale := 1.5 port := 8080 }
Block := { texture := $atlas }
`;
  const root     = parse(src);
  const resolver = root.getResolver();
  assert.strictEqual(resolver.statics['atlas'], 'terrain.png');
  assert.strictEqual(resolver.statics['scale'], '1.5');
  assert.strictEqual(resolver.statics['port'],  '8080');
  console.log('✓ static vars pre-warmed in resolver');
}

// evaluate() — static ref
{
  const src = `
#!aml
vars { atlas := terrain.png }
Block := { texture := $atlas }
`;
  const root     = parse(src);
  const resolver = root.getResolver();
  const node     = root.get('Block').get('texture');
  assert.strictEqual(resolver.evaluate(node), 'terrain.png');
  console.log('✓ evaluate() resolves static VarRef');
}

// evaluate() — dotted path ref against bound object
{
  const src = `#!aml\nFoo := { source := $record.vehicle_id }`;
  const root     = parse(src);
  const resolver = root.getResolver();
  resolver.bind('record', { vehicle_id: 'V-001', odometer: 12345 });
  const node = root.get('Foo').get('source');
  assert.strictEqual(resolver.evaluate(node), 'V-001');
  console.log('✓ evaluate() resolves dotted path against bound object');
}

// evaluate() — callable with args
{
  const src = `#!aml\nFoo := { total := $sum($record.parts_cost, $record.labor_cost) }`;
  const root     = parse(src);
  const resolver = root.getResolver();
  resolver.bind('record', { parts_cost: 150, labor_cost: 75 });
  resolver.register('sum', (...args) => args.reduce((a, b) => a + b, 0));
  const node = root.get('Foo').get('total');
  assert.strictEqual(resolver.evaluate(node), 225);
  console.log('✓ evaluate() resolves callable VarRef with args');
}

// evaluate() — unknown ref returns undefined (not an error)
{
  const src  = `#!aml\nFoo := { x := $unknown }`;
  const root = parse(src);
  const resolver = root.getResolver();
  const node = root.get('Foo').get('x');
  assert.strictEqual(resolver.evaluate(node), undefined);
  console.log('✓ evaluate() returns undefined for unbound ref');
}

// bind() — updates existing binding
{
  const src  = `#!aml\nFoo := { val := $record.odometer }`;
  const root = parse(src);
  const resolver = root.getResolver();
  resolver.bind('record', { odometer: 100 });
  const node = root.get('Foo').get('val');
  assert.strictEqual(resolver.evaluate(node), 100);
  resolver.bind('record', { odometer: 999 });
  assert.strictEqual(resolver.evaluate(node), 999);
  console.log('✓ bind() updates and re-evaluates correctly');
}

// observe() — callback fires on bind()
{
  const src  = `#!aml\nFoo := { val := $record.odometer }`;
  const root = parse(src);
  const resolver = root.getResolver();
  let observed = null;
  resolver.observe('record.odometer', (val) => { observed = val; });
  resolver.bind('record', { odometer: 42 });
  assert.strictEqual(observed, 42);
  console.log('✓ observe() fires callback on bind()');
}

// refPaths — introspection
{
  const src = `
#!aml
Foo := {
  a := $record.vehicle_id
  b := $record.odometer
  c := $atlas
}
`;
  const root  = parse(src);
  const resolver = root.getResolver();
  const paths = resolver.refPaths;
  assert.ok(paths.includes('record.vehicle_id'));
  assert.ok(paths.includes('record.odometer'));
  assert.ok(paths.includes('atlas'));
  console.log('✓ refPaths introspection lists all catalogued refs');
}

// callNames — introspection
{
  const src = `
#!aml
Foo := {
  total    := $sum($record.parts_cost, $record.labor_cost)
  diff     := $diff($record.a, $record.b)
}
`;
  const root     = parse(src);
  const resolver = root.getResolver();
  const names    = resolver.callNames;
  assert.ok(names.includes('sum'));
  assert.ok(names.includes('diff'));
  console.log('✓ callNames introspection lists all callable refs');
}

// Static cross-ref in vars — resolved transitively
{
  const src = `
#!aml
vars {
  base := assets
  sub  := $base
}
Foo := { path := $sub }
`;
  const root     = parse(src);
  const resolver = root.getResolver();
  // $sub resolves to $base which resolves to "assets"
  assert.strictEqual(resolver.statics['base'], 'assets');
  assert.strictEqual(resolver.statics['sub'],  'assets');
  const node = root.get('Foo').get('path');
  assert.strictEqual(resolver.evaluate(node), 'assets');
  console.log('✓ static cross-ref in vars resolved transitively');
}

console.log('\n✓ All registry/resolver tests passed');
