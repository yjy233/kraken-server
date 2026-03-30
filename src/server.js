#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { loadDotenv, loadKrakenRuntime } = require("./kraken-loader");

loadDotenv();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const JSON_LIMIT_BYTES = 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const activeSessions = new Set();

const state = {
  agentContext: null,
  config: null,
  issues: [],
  ready: false,
  runtimeLoaded: false,
  startedAt: new Date().toISOString()
};

let eventId = 0;

function resolveWorkspaceRoot(config) {
  return config.workspaceRoot || config.sandboxRoot || process.cwd();
}

function buildPublicConfig() {
  const config = state.config || {};
  const model = config.model ?? "gpt-4o-mini";

  return {
    activeSessions: activeSessions.size,
    hasApiKey: Boolean(config.apiKey),
    host: HOST,
    issues: state.issues,
    model,
    port: PORT,
    protocol: config.protocol ?? "openai",
    ready: state.ready,
    runtimeLoaded: state.runtimeLoaded,
    startedAt: state.startedAt,
    summaryModel: config.summaryModel ?? model,
    workspaceRoot: resolveWorkspaceRoot(config)
  };
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(body);
}

function sendSSE(res, event, data) {
  res.write(`id: ${++eventId}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function isResponseWritable(res) {
  return !res.destroyed && !res.writableEnded;
}

function isWithinDirectory(parentDir, targetPath) {
  const relative = path.relative(parentDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > JSON_LIMIT_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

function serveStaticFile(filePath, res) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      json(res, 404, { error: "File not found." });
      return;
    }

    const extname = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extname] || "application/octet-stream";

    res.writeHead(200, {
      "Cache-Control": extname === ".html" ? "no-store" : "public, max-age=300",
      "Content-Type": contentType
    });
    res.end(data);
  });
}

async function createAgentContext(runtime, config) {
  const logger = runtime.createLogger(config.logLevel ?? "info");
  const messageBus = new runtime.MessageBus();
  const model = config.model ?? "gpt-4o-mini";
  const summaryModel = config.summaryModel ?? model;
  const protocol = config.protocol ?? "openai";

  const llm = runtime.createLLMClient({
    anthropicVersion: config.anthropicVersion,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    protocol,
    timeoutMs: config.timeoutMs
  });

  const workspaceRoot = resolveWorkspaceRoot(config);
  const sandbox = new runtime.Sandbox({
    allowedDirs: config.sandboxAllowedDirs,
    maxFileSizeBytes: config.sandboxMaxFileBytes ?? 1024 * 1024,
    rootDir: workspaceRoot
  });

  const sessions = new runtime.SessionStore(
    {
      compressionTargetTokens: config.summaryTargetTokens ?? 600,
      maxTokens: config.maxSessionTokens ?? 4000,
      summaryModel,
      workspaceRoot
    },
    llm
  );

  const tools = runtime.createBuiltinTools();

  let mcpManager = null;
  if (Array.isArray(config.mcpServers) && config.mcpServers.length > 0) {
    try {
      logger.info("Initializing MCP servers...");
      mcpManager = new runtime.MCPManager(config.mcpServers);
      await mcpManager.connectAll();
      tools.push(...mcpManager.getAllTools());
      logger.info(`Loaded ${mcpManager.getConnectedServers().length} MCP server(s)`);
    } catch (error) {
      logger.error(`Failed to initialize MCP: ${error.message}`);
    }
  }

  const toolRegistry = new runtime.ToolRegistry(tools);
  const agent = new runtime.ReActAgent({
    llm,
    logger,
    messageBus,
    options: {
      config: { tools: config.tools },
      maxIterations: config.maxIterations ?? 6,
      model,
      temperature: config.temperature ?? 0.2,
      workspaceRoot
    },
    sandbox,
    sessions,
    tools: toolRegistry
  });

  return {
    agent,
    logger,
    messageBus,
    async shutdown() {
      if (mcpManager) {
        await mcpManager.disconnectAll().catch((error) => {
          logger.error(`Failed to disconnect MCP servers: ${error.message}`);
        });
      }
    }
  };
}

async function refreshAgentContext() {
  if (state.agentContext) {
    await state.agentContext.shutdown();
    state.agentContext = null;
  }

  state.config = null;
  state.ready = false;
  state.runtimeLoaded = false;
  state.issues = [];

  let runtime;
  try {
    runtime = loadKrakenRuntime();
    state.runtimeLoaded = true;
  } catch (error) {
    state.issues = [`Kraken runtime load failed: ${error.message}`];
    return;
  }

  try {
    state.config = await runtime.loadKrakenConfig(process.cwd());
  } catch (error) {
    state.config = null;
    state.issues = [`Kraken config load failed: ${error.message}`];
    return;
  }

  if (!state.config || !state.config.apiKey) {
    state.issues = [
      "Missing API key. Set LLM_API_KEY / OPENAI_API_KEY, or write apiKey into ~/.Kraken/Kraken.json or ./.Kraken/Kraken.json."
    ];
    return;
  }

  try {
    state.agentContext = await createAgentContext(runtime, state.config);
    state.ready = true;
  } catch (error) {
    state.issues = [`Agent initialization failed: ${error.message}`];
  }
}

function attachStreamingListeners(res, sessionId) {
  if (!state.agentContext) {
    return () => {};
  }

  let closed = false;
  const { messageBus } = state.agentContext;

  const writeIfOpen = (event, payload) => {
    if (!closed) {
      sendSSE(res, event, payload);
    }
  };

  const listeners = {
    "agent:error": (payload) => {
      if (payload.sessionId === sessionId) {
        writeIfOpen("error", payload);
      }
    },
    "agent:response": (payload) => {
      if (payload.sessionId === sessionId) {
        writeIfOpen("response", payload);
      }
    },
    "agent:thinking": (payload) => {
      if (payload.sessionId === sessionId) {
        writeIfOpen("thinking", payload);
      }
    },
    "agent:tool_call": (payload) => {
      if (payload.sessionId === sessionId) {
        writeIfOpen("tool_call", payload);
      }
    },
    "agent:tool_result": (payload) => {
      if (payload.sessionId === sessionId) {
        writeIfOpen("tool_result", payload);
      }
    }
  };

  for (const [eventName, listener] of Object.entries(listeners)) {
    messageBus.on(eventName, listener);
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    for (const [eventName, listener] of Object.entries(listeners)) {
      messageBus.off(eventName, listener);
    }
  };
}

async function handleChatRequest(req, res) {
  if (!state.ready || !state.agentContext) {
    json(res, 503, {
      error: "Kraken agent is not ready.",
      issues: state.issues
    });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRequestBody(req);
  } catch (error) {
    json(res, 413, { error: error.message });
    return;
  }

  const body = safeJsonParse(rawBody || "{}", null);
  if (!body || typeof body !== "object") {
    json(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : randomUUID();
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    json(res, 400, { error: "Field `message` is required." });
    return;
  }

  if (activeSessions.has(sessionId)) {
    json(res, 409, {
      error: "This session is already processing a request.",
      sessionId
    });
    return;
  }

  activeSessions.add(sessionId);

  res.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });

  sendSSE(res, "meta", {
    model: state.config.model ?? "gpt-4o-mini",
    protocol: state.config.protocol ?? "openai",
    sessionId,
    workspaceRoot: resolveWorkspaceRoot(state.config)
  });

  const detachListeners = attachStreamingListeners(res, sessionId);
  let connectionClosed = false;

  res.on("close", () => {
    connectionClosed = true;
    detachListeners();
  });

  try {
    await state.agentContext.agent.run(sessionId, message);
    if (!connectionClosed && isResponseWritable(res)) {
      sendSSE(res, "done", { ok: true, sessionId });
    }
  } catch (error) {
    if (!connectionClosed && isResponseWritable(res)) {
      sendSSE(res, "error", {
        error: error.message || "Unexpected agent error.",
        sessionId
      });
    }
  } finally {
    activeSessions.delete(sessionId);
    detachListeners();
    if (isResponseWritable(res)) {
      res.end();
    }
  }
}

async function handleClearSession(req, res) {
  const rawBody = await readRequestBody(req).catch(() => "{}");
  const body = safeJsonParse(rawBody, {});
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!sessionId) {
    json(res, 400, { error: "Field `sessionId` is required." });
    return;
  }

  if (activeSessions.has(sessionId)) {
    json(res, 409, { error: "Cannot clear an active session.", sessionId });
    return;
  }

  if (state.agentContext && typeof state.agentContext.agent.clearSession === "function") {
    state.agentContext.agent.clearSession(sessionId);
  }

  json(res, 200, { ok: true, sessionId });
}

async function handleReload(res) {
  if (activeSessions.size > 0) {
    json(res, 409, {
      error: "Cannot reload while sessions are running.",
      activeSessions: activeSessions.size
    });
    return;
  }

  await refreshAgentContext();
  json(res, 200, buildPublicConfig());
}

function setCommonHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function handleRequest(req, res) {
  setCommonHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      ...buildPublicConfig()
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/config") {
    json(res, 200, buildPublicConfig());
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/chat") {
    await handleChatRequest(req, res);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/session/clear") {
    await handleClearSession(req, res);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/reload") {
    await handleReload(res);
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);

  if (!isWithinDirectory(PUBLIC_DIR, filePath)) {
    json(res, 403, { error: "Forbidden." });
    return;
  }

  serveStaticFile(filePath, res);
}

async function main() {
  await refreshAgentContext();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (res.headersSent) {
        if (isResponseWritable(res)) {
          res.end();
        }
        return;
      }

      json(res, 500, {
        error: error.message || "Internal server error."
      });
    });
  });

  process.on("SIGINT", async () => {
    if (state.agentContext) {
      await state.agentContext.shutdown();
    }
    server.close(() => process.exit(0));
  });

  process.on("SIGTERM", async () => {
    if (state.agentContext) {
      await state.agentContext.shutdown();
    }
    server.close(() => process.exit(0));
  });

  server.listen(PORT, HOST, () => {
    const status = state.ready ? "ready" : "degraded";
    const suffix = state.issues.length > 0 ? ` (${state.issues.join(" | ")})` : "";
    console.log(`Kraken Server listening on http://${HOST}:${PORT} [${status}]${suffix}`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error.message || error);
  process.exit(1);
});
