const SESSION_COOKIE = "ll_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const USERS_KV_KEY = "users:config";
// Cloudflare Workers Web Crypto caps PBKDF2 at 100000 iterations.
const PBKDF2_ITERATIONS_NEW = 100000;
const DUMMY_PASSWORD_HASH =
  "100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";

function normalizeId(value) {
      return String(value || "").trim();
}

function textBytes(value) {
      return new TextEncoder().encode(value);
}

function hex(bytes) {
      return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
      let binary = "";
      for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomId(size = 32) {
      const bytes = new Uint8Array(size);
      crypto.getRandomValues(bytes);
      return base64Url(bytes);
}

async function sha256(value) {
      return hex(await crypto.subtle.digest("SHA-256", textBytes(value)));
}

function normalizeEmail(value) {
      return String(value || "").trim().toLowerCase();
}

async function hashPassword(password, salt, iterations = 100000) {
      const key = await crypto.subtle.importKey("raw", textBytes(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits(
              {
                        name: "PBKDF2",
                        salt: textBytes(salt),
                        iterations,
                        hash: "SHA-256"
              },
              key,
              256
            );
      return hex(bits);
}

function passwordPepper(env) {
      return String(env.PASSWORD_PEPPER || env.SESSION_SECRET || "").trim();
}

function applyPasswordPepper(password, pepper) {
      if (!pepper) return password;
      return `${pepper}:${password}`;
}

async function verifyStoredPassword(password, storedHash, env) {
      const pepper = passwordPepper(env);
      if (pepper) {
              if (await verifyPassword(applyPasswordPepper(password, pepper), storedHash)) return true;
      }
      return verifyPassword(password, storedHash);
}

function validateNewPassword(password, { current } = {}) {
      const value = String(password || "");
      if (!value || value.trim() !== value || value.includes("\0")) {
              return "パスワードが無効です。";
      }
      if (value.length < 8) return "新しいパスワードは8文字以上必要です。";
      if (value.length > 128) return "新しいパスワードが長すぎます。";
      if (current && value === current) return "新しいパスワードは現在のパスワードと異なる必要があります。";
      return null;
}

function parsePasswordHash(storedHash) {
  const value = String(storedHash || "").trim();
  if (!value) return null;
  const delimiter = value.includes(":") ? ":" : "$";
  const parts = value.split(delimiter);
  if (parts.length !== 3) return null;
  const [iterations, salt, expectedHash] = parts;
  if (!iterations || !salt || !expectedHash) return null;
  return { iterations: Number(iterations), salt, expectedHash };
}

async function verifyPassword(password, storedHash) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;
  const { iterations, salt, expectedHash } = parsed;
  const key = await crypto.subtle.importKey("raw", textBytes(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: textBytes(salt),
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );
  return constantTimeEqual(hex(bits), expectedHash);
}

function maskEmail(email) {
      const normalized = normalizeEmail(email);
      const [local, domain] = normalized.split("@");
      if (!local || !domain) return "admin";
      const maskedLocal = local.length <= 2 ? `${local[0]}*` : `${local.slice(0, 2)}***`;
      return `${maskedLocal}@${domain}`;
}

async function verifyAdminCredentials(env, email, password) {
      const configuredEmail = normalizeEmail(env.ADMIN_EMAIL);
      const passwordHash = String(env.ADMIN_PASSWORD_HASH || "").trim();
      const parsed = parsePasswordHash(passwordHash);
      if (!configuredEmail || !parsed) return false;
      const normalizedEmail = normalizeEmail(email);
      if (normalizedEmail.length !== configuredEmail.length) return false;
      if (!constantTimeEqual(normalizedEmail, configuredEmail)) return false;
      return verifyPassword(String(password || ""), passwordHash);
}

async function sign(value, secret) {
      const key = await crypto.subtle.importKey(
              "raw",
              textBytes(secret),
          { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign"]
            );
      return base64Url(await crypto.subtle.sign("HMAC", key, textBytes(value)));
}

function constantTimeEqual(a, b) {
      if (a.length !== b.length) return false;
      let result = 0;
      for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
      return result === 0;
}

function envList(env, key) {
      return String(env[key] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function idsMatch(storedId, candidate) {
      const left = normalizeId(storedId);
      const right = normalizeId(candidate);
      if (!left || !right || left.length !== right.length) return false;
      return constantTimeEqual(left, right);
}

// ─── ユーザー管理（KV永続化） ───

function buildSeedUsers(env) {
      const envIds = envList(env, "ALLOWED_LOGIN_IDS");
      const seedHash = seedPasswordHash(env);
      return envIds.map((id) => ({
              id: normalizeId(id),
              role: "user",
              seeded: true,
              passwordHash: seedHash
      })).filter((user) => user.id);
}

function normalizeUserRecord(user, envIds, seedHash) {
      const id = normalizeId(user?.id);
      if (!id) return null;
      const seeded = envIds.some((envId) => idsMatch(envId, id));
      let passwordHash = String(user?.passwordHash || "").trim();
      if (!passwordHash && seeded && seedHash) passwordHash = seedHash;
      return {
              id,
              role: "user",
              seeded,
              passwordHash,
              mustChangePassword: !!user?.mustChangePassword
      };
}

function seedPasswordHash(env) {
      return String(env.SEED_USER_PASSWORD_HASH || "").trim();
}

function publicUsers(users) {
      return users.map(({ id, role, seeded, passwordHash, mustChangePassword }) => ({
              id,
              role: role || "user",
              seeded: !!seeded,
              hasPassword: !!passwordHash,
              mustChangePassword: !!mustChangePassword
      }));
}

function userPayload(session) {
      return {
              id: session.label,
              role: session.role || "user",
              mustChangePassword: !!session.mustChangePassword
      };
}

async function findUserForSession(env, session) {
      if (!session?.accessIdHash) return null;
      const users = await getUsers(env);
      for (const user of users) {
              if (await sha256(user.id) === session.accessIdHash) return user;
      }
      return null;
}

async function updateSessionRecord(env, sessionId, patch) {
      const kv = requireKv(env);
      const session = await kv.get(`session:${sessionId}`, "json");
      if (!session) return null;
      const updated = { ...session, ...patch };
      await kv.put(`session:${sessionId}`, JSON.stringify(updated), {
              expirationTtl: SESSION_TTL_SECONDS
      });
      return updated;
}

async function rotateUserSession(request, env, oldSession, accessId) {
      await requireKv(env).delete(`session:${oldSession.sessionId}`);
      return setSession(request, env, accessId, oldSession.deviceId);
}

async function isPasswordChangeRateLimited(env, sessionId) {
      const windowMs = Number(env.AUTH_WINDOW_MS || 15 * 60 * 1000);
      const maxAttempts = Number(env.PASSWORD_MAX_ATTEMPTS || 5);
      const bucketKey = `pwd-fail:${sessionId}:${Math.floor(Date.now() / windowMs)}`;
      const current = Number((await requireKv(env).get(bucketKey)) || 0);
      return current >= maxAttempts;
}

async function recordFailedPasswordChange(env, sessionId) {
      const windowMs = Number(env.AUTH_WINDOW_MS || 15 * 60 * 1000);
      const bucketKey = `pwd-fail:${sessionId}:${Math.floor(Date.now() / windowMs)}`;
      const kv = requireKv(env);
      const current = Number((await kv.get(bucketKey)) || 0) + 1;
      await kv.put(bucketKey, String(current), {
              expirationTtl: Math.max(60, Math.ceil(windowMs / 1000))
      });
}

async function createPasswordHash(password, env) {
      const pepper = passwordPepper(env);
      const material = applyPasswordPepper(String(password || ""), pepper);
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await hashPassword(material, salt, PBKDF2_ITERATIONS_NEW);
      return `${PBKDF2_ITERATIONS_NEW}:${salt}:${hash}`;
}

function generateInitialPassword() {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

async function verifyUserCredentials(env, accessId, password) {
      const normalized = normalizeId(accessId);
      const users = await getUsers(env);
      const user = normalized ? users.find((u) => idsMatch(u.id, normalized)) : null;
      const hashToCheck = user?.passwordHash || DUMMY_PASSWORD_HASH;
      const ok = await verifyStoredPassword(String(password || ""), hashToCheck, env);
      return ok && !!user?.passwordHash;
}

function sortUsers(users) {
      return [...users].sort((a, b) => a.id.localeCompare(b.id, "ja"));
}

function dedupeUsers(users) {
      const byId = new Map();
      for (const user of users) {
              const existing = byId.get(user.id);
              if (!existing || user.seeded) byId.set(user.id, user);
      }
      return [...byId.values()];
}

// KVからユーザー一覧を取得。不足分は wrangler.toml の ALLOWED_LOGIN_IDS で補完
async function getUsers(env) {
      const kv = requireKv(env);
      const envIds = envList(env, "ALLOWED_LOGIN_IDS").map((id) => normalizeId(id)).filter(Boolean);
      const seedHash = seedPasswordHash(env);
      const stored = await kv.get(USERS_KV_KEY, "json");

      let users = Array.isArray(stored)
              ? stored
                      .map((user) => normalizeUserRecord(user, envIds, seedHash))
                      .filter(Boolean)
              : buildSeedUsers(env);

      let changed = !Array.isArray(stored);

      for (const id of envIds) {
              const existing = users.find((user) => idsMatch(user.id, id));
              if (!existing) {
                        users.push({ id, role: "user", seeded: true, passwordHash: seedHash });
                        changed = true;
              } else if (!existing.passwordHash && seedHash) {
                        existing.passwordHash = seedHash;
                        changed = true;
              }
      }

      const deduped = dedupeUsers(users);
      if (deduped.length !== users.length) changed = true;
      users = sortUsers(deduped);

      if (changed) {
              await kv.put(USERS_KV_KEY, JSON.stringify(users));
      }

      return users;
}

async function saveUsers(env, users) {
      await requireKv(env).put(USERS_KV_KEY, JSON.stringify(users));
}

function maskAccessId(accessId) {
      const id = normalizeId(accessId);
      if (id.length <= 2) return "•••";
      if (id.length <= 6) return `${id[0]}${"•".repeat(Math.max(1, id.length - 2))}${id[id.length - 1]}`;
      return `${id.slice(0, 4)}...${id.slice(-2)}`;
}

function parseCookies(request) {
      return Object.fromEntries(
              String(request.headers.get("Cookie") || "")
                .split(";")
                .map((part) => part.trim())
                .filter(Boolean)
                .map((part) => {
                            const index = part.indexOf("=");
                            return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
                })
            );
}

function clientIp(request) {
      return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

function json(payload, status = 200, headers = {}) {
      return new Response(JSON.stringify(payload), {
              status,
              headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store, no-cache",
                        "Pragma": "no-cache",
                        ...headers
              }
      });
}

function clearSessionCookie() {
      return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function sessionCookie(request, value) {
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

async function readJson(request) {
      const raw = await request.text();
      if (!raw) return {};
      if (raw.length > 4096) throw new Error("Payload too large");
      try {
              return JSON.parse(raw);
      } catch {
              throw new Error("Invalid JSON payload");
      }
}

const FORBIDDEN_CONTENT_KEYS = new Set([
      "transcript",
      "transcription",
      "translation",
      "translatedText",
      "sourceText",
      "targetText",
      "text",
      "message",
      "content",
      "audio",
      "audioData",
      "conversation",
      "transcriptText",
      "translated_text",
      "source_text",
      "target_text",
      "utterance",
      "caption",
      "segments",
      "items",
      "messages",
      "recording",
      "blob",
      "media",
      "file",
      "mimeType"
]);

function hasForbiddenContentPayload(value) {
      if (!value || typeof value !== "object") return false;
      for (const [key, child] of Object.entries(value)) {
              if (FORBIDDEN_CONTENT_KEYS.has(key)) return true;
              if (hasForbiddenContentPayload(child)) return true;
      }
      return false;
}

function rejectContentPayload(payload) {
      if (hasForbiddenContentPayload(payload)) {
              throw new Error("Conversation text, translation text, and audio payloads are not accepted");
      }
}

function requireAllowedPayload(payload, allowedKeys) {
      rejectContentPayload(payload);
      for (const key of Object.keys(payload || {})) {
              if (!allowedKeys.has(key)) throw new Error(`Unsupported metadata field: ${key}`);
      }
}

function assertSameOrigin(request, env) {
      if (request.method === "GET" || request.method === "HEAD") return true;
      const origin = request.headers.get("Origin");
      if (!origin) return true;
      const requestOrigin = new URL(request.url).origin;
      if (origin === requestOrigin) return true;
      const allowed = new Set(envList(env, "ALLOWED_ORIGINS"));
      return allowed.has(origin);
}

function requireKv(env) {
      if (!env.SESSION_KV) throw new Error("SESSION_KV binding is not configured");
      return env.SESSION_KV;
}

function getDeviceId(request) {
      return String(request.headers.get("X-Device-Id") || "").trim();
}

function isValidDeviceId(deviceId) {
      const value = String(deviceId || "").trim();
      return value.length >= 8 && value.length <= 128;
}

async function getUserDeviceBinding(env, accessIdHash) {
      return requireKv(env).get(`user-device:${accessIdHash}`, "json");
}

async function bindUserDevice(env, accessIdHash, deviceId, sessionId) {
      const kv = requireKv(env);
      const existing = await getUserDeviceBinding(env, accessIdHash);
      if (existing?.sessionId && existing.sessionId !== sessionId) {
              await kv.delete(`session:${existing.sessionId}`);
      }
      await kv.put(`user-device:${accessIdHash}`, JSON.stringify({ deviceId, sessionId }), {
              expirationTtl: SESSION_TTL_SECONDS
      });
}

async function clearUserDeviceBinding(env, accessIdHash, sessionId) {
      const existing = await getUserDeviceBinding(env, accessIdHash);
      if (existing?.sessionId === sessionId) {
              await requireKv(env).delete(`user-device:${accessIdHash}`);
      }
}

async function revokeUserDeviceBinding(env, accessId) {
      const accessIdHash = await sha256(accessId);
      const existing = await getUserDeviceBinding(env, accessIdHash);
      const kv = requireKv(env);
      if (existing?.sessionId) await kv.delete(`session:${existing.sessionId}`);
      await kv.delete(`user-device:${accessIdHash}`);
}

async function getSession(request, env) {
      const cookie = parseCookies(request)[SESSION_COOKIE];
      if (!cookie) return null;
      const [sessionId, signature] = cookie.split(".");
      if (!sessionId || !signature) return null;
      const expected = await sign(sessionId, env.SESSION_SECRET || "dev-insecure-session-secret");
      if (!constantTimeEqual(signature, expected)) return null;
      const kv = requireKv(env);
      const session = await kv.get(`session:${sessionId}`, "json");
      if (!session) return null;
      if ((session.role || "user") === "user") {
              if (!(await findUserForSession(env, session))) return null;
              const deviceId = getDeviceId(request);
              if (session.deviceId) {
                      if (!deviceId || deviceId !== session.deviceId) return null;
                      const binding = await getUserDeviceBinding(env, session.accessIdHash);
                      if (binding && (binding.sessionId !== sessionId || binding.deviceId !== deviceId)) return null;
                      if (!binding && session.accessIdHash) await bindUserDevice(env, session.accessIdHash, deviceId, sessionId);
              } else if (deviceId && session.accessIdHash) {
                      session.deviceId = deviceId;
                      await kv.put(`session:${sessionId}`, JSON.stringify(session), {
                                expirationTtl: SESSION_TTL_SECONDS
                      });
                      await bindUserDevice(env, session.accessIdHash, deviceId, sessionId);
              }
      }
      return { sessionId, ...session };
}

async function setSession(request, env, accessId, deviceId) {
      const users = await getUsers(env);
      const user = users.find((entry) => idsMatch(entry.id, accessId));
      const sessionId = randomId();
      const accessIdHash = await sha256(accessId);
      const session = {
              accessIdHash,
              label: maskAccessId(accessId),
              role: "user",
              mustChangePassword: !!user?.mustChangePassword,
              deviceId: deviceId || null,
              createdAt: Date.now()
      };
      await requireKv(env).put(`session:${sessionId}`, JSON.stringify(session), {
              expirationTtl: SESSION_TTL_SECONDS
      });
      if (deviceId && accessIdHash) {
              await bindUserDevice(env, accessIdHash, deviceId, sessionId);
      }
      return {
              session,
              cookie: sessionCookie(request, `${sessionId}.${await sign(sessionId, env.SESSION_SECRET || "dev-insecure-session-secret")}`)
      };
}

async function setAdminSession(request, env, email) {
      const sessionId = randomId();
      const session = {
              adminEmailHash: await sha256(normalizeEmail(email)),
              label: maskEmail(email),
              role: "admin",
              createdAt: Date.now()
      };
      await requireKv(env).put(`session:${sessionId}`, JSON.stringify(session), {
              expirationTtl: SESSION_TTL_SECONDS
      });
      return {
              session,
              cookie: sessionCookie(request, `${sessionId}.${await sign(sessionId, env.SESSION_SECRET || "dev-insecure-session-secret")}`)
      };
}

async function isAuthRateLimited(request, env) {
      const windowMs = Number(env.AUTH_WINDOW_MS || 15 * 60 * 1000);
      const maxAttempts = Number(env.AUTH_MAX_ATTEMPTS || 8);
      const bucketKey = `auth-fail:${await sha256(`${clientIp(request)}:${Math.floor(Date.now() / windowMs)}`)}`;
      const current = Number((await requireKv(env).get(bucketKey)) || 0);
      return current >= maxAttempts;
}

async function recordFailedAuthAttempt(request, env) {
      const windowMs = Number(env.AUTH_WINDOW_MS || 15 * 60 * 1000);
      const bucketKey = `auth-fail:${await sha256(`${clientIp(request)}:${Math.floor(Date.now() / windowMs)}`)}`;
      const kv = requireKv(env);
      const current = Number((await kv.get(bucketKey)) || 0) + 1;
      await kv.put(bucketKey, String(current), {
              expirationTtl: Math.max(60, Math.ceil(windowMs / 1000))
      });
}

function buildRealtimeInstructions() {
      return [
              "You are AMALINK Translation, a realtime multilingual interpreter.",
              "Automatically detect which language the speaker is using.",
              "Translate their speech into another language suited for live interpretation.",
              "When the speaker switches language, adapt immediately without asking or commenting.",
              "Speak only the translation. Do not add explanations, labels, or meta commentary.",
              "Keep translations natural, concise, and faithful. Preserve names, numbers, and technical terms."
            ].join(" ");
}

const PLAN_SEEDS = [
      ["free", "Free Trial", 0, 10, 3, 180, 1, 1, 0, 0],
      ["lite", "Business Lite", 9800, 300, 30, 600, 3, 1, 25, 1],
      ["standard", "Business Standard", 29800, 1200, 100, 900, 10, 2, 22, 1],
      ["plus", "Business Plus", 79800, 4000, 300, 1200, 30, 5, 18, 1]
];

function requireDb(env) {
      if (!env.DB) throw new Error("DB binding is not configured");
      return env.DB;
}

function nowMs() {
      return Date.now();
}

function dayKey(timestamp = nowMs()) {
      return new Date(timestamp).toISOString().slice(0, 10);
}

function monthStartMs(timestamp = nowMs()) {
      const date = new Date(timestamp);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function secondsToMinutes(seconds) {
      return Math.ceil(Math.max(0, Number(seconds || 0)) / 60);
}

function costForSeconds(seconds, costPerMinuteJpy) {
      return (Math.max(0, Number(seconds || 0)) / 60) * Number(costPerMinuteJpy || 6.5);
}

async function seedPlans(env) {
      const db = requireDb(env);
      for (const seed of PLAN_SEEDS) {
              await db.prepare(
                    `INSERT OR IGNORE INTO plans (
                      id, name, monthly_price_jpy, monthly_minutes, daily_minutes,
                      max_session_seconds, max_users, max_concurrent_sessions,
                      overage_jpy_per_min, commercial_allowed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(...seed).run();
      }
}

async function audit(env, actor, action, targetType, targetId, metadata = {}) {
      await requireDb(env).prepare(
            `INSERT INTO admin_audit_logs (id, actor, action, target_type, target_id, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(randomId(16), actor || "system", action, targetType, targetId, nowMs(), JSON.stringify(metadata)).run();
}

async function getB2bUserForSession(env, session) {
      if (!session?.accessIdHash) return null;
      await seedPlans(env);
      const db = requireDb(env);
      let row = await db.prepare(
            `SELECT u.*, a.status AS account_status, a.plan_id, a.monthly_revenue_jpy, a.cost_per_minute_jpy,
                    a.model, a.daily_minutes_override, a.monthly_minutes_override,
                    p.monthly_minutes, p.daily_minutes, p.max_session_seconds, p.max_concurrent_sessions,
                    p.monthly_price_jpy
             FROM account_users u
             JOIN accounts a ON a.id = u.account_id
             JOIN plans p ON p.id = a.plan_id
             WHERE u.access_id_hash = ?`
      ).bind(session.accessIdHash).first();
      if (row) return row;

      const sourceUser = await findUserForSession(env, session);
      if (!sourceUser) return null;
      const timestamp = nowMs();
      await db.prepare(
            `INSERT OR IGNORE INTO accounts (
              id, name, industry, plan_id, status, billing_mode, monthly_revenue_jpy,
              cost_per_minute_jpy, model, history_retention_mode, created_at, updated_at
            ) VALUES (?, ?, 'hotel_ryokan', 'free', 'active', 'invoice', 0, 6.5, ?, 'metadata_only', ?, ?)`
      ).bind("acct_default", "Default Trial Account", env.OPENAI_REALTIME_MODEL || "gpt-realtime", timestamp, timestamp).run();
      await db.prepare(
            `INSERT OR IGNORE INTO locations (id, account_id, name, status, created_at, updated_at)
             VALUES (?, 'acct_default', 'Default Location', 'active', ?, ?)`
      ).bind("loc_default", timestamp, timestamp).run();
      await db.prepare(
            `INSERT OR IGNORE INTO account_users (
              id, account_id, location_id, access_id_hash, access_id_label, role, status, created_at, updated_at
            ) VALUES (?, 'acct_default', 'loc_default', ?, ?, 'staff', 'active', ?, ?)`
      ).bind(`usr_${session.accessIdHash.slice(0, 16)}`, session.accessIdHash, maskAccessId(sourceUser.id), timestamp, timestamp).run();

      row = await db.prepare(
            `SELECT u.*, a.status AS account_status, a.plan_id, a.monthly_revenue_jpy, a.cost_per_minute_jpy,
                    a.model, a.industry, a.history_retention_mode, a.daily_minutes_override, a.monthly_minutes_override,
                    p.monthly_minutes, p.daily_minutes, p.max_session_seconds, p.max_concurrent_sessions,
                    p.monthly_price_jpy
             FROM account_users u
             JOIN accounts a ON a.id = u.account_id
             JOIN plans p ON p.id = a.plan_id
             WHERE u.access_id_hash = ?`
      ).bind(session.accessIdHash).first();
      return row;
}

async function closeStaleSessions(env, accountId) {
      const timestamp = nowMs();
      await requireDb(env).prepare(
            `UPDATE usage_sessions
             SET status = 'stale_ended', ended_at = ?, stop_reason = 'stale_timeout', updated_at = ?
             WHERE account_id = ? AND status = 'active' AND last_heartbeat_at < ?`
      ).bind(timestamp, timestamp, accountId, timestamp - 90000).run();
}

async function quotaSnapshot(env, accountId) {
      const db = requireDb(env);
      const timestamp = nowMs();
      await closeStaleSessions(env, accountId);
      const today = dayKey(timestamp);
      const monthStart = monthStartMs(timestamp);
      const account = await db.prepare(
            `SELECT a.*, p.monthly_minutes, p.daily_minutes, p.max_session_seconds, p.max_concurrent_sessions,
                    p.monthly_price_jpy
             FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = ?`
      ).bind(accountId).first();
      if (!account) throw new Error("Account not found");

      const monthRow = await db.prepare(
            `SELECT COALESCE(SUM(billable_seconds), 0) AS seconds, COALESCE(SUM(estimated_cost_jpy), 0) AS cost
             FROM usage_sessions
             WHERE account_id = ? AND started_at >= ?`
      ).bind(accountId, monthStart).first();
      const dayRow = await db.prepare(
            `SELECT COALESCE(billable_seconds, 0) AS seconds, COALESCE(estimated_cost_jpy, 0) AS cost
             FROM usage_daily_rollups WHERE account_id = ? AND date = ?`
      ).bind(accountId, today).first();
      const adjustmentRow = await db.prepare(
            `SELECT COALESCE(SUM(minutes), 0) AS minutes FROM quota_adjustments
             WHERE account_id = ? AND created_at >= ?`
      ).bind(accountId, monthStart).first();
      const activeRow = await db.prepare(
            `SELECT COUNT(*) AS count, COALESCE(SUM(reserved_seconds), 0) AS reserved_seconds
             FROM usage_sessions WHERE account_id = ? AND status = 'active'`
      ).bind(accountId).first();

      const monthlyLimitMinutes = Number(account.monthly_minutes_override || account.monthly_minutes || 0)
            + Number(adjustmentRow?.minutes || 0);
      const dailyLimitMinutes = Number(account.daily_minutes_override || account.daily_minutes || 0);
      const reservedSeconds = Number(activeRow?.reserved_seconds || 0);
      const actualMonthSeconds = Number(monthRow?.seconds || 0);
      const actualDaySeconds = Number(dayRow?.seconds || 0);
      const adjustmentMinutes = Number(adjustmentRow?.minutes || 0);
      const monthSeconds = actualMonthSeconds + reservedSeconds;
      const daySeconds = actualDaySeconds + reservedSeconds;
      const estimatedCostJpy = Number(monthRow?.cost || 0);
      const revenue = Number(account.monthly_revenue_jpy || account.monthly_price_jpy || 0);
      const costRatio = revenue > 0 ? estimatedCostJpy / revenue : 0;

      return {
              account,
              monthSeconds,
              daySeconds,
              estimatedCostJpy,
              actualMonthSeconds,
              actualDaySeconds,
              reservedSeconds,
              adjustmentMinutes,
              monthlyLimitSeconds: monthlyLimitMinutes * 60,
              dailyLimitSeconds: dailyLimitMinutes * 60,
              activeSessions: Number(activeRow?.count || 0),
              costRatio
      };
}

function quotaFailure(snapshot) {
      if (snapshot.account.status !== "active") return "account_suspended";
      if (snapshot.monthSeconds >= snapshot.monthlyLimitSeconds) return "monthly_quota_exhausted";
      if (snapshot.daySeconds >= snapshot.dailyLimitSeconds) return "daily_quota_exhausted";
      if (snapshot.activeSessions >= Number(snapshot.account.max_concurrent_sessions || 1)) return "concurrent_limit";
      if (snapshot.costRatio >= 0.45) return "cost_ratio_stop";
      return null;
}

async function writeUsageDelta(env, sessionRow, deltaSeconds, eventType = "heartbeat") {
      const db = requireDb(env);
      const delta = Math.max(0, Number(deltaSeconds || 0));
      if (!delta) return;
      const timestamp = nowMs();
      const cost = costForSeconds(delta, sessionRow.cost_per_minute_jpy);
      await db.prepare(
            `UPDATE usage_sessions
             SET billable_seconds = billable_seconds + ?,
                 estimated_cost_jpy = estimated_cost_jpy + ?,
                 reserved_seconds = CASE
                   WHEN reserved_seconds > ? THEN reserved_seconds - ?
                   ELSE 0
                 END,
                 last_heartbeat_at = ?,
                 updated_at = ?
             WHERE id = ?`
      ).bind(delta, cost, delta, delta, timestamp, timestamp, sessionRow.id).run();
      await db.prepare(
            `INSERT INTO usage_events (id, session_id, event_type, occurred_at, delta_seconds)
             VALUES (?, ?, ?, ?, ?)`
      ).bind(randomId(16), sessionRow.id, eventType, timestamp, delta).run();
      await db.prepare(
            `INSERT INTO usage_daily_rollups (account_id, date, billable_seconds, estimated_cost_jpy, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(account_id, date) DO UPDATE SET
               billable_seconds = billable_seconds + excluded.billable_seconds,
               estimated_cost_jpy = estimated_cost_jpy + excluded.estimated_cost_jpy,
               updated_at = excluded.updated_at`
      ).bind(sessionRow.account_id, dayKey(timestamp), delta, cost, timestamp).run();
}

async function createRealtimeClientSecret(env, model) {
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
      const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
              method: "POST",
              headers: {
                        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                        "Content-Type": "application/json"
              },
              body: JSON.stringify({
                        session: {
                                    type: "realtime",
                                    model: model || env.OPENAI_REALTIME_MODEL || "gpt-realtime",
                                    instructions: buildRealtimeInstructions(),
                                    output_modalities: ["audio"],
                                    audio: {
                                                  input: {
                                                                  transcription: { model: "gpt-4o-transcribe" },
                                                                  turn_detection: { type: "server_vad" }
                                                  },
                                                  output: { voice: "marin" }
                                    }
                        }
              })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
              console.error("OpenAI Realtime token error:", payload.error?.message || response.statusText);
              throw new Error("Realtime token could not be created");
      }
      return payload.value || payload.client_secret?.value;
}

// ─── ルーティング ───

async function routeApi(request, env) {
      if (!assertSameOrigin(request, env)) return json({ error: "Invalid origin" }, 403);

  const url = new URL(request.url);

  // /api/me
  if (url.pathname === "/api/me" && request.method === "GET") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          return json({ user: userPayload(session) });
  }

  // /api/login
  if (url.pathname === "/api/login" && request.method === "POST") {
          if (await isAuthRateLimited(request, env)) {
                    return json({ error: "ログイン試行が多すぎます。時間を置いて再試行してください。" }, 429);
          }
          const { accessId, password, deviceId } = await readJson(request);
          if (!isValidDeviceId(deviceId)) {
                    return json({ error: "端末情報が無効です。" }, 400);
          }
          if (!(await verifyUserCredentials(env, accessId, password))) {
                    await recordFailedAuthAttempt(request, env);
                    return json({ error: "アクセスIDまたはパスワードが正しくありません。" }, 401);
          }
          const { session, cookie } = await setSession(request, env, accessId, String(deviceId).trim());
          return json({ user: userPayload(session) }, 200, { "Set-Cookie": cookie });
  }

  // POST /api/password  パスワード変更（KV のハッシュを更新）
  if (url.pathname === "/api/password" && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "user") return json({ error: "Forbidden" }, 403);
          if (await isPasswordChangeRateLimited(env, session.sessionId)) {
                    return json({ error: "試行回数が多すぎます。時間を置いて再試行してください。" }, 429);
          }

          const { currentPassword, newPassword } = await readJson(request);
          const current = String(currentPassword || "");
          const next = String(newPassword || "");
          if (!current || !next) return json({ error: "現在のパスワードと新しいパスワードを入力してください。" }, 400);
          const passwordError = validateNewPassword(next, { current });
          if (passwordError) return json({ error: passwordError }, 400);

          const user = await findUserForSession(env, session);
          if (!user?.passwordHash) return json({ error: "ユーザーが見つかりません。" }, 404);
          if (!(await verifyStoredPassword(current, user.passwordHash, env))) {
                    await recordFailedPasswordChange(env, session.sessionId);
                    return json({ error: "現在のパスワードが正しくありません。" }, 401);
          }

          const users = await getUsers(env);
          const index = users.findIndex((entry) => idsMatch(entry.id, user.id));
          if (index < 0) return json({ error: "ユーザーが見つかりません。" }, 404);
          users[index] = {
                    ...users[index],
                    passwordHash: await createPasswordHash(next, env),
                    mustChangePassword: false
          };
          await saveUsers(env, users);

          const rotated = await rotateUserSession(request, env, session, user.id);
          return json(
                    { ok: true, user: userPayload(rotated.session) },
                    200,
                    { "Set-Cookie": rotated.cookie }
          );
  }

  // /api/admin/login
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
          if (await isAuthRateLimited(request, env)) {
                    return json({ error: "ログイン試行が多すぎます。時間を置いて再試行してください。" }, 429);
          }
          const { email, password } = await readJson(request);
          const valid = await verifyAdminCredentials(env, email, password);
          if (!valid) {
                    await recordFailedAuthAttempt(request, env);
                    return json({ error: "メールアドレスまたはパスワードが正しくありません。" }, 401);
          }
          const { session, cookie } = await setAdminSession(request, env, email);
          return json({ user: { id: session.label, role: session.role } }, 200, { "Set-Cookie": cookie });
  }

  // /api/logout
  if (url.pathname === "/api/logout" && request.method === "POST") {
          const session = await getSession(request, env);
          if (session) {
                    if (session.accessIdHash) await clearUserDeviceBinding(env, session.accessIdHash, session.sessionId);
                    await requireKv(env).delete(`session:${session.sessionId}`);
          }
          return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  // /api/realtime-token
  if (url.pathname === "/api/realtime-token" && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if (session.mustChangePassword) {
                    return json({ error: "パスワードを変更してから翻訳を開始してください。" }, 403);
          }
          const { sessionId } = await readJson(request);
          if (!sessionId) return json({ error: "translation session is required" }, 400);
          const b2bUser = await getB2bUserForSession(env, session);
          if (!b2bUser) return json({ error: "Account user not found" }, 404);
          const usageSession = await requireDb(env).prepare(
                `SELECT s.*, a.cost_per_minute_jpy, a.model
                 FROM usage_sessions s JOIN accounts a ON a.id = s.account_id
                 WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'`
          ).bind(sessionId, b2bUser.id).first();
          if (!usageSession) return json({ error: "translation session is not active" }, 403);
          const snapshot = await quotaSnapshot(env, usageSession.account_id);
          const failure = quotaFailure({ ...snapshot, activeSessions: Math.max(0, snapshot.activeSessions - 1) });
          if (failure) return json({ error: failure }, 403);
          const clientSecret = await createRealtimeClientSecret(env, usageSession.model);
          return json({ clientSecret, model: usageSession.model });
  }

  // ─── 管理者専用 API ───

  // GET /api/admin/users  ユーザー一覧取得
  if (url.pathname === "/api/translation-sessions/start" && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if (session.mustChangePassword) return json({ error: "password_change_required" }, 403);
          const body = await readJson(request);
          const b2bUser = await getB2bUserForSession(env, session);
          if (!b2bUser) return json({ error: "Account user not found" }, 404);
          if (b2bUser.status !== "active") return json({ error: "user_suspended" }, 403);
          const snapshot = await quotaSnapshot(env, b2bUser.account_id);
          const failure = quotaFailure(snapshot);
          if (failure) return json({ error: failure }, 403);
          const reserveSeconds = 60;
          if (snapshot.monthlyLimitSeconds - snapshot.monthSeconds < reserveSeconds) {
                return json({ error: "monthly_quota_exhausted" }, 403);
          }
          if (snapshot.dailyLimitSeconds - snapshot.daySeconds < reserveSeconds) {
                return json({ error: "daily_quota_exhausted" }, 403);
          }
          const timestamp = nowMs();
          const id = randomId(18);
          await requireDb(env).prepare(
                `INSERT INTO usage_sessions (
                  id, account_id, location_id, user_id, status, model, started_at,
                  last_heartbeat_at, reserved_seconds, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
          ).bind(
                id,
                b2bUser.account_id,
                body.locationId || b2bUser.location_id || null,
                b2bUser.id,
                snapshot.account.model || env.OPENAI_REALTIME_MODEL || "gpt-realtime",
                timestamp,
                timestamp,
                reserveSeconds,
                timestamp,
                timestamp
          ).run();
          return json({
                sessionId: id,
                remainingSeconds: Math.max(0, snapshot.monthlyLimitSeconds - snapshot.monthSeconds),
                dailyRemainingSeconds: Math.max(0, snapshot.dailyLimitSeconds - snapshot.daySeconds),
                maxSessionSeconds: Number(snapshot.account.max_session_seconds || 180),
                model: snapshot.account.model || env.OPENAI_REALTIME_MODEL || "gpt-realtime"
          });
  }

  if (url.pathname.match(/^\/api\/translation-sessions\/[^/]+\/heartbeat$/) && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          const sessionId = decodeURIComponent(url.pathname.split("/")[3]);
          const b2bUser = await getB2bUserForSession(env, session);
          if (!b2bUser) return json({ error: "Account user not found" }, 404);
          requireAllowedPayload(await readJson(request), new Set(["activeAudioSeconds", "silenceSeconds"]));
          const db = requireDb(env);
          const usageSession = await db.prepare(
                `SELECT s.*, a.cost_per_minute_jpy, p.max_session_seconds
                 FROM usage_sessions s
                 JOIN accounts a ON a.id = s.account_id
                 JOIN plans p ON p.id = a.plan_id
                 WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'`
          ).bind(sessionId, b2bUser.id).first();
          if (!usageSession) return json({ error: "translation session is not active" }, 404);
          const timestamp = nowMs();
          const delta = Math.min(30, Math.max(0, Math.floor((timestamp - Number(usageSession.last_heartbeat_at || usageSession.started_at)) / 1000)));
          await writeUsageDelta(env, usageSession, delta);
          const updated = await db.prepare(
                `SELECT s.*, a.cost_per_minute_jpy, p.max_session_seconds
                 FROM usage_sessions s
                 JOIN accounts a ON a.id = s.account_id
                 JOIN plans p ON p.id = a.plan_id
                 WHERE s.id = ?`
          ).bind(sessionId).first();
          const snapshot = await quotaSnapshot(env, updated.account_id);
          const elapsedSeconds = Math.floor((timestamp - Number(updated.started_at)) / 1000);
          let stopReason = null;
          if (elapsedSeconds >= Number(updated.max_session_seconds || 180)) stopReason = "session_limit";
          else if (snapshot.monthSeconds >= snapshot.monthlyLimitSeconds) stopReason = "monthly_quota_exhausted";
          else if (snapshot.daySeconds >= snapshot.dailyLimitSeconds) stopReason = "daily_quota_exhausted";
          return json({
                ok: true,
                remainingSeconds: Math.max(0, snapshot.monthlyLimitSeconds - snapshot.monthSeconds),
                dailyRemainingSeconds: Math.max(0, snapshot.dailyLimitSeconds - snapshot.daySeconds),
                shouldStop: !!stopReason,
                stopReason
          });
  }

  if (url.pathname.match(/^\/api\/translation-sessions\/[^/]+\/end$/) && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          const sessionId = decodeURIComponent(url.pathname.split("/")[3]);
          const endPayload = await readJson(request);
          requireAllowedPayload(endPayload, new Set(["reason"]));
          const { reason } = endPayload;
          const b2bUser = await getB2bUserForSession(env, session);
          if (!b2bUser) return json({ error: "Account user not found" }, 404);
          const db = requireDb(env);
          const usageSession = await db.prepare(
                `SELECT s.*, a.cost_per_minute_jpy
                 FROM usage_sessions s JOIN accounts a ON a.id = s.account_id
                 WHERE s.id = ? AND s.user_id = ?`
          ).bind(sessionId, b2bUser.id).first();
          if (!usageSession) return json({ error: "translation session not found" }, 404);
          if (usageSession.status === "active") {
                const timestamp = nowMs();
                const delta = Math.min(30, Math.max(0, Math.floor((timestamp - Number(usageSession.last_heartbeat_at || usageSession.started_at)) / 1000)));
                await writeUsageDelta(env, usageSession, delta, "end");
                await db.prepare(
                      `UPDATE usage_sessions SET status = 'ended', ended_at = ?, stop_reason = ?, updated_at = ? WHERE id = ?`
                ).bind(timestamp, String(reason || "client_end"), timestamp, sessionId).run();
          }
          const ended = await db.prepare(`SELECT billable_seconds, estimated_cost_jpy FROM usage_sessions WHERE id = ?`).bind(sessionId).first();
          return json({
                ok: true,
                billableSeconds: Number(ended?.billable_seconds || 0),
                estimatedCostJpy: Number(ended?.estimated_cost_jpy || 0)
          });
  }

  if (url.pathname === "/api/me/usage" && request.method === "GET") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          const b2bUser = await getB2bUserForSession(env, session);
          if (!b2bUser) return json({ error: "Account user not found" }, 404);
          const snapshot = await quotaSnapshot(env, b2bUser.account_id);
          return json({
                planId: snapshot.account.plan_id,
                monthUsedSeconds: snapshot.monthSeconds,
                dailyUsedSeconds: snapshot.daySeconds,
                remainingSeconds: Math.max(0, snapshot.monthlyLimitSeconds - snapshot.monthSeconds),
                dailyRemainingSeconds: Math.max(0, snapshot.dailyLimitSeconds - snapshot.daySeconds),
                maxSessionSeconds: Number(snapshot.account.max_session_seconds || 180)
          });
  }

  if (url.pathname === "/api/admin/accounts" && request.method === "GET") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);
          await seedPlans(env);
          const rows = await requireDb(env).prepare(
                `SELECT a.id, a.name, a.status, a.industry, a.history_retention_mode, a.plan_id,
                        a.monthly_revenue_jpy, a.cost_per_minute_jpy, a.model,
                        p.name AS plan_name, p.monthly_minutes, p.daily_minutes,
                        p.max_concurrent_sessions, p.max_session_seconds
                 FROM accounts a
                 JOIN plans p ON p.id = a.plan_id
                 ORDER BY a.created_at DESC`
          ).all();
          const accounts = [];
          for (const row of rows.results || []) {
                const snapshot = await quotaSnapshot(env, row.id);
                accounts.push({
                      ...row,
                      month_seconds: snapshot.actualMonthSeconds,
                      daily_seconds: snapshot.actualDaySeconds,
                      reserved_seconds: snapshot.reservedSeconds,
                      adjustment_minutes: snapshot.adjustmentMinutes,
                      estimated_cost_jpy: snapshot.estimatedCostJpy,
                      active_sessions: snapshot.activeSessions,
                      cost_ratio: snapshot.costRatio,
                      monthly_limit_seconds: snapshot.monthlyLimitSeconds,
                      daily_limit_seconds: snapshot.dailyLimitSeconds,
                      remaining_seconds: Math.max(0, snapshot.monthlyLimitSeconds - snapshot.monthSeconds),
                      daily_remaining_seconds: Math.max(0, snapshot.dailyLimitSeconds - snapshot.daySeconds)
                });
          }
          return json({ accounts });
  }

  if (url.pathname.match(/^\/api\/admin\/accounts\/[^/]+\/status$/) && request.method === "PATCH") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);
          const accountId = decodeURIComponent(url.pathname.split("/")[4]);
          const { status } = await readJson(request);
          if (!["active", "suspended"].includes(status)) return json({ error: "Invalid status" }, 400);
          await requireDb(env).prepare(`UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?`).bind(status, nowMs(), accountId).run();
          await audit(env, session.label, "account_status", "account", accountId, { status });
          return json({ ok: true });
  }

  if (url.pathname.match(/^\/api\/admin\/accounts\/[^/]+\/quota-adjustments$/) && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);
          const accountId = decodeURIComponent(url.pathname.split("/")[4]);
          const { minutes, priceJpy, reason } = await readJson(request);
          const value = Math.max(0, Number(minutes || 0));
          if (!value) return json({ error: "minutes is required" }, 400);
          await requireDb(env).prepare(
                `INSERT INTO quota_adjustments (id, account_id, minutes, price_jpy, reason, created_at, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(randomId(16), accountId, value, Number(priceJpy || 0), String(reason || "manual"), nowMs(), session.label).run();
          await audit(env, session.label, "quota_adjustment", "account", accountId, { minutes: value, priceJpy });
          return json({ ok: true });
  }

  if (url.pathname === "/api/admin/users" && request.method === "GET") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);
          const users = await getUsers(env);
          return json({ users: publicUsers(users) });
  }

  // POST /api/admin/users  ユーザー追加
  if (url.pathname === "/api/admin/users" && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);

        const { id, password } = await readJson(request);
          const normalizedId = normalizeId(id);
          if (!normalizedId || normalizedId.length > 128) {
                    return json({ error: "IDが無効です" }, 400);
          }

        let plainPassword = String(password || "").trim();
          if (!plainPassword) plainPassword = generateInitialPassword();
          if (plainPassword.length < 8) {
                    return json({ error: "パスワードは8文字以上必要です" }, 400);
          }

        const users = await getUsers(env);
          if (users.some((user) => idsMatch(user.id, normalizedId))) {
                    return json({ error: "そのIDはすでに存在します" }, 409);
          }
          const passwordHash = await createPasswordHash(plainPassword, env);
          users.push({ id: normalizedId, role: "user", seeded: false, passwordHash, mustChangePassword: true });
          await saveUsers(env, users);
          return json({ ok: true, users: publicUsers(users), initialPassword: plainPassword });
  }

  // DELETE /api/admin/users/:id  ユーザー削除
  if (url.pathname.startsWith("/api/admin/users/") && request.method === "DELETE") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);

        const targetId = decodeURIComponent(url.pathname.replace("/api/admin/users/", ""));

        if (envList(env, "ALLOWED_LOGIN_IDS").some((id) => idsMatch(id, targetId))) {
                  return json({ error: "環境設定で定義されたIDは削除できません。" }, 403);
        }

        const users = await getUsers(env);
          const filtered = users.filter((u) => !idsMatch(u.id, targetId));
          if (filtered.length === users.length) return json({ error: "ユーザーが見つかりません" }, 404);
          const removed = users.find((u) => idsMatch(u.id, targetId));
          if (removed) await revokeUserDeviceBinding(env, removed.id);
          await saveUsers(env, filtered);
          return json({ ok: true, users: publicUsers(filtered) });
  }

  return json({ error: "Not found" }, 404);
}

export async function onRequest(context) {
      try {
              return await routeApi(context.request, context.env);
      } catch (error) {
              const message = error.message || "Server error";
              const status = message === "Invalid JSON payload" ||
                    message === "Payload too large" ||
                    message === "Conversation text, translation text, and audio payloads are not accepted"
                    ? 400
                    : 500;
              return json({ error: message }, status);
      }
}
