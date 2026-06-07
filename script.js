const HISTORY_KEY = "lingualive_history_v2";

const state = {
    pc: null,
    dc: null,
    stream: null,
    user: null,
    turns: [],
    activeTurn: null,
    sessionId: null,
    sessionStartedAt: null,
    viewingHistory: false
};

const authView = document.querySelector("#authView");
const translatorView = document.querySelector("#translatorView");
const adminView = document.querySelector("#adminView");
const loginForm = document.querySelector("#loginForm");
const accessIdInput = document.querySelector("#accessId");
const authMessage = document.querySelector("#authMessage");
const loginSubmit = document.querySelector("#loginSubmit");
const logoutButton = document.querySelector("#logoutButton");
const adminLogoutButton = document.querySelector("#adminLogoutButton");
const micButton = document.querySelector("#micButton");
const micLabel = document.querySelector("#micLabel");
const connectionState = document.querySelector("#connectionState");
const chatList = document.querySelector("#chatList");
const remoteAudio = document.querySelector("#remoteAudio");
const adminButton = document.querySelector("#adminButton");
const adminBackButton = document.querySelector("#adminBackButton");
const adminUserList = document.querySelector("#adminUserList");

const historyButton = document.querySelector("#historyButton");
const drawer = document.querySelector("#drawer");
const drawerOverlay = document.querySelector("#drawerOverlay");
const drawerClose = document.querySelector("#drawerClose");
const newConversationButton = document.querySelector("#newConversationButton");
const sessionList = document.querySelector("#sessionList");
const toast = document.querySelector("#toast");

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

async function api(path, options = {}) {
    const response = await fetch(path, {
          credentials: "same-origin",
          headers: {
                  "Content-Type": "application/json",
                  ...(options.headers || {})
          },
          ...options
    });

  const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
          throw new Error(payload.error || "Request failed");
    }
    return payload;
}

/* ───────── 認証・画面切り替え ───────── */

function setAuthenticated(user) {
    state.user = user;
    authView.classList.add("is-hidden");
    adminView.classList.add("is-hidden");

  if (user.role === "admin") {
        // 管理者: 管理ボタンを表示
      if (adminButton) adminButton.classList.remove("is-hidden");
  } else {
        // 一般ユーザー: 管理ボタンを非表示
      if (adminButton) adminButton.classList.add("is-hidden");
  }

  translatorView.classList.remove("is-hidden");
    renderConversation();
    renderSessionList();
}

function showAdminView() {
    translatorView.classList.add("is-hidden");
    adminView.classList.remove("is-hidden");
    loadAdminUsers();
}

function showTranslatorView() {
    adminView.classList.add("is-hidden");
    translatorView.classList.remove("is-hidden");
}

function setLoggedOut() {
    state.user = null;
    closeDrawer();
    authView.classList.remove("is-hidden");
    translatorView.classList.add("is-hidden");
    adminView.classList.add("is-hidden");
    authMessage.textContent = "";
    accessIdInput.focus();
}

function setStatus(text) {
    connectionState.textContent = text;
}

/* ───────── 管理画面 ───────── */

async function loadAdminUsers() {
    if (!adminUserList) return;
    adminUserList.innerHTML = '<p class="admin-loading">読み込み中...</p>';
    try {
          const { users } = await api("/api/admin/users");
          if (!users || users.length === 0) {
                  adminUserList.innerHTML = '<p class="admin-loading">ユーザーが登録されていません。</p>';
                  return;
          }
          adminUserList.innerHTML = "";
          for (const u of users) {
                  const row = document.createElement("div");
                  row.className = "admin-user-row";
                  const idEl = document.createElement("span");
                  idEl.className = "admin-user-id";
                  idEl.textContent = u.id;
                  const roleEl = document.createElement("span");
                  roleEl.className = `admin-user-role role-${u.role}`;
                  roleEl.textContent = u.role === "admin" ? "管理者" : "ユーザー";
                  row.append(idEl, roleEl);
                  adminUserList.appendChild(row);
          }
    } catch (e) {
          adminUserList.innerHTML = `<p class="admin-loading">読み込みエラー: ${e.message}</p>`;
    }
}

/* ───────── 会話（ターン）管理 ───────── */

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
          if (state.activeTurn && state.activeTurn.original === "") {
                  state.activeTurn.original = text;
          } else {
                  startNewTurn(text);
          }
          renderConversation();
          saveCurrentSession();
    }

  if (
        event.type === "response.audio_transcript.delta" ||
        event.type === "response.output_audio_transcript.delta" ||
        event.type === "response.text.delta" ||
        event.type === "response.output_text.delta"
      ) {
        if (!event.delta) return;
        if (!state.activeTurn || state.activeTurn.done) startNewTurn("");
        state.activeTurn.translation += event.delta;
        renderConversation();
  }

  if (
        event.type === "response.audio_transcript.done" ||
        event.type === "response.output_audio_transcript.done" ||
        event.type === "response.text.done" ||
        event.type === "response.output_text.done"
      ) {
        const doneText = (event.transcript || event.text || "").trim();
        if (state.activeTurn) {
                if (doneText) state.activeTurn.translation = doneText;
                state.activeTurn.done = true;
        }
        renderConversation();
        saveCurrentSession();
  }

  if (event.type === "error") {
        setStatus(event.error?.message || "Realtime API error");
  }
}

function resetConversation() {
    saveCurrentSession();
    state.turns = [];
    state.activeTurn = null;
    state.sessionId = null;
    state.sessionStartedAt = null;
    state.viewingHistory = false;
    renderConversation();
}

/* ───────── 会話のレンダリング ───────── */

const SPEAKER_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MIC_DOT_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0014 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const AI_DOT_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" fill="currentColor"/></svg>';

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
          speak.className = "speak-button";
          speak.type = "button";
          speak.setAttribute("aria-label", "音声を再生");
          speak.innerHTML = SPEAKER_SVG;
          speak.addEventListener("click", () => {
                  remoteAudio.play().catch(() => showToast("音声再生を許可してください"));
          });
          head.appendChild(speak);
    }
    bubble.appendChild(head);

  const body = document.createElement("p");
    body.className = `bubble-text ${placeholder ? "is-placeholder" : ""}`.trim();
    if (typing) {
          body.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    } else {
          body.textContent = text;
    }
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
        empty.innerHTML =
                '<div class="chat-empty-icon">🎙️</div>マイクをタップして<br>会話を始めましょう。<br>話した言語を自動で判別して翻訳します。';
        chatList.appendChild(empty);
        return;
  }

  for (const turn of state.turns) {
        if (turn.original) {
                chatList.appendChild(
                          makeBubble({ type: "original", lang: "聞き取り", text: turn.original })
                        );
        }
        const hasTranslation = turn.translation.length > 0;
        if (hasTranslation || turn.original) {
                chatList.appendChild(
                          makeBubble({
                                      type: "translation",
                                      lang: "翻訳",
                                      text: turn.translation,
                                      typing: !hasTranslation && !turn.done,
                                      badge: hasTranslation,
                                      withSpeaker: hasTranslation
                          })
                        );
        }
  }

  chatList.scrollTop = chatList.scrollHeight;
}

/* ───────── 履歴の保存・読み込み ───────── */

function loadHistory() {
    try {
          return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
          return [];
    }
}

function saveHistory(list) {
    try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 100)));
    } catch {
          /* ストレージ不可は無視 */
    }
}

function saveCurrentSession() {
    const meaningful = state.turns.filter((t) => t.original || t.translation);
    if (!state.sessionId || meaningful.length === 0) return;

  const list = loadHistory();
    const record = {
          id: state.sessionId,
          startedAt: state.sessionStartedAt,
          updatedAt: Date.now(),
          turns: meaningful.map((t) => ({ original: t.original, translation: t.translation }))
    };

  const index = list.findIndex((s) => s.id === state.sessionId);
    if (index >= 0) list[index] = record;
    else list.unshift(record);

  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    saveHistory(list);
    renderSessionList();
}

function dayLabel(timestamp) {
    const d = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const same = (a, b) =>
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate();
    if (same(d, today)) return "今日";
    if (same(d, yesterday)) return "昨日";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function timeLabel(timestamp) {
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderSessionList() {
    const list = loadHistory();
    sessionList.innerHTML = "";

  if (list.length === 0) {
        const empty = document.createElement("p");
        empty.className = "session-empty";
        empty.textContent = "まだ履歴がありません。";
        sessionList.appendChild(empty);
        return;
  }

  let lastDay = null;
    for (const session of list) {
          const day = dayLabel(session.updatedAt || session.startedAt);
          if (day !== lastDay) {
                  const header = document.createElement("div");
                  header.className = "session-day";
                  header.textContent = day;
                  sessionList.appendChild(header);
                  lastDay = day;
          }

      const first = session.turns[0] || {};
          const preview = (first.original || first.translation || "会話").replace(/\s+/g, " ").trim();

      const item = document.createElement("button");
          item.type = "button";
          item.className = "session-item";
          if (session.id === state.sessionId) item.classList.add("is-active");

      const title = document.createElement("span");
          title.className = "session-title";
          title.textContent = preview;

      const meta = document.createElement("span");
          meta.className = "session-meta";
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

  state.turns = session.turns.map((t) => ({
        original: t.original,
        translation: t.translation,
        done: true
  }));
    state.activeTurn = null;
    state.sessionId = session.id;
    state.sessionStartedAt = session.startedAt;
    state.viewingHistory = true;

  renderConversation();
    renderSessionList();
    closeDrawer();
}

/* ───────── ドロワー ───────── */

function openDrawer() {
    renderSessionList();
    drawerOverlay.hidden = false;
    requestAnimationFrame(() => {
          drawer.classList.add("is-open");
          drawerOverlay.classList.add("is-open");
    });
}

function closeDrawer() {
    drawer.classList.remove("is-open");
    drawerOverlay.classList.remove("is-open");
    setTimeout(() => {
          if (!drawer.classList.contains("is-open")) drawerOverlay.hidden = true;
    }, 320);
}

/* ───────── トースト ───────── */

let toastTimer = null;
function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

/* ───────── リアルタイム翻訳 ───────── */

function sendSessionUpdate() {
    if (!state.dc || state.dc.readyState !== "open") return;

  state.dc.send(JSON.stringify({
        type: "session.update",
        session: {
                type: "realtime",
                instructions: buildInstructions(),
                output_modalities: ["audio"],
                audio: {
                          input: {
                                      transcription: { model: "gpt-4o-transcribe" },
                                      turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 520 }
                          },
                          output: { voice: "marin" }
                }
        }
  }));
}

async function startRealtime() {
    if (state.pc) return;

  if (state.viewingHistory) {
        state.turns = [];
        state.activeTurn = null;
        state.sessionId = null;
        state.sessionStartedAt = null;
        state.viewingHistory = false;
        renderConversation();
  }

  setStatus("マイク権限を確認中");
    micButton.disabled = true;

  try {
        const { clientSecret } = await api("/api/realtime-token", { method: "POST", body: "{}" });

      const pc = new RTCPeerConnection();
        const dc = pc.createDataChannel("oai-events");
        const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
        pc.ontrack = (event) => {
                remoteAudio.srcObject = event.streams[0];
        };

      pc.onconnectionstatechange = () => {
              if (pc.connectionState === "connected") setStatus("翻訳中");
              if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
                        if (state.pc === pc) stopRealtime("接続終了");
              }
      };

      dc.addEventListener("open", () => {
              sendSessionUpdate();
              setStatus("翻訳中");
      });

      dc.addEventListener("message", (message) => {
              try {
                        handleRealtimeEvent(JSON.parse(message.data));
              } catch {
                        setStatus("イベント解析エラー");
              }
      });

      const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

      const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
              method: "POST",
              body: offer.sdp,
              headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" }
      });

      if (!answer.ok) throw new Error(await answer.text());

      await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });

      state.pc = pc;
        state.dc = dc;
        state.stream = stream;
        translatorView.classList.add("is-live");
        micButton.setAttribute("aria-pressed", "true");
        micLabel.textContent = "タップして停止";
  } catch (error) {
        stopRealtime();
        setStatus(error.message.includes("Permission") ? "マイク権限が必要です" : error.message);
  } finally {
        micButton.disabled = false;
  }
}

function stopRealtime(status = "待機中") {
    if (state.dc) state.dc.close();
    if (state.pc) state.pc.close();
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());

  state.pc = null;
    state.dc = null;
    state.stream = null;
    state.activeTurn = null;
    translatorView.classList.remove("is-live");
    micButton.setAttribute("aria-pressed", "false");
    micLabel.textContent = "タップして開始";
    setStatus(status);
    saveCurrentSession();
}

/* ───────── 起動・イベント ───────── */

async function boot() {
    try {
          const { user } = await api("/api/me");
          setAuthenticated(user);
    } catch {
          setLoggedOut();
    }
}

async function handleLogin() {
    authMessage.textContent = "";
    try {
          const { user } = await api("/api/login", {
                  method: "POST",
                  body: JSON.stringify({ accessId: accessIdInput.value.trim() })
          });
          accessIdInput.value = "";
          setAuthenticated(user);
    } catch (error) {
          authMessage.textContent = error.message;
    }
}

async function handleLogout() {
    stopRealtime();
    await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
    setLoggedOut();
}

loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleLogin();
});
loginSubmit.addEventListener("click", handleLogin);

logoutButton.addEventListener("click", handleLogout);
if (adminLogoutButton) adminLogoutButton.addEventListener("click", handleLogout);

micButton.addEventListener("click", () => {
    if (state.pc) stopRealtime();
    else startRealtime();
});

if (adminButton) {
    adminButton.addEventListener("click", showAdminView);
}

if (adminBackButton) {
    adminBackButton.addEventListener("click", showTranslatorView);
}

historyButton.addEventListener("click", openDrawer);
drawerClose.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

newConversationButton.addEventListener("click", () => {
    if (state.pc) stopRealtime();
    resetConversation();
    closeDrawer();
    showToast("新しい会話を開始しました");
});

window.addEventListener("beforeunload", saveCurrentSession);

boot();
