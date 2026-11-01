#!/usr/bin/env node

import { PixelBuffer } from "tessera.js";
import { renderer, state } from "./state.js";
import { generateLevels } from "./engine.js";
import { paint, paintScrollbar, paintDebug, drawSpinner } from "./ui.js";
import {
    DEBUG, boxes, topBar, backButton, forwardsButton, reloadButton, input, content,
    renderURL, drawCursor, updateScroll, updateCursor, updateHover,
    dumpLayout, handleClick, navigate
} from "./browser.js";
import { saveHistory } from "./data.js";

renderer.setWindowTitle("Simple Browser");
navigate("simple://newtab");

function getSize() {
    return [renderer.getScreenWidth(), renderer.getScreenHeight()];
}

function checkResize() {
    const [w, h] = getSize();
    if (w === state.width && h === state.height) return;
    state.width = w;
    state.height = h;

    state.canvas.destroy();
    state.canvas = new PixelBuffer(renderer, state.width, state.height);

    for (const b of boxes) b.updateSize();

    if (state.doc) state.levels = generateLevels(state.doc);
}

renderer.onRender(() => {
    checkResize();
    if (state.layoutDirty && state.doc) { state.layoutDirty = false; state.levels = generateLevels(state.doc); }
    state.canvas.clear(255, 255, 255, 255);

    content.draw();
    paint(state.levels, state.scrollY);
    paintScrollbar();
    // if (DEBUG) paintDebug();
    topBar.draw();
    backButton.draw();
    forwardsButton.draw();
    reloadButton.draw();
    input.draw();
    if (state.loading) drawSpinner(state.width - 25, 25, 8);
    drawCursor();

    state.canvas.upload();
    state.canvas.draw(0, 0);
});

function loop() {
    renderer.input.GetInput();

    const { x: mx, y: my } = renderer.input.getMousePosition();
    if (DEBUG) updateHover(mx, my);

    updateScroll(my);
    updateCursor(mx, my);

    if (renderer.input.isMouseButtonPressed(0)) {
        if (DEBUG && my >= 50) dumpLayout();
        handleClick(mx, my);
    }

    if (renderer.step()) setImmediate(loop);
}

setInterval(() => {
    saveHistory(state.browserHistory);
}, 5000);

function e() {
    saveHistory(state.browserHistory);
    process.exit();
}

process.on('SIGQUIT', e);
process.on('SIGINT', e);
process.on('SIGTERM', e);

loop();