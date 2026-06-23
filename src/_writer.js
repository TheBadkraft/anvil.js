'use strict';

const { AnvilValueType, ScalarKind } = require('./_types');

// ---------------------------------------------------------------------------
// Writer
//
// Serializes an AnvilNode tree back to AML text.
//
// Modes:
//   preserve  (default) — VarRefs write back as $path / $a.b / $fn(...)
//   snapshot             — VarRefs resolved via resolver; unbound refs
//                           become their unresolved source syntax as a
//                           quoted string
//
// Options:
//   mode             'preserve' | 'snapshot'   (default 'preserve')
//   resolver         Resolver — required for 'snapshot'
//   indentWidth      number                    (default 2)
//   minified         boolean                   (default false)
//   inlineThreshold  number                    (default 0 — never inline)
//   quoteAllStrings  boolean                   (default false)
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
  mode: 'preserve',
  resolver: null,
  indentWidth: 2,
  minified: false,
  inlineThreshold: 0,
  quoteAllStrings: false,
};

function write(root, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.mode === 'snapshot' && !opts.resolver) {
    throw new Error('Anvil.Writer: snapshot mode requires a resolver');
  }

  const ctx = new WriterContext(opts);
  return ctx.writeRoot(root);
}

// ---------------------------------------------------------------------------
// WriterContext — holds options and formatting state during a write pass
// ---------------------------------------------------------------------------
class WriterContext {
  constructor(opts) {
    this.opts = opts;
  }

  // -------------------------------------------------------------------------
  // Root — vars block, root attributes, top-level statements
  // -------------------------------------------------------------------------
  writeRoot(root) {
    const lines = [];

    // Root attributes
    if (root._attrs && root._attrs.size > 0) {
      lines.push(this.writeAttrList(root._attrs));
    }

    // vars block
    if (root._vars && root._vars.size > 0) {
      lines.push(this.writeVarsBlock(root._vars, 0));
    }

    // Top-level statements / anonymous blocks
    const keys = root._fieldOrder || [];
    const stmts = [];
    for (const key of keys) {
      const node = root._fields.get(key);
      stmts.push(this.writeStatement(key, node, 0));
    }

    if (this.opts.minified) {
      lines.push(stmts.join(','));
    } else {
      lines.push(stmts.join('\n'));
    }

    return lines.filter(l => l.length > 0).join(this.opts.minified ? ',' : '\n');
  }

  // -------------------------------------------------------------------------
  // vars block
  // -------------------------------------------------------------------------
  writeVarsBlock(vars, depth) {
    const ind  = this.indent(depth);
    const ind1 = this.indent(depth + 1);
    const entries = [];

    for (const [name, node] of vars) {
      entries.push(`${ind1}${name}${this.assignOp()}${this.writeValue(node, depth + 1)}`);
    }

    if (this.opts.minified) {
      return `vars{${entries.map(e => e.trim()).join(',')}}`;
    }
    return `vars {\n${entries.join('\n')}\n${ind}}`;
  }

  // -------------------------------------------------------------------------
  // Top-level statement or anonymous block
  //   name (: base)? (@[...])? := value
  //   name (: base)? (@[...])? { ... }   — anonymous block
  // -------------------------------------------------------------------------
  writeStatement(name, node, depth) {
    const ind = this.indent(depth);
    let prefix = `${ind}${name}`;

    if (node.hasBase) {
      prefix += ` : ${node.baseIdentifier}`;
    }

    if (node._attrs && node._attrs.size > 0) {
      prefix += ` ${this.writeAttrList(node._attrs)}`;
    }

    if (node._anonymous) {
      return `${prefix} ${this.writeValue(node, depth)}`;
    }

    return `${prefix}${this.assignOp()}${this.writeValue(node, depth)}`;
  }

  // -------------------------------------------------------------------------
  // Dispatch by node type
  // -------------------------------------------------------------------------
  writeValue(node, depth) {
    switch (node.type) {
      case AnvilValueType.Object: return this.writeObject(node, depth);
      case AnvilValueType.Array:  return this.writeArray(node, depth);
      case AnvilValueType.Tuple:  return this.writeTuple(node, depth);
      case AnvilValueType.Blob:   return this.writeBlob(node);
      case AnvilValueType.VarRef: return this.writeVarRef(node);
      case AnvilValueType.Scalar: return this.writeScalar(node);
      default:
        throw new Error(`Anvil.Writer: unknown node type "${node.type}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Object
  // -------------------------------------------------------------------------
  writeObject(node, depth) {
    const keys = node._fieldOrder || [];

    if (keys.length === 0) return '{}';

    const ind  = this.indent(depth);
    const ind1 = this.indent(depth + 1);

    const fields = keys.map(key => {
      const fieldNode = node._fields.get(key);
      let prefix = `${ind1}${key}`;
      if (fieldNode._attrs && fieldNode._attrs.size > 0) {
        prefix += ` ${this.writeAttrList(fieldNode._attrs)}`;
      }
      return `${prefix}${this.assignOp()}${this.writeValue(fieldNode, depth + 1)}`;
    });

    if (this.opts.minified) {
      return `{${fields.map(f => f.trim()).join(',')}}`;
    }

    if (this.canInline(keys.length)) {
      const inline = fields.map(f => f.trim()).join(', ');
      return `{ ${inline} }`;
    }

    return `{\n${fields.join('\n')}\n${ind}}`;
  }

  // -------------------------------------------------------------------------
  // Array
  // -------------------------------------------------------------------------
  writeArray(node, depth) {
    return this.writeSequence(node, depth, '[', ']');
  }

  // -------------------------------------------------------------------------
  // Tuple
  // -------------------------------------------------------------------------
  writeTuple(node, depth) {
    return this.writeSequence(node, depth, '(', ')');
  }

  writeSequence(node, depth, open, close) {
    const children = node._children || [];
    if (children.length === 0) return `${open}${close}`;

    // If every element is a scalar/varref, inline regardless of count
    const allSimple = children.every(c =>
      c.type === AnvilValueType.Scalar || c.type === AnvilValueType.VarRef
    );

    if (this.opts.minified || allSimple) {
      const items = children.map(c => this.writeValue(c, depth));
      return `${open}${items.join(this.opts.minified ? ',' : ', ')}${close}`;
    }

    // Complex elements (objects/arrays/tuples) — one per line
    const ind  = this.indent(depth);
    const ind1 = this.indent(depth + 1);
    const items = children.map(c => `${ind1}${this.writeValue(c, depth + 1)}`);
    return `${open}\n${items.join('\n')}\n${ind}${close}`;
  }

  // -------------------------------------------------------------------------
  // Blob
  // -------------------------------------------------------------------------
  writeBlob(node) {
    const content = node.asString();
    const tag = node.blobTag;
    return tag ? `@${tag}\`${content}\`` : `\`${content}\``;
  }

  // -------------------------------------------------------------------------
  // Scalar
  // -------------------------------------------------------------------------
  writeScalar(node) {
    switch (node.kind) {
      case ScalarKind.String:
        return this.writeStringValue(node.asString());
      case ScalarKind.Int:
      case ScalarKind.Float:
      case ScalarKind.Bool:
      case ScalarKind.Null:
        return node.asString();
      case ScalarKind.Hex:
        return node.asString(); // canonical #RRGGBB
      case ScalarKind.Selector:
        return node.asSelector(); // #identifier, hash included
      default:
        return node.asString();
    }
  }

  // -------------------------------------------------------------------------
  // String formatting policy
  //   bare if no whitespace/special chars, quoted otherwise
  //   quoteAllStrings forces quotes always
  // -------------------------------------------------------------------------
  writeStringValue(str) {
    if (this.opts.quoteAllStrings || this.needsQuoting(str)) {
      return this.quoteString(str);
    }
    return str;
  }

  needsQuoting(str) {
    if (str.length === 0) return true;
    // Needs quoting if it contains whitespace, or characters that
    // would be misinterpreted by the lexer (commas, braces, etc.)
    return /[\s,{}\[\]()"'`#@$:]/.test(str) ||
           str === 'true' || str === 'false' || str === 'null';
  }

  quoteString(str) {
    const escaped = str
      .replace(/\\/g, '\\\\')
      .replace(/"/g,  '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r');
    return `"${escaped}"`;
  }

  // -------------------------------------------------------------------------
  // VarRef
  //   preserve — re-emit $path / $a.b / $fn(args)
  //   snapshot — resolve via resolver; unbound → unresolved syntax as string
  // -------------------------------------------------------------------------
  writeVarRef(node) {
    if (this.opts.mode === 'preserve') {
      return this.varRefSyntax(node);
    }

    // snapshot mode
    const value = this.opts.resolver.evaluate(node);
    if (value === undefined) {
      // Unbound — write the unresolved source syntax as a quoted string
      return this.quoteString(this.varRefSyntax(node));
    }

    return this.writeResolvedValue(value);
  }

  // Reconstruct $path / $a.b / $fn(args) from node fields
  varRefSyntax(node) {
    if (node._varKind === 'call') {
      const args = (node._varArgs || []).map(a => this.varRefSyntax(a)).join(', ');
      return `$${node._varName}(${args})`;
    }
    return `$${node._varPath}`;
  }

  // Write a resolved JS value back as AML
  writeResolvedValue(value) {
    if (value === null)               return 'null';
    if (typeof value === 'boolean')   return value ? 'true' : 'false';
    if (typeof value === 'number')    return String(value);
    if (typeof value === 'string')    return this.writeStringValue(value);
    // Fallback — stringify
    return this.writeStringValue(String(value));
  }

  // -------------------------------------------------------------------------
  // Attributes — @[key=value, flag]
  // -------------------------------------------------------------------------
  writeAttrList(attrs) {
    const parts = [];
    for (const [key, val] of attrs) {
      if (val === null) parts.push(key);
      else               parts.push(`${key}=${val}`);
    }
    return `@[${parts.join(', ')}]`;
  }

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------
  assignOp() {
    return this.opts.minified ? ':=' : ' := ';
  }

  indent(depth) {
    if (this.opts.minified) return '';
    return ' '.repeat(this.opts.indentWidth * depth);
  }

  canInline(fieldCount) {
    if (this.opts.minified) return false;
    return this.opts.inlineThreshold > 0 && fieldCount <= this.opts.inlineThreshold;
  }
}

module.exports = { write };
