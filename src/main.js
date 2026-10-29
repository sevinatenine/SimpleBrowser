import { loadRenderer, PixelBuffer, ShapeDrawer, BitmapFont } from "tessera.js";
import colorParse from "color-parse";
import { parse } from "parse5";

const { Renderer, RESIZABLE } = loadRenderer();

const renderer = new Renderer();
if (!renderer.initialize(600, 400, "Node.js Pixel Window")) {
    console.error("Failed to initialize renderer");
    process.exit(1);
}

renderer.setWindowState(RESIZABLE);
renderer.targetFPS = 60;

let canvas = new PixelBuffer(renderer, 600, 400);

const NATIVE_SIZE = 32;

const control = {
    padding: 5,
    backgroundColor: "white",
    borderColor: "black",
    borderWidth: 2,
    color: [0, 0, 0, 255],
};

const defaultStyles = {
    h1: { fontSize: NATIVE_SIZE * 2, padding: 5 },
    h2: { fontSize: NATIVE_SIZE * 1.5, padding: 5 },
    p:  { fontSize: NATIVE_SIZE, padding: 5 },
    a:  { color: [0, 0, 238, 255], padding: 0 },
    span: { padding: 0 },
    div: { padding: 0 },
    body: { padding: 10 },
    input: { ...control },
    textarea: { ...control },

};

const inputLike = ["input", "textarea"];

const HIDDEN_TAGS = new Set(["head", "title", "script", "style", "template"]);

const font = new BitmapFont(renderer, "assets/font.png", {
    cellWidth: 16,
    cellHeight: 32,
    cellsPerRow: 40,
    cellsPerColumn: 7,
    fontSize: NATIVE_SIZE,
    lineHeight: NATIVE_SIZE,
});

let width = 0;
let height = 0;

var scrollY = 0;

const SCROLL_SPEED = 40;
const CHROME_H = 50;

const viewportH = () => Math.max(0, height - CHROME_H);
const pageH     = () => levels[0]?.[0]?.layout.h ?? 0;
const maxScroll = () => Math.max(0, pageH() - viewportH());

function scrollBy(dy) {
    scrollY = Math.min(maxScroll(), Math.max(0, scrollY + dy));
}

function updateScroll(my) {
    const wheel = renderer.input.getMouseWheelDelta();
    const dy = typeof wheel === "number" ? wheel : (wheel?.y ?? 0);
    if (dy && my >= CHROME_H) scrollBy(-dy * SCROLL_SPEED);
    scrollBy(0);
}
 
function paintScrollbar() {
    const max = maxScroll();
    if (max <= 0) return;
    const track = viewportH();
    const thumbH = Math.max(24, track * track / pageH());
    const thumbY = CHROME_H + (scrollY / max) * (track - thumbH);
    ShapeDrawer.fillRect(canvas, width - 8, thumbY, 6, thumbH, 130, 130, 130, 255);
}
  
const pageStep = () => Math.max(40, viewportH() - 40);
 
function parseColor(c) {
    if (!c) return null;
    const parsed = colorParse(c);
    if (!parsed.space) return null;
    const [r, g, b] = parsed.values; 
    return [r, g, b, Math.round(parsed.alpha * 255)];
}

function parseSize(s) {
    return parseFloat(s) || 0;
}

let focusedBox = null;

function unfocusPrev() {
    if (!focusedBox) return;
    focusedBox.focused = false;
    if (isEditable(focusedBox)) {
        focusedBox.displayCursor = true;
    }
    focusedBox.onUnFocus?.();
    focusedBox = null;
}

function focus(box) {
    unfocusPrev();

    box.focused = true;
    if (box.onFocus) box.onFocus();
    if (isEditable(box)) {
        box.cursor = 0;
        box.displayCursor = true;
    }
    focusedBox = box;
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

const TEXT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

function isEditable(n) {
    if (!n.nodeName) return false;
    if (n.nodeName === "textarea") return true;
    return n.nodeName === "input" && TEXT_TYPES.has((attr(n, "type") ?? "text").toLowerCase());
}

class Box {
    constructor(xDef, yDef, wDef, hDef, relativeTo = null, style = {}) {
        this.defs = { x: xDef, y: yDef, w: wDef, h: hDef };
        this.relativeTo = relativeTo;
        this.style = { ...Box.defaultStyles, ...style };
        this.x = this.y = this.w = this.h = 0;
        this.focused = false;
    }

    static get defaultStyles() {
        return {
            backgroundColor: "white",
            color: "black",
            fontSize: "12px",
            borderColor: "",
            borderWidth: "4px"
        };
    }

    resolve(def) {
        const p = this.relativeTo ?? { x: 0, y: 0, w: width, h: height };
        return typeof def === "function" ? def(p) : def ?? 0;
    }

    updateSize() {
        const ox = this.relativeTo?.x ?? 0;
        const oy = this.relativeTo?.y ?? 0;
        this.x = ox + this.resolve(this.defs.x);
        this.y = oy + this.resolve(this.defs.y);
        this.w = this.resolve(this.defs.w);
        this.h = this.resolve(this.defs.h);
    }

    draw() {
        const fill = parseColor(this.style.backgroundColor);
        const border = parseColor(this.style.borderColor);
        const bw = parseSize(this.style.borderWidth);

        if (fill) ShapeDrawer.fillRect(canvas, this.x, this.y, this.w, this.h, ...fill);
        if (border && bw > 0) ShapeDrawer.strokeRect(canvas, this.x, this.y, this.w, this.h, bw, ...border);
    }

    focus() {
        focus(this);
    }

    contains(px, py) {
        return px >= this.x && px < this.x + this.w &&
               py >= this.y && py < this.y + this.h;
    }

    onClick() {
    }
}

class Button extends Box {
    constructor(x, y, w, h, relativeTo, style, value, callback, enabled = () => true) {
        super(x, y, w, h, relativeTo, style);
        this.value = value;
        this.callback = callback;
        this.enabled = enabled;
    }

    onClick() { if (this.enabled()) this.callback(); }

    draw() {
        super.draw();
        const on = this.enabled();
        const scale = 0.75;
        const cw = font.config.cellWidth * scale;
        const lh = font.lineHeight * scale;
        const c = on ? { r: 0, g: 0, b: 0, a: 255 } : { r: 150, g: 150, b: 150, a: 255 };
        font.drawText(canvas, this.value,
            this.x + (this.w - this.value.length * cw) / 2,
            this.y + (this.h - lh) / 2, c, scale);
    }
}

class ImageButton extends Box {

}

class Input extends Box {
    constructor(x, y, w, h, relativeTo, style, value) {
        super(x, y, w, h, relativeTo, style);
        this.value = value;
    }

    onClick() { this.focus(); }
    onFocus() { this.style.borderColor = "#09f"; }
    onUnFocus() { this.style.borderColor = "black"; }

    draw() {
        super.draw();

        const bw = parseSize(this.style.borderWidth);
        const scale = 0.5;
        const padX = 6;
        const lh = font.lineHeight * scale;
        const cw = font.config.cellWidth * scale;

        const maxChars = Math.max(0, Math.floor((this.w - 2 * (bw + padX)) / cw));
        const text = this.value.slice(0, maxChars);

        font.drawText(
            canvas, text,
            this.x + bw + padX,
            this.y + (this.h + 4 - lh) / 2,
            { r: 0, g: 0, b: 0, a: 255 },
            scale
        );
    }
}

const topBar = new Box(0, 0, p => p.w, 50, null, { backgroundColor: "#333", borderColor: "#888" });
const backButton = new Button(10, 10, 30, 30, topBar, { color: "black", backgroundColor: "white", borderColor: "black", borderWidth: "2px" },
    "<", () => go(-1), () => histIndex > 0);
const forwardsButton = new Button(50, 10, 30, 30, topBar, { color: "black", backgroundColor: "white", borderColor: "black", borderWidth: "2px" },
    ">", () => go(1), () => histIndex < history.length - 1);
const input = new Input(90, 10, p => p.w - 140, 30, topBar, { backgroundColor: "white", borderColor: "black", borderWidth: "2px" }, "Loading...");
const content = new Box(0, 50, p => p.w, p => p.h - 50, null, { backgroundColor: "#eee" });

const boxes = [topBar, backButton, forwardsButton, input, content];

let doc = null;
let levels = [];

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

const INHERITED = ["fontSize", "color"];

function computeStyles(levels) {
    const base = { fontSize: NATIVE_SIZE, color: [0, 0, 0, 255] };
    for (const level of levels) for (const n of level) {
        n.hidden = !!n.parentNode?.hidden
            || inputLike.includes(n.parentNode?.nodeName)      // textarea's text child
            || (n.nodeName === "input" && attr(n, "type") === "hidden")
            || HIDDEN_TAGS.has(n.nodeName)
            || n.nodeName === "#comment"
            || n.nodeName === "#documentType";

        if (n.nodeName.startsWith("#")) continue;

        const parentStyle = n.parentNode?.computedStyle ?? base;
        const inherited = {};
        for (const k of INHERITED) inherited[k] = parentStyle[k];

        const cs = { padding: 0, ...inherited, ...(defaultStyles[n.nodeName] ?? {}) };

        const s = inlineStyle(n);
        for (const k of ["backgroundColor", "borderColor", "borderWidth"]) {
            if (s[k]) cs[k] = s[k];
        }
        if (s.padding) cs.padding = parseSize(s.padding);
        if (s.color)   cs.color = parseColor(s.color) ?? cs.color;

        n.computedStyle = cs;
    }
}

const pad = n => n?.computedStyle?.padding ?? 0;
const attr = (n, name) => n.attrs?.find(a => a.name === name)?.value;
const val = b => inputValues[b.key] ?? "";

function cursorOf(b) {
    return (b.cursor = Math.min(b.cursor ?? val(b).length, val(b).length));
}

const lineStart = (v, c) => v.lastIndexOf("\n", c - 1) + 1;
const lineEnd   = (v, c) => { const i = v.indexOf("\n", c); return i < 0 ? v.length : i; };

function textScale(n) {
    return n.parentNode.computedStyle.fontSize / font.config.fontSize;
}

var inputValues = {};

let refreshTimer = null;
let refreshHops = 0;            // reset to 0 in navigate() and go()
const MAX_REFRESH_HOPS = 5;
 
// Handles: "5", "0; url=/next", "0;URL='/next?a=b'", "3, https://x.com/", "0 /next"
function parseRefresh(content) {
    const m = /^\s*(\d+)?\s*(?:[;,\s]\s*(?:url\s*=\s*)?(['"]?)(.*?)\2)?\s*$/i.exec(content ?? "");
    if (!m) return null;
    return { delay: parseInt(m[1] ?? "0", 10), url: m[3] || null };
}
 
// First refresh meta in document order wins, like browsers.
function findRefresh(n) {
    if (n.nodeName === "meta" && attr(n, "http-equiv")?.trim().toLowerCase() === "refresh") {
        const r = parseRefresh(attr(n, "content"));
        if (r) return r;
    }
    for (const c of n.childNodes ?? []) {
        const r = findRefresh(c);
        if (r) return r;
    }
    return null;
}
 
function scheduleRefresh(id) {
    clearTimeout(refreshTimer);
    const r = findRefresh(doc);
    if (!r) return;
 
    const target = r.url ? resolveHref(r.url) : currentURL;
    if (!target) return;
    if (target === currentURL && r.delay === 0) return;
 
    const redirecting = target !== currentURL;
    if (redirecting && refreshHops >= MAX_REFRESH_HOPS) return;
 
    refreshTimer = setTimeout(() => {
        if (id !== loadId) return;
        if (redirecting) refreshHops++;
        if (history[histIndex]) history[histIndex].url = target;
        renderURL(target);
    }, r.delay * 1000);
}

function generateLevels(p) {
    const { levels, byKey } = byDepth(p);
    computeStyles(levels);

    for (const level of levels) for (const n of level) {
        const parent = byKey.get(n.key.slice(0, n.key.lastIndexOf(".")));

        if (n.nodeName === "meta") {
            if (attr(n, "http-equiv") === "refresh") {
                const [delayF, urlF] = attr(n, "content").split(";");
                var delay = parseInt(delayF);
                var url = urlF.split("=")[1];

            }
        }

        n.layout = {
            w: parent ? Math.max(0, parent.layout.w - 2 * pad(parent)) : width,
            x: 0, y: 0, h: 0,
        };
    }

    for (const level of [...levels].reverse()) for (const n of level) {
        if (n.nodeName === "#text") {
            const text = n.value.trim();
            if (n.hidden || !text) {
                n.lines = [];
                n.layout.h = 0;
                continue;
            }
            const scale = textScale(n);
            n.lines = font.wrapText(text, n.layout.w / scale);
            n.layout.h = n.lines.length * font.lineHeight * scale;
        } else if (inputLike.includes(n.nodeName)) {
            if (n.hidden) { n.layout.h = 0; continue; }
            if (!(n.key in inputValues)) {
                inputValues[n.key] = n.nodeName === "textarea"
                    ? (n.childNodes?.[0]?.value ?? "")
                    : (attr(n, "value") ?? "");
            }
            const scale = textScale(n);
            const rows = n.nodeName === "textarea" ? 4 : 1;
            const bw = parseSize(n.computedStyle.borderWidth);
            n.layout.h = rows * font.lineHeight * scale + 2 * (pad(n) + bw);
        } else if (n.hidden) {
            n.layout.h = 0;
        } else {
            n.layout.h = (n.childNodes ?? []).reduce((sum, c) => sum + c.layout.h, 0) + 2 * pad(n);
        }
    }

    for (const level of levels) for (const n of level) {
        const p = pad(n);
        let y = n.layout.y + p;
        for (const c of n.childNodes ?? []) {
            c.layout.x = n.layout.x + p;
            c.layout.y = y;
            y += c.layout.h;
        }
    }

    return levels;
}

const DEBUG = true;

const boxOf = (n, originY = 50, scrollY = 0) => ({
    x: n.layout.x,
    y: originY + n.layout.y - scrollY,
    w: n.layout.w,
    h: n.layout.h,
});

const isBoxNode = n =>
    !n.hidden && n.layout && n.layout.h > 0 &&
    (n.nodeName === "#text" ? n.lines?.length : !n.nodeName.startsWith("#"));

let hovered = null;

function updateHover(mx, my) {
    hovered = null;
    if (my < 50) return;
    for (const level of levels) for (const n of level) {
        if (!isBoxNode(n)) continue;
        const b = boxOf(n, 50, scrollY);
        if (mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + b.h) hovered = n;
    }
}

function paintDebug(originY = 50) {
    for (const level of levels) for (const n of level) {
        if (!isBoxNode(n)) continue;
        const { x, y, w, h } = boxOf(n, originY, scrollY);

        if (n.nodeName === "#text") {
            ShapeDrawer.strokeRect(canvas, x, y, w, h, 1, 0, 170, 0, 255);
            continue;
        }

        ShapeDrawer.strokeRect(canvas, x, y, w, h, 1, 255, 0, 0, 255);

        const p = pad(n);
        if (p > 0) {
            ShapeDrawer.strokeRect(canvas, x + p, y + p, w - 2 * p, h - 2 * p, 1, 0, 100, 255, 255);
        }
    }

    if (hovered) {
        const { x, y, w, h } = boxOf(hovered, originY, scrollY);
        ShapeDrawer.strokeRect(canvas, x, y, w, h, 3, 255, 200, 0, 255);

        const l = hovered.layout;
        const name = hovered.nodeName === "#text"
            ? `#text "${hovered.value.trim().slice(0, 12)}"`
            : hovered.nodeName;
        const info = `${name} x=${l.x} y=${l.y} w=${l.w} h=${l.h} pad=${pad(hovered)} focused=${hovered.focused}`;

        ShapeDrawer.fillRect(canvas, 0, height - 20, width, 20, 0, 0, 0, 255);
        font.drawText(canvas, info, 4, height - 18, { r: 255, g: 255, b: 255, a: 255 }, 0.5);
    }
}

function dumpLayout(n = doc, indent = 0) {
    if (!n?.layout || n.hidden) return;
    if (n.nodeName === "#text" && !n.lines?.length) return;

    const l = n.layout;
    const label = n.nodeName === "#text"
        ? `#text "${n.value.trim().slice(0, 20)}" lines=${n.lines.length}`
        : n.nodeName;
    // console.log(`${"  ".repeat(indent)}${label}  x=${l.x} y=${l.y} w=${l.w} h=${l.h} pad=${pad(n)}`);

    for (const c of n.childNodes ?? []) dumpLayout(c, indent + 1);
}

function paint(levels, scrollY = 0, originY = 50) {
    for (const level of levels) for (const n of level) {
        if (n.hidden || !n.layout?.h) continue;

        const isText = n.nodeName === "#text";
        if (!isText && n.nodeName.startsWith("#")) continue;

        const { x, w, h } = n.layout;
        const py = originY + n.layout.y - scrollY;
        if (py + h < originY || py > height) continue;

        if (isText) {
            if (!n.lines?.length) continue;
            const scale = textScale(n);
            const [r, g, b, a] = n.parentNode.computedStyle.color;

            n.lines.forEach((line, i) => {
                font.drawText(canvas, line, x, py + i * font.lineHeight * scale,
                              { r, g, b, a }, scale);
            });
            continue;
        }

        const st = n.computedStyle;
        const fill   = parseColor(st.backgroundColor);
        const bw     = parseSize(st.borderWidth);
        const border = parseColor(n === focusedBox ? "#09f" : st.borderColor);

        if (fill) ShapeDrawer.fillRect(canvas, x, py, w, h, ...fill);
        if (border && bw > 0) ShapeDrawer.strokeRect(canvas, x, py, w, h, bw, ...border);

        if (inputLike.includes(n.nodeName)) {
            const [r, g, b, a] = st.color;
            const off = pad(n) + bw;
            const scale = textScale(n);
            const lh = font.lineHeight * scale;
            const text = inputValues[n.key] ?? "";

            if (n === focusedBox && isEditable(n) && Math.floor(performance.now() / 500) % 2 === 0) {
                const before = text.slice(0, cursorOf(n)).split("\n");
                const row = before.length - 1;
                const col = before[row].length;
                const cw = font.config.cellWidth * scale;

                ShapeDrawer.fillRect(canvas, x + off + col * cw, py + off + row * lh, 2, lh, r, g, b, a);
            }

            text.split("\n").forEach((line, i) =>
                font.drawText(canvas, line, x + off, py + off + i * lh, { r, g, b, a }, scale));
        }
    }
}

function renderHTML(code) {
    unfocusPrev();
    inputValues = {};
    doc = parse(code, { scriptingEnabled: false });
    levels = width ? generateLevels(doc) : [];
}

let currentURL = "";
let loadId = 0;

const history = [];
let histIndex = -1;

function navigate(url) {
    if (history[histIndex]) history[histIndex].scrollY = scrollY;
    history.splice(histIndex + 1);
    history.push({ url, scrollY: 0 });
    histIndex = history.length - 1;
    renderURL(url);
}

function go(delta) {
    const i = histIndex + delta;
    if (i < 0 || i >= history.length) return;
    history[histIndex].scrollY = scrollY;
    histIndex = i;
    renderURL(history[i].url, history[i].scrollY);
}

let loading = false;

async function renderURL(url, restoreScroll = 0, init) {
    const id = ++loadId;
    clearTimeout(refreshTimer);
    loading = true;
    input.value = url;
    try {
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        if (id !== loadId) return;
        currentURL = res.url;
        input.value = res.url;
        if (history[histIndex]) history[histIndex].url = res.url;
        renderHTML(html);
        scrollY = restoreScroll;
        scheduleRefresh(id);
    } catch (err) {
        if (id !== loadId) return;
        console.error("Failed to load", url, err.message);
        input.value = url;
        scrollY = 0;
        renderHTML(`<h1>Error</h1><p>${String(err.message).replace(/</g, "&lt;")}</p>`);
    } finally {
        if (id === loadId) loading = false;
    }
}

function drawSpinner(cx, cy, r) {
    const DOTS = 8;
    const head = Math.floor(performance.now() / 90) % DOTS;

    for (let i = 0; i < DOTS; i++) {
        const angle = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        const age = (head - i + DOTS) % DOTS;
        const v = 255 - age * 28;
        ShapeDrawer.fillRect(canvas, x - 2, y - 2, 4, 4, v, v, v, 255);
    }
}

function linkAt(mx, my) {
    let hit = null;
    for (const level of levels) for (const n of level) {
        if (!isBoxNode(n)) continue;
        const b = boxOf(n, 50, scrollY);

        let w = b.w;
        if (n.nodeName === "#text") {
            const cw = font.config.cellWidth * textScale(n);
            w = Math.min(w, Math.max(...n.lines.map(l => l.length)) * cw);
        }
        if (mx >= b.x && mx < b.x + w && my >= b.y && my < b.y + b.h) hit = n;
    }
    for (let o = hit; o; o = o.parentNode) {
        if (o.nodeName === "a" && attr(o, "href") != null) return o;
    }
    return null;
}

function resolveHref(href) {
    try {
        const u = new URL(href, currentURL);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;  // javascript:, mailto:, etc.
        return u.href;
    } catch { return null; }
}

renderURL("https://lite.duckduckgo.com/lite/");
// navigate("https://google.com");

// renderHTML(`<input style="border-color: red; border-width: 4px; background-color: #ffd">`);

function getSize() {
    return [renderer.getScreenWidth(), renderer.getScreenHeight()];
}

function checkResize() {
    const [w, h] = getSize();
    if (w === width && h === height) return;
    width = w;
    height = h;

    canvas.destroy();
    canvas = new PixelBuffer(renderer, width, height);

    for (const b of boxes) b.updateSize();

    if (doc) levels = generateLevels(doc);
}

renderer.onRender(() => {
    checkResize();
    canvas.clear(255, 255, 255, 255);

    content.draw();
    paint(levels, scrollY);
    paintScrollbar();
    // if (DEBUG) paintDebug();
    topBar.draw();
    backButton.draw();
    forwardsButton.draw();
    input.draw();
    if (loading) drawSpinner(width - 25, 25, 8);

    canvas.upload();
    canvas.draw(0, 0);
});

function setCursorFromXY(box, lx, ly) {
    const scale = textScale(box);
    const off = pad(box) + parseSize(box.computedStyle.borderWidth);
    const row = Math.floor((ly - off) / (font.lineHeight * scale));
    const col = Math.round((lx - off) / (font.config.cellWidth * scale));

    const lines = val(box).split("\n");
    const r = Math.max(0, Math.min(row, lines.length - 1));

    let idx = 0;
    for (let i = 0; i < r; i++) idx += lines[i].length + 1;
    box.cursor = idx + Math.max(0, Math.min(col, lines[r].length));
}

function hitAt(mx, my) {
    let hit = null;
    for (const level of levels) for (const n of level) {
        if (!isBoxNode(n)) continue;
        const b = boxOf(n, 50, scrollY);
        let w = b.w;
        if (n.nodeName === "#text") {
            const cw = font.config.cellWidth * textScale(n);
            w = Math.min(w, Math.max(...n.lines.map(l => l.length)) * cw);
        }
        if (mx >= b.x && mx < b.x + w && my >= b.y && my < b.y + b.h) hit = n;
    }
    return hit;
}
const closest = (n, test) => {
    for (let o = n; o; o = o.parentNode) if (test(o)) return o;
    return null;
};

function isSubmit(n) {
    if (n.nodeName === "button") return (attr(n, "type") ?? "submit").toLowerCase() === "submit";
    if (n.nodeName === "input")  return ["submit", "image"].includes((attr(n, "type") ?? "").toLowerCase());
    return false;
}

const formFor = n => closest(n, o => o.nodeName === "form");

function collectFields(form, submitter) {
    const out = [];
    const walk = n => {
        for (const c of n.childNodes ?? []) {
            const name = attr(c, "name");
            if (name && (c.nodeName === "input" || c.nodeName === "textarea")) {
                const type = (attr(c, "type") ?? "text").toLowerCase();
                if (c.nodeName === "textarea" || TEXT_TYPES.has(type)) {
                    out.push([name, inputValues[c.key] ?? attr(c, "value") ?? ""]);
                } else if (type === "hidden") {
                    out.push([name, attr(c, "value") ?? ""]);
                }
                // checkboxes/radios are skipped until they can be toggled
            }
            walk(c);
        }
    };
    walk(form);
    const sn = submitter && attr(submitter, "name");
    if (sn) out.push([sn, attr(submitter, "value") ?? ""]);
    return out;
}

function submitForm(form, submitter) {
    const method = (attr(form, "method") ?? "get").toLowerCase();
    let action;
    try { action = new URL(attr(form, "action") || currentURL, currentURL); } catch { return; }
    if (action.protocol !== "http:" && action.protocol !== "https:") return;

    const params = new URLSearchParams(collectFields(form, submitter));

    if (method === "post") {
        if (history[histIndex]) history[histIndex].scrollY = scrollY;
        history.splice(histIndex + 1);
        history.push({ url: action.href, scrollY: 0 });
        histIndex = history.length - 1;
        renderURL(action.href, 0, { method: "POST", body: params });
    } else {
        action.search = params.toString();
        navigate(action.href);
    }
}

function handleClick(mx, my) {
    if (my >= 50) {
    const hit = hitAt(mx, my);

    const submitter = closest(hit, isSubmit);
        if (submitter) {
            unfocusPrev();
            const form = formFor(submitter);
            if (form) submitForm(form, submitter);
            return;
        }

        const field = closest(hit, o => inputLike.includes(o.nodeName));
        if (field) {
            if (field !== focusedBox) focus(field);
            if (isEditable(field)) {
                const { x, y } = boxOf(field, 50, scrollY);
                setCursorFromXY(field, mx - x, my - y);
            }
            return;
        }

        const link = closest(hit, o => o.nodeName === "a" && attr(o, "href") != null);
        if (link) {
            unfocusPrev();
            const href = attr(link, "href").trim();
            if (href.startsWith("#")) return;
            const target = resolveHref(href);
            if (target) navigate(target);
            return;
        }
    }

    for (let i = boxes.length - 1; i >= 0; i--) {
        if (boxes[i].contains(mx, my)) {
            if (!(boxes[i] instanceof Input)) unfocusPrev();
            boxes[i].onClick(mx, my);
            return;
        }
    }
    unfocusPrev();
}

function canEdit() {
    return focusedBox?.key && isEditable(focusedBox);
}

function handleTyping(ch) {
    if (!focusedBox?.key) return; 
    inputValues[focusedBox.key] += ch;
    if (focusedBox.nodeName === "textarea") levels = generateLevels(doc);
}

function listProps(obj) {
    const seen = new Set();
    for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
        for (const k of Object.getOwnPropertyNames(o)) {
            if (k !== "constructor") seen.add(k);
        }
    }
    return [...seen].sort();
}

const SHIFTED = ")!@#$%^&*(";
const shiftDown = () =>
    renderer.input.isKeyDown("Shift") || renderer.input.isKeyDown("RightShift");

function typeChar(ch) {
    if (!canEdit()) return;
    const b = focusedBox, v = val(b), c = cursorOf(b);
    inputValues[b.key] = v.slice(0, c) + ch + v.slice(c);
    b.cursor = c + ch.length;
}

for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    renderer.input.onKeyDown(c, () => typeChar(shiftDown() ? c : c.toLowerCase()));
}

const PUNCT = {
    ".": [".", ">"], ",": [",", "<"], "/": ["/", "?"], "-": ["-", "_"],
    "=": ["=", "+"], ";": [";", ":"], "'": ["'", '"'], "[": ["[", "{"],
    "]": ["]", "}"], "\\": ["\\", "|"], "`": ["`", "~"],
};

for (const [key, [plain, shifted]] of Object.entries(PUNCT)) {
    renderer.input.onKeyDown(key, () => typeChar(shiftDown() ? shifted : plain));
}

for (const d of "0123456789") {
    renderer.input.onKeyDown(d, () => typeChar(shiftDown() ? SHIFTED[+d] : d));
}



// "PageUp" / "PageDown" are my guess at the key names; check they fire.
renderer.input.onKeyDown("PageDown", () => { if (!canEdit()) scrollBy(pageStep()); });
renderer.input.onKeyDown("PageUp",   () => { if (!canEdit()) scrollBy(-pageStep()); });
 
renderer.input.onKeyDown("Space", () => {
    if (!canEdit()) { scrollBy(shiftDown() ? -pageStep() : pageStep()); return; }
    typeChar(" ");
});
 
renderer.input.onKeyDown("Home", () => {
    if (!canEdit()) { scrollBy(-Infinity); return; }
    focusedBox.cursor = lineStart(val(focusedBox), cursorOf(focusedBox));
});
 
renderer.input.onKeyDown("End", () => {
    if (!canEdit()) { scrollBy(Infinity); return; }
    focusedBox.cursor = lineEnd(val(focusedBox), cursorOf(focusedBox));
});
 
renderer.input.onKeyDown("ArrowUp", () => {
    if (!canEdit()) { scrollBy(-SCROLL_SPEED); return; }
    if (focusedBox.nodeName !== "textarea") return;
    const v = val(focusedBox), c = cursorOf(focusedBox), s = lineStart(v, c);
    if (s === 0) return;
    const col = c - s, ps = lineStart(v, s - 1);
    focusedBox.cursor = Math.min(ps + col, s - 1);
});
 
renderer.input.onKeyDown("ArrowDown", () => {
    if (!canEdit()) { scrollBy(SCROLL_SPEED); return; }
    if (focusedBox.nodeName !== "textarea") return;
    const v = val(focusedBox), c = cursorOf(focusedBox), e = lineEnd(v, c);
    if (e >= v.length) return;
    const col = c - lineStart(v, c), ne = lineEnd(v, e + 1);
    focusedBox.cursor = Math.min(e + 1 + col, ne);
});
 


// renderer.input.onKeyDown("Space", () => {
//     if (!isEditable(focusedBox)) return;
//     typeChar(" ")
// });

renderer.input.onKeyDown("Backspace", () => {
    if (!canEdit()) return;
    const b = focusedBox, v = val(b), c = cursorOf(b);
    if (c === 0) return;
    inputValues[b.key] = v.slice(0, c - 1) + v.slice(c);
    b.cursor = c - 1;
});

renderer.input.onKeyDown("Delete", () => {
    if (!canEdit()) return;
    const b = focusedBox, v = val(b), c = cursorOf(b);
    inputValues[b.key] = v.slice(0, c) + v.slice(c + 1);
});

renderer.input.onKeyDown("ArrowLeft",  () => { if (canEdit()) focusedBox.cursor = Math.max(0, cursorOf(focusedBox) - 1); });
renderer.input.onKeyDown("ArrowRight", () => { if (canEdit()) focusedBox.cursor = Math.min(val(focusedBox).length, cursorOf(focusedBox) + 1); });

// renderer.input.onKeyDown("Home", () => { if (canEdit()) focusedBox.cursor = lineStart(val(focusedBox), cursorOf(focusedBox)); });
// renderer.input.onKeyDown("End",  () => { if (canEdit()) focusedBox.cursor = lineEnd(val(focusedBox), cursorOf(focusedBox)); });

// renderer.input.onKeyDown("ArrowUp", () => {
//     if (!canEdit() || focusedBox.nodeName !== "textarea") return;
//     const v = val(focusedBox), c = cursorOf(focusedBox), s = lineStart(v, c);
//     if (s === 0) return;
//     const col = c - s, ps = lineStart(v, s - 1);
//     focusedBox.cursor = Math.min(ps + col, s - 1);
// });

// renderer.input.onKeyDown("ArrowDown", () => {
//     if (!canEdit() || focusedBox.nodeName !== "textarea") return;
//     const v = val(focusedBox), c = cursorOf(focusedBox), e = lineEnd(v, c);
//     if (e >= v.length) return;
//     const col = c - lineStart(v, c), ne = lineEnd(v, e + 1);
//     focusedBox.cursor = Math.min(e + 1 + col, ne);
// });

renderer.input.onKeyDown("Enter", () => {
    if (!canEdit()) return;
    if (focusedBox.nodeName === "textarea") { typeChar("\n"); return; }
    const form = formFor(focusedBox);
    if (form) submitForm(form, null);
});

function loop() {
    renderer.input.GetInput();

    const { x: mx, y: my } = renderer.input.getMousePosition();
    if (DEBUG) updateHover(mx, my);

    updateScroll(my);

    if (renderer.input.isMouseButtonPressed(0)) {
        if (DEBUG && my >= 50) dumpLayout();
        handleClick(mx, my);
    }

    if (renderer.step()) setImmediate(loop);
}

loop();