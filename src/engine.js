import colorParse from "color-parse";
import { parse } from "parse5";
import postcss from "postcss";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
    renderer, font, state,
    NATIVE_SIZE, CHROME_H, defaultStyles, inputLike, HIDDEN_TAGS, TEXT_TYPES,
} from "./state.js";

export const attr = (n, name) => n.attrs?.find(a => a.name === name)?.value;
export const pad = n => n?.computedStyle?.padding ?? 0;
export const closest = (n, test) => {
    for (let o = n; o; o = o.parentNode) if (test(o)) return o;
    return null;
};

const camel = p => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export function parseColor(c) {
    if (!c) return null;
    const parsed = colorParse(c);
    if (!parsed.space) return null;
    const [r, g, b] = parsed.values;
    return [r, g, b, Math.round(parsed.alpha * 255)];
}

export function parseSize(s) {
    return parseFloat(s) || 0;
}

function parseFontSize(v, parent) {
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    if (v.endsWith("em")) return n * parent;
    if (v.endsWith("%"))  return parent * n / 100;
    return n; // px
}

export function isEditable(n) {
    if (!n.nodeName) return false;
    if (n.nodeName === "textarea") return true;
    return n.nodeName === "input" && TEXT_TYPES.has((attr(n, "type") ?? "text").toLowerCase());
}

export function textScale(n) {
    return n.parentNode.computedStyle.fontSize / font.config.fontSize;
}

export function resolveHref(href) {
    try {
        const u = new URL(href, state.currentURL);
        if (!["http:", "https:", "file:", "simple:"].includes(u.protocol)) return null;
        return u.href;
    } catch {
        return null;
    }
}

export const val = b => state.inputValues[b.key] ?? "";

export function cursorOf(b) {
    return (b.cursor = Math.min(b.cursor ?? val(b).length, val(b).length));
}

export const lineStart = (v, c) => v.lastIndexOf("\n", c - 1) + 1;
export const lineEnd   = (v, c) => { const i = v.indexOf("\n", c); return i < 0 ? v.length : i; };

export const viewportH = () => Math.max(0, state.height - CHROME_H);
export const pageH     = () => state.levels[0]?.[0]?.layout.h ?? 0;
export const maxScroll = () => Math.max(0, pageH() - viewportH());

export function scrollBy(dy) {
    state.scrollY = Math.min(maxScroll(), Math.max(0, state.scrollY + dy));
}

export function unfocusPrev() {
    if (!state.focusedBox) return;
    state.focusedBox.focused = false;
    if (isEditable(state.focusedBox)) {
        state.focusedBox.displayCursor = true;
    }
    state.focusedBox.onUnFocus?.();
    state.focusedBox = null;
}

export function focus(box) {
    unfocusPrev();

    box.focused = true;
    if (box.onFocus) box.onFocus();
    if (isEditable(box)) {
        box.cursor = 0;
        box.displayCursor = true;
    }
    state.focusedBox = box;
}

let rules = [];
let sheetSources = [];

function parseCompound(t) {
    const c = { tag: null, id: null, classes: [], spec: 0 };
    for (const m of t.matchAll(/([#.]?)([\w-]+)|\*|(.)/g)) {
        if (m[3]) return null;               // unsupported syntax
        if (m[0] === "*") continue;
        if (m[1] === "#") { c.id = m[2]; c.spec += 100; }
        else if (m[1] === ".") { c.classes.push(m[2]); c.spec += 10; }
        else { c.tag = m[2].toLowerCase(); c.spec += 1; }
    }
    return c;
}

function compileSelector(sel) {
    const tokens = sel.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
    const parts = [];
    let comb = " ";
    for (const t of tokens) {
        if (t === ">") { comb = ">"; continue; }
        const compound = parseCompound(t);
        if (!compound) return null;
        parts.push({ compound, comb });
        comb = " ";
    }
    if (!parts.length) return null;
    return { parts, spec: parts.reduce((s, p) => s + p.compound.spec, 0) };
}

function rebuildRules() {
    rules = [];
    let order = 0;
    for (const src of sheetSources) {
        let root;
        try { root = postcss.parse(src.text ?? ""); } catch { continue; }
        root.walkRules(rule => {
            if (rule.parent.type !== "root") return;   // skip @media etc. for now
            const decls = {};
            rule.walkDecls(d => {
                decls[camel(d.prop)] = d.value.replace(/\s*!important\s*$/i, "");
            });
            for (const sel of rule.selectors) {
                const c = compileSelector(sel);
                if (c) rules.push({ ...c, decls, order: order++ });
            }
        });
    }
}

function matchesCompound(n, c) {
    if (!n.nodeName || n.nodeName.startsWith("#")) return false;
    if (c.tag && n.nodeName !== c.tag) return false;
    if (c.id && attr(n, "id") !== c.id) return false;
    if (c.classes.length) {
        const have = (attr(n, "class") ?? "").split(/\s+/);
        if (!c.classes.every(k => have.includes(k))) return false;
    }
    return true;
}

function matches(n, parts, i = parts.length - 1) {
    if (!matchesCompound(n, parts[i].compound)) return false;
    if (i === 0) return true;
    if (parts[i].comb === ">") return !!n.parentNode && matches(n.parentNode, parts, i - 1);
    for (let p = n.parentNode; p; p = p.parentNode) if (matches(p, parts, i - 1)) return true;
    return false;
}

function applyDecls(cs, d, parentFontSize) {
    for (const [k, v] of Object.entries(d)) {
        switch (k) {
            case "backgroundColor": case "borderColor": case "borderWidth":
                cs[k] = v; break;
            case "padding":  cs.padding = parseSize(v); break;
            case "color":    cs.color = parseColor(v) ?? cs.color; break;
            case "fontSize": cs.fontSize = parseFontSize(v, parentFontSize) ?? cs.fontSize; break;
            case "cursor": cs.cursor = v; break;
        }
    }
}

export function inlineHit(levels, px, py) {
    for (const level of levels) for (const n of level) {
        if (!n.inline || n.hidden) continue;
        for (const l of n.inline.lines) for (const it of l.items) {
            if (it.atomic || it.br) continue;   // inputs and imgs are normal boxes
            if (px >= it.absX && px < it.absX + it.w &&
                py >= it.absY && py < it.absY + it.h) return it;
        }
    }
    return null;
}

export const linkOf = it => it && closest(it.node, o => o.nodeName === "a");

function collectSheets(n, out = []) {
    if (n.nodeName === "style") {
        out.push({ text: (n.childNodes ?? []).map(c => c.value ?? "").join("") });
    } else if (n.nodeName === "link" && attr(n, "rel")?.toLowerCase() === "stylesheet" && attr(n, "href")) {
        out.push({ href: attr(n, "href"), text: "" });
    }
    for (const c of n.childNodes ?? []) collectSheets(c, out);
    return out;
}

async function loadLinkedSheets(id) {
    await Promise.all(sheetSources.filter(s => s.href).map(async s => {
        const url = resolveHref(s.href);
        if (!url) return;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (res.ok) s.text = await res.text();
        } catch {}
    }));
    if (id !== state.loadId) return;
    rebuildRules();
    if (state.doc) state.levels = generateLevels(state.doc);
}

function inlineStyle(n) {
    const out = {};
    for (const decl of (attr(n, "style") ?? "").split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const k = decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const v = decl.slice(i + 1).trim();
        if (k && v) out[k] = v;
    }
    return out;
}

const INHERITED = ["fontSize", "color", "cursor"];

function computeStyles(levels) {
    const base = { fontSize: NATIVE_SIZE, color: [0, 0, 0, 255] };
    for (const level of levels) for (const n of level) {
        n.hidden = !!n.parentNode?.hidden
            || inputLike.includes(n.parentNode?.nodeName)
            || (n.nodeName === "input" && attr(n, "type") === "hidden")
            || HIDDEN_TAGS.has(n.nodeName)
            || n.nodeName === "#comment"
            || n.nodeName === "#documentType";

        if (n.nodeName.startsWith("#")) continue;

        const parentStyle = n.parentNode?.computedStyle ?? base;
        const inherited = {};
        for (const k of INHERITED) inherited[k] = parentStyle[k];

        if (n.anonymous) { n.computedStyle = { padding: 0, display: "block", ...inherited }; continue; }

        const cs = { padding: 0, ...inherited, ...(defaultStyles[n.nodeName] ?? {}) };

        const matched = rules
            .filter(r => matches(n, r.parts))
            .sort((a, b) => a.spec - b.spec || a.order - b.order);
        for (const r of matched) applyDecls(cs, r.decls, parentStyle.fontSize);
        applyDecls(cs, inlineStyle(n), parentStyle.fontSize);

        n.computedStyle = cs;
    }
}

const imageCache = new Map();

const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/bmp": ".bmp" };

function getImage(url) {
    let entry = imageCache.get(url);
    if (entry) return entry;
    entry = { state: "loading", img: null };
    imageCache.set(url, entry);

    (async () => {
        let file;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const type = res.headers.get("content-type")?.split(";")[0].trim();
            const ext = EXT[type] ?? (path.extname(new URL(url).pathname) || ".png");
            file = path.join(os.tmpdir(), crypto.randomUUID() + ext);
            fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
            const img = renderer.loadImage(file);
            if (!img?.width) throw new Error("decode failed");
            entry.img = img;
            entry.state = "ok";
        } catch {
            entry.state = "failed";
        } finally {
            if (file) fs.rmSync(file, { force: true });
        }
        state.layoutDirty = true;
    })();

    return entry;
}

export const displayOf = n => defaultStyles[n.nodeName]?.display ?? "block";

const isInlineNode = n =>
    n.nodeName.startsWith("#") || HIDDEN_TAGS.has(n.nodeName) || displayOf(n) === "inline";

const isVisible = c => c.nodeName === "#text"
    ? !!c.value.trim()
    : !c.nodeName.startsWith("#") && !HIDDEN_TAGS.has(c.nodeName);

function normalize(n) {
    const kids = n.childNodes;
    if (!kids?.length) return;
    kids.forEach(normalize);

    if (!(kids.some(isInlineNode) && kids.some(c => !isInlineNode(c)))) return;

    const out = [];
    let run = [];
    const flush = () => {
        if (run.some(isVisible)) {
            const w = { nodeName: "div", anonymous: true, childNodes: run, attrs: [], parentNode: n };
            run.forEach(c => c.parentNode = w);
            out.push(w);
        } else {
            out.push(...run.filter(c => c.nodeName !== "#text"));  // keep neutral nodes, drop blank text
        }
        run = [];
    };
    for (const c of kids) {
        if (isInlineNode(c)) run.push(c);
        else { flush(); out.push(c); }
    }
    flush();
    n.childNodes = out;
}

function byDepth(root) {
    const levels = [];
    const byKey = new Map();
    const queue = [{ node: root, depth: 0, key: "0" }];
    let head = 0;

    while (head < queue.length) {
        const { node, depth, key } = queue[head++];

        node.key = key;
        node.depth = depth;
        byKey.set(key, node);
        (levels[depth] ??= []).push(node);

        (node.childNodes ?? []).forEach((child, i) => {
            queue.push({ node: child, depth: depth + 1, key: `${key}.${i}` });
        });
    }

    return { levels, byKey };
}

function measureFontWidth(f, s) {
    return s.length * f.config.cellWidth;
}

const isAtomic = n => n.nodeName === "img" || inputLike.includes(n.nodeName);

const isIFCRoot = n =>
    !isInlineNode(n) && !isAtomic(n) &&
    !!n.childNodes?.length && n.childNodes.every(isInlineNode);

const isInlineFlow = n => !n.nodeName.startsWith("#") && displayOf(n) === "inline";

function layoutInline(root) {
    const maxW = root.layout.w - 2 * pad(root);
    const items = [];

    (function walk(n) {
        for (const c of n.childNodes ?? []) {
            if (c.hidden) continue;
            if (c.nodeName === "#text") {
                const scale = textScale(c);
                for (const tok of c.value.replace(/\s+/g, " ").match(/ |\S+/g) ?? []) {
                    items.push({ node: c, text: tok, scale,
                                 w: measureFontWidth(font, tok) * scale, h: font.lineHeight * scale });
                }
            } else if (c.nodeName === "br") {
                items.push({ node: c, br: true, w: 0, h: font.lineHeight * textScale(c) });
            } else if (isAtomic(c)) {
                items.push({ node: c, atomic: true, w: c.layout.w, h: c.layout.h });
            } else walk(c);
        }
    })(root);

    const lines = [];
    let line;
    const newLine = () => { line = { items: [], w: 0, h: 0 }; lines.push(line); };
    newLine();

    for (const it of items) {
        if (it.br) { line.h = Math.max(line.h, it.h); newLine(); continue; }
        const space = it.text === " ";
        if (space && (!line.items.length || line.items.at(-1).text === " ")) continue;
        if (!space && line.items.length && line.w + it.w > maxW) {
            if (line.items.at(-1).text === " ") line.w -= line.items.pop().w;
            newLine();
        }
        it.x = line.w;
        line.items.push(it);
        line.w += it.w;
        line.h = Math.max(line.h, it.h);
    }

    let y = 0;
    for (const l of lines) {
        for (const it of l.items) it.y = y + (l.h - it.h);
        y += l.h;
    }
    root.inline = { lines };
    root.layout.h = y + 2 * pad(root);
}

export function generateLevels(p) {
    normalize(p);
    const { levels, byKey } = byDepth(p);
    computeStyles(levels);

    for (const level of levels) for (const n of level) {
        const parent = byKey.get(n.key.slice(0, n.key.lastIndexOf(".")));
        n.inline = null;
        n.layout = {
            w: parent ? Math.max(0, parent.layout.w - 2 * pad(parent)) : state.width,
            x: 0, y: 0, h: 0,
        };
    }

    for (const level of [...levels].reverse()) for (const n of level) {
        if (n.nodeName === "#text") { n.lines = []; n.layout.h = 0; continue; }
        if (n.hidden) { n.layout.h = 0; continue; }

        if (inputLike.includes(n.nodeName)) {
            if (!(n.key in state.inputValues)) {
                state.inputValues[n.key] = n.nodeName === "textarea"
                    ? (n.childNodes?.[0]?.value ?? "")
                    : (attr(n, "value") ?? "");
            }
            const scale = textScale(n);
            const rows = n.nodeName === "textarea" ? 4 : 1;
            const chrome = 2 * (pad(n) + parseSize(n.computedStyle.borderWidth));
            if (isInlineFlow(n)) {
                const cols = parseInt(attr(n, "size")) || 20;
                n.layout.w = Math.min(n.layout.w, cols * measureFontWidth(font, "M") * scale + chrome);
            }
            n.layout.h = rows * font.lineHeight * scale + chrome;
        } else if (n.nodeName === "img") {
            const src = resolveHref(attr(n, "src") ?? "");
            n.entry = src ? getImage(src) : null;

            const iw = n.entry?.img?.width ?? 0, ih = n.entry?.img?.height ?? 0;
            let w = parseSize(attr(n, "width")), h = parseSize(attr(n, "height"));
            if (!w && !h) { w = iw; h = ih; }
            else if (!w)  { w = ih ? h * iw / ih : 0; }
            else if (!h)  { h = iw ? w * ih / iw : 0; }

            const avail = n.layout.w;
            if (w > avail) { h = h * avail / w; w = avail; }
            n.layout.w = w;
            n.layout.h = h;
        } else if (isIFCRoot(n)) {
            layoutInline(n);
        } else if (isInlineFlow(n)) {
            n.layout.h = 0;
        } else {
            n.layout.h = (n.childNodes ?? []).reduce((s, c) => s + c.layout.h, 0) + 2 * pad(n);
        }
    }

    for (const level of levels) for (const n of level) {
        const p = pad(n);
        if (n.inline) {
            for (const l of n.inline.lines) for (const it of l.items) {
                it.absX = n.layout.x + p + it.x;
                it.absY = n.layout.y + p + it.y;
                if (it.atomic) { it.node.layout.x = it.absX; it.node.layout.y = it.absY; }
            }
            continue;
        }
        if (isInlineFlow(n)) continue;
        let y = n.layout.y + p;
        for (const c of n.childNodes ?? []) {
            c.layout.x = n.layout.x + p;
            c.layout.y = y;
            y += c.layout.h;
        }
    }

    return levels;
}

export const boxOf = (n, originY = 50, scrollY = 0) => ({
    x: n.layout.x,
    y: originY + n.layout.y - scrollY,
    w: n.layout.w,
    h: n.layout.h,
});

export const isBoxNode = n =>
    !n.hidden && n.layout && n.layout.h > 0 &&
    (n.nodeName === "#text" ? n.lines?.length : !n.nodeName.startsWith("#"));

export function renderHTML(code) {
    unfocusPrev();
    state.inputValues = {};
    state.doc = parse(code, { scriptingEnabled: false });
    sheetSources = collectSheets(state.doc);
    rebuildRules();
    state.levels = state.width ? generateLevels(state.doc) : [];
    if (sheetSources.some(s => s.href)) loadLinkedSheets(state.loadId);
}