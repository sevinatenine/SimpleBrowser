import path from "path";
import fs from "fs";
import os from "os";

const DATA_FOLDER = path.join(os.homedir() + "/.simpleBrowser/");
fs.mkdirSync(DATA_FOLDER, { recursive: true });

const HISTORY_FILE = path.join(DATA_FOLDER, "/history.json");

export function loadHistory() {
    try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) {
        return [];
    }
}

export function saveHistory(h) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(h));
}