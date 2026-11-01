import { ShapeDrawer, drawAtlasRegionToCanvas } from "tessera.js";
import { font, state, inputLike, CHROME_H, renderer } from "./state.js";
import {
    parseColor, parseSize, pad, textScale, cursorOf, boxOf, isBoxNode, isEditable,
    focus, maxScroll, viewportH, pageH,
} from "./engine.js";

export class Box {
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
        const p = this.relativeTo ?? { x: 0, y: 0, w: state.width, h: state.height };
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

        if (fill) ShapeDrawer.fillRect(state.canvas, this.x, this.y, this.w, this.h, ...fill);
        if (border && bw > 0) ShapeDrawer.strokeRect(state.canvas, this.x, this.y, this.w, this.h, bw, ...border);
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

export class Button extends Box {
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
        font.drawText(state.canvas, this.value,
            this.x + (this.w - this.value.length * cw) / 2,
            this.y + (this.h - lh) / 2, c, scale);
    }
}

export class ImageButton extends Box {
    constructor(x, y, iW, iH, relativeTo, style, src, callback, enabled = () => true) {
        super(x, y, 0, 0, relativeTo, style);
        const bw = this.style.borderColor ? parseSize(this.style.borderWidth) || 0 : 0;
        this.defs.w = iW + 2 * bw;
        this.defs.h = iH + 2 * bw;
        this.bw = bw;
        this.iW = iW;
        this.iH = iH;
        this.src = src;
        this.callback = callback;
        this.enabled = enabled;
        this.image = renderer.loadImage(this.src);
    }

    onClick() { if (this.enabled()) this.callback(); }

    draw() {
        const bw = this.bw;
        const border = parseColor(this.style.borderColor);
        const fill = parseColor(this.style.backgroundColor);

        if (border && bw > 0) {
            ShapeDrawer.fillRect(state.canvas, this.x, this.y, this.w, this.h, ...border);
            if (fill) ShapeDrawer.fillRect(state.canvas, this.x + bw, this.y + bw, this.iW, this.iH, ...fill);
        } else if (fill) {
            ShapeDrawer.fillRect(state.canvas, this.x, this.y, this.w, this.h, ...fill);
        }

        drawImage(this.image, this.x + bw, this.y + bw, this.iW, this.iH, 0);
    }
}

export class Input extends Box {
    constructor(x, y, w, h, relativeTo, style, value, submit) {
        super(x, y, w, h, relativeTo, style);
        this.value = value;
        this.cursorPos = 6;
        this.submit = submit;
    }

    onClick(mx, my) {
        this.focus();

        const bw = parseSize(this.style.borderWidth);
        const padX = 6;
        const cw = font.config.cellWidth * 0.5;

        const c = Math.round((mx - (this.x + bw + padX)) / cw);
        this.cursorPos = Math.max(0, Math.min(this.value.length, c));
    }
    
    onFocus() { this.style.borderColor = "#09f"; }
    onUnFocus() { this.style.borderColor = "black"; }

    draw() {
        super.draw();

        const bw = parseSize(this.style.borderWidth);
        const scale = 0.5;
        const padX = 6;
        const lh = font.lineHeight * scale;
        const cw = font.config.cellWidth * scale;

        const tx = this.x + bw + padX;
        const ty = this.y + (this.h + 4 - lh) / 2;

        const maxChars = Math.max(0, Math.floor((this.w - 2 * (bw + padX)) / cw));
        const text = this.value.slice(0, maxChars);

        font.drawText(state.canvas, text, tx, ty, { r: 0, g: 0, b: 0, a: 255 }, scale);

        if (this.focused && Math.floor(performance.now() / 500) % 2 === 0) {   // blink
            const pos = Math.min(this.cursorPos, text.length);
            ShapeDrawer.fillRect(state.canvas, tx + pos * cw, ty, 1, lh, 0, 0, 0, 255);
        }
    }

    insert(ch) {
        this.value = this.value.slice(0, this.cursorPos) + ch + this.value.slice(this.cursorPos);
        this.cursorPos += ch.length;
    }
    backspace() {
        if (this.cursorPos === 0) return;
        this.value = this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
        this.cursorPos--;
    }
    left()  { this.cursorPos = Math.max(0, this.cursorPos - 1); }
    right() { this.cursorPos = Math.min(this.value.length, this.cursorPos + 1); }
}

export function paintScrollbar() {
    const max = maxScroll();
    if (max <= 0) return;
    const track = viewportH();
    const thumbH = Math.max(24, track * track / pageH());
    const thumbY = CHROME_H + (state.scrollY / max) * (track - thumbH);
    ShapeDrawer.fillRect(state.canvas, state.width - 8, thumbY, 6, thumbH, 130, 130, 130, 255);
}

function drawImage(img, x, y, w, h, top) {
    const x0 = Math.round(Math.max(x, 0)),   x1 = Math.round(Math.min(x + w, state.width));
    const y0 = Math.round(Math.max(y, top)), y1 = Math.round(Math.min(y + h, state.height));
    if (x1 <= x0 || y1 <= y0) return;
    const sx = img.width / w, sy = img.height / h;
    drawAtlasRegionToCanvas(
        img,
        { x: (x0 - x) * sx, y: (y0 - y) * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy },
        state.canvas,
        { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        "bilinear"
    );
}

function measureFontWidth(f, s) {
    return s.length * f.config.cellWidth;
}

export function paint(levels, scrollY = 0, originY = 50) {
    for (const level of levels) for (const n of level) {
        if (n.hidden || !n.layout?.h) continue;
        if (n.nodeName.startsWith("#")) continue;

        const { x, w, h } = n.layout;
        const py = originY + n.layout.y - scrollY;
        if (py + h < originY || py > state.height) continue;

        const st = n.computedStyle;
        const fill   = parseColor(st.backgroundColor);
        const bw     = parseSize(st.borderWidth);
        const border = parseColor(n === state.focusedBox ? "#09f" : st.borderColor);

        if (fill) ShapeDrawer.fillRect(state.canvas, x, py, w, h, ...fill);
        if (border && bw > 0) ShapeDrawer.strokeRect(state.canvas, x, py, w, h, bw, ...border);

        if (n.inline) {
            for (const l of n.inline.lines) for (const it of l.items) {
                if (it.atomic || it.br || it.text === " ") continue;
                const iy = originY + it.absY - scrollY;
                if (iy + it.h < originY || iy > state.height) continue;
                const [r, g, b, a] = it.node.parentNode.computedStyle.color;
                font.drawText(state.canvas, it.text, it.absX, iy, { r, g, b, a }, it.scale);
            }
        }

        if (n.nodeName === "img" && n.entry?.img) drawImage(n.entry.img, x, py, w, h, originY);

        if (inputLike.includes(n.nodeName)) {
            const [r, g, b, a] = st.color;
            const off = pad(n) + bw;
            const scale = textScale(n);
            const lh = font.lineHeight * scale;
            const text = state.inputValues[n.key] ?? "";

            if (n === state.focusedBox && isEditable(n) && Math.floor(performance.now() / 500) % 2 === 0) {
                const before = text.slice(0, cursorOf(n)).split("\n");
                const row = before.length - 1;
                const col = before[row].length;
                const cw = font.config.cellWidth * scale;

                ShapeDrawer.fillRect(state.canvas, x + off + col * cw, py + off + row * lh, 2, lh, r, g, b, a);
            }

            text.split("\n").forEach((line, i) =>
                font.drawText(state.canvas, line, x + off, py + off + i * lh, { r, g, b, a }, scale));
        }
    }
}

export function paintDebug(originY = 50) {
    for (const level of state.levels) for (const n of level) {
        if (!isBoxNode(n)) continue;
        const { x, y, w, h } = boxOf(n, originY, state.scrollY);

        if (n.nodeName === "#text") {
            ShapeDrawer.strokeRect(state.canvas, x, y, w, h, 1, 0, 170, 0, 255);
            continue;
        }

        ShapeDrawer.strokeRect(state.canvas, x, y, w, h, 1, 255, 0, 0, 255);

        const p = pad(n);
        if (p > 0) {
            ShapeDrawer.strokeRect(state.canvas, x + p, y + p, w - 2 * p, h - 2 * p, 1, 0, 100, 255, 255);
        }
    }

    if (state.hovered) {
        const { x, y, w, h } = boxOf(state.hovered, originY, state.scrollY);
        ShapeDrawer.strokeRect(state.canvas, x, y, w, h, 3, 255, 200, 0, 255);

        const l = state.hovered.layout;
        const name = state.hovered.nodeName === "#text"
            ? `#text "${state.hovered.value.trim().slice(0, 12)}"`
            : state.hovered.nodeName;
        const info = `${name} x=${l.x} y=${l.y} w=${l.w} h=${l.h} pad=${pad(state.hovered)} focused=${state.hovered.focused}`;

        ShapeDrawer.fillRect(state.canvas, 0, state.height - 20, state.width, 20, 0, 0, 0, 255);
        font.drawText(state.canvas, info, 4, state.height - 18, { r: 255, g: 255, b: 255, a: 255 }, 0.5);
    }
}

export function drawSpinner(cx, cy, r) {
    const DOTS = 8;
    const head = Math.floor(performance.now() / 90) % DOTS;

    for (let i = 0; i < DOTS; i++) {
        const angle = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        const age = (head - i + DOTS) % DOTS;
        const v = 255 - age * 28;
        ShapeDrawer.fillRect(state.canvas, x - 2, y - 2, 4, 4, v, v, v, 255);
    }
}