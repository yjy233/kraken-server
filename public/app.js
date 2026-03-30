"use strict";

const STORAGE_PREFIX = "kraken-server";

const state = {
  config: null,
  entries: [],
  isStreaming: false,
  sessionId: loadOrCreateSessionId()
};

const elements = {
  clearSessionBtn: document.getElementById("clearSessionBtn"),
  issuesList: document.getElementById("issuesList"),
  messageInput: document.getElementById("messageInput"),
  modelValue: document.getElementById("modelValue"),
  newSessionBtn: document.getElementById("newSessionBtn"),
  portValue: document.getElementById("portValue"),
  protocolValue: document.getElementById("protocolValue"),
  reloadBtn: document.getElementById("reloadBtn"),
  sendBtn: document.getElementById("sendBtn"),
  serverStatus: document.getElementById("serverStatus"),
  sessionValue: document.getElementById("sessionValue"),
  streamStatus: document.getElementById("streamStatus"),
  summaryModelValue: document.getElementById("summaryModelValue"),
  timeline: document.getElementById("timeline"),
  workspaceValue: document.getElementById("workspaceValue")
};

function loadOrCreateSessionId() {
  const saved = window.localStorage.getItem(`${STORAGE_PREFIX}.session-id`);
  if (saved) {
    return saved;
  }

  const next = createSessionId();
  window.localStorage.setItem(`${STORAGE_PREFIX}.session-id`, next);
  return next;
}

function createSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `session-${Date.now()}`;
}

function getHistoryKey(sessionId) {
  return `${STORAGE_PREFIX}.history.${sessionId}`;
}

function loadEntries(sessionId) {
  const raw = window.localStorage.getItem(getHistoryKey(sessionId));
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEntries() {
  window.localStorage.setItem(getHistoryKey(state.sessionId), JSON.stringify(state.entries));
}

function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function setSessionId(sessionId) {
  state.sessionId = sessionId;
  window.localStorage.setItem(`${STORAGE_PREFIX}.session-id`, sessionId);
  state.entries = loadEntries(sessionId);
  render();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function addEntry(entry) {
  state.entries.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    ...entry
  });
  saveEntries();
  renderTimeline();
}

function resetEntries() {
  state.entries = [];
  saveEntries();
  renderTimeline();
}

function renderStatus() {
  const config = state.config || {};
  const ready = Boolean(config.ready);
  const statusClass = ready ? "status-ready" : (config.runtimeLoaded ? "status-warn" : "status-error");
  const statusText = ready ? "Ready" : (config.runtimeLoaded ? "Needs Config" : "Runtime Missing");

  elements.serverStatus.className = `status-pill ${statusClass}`;
  elements.serverStatus.textContent = statusText;
  elements.streamStatus.textContent = state.isStreaming ? "Streaming" : "Idle";
  elements.protocolValue.textContent = config.protocol || "-";
  elements.modelValue.textContent = config.model || "-";
  elements.summaryModelValue.textContent = config.summaryModel || "-";
  elements.portValue.textContent = config.port || "-";
  elements.workspaceValue.textContent = config.workspaceRoot || "-";
  elements.sessionValue.textContent = state.sessionId;

  const issues = Array.isArray(config.issues) && config.issues.length > 0
    ? config.issues
    : ["No blocking issues."];
  elements.issuesList.innerHTML = issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("");
}

function renderTimeline() {
  if (state.entries.length === 0) {
    elements.timeline.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">还没有对话</div>
        <p>在下方输入问题，前端会调用后端 \`/api/chat\`，后端再把 Kraken Agent 的执行过程通过 SSE 推回来。</p>
      </div>
    `;
    return;
  }

  const html = state.entries.map((entry) => {
    if (entry.type === "user" || entry.type === "assistant") {
      const title = entry.type === "user" ? "User" : "Assistant";
      return `
        <article class="entry ${entry.type}">
          <div class="entry-head">
            <span>${title}</span>
            <span>${formatTimestamp(entry.timestamp)}</span>
          </div>
          <div class="entry-body">${escapeHtml(entry.content)}</div>
        </article>
      `;
    }

    if (entry.type === "tool_call") {
      return `
        <article class="entry event">
          <div class="entry-head">
            <span>Tool Call</span>
            <span>${formatTimestamp(entry.timestamp)}</span>
          </div>
          <div class="entry-body">
            <div class="event-title">${escapeHtml(entry.toolName)}</div>
            <details class="tool-details">
              <summary>查看参数</summary>
              <pre>${escapeHtml(entry.detail)}</pre>
            </details>
          </div>
        </article>
      `;
    }

    if (entry.type === "tool_result") {
      return `
        <article class="entry event">
          <div class="entry-head">
            <span>${entry.ok ? "Tool Result" : "Tool Failure"}</span>
            <span>${formatTimestamp(entry.timestamp)}</span>
          </div>
          <div class="entry-body">
            <div class="event-title">${escapeHtml(entry.toolName)}</div>
            <details class="tool-details">
              <summary>查看结果</summary>
              <pre>${escapeHtml(entry.detail)}</pre>
            </details>
          </div>
        </article>
      `;
    }

    if (entry.type === "thinking") {
      return `
        <article class="entry event">
          <div class="entry-head">
            <span>Thinking</span>
            <span>${formatTimestamp(entry.timestamp)}</span>
          </div>
          <div class="entry-body">${escapeHtml(entry.content)}</div>
        </article>
      `;
    }

    return `
      <article class="entry error">
        <div class="entry-head">
          <span>Error</span>
          <span>${formatTimestamp(entry.timestamp)}</span>
        </div>
        <div class="entry-body">${escapeHtml(entry.content)}</div>
      </article>
    `;
  }).join("");

  elements.timeline.innerHTML = `<div class="timeline-list">${html}</div>`;
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
}

function render() {
  renderStatus();
  renderTimeline();
}

function setStreaming(value) {
  state.isStreaming = value;
  elements.sendBtn.disabled = value;
  elements.reloadBtn.disabled = value;
  elements.newSessionBtn.disabled = value;
  elements.clearSessionBtn.disabled = value;
  elements.messageInput.disabled = value;
  renderStatus();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = safeJsonParse(text, {});

  if (!response.ok) {
    throw new Error(payload.error || text || `Request failed with status ${response.status}`);
  }

  return payload;
}

async function refreshConfig() {
  try {
    state.config = await fetchJson("/api/config", { method: "GET" });
  } catch (error) {
    state.config = {
      issues: [error.message],
      ready: false,
      runtimeLoaded: false
    };
  }

  renderStatus();
}

function handleStreamEvent(eventName, payload) {
  if (payload.sessionId && payload.sessionId !== state.sessionId) {
    setSessionId(payload.sessionId);
  }

  if (eventName === "thinking") {
    addEntry({ content: payload.content, type: "thinking" });
    return;
  }

  if (eventName === "tool_call") {
    addEntry({
      detail: JSON.stringify(payload.input, null, 2),
      toolName: payload.toolName,
      type: "tool_call"
    });
    return;
  }

  if (eventName === "tool_result") {
    addEntry({
      detail: String(payload.result || ""),
      ok: Boolean(payload.ok),
      toolName: payload.toolName,
      type: "tool_result"
    });
    return;
  }

  if (eventName === "response") {
    addEntry({ content: payload.content, type: "assistant" });
    return;
  }

  if (eventName === "error") {
    addEntry({ content: payload.error || "Unknown error.", type: "error" });
  }
}

function parseSseFrame(frame) {
  const lines = frame.split("\n");
  let eventName = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  let payload = {};
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    payload = { raw: dataLines.join("\n") };
  }

  return { eventName, payload };
}

async function sendMessage() {
  const content = elements.messageInput.value.trim();
  if (!content || state.isStreaming) {
    return;
  }

  addEntry({ content, type: "user" });
  elements.messageInput.value = "";
  setStreaming(true);

  try {
    const response = await fetch("/api/chat", {
      body: JSON.stringify({
        message: content,
        sessionId: state.sessionId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      const payload = safeJsonParse(text, {});
      throw new Error(payload.error || text || `Request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      for (const frame of frames) {
        const parsed = parseSseFrame(frame.trim());
        if (!parsed) {
          continue;
        }

        if (parsed.eventName === "meta") {
          await refreshConfig();
          continue;
        }

        if (parsed.eventName === "done") {
          continue;
        }

        handleStreamEvent(parsed.eventName, parsed.payload);
      }
    }
  } catch (error) {
    addEntry({ content: error.message || "Streaming failed.", type: "error" });
  } finally {
    setStreaming(false);
    await refreshConfig();
    elements.messageInput.focus();
  }
}

async function handleReload() {
  if (state.isStreaming) {
    return;
  }

  setStreaming(true);
  try {
    state.config = await fetchJson("/api/reload", { method: "POST" });
  } catch (error) {
    addEntry({ content: error.message || "Reload failed.", type: "error" });
  } finally {
    setStreaming(false);
    renderStatus();
  }
}

async function handleClearSession() {
  if (state.isStreaming) {
    return;
  }

  try {
    await fetchJson("/api/session/clear", {
      body: JSON.stringify({ sessionId: state.sessionId }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    resetEntries();
  } catch (error) {
    addEntry({ content: error.message || "Clear session failed.", type: "error" });
  }
}

function handleNewSession() {
  if (state.isStreaming) {
    return;
  }

  setSessionId(createSessionId());
  elements.messageInput.focus();
}

document.getElementById("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage();
});

elements.messageInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    await sendMessage();
  }
});

elements.reloadBtn.addEventListener("click", handleReload);
elements.newSessionBtn.addEventListener("click", handleNewSession);
elements.clearSessionBtn.addEventListener("click", handleClearSession);

state.entries = loadEntries(state.sessionId);
render();
refreshConfig();
