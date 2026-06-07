const HISTORY_KEY = "lingualive_history_v2";

const state = {
      pc: null, dc: null, stream: null, user: null,
      turns: [], activeTurn: null,
      sessionId: null, sessionStartedAt: null,
      viewingHistory: false,
      adminUsers: []
};

// DOM refs
const authView = document.querySelector("#authView");
const adminAuthView = document.querySelector("#adminAuthView");
const translatorView = document.querySelector("#translatorView");
const adminView = document.querySelector("#adminView");
const loginForm = document.querySelector("#loginForm");
const adminLoginForm = document.querySelector("#adminLoginForm");
const accessIdInput = document.querySelector("#accessId");
const pasteAccessIdBtn = document.querySelector("#pasteAccessId");
const adminEmailInput = document.querySelector("#adminEmail");
const adminPasswordInput = document.querySelector("#adminPassword");
const authMessage = document.querySelector("#authMessage");
const adminAuthMessage = document.querySelector("#adminAuthMessage");
const loginSubmit = document.querySelector("#loginSubmit");
const adminLoginSubmit = document.querySelector("#adminLoginSubmit");
const showAdminLogin = document.querySelector("#showAdminLogin");
const showUserLogin = document.querySelector("#showUserLogin");
const logoutButton = document.querySelector("#logoutButton");
const adminLogoutButton = document.querySelector("#adminLogoutButton");
const micButton = document.querySelector("#micButton");
const micHint = document.querySelector("#micHint");
const micLabel = document.querySelector("#micLabel");
const historyBanner = document.querySelector("#historyBanner");
const resumeLiveBtn = document.querySelector("#resumeLiveBtn");
const connectionState = document.querySelector("#connectionState");
const chatList = document.querySelector("#chatList");
const remoteAudio = document.querySelector("#remoteAudio");
const adminUserList = document.querySelector("#adminUserList");
const adminUserLabel = document.querySelector("#adminUserLabel");
const adminUserCount = document.querySelector("#adminUserCount");
const adminStatUsers = document.querySelector("#adminStatUsers");
const adminStatVisible = document.querySelector("#adminStatVisible");
const adminSearch = document.querySelector("#adminSearch");
const adminSearchWrap = document.querySelector("#adminSearchWrap");
const adminSearchClear = document.querySelector("#adminSearchClear");
const adminListHead = document.querySelector("#adminListHead");
const generateIdBtn = document.querySelector("#generateIdBtn");
const quickAddBtn = document.querySelector("#quickAddBtn");
const adminUserAvatar = document.querySelector("#adminUserAvatar");
const adminRefreshBtn = document.querySelector("#adminRefreshBtn");
const adminPasswordToggle = document.querySelector("#adminPasswordToggle");
const newUserId = document.querySelector("#newUserId");
const addUserBtn = document.querySelector("#addUserBtn");
const addUserMessage = document.querySelector("#addUserMessage");
const historyButton = document.querySelector("#historyButton");
const drawer = document.querySelector("#drawer");
const drawerOverlay = document.querySelector("#drawerOverlay");
const drawerClose = document.querySelector("#drawerClose");
const newConversationButton = document.querySelector("#newConversationButton");
const sessionList = document.querySelector("#sessionList");
const toast = document.querySelector("#toast");
const dialogOverlay = document.querySelector("#dialogOverlay");
const dialogMessage = document.querySelector("#dialogMessage");
const dialogCancel = document.querySelector("#dialogCancel");
const dialogConfirm = document.querySelector("#dialogConfirm");

/* ───────── API ───────── */

function sortUsers(users) {
      return [...(users || [])].sort((a, b) => a.id.localeCompare(b.id, "ja"));
}

async function api(path, options = {}) {
      const response = await fetch(path, {
              credentials: "same-origin",
              headers: { "Content-Type": "application/json", ...(options.headers || {}) },
              ...options
      });
      const text = await response.text();
      let payload = {};
      if (text) {
              try { payload = JSON.parse(text); }
              catch { throw new Error("サーバー応答の解析に失敗しました"); }
      }
      if (!response.ok) {
              if (response.status === 429) throw new Error(payload.error || "ログイン試行が多すぎます。しばらく待ってから再試行してください。");
              throw new Error(payload.error || "Request failed");
      }
      return payload;
}

function isAdminEntryHash() {
      return location.hash === "#/admin" || location.hash === "#admin";
}

function clearAdminEntryHash() {
      if (isAdminEntryHash()) history.replaceState(null, "", location.pathname);
}

/* ───────── 翻訳指示 ───────── */

function buildInstructions() {
      return [
              "You are LinguaLive, a realtime Japanese-English interpreter.",
              "Automatically detect whether the speaker is using Japanese or English.",
              "If the speaker uses Japanese, translate into natural English.",
              "If the speaker uses English, translate into natural Japanese.",
              "When the speaker switches language, adapt immediately without asking or commenting.",
              "Return only the translation, with no commentary, labels, or explanations.",
              "Keep the translation natural, concise, and faithful. Preserve names, numbers, and technical terms."
            ].join(" ");
}

/* ───────── 認証・画面切り替え ───────── */

function setAuthenticated(user) {
      state.user = user;
      authView.classList.add("is-hidden");
      adminAuthView.classList.add("is-hidden");
      adminView.classList.add("is-hidden");
      translatorView.classList.remove("is-hidden");
      clearAdminEntryHash();
      renderConversation();
      renderSessionList();
      updateLiveUi();
}

function setAdminAuthenticated(user) {
      state.user = user;
      authView.classList.add("is-hidden");
      adminAuthView.classList.add("is-hidden");
      translatorView.classList.add("is-hidden");
      adminView.classList.remove("is-hidden");
      const label = user.id || "";
      if (adminUserLabel) adminUserLabel.textContent = label;
      if (adminUserAvatar) adminUserAvatar.textContent = label.charAt(0).toUpperCase() || "A";
      clearAdminEntryHash();
      loadAdminUsers();
}

function showAdminAuthView() {
      state.user = null;
      authView.classList.add("is-hidden");
      adminAuthView.classList.remove("is-hidden");
      translatorView.classList.add("is-hidden");
      adminView.classList.add("is-hidden");
      adminAuthMessage.textContent = "";
      if (!isAdminEntryHash()) history.replaceState(null, "", "#/admin");
      adminEmailInput?.focus();
}

function showUserAuthView() {
      adminAuthView.classList.add("is-hidden");
      authView.classList.remove("is-hidden");
      translatorView.classList.add("is-hidden");
      adminView.classList.add("is-hidden");
      authMessage.textContent = "";
      if (location.hash) history.replaceState(null, "", location.pathname);
      accessIdInput.focus();
}

function setLoggedOut() {
      state.user = null;
      closeDrawer();
      authView.classList.remove("is-hidden");
      adminAuthView.classList.add("is-hidden");
      translatorView.classList.add("is-hidden");
      adminView.classList.add("is-hidden");
      authMessage.textContent = "";
      adminAuthMessage.textContent = "";
      adminEmailInput.value = "";
      adminPasswordInput.value = "";
      if (location.hash) history.replaceState(null, "", location.pathname);
      accessIdInput.focus();
}

function setStatus(text) { connectionState.textContent = text; }

function setMicHint(text) {
      if (micHint) micHint.textContent = text;
      if (micLabel) micLabel.textContent = text;
}

function updateHistoryBanner() {
      if (!historyBanner) return;
      historyBanner.classList.toggle("is-hidden", !state.viewingHistory);
}

function updateLiveUi() {
      updateHistoryBanner();
      if (state.viewingHistory) {
              setMicHint("タップして新しい翻訳を開始");
              return;
      }
      if (state.pc) setMicHint("タップして翻訳を停止");
      else setMicHint("マイクボタンをタップして話してください");
}

/* ───────── 管理画面 ───────── */

function generateAccessId() {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const part = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      return `team_${part(4)}-${part(4)}`;
}

async function copyAccessId(id, rowEl) {
      try {
              await navigator.clipboard.writeText(id);
              showToast("IDをコピーしました");
              if (rowEl) {
                      rowEl.classList.add("is-copied");
                      const copyBtn = rowEl.querySelector(".admin-copy-btn");
                      const meta = rowEl.querySelector(".admin-user-meta");
                      const prevBtn = copyBtn?.textContent;
                      const prevMeta = meta?.textContent;
                      if (copyBtn) copyBtn.textContent = "済";
                      if (meta) meta.textContent = "コピーしました";
                      setTimeout(() => {
                                rowEl.classList.remove("is-copied");
                                if (copyBtn && prevBtn) copyBtn.textContent = prevBtn;
                                if (meta && prevMeta) meta.textContent = prevMeta;
                      }, 1600);
              }
      } catch {
              showToast("コピーに失敗しました");
      }
}

function updateAdminStats(count, visible) {
      const label = count === undefined ? "—" : `${count}件`;
      if (adminUserCount) adminUserCount.textContent = label;
      if (adminStatUsers) adminStatUsers.textContent = count === undefined ? "—" : String(count);
      if (adminStatVisible) {
              if (visible === undefined) adminStatVisible.textContent = "—";
              else adminStatVisible.textContent = visible === count ? `${visible}件` : `${visible} / ${count}件`;
      }
}

function renderUserList(users) {
      state.adminUsers = sortUsers(users);
      const query = (adminSearch?.value || "").trim().toLowerCase();
      const filtered = query
              ? state.adminUsers.filter((u) => u.id.toLowerCase().includes(query))
              : state.adminUsers;
      const count = state.adminUsers.length;
      updateAdminStats(count, filtered.length);

      if (adminSearchWrap) adminSearchWrap.hidden = count === 0;
      if (adminSearchClear) adminSearchClear.hidden = !query;
      if (adminListHead) adminListHead.hidden = filtered.length === 0;

      adminUserList.innerHTML = "";

      if (count === 0) {
              adminUserList.innerHTML = `
                    <div class="admin-empty">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                      </svg>
                      <p class="admin-empty-title">ユーザーがいません</p>
                      <p class="admin-empty-desc">アクセスIDを追加して、翻訳アプリへのログインを許可しましょう。</p>
                      <button class="admin-empty-action" type="button" id="emptyQuickAdd">IDを自動生成して追加</button>
                    </div>`;
              adminUserList.querySelector("#emptyQuickAdd")?.addEventListener("click", handleQuickAdd);
              return;
      }

      if (filtered.length === 0) {
              adminUserList.innerHTML = `
                    <div class="admin-empty">
                      <p class="admin-empty-title">一致するユーザーがありません</p>
                      <p class="admin-empty-desc">検索条件を変更してください。</p>
                    </div>`;
              return;
      }

      for (const u of filtered) {
              const row = document.createElement("div");
              row.className = "admin-user-row";

              const avatar = document.createElement("span");
              avatar.className = "admin-user-avatar";
              avatar.textContent = u.id.slice(0, 1).toUpperCase();
              avatar.setAttribute("aria-hidden", "true");

              const info = document.createElement("div");
              info.className = "admin-user-info";

              const idEl = document.createElement("span");
              idEl.className = "admin-user-id";
              idEl.textContent = u.id;

              const meta = document.createElement("span");
              meta.className = "admin-user-meta";
              meta.textContent = u.seeded ? "環境設定 · 固定ID" : "追加済み";

              info.append(idEl, meta);

              const copyBtn = document.createElement("button");
              copyBtn.type = "button";
              copyBtn.className = "admin-copy-btn";
              copyBtn.textContent = "コピー";
              copyBtn.setAttribute("aria-label", `${u.id} をコピー`);
              copyBtn.addEventListener("click", () => copyAccessId(u.id, row));

              const delBtn = document.createElement("button");
              delBtn.type = "button";
              delBtn.className = "admin-del-btn";
              delBtn.setAttribute("aria-label", `${u.id} を削除`);
              if (u.seeded) {
                      delBtn.disabled = true;
                      delBtn.title = "環境設定で定義されたIDは削除できません";
              }
              delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>`;

              delBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        if (u.seeded) {
                                  showToast("環境設定で定義されたIDは削除できません");
                                  return;
                        }
                        showConfirmDialog(`「${u.id}」を削除しますか？`, async () => {
                                    try {
                                                  const { users: updated } = await api(`/api/admin/users/${encodeURIComponent(u.id)}`, {
                                                                  method: "DELETE"
                                                  });
                                                  showToast("削除しました");
                                                  renderUserList(updated);
                                    } catch (err) {
                                                  showToast(err.message);
                                    }
                        });
              });

              row.append(avatar, info, copyBtn, delBtn);
              adminUserList.appendChild(row);
      }
}

async function loadAdminUsers(options = {}) {
      const { preserveSearch = false } = options;
      if (!adminUserList) return;
      adminUserList.innerHTML = '<p class="admin-loading"><span class="admin-spinner"></span>読み込み中...</p>';
      updateAdminStats(undefined);
      if (!preserveSearch && adminSearch) adminSearch.value = "";
      if (adminSearchClear) adminSearchClear.hidden = !(adminSearch?.value || "").trim();
      if (adminListHead) adminListHead.hidden = true;
      try {
              const { users } = await api("/api/admin/users");
              renderUserList(users);
      } catch (e) {
              updateAdminStats(undefined);
              adminUserList.innerHTML = `<div class="admin-empty admin-empty-error"><p class="admin-empty-title">読み込みに失敗しました</p><p class="admin-empty-desc">${e.message}</p><button class="admin-empty-action" type="button" id="adminRetryLoad">再読み込み</button></div>`;
              adminUserList.querySelector("#adminRetryLoad")?.addEventListener("click", loadAdminUsers);
      }
}

async function handleAddUser() {
      const id = newUserId.value.trim();
      if (!id) {
              setAddUserMessage("IDを入力してください");
              return;
      }
      setAddUserMessage("");
      addUserBtn.disabled = true;
      if (quickAddBtn) quickAddBtn.disabled = true;
      try {
              const { users } = await api("/api/admin/users", {
                        method: "POST",
                        body: JSON.stringify({ id })
              });
              newUserId.value = "";
              setAddUserMessage(`「${id}」を追加しました`, "success");
              showToast(`「${id}」を追加しました`);
              renderUserList(users);
              await copyAccessId(id);
      } catch (e) {
              setAddUserMessage(e.message);
      } finally {
              addUserBtn.disabled = false;
              if (quickAddBtn) quickAddBtn.disabled = false;
      }
}

function handleGenerateId() {
      newUserId.value = generateAccessId();
      newUserId.focus();
      setAddUserMessage("");
}

async function handleQuickAdd() {
      newUserId.value = generateAccessId();
      await handleAddUser();
}

function setAddUserMessage(text, type = "error") {
      if (!addUserMessage) return;
      addUserMessage.textContent = text;
      addUserMessage.classList.toggle("is-success", type === "success");
}

/* ───────── 確認ダイアログ ───────── */

let _confirmCallback = null;

function showConfirmDialog(message, onConfirm) {
      dialogMessage.textContent = message;
      _confirmCallback = onConfirm;
      dialogOverlay.classList.remove("is-hidden");
      dialogConfirm?.focus();
}

function closeConfirmDialog() {
      dialogOverlay.classList.add("is-hidden");
      _confirmCallback = null;
}

/* ───────── 会話管理 ───────── */

function ensureSession() {
      if (!state.sessionId) {
              state.sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
              state.sessionStartedAt = Date.now();
      }
}

function startNewTurn(original = "") {
      ensureSession();
      const turn = { original, translation: "", done: false };
      state.turns.push(turn);
      state.activeTurn = turn;
      return turn;
}

function handleRealtimeEvent(event) {
      if (event.type === "conversation.item.input_audio_transcription.completed") {
              const text = (event.transcript || "").trim();
              if (state.activeTurn && state.activeTurn.original === "") state.activeTurn.original = text;
              else startNewTurn(text);
              renderConversation(); saveCurrentSession();
      }
      if (["response.audio_transcript.delta","response.output_audio_transcript.delta","response.text.delta","response.output_text.delta"].includes(event.type)) {
              if (!event.delta) return;
              if (!state.activeTurn || state.activeTurn.done) startNewTurn("");
              state.activeTurn.translation += event.delta;
              renderConversation();
      }
      if (["response.audio_transcript.done","response.output_audio_transcript.done","response.text.done","response.output_text.done"].includes(event.type)) {
              const doneText = (event.transcript || event.text || "").trim();
              if (state.activeTurn) {
                        if (doneText) state.activeTurn.translation = doneText;
                        state.activeTurn.done = true;
              }
              renderConversation(); saveCurrentSession();
      }
      if (event.type === "error") setStatus(event.error?.message || "Realtime API error");
}

function resetConversation() {
      saveCurrentSession();
      state.turns = []; state.activeTurn = null;
      state.sessionId = null; state.sessionStartedAt = null;
      state.viewingHistory = false;
      renderConversation();
      updateLiveUi();
}

/* ───────── レンダリング ───────── */

const SPEAKER_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MIC_DOT_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0014 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const AI_DOT_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" fill="currentColor"/></svg>';

function makeBubble({ type, lang, text, placeholder, badge, withSpeaker, typing }) {
      const item = document.createElement("div");
      item.className = "chat-item";
      const marker = document.createElement("div");
      marker.className = `chat-marker ${type}`;
      marker.innerHTML = `<span class="dot">${type === "translation" ? AI_DOT_SVG : MIC_DOT_SVG}</span>`;
      item.appendChild(marker);
      const bubble = document.createElement("div");
      bubble.className = `bubble ${type === "translation" ? "translation" : ""}`.trim();
      const head = document.createElement("div");
      head.className = "bubble-head";
      const langEl = document.createElement("span");
      langEl.className = "bubble-lang";
      langEl.textContent = lang;
      head.appendChild(langEl);
      if (withSpeaker) {
              const speak = document.createElement("button");
              speak.className = "speak-button"; speak.type = "button";
              speak.setAttribute("aria-label", "音声を再生");
              speak.innerHTML = SPEAKER_SVG;
              speak.addEventListener("click", () => remoteAudio.play().catch(() => showToast("音声再生を許可してください")));
              head.appendChild(speak);
      }
      bubble.appendChild(head);
      const body = document.createElement("p");
      body.className = `bubble-text ${placeholder ? "is-placeholder" : ""}`.trim();
      if (typing) body.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
      else body.textContent = text;
      bubble.appendChild(body);
      if (badge) {
              const badgeEl = document.createElement("span");
              badgeEl.className = "ai-badge";
              badgeEl.innerHTML = `${AI_DOT_SVG} AI翻訳`;
              bubble.appendChild(badgeEl);
      }
      item.appendChild(bubble);
      return item;
}

function renderConversation() {
      chatList.innerHTML = "";
      if (state.turns.length === 0) {
              const empty = document.createElement("div");
              empty.className = "chat-empty";
              empty.innerHTML = `
                    <div class="chat-empty-icon">🎙️</div>
                    <p class="chat-empty-title">リアルタイム翻訳を始めましょう</p>
                    <ol class="chat-empty-steps">
                      <li>下の<strong>マイクボタン</strong>をタップ</li>
                      <li>日本語または英語で話す</li>
                      <li>翻訳が音声とテキストで表示されます</li>
                    </ol>`;
              chatList.appendChild(empty);
              return;
      }
      for (const turn of state.turns) {
              if (turn.original) chatList.appendChild(makeBubble({ type: "original", lang: "聞き取り", text: turn.original }));
              const hasTranslation = turn.translation.length > 0;
              if (hasTranslation || turn.original) {
                        chatList.appendChild(makeBubble({
                                    type: "translation", lang: "翻訳", text: turn.translation,
                                    typing: !hasTranslation && !turn.done, badge: hasTranslation, withSpeaker: hasTranslation
                        }));
              }
      }
      chatList.scrollTop = chatList.scrollHeight;
}

/* ───────── 履歴 ───────── */

function loadHistory() {
      try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveHistory(list) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 100))); } catch {}
}

function saveCurrentSession() {
      const meaningful = state.turns.filter((t) => t.original || t.translation);
      if (!state.sessionId || meaningful.length === 0) return;
      const list = loadHistory();
      const record = { id: state.sessionId, startedAt: state.sessionStartedAt, updatedAt: Date.now(),
                          turns: meaningful.map((t) => ({ original: t.original, translation: t.translation })) };
      const index = list.findIndex((s) => s.id === state.sessionId);
      if (index >= 0) list[index] = record; else list.unshift(record);
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      saveHistory(list); renderSessionList();
}

function dayLabel(ts) {
      const d = new Date(ts), today = new Date(), yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      if (same(d, today)) return "今日";
      if (same(d, yesterday)) return "昨日";
      return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function timeLabel(ts) {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function renderSessionList() {
      const list = loadHistory();
      sessionList.innerHTML = "";
      if (list.length === 0) {
              const empty = document.createElement("p");
              empty.className = "session-empty";
              empty.textContent = "まだ履歴がありません。";
              sessionList.appendChild(empty); return;
      }
      let lastDay = null;
      for (const session of list) {
              const day = dayLabel(session.updatedAt || session.startedAt);
              if (day !== lastDay) {
                        const header = document.createElement("div");
                        header.className = "session-day"; header.textContent = day;
                        sessionList.appendChild(header); lastDay = day;
              }
              const first = session.turns[0] || {};
              const preview = (first.original || first.translation || "会話").replace(/\s+/g, " ").trim();
              const item = document.createElement("button");
              item.type = "button"; item.className = "session-item";
              if (session.id === state.sessionId) item.classList.add("is-active");
              const title = document.createElement("span"); title.className = "session-title"; title.textContent = preview;
              const meta = document.createElement("span"); meta.className = "session-meta";
              meta.textContent = `${timeLabel(session.updatedAt || session.startedAt)} ・ ${session.turns.length}件`;
              item.append(title, meta);
              item.addEventListener("click", () => loadSession(session.id));
              sessionList.appendChild(item);
      }
}

function loadSession(id) {
      if (state.pc) stopRealtime();
      saveCurrentSession();
      const session = loadHistory().find((s) => s.id === id);
      if (!session) return;
      state.turns = session.turns.map((t) => ({ original: t.original, translation: t.translation, done: true }));
      state.activeTurn = null; state.sessionId = session.id;
      state.sessionStartedAt = session.startedAt; state.viewingHistory = true;
      renderConversation(); renderSessionList(); closeDrawer();
      updateLiveUi();
}

/* ───────── ドロワー ───────── */

function openDrawer() {
      renderSessionList(); drawerOverlay.hidden = false;
      requestAnimationFrame(() => { drawer.classList.add("is-open"); drawerOverlay.classList.add("is-open"); });
}

function closeDrawer() {
      drawer.classList.remove("is-open"); drawerOverlay.classList.remove("is-open");
      setTimeout(() => { if (!drawer.classList.contains("is-open")) drawerOverlay.hidden = true; }, 320);
}

/* ───────── トースト ───────── */

let toastTimer = null;
function showToast(message) {
      toast.textContent = message; toast.classList.add("is-visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

/* ───────── リアルタイム翻訳 ───────── */

function sendSessionUpdate() {
      if (!state.dc || state.dc.readyState !== "open") return;
      state.dc.send(JSON.stringify({
              type: "session.update",
              session: {
                        type: "realtime", instructions: buildInstructions(), output_modalities: ["audio"],
                        audio: {
                                    input: { transcription: { model: "gpt-4o-transcribe" }, turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 520 } },
                                    output: { voice: "marin" }
                        }
              }
      }));
}

async function startRealtime() {
      if (state.pc) return;
      if (state.viewingHistory) {
              state.turns = []; state.activeTurn = null;
              state.sessionId = null; state.sessionStartedAt = null; state.viewingHistory = false;
              renderConversation();
              updateLiveUi();
      }
      setStatus("マイク権限を確認中"); micButton.disabled = true;
      try {
              const { clientSecret } = await api("/api/realtime-token", { method: "POST", body: "{}" });
              const pc = new RTCPeerConnection();
              const dc = pc.createDataChannel("oai-events");
              const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
              stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
              pc.ontrack = (event) => { remoteAudio.srcObject = event.streams[0]; };
              pc.onconnectionstatechange = () => {
                        if (pc.connectionState === "connected") setStatus("翻訳中");
                        if (["failed","closed","disconnected"].includes(pc.connectionState)) { if (state.pc === pc) stopRealtime("接続終了"); }
              };
              dc.addEventListener("open", () => { sendSessionUpdate(); setStatus("翻訳中"); updateLiveUi(); });
              dc.addEventListener("message", (message) => {
                        try { handleRealtimeEvent(JSON.parse(message.data)); } catch { setStatus("イベント解析エラー"); }
              });
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
                        method: "POST", body: offer.sdp,
                        headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" }
              });
              if (!answer.ok) throw new Error(await answer.text());
              await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
              state.pc = pc; state.dc = dc; state.stream = stream;
              translatorView.classList.add("is-live");
              micButton.setAttribute("aria-pressed", "true");
              updateLiveUi();
      } catch (error) {
              stopRealtime();
              setStatus(error.message.includes("Permission") ? "マイク権限が必要です" : error.message);
      } finally { micButton.disabled = false; }
}

function stopRealtime(status = "待機中") {
      if (state.dc) state.dc.close();
      if (state.pc) state.pc.close();
      if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
      state.pc = null; state.dc = null; state.stream = null; state.activeTurn = null;
      translatorView.classList.remove("is-live");
      micButton.setAttribute("aria-pressed", "false");
      setStatus(status);
      updateLiveUi();
      saveCurrentSession();
}

function resumeLiveTranslation() {
      if (state.pc) stopRealtime();
      resetConversation();
      startRealtime();
}

/* ───────── 起動・イベント ───────── */

async function boot() {
      try {
              const { user } = await api("/api/me");
              if (user.role === "admin") setAdminAuthenticated(user);
              else setAuthenticated(user);
      } catch {
              if (isAdminEntryHash()) showAdminAuthView();
              else setLoggedOut();
      }
}

async function handlePasteAccessId() {
      if (!navigator.clipboard?.readText) {
              showToast("このブラウザでは貼り付けできません");
              return;
      }
      try {
              const text = (await navigator.clipboard.readText()).trim();
              if (!text) {
                      showToast("クリップボードが空です");
                      return;
              }
              accessIdInput.value = text;
              authMessage.textContent = "";
              accessIdInput.focus();
      } catch {
              showToast("クリップボードへのアクセスが拒否されました");
      }
}

async function handleLogin() {
      authMessage.textContent = "";
      loginSubmit.disabled = true;
      loginSubmit.textContent = "ログイン中...";
      try {
              const { user } = await api("/api/login", { method: "POST", body: JSON.stringify({ accessId: accessIdInput.value.trim() }) });
              accessIdInput.value = "";
              setAuthenticated(user);
      } catch (error) {
              authMessage.textContent = error.message;
      } finally {
              loginSubmit.disabled = false;
              loginSubmit.textContent = "ログイン";
      }
}

async function handleAdminLogin() {
      adminAuthMessage.textContent = "";
      adminLoginSubmit.disabled = true;
      adminLoginSubmit.textContent = "ログイン中...";
      try {
              const { user } = await api("/api/admin/login", {
                        method: "POST",
                        body: JSON.stringify({
                                  email: adminEmailInput.value.trim(),
                                  password: adminPasswordInput.value
                        })
              });
              adminPasswordInput.value = "";
              setAdminAuthenticated(user);
      } catch (error) {
              adminAuthMessage.textContent = error.message;
      } finally {
              adminLoginSubmit.disabled = false;
              adminLoginSubmit.textContent = "ログイン";
      }
}

async function handleLogout() {
      const wasAdmin = state.user?.role === "admin";
      stopRealtime();
      await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
      state.user = null;
      closeDrawer();
      translatorView.classList.add("is-hidden");
      adminView.classList.add("is-hidden");
      authMessage.textContent = "";
      adminAuthMessage.textContent = "";
      adminEmailInput.value = "";
      adminPasswordInput.value = "";
      accessIdInput.value = "";
      if (wasAdmin) showAdminAuthView();
      else setLoggedOut();
}

window.addEventListener("hashchange", () => {
      if (state.user) return;
      if (isAdminEntryHash()) showAdminAuthView();
      else if (!adminAuthView.classList.contains("is-hidden")) showUserAuthView();
});

loginForm.addEventListener("submit", (e) => { e.preventDefault(); handleLogin(); });
if (pasteAccessIdBtn) pasteAccessIdBtn.addEventListener("click", handlePasteAccessId);
if (adminLoginForm) adminLoginForm.addEventListener("submit", (e) => { e.preventDefault(); handleAdminLogin(); });
if (adminLoginSubmit) adminLoginSubmit.addEventListener("click", handleAdminLogin);
if (showAdminLogin) showAdminLogin.addEventListener("click", showAdminAuthView);
if (showUserLogin) showUserLogin.addEventListener("click", showUserAuthView);
logoutButton.addEventListener("click", handleLogout);
if (adminLogoutButton) adminLogoutButton.addEventListener("click", handleLogout);

micButton.addEventListener("click", () => { if (state.pc) stopRealtime(); else startRealtime(); });

if (adminRefreshBtn) adminRefreshBtn.addEventListener("click", () => loadAdminUsers({ preserveSearch: true }));
if (addUserBtn) addUserBtn.addEventListener("click", handleAddUser);
if (generateIdBtn) generateIdBtn.addEventListener("click", handleGenerateId);
if (quickAddBtn) quickAddBtn.addEventListener("click", handleQuickAdd);
if (adminSearch) adminSearch.addEventListener("input", () => renderUserList(state.adminUsers));
if (adminSearchClear) adminSearchClear.addEventListener("click", () => {
      adminSearch.value = "";
      adminSearchClear.hidden = true;
      renderUserList(state.adminUsers);
      adminSearch.focus();
});
if (adminPasswordToggle) {
      adminPasswordToggle.addEventListener("click", () => {
              const isPassword = adminPasswordInput.type === "password";
              adminPasswordInput.type = isPassword ? "text" : "password";
              adminPasswordToggle.classList.toggle("is-visible", isPassword);
              adminPasswordToggle.setAttribute("aria-label", isPassword ? "パスワードを隠す" : "パスワードを表示");
      });
}
if (newUserId) newUserId.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddUser(); });

if (resumeLiveBtn) resumeLiveBtn.addEventListener("click", resumeLiveTranslation);

historyButton.addEventListener("click", openDrawer);
drawerClose.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

newConversationButton.addEventListener("click", () => {
      if (state.pc) stopRealtime();
      resetConversation(); closeDrawer(); showToast("新しい会話を開始しました");
});

if (dialogCancel) dialogCancel.addEventListener("click", closeConfirmDialog);
if (dialogConfirm) dialogConfirm.addEventListener("click", () => {
      const cb = _confirmCallback; closeConfirmDialog();
      if (cb) cb();
});
if (dialogOverlay) dialogOverlay.addEventListener("click", (e) => { if (e.target === dialogOverlay) closeConfirmDialog(); });

window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!dialogOverlay?.classList.contains("is-hidden")) {
              closeConfirmDialog();
              return;
      }
      if (drawer?.classList.contains("is-open")) closeDrawer();
});

window.addEventListener("beforeunload", saveCurrentSession);

boot();
