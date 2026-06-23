# Anvil — Node.js & JavaScript Technical Guide
**June 2026 | Rev 4**

---

## What Is Anvil

Anvil is an Object Modelling Language (OML) with three dialects:

- **AML** — full modelling: objects, arrays, tuples, inheritance, vars, blobs, attributes
- **AMP** — messaging protocol: restricted, high-throughput transport format
- **ASL** — scripting: imperative logic embedded alongside declarative data

This guide covers the JavaScript/Node.js parser, implementing the full AML dialect.

---

## Installation

```bash
# From the ANVL.JS directory
cp docs/package.json .
node -e "const anvl = require('./anvl'); console.log('OK');"
```

No external dependencies. No npm install required.

---

## Entry Points

```javascript
const anvl = require('./anvl');

// Parse from a string
const root = anvl.parse(source);

// Load from a file (Node.js only)
const root = anvl.load('./config.aml');

// Error handling — both return null on failure
if (!root) {
  const err = anvl.lastError();
  console.error(`${err.message} (line ${err.line}, col ${err.column})`);
}
```

`parse()` and `load()` never throw. They return `null` on failure and populate `lastError()`.

---

## AML Syntax at a Glance

```anvl
#!aml
@[version=2, experimental]

vars {
  atlas     := terrain.png
  base_path := assets/textures
}

BaseBlock := {
  hardness  := 2.0
  texture   := $atlas
  drop      := ["stone", "gravel"]
  spawn     := (0, 64, 0)
}

StoneBlock : BaseBlock := {
  hardness := 5.0
  name     := "Stone Block"
  notes    := @md`**hard** block`
}
```

---

## The AnvilNode Type

Every value in a parsed document is an `AnvilNode`. One type, full iteration, zero friction.

### Type Inspection

```javascript
node.type   // AnvilValueType: Scalar | Object | Array | Tuple | Blob | VarRef
node.kind   // ScalarKind: String | Int | Float | Bool | Null | Hex | Selector  (Scalar only)
```

### Exported Enums

```javascript
const { AnvilValueType, ScalarKind, AnvilDialect } = require('./anvl');
```

---

## Scalar Access

```javascript
node.asString()    // string  — throws InvalidOperationError if not Scalar/Blob/VarRef
node.asInt()       // number  — Int or Hex kinds only
node.asFloat()     // number  — Float kind only
node.asBool()      // boolean — Bool kind only
node.asSelector()  // string  — Selector kind only — "#input-sku" (hash included)
node.asName()      // string  — Selector kind only — "input-sku" (hash stripped)
node.isNull()      // boolean — never throws on any node type
```

All `as*()` methods throw `InvalidOperationError` on type mismatch — fail fast, no silent coercion.

### String Values

Unquoted bare identifiers are returned as-is. Quoted strings have quotes stripped and escape sequences processed:

```javascript
// AML:  name := hello
node.asString()   // "hello"

// AML:  msg := "hello world"
node.asString()   // "hello world"

// Escape sequences processed
// AML:  path := "C:\\Users\\file"
node.asString()   // "C:\Users\file"
```

### Hex Colors

```javascript
// AML:  color := #FF0000
node.kind          // ScalarKind.Hex
node.asString()    // "#FF0000"
node.asInt()       // 16711680

// 3-digit expands to 6
// AML:  color := #FFF
node.asString()    // "#FFFFFF"
node.asInt()       // 16777215
```

---

## Object Navigation

Field access uses `get()` — any field name works, no collisions with node properties:

```javascript
// AML:  Server := { host := localhost  port := 8080  type := tcp }

const server = root.get('Server');

server.get('host').asString()   // "localhost"
server.get('port').asInt()      // 8080
server.get('type').asString()   // "tcp"  — no collision with node.type
```

### field() — Throws on Missing

```javascript
// get() returns null on missing — never throws
const node = server.get('missing');   // null

// field() throws KeyError on missing
server.field('missing');   // throws KeyError
```

### has() — Membership Test

```javascript
server.has('host')     // true
server.has('missing')  // false
```

### Typed Access with Defaults

```javascript
server.getString('host',    'localhost')   // "localhost" or default
server.getInt   ('port',    8080)          // 8080 or default
server.getBool  ('debug',   false)         // false or default
server.getFloat ('timeout', 5.0)           // 5.0 or default
```

These never throw — return the default value if the key is missing or the type doesn't match.

### Keys and Entries

```javascript
server.keys()     // ["host", "port", "type"] — declaration order

for (const [key, value] of server.entries()) {
  console.log(key, value.asString());
}
```

### count

```javascript
server.count   // number of fields
```

---

## Arrays

```anvl
#!aml
World := {
  rules := ["pvp", "keepInventory=false", "naturalRegeneration=true"]
  ids   := [101, 204, 387]
}
```

```javascript
const rules = root.get('World').get('rules');

rules.type             // AnvilValueType.Array
rules.count            // 3
rules.at(0).asString() // "pvp"
rules.at(1).asString() // "keepInventory=false"

// Iteration
for (const rule of rules) {
  console.log(rule.asString());
}

// Map to JS array
const ruleList = [...rules].map(r => r.asString());
```

`at()` throws `IndexError` on out-of-range access.

---

## Tuples

Tuples are positional, heterogeneous, fixed-arity:

```anvl
#!aml
World := {
  spawn  := (0, 64, -200)
  header := ("player.join", 2, true)
}
```

```javascript
const spawn = root.get('World').get('spawn');

spawn.type            // AnvilValueType.Tuple
spawn.at(0).asInt()   // 0
spawn.at(1).asInt()   // 64
spawn.at(2).asInt()   // -200

// Destructure
const [x, y, z] = [...spawn].map(v => v.asInt());

// Mixed types
const header = root.get('World').get('header');
header.at(0).asString()  // "player.join"
header.at(1).asInt()     // 2
header.at(2).asBool()    // true
```

---

## Nested Collections

Arrays and tuples accept any value type as elements — objects, arrays, tuples, or scalars:

```anvl
#!aml
Weapons := [
  { name := Sword  damage := 15 }
  { name := Axe    damage := 20 }
]

Grid   := [ [1, 2, 3], [4, 5, 6] ]
Points := [ (0, 64, 0), (10, 64, -5) ]

Player := (Aria, { health := 100  stamina := 50 }, warrior)
```

```javascript
root.get('Weapons').at(0).get('name').asString()   // "Sword"
root.get('Grid').at(1).at(2).asInt()               // 6
root.get('Points').at(0).at(1).asInt()             // 64
root.get('Player').at(1).get('health').asInt()     // 100
```

---

## Blobs

Tagged and untagged blob literals embed raw content directly in the document:

```anvl
#!aml
Foo := {
  readme  := @md`# Title\nSome content here`
  query   := @sql`SELECT * FROM users WHERE active = 1`
  raw     := `untagged content`
  encoded := @png`iVBORw0KGgo=`
}
```

```javascript
const node = root.get('Foo').get('readme');

node.type       // AnvilValueType.Blob
node.blobTag    // "md"
node.asString() // "# Title\nSome content here"

// Zero-copy Uint8Array over source buffer
const buf = node.asBuffer();
```

Untagged blobs have `blobTag === null`.

---

## vars Block

A `vars` block declares named, reusable values at document root. VarRefs (`$name`) are catalogued by the parser and resolved at runtime — never at parse time:

```anvl
#!aml
vars {
  atlas     := terrain.png
  base_path := assets/textures
  scale     := 1.5
}

Block := {
  texture := $atlas
  path    := $base_path
}
```

```javascript
const root = anvl.parse(src);

// Introspect vars on the root node (raw nodes, not resolved)
root.hasVar('atlas')           // true
root.var('atlas').asString()   // "terrain.png"
root.var('missing')            // null

// Resolve via resolver (see VarRef and Resolver sections)
const resolver = root.getResolver();
resolver.evaluate(root.get('Block').get('texture'))  // "terrain.png"
```

---

## VarRefs

`$` is a deferred substitution sigil. The parser catalogues every VarRef and hands them off — it never resolves them. Resolution is always a runtime concern via the Resolver.

### Three shapes

```anvl
// Simple identifier
texture := $atlas

// Dotted path
source := $record.vehicle_id

// Callable with arguments
total := $sum($record.parts_cost, $record.labor_cost)
```

### VarRef nodes

```javascript
const node = root.get('Block').get('texture');
node.type       // AnvilValueType.VarRef
node._varKind   // 'ref'
node._varPath   // 'atlas'
node.asString() // '$atlas' — path representation, not resolved value

const src = root.get('Foo').get('source');
src._varKind    // 'ref'
src._varPath    // 'record.vehicle_id'

const total = root.get('Foo').get('total');
total._varKind          // 'call'
total._varName          // 'sum'
total._varArgs.length   // 2
total._varArgs[0]._varPath  // 'record.parts_cost'
total._varArgs[1]._varPath  // 'record.labor_cost'
```

Unknown VarRefs are not parse errors — they are registered and left unresolved until runtime.

---

## Registry and Resolver

The parser builds an internal `_registry` — a catalogue of every VarRef encountered. The consumer gets a `Resolver` via `root.getResolver()`, injected with that registry.

### Getting a Resolver

```javascript
const root     = anvl.parse(source);
const resolver = root.getResolver();
```

The Resolver is per-document. Each parsed root has its own registry and resolver. There is no global state.

### Registering bindings and functions

```javascript
// Bind a live object under a namespace — dotted paths resolve against it
resolver.bind('record', { vehicle_id: 'V-001', odometer: 12345 });

// Register a callable for $name(...) resolution
resolver.register('sum',     (...args) => args.reduce((a, b) => a + b, 0));
resolver.register('diff',    (a, b) => a - b);
resolver.register('product', (...args) => args.reduce((a, b) => a * b, 1));
resolver.register('concat',  (...args) => args.join(''));
```

### Evaluating VarRef nodes

```javascript
// One-shot evaluation
const node  = root.get('Foo').get('source');   // $record.vehicle_id
const value = resolver.evaluate(node);          // "V-001"

// Callable evaluation
const total = root.get('Foo').get('total');    // $sum($record.parts_cost, $record.labor_cost)
resolver.bind('record', { parts_cost: 150, labor_cost: 75 });
resolver.evaluate(total);                       // 225

// Unbound ref returns undefined — not an error
resolver.evaluate(root.get('Foo').get('unknown'));  // undefined
```

### Static vars — pre-warmed automatically

Vars block entries are pre-warmed into the static tier at `getResolver()` call time. Cross-refs in vars are resolved in topological order:

```anvl
vars {
  base := assets
  sub  := $base        // resolved after base
}
```

```javascript
const resolver = root.getResolver();
resolver.statics   // { base: 'assets', sub: 'assets' }

// Static VarRef evaluates immediately without bind()
resolver.evaluate(root.get('Block').get('texture'))  // "terrain.png"
```

### Reactive observation

```javascript
// Observe a dotted path — callback fires whenever bind() updates that namespace
resolver.observe('record.odometer', (newValue, path) => {
  console.log(`${path} changed to ${newValue}`);
});

resolver.bind('record', { odometer: 42 });    // fires callback → 42
resolver.bind('record', { odometer: 999 });   // fires callback → 999

// Remove observer
resolver.unobserve('record.odometer', callback);
```

### Introspection

```javascript
resolver.refPaths   // ['atlas', 'record.vehicle_id', 'record.odometer'] — all ref paths
resolver.callNames  // ['sum', 'diff'] — all callable names
resolver.statics    // { atlas: 'terrain.png', ... } — pre-warmed vars
```

---

## Inheritance

Single inheritance with lazy merge. Derived statements transparently include all base fields:

```anvl
#!aml
BaseBlock := {
  hardness   := 2.0
  drop       := gravel
  flammable  := false
}

StoneBlock : BaseBlock := {
  hardness := 5.0
  name     := Stone
}
```

```javascript
const stone = root.get('StoneBlock');

stone.get('hardness').asFloat()    // 5.0   — overridden
stone.get('drop').asString()       // "gravel" — inherited
stone.get('flammable').asBool()    // false    — inherited
stone.get('name').asString()       // "Stone"  — own

stone.hasBase           // true
stone.baseIdentifier    // "BaseBlock"
stone.is('BaseBlock')   // true
```

### Deep Chains

```javascript
hero.is('Character')  // true
hero.is('Entity')     // true
```

Cycles are detected at parse time and return `null` with a descriptive error.

---

## Attributes

Attributes annotate any node without entering the value tree:

```anvl
#!aml
@[version=2, experimental]

world @[seed=1337] := {
  rules @[hardcore] := ["pvp"]
  spawn @[respawn]  := (0, 64, 0)
}
```

```javascript
root.hasAttribute('version')      // true
root.attribute('version')         // "2"  (always string)
root.hasAttribute('experimental') // true
root.attribute('experimental')    // null  (flag — no value)

root.get('world').attribute('seed')                    // "1337"
root.get('world').get('rules').hasAttribute('hardcore') // true

const attrs = root.get('world').attributes;  // { seed: "1337" }
```

---

## Selectors

`#identifier` is a first-class scalar kind — a DOM/CSS selector:

```anvl
#!aml
Button := {
  target := #submit-btn
  label  := #error-msg
}
```

```javascript
const btn = root.get('Button');

btn.get('target').kind          // ScalarKind.Selector
btn.get('target').asString()    // "#submit-btn"  — exactly as written
btn.get('target').asSelector()  // "#submit-btn"  — hash included, DOM/CSS ready
btn.get('target').asName()      // "submit-btn"   — hash stripped, bare ID

document.querySelector(btn.get('target').asSelector())
document.getElementById(btn.get('target').asName())
```

Selectors and hex colors coexist without ambiguity:

```javascript
root.get('Foo').get('color').kind   // ScalarKind.Hex
root.get('Foo').get('target').kind  // ScalarKind.Selector
```

Selectors work in arrays, tuples, and vars — anywhere a scalar is valid.

---

## Anonymous Blocks

`IDENT { ... }` — a named grouping construct, not a statement. No `:=`, no assignment:

```anvl
#!aml
bindings {
  sku   := { target := #input-sku,   mode := twoway   }
  price := { target := #label-price, mode := readonly }
}
```

```javascript
root.get('bindings').get('sku').get('target').asSelector()  // "#input-sku"
root.get('bindings').get('sku').get('mode').asString()      // "twoway"
```

Anonymous blocks support attributes and can inherit from named statements:

```anvl
config : BaseConfig @[stable] { debug := true }
```

Anonymous blocks **cannot** be used as base types — a resolver error is raised if attempted.

---

## Comments

```anvl
#!aml
// Single-line comment

/* Multi-line
   block comment */

Config := {
  port := 8080   // inline comment
}
```

`#` is **not** a comment — valid only as a hex color (`#RRGGBB`, `#RGB`) or selector (`#identifier`). A bare `#` forming neither is a parse error.

---

## Minification

Commas between all elements are optional. Minified output is fully valid AML:

```javascript
const src = `#!aml\nname:=engine,config:={port:=8080,debug:=false},tags:=[alpha,beta]`;
const root = anvl.parse(src);

root.get('name').asString()              // "engine"
root.get('config').get('port').asInt()   // 8080
root.get('tags').at(0).asString()        // "alpha"
```

---

## Iteration Patterns

`AnvilNode` implements `Symbol.iterator`. Objects yield field values; arrays and tuples yield elements:

```javascript
const rules = [...root.get('world').get('rules')].map(r => r.asString());

const hasPvp = [...root.get('world').get('rules')]
  .some(r => r.asString() === 'pvp');

const fields = [...root.get('Config').entries()]
  .map(([k, v]) => ({ key: k, value: v.asString() }));
```

---

## Error Handling

```javascript
const root = anvl.parse(badSource);
if (!root) {
  const err = anvl.lastError();
  console.error(err.message);   // human-readable description
  console.error(err.line);      // 1-based line number
  console.error(err.column);    // 1-based column
  console.error(err.file);      // file path, or null for in-memory parse
}
```

### Error Types

| Error | Thrown by | When |
|---|---|---|
| `AnvilParseError` | Lexer / Parser | Syntax error — caught, stored in `lastError()` |
| `AnvilResolverError` | Registry | Unknown base, inheritance cycle — caught, stored in `lastError()` |
| `InvalidOperationError` | AnvilNode | `as*()` on wrong type, `at()` on non-Array/Tuple |
| `KeyError` | AnvilNode | `field(key)` with missing key |
| `IndexError` | AnvilNode | `at(index)` out of range |

---

## Zero-Copy Access

```javascript
// Uint8Array subarray over original source buffer — no string allocation
const buf = node.asBuffer();   // Scalar or Blob nodes
```

---

## Complete Example

```anvl
#!aml
@[version=2, experimental]

vars {
  default_health := 100
  world_name     := Survival
}

Entity := {
  health := $default_health
  level  := 1
}

Hero : Entity @[player] := {
  name   := Aria
  weapon := sword
  level  := 5
  spawn  := (0, 64, 0)
  tags   := ["warrior", "founder"]
}

bindings {
  health  := { target := #b-health,  mode := readonly }
  odometer := { target := #b-odo,   mode := twoway   }
}
```

```javascript
const anvl     = require('./anvl');
const root     = anvl.load('./game.aml');
const resolver = root.getResolver();

// Resolver — bind live data
resolver.bind('record', { health: 100, odometer: 5432 });
resolver.register('sum', (...args) => args.reduce((a, b) => a + b, 0));

// Document metadata
root.hasAttribute('experimental')  // true
root.attribute('version')           // "2"

// Vars
root.var('world_name').asString()   // "Survival"

// Hero — inherits from Entity
const hero = root.get('Hero');
hero.get('name').asString()         // "Aria"
hero.get('health').type             // AnvilValueType.VarRef — resolved via resolver
resolver.evaluate(hero.get('health'))  // "100" (static var)
hero.get('level').asInt()           // 5
hero.hasAttribute('player')         // true
hero.is('Entity')                   // true

// Spawn tuple
const [x, y, z] = [...hero.get('spawn')].map(v => v.asInt());

// Bindings — anonymous block with selectors
root.get('bindings').get('health').get('target').asSelector()   // "#b-health"
root.get('bindings').get('odometer').get('mode').asString()     // "twoway"
```

---

## API Quick Reference

### Entry Points

| Function | Returns | Description |
|---|---|---|
| `anvl.parse(source)` | `AnvilNode \| null` | Parse AML string |
| `anvl.load(path)` | `AnvilNode \| null` | Load and parse AML file |
| `anvl.lastError()` | `AnvilError \| null` | Last parse/resolve error |

### AnvilNode — Scalar

| Method | Returns | Notes |
|---|---|---|
| `node.asString()` | `string` | Throws if not Scalar/Blob/VarRef |
| `node.asInt()` | `number` | Int or Hex kinds only |
| `node.asFloat()` | `number` | Float kind only |
| `node.asBool()` | `boolean` | Bool kind only |
| `node.asSelector()` | `string` | Selector kind only — hash included |
| `node.asName()` | `string` | Selector kind only — hash stripped |
| `node.isNull()` | `boolean` | Never throws |
| `node.asBuffer()` | `Uint8Array` | Zero-copy source slice — Scalar or Blob |

### AnvilNode — Blob

| Member | Returns | Notes |
|---|---|---|
| `node.blobTag` | `string \| null` | Tag e.g. "md", "png", "sql" — null if untagged |
| `node.asString()` | `string` | Raw blob content |
| `node.asBuffer()` | `Uint8Array` | Zero-copy source slice |

### AnvilNode — VarRef

| Member | Returns | Notes |
|---|---|---|
| `node._varKind` | `'ref' \| 'call'` | Shape of this VarRef |
| `node._varPath` | `string` | Dotted path for refs |
| `node._varName` | `string` | Function name for callables |
| `node._varArgs` | `AnvilNode[]` | Arguments for callables |
| `node.asString()` | `string` | Path representation e.g. `$record.vehicle_id` |

### AnvilNode — Object

| Method | Returns | Notes |
|---|---|---|
| `node.get(key)` | `AnvilNode \| null` | Never throws |
| `node.field(key)` | `AnvilNode` | Throws `KeyError` on missing |
| `node.has(key)` | `boolean` | Membership test |
| `node.getString(key, default)` | `string` | Safe typed access |
| `node.getInt(key, default)` | `number` | Safe typed access |
| `node.getFloat(key, default)` | `number` | Safe typed access |
| `node.getBool(key, default)` | `boolean` | Safe typed access |
| `node.keys()` | `string[]` | Declaration order |
| `node.entries()` | `Iterator` | `[key, AnvilNode]` pairs |
| `node.count` | `number` | Field count |

### AnvilNode — Array / Tuple

| Method | Returns | Notes |
|---|---|---|
| `node.at(index)` | `AnvilNode` | Throws `IndexError` on out-of-range |
| `node.count` | `number` | Element count |

### AnvilNode — Inheritance

| Member | Returns | Notes |
|---|---|---|
| `node.hasBase` | `boolean` | True if derived |
| `node.baseIdentifier` | `string \| null` | Base name as written |
| `node.is(name)` | `boolean` | Walks full chain |

### AnvilNode — Attributes

| Method | Returns | Notes |
|---|---|---|
| `node.hasAttribute(key)` | `boolean` | Flag or key=value |
| `node.attribute(key)` | `string \| null` | null for flags |
| `node.attributes` | `object` | Full map copy |

### AnvilNode — Vars (root only)

| Method | Returns | Notes |
|---|---|---|
| `root.hasVar(name)` | `boolean` | |
| `root.var(name)` | `AnvilNode \| null` | Raw node — use resolver to evaluate |
| `root.getResolver()` | `Resolver` | Runtime resolver for this document |

### Resolver

| Method | Returns | Notes |
|---|---|---|
| `resolver.bind(namespace, obj)` | `Resolver` | Register live object — chainable |
| `resolver.register(name, fn)` | `Resolver` | Register callable — chainable |
| `resolver.evaluate(node)` | `any \| undefined` | Evaluate VarRef node |
| `resolver.observe(path, cb)` | `Resolver` | Subscribe to path changes |
| `resolver.unobserve(path, cb)` | `Resolver` | Remove subscription |
| `resolver.statics` | `object` | Pre-warmed vars entries |
| `resolver.refPaths` | `string[]` | All catalogued ref paths |
| `resolver.callNames` | `string[]` | All catalogued callable names |

### AnvilNode — Universal

| Member | Returns | Notes |
|---|---|---|
| `node.type` | `AnvilValueType` | Scalar, Object, Array, Tuple, Blob, VarRef |
| `node.kind` | `ScalarKind \| null` | String, Int, Float, Bool, Null, Hex, Selector |
| `node.count` | `number` | Fields or elements |
| `for...of node` | `AnvilNode` | Values (Object) or elements (Array/Tuple) |

---

## What's Coming

- Interpolated strings (`$"Hello, {user_id}"`)
- Multi-file imports (`import "file.aml"`, `import "file.aml" as alias`)
- `loadDirectory()`
- AMP dialect enforcement
- ASL scripting dialect
- Schema validation
- TypeScript type definitions (`index.d.ts`)
- ESM module output

---

## Amendment — Design Decisions and Parked Items
*Decisions reached through design discussion. Not yet implemented. Recorded here for continuity.*

---

### `_registry` — Internal VarRef Catalogue

The `_registry` is populated during parsing — every VarRef encountered is catalogued with its shape and position in the tree. Nothing is resolved. The registry is a catalogue, not a resolver. Each parse operation produces its own `_registry`. The root node owns it. Consumers access it via `root.getResolver()`.

---

### `resolver.merge(r)` — Parked

*Noted as a concept. Not scheduled for implementation. Needs proper grounding before building.*

**Scenario:** A user independently parses two documents and wants to compose their resolvers into one.

**Pros:**
- Enables multi-document composition at runtime
- Useful when two binding documents share a common vars source parsed independently
- Composable — build a resolver from parts

**Cons:**
- Collision handling policy undefined — what happens when two documents both register `$record.vehicle_id`?
- Encourages global-registry-like thinking through the back door
- Complexity the current use case doesn't need

**Critical constraint:** If `merge()` is ever built, merged registries are entirely the user's responsibility. The parser and resolver make no attempt to detect or resolve collisions across merged documents.

---

### Imports and Multi-Root Registry — Open Design Question

*Not resolved. Requires dedicated design discussion before implementation.*

When multi-file imports land, it is not yet settled whether:

- All imported documents fold into a single parse graph under one root with one registry, or
- Each imported document maintains its own root and registry, with the parent root providing visibility into all of them

**This is an open question. No implementation should proceed on imports or multi-document registry behavior until this is resolved.**

---

*Anvil — One document type. One consumer type. No ceremony.*
