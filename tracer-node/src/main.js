/**
 * Tracer HTTP service.
 *
 * Mirrors tracer-python and tracer-java exactly -- POST /trace -> trace
 * document, GET /health -> status -- so the orchestrator treats all three
 * identically and adding this language was a routing table entry, not a change
 * to the backend.
 *
 * It performs NO sandboxing of its own: isolation is the container's job
 * (gVisor, no network, read-only rootfs, capped memory and pids). This process
 * is assumed compromised on every request, so it must be disposable and hold
 * nothing worth stealing.
 */

import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { clampLimits } from "./limits.js";
import { availablePackages } from "./packages.js";
import { trace } from "./tracer.js";

const PORT = Number(process.env.PORT ?? 8083);
const MAX_SOURCE = 200_000;
const MAX_BODY = 12 * 1024 * 1024;

// Per-request working directory. In the container this is a tmpfs mount, since
// the rootfs is read-only in production.
const RUN_ROOT = process.env.VIZ_DATA_DIR ?? os.tmpdir();

// Advertised to the UI so example snippets read files the right way. User code
// always uses BARE FILENAMES: the child's cwd is its own private directory,
// which is what keeps concurrent requests from seeing each other's data.
const DATA_HINT = "the current directory";

const SUPPORTED = new Set(["javascript", "typescript"]);

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body_too_large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("invalid_json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Materialise uploaded datasets so `readFileSync("sales.csv")` works.
 *
 * Names are flattened to a basename: "../../etc/passwd" must not escape the
 * run directory, even though the sandbox would also stop it.
 */
async function writeSampleFiles(files, dir) {
  for (const file of files) {
    const safe = path.basename(String(file?.name ?? ""));
    if (!safe || safe.startsWith(".")) continue;
    await writeFile(path.join(dir, safe), String(file?.content ?? ""), "utf8");
  }
}

async function handleTrace(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    send(res, err.status ?? 400, { error: err.message });
    return;
  }

  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim()) {
    send(res, 400, { error: "empty_source" });
    return;
  }
  if (source.length > MAX_SOURCE) {
    send(res, 413, { error: "source_too_large" });
    return;
  }

  const language = SUPPORTED.has(body.language) ? body.language : "javascript";
  const limits = clampLimits(body.limits);
  const warnings = [];

  // In the container RUN_ROOT is a tmpfs that starts empty on every boot.
  await mkdir(RUN_ROOT, { recursive: true }).catch(() => {});
  const dir = await mkdtemp(path.join(RUN_ROOT, "viz-node-"));
  try {
    if (Array.isArray(body.files) && body.files.length) {
      try {
        await writeSampleFiles(body.files, dir);
      } catch (err) {
        warnings.push(
          `Sample data could not be written: ${err.code ?? err.message}. ` +
          "Files will not be available to your code.",
        );
      }
    }

    const doc = await trace({
      source,
      language,
      stdin: typeof body.stdin === "string" ? body.stdin : "",
      limits,
      dir,
    });
    if (warnings.length) doc.meta.warnings = warnings;
    send(res, 200, doc);
  } catch (err) {
    // A tracer bug must still produce a document the replayer understands.
    send(res, 200, {
      version: 1,
      language,
      status: "error",
      source,
      steps: [],
      stdout: "",
      error: { type: err?.name ?? "TracerError", message: String(err?.message ?? err).slice(0, 500) },
      limits,
      meta: { runtime_version: process.versions.node },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    send(res, 200, {
      status: "ok",
      language: "javascript",
      languages: ["javascript", "typescript"],
      runtime_version: process.versions.node,
      packages: availablePackages(),
      data_hint: DATA_HINT,
    });
    return;
  }
  if (req.url === "/trace" && req.method === "POST") {
    handleTrace(req, res);
    return;
  }
  send(res, req.url === "/trace" ? 405 : 404, { error: "not_found" });
});

// 0.0.0.0 is right under compose, where this is the only thing in its container.
// Set BIND_HOST=127.0.0.1 when the tracer shares a container with a public
// listener, so nothing but that listener is reachable.
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";

server.listen(PORT, BIND_HOST, () => {
  console.log(`tracer-node listening on :${PORT}`);
});
