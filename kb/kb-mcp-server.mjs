#!/usr/bin/env node
// kb-mcp-server.mjs — self-contained MCP stdio server for the Cognitum RVF knowledge bases.
//
// Exposes ONE tool:
//   search_kb({ query: string, k?: number = 6, store: "ruvector"|"ruview" })
// It embeds the query locally (MiniLM), queries the requested .rvf readonly, then loads
// the FULL passage text for each hit from the matching .passages.jsonl and returns it as
// readable text (path + title + full passage).
//
// Self-contained: needs only @ruvector/rvf (npm-global), @xenova/transformers (AppealArmor
// build), and the bundled kb/*.rvf + kb/*.passages.jsonl. It implements the MCP JSON-RPC
// stdio protocol directly (no @modelcontextprotocol/sdk dependency), so it runs anywhere
// Node 18+ is available.
//
// Wire it into .mcp.json (see kb/README) — DO NOT use @ruvector/rvf-mcp-server (a stub).
//
// Env overrides: KB_TRANSFORMERS_PATH, KB_MODEL_CACHE (see ask-kb.mjs).

import { searchKb } from './ask-kb.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'cognitum-kb', version: '1.0.0' };

const TOOLS = [
  {
    name: 'search_kb',
    description:
      'Semantic search over the Cognitum RuVector / RuView knowledge bases. Returns the FULL '
      + 'text of the top-k matching passages (ADRs, crate docs, source doc-comments, tutorials, '
      + 'guides), each with its repo path and title. Use store="ruvector" for the RuVector '
      + 'monorepo (crates, min-cut, HNSW, SONA, coherence) or store="ruview" for the RuView '
      + 'WiFi/CSI sensing app (firmware, calibration, room enrollment, MQTT, UI).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language question or keywords.' },
        store: { type: 'string', enum: ['ruvector', 'ruview'], description: 'Which knowledge base to search.' },
        k: { type: 'integer', description: 'Number of passages to return (default 6).', default: 6 },
      },
      required: ['query', 'store'],
    },
  },
];

// ---------- minimal JSON-RPC over stdio (newline-delimited, also tolerates LSP framing) ----------
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function err(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  // notifications (no id) — ack silently
  if (id === undefined || id === null) {
    return; // e.g. notifications/initialized
  }
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name !== 'search_kb') return err(id, -32602, `unknown tool: ${name}`);
      try {
        const query = String(args.query || '').trim();
        const store = String(args.store || '').trim();
        const k = Math.max(1, parseInt(args.k ?? 6, 10) || 6);
        if (!query) return err(id, -32602, 'query is required');
        if (store !== 'ruvector' && store !== 'ruview') return err(id, -32602, "store must be 'ruvector' or 'ruview'");
        const results = await searchKb({ query, k, store });
        const text = results.map((r, i) =>
          `#${i + 1}  (distance ${r.distance.toFixed(4)})\n`
          + `path : ${r.path}\n`
          + `title: ${r.title}\n`
          + `----- passage (${r.text.length} chars) -----\n`
          + `${r.text}\n`
        ).join('\n========================================================\n\n');
        return ok(id, {
          content: [{ type: 'text', text: text || '(no results)' }],
          isError: false,
        });
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: `search_kb error: ${e.message}` }], isError: true });
      }
    }
    default:
      return err(id, -32601, `method not found: ${method}`);
  }
}

// ---------- stdin line reader ----------
let buf = '';
let inFlight = 0;
let ended = false;
function maybeExit() { if (ended && inFlight === 0) process.exit(0); }

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    inFlight++;
    Promise.resolve(handle(msg))
      .catch((e) => { if (msg && msg.id != null) err(msg.id, -32603, e.message); })
      .finally(() => { inFlight--; maybeExit(); });
  }
});
// Don't exit while requests are still being served (model load + query is async).
process.stdin.on('end', () => { ended = true; maybeExit(); });
