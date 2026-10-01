// Copies the ngspice WebAssembly bundle (eecircuit-engine, MIT) into vendor/ngspice/
// so the page can load it without a bundler. Runs after `npm install`.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "eecircuit-engine", "dist", "eecircuit-engine.mjs");
const toDir = join(root, "vendor", "ngspice");

if (!existsSync(from)) {
    console.log("eecircuit-engine is not installed; skipping vendor step");
    process.exit(0);
}
mkdirSync(toDir, { recursive: true });
copyFileSync(from, join(toDir, "eecircuit-engine.mjs"));
copyFileSync(join(root, "node_modules", "eecircuit-engine", "LICENSE"), join(toDir, "LICENSE"));
console.log("vendored ngspice bundle ->", join("vendor", "ngspice"));
