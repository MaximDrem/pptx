// presentation v2 — dependency-free XML parser (OOXML subset).
//
// Why own parser: the skill is offline, ships no npm runtime, and PPTX reading
// must be exact (elements, groups, z-order, styles). Regex over slide XML
// breaks on nesting (groups inside groups), attributes and entity-escaped
// text, so the reader is built on a real tree.
//
// Node shape:
//   { name: "p:sp", local: "sp", attrs: { "r:embed": "rId4" },
//     children: [ ...nodes ], text: "direct text" }
//
// Supported: elements, attributes (single/double quotes), self-closing tags,
// text (with entity decoding), comments, CDATA, PIs, DOCTYPE. Not supported:
// DTD internal subsets (OOXML never ships them).
"use strict";

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;

function decodeEntities(s) {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch (e) {
        return m;
      }
    }
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return m; // unknown entity: keep literally
    }
  });
}

function parse(source) {
  const xml = String(source).replace(/^\uFEFF/, "");
  let i = 0;
  const n = xml.length;
  let root = null;
  const stack = [];

  const fail = (msg) => {
    const line = xml.slice(0, i).split("\n").length;
    throw new Error("xml: " + msg + " (line " + line + ")");
  };

  const skipWs = () => {
    while (i < n && (xml[i] === " " || xml[i] === "\t" || xml[i] === "\n" || xml[i] === "\r")) i++;
  };

  const readName = () => {
    if (i >= n || !NAME_START.test(xml[i])) fail("expected name");
    const start = i;
    i++;
    while (i < n && NAME_CHAR.test(xml[i])) i++;
    return xml.slice(start, i);
  };

  const skipProlog = () => {
    for (;;) {
      skipWs();
      if (xml.startsWith("<?", i)) {
        const end = xml.indexOf("?>", i);
        if (end === -1) fail("unterminated processing instruction");
        i = end + 2;
      } else if (xml.startsWith("<!--", i)) {
        const end = xml.indexOf("-->", i);
        if (end === -1) fail("unterminated comment");
        i = end + 3;
      } else if (xml.startsWith("<!DOCTYPE", i)) {
        // Balance < ... > — DOCTYPE may contain a bracketed internal subset.
        let depth = 0;
        while (i < n) {
          const ch = xml[i++];
          if (ch === "[") depth++;
          else if (ch === "]") depth--;
          else if (ch === ">" && depth <= 0) break;
        }
      } else {
        return;
      }
    }
  };

  const appendNode = (node) => {
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (!root) root = node;
    else fail("multiple root elements");
  };

  const appendText = (raw) => {
    if (!raw) return;
    const node = stack[stack.length - 1];
    if (!node) return; // whitespace outside root
    node.text += decodeEntities(raw);
  };

  skipProlog();

  while (i < n) {
    if (xml[i] !== "<") {
      const start = i;
      while (i < n && xml[i] !== "<") i++;
      appendText(xml.slice(start, i));
      continue;
    }
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i);
      if (end === -1) fail("unterminated comment");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i);
      if (end === -1) fail("unterminated CDATA");
      appendText(xml.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i);
      if (end === -1) fail("unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (xml.startsWith("</", i)) {
      i += 2;
      const name = readName();
      skipWs();
      if (xml[i] !== ">") fail("expected > in closing tag </" + name + ">");
      i++;
      const open = stack.pop();
      if (!open) fail("closing tag without open element: " + name);
      if (open.name !== name) fail("mismatched closing tag: <" + open.name + "> closed by </" + name + ">");
      continue;
    }
    // Opening tag.
    i++;
    const name = readName();
    const node = { name, local: name.indexOf(":") === -1 ? name : name.slice(name.indexOf(":") + 1), attrs: {}, children: [], text: "" };
    for (;;) {
      skipWs();
      if (i >= n) fail("unterminated tag <" + name + ">");
      const ch = xml[i];
      if (ch === ">") {
        i++;
        appendNode(node);
        stack.push(node);
        break;
      }
      if (ch === "/") {
        if (xml[i + 1] !== ">") fail("expected /> in <" + name + ">");
        i += 2;
        appendNode(node);
        break;
      }
      const an = readName();
      skipWs();
      let value = "";
      if (xml[i] === "=") {
        i++;
        skipWs();
        const q = xml[i];
        if (q !== '"' && q !== "'") fail("unquoted attribute value: " + an + " in <" + name + ">");
        const end = xml.indexOf(q, i + 1);
        if (end === -1) fail("unterminated attribute value: " + an);
        value = decodeEntities(xml.slice(i + 1, end));
        i = end + 1;
      }
      node.attrs[an] = value;
    }
  }
  if (stack.length) fail("unclosed element <" + stack[stack.length - 1].name + ">");
  if (!root) fail("no root element");
  return root;
}

// ------------------------------------------------------------- tree helpers

function attr(node, name, fallback = null) {
  if (!node) return fallback;
  if (node.attrs && Object.prototype.hasOwnProperty.call(node.attrs, name)) return node.attrs[name];
  // Allow lookup by local name for commonly unprefixed attrs.
  if (node.attrs) {
    for (const key of Object.keys(node.attrs)) {
      if ((key.indexOf(":") === -1 ? key : key.slice(key.indexOf(":") + 1)) === name) return node.attrs[key];
    }
  }
  return fallback;
}

function child(node, name) {
  if (!node) return null;
  if (name === undefined || name === null) return node.children[0] || null;
  const wanted = name.indexOf(":") === -1 ? null : name;
  for (const c of node.children) {
    if (wanted ? c.name === name : c.local === name) return c;
  }
  return null;
}

function children(node, name) {
  if (!node) return [];
  if (name === undefined || name === null) return node.children;
  const wanted = name.indexOf(":") === -1 ? null : name;
  return node.children.filter((c) => (wanted ? c.name === name : c.local === name));
}

function descendants(node, name, acc = []) {
  if (!node) return acc;
  for (const c of node.children) {
    if (name.indexOf(":") === -1 ? c.local === name : c.name === name) acc.push(c);
    descendants(c, name, acc);
  }
  return acc;
}

function textOf(node) {
  if (!node) return "";
  let out = node.text;
  for (const c of node.children) out += textOf(c);
  return out;
}

// All text under (and including) a node — recursively, without duplication.
function allText(node) {
  if (!node) return "";
  return (node.text || "") + node.children.map(allText).join("");
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

module.exports = { parse, attr, child, children, descendants, textOf, allText, num, decodeEntities };
