const HISTORY_KEY = "lingualive_history_v2";

const state = {
      pc: null, dc: null, stream: null, user: null,
      turns: [], activeTurn: null,
      sessionId: null, sessionStartedAt: null,
      viewingHistory: false,
      passwordGateForced: false
};

// DOM refs
const authView = document.querySelector("#authView");
const translatorView = document.querySelector("#translatorView");
const loginForm = document.querySelector("#loginForm");
const accessIdInput = document.querySelector("#accessId");
const accessPasswordInput = document.querySelector("#accessPassword");
const accessPasswordToggle = document.querySelector("#accessPasswordToggle");
const pasteAccessIdBtn = document.querySelector("#pasteAccessId");
const authMessage = document.querySelector("#authMessage");
const loginSubmit = document.querySelector("#loginSubmit");
const logoutButton = document.querySelector("#logoutButton");
const changePasswordBtn = document.querySelector("#changePasswordBtn");
const passwordOverlay = document.querySelector("#passwordOverlay");
const passwordChangeForm = document.querySelector("#passwordChangeForm");
const passwordDialogDesc = document.querySelector("#passwordDialogDesc");
const currentPasswordInput = document.querySelector("#currentPassword");
const newPasswordInput = document.querySelector("#newPassword");
const confirmPasswordInput = document.querySelector("#confirmPassword");
const passwordChangeMessage = document.querySelector("#passwordChangeMessage");
const passwordCancelBtn = document.querySelector("#passwordCancelBtn");
const passwordSubmitBtn = document.querySelector("#passwordSubmitBtn");
const passwordLogoutBtn = document.querySelector("#passwordLogoutBtn");
const micButton = document.querySelector("#micButton");
const micHint = document.querySelector("#micHint");
const micLabel = document.querySelector("#micLabel");
const historyBanner = document.querySelector("#historyBanner");
const resumeLiveBtn = document.querySelector("#resumeLiveBtn");
const connectionState = document.querySelector("#connectionState");
const chatList = document.querySelector("#chatList");
const remoteAudio = document.querySelector("#remoteAudio");
const historyButton = document.querySelector("#historyButton");
const drawer = document.querySelector("#drawer");
const drawerOverlay = document.querySelector("#drawerOverlay");
const drawerClose = document.querySelector("#drawerClose");
const newConversationButton = document.querySelector("#newConversationButton");
const sessionList = document.querySelector("#sessionList");
const toast = document.querySelector("#toast");

/* ───────── API ───────── */

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
              if (response.status === 429) throw new Error(payload.error || "試行回数が多すぎます。しばらく待ってから再試行してください。");
              throw new Error(payload.error || "Request failed");
      }
      return payload;
}

/* ───────── 翻訳指示 ───────── */

function buildInstructions() {
      return [
              "You are AMALINK Translation, a realtime multilingual interpreter.",
              "Automatically detect which language the speaker is using.",
              "Translate their speech into another language suited for live interpretation.",
              "When the speaker switches language, adapt immediately without asking or commenting.",
              "Return only the translation, with no commentary, labels, or explanations.",
              "Keep the translation natural, concise, and faithful. Preserve names, numbers, and technical terms."
            ].join(" ");
}

/* ───────── 認証・画面切り替え ───────── */

function setAuthenticated(user) {
      state.user = user;
      authView.classList.add("is-hidden");
      translatorView.classList.remove("is-hidden");
      renderConversation();
      renderSessionList();
      updateLiveUi();
      syncPasswordGate();
}

function openPasswordDialog(forced = false) {
      state.passwordGateForced = forced;
      if (!passwordOverlay) return;
      passwordOverlay.classList.remove("is-hidden");
      if (passwordDialogDesc) {
              passwordDialogDesc.textContent = forced
                        ? "仮パスワードでログインしました。翻訳を開始する前に、新しいパスワードを設定してください。"
                        : "新しいパスワードを設定してください。";
      }
      if (passwordCancelBtn) passwordCancelBtn.classList.toggle("is-hidden", forced);
      if (passwordLogoutBtn) passwordLogoutBtn.classList.toggle("is-hidden", !forced);
      if (currentPasswordInput) currentPasswordInput.value = "";
      if (newPasswordInput) newPasswordInput.value = "";
      if (confirmPasswordInput) confirmPasswordInput.value = "";
      if (passwordChangeMessage) passwordChangeMessage.textContent = "";
      closeDrawer();
      currentPasswordInput?.focus();
}

function closePasswordDialog() {
      if (state.passwordGateForced) return;
      passwordOverlay?.classList.add("is-hidden");
}

function syncPasswordGate() {
      if (state.user?.mustChangePassword) openPasswordDialog(true);
      else {
              state.passwordGateForced = false;
              passwordOverlay?.classList.add("is-hidden");
      }
}

function setLoggedOut() {
      state.user = null;
      state.passwordGateForced = false;
      passwordOverlay?.classList.add("is-hidden");
      closeDrawer();
      authView.classList.remove("is-hidden");
      translatorView.classList.add("is-hidden");
      authMessage.textContent = "";
      accessPasswordInput.value = "";
      accessIdInput.focus();
}

async function handlePasswordChange(event) {
      event.preventDefault();
      if (!passwordChangeMessage) return;
      passwordChangeMessage.textContent = "";
      const current = currentPasswordInput?.value || "";
      const next = newPasswordInput?.value || "";
      const confirm = confirmPasswordInput?.value || "";
      if (next !== confirm) {
              passwordChangeMessage.textContent = "新しいパスワードが一致しません。";
              return;
      }
      if (passwordSubmitBtn) {
              passwordSubmitBtn.disabled = true;
              passwordSubmitBtn.textContent = "変更中...";
      }
      try {
              const { user } = await api("/api/password", {
                        method: "POST",
                        body: JSON.stringify({ currentPassword: current, newPassword: next })
              });
              state.user = user;
              state.passwordGateForced = false;
              passwordOverlay?.classList.add("is-hidden");
              if (currentPasswordInput) currentPasswordInput.value = "";
              if (newPasswordInput) newPasswordInput.value = "";
              if (confirmPasswordInput) confirmPasswordInput.value = "";
              showToast("パスワードを変更しました");
      } catch (error) {
              passwordChangeMessage.textContent = error.message;
      } finally {
              if (passwordSubmitBtn) {
                        passwordSubmitBtn.disabled = false;
                        passwordSubmitBtn.textContent = "変更する";
              }
      }
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
                      <li>任意の言語で話す</li>
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
      if (state.user?.mustChangePassword) {
              openPasswordDialog(true);
              return;
      }
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
              if (error.message.includes("パスワードを変更")) {
                        state.user = { ...state.user, mustChangePassword: true };
                        openPasswordDialog(true);
                        return;
              }
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
              if (user.role === "admin") {
                        // 管理セッションはユーザー画面では使わない（/admin/ へ飛ばさない）
                        setLoggedOut();
                        return;
              }
              setAuthenticated(user);
      } catch {
              setLoggedOut();
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
              const { user } = await api("/api/login", {
                        method: "POST",
                        body: JSON.stringify({
                                  accessId: accessIdInput.value.trim(),
                                  password: accessPasswordInput.value
                        })
              });
              accessIdInput.value = "";
              accessPasswordInput.value = "";
              setAuthenticated(user);
      } catch (error) {
              authMessage.textContent = error.message;
      } finally {
              loginSubmit.disabled = false;
              loginSubmit.textContent = "ログイン";
      }
}

async function handleLogout() {
      stopRealtime();
      await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
      state.user = null;
      closeDrawer();
      translatorView.classList.add("is-hidden");
      authMessage.textContent = "";
      accessIdInput.value = "";
      accessPasswordInput.value = "";
      setLoggedOut();
}

loginForm.addEventListener("submit", (e) => { e.preventDefault(); handleLogin(); });
if (pasteAccessIdBtn) pasteAccessIdBtn.addEventListener("click", handlePasteAccessId);
if (accessPasswordToggle) {
      accessPasswordToggle.addEventListener("click", () => {
              const show = accessPasswordInput.type === "password";
              accessPasswordInput.type = show ? "text" : "password";
              accessPasswordToggle.classList.toggle("is-visible", show);
              accessPasswordToggle.setAttribute("aria-label", show ? "パスワードを隠す" : "パスワードを表示");
      });
}
logoutButton.addEventListener("click", handleLogout);
changePasswordBtn?.addEventListener("click", () => { closeDrawer(); openPasswordDialog(false); });
passwordChangeForm?.addEventListener("submit", handlePasswordChange);
passwordCancelBtn?.addEventListener("click", closePasswordDialog);
passwordLogoutBtn?.addEventListener("click", handleLogout);

micButton.addEventListener("click", () => { if (state.pc) stopRealtime(); else startRealtime(); });

if (resumeLiveBtn) resumeLiveBtn.addEventListener("click", resumeLiveTranslation);

historyButton.addEventListener("click", openDrawer);
drawerClose.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

newConversationButton.addEventListener("click", () => {
      if (state.pc) stopRealtime();
      resetConversation(); closeDrawer(); showToast("新しい会話を開始しました");
});

window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (drawer?.classList.contains("is-open")) closeDrawer();
});

window.addEventListener("beforeunload", saveCurrentSession);

boot();
