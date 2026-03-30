"use strict";

const path = require("node:path");

function tryRequire(specifier) {
  try {
    return { ok: true, value: require(specifier) };
  } catch (error) {
    return { ok: false, error };
  }
}

function loadDotenv() {
  const candidates = [
    "dotenv/config",
    path.join(__dirname, "../../Kraken/node_modules/dotenv/config")
  ];

  for (const candidate of candidates) {
    const result = tryRequire(candidate);
    if (result.ok) {
      return true;
    }
  }

  return false;
}

function loadKrakenModule(relativePath) {
  const candidates = [
    `@yjy233/kraken/dist/${relativePath}`,
    path.join(__dirname, "../../Kraken/dist", relativePath)
  ];

  const failures = [];

  for (const candidate of candidates) {
    const result = tryRequire(candidate);
    if (result.ok) {
      return result.value;
    }

    failures.push(`${candidate}: ${result.error.message}`);
  }

  throw new Error(failures.join("\n"));
}

function loadKrakenRuntime() {
  return {
    loadKrakenConfig: loadKrakenModule("core/config/loadConfig.js").loadKrakenConfig,
    MessageBus: loadKrakenModule("core/messagebus/MessageBus.js").MessageBus,
    createLLMClient: loadKrakenModule("core/llm/LLMClientFactory.js").createLLMClient,
    Sandbox: loadKrakenModule("core/sandbox/Sandbox.js").Sandbox,
    SessionStore: loadKrakenModule("core/session/SessionStore.js").SessionStore,
    createBuiltinTools: loadKrakenModule("core/tools/core_tool/index.js").createBuiltinTools,
    ToolRegistry: loadKrakenModule("core/tools/ToolRegistry.js").ToolRegistry,
    ReActAgent: loadKrakenModule("core/agent/ReActAgent.js").ReActAgent,
    createLogger: loadKrakenModule("core/utils/logger.js").createLogger,
    MCPManager: loadKrakenModule("core/mcp/MCPManager.js").MCPManager
  };
}

module.exports = {
  loadDotenv,
  loadKrakenRuntime
};
