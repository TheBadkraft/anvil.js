'use strict';

const assert = require('assert');
const anvl   = require('../src/index');

function parse(src) {
  const root = anvl.parse(src);
  if (!root) throw new Error(`Parse failed: ${anvl.lastError()}`);
  return root;
}

// Commas between statements — optional
{
  const root = parse(`#!aml\nFoo := { x := 1 },Bar := { y := 2 }`);
  assert.strictEqual(root.get('Foo').get('x').asInt(), 1);
  assert.strictEqual(root.get('Bar').get('y').asInt(), 2);
  console.log('✓ commas between top-level statements (optional)');
}

// Commas inside objects — optional
{
  const root = parse(`#!aml\nFoo := {x:=1,y:=2,z:=3}`);
  assert.strictEqual(root.get('Foo').get('x').asInt(), 1);
  assert.strictEqual(root.get('Foo').get('y').asInt(), 2);
  assert.strictEqual(root.get('Foo').get('z').asInt(), 3);
  console.log('✓ commas inside objects (optional)');
}

// Fully minified
{
  const root = parse(`#!aml\nname:=engine,config:={port:=8080,debug:=false},tags:=[alpha,beta]`);
  assert.strictEqual(root.get('name').asString(),              'engine');
  assert.strictEqual(root.get('config').get('port').asInt(),   8080);
  assert.strictEqual(root.get('config').get('debug').asBool(), false);
  assert.strictEqual(root.get('tags').at(0).asString(),        'alpha');
  assert.strictEqual(root.get('tags').at(1).asString(),        'beta');
  console.log('✓ fully minified document');
}

// No commas at all
{
  const root = parse(`#!aml\nA:={x:=1}B:={y:=2}C:={z:=3}`);
  assert.strictEqual(root.get('A').get('x').asInt(), 1);
  assert.strictEqual(root.get('B').get('y').asInt(), 2);
  assert.strictEqual(root.get('C').get('z').asInt(), 3);
  console.log('✓ no commas at all — still parses');
}

// Minified with inheritance
{
  const root = parse(`#!aml\nBase:={a:=1,b:=2},Child:Base:={b:=99,c:=3}`);
  assert.strictEqual(root.get('Child').get('a').asInt(), 1);
  assert.strictEqual(root.get('Child').get('b').asInt(), 99);
  assert.strictEqual(root.get('Child').get('c').asInt(), 3);
  console.log('✓ minified with inheritance');
}

// Minified array and tuple
{
  const root = parse(`#!aml\nFoo:={arr:=[1,2,3],tup:=(a,b,c)}`);
  assert.strictEqual(root.get('Foo').get('arr').at(1).asInt(),    2);
  assert.strictEqual(root.get('Foo').get('tup').at(2).asString(), 'c');
  console.log('✓ minified array and tuple');
}

console.log('\n✓ All minification tests passed');
