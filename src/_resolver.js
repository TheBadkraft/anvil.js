'use strict';

const { AnvilValueType } = require('./_types');

// ---------------------------------------------------------------------------
// Resolver
//
// Runtime resolution of VarRef nodes. Injected with the Registry from a
// parsed document. Consumer registers live values and functions against it.
//
// Two tiers:
//   Static  — vars block entries, pre-warmed from registry at construction
//   Dynamic — runtime refs, resolved when consumer calls bind()/register()
//
// Usage:
//   const resolver = root.getResolver();
//   resolver.bind('record', liveRecordObject);
//   resolver.register('sum', (...args) => args.reduce((a, b) => a + b, 0));
//   const value = resolver.evaluate(node);
//   resolver.observe('record.odometer', (newVal) => { ... });
// ---------------------------------------------------------------------------
class Resolver {
  constructor(registry) {
    this._registry = registry;
    this._static   = new Map();   // pre-warmed vars
    this._bindings = new Map();   // namespace → object
    this._functions = new Map();  // name → callable
    this._observers = new Map();  // path → Set<callback>

    this._resolveStatics();
  }

  // Pre-warm vars block entries — topological order for cross-refs
  _resolveStatics() {
    const vars = this._registry.vars;
    if (!vars || vars.size === 0) return;

    const literals = new Map();
    const deferred = new Map();

    for (const [name, node] of vars) {
      if (node.type === AnvilValueType.VarRef) {
        deferred.set(name, node);
      } else {
        literals.set(name, node.asString());
      }
    }

    for (const [name, value] of literals) this._static.set(name, value);

    // Iterative topological resolution for deferred vars
    let remaining = new Map(deferred);
    let maxPasses = remaining.size + 1;
    while (remaining.size > 0 && maxPasses-- > 0) {
      for (const [name, node] of remaining) {
        try {
          const value = this._evaluateVarRef(node);
          if (value !== undefined) {
            this._static.set(name, value);
            remaining.delete(name);
          }
        } catch { /* dependency not yet resolved */ }
      }
    }
  }

  // Register a live object under a namespace for dotted path resolution
  bind(namespace, object) {
    this._bindings.set(namespace, object);
    this._notifyNamespace(namespace);
    return this;
  }

  // Register a callable for $name(...) resolution
  register(name, fn) {
    this._functions.set(name, fn);
    return this;
  }

  // Evaluate a VarRef node to its current value
  evaluate(node) {
    if (!node || node.type !== AnvilValueType.VarRef) return undefined;
    return this._evaluateVarRef(node);
  }

  _evaluateVarRef(node) {
    if (node._varKind === 'call') return this._evaluateCall(node);
    return this._evaluatePath(node._varPath);
  }

  _evaluatePath(path) {
    if (this._static.has(path)) return this._static.get(path);
    const parts = path.split('.');
    if (parts.length === 1) return this._bindings.get(path);
    const [namespace, ...rest] = parts;
    let obj = this._bindings.get(namespace);
    for (const key of rest) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  }

  _evaluateCall(node) {
    const fn = this._functions.get(node._varName);
    if (!fn) return undefined;
    const args = (node._varArgs || []).map(arg => this._evaluateVarRef(arg));
    return fn(...args);
  }

  // Observe a dotted path — callback fires when value changes
  observe(path, callback) {
    if (!this._observers.has(path)) this._observers.set(path, new Set());
    this._observers.get(path).add(callback);
    return this;
  }

  unobserve(path, callback) {
    this._observers.get(path)?.delete(callback);
    return this;
  }

  _notifyNamespace(namespace) {
    for (const [path, callbacks] of this._observers) {
      if (path.split('.')[0] !== namespace) continue;
      const value = this._evaluatePath(path);
      for (const cb of callbacks) cb(value, path);
    }
  }

  // Introspection
  get refPaths()  {
    return this._registry.refs
      .filter(n => n._varKind === 'ref')
      .map(n => n._varPath);
  }

  get callNames() {
    return [...new Set(
      this._registry.refs
        .filter(n => n._varKind === 'call')
        .map(n => n._varName)
    )];
  }

  get statics() { return Object.fromEntries(this._static); }
}

module.exports = { Resolver };
