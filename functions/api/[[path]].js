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
      return setSession(request, env, accessId);
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

async function getSession(request, env) {
      const cookie = parseCookies(request)[SESSION_COOKIE];
      if (!cookie) return null;
      const [sessionId, signature] = cookie.split(".");
      if (!sessionId || !signature) return null;
      const expected = await sign(sessionId, env.SESSION_SECRET || "dev-insecure-session-secret");
      if (!constantTimeEqual(signature, expected)) return null;
      const session = await requireKv(env).get(`session:${sessionId}`, "json");
      if (!session) return null;
      return { sessionId, ...session };
}

async function setSession(request, env, accessId) {
      const users = await getUsers(env);
      const user = users.find((entry) => idsMatch(entry.id, accessId));
      const sessionId = randomId();
      const session = {
              accessIdHash: await sha256(accessId),
              label: maskAccessId(accessId),
              role: "user",
              mustChangePassword: !!user?.mustChangePassword,
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

async function createRealtimeClientSecret(env) {
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
                                    model: env.OPENAI_REALTIME_MODEL || "gpt-realtime",
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
          const { accessId, password } = await readJson(request);
          if (!(await verifyUserCredentials(env, accessId, password))) {
                    await recordFailedAuthAttempt(request, env);
                    return json({ error: "アクセスIDまたはパスワードが正しくありません。" }, 401);
          }
          const { session, cookie } = await setSession(request, env, accessId);
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
          if (session) await requireKv(env).delete(`session:${session.sessionId}`);
          return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  // /api/realtime-token
  if (url.pathname === "/api/realtime-token" && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if (session.mustChangePassword) {
                    return json({ error: "パスワードを変更してから翻訳を開始してください。" }, 403);
          }
          await readJson(request);
          const clientSecret = await createRealtimeClientSecret(env);
          return json({ clientSecret });
  }

  // ─── 管理者専用 API ───

  // GET /api/admin/users  ユーザー一覧取得
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
              const status = message === "Invalid JSON payload" || message === "Payload too large" ? 400 : 500;
              return json({ error: message }, status);
      }
}
