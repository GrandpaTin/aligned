import assert from "node:assert/strict";
import signalingWorker from "../worker/src/index.js";

class FakeRoomStub {
  constructor() {
    this.configuration = null;
  }

  async fetch(input, options = {}) {
    const url = new URL(input);
    if (url.pathname === "/create") {
      this.configuration = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }
    if (url.pathname === "/validate-join") {
      const { token } = JSON.parse(options.body);
      if (!this.configuration || Date.now() >= this.configuration.expiresAt) return new Response(null, { status: 410 });
      return new Response(null, { status: token === this.configuration.joinToken ? 200 : 403 });
    }
    return new Response(null, { status: 404 });
  }
}

const rooms = new Map();
const env = {
  ALLOWED_ORIGINS: "https://grandpatin.github.io,http://127.0.0.1:4174",
  PAIRING_ROOMS: {
    getByName(roomId) {
      if (!rooms.has(roomId)) rooms.set(roomId, new FakeRoomStub());
      return rooms.get(roomId);
    }
  },
  ROOM_RATE_LIMITER: { async limit() { return { success: true }; } }
};

const call = (path, options = {}) => signalingWorker.fetch(new Request(`https://signal.example${path}`, {
  ...options,
  headers: { origin: "https://grandpatin.github.io", ...(options.headers || {}) }
}), env);

const health = await call("/health");
assert.equal(health.status, 200, "Signaling health endpoint must respond");
assert.equal((await health.json()).service, "aligned-signaling", "Signaling health metadata must use the current product name");

const blocked = await signalingWorker.fetch(new Request("https://signal.example/api/rooms", {
  method: "POST",
  headers: { origin: "https://untrusted.example" }
}), env);
assert.equal(blocked.status, 403, "Untrusted browser origins must be rejected");

const missingOrigin = await signalingWorker.fetch(new Request("https://signal.example/api/rooms", { method: "POST" }), env);
assert.equal(missingOrigin.status, 403, "Room creation must require an approved browser origin");

const created = await call("/api/rooms", { method: "POST" });
assert.equal(created.status, 201, "A temporary room must be created");
const room = await created.json();
assert.match(room.roomId, /^[A-Za-z0-9_-]{16,40}$/, "Room ID must be URL-safe and unguessable");
assert(room.hostToken.length >= 40 && room.joinToken.length >= 40, "Pairing tokens must have sufficient entropy");
assert(room.expiresAt > Date.now() && room.expiresAt <= Date.now() + 16 * 60 * 1000, "Room must expire promptly");
assert(Array.isArray(room.iceServers) && room.iceServers.length, "Room must include ICE discovery configuration");

const invalidJoin = await call(`/api/rooms/${room.roomId}/join`, {
  method: "POST",
  body: JSON.stringify({ token: "not-the-token" })
});
assert.equal(invalidJoin.status, 403, "Invalid join tokens must be rejected");

const validJoin = await call(`/api/rooms/${room.roomId}/join`, {
  method: "POST",
  body: JSON.stringify({ token: room.joinToken })
});
assert.equal(validJoin.status, 200, "The QR join token must open its room");
const joinPayload = await validJoin.json();
assert.equal(joinPayload.roomId, room.roomId, "Join response must target the created room");

// --- PairingRoom Durable Object Security & Anti-Hijack Suite ---
const { PairingRoom } = await import("../worker/src/index.js");

const OriginalResponse = globalThis.Response;
class WorkerResponse extends OriginalResponse {
  constructor(body, init) {
    if (init && init.status === 101) {
      super(null, { ...init, status: 200 });
      Object.defineProperty(this, "status", { value: 101 });
      this.webSocket = init.webSocket;
      return;
    }
    super(body, init);
  }
}
globalThis.Response = WorkerResponse;

class MockWebSocket {
  constructor() {
    this.attachment = null;
    this.sent = [];
    this.closed = null;
  }
  serializeAttachment(att) { this.attachment = att; }
  deserializeAttachment() { return this.attachment; }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closed = { code, reason }; }
}

globalThis.WebSocketPair = function() {
  return [new MockWebSocket(), new MockWebSocket()];
};

class MockStorage {
  constructor() { this.data = new Map(); this.alarmAt = null; }
  async get(k) { return this.data.get(k) ?? null; }
  async put(k, v) { this.data.set(k, v); }
  async deleteAll() { this.data.clear(); }
  async setAlarm(time) { this.alarmAt = time; }
}

// 1. Signal Payload Size Limit (MAX_SIGNAL_BYTES = 96 KB)
{
  const storage = new MockStorage();
  const sockets = [];
  const ctx = { storage, getWebSockets: () => sockets, acceptWebSocket: (ws) => sockets.push(ws) };
  const room = new PairingRoom(ctx);
  await storage.put("configuration", { hostToken: "host-token-12345", joinToken: "join-token-12345", expiresAt: Date.now() + 60000 });

  const hostSocket = new MockWebSocket();
  hostSocket.serializeAttachment({ role: "host" });
  sockets.push(hostSocket);

  const oversized = JSON.stringify({ type: "offer", sdp: "a".repeat(98 * 1024) });
  await room.webSocketMessage(hostSocket, oversized);
  assert.equal(hostSocket.closed?.code, 1009, "Oversized signal (>96KB) must close socket with code 1009");
  assert.equal(hostSocket.closed?.reason, "Signal too large");
}

// 2. Anti-Hijack Device Locking (Prevent Rogue Third-Device Link Usurping)
{
  const storage = new MockStorage();
  const sockets = [];
  const ctx = { storage, getWebSockets: () => sockets, acceptWebSocket: (ws) => sockets.push(ws) };
  const room = new PairingRoom(ctx);
  const expiresAt = Date.now() + 60000;
  const tokens = {
    hostToken: "h-tok-1234567890123456789012345678901234567890",
    joinToken: "j-tok-1234567890123456789012345678901234567890"
  };
  await storage.put("configuration", { ...tokens, expiresAt });

  // 1. Initial joiner connects with device A
  const req1 = new Request(`https://signal.example/api/rooms/test-room-1/socket?role=join&token=${tokens.joinToken}&device=device-phone-A`, {
    headers: { upgrade: "websocket" }
  });
  const res1 = await room.fetch(req1);
  assert.equal(res1.status, 101, "First join connection must succeed with status 101");
  const storedConfig = await storage.get("configuration");
  assert.equal(storedConfig.joinDevice, "device-phone-A", "Configuration must lock to device-phone-A");

  // 2. Legitimate reconnect from same device A
  const req2 = new Request(`https://signal.example/api/rooms/test-room-1/socket?role=join&token=${tokens.joinToken}&device=device-phone-A`, {
    headers: { upgrade: "websocket" }
  });
  const res2 = await room.fetch(req2);
  assert.equal(res2.status, 101, "Reconnect from device-phone-A must succeed");
  assert.equal(sockets[0].closed?.code, 4001, "Prior socket must be replaced with code 4001");

  // 3. Rogue third phone connects with device B using the same join link
  const req3 = new Request(`https://signal.example/api/rooms/test-room-1/socket?role=join&token=${tokens.joinToken}&device=device-intruder-B`, {
    headers: { upgrade: "websocket" }
  });
  const res3 = await room.fetch(req3);
  assert.equal(res3.status, 101, "Upgrade initiated for rejection closure");
  const intruderSocket = sockets[sockets.length - 1];
  assert.equal(intruderSocket.closed?.code, 4009, "Rogue device must be rejected with close code 4009");
  assert.equal(intruderSocket.closed?.reason, "This link is already in use");
}

console.log("Signaling checks passed: origin protection, expiring rooms, strong tokens, device-locking anti-hijack, and 96KB payload caps verified.");
