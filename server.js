import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const passwordPepperValue = String(process.env.PASSWORD_PEPPER || sessionSecret || "").trim();
const PBKDF2_ITERATIONS_NEW = 100000;
const DUMMY_PASSWORD_HASH =
  "100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";
const passwordMaxAttempts = Number(process.env.PASSWORD_MAX_ATTEMPTS || 5);
const passwordChangeAttempts = new Map();
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}`)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const authWindowMs = Number(process.env.AUTH_WINDOW_MS || 15 * 60 * 1000);
const authMaxAttempts = Number(process.env.AUTH_MAX_ATTEMPTS || 8);

const sessions = new Map();
const loginAttempts = new Map();
const allowedPlainIds = new Set(
  (process.env.ALLOWED_LOGIN_IDS || "")
    .split(",")
    .map((id) => normalizeId(id))
    .filter(Boolean)
);
const allowedIdHashes = new Set(
  (process.env.ALLOWED_LOGIN_ID_HASHES || "")
    .split(",")
    .map((hash) => hash.trim().toLowerCase())
    .filter(Boolean)
);
const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || "admin@lingualive.local");
const adminPasswordHash = String(
  process.env.ADMIN_PASSWORD_HASH ||
    "100000:5249adba9d8262a7ece249fc646bcd88:03f60ebcef08a074621d70a9548d13fa41668b9b104222c35f221d0b742d91f0"
).trim();
const seedUserPasswordHash = String(
  process.env.SEED_USER_PASSWORD_HASH ||
    "100000:9ef51164921ca81a5a7e1b32b8b434f3:9c3d25891f6e8c6072fe100479e4f0032a66fe4fe6c9183e17a2bd4137061f40"
).trim();
const users = [...allowedPlainIds].map((id) => ({
  id,
  role: "user",
  seeded: true,
  passwordHash: seedUserPasswordHash
}));

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password, salt, iterations = 100000) {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
}

function applyPasswordPepper(password) {
  if (!passwordPepperValue) return password;
  return `${passwordPepperValue}:${password}`;
}

function verifyStoredPassword(password, storedHash) {
  if (passwordPepperValue) {
    if (verifyPassword(applyPasswordPepper(password), storedHash)) return true;
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

function verifyPassword(password, storedHash) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;
  const { iterations, salt, expectedHash } = parsed;
  const actualHash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  const actualBuffer = Buffer.from(actualHash);
  const expectedBuffer = Buffer.from(expectedHash);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const material = applyPasswordPepper(String(password || ""));
  const hash = hashPassword(material, salt, PBKDF2_ITERATIONS_NEW);
  return `${PBKDF2_ITERATIONS_NEW}:${salt}:${hash}`;
}

function generateInitialPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(12), (byte) => chars[byte % chars.length]).join("");
}

function publicUsers(list) {
  return list.map(({ id, role, seeded, passwordHash, mustChangePassword }) => ({
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

function findUserForSession(session) {
  if (!session?.accessIdHash) return null;
  return users.find((user) => hashAccessId(user.id) === session.accessIdHash) || null;
}

function updateSessionRecord(sessionId, patch) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const updated = { ...session, ...patch };
  sessions.set(sessionId, updated);
  return updated;
}

function rotateUserSession(res, oldSession, accessId) {
  sessions.delete(oldSession.sessionId);
  return setSession(res, accessId);
}

function isPasswordChangeRateLimited(sessionId) {
  return isRateLimited(passwordChangeAttempts, sessionId, passwordMaxAttempts, authWindowMs);
}

function recordFailedPasswordChange(sessionId) {
  recordFailedAttempt(passwordChangeAttempts, sessionId, authWindowMs);
}

function verifyUserCredentials(accessId, password) {
  const normalized = normalizeId(accessId);
  const user = normalized ? users.find((entry) => idsEqual(entry.id, normalized)) : null;
  const hashToCheck = user?.passwordHash || DUMMY_PASSWORD_HASH;
  const ok = verifyStoredPassword(String(password || ""), hashToCheck);
  return ok && !!user?.passwordHash;
}

function verifyAdminCredentials(email, password) {
  if (!adminEmail || !adminPasswordHash) return false;
  const normalizedEmail = normalizeEmail(email);
  const emailBuffer = Buffer.from(normalizedEmail);
  const configuredBuffer = Buffer.from(adminEmail);
  if (emailBuffer.length !== configuredBuffer.length || !crypto.timingSafeEqual(emailBuffer, configuredBuffer)) {
    return false;
  }
  return verifyPassword(String(password || ""), adminPasswordHash);
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "admin";
  const maskedLocal = local.length <= 2 ? `${local[0]}*` : `${local.slice(0, 2)}***`;
  return `${maskedLocal}@${domain}`;
}

function hashAccessId(accessId) {
  return crypto.createHash("sha256").update(accessId).digest("hex");
}

function timingSafeIncludes(set, value) {
  const valueBuffer = Buffer.from(value);
  for (const item of set) {
    const itemBuffer = Buffer.from(item);
    if (itemBuffer.length === valueBuffer.length && crypto.timingSafeEqual(itemBuffer, valueBuffer)) {
      return true;
    }
  }
  return false;
}

function isAllowedAccessId(accessId) {
  const normalized = normalizeId(accessId);
  if (!normalized || normalized.length > 128) return false;
  for (const id of allowedPlainIds) {
    if (id.length === normalized.length && crypto.timingSafeEqual(Buffer.from(id), Buffer.from(normalized))) {
      return true;
    }
  }
  if (users.some((user) => {
    if (user.id.length !== normalized.length) return false;
    return crypto.timingSafeEqual(Buffer.from(user.id), Buffer.from(normalized));
  })) {
    return true;
  }
  if (allowedIdHashes.size && timingSafeIncludes(allowedIdHashes, hashAccessId(normalized))) return true;
  return false;
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function createCookie(sessionId) {
  return `${sessionId}.${sign(sessionId)}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function getSession(req) {
  const cookie = parseCookies(req).ll_session;
  if (!cookie) return null;

  const [sessionId, signature] = cookie.split(".");
  if (!sessionId || !signature || signature !== sign(sessionId)) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { sessionId, ...session };
}

function setSession(res, accessId) {
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const user = users.find((entry) => idsEqual(entry.id, accessId));
  sessions.set(sessionId, {
    accessIdHash: hashAccessId(accessId),
    label: maskAccessId(accessId),
    role: "user",
    mustChangePassword: !!user?.mustChangePassword,
    expiresAt
  });
  res.setHeader(
    "Set-Cookie",
    `ll_session=${encodeURIComponent(createCookie(sessionId))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`
  );
  return sessions.get(sessionId);
}

function setAdminSession(res, email) {
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  sessions.set(sessionId, {
    adminEmailHash: hashAccessId(normalizeEmail(email)),
    label: maskEmail(email),
    role: "admin",
    expiresAt
  });
  res.setHeader(
    "Set-Cookie",
    `ll_session=${encodeURIComponent(createCookie(sessionId))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`
  );
  return sessions.get(sessionId);
}

function clearSession(res) {
  res.setHeader("Set-Cookie", "ll_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
}

function sortUsers(list) {
  return [...list].sort((a, b) => a.id.localeCompare(b.id, "ja"));
}

function idsEqual(a, b) {
  const left = normalizeId(a);
  const right = normalizeId(b);
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function maskAccessId(accessId) {
  const id = normalizeId(accessId);
  if (id.length <= 2) return "•••";
  if (id.length <= 6) return `${id[0]}${"•".repeat(Math.max(1, id.length - 2))}${id[id.length - 1]}`;
  return `${id.slice(0, 4)}...${id.slice(-2)}`;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function isRateLimited(bucket, key, max, windowMs) {
  const now = Date.now();
  const current = bucket.get(key);
  if (!current || current.resetAt <= now) return false;
  return current.count >= max;
}

function recordFailedAttempt(bucket, key, windowMs) {
  const now = Date.now();
  const current = bucket.get(key);
  if (!current || current.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache",
    "Pragma": "no-cache"
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  if (raw.length > 4096) throw new Error("Payload too large");
  return JSON.parse(raw);
}

function assertSameOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' https://api.openai.com",
      "media-src 'self' blob:",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join("; ")
  );
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  let safePath = requestPath;
  if (safePath === "/") safePath = "/index.html";
  else if (safePath.endsWith("/")) safePath = `${safePath}index.html`;
  const filePath = path.normalize(path.join(__dirname, safePath));
  const relative = path.relative(__dirname, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      json(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8"
    };
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(data);
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

async function createRealtimeClientSecret() {
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const instructions = buildRealtimeInstructions();

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: realtimeModel,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-transcribe"
            },
            turn_detection: {
              type: "server_vad"
            }
          },
          output: {
            voice: "marin"
          }
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

async function routeApi(req, res) {
  if (!assertSameOrigin(req)) {
    json(res, 403, { error: "Invalid origin" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/me" && req.method === "GET") {
    const session = getSession(req);
    if (!session) {
      json(res, 401, { error: "Not authenticated" });
      return;
    }
    json(res, 200, { user: userPayload(session) });
    return;
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const ip = clientIp(req);
    if (isRateLimited(loginAttempts, ip, authMaxAttempts, authWindowMs)) {
      json(res, 429, { error: "ログイン試行が多すぎます。時間を置いて再試行してください。" });
      return;
    }

    const { email, password } = await readJson(req);
    if (!verifyAdminCredentials(email, password)) {
      recordFailedAttempt(loginAttempts, ip, authWindowMs);
      json(res, 401, { error: "メールアドレスまたはパスワードが正しくありません。" });
      return;
    }

    const session = setAdminSession(res, email);
    json(res, 200, {
      user: {
        id: session.label,
        role: session.role
      }
    });
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const ip = clientIp(req);
    if (isRateLimited(loginAttempts, ip, authMaxAttempts, authWindowMs)) {
      json(res, 429, { error: "ログイン試行が多すぎます。時間を置いて再試行してください。" });
      return;
    }

    const { accessId, password } = await readJson(req);
    if (!verifyUserCredentials(accessId, password)) {
      recordFailedAttempt(loginAttempts, ip, authWindowMs);
      json(res, 401, { error: "アクセスIDまたはパスワードが正しくありません。" });
      return;
    }

    const session = setSession(res, accessId);
    json(res, 200, { user: userPayload(session) });
    return;
  }

  if (url.pathname === "/api/password" && req.method === "POST") {
    const session = getSession(req);
    if (!session) {
      json(res, 401, { error: "Not authenticated" });
      return;
    }
    if ((session.role || "user") !== "user") {
      json(res, 403, { error: "Forbidden" });
      return;
    }
    if (isPasswordChangeRateLimited(session.sessionId)) {
      json(res, 429, { error: "試行回数が多すぎます。時間を置いて再試行してください。" });
      return;
    }

    const { currentPassword, newPassword } = await readJson(req);
    const current = String(currentPassword || "");
    const next = String(newPassword || "");
    if (!current || !next) {
      json(res, 400, { error: "現在のパスワードと新しいパスワードを入力してください。" });
      return;
    }
    const passwordError = validateNewPassword(next, { current });
    if (passwordError) {
      json(res, 400, { error: passwordError });
      return;
    }

    const user = findUserForSession(session);
    if (!user?.passwordHash) {
      json(res, 404, { error: "ユーザーが見つかりません。" });
      return;
    }
    if (!verifyStoredPassword(current, user.passwordHash)) {
      recordFailedPasswordChange(session.sessionId);
      json(res, 401, { error: "現在のパスワードが正しくありません。" });
      return;
    }

    const index = users.findIndex((entry) => idsEqual(entry.id, user.id));
    if (index < 0) {
      json(res, 404, { error: "ユーザーが見つかりません。" });
      return;
    }
    users[index] = {
      ...users[index],
      passwordHash: createPasswordHash(next),
      mustChangePassword: false
    };

    const rotated = rotateUserSession(res, session, user.id);
    json(res, 200, {
      ok: true,
      user: userPayload(rotated)
    });
    return;
  }

  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const session = getSession(req);
    if (!session) {
      json(res, 401, { error: "Not authenticated" });
      return;
    }
    if ((session.role || "user") !== "admin") {
      json(res, 403, { error: "Forbidden" });
      return;
    }
    json(res, 200, { users: publicUsers(sortUsers(users)) });
    return;
  }

  if (url.pathname === "/api/admin/users" && req.method === "POST") {
    const session = getSession(req);
    if (!session) {
      json(res, 401, { error: "Not authenticated" });
      return;
    }
    if ((session.role || "user") !== "admin") {
      json(res, 403, { error: "Forbidden" });
      return;
    }

    const { id, password } = await readJson(req);
    const normalizedId = normalizeId(id);
    if (!normalizedId || normalizedId.length > 128) {
      json(res, 400, { error: "IDが無効です" });
      return;
    }
    if (users.some((user) => idsEqual(user.id, normalizedId))) {
      json(res, 409, { error: "そのIDはすでに存在します" });
      return;
    }
    let plainPassword = String(password || "").trim();
    if (!plainPassword) plainPassword = generateInitialPassword();
    if (plainPassword.length < 8) {
      json(res, 400, { error: "パスワードは8文字以上必要です" });
      return;
    }
    users.push({
      id: normalizedId,
      role: "user",
      seeded: false,
      passwordHash: createPasswordHash(plainPassword),
      mustChangePassword: true
    });
    allowedPlainIds.add(normalizedId);
    json(res, 200, { ok: true, users: publicUsers(sortUsers(users)), initialPassword: plainPassword });
    return;
  }

  if (url.pathname.startsWith("/api/admin/users/") && req.method === "DELETE") {
    const session = getSession(req);
    if (!session) {
      json(res, 401, { error: "Not authenticated" });
      return;
    }
    if ((session.role || "user") !== "admin") {
      json(res, 403, { error: "Forbidden" });
      return;
    }

    const targetId = decodeURIComponent(url.pathname.replace("/api/admin/users/", ""));

    const index = users.findIndex((user) => idsEqual(user.id, targetId));
    if (index < 0) {
      json(res, 404, { error: "ユーザーが見つかりません" });
      return;
    }
    if (users[index].seeded) {
      json(res, 403, { error: "環境設定で定義されたIDは削除できません。" });
      return;
    }
    users.splice(index, 1);
    allowedPlainIds.delete(targetId);
    json(res, 200, { ok: true, users: publicUsers(sortUsers(users)) });
    return;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const session = getSession(req);
    if (session) sessions.delete(session.sessionId);
    clearSession(res);
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/realtime-token" && req.method === "POST") {
    const session = getSession(req);
    if (!session) {
      json(res, 401, { error: "Not authenticated" });
      return;
    }
    if (session.mustChangePassword) {
      json(res, 403, { error: "パスワードを変更してから翻訳を開始してください。" });
      return;
    }

    await readJson(req);
    const clientSecret = await createRealtimeClientSecret();
    json(res, 200, { clientSecret });
    return;
  }

  json(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);

  try {
    if (req.url.startsWith("/api/")) {
      await routeApi(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    json(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`AMALINK Translation running on http://localhost:${port}`);
  if (!allowedPlainIds.size && !allowedIdHashes.size) {
    console.warn("No ALLOWED_LOGIN_IDS or ALLOWED_LOGIN_ID_HASHES configured. Login will reject everyone.");
  }
});
