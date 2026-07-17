#!/usr/bin/env node
// check-docling.cjs — Cross-platform health check for docling-serve.
// Returns exit code 0 if reachable, 1 otherwise.

const http = require("http");
const { URL } = require("url");

const raw =
  process.env.DOCLING_HEALTH_URL ||
  `http://${process.env.DOCLING_HOST || "127.0.0.1"}:${process.env.DOCLING_PORT || "5001"}/health`;

let parsed;
try {
  parsed = new URL(raw);
} catch {
  console.error(`docling-serve: INVALID URL (${raw})`);
  process.exit(1);
}

const req = http.get(
  {
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.pathname + parsed.search,
    timeout: 5000,
  },
  (res) => {
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`docling-serve: OK (${raw})`);
      process.exit(0);
    }
    console.error(`docling-serve: HTTP ${res.statusCode} (${raw})`);
    process.exit(1);
  }
);

req.on("timeout", () => {
  req.destroy(new Error("timeout"));
});

req.on("error", (err) => {
  console.error(`docling-serve: UNREACHABLE (${raw}) — ${err.message}`);
  process.exit(1);
});
