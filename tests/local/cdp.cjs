// presentation v2 — minimal Chrome DevTools Protocol client for local tests.
// No npm dependencies: Node 22's global WebSocket + fetch talk to a headless
// Chrome, mirroring how the app drives the render window with
// executeJavaScript. Dev-only; never shipped into the skill runtime.
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function launch(chromePath, { width = 1280, height = 720 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-cdp-"));
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ];
  const child = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("chrome did not report a DevTools endpoint:\n" + buf)), 20000);
    child.stderr.on("data", (d) => {
      buf += String(d);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("chrome exited early (" + code + "):\n" + buf));
    });
  });
  const client = await connect(wsUrl);
  return {
    client,
    profile,
    async close() {
      try {
        client.ws.close();
      } catch (e) {
        /* ignore */
      }
      child.kill("SIGKILL");
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch (e) {
        /* ignore */
      }
    },
  };
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message + " (" + JSON.stringify(msg.error.data || "") + ")"));
        else res(msg.result);
      }
    });
    ws.addEventListener("open", () => {
      const send = (method, params = {}, sessionId) =>
        new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { resolve: res, reject: rej });
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          ws.send(JSON.stringify(payload));
        });
      resolve({ ws, send });
    });
    ws.addEventListener("error", (e) => reject(new Error("CDP websocket error: " + (e.message || "unknown"))));
  });
}

async function newPage(client, url, { width = 1280, height = 720 } = {}) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  if (url) {
    await client.send("Page.navigate", { url }, sessionId);
    await waitFor(client, sessionId, "document.readyState === 'complete'");
  }
  return {
    sessionId,
    targetId,
    async evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
      const res = await client.send(
        "Runtime.evaluate",
        { expression, awaitPromise, returnByValue, userGesture: true },
        sessionId,
      );
      if (res.exceptionDetails) {
        const ex = res.exceptionDetails;
        throw new Error("evaluate failed: " + (ex.exception && ex.exception.description ? ex.exception.description : ex.text));
      }
      return returnByValue ? res.result.value : res.result;
    },
    async screenshot({ scale = 1 } = {}) {
      if (scale !== 1) {
        await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
      }
      const { data } = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
      if (scale !== 1) {
        await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      }
      return Buffer.from(data, "base64");
    },
    async close() {
      try {
        await client.send("Target.closeTarget", { targetId });
      } catch (e) {
        /* ignore */
      }
    },
  };
}

async function waitFor(client, sessionId, expression, timeout = 30000) {
  const start = Date.now();
  for (;;) {
    const res = await client.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
    if (res.result && res.result.value === true) return true;
    if (Date.now() - start > timeout) throw new Error("waitFor timeout: " + expression);
    await new Promise((r) => setTimeout(r, 100));
  }
}

module.exports = { launch, newPage };
