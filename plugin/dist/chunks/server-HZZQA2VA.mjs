import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path8) {
      const ctrl = callVisitor(key, node, visitor, path8);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path8, ctrl);
        return visit_(key, ctrl, visitor, path8);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path8 = Object.freeze(path8.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path8);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path8 = Object.freeze(path8.concat(node));
          const ck = visit_("key", node.key, visitor, path8);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path8);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path8) {
      const ctrl = await callVisitor(key, node, visitor, path8);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path8, ctrl);
        return visitAsync_(key, ctrl, visitor, path8);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path8 = Object.freeze(path8.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path8);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path8 = Object.freeze(path8.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path8);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path8);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path8) {
      if (typeof visitor === "function")
        return visitor(key, node, path8);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path8);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path8);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path8);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path8);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path8);
      return void 0;
    }
    function replaceNode(key, path8, node) {
      const parent = path8[path8.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path8, value) {
      let v = value;
      for (let i = path8.length - 1; i >= 0; --i) {
        const k = path8[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path8) => path8 == null || typeof path8 === "object" && !!path8[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path8, value) {
        if (isEmptyPath(path8))
          this.add(value);
        else {
          const [key, ...rest] = path8;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path8) {
        const [key, ...rest] = path8;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path8, keepScalar) {
        const [key, ...rest] = path8;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path8) {
        const [key, ...rest] = path8;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path8, value) {
        const [key, ...rest] = path8;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text2, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text2;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text2.length <= endStep)
        return text2;
      const folds = [];
      const escapedFolds = {};
      let end2 = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end2 = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text2, i, indent.length);
        if (i !== -1)
          end2 = i + endStep;
      }
      for (let ch; ch = text2[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text2[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text2, i, indent.length);
          end2 = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text2[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end2) {
            if (split) {
              folds.push(split);
              end2 = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text2[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text2;
              folds.push(j);
              escapedFolds[j] = true;
              end2 = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text2;
      if (onFold)
        onFold();
      let res = text2.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end3 = folds[i2 + 1] || text2.length;
        if (fold === 0)
          res = `
${indent}${text2.slice(0, end3)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text2[fold]}\\`;
          res += `
${indent}${text2.slice(fold + 1, end3)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text2, i, indent) {
      let end2 = i;
      let start = i + 1;
      let ch = text2[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text2[++i];
        } else {
          do {
            ch = text2[++i];
          } while (ch && ch !== "\n");
          end2 = i;
          start = i + 1;
          ch = text2[start];
        }
      }
      return end2;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json2 = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json2;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json2[i]; ch; ch = json2[++i]) {
        if (ch === " " && json2[i + 1] === "\\" && json2[i + 2] === "n") {
          str += json2.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json2[i + 1]) {
            case "u":
              {
                str += json2.slice(start, i);
                const code = json2.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json2.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json2[i + 2] === '"' || json2.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json2.slice(start, i) + "\n\n";
                while (json2[i + 2] === "\\" && json2[i + 3] === "n" && json2[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json2[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json2.slice(start) : json2;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end2 = value.substring(endStart);
      const endNlPos = end2.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end2 || endNlPos !== end2.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end2) {
        value = value.slice(0, -end2.length);
        if (end2[end2.length - 1] === "\n")
          end2 = end2.slice(0, -1);
        end2 = end2.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end2}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end2}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end: end2 } = flowChars;
      if (lines.length === 0) {
        return start + end2;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end2}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end2}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path8, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path8, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path8) {
        if (Collection.isEmptyPath(path8)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path8) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path8, keepScalar) {
        if (Collection.isEmptyPath(path8))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path8, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path8) {
        if (Collection.isEmptyPath(path8))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path8) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path8, value) {
        if (Collection.isEmptyPath(path8)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path8), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path8, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json: json2, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json2,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end2 = error.linePos[1];
        if (end2?.line === line && end2.col > col) {
          count = Math.max(1, Math.min(end2.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end2 = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end: end2,
        start: start ?? end2
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end2 = fc.end[0];
        if (end2.indent === indent && (end2.source === "]" || end2.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end2, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end2, offset, reqSpace, onError) {
      let comment = "";
      if (end2) {
        let hasSpace = false;
        let sep = "";
        for (const token of end2) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end2 = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end2.comment) {
          if (coll.comment)
            coll.comment += "\n" + end2.comment;
          else
            coll.comment = end2.comment;
        }
        coll.range = [fc.offset, cePos, end2.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end3 = start + header.length;
        if (scalar.source)
          end3 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end3, end3] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end2 = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end2, end2] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end: end2 } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end2, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end: end2 }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end2;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end: end2 }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end2, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end: end2 }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end2?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end2, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end2 = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end2.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end2.comment}` : end2.comment;
            }
            this.doc.range[2] = end2.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end2 = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end2))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end: end2 };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end: end2 };
        default:
          return { type: "scalar", offset, indent, source, end: end2 };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end2) {
      if (end2)
        for (const st of end2)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end2 = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end2)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end: end2 });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end2 = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end: end2 });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path8) => {
      let item = cst;
      for (const [field, index] of path8) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path8) => {
      const parent = visit.itemAtPath(cst, path8.slice(0, -1));
      const field = path8[path8.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path8, item, visitor) {
      let ctrl = visitor(item, path8);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path8.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path8);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path8) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end2 = this.lineEndPos;
        if (typeof end2 !== "number" || end2 !== -1 && end2 < this.pos) {
          end2 = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end2;
        }
        if (end2 === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end2 - 1] === "\r")
          end2 -= 1;
        return this.buffer.substring(this.pos, end2);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end2 = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end2 !== -1 && this.buffer[end2 + 1] === "'")
            end2 = this.buffer.indexOf("'", end2 + 2);
        } else {
          while (end2 !== -1) {
            let n = 0;
            while (this.buffer[end2 - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end2 = this.buffer.indexOf('"', end2 + 1);
          }
        }
        const qb = this.buffer.substring(0, end2);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end2 = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end2 === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end2 = this.buffer.length;
        }
        yield* this.pushToIndex(end2 + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end2 = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end2 = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end2 = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end2 = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end2 + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end2 = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end2) ? end2[end2.length - 1] : void 0;
              if (last?.type === "comment")
                end2?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end2 = prev?.value?.end;
                if (Array.isArray(end2)) {
                  arrayPushArray(end2, it.start);
                  end2.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end2 = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end2) ? end2[end2.length - 1] : void 0;
              if (last?.type === "comment")
                end2?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end2 = prev?.value?.end;
                if (Array.isArray(end2)) {
                  arrayPushArray(end2, it.start);
                  end2.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse2(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse2;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// src/plugin/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// plugin/.claude-plugin/plugin.json
var plugin_default = {
  name: "openplan",
  version: "0.1.0",
  description: "A team of Claude Code sessions on your repository: any model per member, a meeting before the plan, state machines in charge of the process.",
  author: {
    name: "geezerrrr"
  },
  repository: "https://github.com/geezerrrr/openplan",
  license: "MIT",
  keywords: ["team", "multi-agent", "planning", "worktrees"],
  types: "./types/index.d.ts"
};

// src/engine/core.ts
var workOf = (core) => ({
  ...core.state,
  members: core.team.members.map((m) => m.name)
});
var errorText = (error) => error instanceof Error ? error.message : String(error);

// src/engine/data.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
function repoFolder(dataFolder2, repo) {
  const name = path.basename(repo.top).replace(/[^\w.-]+/g, "-");
  const hash = createHash("sha256").update(repo.common).digest("hex").slice(0, 12);
  return path.join(dataFolder2, "repos", `${name}-${hash}`);
}
var dataFiles = (folder) => ({
  state: path.join(folder, "state.json"),
  lock: path.join(folder, "lock"),
  members: path.join(folder, "members.json"),
  /** A member's settings file (policy.ts writeSettings). */
  settings: (member) => path.join(folder, "settings", `${member}.json`)
});
var STATE_VERSION = 1;
var SAVE_DELAY_MS = 200;
async function readState(file) {
  let text2;
  try {
    text2 = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { goals: [], tasks: [], subtasks: [], meetings: [], questions: [] };
  }
  let saved;
  try {
    saved = JSON.parse(text2);
  } catch (error) {
    throw new Error(`${file} can't be read (${errorText(error)}): move it away to start over`, {
      cause: error
    });
  }
  if (saved.version > STATE_VERSION)
    throw new Error(`${file} was written by a newer openplan: update openplan to go on`);
  return saved.state;
}
function stateWriter(file, state, failed) {
  let timer;
  let writing2 = Promise.resolve();
  const write = () => {
    timer = void 0;
    writing2 = writing2.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const fresh = `${file}.new`;
      await writeFile(fresh, JSON.stringify({ version: STATE_VERSION, state: state() }));
      await rename(fresh, file);
    }).catch(failed);
  };
  return {
    changed() {
      timer ??= setTimeout(write, SAVE_DELAY_MS);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        write();
      }
      await writing2;
    }
  };
}
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function holderOf(lock) {
  let holder;
  try {
    holder = JSON.parse(readFileSync(lock, "utf8"));
  } catch {
    return void 0;
  }
  return running(holder.pid) ? holder : void 0;
}
var hold = async (lock, open2) => {
  await mkdir(path.dirname(lock), { recursive: true });
  const holder = { pid: process.pid, session: process.ppid, open: open2 };
  await writeFile(lock, JSON.stringify(holder));
};
async function takeTeam(lock) {
  const holder = holderOf(lock);
  if (holder && holder.pid !== process.pid)
    throw new Error(
      `Another Claude Code session runs this repository's team (pid ${String(holder.session)}). If it has ended, delete ${lock}`
    );
  await hold(lock, false);
}
var openedTeam = (lock) => hold(lock, true);
function releaseTeam(lock) {
  if (holderOf(lock)?.pid === process.pid) unlinkSync(lock);
}

// src/engine/git.ts
import { spawn } from "node:child_process";
import { readdir, readFile as readFile2, realpath, rm, stat } from "node:fs/promises";
import path2 from "node:path";

// src/engine/serial.ts
function serialBy() {
  const queues = /* @__PURE__ */ new Map();
  return function serial2(key, task) {
    const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
    const settled = next.catch(() => void 0);
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return next;
  };
}

// src/engine/git.ts
var FLAGS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.longpaths=true"
];
var GitError = class extends Error {
  constructor(args, code, output) {
    super(`git ${args[0] ?? ""}: ${output}`);
    this.args = args;
    this.code = code;
    this.output = output;
    this.name = "GitError";
  }
  args;
  code;
  output;
};
function git(at, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...FLAGS, ...args], {
      cwd: at.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...at.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
    child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (code) => {
      const exit = code ?? -1;
      if (exit === 0 || options.allow?.includes(exit)) resolve({ code: exit, stdout, stderr });
      else reject(new GitError(args, exit, (stderr || stdout).trim()));
    });
    child.stdin.end(options.input);
  });
}
var memberSigner = (member) => ({
  name: member,
  email: `${member}@openplan.local`
});
var authorEnv = (by) => ({
  GIT_AUTHOR_NAME: by.name,
  GIT_AUTHOR_EMAIL: by.email,
  GIT_COMMITTER_NAME: by.name,
  GIT_COMMITTER_EMAIL: by.email
});
async function openRepository(folder) {
  const at = { cwd: folder };
  const found = await git(at, ["rev-parse", "--show-toplevel", "--git-common-dir"], {
    allow: [128]
  });
  const [top, common] = found.stdout.split("\n");
  if (found.code !== 0 || !top || !common)
    throw new GitError(["rev-parse"], found.code, `${folder} is not in a git repository`);
  const head = await git(at, ["rev-parse", "--verify", "-q", "HEAD"], { allow: [1] });
  if (head.code !== 0)
    throw new GitError(["rev-parse"], head.code, `${top} has no commit to start from yet`);
  return { top: await realpath(top), common: await realpath(path2.resolve(folder, common)) };
}
var goalBranch = (slug) => `openplan/${slug}/main`;
var goalFolder = (places, slug) => path2.join(places.root, "goals", slug);
async function takenSlugs(repo) {
  const refs = await git({ cwd: repo.top }, [
    "for-each-ref",
    "--format=%(refname:lstrip=3)",
    "refs/heads/openplan/"
  ]);
  return new Set(refs.stdout.split("\n").flatMap((ref) => ref ? [ref.split("/")[0] ?? ""] : []));
}
function slugFor(name, taken) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "goal";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const slug = `${base}-${String(n)}`;
    if (!taken.has(slug)) return slug;
  }
}
var exists = (file) => stat(file).then(
  () => true,
  () => false
);
var unlist = (repo, folder) => git({ cwd: repo.top }, ["worktree", "remove", "--force", folder], { allow: [128] });
async function openGoal(places, slug) {
  const { repo } = places;
  const branch = goalBranch(slug);
  const folder = goalFolder(places, slug);
  const cut = await git({ cwd: repo.top }, ["rev-parse", "--verify", "-q", branch], { allow: [1] });
  if (cut.code !== 0) await git({ cwd: repo.top }, ["branch", branch, "HEAD"]);
  if (!await exists(folder)) {
    await unlist(repo, folder);
    await git({ cwd: repo.top }, ["worktree", "add", "-q", folder, branch]);
  }
  return folder;
}
var subtaskBranch = (slug, subtaskId) => `openplan/${slug}/${subtaskId}`;
var deskFolder = (places, subtaskId) => path2.join(places.root, "desks", subtaskId);
var serial = serialBy();
var perGoal = (places, slug, task) => serial(goalFolder(places, slug), task);
function openDesk(places, slug, subtaskId) {
  return perGoal(places, slug, async () => {
    const { repo } = places;
    const desk = deskFolder(places, subtaskId);
    await openGoal(places, slug);
    if (await exists(path2.join(desk, ".git"))) return desk;
    await rm(desk, { recursive: true, force: true });
    await unlist(repo, desk);
    const branch = subtaskBranch(slug, subtaskId);
    const kept = await git({ cwd: repo.top }, ["rev-parse", "--verify", "-q", branch], {
      allow: [1]
    });
    await git(
      { cwd: repo.top },
      kept.code === 0 ? ["worktree", "add", "-q", desk, branch] : ["worktree", "add", "-q", "-b", branch, desk, goalBranch(slug)]
    );
    return desk;
  });
}
async function worktreeAt(repo, tree) {
  const real = (file) => realpath(file).catch(() => path2.resolve(file));
  const here = await real(tree);
  const entries = path2.join(repo.common, "worktrees");
  const find = async () => {
    for (const name of await readdir(entries).catch(() => [])) {
      const gitdir = await readFile2(path2.join(entries, name, "gitdir"), "utf8").catch(() => "");
      if (gitdir && await real(path2.dirname(gitdir.trim())) === here)
        return path2.join(entries, name);
    }
  };
  const entry = await find() ?? await git({ cwd: repo.top }, ["worktree", "repair", tree], { allow: [128] }).then(find);
  if (!entry) throw new GitError(["worktree"], 128, `${tree} isn't a worktree of ${repo.top}`);
  return { cwd: tree, env: { GIT_DIR: entry, GIT_WORK_TREE: tree } };
}
var merging = async (at) => (await git(at, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { allow: [1] })).code === 0;
function commitDesk(places, slug, subtaskId, by, message) {
  return perGoal(places, slug, async () => {
    const at = await worktreeAt(places.repo, deskFolder(places, subtaskId));
    const signed = { ...at, env: { ...at.env, ...authorEnv(by) } };
    await git(signed, ["add", "-A"]);
    const staged = await git(signed, ["diff", "--cached", "--quiet"], { allow: [1] });
    if (staged.code === 1 || await merging(signed))
      await git(signed, ["commit", "-q", "--allow-empty", "-m", message]);
  });
}
var MARKERS = /^<{7} [\s\S]*?^={7}\r?$[\s\S]*?^>{7} /m;
async function unresolved(places, subtaskId, files) {
  const desk = deskFolder(places, subtaskId);
  const marked = await Promise.all(
    files.map(
      (file) => readFile2(path2.join(desk, file), "utf8").then(
        (text2) => MARKERS.test(text2),
        () => false
      )
    )
  );
  return files.filter((_, i) => marked[i]);
}
async function conflicts(places, subtaskId, at) {
  const list = await git(at, ["diff", "--name-only", "-z", "--diff-filter=U"]);
  const files = list.stdout.split("\0").filter(Boolean);
  const text2 = await unresolved(places, subtaskId, files);
  return { text: text2, other: files.filter((file) => !text2.includes(file)) };
}
async function removeDesk(places, slug, subtaskId) {
  const desk = deskFolder(places, subtaskId);
  await unlist(places.repo, desk);
  await rm(desk, { recursive: true, force: true });
  await git({ cwd: places.repo.top }, ["branch", "-q", "-D", subtaskBranch(slug, subtaskId)], {
    allow: [1]
  });
}
function mergeDesk(places, slug, subtaskId, by) {
  return perGoal(places, slug, async () => {
    const { repo } = places;
    const folder = deskFolder(places, subtaskId);
    if (!await exists(folder)) {
      const branch = subtaskBranch(slug, subtaskId);
      const kept = await git({ cwd: repo.top }, ["rev-parse", "--verify", "-q", branch], {
        allow: [1]
      });
      if (kept.code !== 0) return { kind: "merged" };
      await unlist(repo, folder);
      await git({ cwd: repo.top }, ["worktree", "add", "-q", folder, branch]);
    }
    const at = await worktreeAt(repo, folder);
    const desk = { ...at, env: { ...at.env, ...authorEnv(by) } };
    if (await merging(desk)) {
      const found = await conflicts(places, subtaskId, desk);
      if (found.text.length || found.other.length) return { kind: "conflict", ...found };
      await git(desk, ["commit", "-q", "--no-edit"]);
    } else {
      const merge = await git(
        desk,
        ["-c", "merge.ff=true", "merge", "-q", "--no-edit", goalBranch(slug)],
        { allow: [1] }
      );
      if (merge.code === 1) {
        const found = await conflicts(places, subtaskId, desk);
        if (found.text.length || found.other.length) return { kind: "conflict", ...found };
        throw new GitError(["merge"], 1, (merge.stderr || merge.stdout).trim());
      }
    }
    const head = (await git(desk, ["rev-parse", "HEAD"])).stdout.trim();
    const goal2 = await worktreeAt(repo, await openGoal(places, slug));
    await git(goal2, ["merge", "-q", "--ff-only", head]);
    await removeDesk(places, slug, subtaskId);
    return { kind: "merged" };
  });
}
var literally = (file) => `:(literal)${file}`;
function pickSide(places, slug, subtaskId, files, side) {
  return perGoal(places, slug, async () => {
    const desk = await worktreeAt(places.repo, deskFolder(places, subtaskId));
    const stages = await git(desk, ["ls-files", "-u", "-z", "--", ...files.map(literally)]);
    const wanted = side === "ours" ? "2" : "3";
    const kept = new Set(
      stages.stdout.split("\0").filter(Boolean).map((line) => line.split("	")).filter(([meta]) => meta?.split(" ")[2] === wanted).map(([, file]) => file)
    );
    for (const file of files) {
      if (kept.has(file)) {
        await git(desk, ["checkout", `--${side}`, "--", literally(file)]);
        await git(desk, ["add", "--", literally(file)]);
      } else await git(desk, ["rm", "-q", "--", literally(file)]);
    }
  });
}
function abortMerge(places, slug, subtaskId) {
  return perGoal(places, slug, async () => {
    const desk = await worktreeAt(places.repo, deskFolder(places, subtaskId));
    if (await merging(desk)) await git(desk, ["merge", "--abort"]);
  });
}
function dropDesk(places, slug, subtaskId) {
  return perGoal(places, slug, () => removeDesk(places, slug, subtaskId));
}
function removeGoal(places, slug) {
  return perGoal(places, slug, async () => {
    const { repo } = places;
    const refs = await git({ cwd: repo.top }, [
      "for-each-ref",
      "--format=%(refname:lstrip=4)",
      `refs/heads/openplan/${slug}/`
    ]);
    for (const id of refs.stdout.split("\n")) {
      if (id && id !== "main") await removeDesk(places, slug, id);
    }
    const folder = goalFolder(places, slug);
    await unlist(repo, folder);
    await rm(folder, { recursive: true, force: true });
  });
}

// src/engine/goals.ts
import { randomUUID } from "node:crypto";
import { rm as rm2 } from "node:fs/promises";

// src/engine/machines.ts
var GOAL_MACHINE = {
  pause: { from: ["active"], to: "paused" },
  archive: { from: ["active", "paused"], to: "archived" },
  resume: { from: ["paused", "archived"], to: "active" }
};
var MEETING_MACHINE = {
  plan: { from: ["running"], to: "review" },
  fail: { from: ["running"], to: "failed" },
  cancel: { from: ["running", "review"], to: "cancelled" },
  change: { from: ["review"], to: "review" },
  approve: { from: ["review"], to: "approved" },
  resume: { from: ["failed", "cancelled"], to: "running" }
};
var SUBTASK_MACHINE = {
  /** The scheduler starts it: upstream merged, its assignee free, its goal active. */
  start: { from: ["pending"], to: "running" },
  /** Merging only while it waits on your call; a merge under way finishes first. */
  stop: { from: ["pending", "running", "reviewing", "merging"], to: "stopped" },
  /** Delivered with review on. */
  review: { from: ["running"], to: "reviewing" },
  /** Delivered with review off, or the review passed or was skipped. */
  merge: { from: ["running", "reviewing"], to: "merging" },
  fail: { from: ["running"], to: "failed" },
  /** Its goal paused, or you added to it: it goes on in its session. */
  hold: { from: ["running"], to: "pending" },
  /** The reviewer, or you, sent it back. */
  reject: { from: ["reviewing"], to: "pending" },
  merged: { from: ["merging"], to: "done" },
  /** Merging it left text conflicts for its assignee to resolve. */
  conflict: { from: ["merging"], to: "pending" },
  /** From the start: no session, delivery or worktree. */
  retry: { from: ["failed", "stopped"], to: "pending" },
  /** Where it stopped: its session and worktree. */
  continue: { from: ["failed", "stopped"], to: "pending" },
  /** Stopped after delivery (Subtask.stoppedIn): its review, or its merge, again. */
  reviewAgain: { from: ["stopped"], to: "reviewing" },
  mergeAgain: { from: ["stopped"], to: "merging" },
  /** Done, then redone in its session: its upstream changed, you added to it, or you sent its task back. */
  redo: { from: ["done"], to: "pending" }
};
var QUESTION_MACHINE = {
  answer: { from: ["open"], to: "answered" },
  cancel: { from: ["open"], to: "cancelled" }
};
function can(machine, state, event) {
  return machine[event]?.from.includes(state) ?? false;
}
function step(machine, state, event) {
  const move = machine[event];
  if (!move?.from.includes(state)) throw new Error(`No "${event}" from "${state}"`);
  return move.to;
}

// src/engine/records.ts
import { appendFile, mkdir as mkdir2, open } from "node:fs/promises";
import path3 from "node:path";
var OUTPUT_MAX = 4e3;
var recordFile = (places, subtaskId) => path3.join(places.root, "records", `${subtaskId}.jsonl`);
var Records = class {
  constructor(places, failed) {
    this.places = places;
    this.failed = failed;
  }
  places;
  failed;
  /** What each subtask's run is doing now, by subtask id: its last run's, once it ends. */
  live = /* @__PURE__ */ new Map();
  spoken = /* @__PURE__ */ new Map();
  /** Entries are appended one at a time, in the order they came. */
  writing = Promise.resolve();
  /** Where a run of `subtaskId` tells what it does: its record, and what goes on now. */
  recorder(subtaskId) {
    const now = { running: /* @__PURE__ */ new Map() };
    this.live.set(subtaskId, now);
    const file = recordFile(this.places, subtaskId);
    const write = (entry) => {
      this.writing = this.writing.then(async () => {
        await mkdir2(path3.dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(entry)}
`);
      }).catch(this.failed);
    };
    return {
      session: (session, model) => {
        write({ at: Date.now(), kind: "run", session, model });
      },
      thinking: (delta) => {
        now.streaming = delta === "" || now.streaming?.kind !== "thinking" ? { kind: "thinking", text: delta } : { kind: "thinking", text: now.streaming.text + delta };
      },
      text: (delta, fresh) => {
        now.streaming = fresh || now.streaming?.kind !== "text" ? { kind: "text", text: delta } : { kind: "text", text: now.streaming.text + delta };
      },
      toolStarting: (name) => {
        now.starting = name;
      },
      block: (block) => {
        if (block.kind === "tool") {
          now.starting = void 0;
          now.running.set(block.id, block);
          return;
        }
        if (now.streaming?.kind === block.kind) now.streaming = void 0;
        write({ at: Date.now(), kind: block.kind, text: block.text });
      },
      toolDone: (call) => {
        now.running.delete(call.id);
        write({
          at: Date.now(),
          kind: "tool",
          name: call.name,
          input: call.input,
          state: call.state === "error" ? "error" : "done",
          output: (call.output ?? "").slice(0, OUTPUT_MAX)
        });
      },
      steps: (steps) => {
        write({ at: Date.now(), kind: "steps", steps });
      },
      notice: (notice) => {
        write({ at: Date.now(), kind: "notice", notice });
      }
    };
  }
  /**
   * A subtask's record from byte `from` of its file on: the whole entries
   * written since, where the next read starts, and what its run is doing now.
   */
  async read(subtaskId, from = 0) {
    const now = this.live.get(subtaskId);
    const live = now && {
      ...now.streaming && { streaming: now.streaming },
      ...now.starting && { starting: now.starting },
      running: [...now.running.values()]
    };
    let handle;
    try {
      handle = await open(recordFile(this.places, subtaskId));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { entries: [], next: 0, ...live && { live } };
    }
    try {
      const { size } = await handle.stat();
      const buffer = Buffer.alloc(Math.max(0, size - from));
      await handle.read(buffer, 0, buffer.length, from);
      const whole = buffer.lastIndexOf("\n") + 1;
      const entries = buffer.subarray(0, whole).toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
      return { entries, next: from + whole, ...live && { live } };
    } finally {
      await handle.close();
    }
  }
  /** Where a meeting turn tells its words as they are said. */
  speech(meeting2, speaker) {
    const spoken = { speaker, text: "", turn: meeting2.turns.length };
    this.spoken.set(meeting2.id, spoken);
    return {
      // What a turn says before it looks something up isn't what it ends up saying.
      text: (delta, fresh) => {
        spoken.text = fresh ? delta : spoken.text + delta;
      }
    };
  }
  /** The turn being spoken at `meeting` now, if one is. */
  speaking(meeting2) {
    const spoken = this.spoken.get(meeting2.id);
    return meeting2.status === "running" && spoken?.turn === meeting2.turns.length ? spoken : void 0;
  }
  /** Every entry written so far is in its file. */
  flush() {
    return this.writing;
  }
};

// src/engine/goals.ts
var STARTING = "start";
var Goals = class {
  constructor(core, scheduler, meetings) {
    this.core = core;
    this.scheduler = scheduler;
    this.meetings = meetings;
  }
  core;
  scheduler;
  meetings;
  life = serialBy();
  /** Starts a goal: its branch cut from your HEAD, checked out in its own worktree. */
  start(name) {
    return this.life(STARTING, async () => {
      const { core } = this;
      const taken = await takenSlugs(core.places.repo);
      for (const goal3 of core.state.goals) taken.add(goal3.slug);
      const goal2 = {
        id: randomUUID(),
        name,
        slug: slugFor(name, taken),
        status: "active",
        createdAt: Date.now()
      };
      await openGoal(core.places, goal2.slug);
      core.state.goals.push(goal2);
      core.changed();
      return goal2;
    });
  }
  /**
   * Pauses a goal: its runs stop, to go on in their sessions when it is
   * resumed, and a meeting under way is cancelled; a plan in review stays,
   * to approve once it goes on.
   */
  pause(id) {
    return this.life(id, () => {
      const goal2 = this.goal(id);
      if (goal2.status === "paused") return;
      if (goal2.status === "archived")
        throw new Error(`The goal "${goal2.name}" is archived: resume it first`);
      goal2.status = step(GOAL_MACHINE, goal2.status, "pause");
      this.hold(goal2, false);
    });
  }
  /** Archives a goal as it stands: its work held as when paused, and its plans in review dropped. */
  archive(id) {
    return this.life(id, () => {
      const goal2 = this.goal(id);
      if (goal2.status === "archived") return;
      goal2.status = step(GOAL_MACHINE, goal2.status, "archive");
      goal2.archivedAt = Date.now();
      this.hold(goal2, true);
    });
  }
  /** Puts a paused or archived goal back to work, from where it was. */
  resume(id) {
    return this.life(id, () => {
      const goal2 = this.goal(id);
      if (goal2.status === "active") return;
      goal2.status = step(GOAL_MACHINE, goal2.status, "resume");
      goal2.archivedAt = void 0;
      this.core.changed();
      this.scheduler.pump();
    });
  }
  /**
   * Deletes an archived goal for good: its subtasks' worktrees, branches and
   * records, its own worktree and its plans' documents, then its tasks, subtasks,
   * meetings and their questions. Its branch stays, yours to merge or delete.
   */
  delete(id) {
    return this.life(id, async () => {
      const { core } = this;
      const goal2 = core.state.goals.find((g) => g.id === id);
      if (!goal2) return;
      if (goal2.status !== "archived")
        throw new Error(`The goal "${goal2.name}" isn't archived: archive it before deleting it`);
      const subtasks = core.state.subtasks.filter((s) => s.goalId === id);
      await this.scheduler.release(subtasks.map((s) => s.id));
      await this.meetings.settled(id);
      await removeGoal(core.places, goal2.slug);
      await Promise.all([
        ...core.state.meetings.flatMap(
          (m) => m.goalId === id && m.planFile ? [rm2(m.planFile, { force: true })] : []
        ),
        ...subtasks.map((s) => rm2(recordFile(core.places, s.id), { force: true }))
      ]);
      const gone = new Set(subtasks.map((s) => s.id));
      const { state } = core;
      state.questions = state.questions.filter((q) => !q.subtaskId || !gone.has(q.subtaskId));
      state.subtasks = state.subtasks.filter((s) => s.goalId !== id);
      state.tasks = state.tasks.filter((t) => t.goalId !== id);
      state.meetings = state.meetings.filter((m) => m.goalId !== id);
      state.goals = state.goals.filter((g) => g.id !== id);
      core.changed();
    });
  }
  /**
   * Gives a member a subtask directly, as a task of its own. It starts once
   * they are free; a paused goal's waits for the goal to go on.
   */
  assign(goalId, work) {
    const goal2 = this.goal(goalId);
    if (goal2.status === "archived")
      throw new Error(`The goal "${goal2.name}" is archived: resume it first`);
    if (!this.core.team.members.some((m) => m.name === work.assignee))
      throw new Error(`There is no member called "${work.assignee}"`);
    return this.scheduler.assign(goal2.id, [
      { title: work.title, outcome: "", subtasks: [{ ...work, key: "", dependsOn: [] }] }
    ]);
  }
  goal(id) {
    const goal2 = this.core.state.goals.find((g) => g.id === id);
    if (!goal2) throw new Error("There is no such goal");
    return goal2;
  }
  /** Holds a goal's work, cancels its meeting under way and, `plansToo`, its plans in review. */
  hold(goal2, plansToo) {
    this.scheduler.hold(goal2.id);
    for (const meeting2 of this.core.state.meetings) {
      if (meeting2.goalId !== goal2.id) continue;
      if (meeting2.status === "running" || plansToo && meeting2.status === "review")
        void this.meetings.cancel(meeting2.id);
    }
    this.core.changed();
  }
};

// src/engine/meetings.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir3, writeFile as writeFile2 } from "node:fs/promises";
import path4 from "node:path";
import {
  createSdkMcpServer,
  tool
} from "@anthropic-ai/claude-agent-sdk";
import { z as z2 } from "zod";

// src/engine/types.ts
var isHalted = (status) => status === "failed" || status === "stopped";
var MEETING_SIZES = ["small", "discussion", "large"];
var DECISION_OPTIONS = [
  "rereview",
  "skip",
  "sendBack",
  "ours",
  "theirs",
  "retry",
  "accept",
  "revise"
];
var PERMISSION_OPTIONS = ["once", "always", "deny"];
var YOU = "you";
var SUBTASK_ACTIONS = ["stop", "continue", "retry", "redo"];
var GOAL_ACTIONS = ["pause", "resume", "archive", "delete"];

// src/engine/derive.ts
var openQuestions = (state, subtaskId) => state.questions.filter((q) => q.subtaskId === subtaskId && q.status === "open");
var isActive = (state, goalId) => state.goals.find((p) => p.id === goalId)?.status === "active";
function reviewerOf(state, subtask2) {
  const meetingId = state.tasks.find((t) => t.id === subtask2.taskId)?.meetingId;
  const host = state.meetings.find((m) => m.id === meetingId)?.host;
  const other = state.members.find((m) => m !== subtask2.assignee);
  return [host, other].find((m) => m !== void 0 && m !== subtask2.assignee) ?? subtask2.assignee;
}
function acceptanceOf(state, taskId) {
  return state.questions.find(
    (q) => q.status === "open" && q.decision?.kind === "delivery" && state.subtasks.find((s) => s.id === q.subtaskId)?.taskId === taskId
  );
}
var underReview = (state, subtask2) => subtask2.status === "reviewing" && isActive(state, subtask2.goalId) && !openQuestions(state, subtask2.id).some((q) => q.decision);
function busyMembers(state) {
  const busy = /* @__PURE__ */ new Set();
  for (const s of state.subtasks) {
    if (s.status === "running") busy.add(s.assignee);
    if (underReview(state, s)) busy.add(s.assignee).add(reviewerOf(state, s));
  }
  for (const m of state.meetings)
    if (m.status === "running") for (const id of m.participants) busy.add(id);
  return busy;
}
function reviewerAway(state, subtask2) {
  const reviewer = reviewerOf(state, subtask2);
  const at = subtask2.delivery?.at ?? 0;
  const index = state.subtasks.indexOf(subtask2);
  const working = state.subtasks.some((s) => s.status === "running" && s.assignee === reviewer);
  const meeting2 = state.meetings.some(
    (m) => m.status === "running" && m.participants.includes(reviewer)
  );
  const earlier = state.subtasks.some((s, i) => {
    if (s === subtask2 || !underReview(state, s) || reviewerOf(state, s) !== reviewer) return false;
    const sAt = s.delivery?.at ?? 0;
    return sAt < at || sAt === at && i < index;
  });
  return working || meeting2 || earlier ? reviewer : void 0;
}
function waitsIn(state, subtask2, busy) {
  const goal2 = state.goals.find((p) => p.id === subtask2.goalId);
  const held = goal2 && goal2.status !== "active" ? [{ kind: "goal", status: goal2.status }] : [];
  const asked = () => openQuestions(state, subtask2.id).map(
    (q) => q.to === YOU ? q.decision ? { kind: "you", questionId: q.id, decision: q.decision.kind } : { kind: "you", questionId: q.id } : { kind: "teammate", by: q.to, questionId: q.id }
  );
  switch (subtask2.status) {
    case "pending": {
      if (held.length) return held;
      const unmerged = (d) => ({
        kind: "upstream",
        by: d.assignee,
        subtaskId: d.id,
        halted: isHalted(d.status)
      });
      const upstream = subtask2.dependsOn.flatMap((id) => {
        const d = state.subtasks.find((s) => s.id === id);
        if (!d) return [];
        if (d.status !== "done") return [unmerged(d)];
        if (d.taskId === subtask2.taskId) return [];
        const rest = state.subtasks.find((s) => s.taskId === d.taskId && s.status !== "done");
        if (rest) return [unmerged(rest)];
        const acceptance = acceptanceOf(state, d.taskId);
        return acceptance ? [{ kind: "acceptance", questionId: acceptance.id }] : [];
      });
      if (upstream.length)
        return [...new Map(upstream.map((w) => [JSON.stringify(w), w])).values()];
      return busy.has(subtask2.assignee) ? [{ kind: "busy", by: subtask2.assignee }] : [];
    }
    // Done, the last of its task, it carries the task's acceptance waiting on you.
    case "running":
    case "merging":
    case "done":
      return asked();
    case "reviewing": {
      const reviewer = underReview(state, subtask2) ? reviewerAway(state, subtask2) : void 0;
      return [...held, ...asked(), ...reviewer ? [{ kind: "busy", by: reviewer }] : []];
    }
    case "failed":
    case "stopped":
      return [];
  }
}
function redoneUpstream(state, subtask2) {
  const startedAt = subtask2.startedAt;
  if (subtask2.status !== "done" || startedAt === void 0) return [];
  return subtask2.dependsOn.flatMap((id) => {
    const d = state.subtasks.find((s) => s.id === id);
    return d?.status === "done" && (d.finishedAt ?? 0) > startedAt ? [d] : [];
  });
}
function subtaskActions(subtask2, redone, deciding) {
  const moves = ["stop", "continue", "retry"].filter(
    (event) => can(SUBTASK_MACHINE, subtask2.status, event) && (event !== "stop" || subtask2.status !== "merging" || deciding)
  );
  return redone && can(SUBTASK_MACHINE, subtask2.status, "redo") ? [...moves, "redo"] : moves;
}
function goalActions(goal2) {
  const moves = ["pause", "resume", "archive"].filter(
    (event) => can(GOAL_MACHINE, goal2.status, event)
  );
  return goal2.status === "archived" ? [...moves, "delete"] : moves;
}
function meetingResumes(state, meeting2) {
  return can(MEETING_MACHINE, meeting2.status, "resume") && !meeting2.plan && isActive(state, meeting2.goalId) && meeting2.participants.every((m) => state.members.includes(m));
}
function derive(state) {
  const busy = busyMembers(state);
  return {
    subtasks: Object.fromEntries(
      state.subtasks.map((s) => {
        const redone = redoneUpstream(state, s).map((d) => d.id);
        const actions = subtaskActions(s, redone.length > 0, openQuestions(state, s.id).length > 0);
        return [s.id, { waits: waitsIn(state, s, busy), actions, redone }];
      })
    ),
    goals: Object.fromEntries(state.goals.map((p) => [p.id, goalActions(p)])),
    busy: [...busy],
    resumable: state.meetings.filter((m) => meetingResumes(state, m)).map((m) => m.id)
  };
}

// src/engine/plan.ts
import { z } from "zod";
var planSchema = (assignee) => z.object({
  summary: z.string().trim().describe("The outcome in one sentence"),
  plan_markdown: z.string().trim().describe("The plan document"),
  tasks: z.array(
    z.object({
      title: z.string().trim(),
      outcome: z.string().trim().describe("What the task delivers when accepted"),
      subtasks: z.array(
        z.object({
          key: z.string().trim().describe("A short id, unique within this plan, such as api-1"),
          title: z.string().trim(),
          description: z.string().trim(),
          assignee,
          depends_on: z.array(z.string()).describe("The keys of the subtasks it waits for"),
          acceptance: z.string().trim()
        })
      )
    })
  )
});
var hostPlanSchema = (attendees) => planSchema(z.enum(attendees).describe("The name of the attendee it goes to"));
function loopingDependencies(tasks) {
  const taskOf = new Map(tasks.flatMap((t) => t.subtasks.map((s) => [s.key, t])));
  const waitsOn = new Map(tasks.flatMap((t) => t.subtasks.map((s) => [s.key, s.dependsOn])));
  const state = /* @__PURE__ */ new Map();
  const loops = [];
  const follow = (key) => {
    state.set(key, "open");
    for (const dependency of waitsOn.get(key) ?? []) {
      const task = taskOf.get(dependency);
      if (!task) continue;
      const awaited = task === taskOf.get(key) ? [dependency] : task.subtasks.map((s) => s.key);
      if (awaited.some((k) => state.get(k) === "open")) loops.push([key, dependency]);
      else for (const k of awaited) if (!state.has(k)) follow(k);
    }
    state.set(key, "done");
  };
  for (const key of waitsOn.keys()) if (!state.has(key)) follow(key);
  return loops;
}
function parsePlan(raw, attendees) {
  const plan = hostPlanSchema(attendees).parse(raw);
  const used = /* @__PURE__ */ new Set();
  const tasks = plan.tasks.filter((task) => task.subtasks.length).map((task, n) => ({
    title: task.title || `Task ${String(n + 1)}`,
    outcome: task.outcome,
    subtasks: task.subtasks.map((sub, i) => {
      let key = sub.key || `t${String(n + 1)}-${String(i + 1)}`;
      while (used.has(key)) key = `${key}'`;
      used.add(key);
      return {
        key,
        title: sub.title || `Subtask ${String(i + 1)}`,
        description: sub.description,
        assignee: sub.assignee,
        dependsOn: sub.depends_on,
        acceptance: sub.acceptance
      };
    })
  }));
  if (!tasks.length) throw new Error("The host's plan has no tasks");
  const subtasks = tasks.flatMap((task) => task.subtasks);
  for (const subtask2 of subtasks)
    subtask2.dependsOn = [...new Set(subtask2.dependsOn)].filter(
      (key) => key !== subtask2.key && used.has(key)
    );
  for (const [key, dependency] of loopingDependencies(tasks)) {
    const subtask2 = subtasks.find((s) => s.key === key);
    if (subtask2) subtask2.dependsOn = subtask2.dependsOn.filter((k) => k !== dependency);
  }
  return { summary: plan.summary, markdown: plan.plan_markdown, tasks };
}

// src/engine/prompts.ts
var listOf = (items) => new Intl.ListFormat("en", { type: "conjunction" }).format(items);
var called = (member) => `${member.name} (${member.role.title})`;
var TASK_WAYS = `# How you work on a subtask
- You work in a git worktree of your own, on a branch cut from the goal's branch, which is merged into the goal's branch once you deliver. Teammates working at the same time each have theirs, so you never get in each other's way. Stay in yours.
- Don't commit: delivering commits your work for you, and a git command that writes waits for the user's approval.
- When you need information or a decision from a teammate (an interface, a design detail), ask them with ask_teammate. It waits for their answer.
- When you need the user to decide something or give you what only they have, ask with AskUserQuestion, offering options, and wait for the answer. Don't just write that you are waiting: the user may not be watching.
- When you are done, call deliver with a summary of a few sentences (what you did, anything to watch out for) and the files that are the result. Your subtask isn't done until you deliver; then end your turn.`;
function systemPrompt(kind, member, team2) {
  const others = team2.filter((m) => m.name !== member.name).map(called);
  const who = `# Who you are
You are ${member.name}, the ${member.role.title} on a team of Claude Code sessions working on this repository. Each member is a session of its own, often on another model. The user directs the team from their own Claude Code session.
${others.length ? `Your teammates: ${others.join(", ")}.` : "You are the only member."}

# Your duties
${member.role.duties.trim()}`;
  return kind === "task" ? `${who}

${TASK_WAYS}` : who;
}
function taskBrief(input) {
  const { goal: goal2, task, subtask: subtask2 } = input;
  const lines = [
    `Goal: ${goal2.name}`,
    `Task: ${task.title}${task.outcome && task.outcome !== task.title ? `. ${task.outcome}` : ""}`,
    "",
    `Your subtask: ${subtask2.title}`,
    ...subtask2.description && subtask2.description !== subtask2.title ? [subtask2.description] : [],
    ...subtask2.acceptance ? ["", `Acceptance criteria: ${subtask2.acceptance}`] : [],
    "",
    `Your worktree is ${input.cwd}, on branch ${input.branch}.`
  ];
  if (input.plan)
    lines.push("", "The plan your team agreed on, which this subtask is part of:", "", input.plan);
  const delivered = (s) => `- ${s.title}, by ${s.assignee}: ${s.delivery?.summary ?? ""}${s.delivery?.files.length ? ` Files: ${s.delivery.files.join(", ")}` : ""}`;
  const direct = input.upstream.filter((u) => u.direct).map((u) => delivered(u.subtask));
  const further = input.upstream.filter((u) => !u.direct).map((u) => delivered(u.subtask));
  if (direct.length)
    lines.push("", "It builds on this work, merged into the goal's branch:", ...direct);
  if (further.length) lines.push("", "Which built on:", ...further);
  for (const { why, note } of input.notes)
    if (why === "revised")
      lines.push("", `The user sent this task back before, asking for:
${note ?? ""}`);
    else if (why === "carried") lines.push("", `The user adds to your subtask:
${note ?? ""}`);
  return lines.join("\n");
}
function goOnMessage(reasons, subtask2) {
  const said2 = ({ why, note = "" }) => {
    switch (why) {
      case "held":
        return "Your work was paused and now goes on. Pick up where you left off.";
      case "carried":
        return `The user adds to your subtask:
${note}`;
      case "continued":
        return "The user asks you to go on from where you stopped.";
      case "rejected":
        return `The review sent your delivery back. Fix what it says, then deliver again:
${subtask2.review?.notes ?? ""}`;
      case "conflict":
        return `Merging your delivery into the goal's branch left conflicts in ${subtask2.conflict?.files.join(", ") ?? ""}. The merge is under way in your worktree, the conflict markers in those files. Resolve them, keeping what both sides meant, then deliver again.`;
      case "redo":
        return `Work you build on was redone after you delivered: ${note}. Your worktree now starts from the goal's branch as it stands. Check your part against it, change what needs changing, and deliver again.`;
      case "revised":
        return `The user sent your task back, asking for:
${note}
Make those changes, then deliver again.`;
    }
  };
  return [...new Set(reasons.map(said2))].join("\n\n");
}
var DELIVER_REMINDER = "You haven't delivered yet. If the work is finished, call deliver now with a summary and the files that are the result. If you can't finish it, say what stands in the way.";
var SESSION_ONLY = "Only the session that started you asks teammates and delivers this subtask: do your own part and report back to it.";
function reviewPrompt(input) {
  const { task, subtask: subtask2, delivery } = input;
  const files = delivery.files.length ? delivery.files.join(", ") : "none (the summary is the result)";
  return `You're reviewing a teammate's delivery before it is merged into the goal's branch.

Task: ${task.title}
Subtask: ${subtask2.title}
${subtask2.description && subtask2.description !== subtask2.title ? `${subtask2.description}
` : ""}Acceptance criteria: ${subtask2.acceptance || "none given: judge whether the subtask is done as described"}

${subtask2.assignee} delivered:
${delivery.summary}
Files: ${files}

Their worktree is ${input.cwd}. Read the files, and whatever else you need there, to check the work against the criteria, and stop once you can tell. Pass it when it meets them, even if you would have done it differently; send it back only for what really falls short, and say exactly what to fix.`;
}
function teammateQuestion(input) {
  const own = input.own.map(
    (s) => `- ${s.title} (${s.status})${s.delivery ? `: ${s.delivery.summary}` : ""}`
  );
  return `Your teammate ${called(input.from)} asks you this while working on "${input.subtask.title}":
${input.question}

${own.length ? `Your own work on this goal:
${own.join("\n")}` : "You have no work of your own on this goal yet."}

Look up only what the answer needs, then answer briefly from your role. Where you're unsure, make a suggestion and state your assumptions.`;
}
function news({ meeting: meeting2 }, member) {
  const heard = meeting2.seats?.[member.name]?.heard ?? 0;
  const fresh = meeting2.turns.slice(heard).filter((t) => t.speaker !== member.name);
  return fresh.map((t) => `[${t.speaker}] ${t.text}`).join("\n\n") || "(nothing new)";
}
var SPOKEN = "Say it as you would out loud in a meeting: a few sentences, no headings or lists.";
var MEETING_KINDS = {
  small: {
    how: "This is a short meeting: everyone gives their judgment once, then only the real conflicts between those judgments get talked through.",
    raise: "your judgment conflicts with someone else's, or someone has put a question straight to you",
    settled: "every conflict between people's judgments has been talked through"
  },
  discussion: {
    how: "This is a working discussion: everyone gives their judgment, then you talk through whatever would change the plan.",
    raise: "the plan would come out differently if you didn't say it",
    settled: "each thing the meeting set out to decide has had its options compared, with reasons given"
  },
  large: {
    how: "This is an open discussion: everyone gives their judgment, then you test the assumptions and weigh the alternatives before the plan is written.",
    raise: "the plan would come out differently if you didn't say it, or you doubt an assumption nobody has questioned, or you see another way of doing it",
    settled: "each thing the meeting set out to decide has had its options compared, with reasons given, and every assumption the plan rests on has been questioned by someone"
  }
};
var MEETING_TOOLS = {
  raiseHand: {
    what: "Puts your hand up to speak next at the meeting. Not calling it leaves your hand down.",
    point: "What you would say, in one line",
    to: "Whom it is for, by name, if it is for someone",
    done: "Your hand is up."
  },
  giveFloor: {
    what: "Gives one attendee the floor: they speak next.",
    member: "Who speaks next, by name",
    quiet: "True when you have nothing to say yourself before they speak",
    done: "They have the floor."
  }
};
function briefing(ctx, member) {
  const { meeting: meeting2 } = ctx;
  if (meeting2.seats?.[member.name]) return "";
  return `You're ${member.name === meeting2.host ? "hosting" : "taking part in"} a planning meeting.
Goal: ${ctx.goal.name}
To plan: ${meeting2.agenda}
The goal's worktree: ${ctx.cwd} (look at what is there; this meeting is read-only)
Attending: ${listOf(ctx.attendees.map(called))}
${MEETING_KINDS[meeting2.size].how}

`;
}
function meetingOpening(ctx) {
  return `${briefing(ctx, ctx.attendees[0])}Open the meeting: restate the goal and the scope, then list the things this meeting has to decide. Put them to everyone as open questions: don't answer them or suggest answers yet, and don't hand topics out by role. You'll give your own view later. Don't write the plan. ${SPOKEN}`;
}
function meetingRound(ctx, member) {
  return `${briefing(ctx, member)}The host opened with:
${ctx.meeting.turns[0]?.text ?? ""}

Everyone now gives a first judgment without hearing each other, so you haven't heard what the others think. Give your own: what you would do about the things to decide and why, and what could go wrong. Your role is the angle you see it from, not the limit of what you may speak to, so if you have a view on something outside it, say it. Don't say who takes which work; that comes when the plan is written. ${SPOKEN}`;
}
function meetingHand(ctx, member) {
  return `${briefing(ctx, member)}Said since you last took it in:
${news(ctx, member)}

Would you speak next? Raise your hand only if ${MEETING_KINDS[ctx.meeting.size].raise}. Agreeing with what was said is no reason to. If you would, call raise_hand. If not, don't call it. Either way this isn't your turn to speak: nothing you write besides the call is heard.`;
}
function meetingAnswer(ctx, member, point) {
  return `${briefing(ctx, member)}Said since you last took it in:
${news(ctx, member)}

You have the floor${point ? `, for what you raised your hand about: ${point}` : ": the host has called on you"}. Say it to the person it's for and take up what they actually said. Agree only where you have a reason of your own; if you disagree, say so and why; don't make up a disagreement. ${SPOKEN}`;
}
function meetingSteer(ctx, left) {
  const { meeting: meeting2, attendees } = ctx;
  const host = attendees[0];
  const hands = (meeting2.hands ?? []).map(
    (h) => `- ${h.member}${h.to ? ` (to ${h.to})` : ""}: ${h.point}`
  );
  const had = attendees.slice(1).map(
    (m) => `${m.name} ${String(meeting2.turns.filter((t) => t.phase === "answer" && t.speaker === m.name).length)}`
  );
  const first = !meeting2.turns.some((t) => t.phase === "steer" || t.phase === "answer");
  return `${briefing(ctx, host)}Said since you last took it in:
${news(ctx, host)}

${hands.length ? `Hands up:
${hands.join("\n")}` : "Nobody has a hand up."}
Times each has had the floor in the discussion: ${listOf(had)}.
You can give the floor ${String(left)} more time${left === 1 ? "" : "s"} at most.

${first ? "You have now heard everyone's first judgment. Say how they differ and what you think yourself." : "Say something yourself only if you have something to add."}
With hands up, give the floor to one of them: whoever has been challenged first, otherwise whoever has spoken least. You may also give it to someone without a hand up who should answer.
With no hands up, go back over what you set out to decide: is it true that ${MEETING_KINDS[meeting2.size].settled}? If not, give the floor to the one who should take up what's missing. If so, don't give the floor: close the talk in a sentence, and you'll write the plan after.
Call give_floor first, then what you say to the room is your last message. ${SPOKEN}`;
}
function meetingClosing(ctx) {
  const { attendees } = ctx;
  return `${briefing(ctx, attendees[0])}Said since you last took it in:
${news(ctx, attendees[0])}

You're the host: turn the discussion into the final plan.
Attending (subtasks can only go to them): ${listOf(attendees.map(called))}

Requirements:
- Break the work into 1\u20134 tasks with 1\u20134 subtasks each; every subtask goes to exactly one attendee, whose name goes in assignee: ${listOf(attendees.map((m) => `"${m.name}"`))}. You decide who takes what, from their roles.
- Spell out the dependencies between subtasks in depends_on (the keys of other subtasks); don't make sequential what can run in parallel.
- Dependencies must not loop: no subtask may wait, directly or through others, on itself or on a subtask that waits on it.
- A subtask that depends on one in another task starts only when that whole task is finished and the user has accepted it. So tasks can only wait on each other one way: work that needs every other task's result, such as a final integration, is a task of its own.
- Give every subtask a clear description and acceptance criteria: its member reads them, and the plan document, before starting.
- plan_markdown is the plan document for the user and the team: the goal and scope; what was decided, why, and what was turned down; where people didn't agree and how you ruled; what the meeting didn't get to; then who does what, dependencies and risks.
- summary states the outcome in one sentence.`;
}

// src/engine/turns.ts
import { spawn as spawn2 } from "node:child_process";
import {
  query
} from "@anthropic-ai/claude-agent-sdk";

// src/engine/processes.ts
import { execFile } from "node:child_process";
import { readFile as readFile3 } from "node:fs/promises";
import { writeFileSync } from "node:fs";
var running2 = /* @__PURE__ */ new Map();
var record;
function save() {
  if (record === void 0) return;
  const written2 = [...running2].map(([pid, { settings }]) => ({ pid, settings }));
  writeFileSync(record, JSON.stringify(written2));
}
function watchMember(child, args) {
  const { pid } = child;
  const at = args.indexOf("--settings");
  const settings = at < 0 ? void 0 : args[at + 1];
  if (pid === void 0 || settings === void 0) return;
  running2.set(pid, { child, settings });
  save();
  child.once("exit", () => {
    running2.delete(pid);
    save();
  });
}
function stopMembers() {
  for (const { child } of running2.values()) child.kill("SIGTERM");
}
var commandLine = (pid) => new Promise((resolve) => {
  const [command, args] = process.platform === "win32" ? [
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").CommandLine`
    ]
  ] : ["ps", ["-o", "command=", "-p", String(pid)]];
  execFile(command, args, (error, stdout) => {
    resolve(error ? void 0 : stdout);
  });
});
async function written(file) {
  try {
    return JSON.parse(await readFile3(file, "utf8"));
  } catch {
    return [];
  }
}
async function recordMembersIn(file) {
  const left = await written(file);
  await Promise.all(
    left.map(async ({ pid, settings }) => {
      if (!(await commandLine(pid))?.includes(settings)) return;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
      }
    })
  );
  record = file;
  save();
}

// src/engine/turns.ts
var tokensOf = (usage) => usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens;
function resultOutcome(message, subagentTokens = 0) {
  const tokens = tokensOf(message.usage) + subagentTokens;
  if (message.subtype === "success" && !message.is_error)
    return {
      ok: true,
      text: message.result,
      structured: message.structured_output,
      turns: message.num_turns,
      tokens
    };
  const error = message.subtype === "success" ? message.result : message.subtype === "error_max_turns" ? `Stopped after ${String(message.num_turns)} turns, the most it may take` : message.subtype === "error_max_budget_usd" ? "Stopped at its spending limit" : message.subtype === "error_max_structured_output_retries" ? "The model didn't hand back a result in the shape asked for" : message.errors.join("\n");
  return { ok: false, error: error || "The turn failed without saying why", tokens };
}
function outputText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(
    (part) => part.type === "text" && typeof part.text === "string" ? part.text : `[${String(part.type)}]`
  ).join("\n");
}
function turnDecoder(listener) {
  const calls = /* @__PURE__ */ new Map();
  const tasks = /* @__PURE__ */ new Map();
  let subagentTokens = 0;
  let fresh = true;
  let blockOpen = false;
  const held = [];
  const notify = (notice) => {
    if (blockOpen) held.push(notice);
    else listener.notice?.(notice);
  };
  const flush = () => {
    for (const notice of held.splice(0)) listener.notice?.(notice);
  };
  return (message) => {
    switch (message.type) {
      case "system":
        switch (message.subtype) {
          case "init":
            listener.session?.(message.session_id, message.model);
            return;
          case "api_retry":
            notify({
              kind: "retry",
              attempt: message.attempt,
              max: message.max_retries,
              delayMs: message.retry_delay_ms
            });
            return;
          case "compact_boundary":
            notify({
              kind: "compacted",
              before: message.compact_metadata.pre_tokens,
              ...message.compact_metadata.post_tokens !== void 0 && {
                after: message.compact_metadata.post_tokens
              }
            });
            return;
          case "status":
            if (message.compact_result === "failed")
              notify({
                kind: "compaction-failed",
                ...message.compact_error && { error: message.compact_error }
              });
            return;
          case "model_refusal_fallback":
            notify({ kind: "fallback", from: message.original_model, to: message.fallback_model });
            return;
          case "model_refusal_no_fallback":
            notify({ kind: "refusal", model: message.original_model });
            return;
          case "task_started":
            tasks.set(message.task_id, message.description);
            if (message.skip_transcript || message.ambient) return;
            notify({ kind: "task", state: "started", title: message.description });
            return;
          case "task_notification":
            subagentTokens += message.usage?.total_tokens ?? 0;
            if (message.skip_transcript || message.ambient) return;
            notify({
              kind: "task",
              state: message.status === "completed" ? "done" : message.status === "stopped" ? "stopped" : "failed",
              title: tasks.get(message.task_id) ?? message.summary
            });
            return;
          default:
            return;
        }
      case "result":
        flush();
        return resultOutcome(message, subagentTokens);
      case "rate_limit_event":
        if (message.rate_limit_info.status !== "allowed")
          notify({
            kind: "rate-limit",
            status: message.rate_limit_info.status === "rejected" ? "rejected" : "warning",
            ...message.rate_limit_info.resetsAt !== void 0 && {
              resetsAt: message.rate_limit_info.resetsAt
            }
          });
        return;
      case "tool_progress":
        if (message.subagent_retry)
          notify({
            kind: "subagent-retry",
            attempt: message.subagent_retry.attempt,
            max: message.subagent_retry.max_retries,
            delayMs: message.subagent_retry.retry_delay_ms
          });
        return;
      case "stream_event": {
        if (message.parent_tool_use_id) return;
        const { event } = message;
        if (event.type === "message_start") {
          fresh = true;
          blockOpen = false;
          flush();
        } else if (event.type === "content_block_start") {
          blockOpen = event.content_block.type === "thinking" || event.content_block.type === "text";
          if (event.content_block.type === "thinking") listener.thinking?.("");
          else if (event.content_block.type === "tool_use")
            listener.toolStarting?.(event.content_block.name);
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "thinking_delta") listener.thinking?.(event.delta.thinking);
          else if (event.delta.type === "text_delta") {
            listener.text?.(event.delta.text, fresh);
            fresh = false;
          }
        }
        return;
      }
      case "assistant":
        if (message.parent_tool_use_id) return;
        for (const block of message.message.content) {
          if (block.type === "thinking")
            listener.block?.({ kind: "thinking", text: block.thinking });
          else if (block.type === "text") listener.block?.({ kind: "text", text: block.text });
          else if (block.type === "tool_use") {
            const call = {
              kind: "tool",
              id: block.id,
              name: block.name,
              input: block.input,
              state: "running"
            };
            calls.set(call.id, call);
            listener.block?.(call);
            if (block.name === "TodoWrite")
              listener.steps?.(
                block.input.todos.map(({ content, status }) => ({
                  content,
                  status
                }))
              );
          }
        }
        blockOpen = false;
        flush();
        return;
      case "user": {
        if ("isReplay" in message || message.parent_tool_use_id) return;
        const { content } = message.message;
        if (typeof content === "string") return;
        for (const block of content) {
          const call = block.type === "tool_result" ? calls.get(block.tool_use_id) : void 0;
          if (block.type !== "tool_result" || !call) continue;
          calls.delete(call.id);
          listener.toolDone?.({
            ...call,
            output: outputText(block.content),
            state: block.is_error ? "error" : "done"
          });
        }
        return;
      }
      default:
        return;
    }
  };
}
var STDERR_TAIL = 2e3;
function claudeProcess() {
  let exited = Promise.resolve();
  let stderr = "";
  return {
    spawn: ({ command, args, cwd, env, signal }) => {
      const child = spawn2(command, args, { cwd, env, signal, stdio: "pipe", windowsHide: true });
      watchMember(child, args);
      exited = new Promise((resolve) => {
        child.once("close", () => {
          resolve();
        });
        child.once("error", () => {
          resolve();
        });
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-STDERR_TAIL);
      });
      return child;
    },
    gone: () => exited,
    /** A turn's error in words, with the end of Claude Code's stderr. */
    failure: (error) => {
      const words = error instanceof Error ? error.message : String(error);
      const tail = stderr.trim();
      return tail ? `${words}. stderr: ${tail}` : words;
    }
  };
}
async function askOnce(params) {
  const { prompt, options, schema, signal, listener = {} } = params;
  signal.throwIfAborted();
  const abortController = new AbortController();
  const stop = () => {
    abortController.abort();
  };
  signal.addEventListener("abort", stop, { once: true });
  const claude = claudeProcess();
  let session = "";
  const decode = turnDecoder({
    ...listener,
    session: (id, model) => {
      session = id;
      listener.session?.(id, model);
    }
  });
  const run2 = query({
    prompt,
    options: {
      ...options,
      ...schema && { outputFormat: { type: "json_schema", schema } },
      abortController,
      spawnClaudeCodeProcess: claude.spawn
    }
  });
  try {
    for await (const message of run2) {
      const outcome = decode(message);
      if (!outcome) continue;
      if (!outcome.ok) throw new Error(outcome.error);
      if (schema && outcome.structured === void 0)
        throw new Error("The model answered in words instead of the result asked for");
      return {
        text: outcome.text,
        structured: outcome.structured,
        session,
        tokens: outcome.tokens
      };
    }
    throw new Error("The session ended without a result");
  } catch (error) {
    throw new Error(claude.failure(error), { cause: error });
  } finally {
    signal.removeEventListener("abort", stop);
    run2.close();
    await claude.gone();
  }
}

// src/engine/meetings.ts
var MEETING_TURNS_EACH = {
  small: 1,
  discussion: 2,
  large: 4
};
var SERVER = "openplan";
var turnTool = (meetingTool) => ({
  server: createSdkMcpServer({ name: SERVER, tools: [meetingTool] }),
  name: `mcp__${SERVER}__${meetingTool.name}`
});
var answered = (text2) => ({ content: [{ type: "text", text: text2 }] });
var handTool = (raise) => turnTool(
  tool(
    "raise_hand",
    MEETING_TOOLS.raiseHand.what,
    {
      point: z2.string().trim().min(1).describe(MEETING_TOOLS.raiseHand.point),
      to: z2.string().trim().optional().describe(MEETING_TOOLS.raiseHand.to)
    },
    ({ point, to }) => {
      raise({ point, ...to && { to } });
      return Promise.resolve(answered(MEETING_TOOLS.raiseHand.done));
    }
  )
);
var floorTool = (others, give) => turnTool(
  tool(
    "give_floor",
    MEETING_TOOLS.giveFloor.what,
    {
      member: z2.enum(others.map((m) => m.name)).describe(MEETING_TOOLS.giveFloor.member),
      quiet: z2.boolean().optional().describe(MEETING_TOOLS.giveFloor.quiet)
    },
    (floor) => {
      give(floor);
      return Promise.resolve(answered(MEETING_TOOLS.giveFloor.done));
    }
  )
);
function nextMove({
  turns,
  participants,
  size
}) {
  const last = turns.at(-1);
  if (!last) return { kind: "open" };
  const others = participants.slice(1);
  const waiting = others.find((m) => !turns.some((t) => t.phase === "round" && t.speaker === m));
  if (waiting) return { kind: "round", member: waiting };
  if (last.phase === "steer")
    return last.calls ? { kind: "answer", member: last.calls } : { kind: "close" };
  const left = others.length * MEETING_TURNS_EACH[size] - turns.filter((t) => t.phase === "answer").length;
  return left > 0 ? { kind: "discuss", left } : { kind: "close" };
}
var Meetings = class {
  constructor(core, scheduler) {
    this.core = core;
    this.scheduler = scheduler;
  }
  core;
  scheduler;
  /** Meeting id → stops its run. */
  aborts = /* @__PURE__ */ new Map();
  /** Meeting id → its run, settling once it has ended. */
  ongoing = /* @__PURE__ */ new Map();
  /** Calls a meeting, or throws why it can't be held now. */
  start(call) {
    const { core } = this;
    const named = [...new Set(call.attendees.map((name) => name.trim()))];
    const attendees = named.length ? named : core.team.members.map((m) => m.name).sort((a, b) => a.localeCompare(b));
    this.admit(call.goalId, attendees);
    const meeting2 = {
      id: randomUUID2(),
      goalId: call.goalId,
      agenda: call.agenda,
      size: call.size,
      participants: attendees,
      host: attendees[0] ?? "",
      status: "running",
      turns: [],
      tokens: 0,
      createdAt: Date.now()
    };
    core.state.meetings.push(meeting2);
    core.changed();
    this.track(meeting2);
    return meeting2;
  }
  /** Goes on with a stopped meeting from where it stopped, on the terms of calling one. */
  resume(id) {
    const { core } = this;
    const meeting2 = core.state.meetings.find((m) => m.id === id);
    if (!meeting2 || !meetingResumes(workOf(core), meeting2))
      throw new Error("That meeting can't go on: its plan is out, or its goal isn't active");
    this.admit(meeting2.goalId, meeting2.participants);
    meeting2.status = step(MEETING_MACHINE, meeting2.status, "resume");
    meeting2.error = void 0;
    core.changed();
    this.track(meeting2);
  }
  /**
   * Cancels a plan in review at once, or stops a meeting under way: it is
   * cancelled as its run ends, which the promise returned waits for.
   */
  cancel(id) {
    const meeting2 = this.core.state.meetings.find((m) => m.id === id);
    if (meeting2?.status === "review") {
      meeting2.status = step(MEETING_MACHINE, meeting2.status, "cancel");
      this.core.changed();
      return;
    }
    this.aborts.get(id)?.abort();
    return this.ongoing.get(id);
  }
  /**
   * Your changes to a plan under review: `raw` is the whole plan as the host
   * hands one in (hostPlanSchema), and may give work to any member.
   */
  change(id, raw) {
    const { core } = this;
    const { meeting: meeting2 } = this.underReview(id, "change");
    const names2 = core.team.members.map((m) => m.name);
    meeting2.plan = parsePlan(raw, names2);
    core.changed();
  }
  /**
   * Approves a plan under review: its document is saved in the data folder,
   * and its tasks and subtasks go to the scheduler, pending until they can
   * start. Returns the subtasks.
   */
  async approve(id) {
    const { core } = this;
    const { meeting: meeting2, plan } = this.underReview(id, "approve");
    const goal2 = this.activeGoal(meeting2.goalId);
    const file = path4.join(core.places.root, "plans", `${goal2.slug}-${meeting2.id}.md`);
    await mkdir3(path4.dirname(file), { recursive: true });
    await writeFile2(file, plan.markdown);
    if (meeting2.plan !== plan || !can(MEETING_MACHINE, meeting2.status, "approve"))
      throw new Error("The plan changed while it was being approved");
    this.activeGoal(goal2.id);
    meeting2.status = step(MEETING_MACHINE, meeting2.status, "approve");
    meeting2.planFile = file;
    return this.scheduler.assign(goal2.id, plan.tasks, meeting2.id);
  }
  /** Settles once no meeting of a goal is under way: one being cancelled has ended. */
  async settled(goalId) {
    const ids = this.core.state.meetings.filter((m) => m.goalId === goalId).map((m) => m.id);
    await Promise.all(ids.flatMap((id) => this.ongoing.get(id) ?? []));
  }
  /** Stops every meeting under way, as cancelled; settles once they have ended. */
  async close() {
    for (const abort of this.aborts.values()) abort.abort();
    await Promise.all(this.ongoing.values());
  }
  /** After a restart no meeting is under way: one that was is cancelled, to go on from where it was. */
  recover() {
    for (const meeting2 of this.core.state.meetings) {
      if (meeting2.status !== "running") continue;
      meeting2.status = step(MEETING_MACHINE, meeting2.status, "cancel");
      Object.assign(meeting2, {
        speaking: void 0,
        planning: void 0,
        weighing: void 0,
        hands: void 0
      });
    }
  }
  /**
   * Whether these members can sit down together now for this goal: the goal
   * is active, each is on the team and free. Throws why not. Nothing is
   * awaited here or before the meeting is under way, so two meetings can't
   * both take the same member.
   */
  admit(goalId, attendees) {
    const { core } = this;
    this.activeGoal(goalId);
    if (!attendees.length) throw new Error("The team has no members");
    const names2 = new Set(core.team.members.map((m) => m.name));
    const stranger = attendees.find((name) => !names2.has(name));
    if (stranger) throw new Error(`There is no member called "${stranger}"`);
    const busy = busyMembers(workOf(core));
    const taken = attendees.find((name) => busy.has(name));
    if (taken) throw new Error(`${taken} is busy: working, reviewing, or at another meeting`);
  }
  /** A goal that is active, or throws why it isn't. */
  activeGoal(goalId) {
    const goal2 = this.core.state.goals.find((g) => g.id === goalId);
    if (!goal2) throw new Error("There is no such goal");
    if (goal2.status !== "active") throw new Error(`The goal "${goal2.name}" is ${goal2.status}`);
    return goal2;
  }
  /** A meeting whose plan is under review and can take `event`, or throws. */
  underReview(id, event) {
    const meeting2 = this.core.state.meetings.find((m) => m.id === id);
    if (!meeting2?.plan || !can(MEETING_MACHINE, meeting2.status, event))
      throw new Error("That meeting has no plan under review");
    return { meeting: meeting2, plan: meeting2.plan };
  }
  /** Runs a meeting, kept as under way until it ends. */
  track(meeting2) {
    const abort = new AbortController();
    this.aborts.set(meeting2.id, abort);
    const run2 = this.run(meeting2, abort.signal).finally(() => {
      this.aborts.delete(meeting2.id);
      this.ongoing.delete(meeting2.id);
    });
    this.ongoing.set(meeting2.id, run2);
  }
  async run(meeting2, signal) {
    const { core } = this;
    const [host, ...others] = meeting2.participants.flatMap(
      (name) => core.team.members.filter((m) => m.name === name)
    );
    const goal2 = core.state.goals.find((g) => g.id === meeting2.goalId);
    if (!host || !goal2) return;
    let ctx = { meeting: meeting2, goal: goal2, attendees: [host, ...others], cwd: "" };
    const ask = async (member, prompt, turn = {}) => {
      const heard = turn.heard ?? meeting2.turns.length;
      const options = await core.options(member, "meeting", ctx.cwd);
      const seat = meeting2.seats?.[member.name];
      const reply = await askOnce({
        prompt,
        options: {
          ...options,
          ...seat && { resume: seat.session },
          ...turn.tool && {
            mcpServers: { ...options.mcpServers, [SERVER]: turn.tool.server },
            allowedTools: [...options.allowedTools ?? [], turn.tool.name]
          }
        },
        ...turn.schema && { schema: turn.schema },
        signal: turn.signal ?? signal,
        ...turn.listener && { listener: turn.listener }
      });
      meeting2.seats = { ...meeting2.seats, [member.name]: { session: reply.session, heard } };
      meeting2.tokens += reply.tokens;
      return reply;
    };
    const speak = (member, prompt, turn = {}) => {
      meeting2.speaking = member.name;
      meeting2.planning = turn.schema !== void 0;
      core.changed();
      return ask(member, prompt, { ...turn, listener: core.speech(meeting2, member.name) });
    };
    const said2 = (speaker, { text: text2, tokens }, phase, calls) => {
      meeting2.turns.push({
        speaker: speaker.name,
        text: text2,
        at: Date.now(),
        phase,
        tokens,
        ...calls !== void 0 && { calls }
      });
      core.changed();
    };
    const attendee = (name) => {
      const found = others.find((m) => m.name === name);
      if (!found) throw new Error(`${name} isn't at this meeting`);
      return found;
    };
    try {
      ctx = { ...ctx, cwd: await openGoal(core.places, goal2.slug) };
      const answer = async (name) => {
        const member = attendee(name);
        const point = meeting2.hands?.find((hand) => hand.member === name)?.point;
        meeting2.hands = void 0;
        said2(member, await speak(member, meetingAnswer(ctx, member, point)), "answer");
      };
      const weigh = async (who) => {
        meeting2.weighing = true;
        meeting2.hands = [];
        core.changed();
        const stop = new AbortController();
        const weighing = AbortSignal.any([signal, stop.signal]);
        const asked = await Promise.allSettled(
          who.map(
            (member) => ask(member, meetingHand(ctx, member), {
              signal: weighing,
              tool: handTool((hand) => {
                meeting2.hands = [
                  ...(meeting2.hands ?? []).filter((h) => h.member !== member.name),
                  { member: member.name, ...hand }
                ];
                core.changed();
              })
            }).catch((error) => {
              stop.abort();
              throw error;
            })
          )
        );
        meeting2.weighing = void 0;
        core.changed();
        const failed = asked.find((r) => r.status === "rejected");
        if (failed) throw failed.reason;
      };
      const discuss = async (left) => {
        const last = meeting2.turns.at(-1);
        await weigh(others.filter((m) => last?.phase === "round" || m.name !== last?.speaker));
        let floor;
        const steer = await speak(host, meetingSteer(ctx, left), {
          tool: floorTool(others, (given) => floor = given)
        });
        const called2 = floor?.member ?? meeting2.hands?.[0]?.member;
        const text2 = steer.text.trim();
        if (text2 && !floor?.quiet) said2(host, { text: text2, tokens: steer.tokens }, "steer", called2);
        else if (called2) await answer(called2);
        else return false;
        return true;
      };
      let talking = true;
      for (let move = nextMove(meeting2); talking && move.kind !== "close"; move = nextMove(meeting2)) {
        switch (move.kind) {
          case "open":
            said2(host, await speak(host, meetingOpening(ctx)), "opening");
            break;
          case "round": {
            const member = attendee(move.member);
            said2(member, await speak(member, meetingRound(ctx, member), { heard: 1 }), "round");
            break;
          }
          case "answer":
            await answer(move.member);
            break;
          case "discuss":
            talking = await discuss(move.left);
        }
      }
      meeting2.hands = void 0;
      const names2 = ctx.attendees.map((m) => m.name);
      const closing = await speak(host, meetingClosing(ctx), {
        schema: z2.toJSONSchema(hostPlanSchema(names2))
      });
      signal.throwIfAborted();
      meeting2.plan = parsePlan(closing.structured, names2);
      said2(host, { text: meeting2.plan.summary, tokens: closing.tokens }, "summary");
      meeting2.status = step(MEETING_MACHINE, meeting2.status, "plan");
      meeting2.seats = void 0;
    } catch (error) {
      if (meeting2.status === "running") {
        meeting2.status = step(MEETING_MACHINE, meeting2.status, signal.aborted ? "cancel" : "fail");
        if (!signal.aborted) meeting2.error = errorText(error);
      }
    } finally {
      Object.assign(meeting2, {
        speaking: void 0,
        planning: void 0,
        weighing: void 0,
        hands: void 0
      });
      core.changed();
      this.scheduler.pump();
    }
  }
};

// src/engine/policy.ts
import { chmod, mkdir as mkdir4, writeFile as writeFile3 } from "node:fs/promises";
import path5 from "node:path";
var SESSION_VARS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_EFFORT",
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_PLUGIN_ROOT",
  "CLAUDE_PROJECT_DIR"
];
var READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
var PLUGIN = "openplan";
function pluginId(dataFolder2) {
  return `${PLUGIN}@${path5.basename(dataFolder2).slice(PLUGIN.length + 1)}`;
}
function expandEnv(env, from) {
  const missing2 = /* @__PURE__ */ new Set();
  const filled = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value.replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
        (_, name, fallback) => {
          const found = from[name] ?? fallback;
          if (found === void 0) missing2.add(name);
          return found ?? "";
        }
      )
    ])
  );
  if (missing2.size) throw new Error(`Not set in the environment: ${[...missing2].join(", ")}`);
  return filled;
}
function memberSettings(team2, member, from, plugin) {
  return {
    ...team2,
    sandbox: { enabled: true, ...team2.sandbox },
    env: { ...team2.env, ...expandEnv(member.env, from) },
    enabledPlugins: { ...team2.enabledPlugins, [plugin]: false },
    crossSessionInbound: "refuse",
    permissions: {
      defaultMode: "acceptEdits",
      ...team2.permissions,
      deny: [...team2.permissions?.deny ?? [], "SendMessage", "ListAgents"]
    }
  };
}
async function writeSettings(file, settings) {
  await mkdir4(path5.dirname(file), { recursive: true });
  await writeFile3(file, JSON.stringify(settings), { mode: 384 });
  await chmod(file, 384);
  return file;
}
function workOptions(seat, from) {
  const { member } = seat;
  const env = Object.fromEntries(
    Object.entries(from).filter(([name]) => !SESSION_VARS.includes(name))
  );
  return {
    cwd: seat.cwd,
    model: member.model,
    effort: member.effort,
    resume: seat.session,
    settings: seat.settings,
    env: { ...env, ...authorEnv(memberSigner(member.name)) },
    systemPrompt: { type: "preset", preset: "claude_code", append: seat.system },
    includePartialMessages: true,
    toolConfig: { askUserQuestion: { previewFormat: "markdown" } },
    extraArgs: { name: `${PLUGIN}-${member.name}` },
    pathToClaudeCodeExecutable: seat.claude
  };
}
function readOnlyOptions(seat, from) {
  return { ...workOptions(seat, from), tools: READ_ONLY_TOOLS, permissionMode: "dontAsk" };
}

// src/engine/questions.ts
import { randomUUID as randomUUID3 } from "node:crypto";
var ASK_TOOL = "AskUserQuestion";
var CALLED_OFF = "Stopped.";
var ruleText = ({ toolName, ruleContent }) => ruleContent === void 0 ? toolName : `${toolName}(${ruleContent})`;
var alwaysRules = (request) => request.matchedAskRule || request.suppressAlwaysAllowRule ? [] : (request.suggestions ?? []).flatMap(
  (update) => update.type === "addRules" && update.behavior === "allow" ? update.rules : []
);
var Questions = class {
  constructor(inbox) {
    this.inbox = inbox;
  }
  inbox;
  /** Questions a member's turn waits on: question id → resume it (undefined: called off). */
  waiting = /* @__PURE__ */ new Map();
  /**
   * The `canUseTool` of a member's turn: its questions with choices and
   * every call its rules don't cover wait for you, and are called off when
   * its run ends (`asker.signal`) or the SDK withdraws the request.
   */
  gate(asker) {
    return (tool3, input, request) => {
      const who = { ...asker, signal: AbortSignal.any([asker.signal, request.signal]) };
      return tool3 === ASK_TOOL ? this.ask(who, input) : this.permit(who, tool3, input, request);
    };
  }
  /**
   * Answers a question put to you, and gives it back: a decision is the
   * scheduler's to act on. Throws when it is no longer open, or the answer
   * doesn't fit it: not one of its options, not one pick per question, a
   * task sent back without what to change, or with a subtask not done in it.
   */
  answer(id, answer) {
    const question = this.inbox.state.questions.find(
      (q) => q.id === id && q.to === YOU && q.status === "open"
    );
    if (!question) throw new Error("That question is no longer open.");
    const fits = question.permission ? "option" in answer && question.permission.options.includes(answer.option) : question.decision ? "decision" in answer && question.decision.options.includes(answer.decision) && (answer.decision !== "revise" || this.revisable(question, answer)) : "picks" in answer && answer.picks.length === question.choices?.length;
    if (!fits) throw new Error("That answer doesn't fit the question.");
    this.close(question, "answer", answer);
    return question;
  }
  /**
   * A member asks a teammate: the question is open while `answering` runs
   * (the teammate's read-only turn), so the asker shows as waiting on them,
   * and leaves the state when it settles. Its subtask's run stopping calls it
   * off (cancelFor) and should stop `answering` too.
   */
  async toTeammate(asker, to, text2, answering) {
    const question = this.open(asker, { text: text2, options: [] }, to);
    try {
      return await answering();
    } finally {
      if (question.status === "open") this.close(question, "answer");
    }
  }
  /**
   * A stuck review, a merge that needs you, or a task done (with why, or
   * what, in `text`): it waits for your answer, no turn behind it.
   */
  openDecision(subtask2, decision, text2) {
    this.open({ from: subtask2.assignee, subtaskId: subtask2.id }, { text: text2, options: [], decision });
  }
  /**
   * Calls off what a subtask's run waits on (the run ended or was stopped);
   * with `decisions`, also your decisions on its review or merge (it left
   * that stage).
   */
  cancelFor(subtaskId, decisions = false) {
    this.cancelAll((q) => q.subtaskId === subtaskId && (decisions || !q.decision));
  }
  /** After a restart no turn waits on anything: what members asked is called off; your decisions stand. */
  recover() {
    this.cancelAll((q) => !q.decision);
  }
  /** Calls off a task's delivery waiting on you: work in it is being done again. */
  cancelDelivery(taskId) {
    const inTask = new Set(
      this.inbox.state.subtasks.filter((s) => s.taskId === taskId).map((s) => s.id)
    );
    this.cancelAll((q) => q.decision?.kind === "delivery" && inTask.has(q.subtaskId ?? ""));
  }
  /** A call the member's rules don't cover: allowed once, always, or denied. */
  async permit(asker, tool3, input, request) {
    const rules = alwaysRules(request);
    const answer = await this.wait(asker, {
      // A command comes with the member's own words for what it does.
      text: request.description ?? "",
      options: [],
      permission: {
        tool: tool3,
        input,
        ...request.title !== void 0 && { title: request.title },
        options: rules.length ? ["once", "always", "deny"] : ["once", "deny"]
      }
    });
    if (!answer) return { behavior: "deny", message: CALLED_OFF };
    switch (answer.option) {
      case "once":
        return { behavior: "allow", updatedInput: input };
      case "always":
        await this.inbox.allowAlways(rules.map(ruleText));
        return {
          behavior: "allow",
          updatedInput: input,
          updatedPermissions: [
            { type: "addRules", rules, behavior: "allow", destination: "session" }
          ]
        };
      case "deny":
        return {
          behavior: "deny",
          message: answer.note ? `The user denied this and said: ${answer.note}` : "The user denied this."
        };
    }
  }
  /** Questions with choices: your picks go back as the tool's answers. */
  async ask(asker, input) {
    const choices = input.questions.map((q) => ({
      question: q.question,
      header: q.header,
      options: q.options.map((o) => ({
        label: o.label,
        description: o.description,
        ...o.preview !== void 0 && { preview: o.preview }
      })),
      multiSelect: q.multiSelect
    }));
    const answer = await this.wait(asker, {
      text: choices.map((c) => c.question).join("\n"),
      options: [],
      choices
    });
    if (!answer) return { behavior: "deny", message: CALLED_OFF };
    const answers = Object.fromEntries(choices.map((c, i) => [c.question, answer.picks[i]]));
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }
  /** Sending a task back says what to change, and sends back only one of its subtasks that is done. */
  revisable(question, answer) {
    if (!answer.note) return false;
    if (answer.sentBack === void 0) return true;
    const { subtasks } = this.inbox.state;
    const taskId = subtasks.find((s) => s.id === question.subtaskId)?.taskId;
    const target = subtasks.find((s) => s.id === answer.sentBack);
    return target !== void 0 && target.taskId === taskId && target.status === "done";
  }
  /**
   * Puts a question to you and waits for your answer (answer() checks it
   * fits). Undefined when the asker stops waiting first.
   */
  wait(asker, ask) {
    if (asker.signal.aborted) return Promise.resolve(void 0);
    const question = this.open(asker, ask);
    return new Promise((resolve) => {
      const callOff = () => {
        this.close(question, "cancel");
      };
      asker.signal.addEventListener("abort", callOff, { once: true });
      this.waiting.set(question.id, (answer) => {
        asker.signal.removeEventListener("abort", callOff);
        resolve(answer);
      });
    });
  }
  /** Puts a question to `to`: you, unless a teammate is asked. */
  open(asker, ask, to = YOU) {
    const question = {
      id: randomUUID3(),
      ...asker.subtaskId !== void 0 && { subtaskId: asker.subtaskId },
      from: asker.from,
      to,
      status: "open",
      createdAt: Date.now(),
      ...ask
    };
    this.inbox.state.questions.push(question);
    this.inbox.changed();
    return question;
  }
  /** Calls off every open question that `which` picks. */
  cancelAll(which) {
    const picked = this.inbox.state.questions.filter((q) => q.status === "open" && which(q));
    for (const question of picked) this.close(question, "cancel");
  }
  /** Answers or calls off a question: it leaves the state, and whoever waits on it hears. */
  close(question, event, answer) {
    question.status = step(QUESTION_MACHINE, question.status, event);
    this.waiting.get(question.id)?.(answer);
    this.waiting.delete(question.id);
    this.inbox.state.questions = this.inbox.state.questions.filter((q) => q !== question);
    this.inbox.changed();
  }
};

// src/engine/scheduler.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { stat as stat2 } from "node:fs/promises";
import path6 from "node:path";
import { z as z4 } from "zod";

// src/engine/run.ts
import {
  createSdkMcpServer as createSdkMcpServer2,
  query as query2,
  tool as tool2
} from "@anthropic-ai/claude-agent-sdk";
import { z as z3 } from "zod";
var SERVER2 = "openplan";
var OWN_TOOLS = /* @__PURE__ */ new Set([`mcp__${SERVER2}__ask_teammate`, `mcp__${SERVER2}__deliver`]);
var text = (words) => ({ content: [{ type: "text", text: words }] });
function teamServer(collaboration, delivered) {
  return createSdkMcpServer2({
    name: SERVER2,
    tools: [
      tool2(
        "ask_teammate",
        "Asks a teammate a question and waits for the answer. Use it only when you need their information or decision.",
        {
          teammate: z3.string().describe("The teammate's name"),
          question: z3.string().describe("The question, with the context they need")
        },
        async ({ teammate, question }) => text(await collaboration.askTeammate(teammate, question))
      ),
      tool2(
        "deliver",
        "Hands over your finished work: your subtask is done only once you call it. Then end your turn. If you deliver again, the last delivery counts.",
        {
          summary: z3.string().trim().min(1).describe("A few sentences: what you did, and anything to watch out for"),
          files: z3.array(z3.string()).describe(
            "The files that are the result, as paths in your worktree (not scratch files); empty when the result is the summary itself"
          )
        },
        async ({ summary, files }) => {
          const checked = await collaboration.checkDelivery(files);
          if ("refused" in checked) return text(checked.refused);
          delivered({ summary, files: checked.files });
          return text("Delivered. End your turn now.");
        }
      )
    ]
  });
}
async function runSubtask(params) {
  const { options, gate, signal } = params;
  let handover;
  let session = params.resume;
  const decode = turnDecoder({
    ...params.listener,
    session: (id, model) => {
      session = id;
      params.listener.session?.(id, model);
    }
  });
  const canUseTool = (name, input, request) => {
    if (!OWN_TOOLS.has(name)) return gate(name, input, request);
    return Promise.resolve(
      request.agentID ? { behavior: "deny", message: SESSION_ONLY } : { behavior: "allow", updatedInput: input }
    );
  };
  const turn = async (prompt) => {
    const abortController = new AbortController();
    const stop = () => {
      abortController.abort();
    };
    signal.addEventListener("abort", stop, { once: true });
    const claude = claudeProcess();
    const run2 = query2({
      prompt,
      options: {
        ...options,
        ...session !== void 0 && { resume: session },
        mcpServers: {
          ...options.mcpServers,
          [SERVER2]: teamServer(params.collaboration, (given) => handover = given)
        },
        canUseTool,
        abortController,
        spawnClaudeCodeProcess: claude.spawn
      }
    });
    try {
      for await (const message of run2) {
        const outcome = decode(message);
        if (outcome) return outcome;
      }
      return { ok: false, error: "The session ended without a result", tokens: 0 };
    } catch (error) {
      throw new Error(claude.failure(error), { cause: error });
    } finally {
      signal.removeEventListener("abort", stop);
      run2.close();
      await claude.gone();
    }
  };
  let tokens = 0;
  try {
    signal.throwIfAborted();
    let outcome = await turn(params.opening);
    tokens += outcome.tokens;
    if (outcome.ok && !handover && !signal.aborted) {
      outcome = await turn(DELIVER_REMINDER);
      tokens += outcome.tokens;
    }
    if (handover) return { status: "delivered", handover, tokens };
    if (signal.aborted) return { status: "stopped", tokens };
    return {
      status: "failed",
      error: outcome.ok ? "Ended without delivering, after a reminder" : outcome.error,
      tokens
    };
  } catch (error) {
    if (handover) return { status: "delivered", handover, tokens };
    if (signal.aborted) return { status: "stopped", tokens };
    return { status: "failed", error: errorText(error), tokens };
  }
}

// src/engine/scheduler.ts
var verdictSchema = z4.object({ pass: z4.boolean(), notes: z4.string().trim() });
var VERDICT = z4.toJSONSchema(verdictSchema);
var REVIEW_ROUNDS = 3;
var REVIEW_CALLS = ["rereview", "skip", "sendBack"];
var SIDE_CALLS = ["ours", "theirs", "retry"];
var DELIVERY_CALLS = ["accept", "revise"];
function goOnWith(subtask2, reason) {
  subtask2.goOn = [...subtask2.goOn ?? [], reason];
}
var progressOf = (steps) => {
  const current = steps.find((s) => s.status === "in_progress")?.content;
  return {
    done: steps.filter((s) => s.status === "completed").length,
    total: steps.length,
    ...current !== void 0 && { current }
  };
};
var handedAt = (subtask2) => subtask2.status === "reviewing" || subtask2.status === "merging" ? subtask2.delivery?.at ?? 0 : 0;
var Scheduler = class {
  constructor(core, questions) {
    this.core = core;
    this.questions = questions;
  }
  core;
  questions;
  /** Subtask id → its stage under way. */
  live = /* @__PURE__ */ new Map();
  /** Closing: nothing starts, and what stopped work still reports goes nowhere. */
  closed = false;
  /**
   * Runs stopped to go on in their sessions (their goal was paused, or you
   * added to them): they go back to pending with these, not to stopped.
   */
  held = /* @__PURE__ */ new Map();
  /** Stops everything under way and starts nothing after; settles once it has ended. */
  async close() {
    this.closed = true;
    for (const live of this.live.values()) live.abort.abort();
    await Promise.all([...this.live.values()].map((live) => live.ended));
  }
  /**
   * After a restart nothing is under way: what was running goes back to
   * pending, to go on in its session; what was in review or being merged is
   * taken up again by the next pump.
   */
  recover() {
    for (const subtask2 of this.core.state.subtasks) {
      if (subtask2.status !== "running") continue;
      this.move(subtask2, "hold");
      if (subtask2.session) goOnWith(subtask2, { why: "held" });
    }
  }
  /**
   * Gives a goal new work: tasks, each with its subtasks, their dependencies
   * by the keys they have in `tasks`. They wait as pending until they can
   * start. `meetingId`: the meeting whose plan they come from.
   */
  assign(goalId, tasks, meetingId) {
    const { state } = this.core;
    const now = Date.now();
    const ids = /* @__PURE__ */ new Map();
    const added = tasks.flatMap(({ title, outcome, subtasks }) => {
      const task = {
        id: randomUUID4(),
        goalId,
        title,
        outcome,
        createdAt: now,
        ...meetingId !== void 0 && { meetingId }
      };
      state.tasks.push(task);
      return subtasks.map(({ key, ...planned }) => {
        const id = randomUUID4();
        ids.set(key, id);
        return {
          ...planned,
          id,
          taskId: task.id,
          goalId,
          status: "pending",
          createdAt: now,
          progress: { done: 0, total: 0 },
          tokens: 0
        };
      });
    });
    for (const subtask2 of added)
      subtask2.dependsOn = subtask2.dependsOn.flatMap((k) => ids.get(k) ?? []);
    state.subtasks.push(...added);
    this.core.changed();
    this.pump();
    return added;
  }
  /**
   * Puts a goal's work on hold (it was paused or archived): its runs stop, to
   * go on in their sessions when it is resumed; its reviews stop, to be done
   * again then. Nothing of it starts meanwhile; a merge under way finishes.
   */
  hold(goalId) {
    for (const subtask2 of this.core.state.subtasks) {
      const live = this.live.get(subtask2.id);
      if (subtask2.goalId !== goalId || !live || live.kind === "merge") continue;
      if (live.kind === "run") this.keepOn(subtask2.id, { why: "held" });
      live.abort.abort();
    }
  }
  /**
   * You add to a subtask (a message to its member): it goes on in its
   * session, from where it stopped, with `note`; a running one stops first,
   * one not started yet hears it in its brief. One being reviewed or merged
   * is handed over already, and a paused or archived goal's work waits for
   * the goal to be resumed.
   */
  carry(subtaskId, note) {
    const subtask2 = this.subtask(subtaskId);
    if (!subtask2 || this.goalOf(subtask2).status !== "active") return "onHold";
    if (subtask2.status === "reviewing" || subtask2.status === "merging") return "handedOver";
    const live = this.live.get(subtaskId);
    if (live) {
      this.keepOn(subtaskId, { why: "carried", note });
      live.abort.abort();
      return "goes";
    }
    if (subtask2.status === "failed" || subtask2.status === "stopped") this.move(subtask2, "continue");
    else if (subtask2.status === "done") this.move(subtask2, "redo");
    goOnWith(subtask2, { why: "carried", note });
    subtask2.error = void 0;
    this.core.changed();
    this.pump();
    return "goes";
  }
  /**
   * Lets go of work about to be deleted: what waits to start won't, what runs
   * or is reviewed stops, not to go on, and this settles once all of it under
   * way has ended (a merge finishes first), so nothing of it is written after.
   */
  async release(subtaskIds) {
    await Promise.all(
      subtaskIds.flatMap((id) => {
        this.held.delete(id);
        const live = this.live.get(id);
        const stopping = this.stop(id);
        return live ? [live.ended, stopping] : [stopping];
      })
    );
  }
  /**
   * You stop a subtask: one not started, a run (it ends as stopped), a
   * review, a merge waiting on your decision (its half-done merge undone). One
   * handed over keeps its delivery and the stage it stopped in, to go on from.
   */
  async stop(subtaskId) {
    const subtask2 = this.subtask(subtaskId);
    const live = this.live.get(subtaskId);
    if (live?.kind === "run") {
      this.held.delete(subtaskId);
      live.abort.abort();
      return;
    }
    if (!subtask2 || !can(SUBTASK_MACHINE, subtask2.status, "stop")) return;
    if (subtask2.status === "merging") {
      if (live) return;
      await abortMerge(this.core.places, this.goalOf(subtask2).slug, subtask2.id);
      if (!can(SUBTASK_MACHINE, subtask2.status, "stop")) return;
    }
    live?.abort.abort();
    const stage = subtask2.status;
    this.move(subtask2, "stop");
    if (stage === "reviewing" || stage === "merging") subtask2.stoppedIn = stage;
    subtask2.finishedAt = Date.now();
    this.core.changed();
    this.pump();
  }
  /** You retry a failed or stopped subtask from the start: its session, delivery, review and worktree go. */
  async retry(subtaskId) {
    const subtask2 = this.subtask(subtaskId);
    if (!subtask2 || !can(SUBTASK_MACHINE, subtask2.status, "retry")) return;
    await dropDesk(this.core.places, this.goalOf(subtask2).slug, subtask2.id);
    if (!can(SUBTASK_MACHINE, subtask2.status, "retry")) return;
    this.move(subtask2, "retry");
    Object.assign(subtask2, {
      error: void 0,
      progress: { done: 0, total: 0 },
      session: void 0,
      goOn: void 0,
      delivery: void 0,
      review: void 0,
      conflict: void 0
    });
    this.core.changed();
    this.pump();
  }
  /**
   * You have a failed or stopped subtask go on from where it stopped: its
   * session and worktree, or, stopped once handed over, its review or merge,
   * its delivery standing.
   */
  continue(subtaskId) {
    const subtask2 = this.subtask(subtaskId);
    if (!subtask2 || !can(SUBTASK_MACHINE, subtask2.status, "continue")) return;
    const stage = subtask2.stoppedIn;
    this.move(
      subtask2,
      stage === "reviewing" ? "reviewAgain" : stage === "merging" ? "mergeAgain" : "continue"
    );
    subtask2.error = void 0;
    if (!stage && subtask2.session) goOnWith(subtask2, { why: "continued" });
    this.core.changed();
    this.pump();
  }
  /** You redo a done subtask whose upstream was redone since: in its session, from the goal's branch. */
  redo(subtaskId) {
    const subtask2 = this.subtask(subtaskId);
    if (!subtask2 || !can(SUBTASK_MACHINE, subtask2.status, "redo")) return;
    const redone = redoneUpstream(this.core.state, subtask2).map((s) => s.title);
    this.move(subtask2, "redo");
    if (subtask2.session) goOnWith(subtask2, { why: "redo", note: redone.join(", ") });
    this.core.changed();
    this.pump();
  }
  /**
   * Carries out your decision, answered already (Questions.answer): on a
   * stuck review (review again, skip it, send it back), on a merge (keep one
   * side of the files that can't be merged line by line, or try again), on a
   * task done (accept it, which is all it takes for work built on it to
   * start; or send one of its subtasks, `sentBack` or else the last one done,
   * back with what to change).
   */
  async decide(question, answer) {
    const subtask2 = this.subtask(question.subtaskId ?? "");
    if (!subtask2) return;
    const { decision: pick, note = "" } = answer;
    if (question.decision?.kind === "delivery") {
      const sentBack = this.subtask(answer.sentBack ?? subtask2.id);
      if (pick === "revise" && sentBack) {
        this.move(sentBack, "redo");
        goOnWith(sentBack, { why: "revised", note });
      }
    } else if (subtask2.status === "reviewing") {
      subtask2.review = { ...subtask2.review, rounds: 0 };
      if (pick === "skip") this.move(subtask2, "merge");
      else if (pick === "sendBack") {
        this.move(subtask2, "reject");
        if (subtask2.session) goOnWith(subtask2, { why: "rejected" });
      }
    } else if (subtask2.status === "merging") {
      const { slug } = this.goalOf(subtask2);
      if (pick === "retry") await abortMerge(this.core.places, slug, subtask2.id);
      else if (pick === "ours" || pick === "theirs")
        await pickSide(this.core.places, slug, subtask2.id, question.decision?.files ?? [], pick);
    }
    this.core.changed();
    this.pump();
  }
  /**
   * Takes up whatever can go on: what goes on in its session first, then new
   * work, and delivered work reviewed and merged in the order it was
   * delivered. A pending subtask starts, and one in review is reviewed, when
   * nothing holds it up (waitsIn: its goal active, you not deciding about it,
   * its member or reviewer free); one being merged is merged unless you are
   * deciding about it, one at a time per goal.
   */
  pump() {
    if (this.closed) return;
    const { state } = this.core;
    const work = workOf(this.core);
    const busy = busyMembers(work);
    const reviews = new Set(
      state.subtasks.filter((s) => this.live.get(s.id)?.kind === "review").map((s) => reviewerOf(work, s))
    );
    const merging2 = new Set(
      state.subtasks.filter((s) => this.live.get(s.id)?.kind === "merge").map((s) => s.goalId)
    );
    const order = [...state.subtasks].sort(
      (a, b) => Number(Boolean(b.goOn)) - Number(Boolean(a.goOn)) || handedAt(a) - handedAt(b)
    );
    for (const subtask2 of order) {
      if (this.live.has(subtask2.id)) continue;
      if (subtask2.status === "pending") {
        if (waitsIn(work, subtask2, busy).length) continue;
        busy.add(subtask2.assignee);
        void this.startRun(subtask2);
      } else if (subtask2.status === "reviewing") {
        const reviewer = reviewerOf(work, subtask2);
        if (reviews.has(reviewer) || waitsIn(work, subtask2, busy).length) continue;
        reviews.add(reviewer);
        void this.startReview(subtask2);
      } else if (subtask2.status === "merging") {
        if (waitsIn(work, subtask2, busy).length || merging2.has(subtask2.goalId)) continue;
        merging2.add(subtask2.goalId);
        void this.startMerge(subtask2);
      }
    }
  }
  /**
   * Moves a subtask by its machine. Leaving review or a merge calls off your
   * decision on it; done again, its task's delivery waits until it is done
   * again; leaving where it stopped, where it was handed over stands no more.
   */
  move(subtask2, event) {
    const from = subtask2.status;
    subtask2.status = step(SUBTASK_MACHINE, from, event);
    if ((from === "reviewing" || from === "merging") && subtask2.status !== from)
      this.questions.cancelFor(subtask2.id, true);
    if (from === "done") this.questions.cancelDelivery(subtask2.taskId);
    if (from === "stopped") subtask2.stoppedIn = void 0;
  }
  /** A run about to be stopped goes on in its session, with `reason` too. */
  keepOn(subtaskId, reason) {
    this.held.set(subtaskId, [...this.held.get(subtaskId) ?? [], reason]);
  }
  subtask(id) {
    return this.core.state.subtasks.find((s) => s.id === id);
  }
  goalOf(subtask2) {
    const goal2 = this.core.state.goals.find((g) => g.id === subtask2.goalId);
    if (!goal2) throw new Error(`The goal of "${subtask2.title}" is gone`);
    return goal2;
  }
  taskOf(subtask2) {
    const task = this.core.state.tasks.find((t) => t.id === subtask2.taskId);
    if (!task) throw new Error(`The task of "${subtask2.title}" is gone`);
    return task;
  }
  /** The document of the approved plan a task came from, if it came from one. */
  planOf(task) {
    return this.core.state.meetings.find((m) => m.id === task.meetingId)?.plan?.markdown;
  }
  /** A member by name: one taken off the team since can't work or review. */
  memberOf(name) {
    const member = this.core.team.members.find((m) => m.name === name);
    if (!member) throw new Error(`${name} is no longer on the team`);
    return member;
  }
  /** Registers a stage under way; `end` settles its `ended`. */
  begin(subtask2, kind) {
    const abort = new AbortController();
    const { promise: ended, resolve } = Promise.withResolvers();
    this.live.set(subtask2.id, { kind, abort, ended });
    return {
      abort,
      end: () => {
        this.live.delete(subtask2.id);
        resolve(void 0);
      }
    };
  }
  /** The work a subtask builds on, up the chain of dependencies: what it depends on directly first. */
  upstreamOf(subtask2) {
    const { subtasks } = this.core.state;
    const chain = [];
    const seen = /* @__PURE__ */ new Set([subtask2.id]);
    let level = subtask2.dependsOn;
    for (let direct = true; level.length; direct = false) {
      const next = [];
      for (const id of level) {
        const done = subtasks.find((s) => s.id === id);
        if (!done || seen.has(id)) continue;
        seen.add(id);
        chain.push({ subtask: done, direct });
        next.push(...done.dependsOn);
      }
      level = next;
    }
    return chain;
  }
  /**
   * Runs a subtask in its worktree: from its brief, or in its last session
   * with why it goes on. Delivered, its worktree is committed in its member's
   * name and it goes on to be merged.
   */
  async startRun(subtask2) {
    const { core } = this;
    const { abort, end: end2 } = this.begin(subtask2, "run");
    const goOn = subtask2.session ? subtask2.goOn : void 0;
    const notes = goOn ? [] : subtask2.goOn ?? [];
    subtask2.goOn = void 0;
    this.move(subtask2, "start");
    subtask2.startedAt = Date.now();
    subtask2.finishedAt = void 0;
    core.changed();
    let outcome;
    try {
      const member = this.memberOf(subtask2.assignee);
      const goal2 = this.goalOf(subtask2);
      const task = this.taskOf(subtask2);
      const desk = await openDesk(core.places, goal2.slug, subtask2.id);
      const recorder = core.recorder(subtask2);
      outcome = await runSubtask({
        options: await core.options(member, "task", desk),
        opening: goOn ? goOnMessage(goOn, subtask2) : taskBrief({
          goal: goal2,
          task,
          subtask: subtask2,
          cwd: desk,
          branch: subtaskBranch(goal2.slug, subtask2.id),
          plan: this.planOf(task),
          upstream: this.upstreamOf(subtask2),
          notes
        }),
        ...goOn && { resume: subtask2.session },
        gate: this.questions.gate({
          from: member.name,
          subtaskId: subtask2.id,
          signal: abort.signal
        }),
        collaboration: {
          askTeammate: (name, question) => this.askTeammate(member, subtask2, name, question, abort.signal),
          checkDelivery: (files) => this.checkDelivery(subtask2, desk, files)
        },
        listener: {
          ...recorder,
          session: (id, model) => {
            subtask2.session = id;
            core.changed();
            recorder.session?.(id, model);
          },
          steps: (steps) => {
            subtask2.progress = progressOf(steps);
            core.changed();
            recorder.steps?.(steps);
          }
        },
        signal: abort.signal
      });
      if (outcome.status === "delivered")
        await commitDesk(
          core.places,
          goal2.slug,
          subtask2.id,
          memberSigner(member.name),
          `${subtask2.title}

${outcome.handover.summary}`
        );
    } catch (error) {
      outcome = { status: "failed", error: errorText(error), tokens: 0 };
    }
    this.questions.cancelFor(subtask2.id);
    end2();
    subtask2.tokens += outcome.tokens;
    const held = this.held.get(subtask2.id);
    this.held.delete(subtask2.id);
    if (this.closed) return;
    if (held && (outcome.status === "stopped" || held.some((g) => g.why === "carried"))) {
      this.move(subtask2, "hold");
      for (const reason of held) goOnWith(subtask2, reason);
    } else if (outcome.status === "delivered") {
      subtask2.delivery = { ...outcome.handover, at: Date.now() };
      subtask2.conflict = void 0;
      this.move(subtask2, core.team.review ? "review" : "merge");
    } else {
      this.move(subtask2, outcome.status === "failed" ? "fail" : "stop");
      if (outcome.status === "failed") subtask2.error = outcome.error;
      subtask2.finishedAt = Date.now();
    }
    core.changed();
    this.pump();
  }
  /**
   * A running member asks a teammate by name; the teammate answers in a
   * read-only session in the goal's worktree. What the asker is told.
   */
  async askTeammate(from, subtask2, name, question, signal) {
    const { core } = this;
    const others = core.team.members.filter((m) => m.name !== from.name);
    const target = others.find((m) => m.name === name.trim());
    if (!target)
      return name.trim() === from.name ? "That's you; no need to ask." : `There's no teammate called "${name}". Your teammates: ${others.map((m) => m.name).join(", ") || "none"}.`;
    try {
      const reply = await this.questions.toTeammate(
        { from: from.name, subtaskId: subtask2.id },
        target.name,
        question,
        async () => askOnce({
          prompt: teammateQuestion({
            from,
            subtask: subtask2,
            question,
            own: core.state.subtasks.filter(
              (s) => s.goalId === subtask2.goalId && s.assignee === target.name
            )
          }),
          options: await core.options(
            target,
            "answer",
            await openGoal(core.places, this.goalOf(subtask2).slug)
          ),
          signal
        })
      );
      subtask2.tokens += reply.tokens;
      core.changed();
      return `${target.name} answered: ${reply.text}`;
    } catch (error) {
      return `${target.name} couldn't answer just now: ${errorText(error)}`;
    }
  }
  /**
   * Whether a delivery is taken: every file is in the worktree, and the
   * conflicts a merge left are resolved. Its files as kept, or why not.
   */
  async checkDelivery(subtask2, desk, files) {
    const kept = [];
    const missing2 = [];
    for (const file of files) {
      const relative = path6.relative(desk, path6.resolve(desk, file));
      const inside = relative !== "" && !relative.startsWith("..") && !path6.isAbsolute(relative);
      const there = inside && await stat2(path6.join(desk, relative)).then(
        (found) => found.isFile(),
        () => false
      );
      if (there) kept.push(relative.split(path6.sep).join("/"));
      else missing2.push(file);
    }
    if (missing2.length)
      return {
        refused: `Not delivered: these aren't files in your worktree (${desk}): ${missing2.join(", ")}. Deliver the files that are there.`
      };
    const left = subtask2.conflict ? await unresolved(this.core.places, subtask2.id, subtask2.conflict.files) : [];
    if (left.length)
      return {
        refused: `Not delivered: conflict markers are still in ${left.join(", ")}. Resolve them first, keeping what both sides meant, then deliver.`
      };
    return { files: [...new Set(kept)] };
  }
  /**
   * Reviews a delivery: a read-only session of the reviewer's in the
   * subtask's worktree passes it on to be merged, or sends it back with
   * notes; the third time back, or when the review fails, you decide. Stopped
   * meanwhile, it leaves the subtask as it is.
   */
  async startReview(subtask2) {
    const { core } = this;
    const { abort, end: end2 } = this.begin(subtask2, "review");
    try {
      const reviewer = this.memberOf(reviewerOf(workOf(core), subtask2));
      const { delivery } = subtask2;
      if (!delivery) throw new Error(`"${subtask2.title}" has no delivery to review`);
      const desk = await openDesk(core.places, this.goalOf(subtask2).slug, subtask2.id);
      const reply = await askOnce({
        prompt: reviewPrompt({
          task: this.taskOf(subtask2),
          subtask: subtask2,
          delivery,
          cwd: desk
        }),
        options: await core.options(reviewer, "review", desk),
        schema: VERDICT,
        signal: abort.signal
      });
      subtask2.tokens += reply.tokens;
      if (subtask2.status !== "reviewing") return;
      const verdict = verdictSchema.parse(reply.structured);
      const rounds = (subtask2.review?.rounds ?? 0) + (verdict.pass ? 0 : 1);
      subtask2.review = { rounds, notes: verdict.notes };
      if (verdict.pass) this.move(subtask2, "merge");
      else if (rounds >= REVIEW_ROUNDS)
        this.questions.openDecision(
          subtask2,
          { kind: "review", options: REVIEW_CALLS },
          verdict.notes
        );
      else {
        this.move(subtask2, "reject");
        if (subtask2.session) goOnWith(subtask2, { why: "rejected" });
      }
    } catch (error) {
      if (abort.signal.aborted || subtask2.status !== "reviewing") return;
      this.questions.openDecision(
        subtask2,
        { kind: "review", options: REVIEW_CALLS },
        errorText(error)
      );
    } finally {
      end2();
      if (!this.closed) {
        core.changed();
        this.pump();
      }
    }
  }
  /**
   * Merges a delivery into its goal's branch. Clean, the subtask is done.
   * Text conflicts go back to its member, in their session and worktree;
   * files that can't be merged line by line, or git failing, wait on your
   * decision.
   */
  async startMerge(subtask2) {
    const { core } = this;
    const { end: end2 } = this.begin(subtask2, "merge");
    try {
      const goal2 = this.goalOf(subtask2);
      const merged = await mergeDesk(
        core.places,
        goal2.slug,
        subtask2.id,
        memberSigner(subtask2.assignee)
      );
      if (merged.kind === "merged") {
        this.move(subtask2, "merged");
        subtask2.conflict = void 0;
        this.finished(subtask2);
      } else if (merged.other.length) {
        this.questions.openDecision(
          subtask2,
          { kind: "merge", options: SIDE_CALLS, files: merged.other },
          merged.other.join("\n")
        );
      } else {
        this.move(subtask2, "conflict");
        subtask2.conflict = { files: merged.text };
        if (subtask2.session) goOnWith(subtask2, { why: "conflict" });
      }
    } catch (error) {
      this.questions.openDecision(subtask2, { kind: "merge", options: ["retry"] }, errorText(error));
    } finally {
      end2();
      if (!this.closed) {
        core.changed();
        this.pump();
      }
    }
  }
  /** A subtask merged: done. The last of its task, the task's delivery waits for your acceptance. */
  finished(subtask2) {
    subtask2.finishedAt = Date.now();
    subtask2.progress = { done: subtask2.progress.total, total: subtask2.progress.total };
    if (this.core.state.subtasks.some((s) => s.taskId === subtask2.taskId && s.status !== "done"))
      return;
    this.questions.openDecision(
      subtask2,
      { kind: "delivery", options: DELIVERY_CALLS },
      this.taskOf(subtask2).title
    );
  }
};

// src/engine/team.ts
var import_yaml = __toESM(require_dist(), 1);
import { mkdir as mkdir5, readdir as readdir2, readFile as readFile4, writeFile as writeFile4 } from "node:fs/promises";
import path7 from "node:path";
import { z as z5 } from "zod";
var teamFolder = (top) => path7.join(top, ".claude", "openplan");
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var roleSchema = z5.object({ title: z5.string().trim().min(1) });
var memberSchema = z5.object({
  role: z5.string().trim().min(1),
  model: z5.string().trim().min(1).optional(),
  effort: z5.enum(EFFORTS).optional(),
  // As in `.mcp.json`, though YAML reads `API_TIMEOUT_MS: 3000000` as a number.
  env: z5.record(z5.string(), z5.union([z5.string(), z5.number(), z5.boolean()]).transform(String)).default({})
});
var teamSchema = z5.object({
  review: z5.boolean().default(true),
  meetingSize: z5.enum(MEETING_SIZES).default("discussion")
});
var settingsSchema = z5.record(z5.string(), z5.unknown());
function parsed(schema, data, file) {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(`${file}:
${z5.prettifyError(result.error)}`);
  return result.data;
}
var missing = (error) => error.code === "ENOENT";
async function jsonFile(file) {
  let text2;
  try {
    text2 = await readFile4(file, "utf8");
  } catch (error) {
    if (missing(error)) return void 0;
    throw error;
  }
  try {
    return JSON.parse(text2);
  } catch (error) {
    throw new Error(`${file}: ${errorText(error)}`, { cause: error });
  }
}
async function markdownFiles(folder) {
  let names2;
  try {
    names2 = (await readdir2(folder)).filter((name) => name.endsWith(".md")).sort();
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  return Promise.all(
    names2.map(async (name) => {
      const file = path7.join(folder, name);
      const text2 = await readFile4(file, "utf8");
      const front = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text2);
      let data;
      try {
        data = (0, import_yaml.parse)(front?.[1] ?? "") ?? {};
      } catch (error) {
        throw new Error(`${file}: ${errorText(error)}`, { cause: error });
      }
      return {
        name: name.slice(0, -".md".length),
        file,
        data,
        body: text2.slice(front?.[0].length ?? 0)
      };
    })
  );
}
async function loadTeam(top) {
  const folder = teamFolder(top);
  const roles = new Map(
    (await markdownFiles(path7.join(folder, "roles"))).map(({ name, file, data, body }) => [
      name,
      { id: name, title: parsed(roleSchema, data, file).title, duties: body.trim() }
    ])
  );
  const members = (await markdownFiles(path7.join(folder, "members"))).map(
    ({ name, file, data }) => {
      const { role, model, effort, env } = parsed(memberSchema, data, file);
      const found = roles.get(role);
      if (!found)
        throw new Error(`${file}: there is no role "${role}" in ${path7.join(folder, "roles")}`);
      return {
        name,
        role: found,
        ...model !== void 0 && { model },
        ...effort !== void 0 && { effort },
        env
      };
    }
  );
  if (!members.length)
    throw new Error(`The team has no members: add them in ${path7.join(folder, "members")}`);
  const teamFile = path7.join(folder, "team.json");
  const { review, meetingSize } = parsed(teamSchema, await jsonFile(teamFile) ?? {}, teamFile);
  const settingsFile = path7.join(folder, "settings.json");
  const settings = parsed(settingsSchema, await jsonFile(settingsFile) ?? {}, settingsFile);
  return { team: { members, review }, settings, meetingSize };
}
var writing = serialBy();
function allowInTeam(top, rules) {
  const file = path7.join(teamFolder(top), "settings.json");
  return writing(file, async () => {
    const settings = parsed(settingsSchema, await jsonFile(file) ?? {}, file);
    const permissions = parsed(
      z5.looseObject({ allow: z5.array(z5.string()).default([]) }),
      settings.permissions ?? {},
      file
    );
    const allow = [.../* @__PURE__ */ new Set([...permissions.allow, ...rules])];
    await mkdir5(path7.dirname(file), { recursive: true });
    await writeFile4(
      file,
      `${JSON.stringify({ ...settings, permissions: { ...permissions, allow } }, null, 2)}
`
    );
  });
}

// src/engine/engine.ts
var Engine = class _Engine {
  constructor(core, records, files, writer, options, size) {
    this.core = core;
    this.records = records;
    this.files = files;
    this.writer = writer;
    this.options = options;
    this.size = size;
    this.questions = new Questions(core);
    this.scheduler = new Scheduler(core, this.questions);
    this.meetings = new Meetings(core, this.scheduler);
    this.goals = new Goals(core, this.scheduler, this.meetings);
  }
  core;
  records;
  files;
  writer;
  options;
  size;
  questions;
  scheduler;
  meetings;
  goals;
  /** How many times the state has changed since the team opened. */
  changes = 0;
  /**
   * Opens the team of the repository `cwd` is in, for this session alone:
   * what a server before left running is stopped, and the goals it left
   * active are paused, as when a session closes (§3.2).
   */
  static async open(options) {
    const repo = await openRepository(options.cwd);
    const root = repoFolder(options.dataFolder, repo);
    const files = dataFiles(root);
    const { team: team2, settings, meetingSize } = await loadTeam(repo.top);
    await takeTeam(files.lock);
    try {
      await recordMembersIn(files.members);
      const state = await readState(files.state);
      const { host } = options;
      const writer = stateWriter(
        files.state,
        () => state,
        (error) => {
          host.failed(error);
        }
      );
      const places = { repo, root };
      const records = new Records(places, (error) => {
        host.failed(error);
      });
      const core = {
        state,
        team: team2,
        places,
        changed: () => {
          engine2.changes++;
          writer.changed();
          host.changed();
        },
        allowAlways: (rules) => engine2.allow(rules),
        options: (member, kind, cwd) => Promise.resolve(engine2.turnOptions(member, kind, cwd)),
        recorder: (subtask2) => records.recorder(subtask2.id),
        speech: (meeting2, speaker) => records.speech(meeting2, speaker)
      };
      const engine2 = new _Engine(core, records, files, writer, options, meetingSize);
      await engine2.writeMemberSettings(team2, settings);
      engine2.questions.recover();
      engine2.scheduler.recover();
      engine2.meetings.recover();
      for (const goal2 of state.goals)
        if (goal2.status === "active") await engine2.goals.pause(goal2.id);
      await writer.flush();
      await openedTeam(files.lock);
      return engine2;
    } catch (error) {
      releaseTeam(files.lock);
      throw error;
    }
  }
  get state() {
    return this.core.state;
  }
  get team() {
    return this.core.team;
  }
  /** Changes as the state does: the same number, the same state. */
  get revision() {
    return this.changes;
  }
  /** The size a meeting has unless you say. */
  get meetingSize() {
    return this.size;
  }
  /**
   * Reads the team's files again: roles, members, their settings, openplan's
   * own. When they can't be read, the team stays as it was.
   */
  async reloadTeam() {
    const { team: team2, settings, meetingSize } = await loadTeam(this.core.places.repo.top);
    await this.writeMemberSettings(team2, settings);
    this.core.team = team2;
    this.size = meetingSize;
    this.core.changed();
    this.scheduler.pump();
  }
  /**
   * Answers a question put to you, and carries out a decision (a stuck
   * review, a merge, a task done). Throws when it is no longer open or the
   * answer doesn't fit it.
   */
  async answer(id, answer) {
    const question = this.questions.answer(id, answer);
    if ("decision" in answer) await this.scheduler.decide(question, answer);
    return question;
  }
  /**
   * Closes the team as the session ends (§3.2): every active goal is paused,
   * a merge under way finishes, and the state is written.
   */
  async close() {
    for (const goal2 of this.state.goals)
      if (goal2.status === "active") await this.goals.pause(goal2.id);
    await Promise.all([this.scheduler.close(), this.meetings.close()]);
    this.writer.changed();
    await Promise.all([this.writer.flush(), this.records.flush()]);
    releaseTeam(this.files.lock);
  }
  /**
   * Lets the team go at once, as the process dies of an error: its members
   * are stopped and the lock released. The state stays as last written, and
   * the next session pauses what it left active.
   */
  abandon() {
    stopMembers();
    releaseTeam(this.files.lock);
  }
  /** Adds allow rules to the team's settings (Questions: allow always), for every member's next turns. */
  async allow(rules) {
    await allowInTeam(this.core.places.repo.top, rules);
    await this.reloadTeam();
  }
  /**
   * Writes each member's settings file: the team's settings, their
   * environment filled in, and the guards. Throws before writing any when a
   * member's environment names a variable that isn't set.
   */
  async writeMemberSettings(team2, settings) {
    const plugin = pluginId(this.options.dataFolder);
    const each = team2.members.map((member) => {
      try {
        return [member.name, memberSettings(settings, member, this.options.env, plugin)];
      } catch (error) {
        throw new Error(`${member.name}: ${errorText(error)}`, { cause: error });
      }
    });
    for (const [name, filled] of each) await writeSettings(this.files.settings(name), filled);
  }
  turnOptions(...[member, kind, cwd]) {
    const seat = {
      member,
      claude: this.options.claude,
      cwd,
      settings: this.files.settings(member.name),
      system: systemPrompt(kind, member, this.core.team.members)
    };
    return kind === "task" ? workOptions(seat, this.options.env) : readOnlyOptions(seat, this.options.env);
  }
};

// src/plugin/claude.ts
import { execFile as execFile2 } from "node:child_process";
import { readlink } from "node:fs/promises";
import { promisify } from "node:util";
var run = async (command, args) => (await promisify(execFile2)(command, args)).stdout;
async function executableOf(pid) {
  const id = String(pid);
  let found;
  switch (process.platform) {
    case "linux":
      found = await readlink(`/proc/${id}/exe`);
      break;
    case "win32":
      found = (await run("powershell.exe", [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${id}").ExecutablePath`
      ])).trim();
      break;
    default:
      found = (await run("lsof", ["-a", "-p", id, "-d", "txt", "-Fn"])).split("\n").find((line) => line.startsWith("n"))?.slice(1);
  }
  if (!found) throw new Error(`Can't tell which executable process ${id} runs`);
  return found;
}

// src/plugin/pane-tools.ts
import { z as z6 } from "zod";

// src/plugin/status.ts
var MEETING_STATUS = {
  running: "under way",
  review: "its plan waits for you: approve it, change it, or cancel it",
  approved: "plan approved",
  cancelled: "cancelled",
  failed: "failed"
};
function waitText(wait, work) {
  switch (wait.kind) {
    case "goal":
      return `its goal is ${wait.status}`;
    case "upstream": {
      const upstream = work.subtasks.find((s) => s.id === wait.subtaskId);
      return `waits on "${upstream?.title ?? ""}" by ${wait.by}${wait.halted ? ", which has stopped" : ""}`;
    }
    case "busy":
      return `waits until ${wait.by} is free`;
    case "teammate":
      return `asked ${wait.by}`;
    case "you":
      return wait.decision ? "waits on your decision" : "waits on your answer";
    case "acceptance":
      return "waits until you accept the task it builds on";
  }
}
function subtaskLine(subtask2, waits, work) {
  const { progress } = subtask2;
  const parts = [subtask2.status];
  if (subtask2.status === "running" && progress.total)
    parts.push(
      `step ${String(Math.min(progress.done + 1, progress.total))} of ${String(progress.total)}${progress.current ? `: ${progress.current}` : ""}`
    );
  parts.push(...waits.map((w) => waitText(w, work)));
  if (subtask2.error) parts.push(`error: ${subtask2.error}`);
  return `    - ${subtask2.title} [${subtask2.id}], ${subtask2.assignee}: ${parts.join(", ")}`;
}
function questionLine(question, work) {
  const about = work.subtasks.find((s) => s.id === question.subtaskId);
  const head = `  - [${question.id}] `;
  if (question.permission)
    return `${head}${question.from} asks to use ${question.permission.tool}${question.permission.title ? `: ${question.permission.title}` : ""}. Answer it in /openplan.`;
  if (question.choices)
    return `${head}${question.from} asks: ${question.choices.map((c) => c.question).join(" ")} Answer it in /openplan.`;
  const options = question.decision?.options.join(", ") ?? "";
  switch (question.decision?.kind) {
    case "delivery":
      return `${head}The task "${question.text}" is done: ${options}.`;
    case "review":
      return `${head}The review of "${about?.title ?? ""}" is stuck (${question.text}): ${options}.`;
    case "merge":
      return `${head}Merging "${about?.title ?? ""}" needs you (${question.text.split("\n").join(", ")}): ${options}.`;
    default:
      return `${head}${question.from} asks: ${question.text}`;
  }
}
function statusText(work) {
  const derived = derive(work);
  const busy = new Set(derived.busy);
  const lines = [`Team: ${work.members.map((m) => busy.has(m) ? `${m} (busy)` : m).join(", ")}`];
  for (const goal2 of work.goals) {
    lines.push(
      "",
      `Goal "${goal2.name}" [${goal2.id}]: ${goal2.status}, on branch ${goalBranch(goal2.slug)}`
    );
    for (const meeting2 of work.meetings.filter(
      (m) => m.goalId === goal2.id && m.status !== "approved"
    ))
      lines.push(
        `  Meeting [${meeting2.id}] on "${meeting2.agenda}", hosted by ${meeting2.host}: ${MEETING_STATUS[meeting2.status]}${meeting2.error ? ` (${meeting2.error})` : ""}${derived.resumable.includes(meeting2.id) ? "; it can go on" : ""}`
      );
    for (const task of work.tasks.filter((t) => t.goalId === goal2.id)) {
      lines.push(`  Task "${task.title}" [${task.id}]`);
      for (const subtask2 of work.subtasks.filter((s) => s.taskId === task.id))
        lines.push(subtaskLine(subtask2, derived.subtasks[subtask2.id]?.waits ?? [], work));
    }
  }
  const open2 = work.questions.filter((q) => q.to === YOU && q.status === "open");
  if (open2.length) lines.push("", "Waiting on you:", ...open2.map((q) => questionLine(q, work)));
  return lines.join("\n");
}

// src/plugin/pane.ts
var plural = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;
function shownMeeting(work) {
  const latest = (status) => work.meetings.filter((m) => !status || m.status === status).at(-1);
  return latest("running") ?? latest("review") ?? latest();
}
function meetingStatus(meeting2) {
  switch (meeting2.status) {
    case "running":
      return meeting2.planning ? `${meeting2.host} writes the plan` : meeting2.speaking ? `${meeting2.speaking} speaks` : meeting2.weighing ? "deciding who speaks next" : "under way";
    case "review":
      return "its plan waits for you";
    case "approved":
      return "plan approved";
    case "cancelled":
      return "cancelled";
    case "failed":
      return `failed${meeting2.error ? `: ${meeting2.error}` : ""}`;
  }
}
var meetingOf = (meeting2) => ({
  id: meeting2.id,
  agenda: meeting2.agenda,
  status: meetingStatus(meeting2),
  participants: meeting2.participants,
  turns: meeting2.turns.map((t) => ({
    speaker: t.speaker,
    text: t.text,
    ...t.calls && { to: t.calls }
  })),
  hands: (meeting2.hands ?? []).map((h) => ({ member: h.member, point: h.point })),
  ...meeting2.plan && { plan: meeting2.plan.summary }
});
function stepText(subtask2) {
  const { done, total, current } = subtask2.progress;
  if (!total) return "";
  const step2 = `step ${String(Math.min(done + 1, total))} of ${String(total)}`;
  return current ? `, ${step2}: ${current}` : `, ${step2}`;
}
function memberOf(member, work, derived) {
  const own = work.subtasks.filter((s) => s.assignee === member.name);
  const at = (status) => own.find((s) => s.status === status);
  const reviewing = work.subtasks.find(
    (s) => s.status === "reviewing" && s.assignee !== member.name && reviewerOf(work, s) === member.name && derived.busy.includes(member.name)
  );
  const meeting2 = work.meetings.find(
    (m) => m.status === "running" && m.participants.includes(member.name)
  );
  const next = at("pending");
  const running3 = at("running");
  let doing;
  if (running3) doing = `works on "${running3.title}"${stepText(running3)}`;
  else if (meeting2) doing = `at the meeting on "${meeting2.agenda}"`;
  else if (reviewing) doing = `reviews "${reviewing.title}" by ${reviewing.assignee}`;
  else if (at("reviewing")) doing = `"${at("reviewing")?.title ?? ""}" is in review`;
  else if (at("merging")) doing = `"${at("merging")?.title ?? ""}" is being merged`;
  else if (next) {
    const waits = derived.subtasks[next.id]?.waits ?? [];
    doing = `next: "${next.title}"${waits.length ? `, ${waits.map((w) => waitText(w, work)).join(", ")}` : ""}`;
  } else doing = "free";
  const followed = running3 ?? own.filter((s) => s.startedAt).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  const spoken = work.meetings.flatMap((m) => m.turns).filter((t) => t.speaker === member.name).reduce((sum, t) => sum + t.tokens, 0);
  return {
    name: member.name,
    role: member.role.title,
    ...member.model && { model: member.model },
    doing,
    ...followed && { subtask: followed.id },
    tokens: own.reduce((sum, s) => sum + s.tokens, 0) + spoken
  };
}
function callText(permission) {
  if (permission.title) return permission.title;
  const { input } = permission;
  const main = ["command", "file_path", "path", "url", "pattern"].map((key) => input[key]).find((value) => typeof value === "string");
  return main ? `${permission.tool}: ${main}` : permission.tool;
}
function needOf(question, work) {
  const subtask2 = work.subtasks.find((s) => s.id === question.subtaskId);
  const head = {
    id: question.id,
    from: question.from,
    about: subtask2?.title ?? "",
    text: question.text
  };
  if (question.permission)
    return {
      ...head,
      kind: "permission",
      call: callText(question.permission),
      options: question.permission.options
    };
  if (question.choices)
    return {
      ...head,
      kind: "choices",
      choices: question.choices.map((c) => ({
        question: c.question,
        header: c.header,
        options: c.options.map((o) => o.label),
        multiSelect: c.multiSelect
      }))
    };
  if (question.decision) {
    const done = work.subtasks.filter((s) => s.taskId === subtask2?.taskId && s.status === "done");
    return {
      ...head,
      kind: "decision",
      options: question.decision.options,
      ...question.decision.kind === "delivery" && {
        sendBack: done.map((s) => ({ id: s.id, title: s.title }))
      }
    };
  }
  return void 0;
}
function milestones(work) {
  const said2 = [];
  for (const meeting2 of work.meetings)
    if (meeting2.status === "approved")
      said2.push({ key: `plan:${meeting2.id}`, text: `Plan approved: "${meeting2.agenda}"` });
  for (const s of work.subtasks) {
    if (s.review?.rounds)
      said2.push({
        key: `back:${s.id}:${String(s.review.rounds)}`,
        text: `"${s.title}" went back to ${s.assignee}${s.review.notes ? `: ${s.review.notes}` : ""}`
      });
    if (s.status === "done")
      said2.push({ key: `done:${s.id}`, text: `"${s.title}" by ${s.assignee} is merged` });
    if (s.status === "failed")
      said2.push({
        key: `failed:${s.id}:${String(s.startedAt ?? 0)}`,
        text: `"${s.title}" by ${s.assignee} failed${s.error ? `: ${s.error}` : ""}`
      });
  }
  return said2;
}
function bandText(work, needs) {
  if (!work.goals.length) return void 0;
  const parts = [];
  if (work.meetings.some((m) => m.status === "running")) parts.push("meeting");
  if (work.meetings.some((m) => m.status === "review")) parts.push("plan to review");
  const working = work.subtasks.filter((s) => s.status === "running").length;
  if (working) parts.push(`${String(working)} working`);
  if (needs) parts.push(`${plural(needs, "needs", "need")} you`);
  if (!parts.length) {
    const paused = work.goals.filter((g) => g.status === "paused").length;
    parts.push(paused ? plural(paused, "goal paused", "goals paused") : "idle");
  }
  return parts.join(" \xB7 ");
}
function paneTeam(work, members) {
  const derived = derive(work);
  const needs = work.questions.filter((q) => q.to === YOU && q.status === "open").flatMap((q) => needOf(q, work) ?? []);
  const meeting2 = shownMeeting(work);
  const band = bandText(work, needs.length);
  return {
    ...band && { band },
    ...meeting2 && { meeting: meetingOf(meeting2) },
    members: members.map((m) => memberOf(m, work, derived)),
    needs,
    milestones: milestones(work)
  };
}

// src/plugin/pane-tools.ts
var json = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }]
});
var PANE_ONLY = "For openplan's pane only: your session never calls it.";
function addPaneTools(server2, team2) {
  server2.registerTool(
    "view",
    {
      description: `${PANE_ONLY} The team as the pane draws it.`,
      inputSchema: {
        revision: z6.number().int().optional().describe("The revision the pane has"),
        record: z6.object({ subtask: z6.string(), from: z6.number().int().min(0) }).optional().describe("The subtask whose record the pane follows, and the byte it read up to")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ revision, record: record2 }) => {
      const engine2 = await team2();
      const work = workOf(engine2);
      const meeting2 = shownMeeting(work);
      const spoken = meeting2 && engine2.records.speaking(meeting2);
      const view = {
        revision: engine2.revision,
        ...revision !== engine2.revision && { team: paneTeam(work, engine2.team.members) },
        ...spoken && { speaking: { speaker: spoken.speaker, text: spoken.text } },
        ...record2 && {
          record: {
            subtask: record2.subtask,
            ...await engine2.records.read(record2.subtask, record2.from)
          }
        }
      };
      return json(view);
    }
  );
  server2.registerTool(
    "answer",
    {
      description: `${PANE_ONLY} Answers what waits on the user, as they pressed it.`,
      inputSchema: {
        question: z6.string(),
        option: z6.enum(PERMISSION_OPTIONS).optional().describe("A permission's answer"),
        picks: z6.array(z6.string()).optional().describe("One pick per question with choices"),
        decision: z6.enum(DECISION_OPTIONS).optional(),
        note: z6.string().trim().optional().describe("Why it is denied, or what to change"),
        sent_back: z6.string().optional().describe("The subtask a revised task goes back to")
      }
    },
    async ({ question, option, picks, decision, note, sent_back }) => {
      const words = note ? { note } : {};
      const answer = option ? { option, ...words } : decision ? { decision, ...words, ...sent_back !== void 0 && { sentBack: sent_back } } : { picks: picks ?? [] };
      await (await team2()).answer(question, answer);
      return json({ answered: question });
    }
  );
}

// src/plugin/tools.ts
import { z as z7 } from "zod";
var said = (text2) => ({ content: [{ type: "text", text: text2 }] });
var names = (items) => new Intl.ListFormat("en", { type: "conjunction" }).format(items);
function goalOf(engine2, ref) {
  const { goals } = engine2.state;
  const byId = goals.find((g) => g.id === ref);
  if (byId) return byId;
  const named = goals.filter((g) => g.name.toLowerCase() === ref.trim().toLowerCase());
  if (named.length === 1 && named[0]) return named[0];
  throw new Error(
    named.length ? `More than one goal is called "${ref}": give its id` : `There is no goal "${ref}"`
  );
}
var writtenPlan = (plan) => ({
  summary: plan.summary,
  plan_markdown: plan.markdown,
  tasks: plan.tasks.map((task) => ({
    title: task.title,
    outcome: task.outcome,
    subtasks: task.subtasks.map(({ dependsOn, ...subtask2 }) => ({
      ...subtask2,
      depends_on: dependsOn
    }))
  }))
});
var goal = z7.string().describe("The goal's id, or its name");
var meeting = z7.string().describe("The meeting's id");
var subtask = z7.string().describe("The subtask's id");
function addTools(server2, team2) {
  server2.registerTool(
    "status",
    {
      description: "Where the team stands: each goal with its meetings, tasks and subtasks, who is busy, and what waits on the user. Ids are in brackets.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const engine2 = await team2();
      return said(statusText(workOf(engine2)));
    }
  );
  server2.registerTool(
    "start_goal",
    {
      description: "Start a goal: something the user wants done. It gets its own branch, cut from the repository's HEAD. Then hold a meeting to plan it, or assign work directly.",
      inputSchema: { name: z7.string().trim().min(1).describe("A few words for what is wanted") }
    },
    async ({ name }) => {
      const started = await (await team2()).goals.start(name);
      return said(
        `Started the goal "${started.name}" [${started.id}] on branch ${goalBranch(started.slug)}.`
      );
    }
  );
  server2.registerTool(
    "hold_meeting",
    {
      description: "Have members meet to plan a goal. They discuss it read-only in the goal's worktree, and the host writes a plan of tasks and subtasks, each with an assignee, dependencies and acceptance criteria. Returns at once: the meeting runs in the background, and the session is told when its plan waits for the user.",
      inputSchema: {
        goal,
        agenda: z7.string().trim().min(1).describe("What to plan, with everything the user said about it"),
        size: z7.enum(MEETING_SIZES).optional().describe("How long the discussion runs; the team's default when left out"),
        attendees: z7.array(z7.string()).default([]).describe("Member names, the host first; everyone when empty")
      }
    },
    async ({ goal: ref, agenda, size, attendees }) => {
      const engine2 = await team2();
      const held = engine2.meetings.start({
        goalId: goalOf(engine2, ref).id,
        agenda,
        size: size ?? engine2.meetingSize,
        attendees
      });
      return said(
        `The meeting [${held.id}] has begun: ${names(held.participants)}, hosted by ${held.host}.`
      );
    }
  );
  server2.registerTool(
    "show_plan",
    {
      description: "A meeting's plan in full: its document and its tasks and subtasks, in the shape change_plan takes.",
      inputSchema: { meeting },
      annotations: { readOnlyHint: true }
    },
    async ({ meeting: id }) => {
      const found = (await team2()).state.meetings.find((m) => m.id === id);
      if (!found?.plan) throw new Error("That meeting has no plan");
      return said(JSON.stringify(writtenPlan(found.plan), null, 2));
    }
  );
  server2.registerTool(
    "change_plan",
    {
      description: "Replace a plan under review with the user's changes: the whole plan, as show_plan gives it, changed. Any member can be given work.",
      inputSchema: {
        meeting,
        plan: planSchema(z7.string().describe("The name of the member it goes to"))
      }
    },
    async ({ meeting: id, plan }) => {
      (await team2()).meetings.change(id, plan);
      return said("The plan is changed. It waits for the user's approval.");
    }
  );
  server2.registerTool(
    "approve_plan",
    {
      description: "Approve a plan under review, as the user said: its tasks and subtasks go to work, each starting once what it builds on is merged and its member is free.",
      inputSchema: { meeting }
    },
    async ({ meeting: id }) => {
      const added = await (await team2()).meetings.approve(id);
      return said(
        `Approved: ${String(added.length)} ${added.length === 1 ? "subtask goes" : "subtasks go"} to work.`
      );
    }
  );
  server2.registerTool(
    "cancel_meeting",
    {
      description: "Stop a meeting under way, or drop a plan the user doesn't want.",
      inputSchema: { meeting }
    },
    async ({ meeting: id }) => {
      await (await team2()).meetings.cancel(id);
      return said("Cancelled.");
    }
  );
  server2.registerTool(
    "resume_meeting",
    {
      description: "Go on with a meeting that failed or was cancelled before its plan, from where it stopped.",
      inputSchema: { meeting }
    },
    async ({ meeting: id }) => {
      (await team2()).meetings.resume(id);
      return said("The meeting goes on.");
    }
  );
  server2.registerTool(
    "assign",
    {
      description: "Give a member one subtask directly, without a meeting. It starts once they are free.",
      inputSchema: {
        goal,
        assignee: z7.string().describe("The member's name"),
        title: z7.string().trim().min(1),
        description: z7.string().trim().describe("Everything the user said about it"),
        acceptance: z7.string().trim().default("").describe("When it counts as done")
      }
    },
    async ({ goal: ref, ...work }) => {
      const engine2 = await team2();
      const [added] = engine2.goals.assign(goalOf(engine2, ref).id, work);
      return said(`Assigned "${work.title}" [${added?.id ?? ""}] to ${work.assignee}.`);
    }
  );
  server2.registerTool(
    "goal_action",
    {
      description: "Pause a goal (its runs stop, to go on later in their sessions), resume it, archive it, or delete an archived one: its worktrees and subtask branches go, its own branch stays. Delete only when the user has confirmed it.",
      inputSchema: { goal, action: z7.enum(GOAL_ACTIONS) },
      annotations: { destructiveHint: true }
    },
    async ({ goal: ref, action }) => {
      const engine2 = await team2();
      const { id, name } = goalOf(engine2, ref);
      await engine2.goals[action](id);
      return said(`The goal "${name}": ${action} done.`);
    }
  );
  server2.registerTool(
    "subtask_action",
    {
      description: "Stop a subtask; continue a stopped or failed one in its session and worktree; retry one from the start; or redo a done one whose upstream was redone.",
      inputSchema: { subtask, action: z7.enum(SUBTASK_ACTIONS) }
    },
    async ({ subtask: id, action }) => {
      const engine2 = await team2();
      const found = engine2.state.subtasks.find((s) => s.id === id);
      if (!found) throw new Error("There is no such subtask");
      if (!derive(workOf(engine2)).subtasks[id]?.actions.includes(action))
        throw new Error(`"${found.title}" can't ${action} while ${found.status}`);
      await engine2.scheduler[action](id);
      return said(`"${found.title}" is ${found.status} now.`);
    }
  );
  server2.registerTool(
    "message",
    {
      description: "Pass the user's words to the member working on a subtask: a running one takes them at once, in its session; one not started reads them first.",
      inputSchema: { subtask, text: z7.string().trim().min(1) }
    },
    async ({ subtask: id, text: text2 }) => {
      const went = (await team2()).scheduler.carry(id, text2);
      return said(
        went === "goes" ? "Passed on." : went === "handedOver" ? "Not passed on: it is delivered and in review or being merged. Send its task back once it is done." : "Not passed on: its goal is paused or archived."
      );
    }
  );
  server2.registerTool(
    "decide",
    {
      description: "Carry out the user's decision on something waiting on them: a task done (accept, or revise with what to change, `sent_back` naming the subtask), a stuck review (rereview, skip, sendBack), or a merge (ours, theirs, retry).",
      inputSchema: {
        question: z7.string().describe("The id of what waits on the user"),
        decision: z7.enum(DECISION_OPTIONS),
        note: z7.string().trim().optional().describe("What to change, in the user's words"),
        sent_back: z7.string().optional().describe("The subtask a revised task goes back to")
      }
    },
    async ({ question, decision, note, sent_back }) => {
      await (await team2()).answer(question, {
        decision,
        ...note !== void 0 && { note },
        ...sent_back !== void 0 && { sentBack: sent_back }
      });
      return said("Done.");
    }
  );
}

// src/plugin/wake.ts
import { connect } from "node:net";
function wakeSession(text2, env = process.env) {
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = env.CLAUDE_CODE_MESSAGING_TOKEN;
  if (!socket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const lines = [
      ...token ? [{ type: "auth", token }] : [],
      { type: "user", message: { role: "user", content: text2 } }
    ];
    const posting = connect(socket, () => {
      posting.end(lines.map((line) => `${JSON.stringify(line)}
`).join(""));
    });
    posting.on("error", reject).on("close", () => {
      resolve();
    });
    posting.resume();
  });
}
var NewForYou = class {
  told = /* @__PURE__ */ new Set();
  constructor(state) {
    this.news(state);
  }
  /** The messages for what is new in `state`. */
  news(state) {
    const messages = [];
    const fresh = (id) => {
      if (this.told.has(id)) return false;
      this.told.add(id);
      return true;
    };
    for (const meeting2 of state.meetings)
      if (meeting2.status === "review" && meeting2.plan && fresh(meeting2.id))
        messages.push(
          `openplan: the meeting [${meeting2.id}] on "${meeting2.agenda}" has a plan: ${meeting2.plan.summary}. Show it to the user with show_plan, and ask whether to approve it, change it, or cancel it.`
        );
    for (const question of state.questions) {
      if (question.to !== YOU || question.status !== "open" || question.decision?.kind !== "delivery" || !fresh(question.id))
        continue;
      const subtask2 = state.subtasks.find((s) => s.id === question.subtaskId);
      const delivered = state.subtasks.filter((s) => s.taskId === subtask2?.taskId && s.delivery).map((s) => `- ${s.title}, by ${s.assignee}: ${s.delivery?.summary ?? ""}`);
      messages.push(
        [
          `openplan: the task "${question.text}" is done [${question.id}], merged into its goal's branch:`,
          ...delivered,
          "Tell the user what was done, and ask whether to accept it or send it back with what to change (decide)."
        ].join("\n")
      );
    }
    return messages;
  }
};

// src/plugin/server.ts
var dataFolder = process.env.CLAUDE_PLUGIN_DATA;
if (!dataFolder)
  throw new Error("openplan's MCP server runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");
var say = (text2) => {
  console.error(`openplan: ${text2}`);
};
var engine;
var opening;
var news2;
var openTeam = async () => Engine.open({
  cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  dataFolder,
  // Members run the Claude Code your session runs: the process that started this one.
  claude: await executableOf(process.ppid),
  env: process.env,
  host: {
    changed() {
      if (!engine || !news2) return;
      for (const message of news2.news(engine.state))
        wakeSession(message).catch((error) => {
          say(`your session couldn't be told: ${errorText(error)}`);
        });
    },
    failed(error) {
      say(`the team's state or a record couldn't be written: ${errorText(error)}`);
    }
  }
});
var team = () => {
  opening ??= openTeam().then(
    (opened) => {
      news2 = new NewForYou(opened.state);
      return engine = opened;
    },
    (error) => {
      opening = void 0;
      throw error;
    }
  );
  return opening;
};
var ending;
function end() {
  ending ??= (async () => {
    try {
      await (await opening?.catch(() => void 0))?.close();
    } catch (error) {
      say(`the team didn't close cleanly: ${errorText(error)}`);
    } finally {
      process.exit(0);
    }
  })();
}
process.stdin.once("end", end).once("close", end);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.once(signal, end);
process.on("uncaughtException", (error) => {
  say(`stopped by an error: ${error.stack ?? error.message}`);
  engine?.abandon();
  process.exit(1);
});
process.once("exit", stopMembers);
var server = new McpServer({ name: "openplan", version: plugin_default.version });
addTools(server, team);
addPaneTools(server, team);
await server.connect(new StdioServerTransport());
team().catch((error) => {
  say(errorText(error));
});
