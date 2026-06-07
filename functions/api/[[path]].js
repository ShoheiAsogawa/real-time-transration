const SESSION_COOKIE = "ll_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const USERS_KV_KEY = "users:config";

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

// ─── ユーザー管理（KV永続化） ───

// KVからユーザー一覧を取得。未設定時はwrangler.tomlの値で初期化
async function getUsers(env) {
      const kv = requireKv(env);
      const stored = await kv.get(USERS_KV_KEY, "json");
      if (stored && Array.isArray(stored)) return stored;

  // 初回: wrangler.toml の ALLOWED_LOGIN_IDS / USER_ROLES から初期データ生成
  const roleMap = {};
      for (const entry of envList(env, "USER_ROLES")) {
              const idx = entry.lastIndexOf(":");
              if (idx < 1) continue;
              roleMap[entry.slice(0, idx).trim()] = entry.slice(idx + 1).trim().toLowerCase();
      }
      const users = envList(env, "ALLOWED_LOGIN_IDS").map((id) => ({
              id,
              role: roleMap[id] || "user"
      }));
      if (users.length > 0) {
              await kv.put(USERS_KV_KEY, JSON.stringify(users));
      }
      return users;
}

async function saveUsers(env, users) {
      await requireKv(env).put(USERS_KV_KEY, JSON.stringify(users));
}

async function isAllowedAccessId(env, accessId) {
      const normalized = normalizeId(accessId);
      if (!normalized || normalized.length > 128) return false;
      const users = await getUsers(env);
      return users.some((u) => constantTimeEqual(u.id, normalized));
}

async function getRoleForAccessId(env, accessId) {
      const normalized = normalizeId(accessId);
      const users = await getUsers(env);
      const user = users.find((u) => constantTimeEqual(u.id, normalized));
      return user ? user.role : "user";
}

function maskAccessId(accessId) {
      const id = normalizeId(accessId);
      if (id.length <= 6) return "issued-id";
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
                        "Cache-Control": "no-store",
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
      return JSON.parse(raw);
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
      const sessionId = randomId();
      const role = await getRoleForAccessId(env, accessId);
      const session = {
              accessIdHash: await sha256(accessId),
              label: maskAccessId(accessId),
              role,
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

async function checkRateLimit(request, env) {
      const windowMs = Number(env.AUTH_WINDOW_MS || 15 * 60 * 1000);
      const maxAttempts = Number(env.AUTH_MAX_ATTEMPTS || 8);
      const bucketKey = `rate:${await sha256(`${clientIp(request)}:${Math.floor(Date.now() / windowMs)}`)}`;
      const kv = requireKv(env);
      const current = Number((await kv.get(bucketKey)) || 0) + 1;
      await kv.put(bucketKey, String(current), {
              expirationTtl: Math.max(60, Math.ceil(windowMs / 1000))
      });
      return current <= maxAttempts;
}

function buildRealtimeInstructions() {
      return [
              "You are LinguaLive, a realtime Japanese-English interpreter.",
              "Automatically detect whether the speaker is using Japanese or English.",
              "If the speaker uses Japanese, translate into natural English.",
              "If the speaker uses English, translate into natural Japanese.",
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
          return json({ user: { id: session.label, role: session.role || "user" } });
  }

  // /api/login
  if (url.pathname === "/api/login" && request.method === "POST") {
          if (!(await checkRateLimit(request, env))) {
                    return json({ error: "ログイン試行が多すぎます。時間を置いて再試行してください。" }, 429);
          }
          const { accessId } = await readJson(request);
          if (!(await isAllowedAccessId(env, accessId))) {
                    return json({ error: "このアクセスIDではログインできません。" }, 401);
          }
          const { session, cookie } = await setSession(request, env, accessId);
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
          return json({ users });
  }

  // POST /api/admin/users  ユーザー追加
  if (url.pathname === "/api/admin/users" && request.method === "POST") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);

        const { id, role } = await readJson(request);
          const normalizedId = normalizeId(id);
          if (!normalizedId || normalizedId.length > 128) {
                    return json({ error: "IDが無効です" }, 400);
          }
          const validRole = role === "admin" ? "admin" : "user";

        const users = await getUsers(env);
          if (users.some((u) => u.id === normalizedId)) {
                    return json({ error: "そのIDはすでに存在します" }, 409);
          }
          users.push({ id: normalizedId, role: validRole });
          await saveUsers(env, users);
          return json({ ok: true, users });
  }

  // PATCH /api/admin/users/:id  ロール変更
  if (url.pathname.startsWith("/api/admin/users/") && request.method === "PATCH") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);

        const targetId = decodeURIComponent(url.pathname.replace("/api/admin/users/", ""));
          const { role } = await readJson(request);
          const validRole = role === "admin" ? "admin" : "user";

        const users = await getUsers(env);
          const idx = users.findIndex((u) => u.id === targetId);
          if (idx < 0) return json({ error: "ユーザーが見つかりません" }, 404);
          users[idx].role = validRole;
          await saveUsers(env, users);
          return json({ ok: true, users });
  }

  // DELETE /api/admin/users/:id  ユーザー削除
  if (url.pathname.startsWith("/api/admin/users/") && request.method === "DELETE") {
          const session = await getSession(request, env);
          if (!session) return json({ error: "Not authenticated" }, 401);
          if ((session.role || "user") !== "admin") return json({ error: "Forbidden" }, 403);

        const targetId = decodeURIComponent(url.pathname.replace("/api/admin/users/", ""));

        // 自分自身は削除不可
        const myHash = session.accessIdHash;
          const targetHash = await sha256(targetId);
          if (constantTimeEqual(myHash, targetHash)) {
                    return json({ error: "自分自身は削除できません" }, 400);
          }

        const users = await getUsers(env);
          const filtered = users.filter((u) => u.id !== targetId);
          if (filtered.length === users.length) return json({ error: "ユーザーが見つかりません" }, 404);
          await saveUsers(env, filtered);
          return json({ ok: true, users: filtered });
  }

  return json({ error: "Not found" }, 404);
}

export async function onRequest(context) {
      try {
              return await routeApi(context.request, context.env);
      } catch (error) {
              return json({ error: error.message || "Server error" }, 500);
      }
}
