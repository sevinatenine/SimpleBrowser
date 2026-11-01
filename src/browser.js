import { ShapeDrawer } from "tessera.js";
import { renderer, state, inputLike, TEXT_TYPES, CHROME_H, SCROLL_SPEED, asset } from "./state.js";
import {
    attr, closest, parseSize, pad, isEditable, textScale, resolveHref,
    val, cursorOf, lineStart, lineEnd, scrollBy, viewportH,
    focus, unfocusPrev, boxOf, isBoxNode, renderHTML,
    inlineHit, linkOf
} from "./engine.js";
import { Box, Button, Input, ImageButton } from "./ui.js";
import { font } from "./state.js";
import path from "path";
import fs from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import os from "os";

function normalizeInput(url) {
    url = url.trim();

    if (/^(\/|~(\/|$)|[A-Za-z]:[\\/])/.test(url)) {
        return pathToFileURL(url.replace(/^~/, os.homedir())).href;
    }

    const m = /^file:\/\/(?!\/|localhost\/)(.*)$/i.exec(url);
    if (m) return pathToFileURL("/" + m[1]).href;

    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return "https://" + url;

    return url;
}

export const DEBUG = true;

const CURSOR_IDS = {
    default: 0, auto: 0, pointer: 4, text: 2, crosshair: 3,
    move: 9, "all-scroll": 9, "not-allowed": 10,
    "ew-resize": 5, "col-resize": 5, "ns-resize": 6, "row-resize": 6,
    "nwse-resize": 7, "nesw-resize": 8,
};


const SPRITES = {
    arrow: { hot: [0, 0], rows: [
        "#..........",
        "##.........",
        "#o#........",
        "#oo#.......",
        "#ooo#......",
        "#oooo#.....",
        "#ooooo#....",
        "#oooooo#...",
        "#ooooooo#..",
        "#oooo#####.",
        "#oo#oo#....",
        "#o#.#oo#...",
        "##..#oo#...",
        "#....#oo#..",
        ".....#oo#..",
        "......##...",
    ]},
    hand: { hot: [5, 0], rows: [
        "....##.......",
        "...#oo#......",
        "...#oo#......",
        "...#oo#......",
        "...#oo#.##...",
        "...#oo##oo##.",
        "##.#oooooooo#",
        "#oo#oooooooo#",
        ".#oooooooooo#",
        "..#ooooooooo#",
        "..#ooooooooo#",
        "...#oooooooo#",
        "...#oooooo##.",
        "....#oooooo#.",
        "....########.",
    ]},
};

let currentCursor = "default";
let mouseX = 0, mouseY = 0;

let sawCursorEvents = false;
let mouseMoved = false;
let lastMX = -1, lastMY = -1;

function drawSprite(sp, x, y) {
    const [hx, hy] = sp.hot;
    sp.rows.forEach((row, j) => {
        for (let i = 0; i < row.length; ) {
            const ch = row[i];
            let k = i;
            while (k < row.length && row[k] === ch) k++;
            if (ch !== ".") {
                const v = ch === "#" ? 0 : 255;
                ShapeDrawer.fillRect(state.canvas, x - hx + i, y - hy + j, k - i, 1, v, v, v, 255);
            }
            i = k;
        }
    });
}

export function drawCursor() {
    if (!cursorVisible()) return;
    const canvas = state.canvas;
    const x = Math.round(mouseX), y = Math.round(mouseY);

    switch (currentCursor) {
        case "pointer":
            drawSprite(SPRITES.hand, x, y);
            break;
        case "text": // I-beam, white outline then black
            ShapeDrawer.fillRect(canvas, x - 3, y - 9, 7, 3, 255, 255, 255, 255);
            ShapeDrawer.fillRect(canvas, x - 1, y - 9, 3, 18, 255, 255, 255, 255);
            ShapeDrawer.fillRect(canvas, x - 3, y + 6, 7, 3, 255, 255, 255, 255);
            ShapeDrawer.fillRect(canvas, x - 2, y - 8, 5, 1, 0, 0, 0, 255);
            ShapeDrawer.fillRect(canvas, x,     y - 8, 1, 16, 0, 0, 0, 255);
            ShapeDrawer.fillRect(canvas, x - 2, y + 7, 5, 1, 0, 0, 0, 255);
            break;
        case "crosshair":
            ShapeDrawer.fillRect(canvas, x - 6, y - 1, 13, 3, 255, 255, 255, 255);
            ShapeDrawer.fillRect(canvas, x - 1, y - 6, 3, 13, 255, 255, 255, 255);
            ShapeDrawer.fillRect(canvas, x - 5, y, 11, 1, 0, 0, 0, 255);
            ShapeDrawer.fillRect(canvas, x, y - 5, 1, 11, 0, 0, 0, 255);
            break;
        default:
            drawSprite(SPRITES.arrow, x, y);
    }
}

function cursorAt(mx, my) {
    if (my < CHROME_H) {
        for (let i = boxes.length - 1; i >= 0; i--) {
            const b = boxes[i];
            if (!b.contains(mx, my)) continue;
            if (typeof b.enabled === "function") return b.enabled() ? "pointer" : "default";
            if (b instanceof Input) return "text";
            break;
        }
        return "default";
    }

    if (linkAtPoint(mx, my)) return "pointer";

    const it = inlineHit(state.levels, mx, my - CHROME_H + state.scrollY);
    if (it) {
        const el = it.node.parentNode;
        for (const name of (el.computedStyle?.cursor ?? "auto").split(",").map(s => s.trim())) {
            if (name !== "auto" && name in CURSOR_IDS) return name;
        }
        return "text";
    }

    const n = hitAt(mx, my);
    if (!n) return "default";

    const el = n.nodeName === "#text" ? n.parentNode : n;
    for (const name of (el.computedStyle?.cursor ?? "auto").split(",").map(s => s.trim())) {
        if (name !== "auto" && name in CURSOR_IDS) return name;
    }
    if (closest(n, o => isEditable(o))) return "text";
    return "default";
}

export function updateCursor(mx, my) {
    if (mx !== lastMX || my !== lastMY) {
        if (lastMX !== -1) mouseMoved = true;
        lastMX = mx; lastMY = my;
    }
    mouseX = mx; mouseY = my;
    currentCursor = cursorAt(mx, my);
}

function cursorVisible() {
    const on = renderer.isCursorOnScreen?.() ?? true;
    if (on) sawCursorEvents = true;

    return sawCursorEvents ? on : mouseMoved;
}

export function updateScroll(my) {
    const wheel = renderer.input.getMouseWheelDelta();
    const dy = typeof wheel === "number" ? wheel : (wheel?.y ?? 0);
    if (dy && my >= CHROME_H) scrollBy(-dy * SCROLL_SPEED);
    scrollBy(0);
}

const pageStep = () => Math.max(40, viewportH() - 40);

export function updateHover(mx, my) {
    state.hovered = null;
    if (my < 50) return;
    for (const level of state.levels) for (const n of level) {
        if (!isBoxNode(n)) continue;
        const b = boxOf(n, 50, state.scrollY);
        if (mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + b.h) state.hovered = n;
    }

    const a = linkAtPoint(mx, my);
    if (a) state.hovered = a;

    const it = inlineHit(state.levels, mx, my - CHROME_H + state.scrollY);
    if (it) state.hovered = linkOf(it) ?? it.node.parentNode;
}

function linkAtPoint(mx, my) {
    const it = inlineHit(state.levels, mx, my - CHROME_H + state.scrollY);
    const a = it ? linkOf(it) : null;
    if (a && attr(a, "href") != null) return a;

    const hit = hitAt(mx, my);
    return (hit && closest(hit, o => o.nodeName === "a" && attr(o, "href") != null)) || null;
}

export function dumpLayout(n = state.doc, indent = 0) {
    if (!n?.layout || n.hidden) return;
    if (n.nodeName === "#text" && !n.lines?.length) return;

    const l = n.layout;
    const label = n.nodeName === "#text"
        ? `#text "${n.value.trim().slice(0, 20)}" lines=${n.lines.length}`
        : n.nodeName;

    for (const c of n.childNodes ?? []) dumpLayout(c, indent + 1);
}

function hitAt(mx, my) {
    let hit = null;
    for (const level of state.levels) for (const n of level) {
        if (!isBoxNode(n)) continue;
        const b = boxOf(n, 50, state.scrollY);
        let w = b.w;
        if (n.nodeName === "#text") {
            const cw = font.config.cellWidth * textScale(n);
            w = Math.min(w, Math.max(...n.lines.map(l => l.length)) * cw);
        }
        if (mx >= b.x && mx < b.x + w && my >= b.y && my < b.y + b.h) hit = n;
    }
    return hit;
}

const history = [];
let histIndex = -1;

let refreshTimer = null;
let refreshHops = 0;
const MAX_REFRESH_HOPS = 5;

function parseRefresh(content) {
    const m = /^\s*(\d+)?\s*(?:[;,\s]\s*(?:url\s*=\s*)?(['"]?)(.*?)\2)?\s*$/i.exec(content ?? "");
    if (!m) return null;
    return { delay: parseInt(m[1] ?? "0", 10), url: m[3] || null };
}

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

function updateWindowTitle(title) {
    renderer.setWindowTitle(title);
}

function findTitle(n) {
    if (n.nodeName === "title") {
        return (n.childNodes ?? []).map(c => c.value ?? "").join("");
    }
    for (const c of n.childNodes ?? []) {
        const t = findTitle(c);
        if (t) return t;
    }
    return null;
}

function setTitleFor(fallback) {
    const t = (findTitle(state.doc) ?? "").replace(/\s+/g, " ").trim();
    renderer.setWindowTitle(t || fallback);
}

function scheduleRefresh(id) {
    clearTimeout(refreshTimer);
    const r = findRefresh(state.doc);
    if (!r) return;

    const target = r.url ? resolveHref(r.url) : state.currentURL;
    if (!target) return;
    if (target === state.currentURL && r.delay === 0) return;

    const redirecting = target !== state.currentURL;
    if (redirecting && refreshHops >= MAX_REFRESH_HOPS) return;

    refreshTimer = setTimeout(() => {
        if (id !== state.loadId) return;
        if (redirecting) refreshHops++;
        if (history[histIndex]) history[histIndex].url = target;
        renderURL(target);
    }, r.delay * 1000);
}

export function navigate(url) {
    state.browserHistory.push({ time: Date.now(), url: url});

    if (history[histIndex]) history[histIndex].scrollY = state.scrollY;
    history.splice(histIndex + 1);
    history.push({ url, scrollY: 0 });
    histIndex = history.length - 1;
    renderURL(url);
}

function go(delta) {
    const i = histIndex + delta;
    if (i < 0 || i >= history.length) return;
    history[histIndex].scrollY = state.scrollY;
    histIndex = i;

    state.browserHistory.push({ time: Date.now(), url: history[i].url});

    renderURL(history[i].url, history[i].scrollY);
}

const SIMPLE_DIR = fileURLToPath(new URL("./simple_pages/", import.meta.url));

function renderSimple(name, args = {}) {
    try {
        var html = fs.readFileSync(path.join(SIMPLE_DIR, `${name}.html`), "utf8");

        html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
                return key in args ? args[key] : match;
            });
        
        renderHTML(html);
    } catch (e) {
        console.error(`Failed to render simple: ${name}`);
        if (name !== "invalidSimple") renderSimple("invalidSimple");
    }
}

const formatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

function handleSimpleUrl(url) {
    const name = url.hostname || url.pathname.replace(/^\/+/, "");

    var args = {};

    if (name == "history") {
        args["history"] = [...state.browserHistory].reverse().map(e => `<li>${formatter.format(new Date(e.time))} - ${e.url}</l>`).join("");
    }

    renderSimple(/^[\w-]+$/.test(name) ? name : "invalidSimple", args);
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function loadFile(parsed) {
    const p = fileURLToPath(parsed);
    const stat = await fs.promises.stat(p);

    if (stat.isDirectory()) {
        const base = parsed.href.endsWith("/") ? parsed.href : parsed.href + "/";

        const entries = await fs.promises.readdir(p, { withFileTypes: true });
        const items = entries.map(d => {
            const slash = d.isDirectory() ? "/" : "";
            return `<div><a href="${base}${encodeURIComponent(d.name)}${slash}">${esc(d.name)}${slash}</a></div>`;
        }).join("");
        return {
            url: base,
            html: `<h1>${esc(p)}</h1><div><a href="${new URL("..", base).href}">..</a></div>${items}`,
        };
    }

    const text = await fs.promises.readFile(p, "utf8");
    const isHtml = /\.(x?html?)$/i.test(p);
    return { url: parsed.href, html: isHtml ? text : `<pre>${esc(text)}</pre>` };
}

export async function renderURL(url, restoreScroll = 0, init) {
    const id = ++state.loadId;
    clearTimeout(refreshTimer);
    state.loading = true;
    url = normalizeInput(url);
    input.value = url;

    const parsed = URL.parse(url);

    if (parsed?.protocol === "simple:") {
        state.currentURL = url;
        if (history[histIndex]) history[histIndex].url = url;
        handleSimpleUrl(parsed);
        state.scrollY = restoreScroll;
        setTitleFor(url);
        state.loading = false;
        return;
    }

    try {
        let html, finalUrl;

        if (parsed?.protocol === "file:") {
            ({ html, url: finalUrl } = await loadFile(parsed));
        } else {
            const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            html = await res.text();
            finalUrl = res.url;
        }

        if (id !== state.loadId) return;
        state.currentURL = finalUrl;
        input.value = finalUrl;
        if (history[histIndex]) history[histIndex].url = finalUrl;
        renderHTML(html);
        state.scrollY = restoreScroll;
        setTitleFor(finalUrl);
        scheduleRefresh(id);
    } catch (err) {
        if (id !== state.loadId) return;
        console.error("Failed to load", url, err.stack);
        input.value = url;
        state.scrollY = 0;
        renderHTML(`<h1>Error</h1><p>${String(err.message).replace(/</g, "&lt;")}</p>`);
        setTitleFor("Error");
    } finally {
        if (id === state.loadId) state.loading = false;
    }
}

export const topBar = new Box(0, 0, p => p.w, 50, null, { backgroundColor: "#333", borderColor: "#888" });
export const backButton = new ImageButton(10, 10, 30, 30, topBar, { color: "black", backgroundColor: "white", borderColor: "black", borderWidth: "1px" },
    asset("icons/backwards.png"), () => go(-1), () => histIndex > 0);
export const forwardsButton = new ImageButton(50, 10, 30, 30, topBar, { color: "black", backgroundColor: "white", borderColor: "black", borderWidth: "1px" },
    asset("icons/forwards.png"), () => go(1), () => histIndex < history.length - 1);
export const reloadButton = new ImageButton(90, 10, 30, 30, topBar, { color: "black", backgroundColor: "white", borderColor: "black", borderWidth: "1px" },
    asset("icons/reload.png"), () => {
        go(0);
        state.scrollY = 0;
    }, () => true);

export const input = new Input(130, 10, p => p.w - 180, 32, topBar, { backgroundColor: "white", borderColor: "black", borderWidth: "2px" }, "Loading...", () => {
    navigate(input.value);
});
export const content = new Box(0, 50, p => p.w, p => p.h - 50, null, { backgroundColor: "#eee" });

export const boxes = [topBar, backButton, reloadButton, forwardsButton, input, content];

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
                    out.push([name, state.inputValues[c.key] ?? attr(c, "value") ?? ""]);
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
    try { action = new URL(attr(form, "action") || state.currentURL, state.currentURL); } catch { return; }
    if (action.protocol !== "http:" && action.protocol !== "https:") return;

    const params = new URLSearchParams(collectFields(form, submitter));

    if (method === "post") {
        if (history[histIndex]) history[histIndex].scrollY = state.scrollY;
        history.splice(histIndex + 1);
        history.push({ url: action.href, scrollY: 0 });
        histIndex = history.length - 1;
        renderURL(action.href, 0, { method: "POST", body: params });
    } else {
        action.search = params.toString();
        navigate(action.href);
    }
}

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

export function handleClick(mx, my) {
    if (my >= 50) {
        const link = linkAtPoint(mx, my);
        if (link) {
            unfocusPrev();
            const href = attr(link, "href").trim();
            if (href.startsWith("#")) return;
            const target = resolveHref(href);
            if (target) navigate(target);
            return;
        }

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
            if (field !== state.focusedBox) focus(field);
            if (isEditable(field)) {
                const { x, y } = boxOf(field, 50, state.scrollY);
                setCursorFromXY(field, mx - x, my - y);
            }
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
    return state.focusedBox?.key && isEditable(state.focusedBox);
}

const SHIFTED = ")!@#$%^&*(";
const shiftDown = () =>
    renderer.input.isKeyDown("Shift") || renderer.input.isKeyDown("RightShift");

function typeChar(ch) {
    if (state.focusedBox instanceof Input) {
        state.focusedBox.insert(ch);
        return;
    }
    if (!canEdit()) return;
    const b = state.focusedBox, v = val(b), c = cursorOf(b);
    state.inputValues[b.key] = v.slice(0, c) + ch + v.slice(c);
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

renderer.input.onKeyDown("PageDown", () => { if (!canEdit()) scrollBy(pageStep()); });
renderer.input.onKeyDown("PageUp",   () => { if (!canEdit()) scrollBy(-pageStep()); });

renderer.input.onKeyDown("Space", () => {
    if (state.focusedBox instanceof Input) {
        state.focusedBox.insert(" ");
        return;
    }

    if (!canEdit()) { scrollBy(shiftDown() ? -pageStep() : pageStep()); return; }
    typeChar(" ");
});

renderer.input.onKeyDown("Home", () => {
    if (!canEdit()) { scrollBy(-Infinity); return; }
    state.focusedBox.cursor = lineStart(val(state.focusedBox), cursorOf(state.focusedBox));
});

renderer.input.onKeyDown("End", () => {
    if (!canEdit()) { scrollBy(Infinity); return; }
    state.focusedBox.cursor = lineEnd(val(state.focusedBox), cursorOf(state.focusedBox));
});

renderer.input.onKeyDown("ArrowUp", () => {
    if (!canEdit()) { scrollBy(-SCROLL_SPEED); return; }
    if (state.focusedBox.nodeName !== "textarea") return;
    const v = val(state.focusedBox), c = cursorOf(state.focusedBox), s = lineStart(v, c);
    if (s === 0) return;
    const col = c - s, ps = lineStart(v, s - 1);
    state.focusedBox.cursor = Math.min(ps + col, s - 1);
});

renderer.input.onKeyDown("ArrowDown", () => {
    if (!canEdit()) { scrollBy(SCROLL_SPEED); return; }
    if (state.focusedBox.nodeName !== "textarea") return;
    const v = val(state.focusedBox), c = cursorOf(state.focusedBox), e = lineEnd(v, c);
    if (e >= v.length) return;
    const col = c - lineStart(v, c), ne = lineEnd(v, e + 1);
    state.focusedBox.cursor = Math.min(e + 1 + col, ne);
});

renderer.input.onKeyDown("Backspace", () => {
    if (state.focusedBox instanceof Input) {
        state.focusedBox.backspace();
        return;
    }
    if (!canEdit()) return;
    const b = state.focusedBox, v = val(b), c = cursorOf(b);
    if (c === 0) return;
    state.inputValues[b.key] = v.slice(0, c - 1) + v.slice(c);
    b.cursor = c - 1;
});

renderer.input.onKeyDown("Delete", () => {
    if (state.focusedBox instanceof Input) {
        state.focusedBox.backspace();
        return;
    }
    if (!canEdit()) return;
    const b = state.focusedBox, v = val(b), c = cursorOf(b);
    state.inputValues[b.key] = v.slice(0, c) + v.slice(c + 1);
});

renderer.input.onKeyDown("ArrowLeft",  () => { 
    if (state.focusedBox instanceof Input) {
        state.focusedBox.left();
        return;
    }

    if (canEdit()) state.focusedBox.cursor = Math.max(0, cursorOf(state.focusedBox) - 1); 
});
renderer.input.onKeyDown("ArrowRight", () => {
    if (state.focusedBox instanceof Input) {
        state.focusedBox.right();
        return;
    }

    if (canEdit()) state.focusedBox.cursor = Math.min(val(state.focusedBox).length, cursorOf(state.focusedBox) + 1); 
});

renderer.input.onKeyDown("Enter", () => {
    if (state.focusedBox instanceof Input) {
        if (state.focusedBox.submit) state.focusedBox.submit();
        return;
    }

    if (!canEdit()) return;
    if (state.focusedBox.nodeName === "textarea") { typeChar("\n"); return; }
    const form = formFor(state.focusedBox);
    if (form) submitForm(form, null);
});