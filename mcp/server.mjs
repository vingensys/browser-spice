#!/usr/bin/env node
// Browser SPICE as an MCP (Model Context Protocol) server over stdio: lets an AI assistant simulate SPICE decks,
// sweep parameters, run tolerance analysis and cross-check against ngspice with the same engine the web app uses.
//
//   claude mcp add browser-spice -- node /path/to/browser-spice/mcp/server.mjs
//
// No dependencies: newline-delimited JSON-RPC 2.0 on stdin / stdout, logs on stderr.

import { createRequire } from "node:module";
import readline from "node:readline";
const require = createRequire(import.meta.url);
const { TOOLS } = require("./tools.cjs");

const PROTOCOL = "2024-11-05";
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

function handle(msg) {
    const { id, method, params } = msg;
    if (method === "initialize") {
        return reply(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "browser-spice", version: "1.0.0" }, instructions: "Simulate SPICE decks with the Browser SPICE engine. Start with check_deck, then simulate. Values accept SI suffixes (1k, 4.7u, 2meg)." });
    }
    if (method === "notifications/initialized" || (typeof method === "string" && method.startsWith("notifications/"))) return;
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === "tools/call") {
        const tool = TOOLS.find(t => t.name === params.name);
        if (!tool) return fail(id, -32602, `unknown tool ${params.name}`);
        try {
            const result = tool.run(params.arguments || {});
            return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] });
        } catch (e) {
            return reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
        }
    }
    if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return fail(null, -32700, "parse error"); }
    try { handle(msg); } catch (e) { console.error(e); if (msg.id !== undefined) fail(msg.id, -32603, e.message); }
});
rl.on("close", () => process.exit(0));
