const ROOM_TTL_MS = 15 * 60 * 1000;
// While both phones keep the room in use it stays open (for reconnects) up to this hard limit.
const ROOM_MAX_LIFETIME_MS = 6 * 60 * 60 * 1000;
const MAX_SIGNAL_BYTES = 96 * 1024;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://grandpatin.github.io",
  "http://localhost:4174",
  "http://127.0.0.1:4174"
];
const FALLBACK_ICE_SERVERS = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }
];

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers }
});

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  return allowedOrigins(env).has(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin"
  } : {};
}

function isAllowedRequest(request, env) {
  const origin = request.headers.get("origin");
  return Boolean(origin && allowedOrigins(env).has(origin));
}

function randomToken(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function safeRoomId(value) {
  return /^[A-Za-z0-9_-]{16,40}$/.test(value || "");
}

async function iceServersFor(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return FALLBACK_ICE_SERVERS;
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ ttl: Math.ceil(ROOM_TTL_MS / 1000) })
    });
    if (!response.ok) throw new Error(`TURN service returned ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload.iceServers) && payload.iceServers.length ? payload.iceServers : FALLBACK_ICE_SERVERS;
  } catch (error) {
    console.warn("TURN credentials unavailable; using STUN fallback.", error instanceof Error ? error.message : error);
    return FALLBACK_ICE_SERVERS;
  }
}

async function roomStub(env, roomId) {
  return env.PAIRING_ROOMS.getByName(roomId);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "aligned-signaling" });
    if (request.method === "OPTIONS") {
      return isAllowedRequest(request, env) ? new Response(null, { status: 204, headers: cors }) : json({ error: "Origin not allowed" }, 403);
    }
    if (!isAllowedRequest(request, env)) return json({ error: "Origin not allowed" }, 403);

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const rateKey = request.headers.get("cf-connecting-ip") || "unknown";
      const rateLimit = await env.ROOM_RATE_LIMITER?.limit({ key: rateKey });
      if (rateLimit && !rateLimit.success) return json({ error: "Please wait a moment before creating another room" }, 429, cors);
      const roomId = randomToken(15);
      const hostToken = randomToken(32);
      const joinToken = randomToken(32);
      const expiresAt = Date.now() + ROOM_TTL_MS;
      const stub = await roomStub(env, roomId);
      const created = await stub.fetch("https://room.internal/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostToken, joinToken, expiresAt, createdAt: Date.now() })
      });
      if (!created.ok) return json({ error: "Unable to create a pairing room" }, 503, cors);
      return json({ roomId, hostToken, joinToken, expiresAt, iceServers: await iceServersFor(env) }, 201, {
        ...cors,
        "cache-control": "no-store"
      });
    }

    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch && safeRoomId(joinMatch[1])) {
      let token = "";
      try { token = String((await request.json()).token || ""); } catch {}
      const stub = await roomStub(env, joinMatch[1]);
      const validated = await stub.fetch("https://room.internal/validate-join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (!validated.ok) return json({ error: validated.status === 410 ? "This pairing room expired" : "Invalid pairing link" }, validated.status, cors);
      const { expiresAt } = await validated.json().catch(() => ({}));
      return json({ roomId: joinMatch[1], expiresAt, iceServers: await iceServersFor(env) }, 200, {
        ...cors,
        "cache-control": "no-store"
      });
    }

    const socketMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
    if (request.method === "GET" && socketMatch && safeRoomId(socketMatch[1]) && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return (await roomStub(env, socketMatch[1])).fetch(request);
    }

    return json({ error: "Not found" }, 404, cors);
  }
};

export class PairingRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async configuration() {
    return this.ctx.storage.get("configuration");
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/create") {
      if (await this.configuration()) return json({ error: "Room already exists" }, 409);
      const configuration = await request.json();
      await this.ctx.storage.put("configuration", configuration);
      await this.ctx.storage.setAlarm(configuration.expiresAt);
      return json({ ok: true }, 201);
    }

    const configuration = await this.configuration();
    if (!configuration || Date.now() >= configuration.expiresAt) return json({ error: "Room expired" }, 410);

    if (request.method === "POST" && url.pathname === "/validate-join") {
      const { token = "" } = await request.json();
      return token === configuration.joinToken ? json({ ok: true, expiresAt: configuration.expiresAt }) : json({ error: "Invalid token" }, 403);
    }

    if (url.pathname !== "/api/rooms/" + url.pathname.split("/")[3] + "/socket" && !url.pathname.endsWith("/socket")) {
      return json({ error: "Not found" }, 404);
    }
    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token") || "";
    const expectedToken = role === "host" ? configuration.hostToken : role === "join" ? configuration.joinToken : "";
    if (!expectedToken || token !== expectedToken) return json({ error: "Invalid socket token" }, 403);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // The same phone reconnecting (same device id) replaces its old socket. A different phone using the
    // same join link is refused, so a third device can never take over a room.
    const device = (url.searchParams.get("device") || "").slice(0, 64);
    const existing = this.ctx.getWebSockets().filter((socket) => socket.deserializeAttachment()?.role === role);
    if (role === "join" && device && configuration.joinDevice && configuration.joinDevice !== device && existing.length) {
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role: "rejected" });
      server.close(4009, "This link is already in use");
      return new Response(null, { status: 101, webSocket: client });
    }
    if (role === "join" && device && configuration.joinDevice !== device) {
      configuration.joinDevice = device;
      await this.ctx.storage.put("configuration", configuration);
    }
    for (const socket of existing) socket.close(4001, "Replaced by a newer connection");
    server.serializeAttachment({ role });
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "socket-ready", role, expiresAt: configuration.expiresAt }));
    this.notifyPeerState();
    return new Response(null, { status: 101, webSocket: client });
  }

  socketsByRole() {
    const result = { host: [], join: [] };
    for (const socket of this.ctx.getWebSockets()) {
      const role = socket.deserializeAttachment()?.role;
      if (role === "host" || role === "join") result[role].push(socket);
    }
    return result;
  }

  notifyPeerState() {
    const sockets = this.socketsByRole();
    const ready = sockets.host.length > 0 && sockets.join.length > 0;
    for (const socket of [...sockets.host, ...sockets.join]) {
      try { socket.send(JSON.stringify({ type: ready ? "peer-ready" : "peer-waiting" })); } catch {}
    }
  }

  async webSocketMessage(socket, message) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (text.length > MAX_SIGNAL_BYTES) {
      socket.close(1009, "Signal too large");
      return;
    }
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    if (!["offer", "answer", "candidate", "ping"].includes(payload.type)) return;
    if (payload.type === "ping") {
      socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
      await this.extendWhileActive(socket);
      return;
    }
    const senderRole = socket.deserializeAttachment()?.role;
    if (senderRole !== "host" && senderRole !== "join") return;
    const recipientRole = senderRole === "host" ? "join" : "host";
    for (const recipient of this.socketsByRole()[recipientRole]) {
      try { recipient.send(text); } catch {}
    }
  }

  // Keeps a room that is actively in use alive, so phones can reconnect during long rounds.
  async extendWhileActive(socket) {
    const configuration = await this.configuration();
    if (!configuration) return;
    const now = Date.now();
    const limit = (configuration.createdAt || now) + ROOM_MAX_LIFETIME_MS;
    const sockets = this.socketsByRole();
    if (!sockets.host.length || !sockets.join.length) return;
    if (configuration.expiresAt - now > ROOM_TTL_MS / 2) return;
    configuration.expiresAt = Math.min(limit, now + ROOM_TTL_MS);
    await this.ctx.storage.put("configuration", configuration);
    await this.ctx.storage.setAlarm(configuration.expiresAt);
    for (const peer of [...sockets.host, ...sockets.join]) {
      try { peer.send(JSON.stringify({ type: "room-extended", expiresAt: configuration.expiresAt })); } catch {}
    }
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch {}
    this.notifyPeerState();
  }

  async webSocketError() {
    this.notifyPeerState();
  }

  async alarm() {
    const configuration = await this.configuration();
    if (configuration && Date.now() < configuration.expiresAt) {
      await this.ctx.storage.setAlarm(configuration.expiresAt);
      return;
    }
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(4000, "Pairing room expired"); } catch {}
    }
    await this.ctx.storage.deleteAll();
  }
}
