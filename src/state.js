import { loadRenderer, PixelBuffer, BitmapFont } from "tessera.js";
import { loadHistory } from "./data.js";
import { fileURLToPath } from "url";


const { Renderer, RESIZABLE } = loadRenderer();

export const renderer = new Renderer();
if (!renderer.initialize(600, 400, "Simple Browser")) {
    console.error("Failed to initialize renderer");
    process.exit(1);
}

renderer.hideCursor();

renderer.setWindowState(RESIZABLE);
renderer.targetFPS = 60;

export const NATIVE_SIZE = 32;
export const SCROLL_SPEED = 40;
export const CHROME_H = 50;

const control = {
    padding: 5,
    backgroundColor: "white",
    borderColor: "black",
    borderWidth: 2,
    color: [0, 0, 0, 255],
};

const hidden = { display: "none", padding: 0 };
const block = { padding: 0, display: "block" };
const inline = { padding: 0, display: "inline" };

export const defaultStyles = {
    // headings
    h1: { ...block, padding: 5, fontSize: NATIVE_SIZE * 2 },
    h2: { ...block, padding: 5, fontSize: NATIVE_SIZE * 1.5 },
    h3: { ...block, padding: 5, fontSize: NATIVE_SIZE * 1.17, fontWeight: "bold" },
    h4: { ...block, padding: 5, fontSize: NATIVE_SIZE,        fontWeight: "bold" },
    h5: { ...block, padding: 5, fontSize: NATIVE_SIZE * 0.83, fontWeight: "bold" },
    h6: { ...block, padding: 5, fontSize: NATIVE_SIZE * 0.67, fontWeight: "bold" },

    // blocks
    p:    { ...block, padding: 5, fontSize: NATIVE_SIZE },
    div:  block,
    body: { ...block, padding: 10 },
    section: block, article: block, header: block, footer: block, nav: block,
    main: block, aside: block, form: block, figure: block,
    ul: { ...block, padding: 20 },
    ol: { ...block, padding: 20 },
    li: { ...block, listStyle: true },
    blockquote: { ...block, padding: 20 },
    pre: { ...block, whiteSpace: "pre", fontFamily: "monospace" },
    hr:  { ...block, borderWidth: 1, borderColor: "#888", height: 1 },

    // inline
    span:   inline,
    a:      { ...inline, color: [0, 0, 238, 255], cursor: "pointer", textDecoration: "underline" },
    b:      { ...inline, fontWeight: "bold" },
    strong: { ...inline, fontWeight: "bold" },
    i:      { ...inline, fontStyle: "italic" },
    em:     { ...inline, fontStyle: "italic" },
    u:      { ...inline, textDecoration: "underline" },
    s:      { ...inline, textDecoration: "line-through" },
    del:    { ...inline, textDecoration: "line-through" },
    small:  { ...inline, fontScale: 0.83 },
    code: inline, sub: inline, sup: inline,
    br: inline, img: inline, label: inline, select: inline,

    // controls
    button:   { ...inline, cursor: "pointer" },
    input:    { ...control, cursor: "text", display: "inline" },
    textarea: { ...control, cursor: "text", display: "block" },

    // not rendered
    head: hidden, title: hidden, meta: hidden, link: hidden,
    script: hidden, style: hidden, template: hidden, noscript: hidden,
};

export const inputLike = ["input", "textarea"];

// derived from the table so there's one source of truth
export const HIDDEN_TAGS = new Set(
    Object.keys(defaultStyles).filter(k => defaultStyles[k].display === "none")
);

export const TEXT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

export const asset = rel => fileURLToPath(new URL(`../assets/${rel}`, import.meta.url));

export const font = new BitmapFont(renderer, asset("font.png"), {
    cellWidth: 16,
    cellHeight: 32,
    cellsPerRow: 40,
    cellsPerColumn: 7,
    fontSize: NATIVE_SIZE,
    lineHeight: NATIVE_SIZE,
});

export const state = {
    canvas: new PixelBuffer(renderer, 600, 400),
    width: 0,
    height: 0,
    scrollY: 0,
    doc: null,
    levels: [],
    inputValues: {},
    focusedBox: null,
    hovered: null,
    currentURL: "",
    loadId: 0,
    loading: false,
    layoutDirty: false,
    browserHistory: loadHistory()
};