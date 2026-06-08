const state = { users: [], admin: null };

const loginScreen = document.querySelector("#loginScreen");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const loginBtn = document.querySelector("#loginBtn");
const adminEmailInput = document.querySelector("#adminEmail");
const adminPasswordInput = document.querySelector("#adminPassword");
const passwordToggle = document.querySelector("#passwordToggle");
const adminLabel = document.querySelector("#adminLabel");
const adminAvatar = document.querySelector("#adminAvatar");
const logoutBtn = document.querySelector("#logoutBtn");
const userTableWrap = document.querySelector("#userTableWrap");
const newUserId = document.querySelector("#newUserId");
const newUserPassword = document.querySelector("#newUserPassword");
const newUserPasswordToggle = document.querySelector("#newUserPasswordToggle");
const addUserBtn = document.querySelector("#addUserBtn");
const generateIdBtn = document.querySelector("#generateIdBtn");
const quickAddBtn = document.querySelector("#quickAddBtn");
const addUserMessage = document.querySelector("#addUserMessage");
const refreshBtn = document.querySelector("#refreshBtn");
const userSearch = document.querySelector("#userSearch");
const searchWrap = document.querySelector("#searchWrap");
const searchClear = document.querySelector("#searchClear");
const statTotal = document.querySelector("#statTotal");
const statSeeded = document.querySelector("#statSeeded");
const statCustom = document.querySelector("#statCustom");
const statVisible = document.querySelector("#statVisible");
const toast = document.querySelector("#toast");
const dialogOverlay = document.querySelector("#dialogOverlay");
const credentialsOverlay = document.querySelector("#credentialsOverlay");
const credId = document.querySelector("#credId");
const credPassword = document.querySelector("#credPassword");
const credCopyBtn = document.querySelector("#credCopyBtn");
const credCloseBtn = document.querySelector("#credCloseBtn");
const dialogMessage = document.querySelector("#dialogMessage");
const dialogCancel = document.querySelector("#dialogCancel");
const dialogConfirm = document.querySelector("#dialogConfirm");

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
    if (response.status === 429) throw new Error(payload.error || "ログイン試行が多すぎます。");
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function sortUsers(users) {
  return [...(users || [])].sort((a, b) => a.id.localeCompare(b.id, "ja"));
}

function showDashboard(user) {
  state.admin = user;
  loginScreen.classList.add("is-hidden");
  dashboard.classList.remove("is-hidden");
  const label = user.id || "管理者";
  adminLabel.textContent = label;
  adminAvatar.textContent = label.charAt(0).toUpperCase() || "A";
  loadUsers();
}

function showLogin() {
  state.admin = null;
  dashboard.classList.add("is-hidden");
  loginScreen.classList.remove("is-hidden");
  loginError.textContent = "";
}

let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2000);
}

let confirmCb = null;
function showConfirm(message, onConfirm) {
  dialogMessage.textContent = message;
  confirmCb = onConfirm;
  dialogOverlay.classList.remove("is-hidden");
  dialogConfirm?.focus();
}

function closeConfirm() {
  dialogOverlay.classList.add("is-hidden");
  confirmCb = null;
}

function clearCredentialsDialog() {
  if (credId) credId.textContent = "";
  if (credPassword) credPassword.textContent = "";
}

function closeCredentialsDialog() {
  clearCredentialsDialog();
  credentialsOverlay?.classList.add("is-hidden");
}

function showCredentialsDialog(id, password) {
  if (!credentialsOverlay || !credId || !credPassword) return;
  credId.textContent = id;
  credPassword.textContent = password;
  credentialsOverlay.classList.remove("is-hidden");
}

function generateAccessId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `team_${part(4)}-${part(4)}`;
}

async function copyId(id, rowEl) {
  try {
    await navigator.clipboard.writeText(id);
    showToast("IDをコピーしました");
    if (rowEl) {
      rowEl.classList.add("is-copied");
      const btn = rowEl.querySelector(".dash-table-copy");
      const prev = btn?.textContent;
      if (btn) btn.textContent = "済";
      setTimeout(() => {
        rowEl.classList.remove("is-copied");
        if (btn && prev) btn.textContent = prev;
      }, 1600);
    }
  } catch {
    showToast("コピーに失敗しました");
  }
}

function updateStats(users, visible) {
  const total = users.length;
  const seeded = users.filter((u) => u.seeded).length;
  const custom = total - seeded;
  statTotal.textContent = String(total);
  statSeeded.textContent = String(seeded);
  statCustom.textContent = String(custom);
  statVisible.textContent = visible === undefined ? "—" : String(visible);
  searchWrap.hidden = total === 0;
}

function renderTable(users) {
  state.users = sortUsers(users);
  const query = (userSearch?.value || "").trim().toLowerCase();
  const filtered = query
    ? state.users.filter((u) => u.id.toLowerCase().includes(query))
    : state.users;

  updateStats(state.users, filtered.length);
  searchClear.hidden = !query;

  if (state.users.length === 0) {
    userTableWrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">ユーザーがいません</p>
        <p class="dash-empty-desc">左のフォームからアクセスIDを追加してください。</p>
        <button class="dash-btn dash-btn-primary" type="button" id="emptyQuickAdd">IDを自動生成して追加</button>
      </div>`;
    userTableWrap.querySelector("#emptyQuickAdd")?.addEventListener("click", handleQuickAdd);
    return;
  }

  if (filtered.length === 0) {
    userTableWrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">一致するユーザーがありません</p>
        <p class="dash-empty-desc">検索条件を変更してください。</p>
      </div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "dash-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>アクセスID</th>
        <th>種別</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>`;
  const tbody = table.querySelector("tbody");

  for (const u of filtered) {
    const tr = document.createElement("tr");

    const idTd = document.createElement("td");
    idTd.className = "dash-table-id";
    idTd.textContent = u.id;

    const typeTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `dash-table-badge ${u.seeded ? "" : "is-custom"}`.trim();
    badge.textContent = u.seeded ? "環境設定" : "追加済み";
    typeTd.appendChild(badge);
    if (u.mustChangePassword) {
      const pendingBadge = document.createElement("span");
      pendingBadge.className = "dash-table-badge is-pending";
      pendingBadge.textContent = "初回未変更";
      pendingBadge.style.marginLeft = "0.35rem";
      typeTd.appendChild(pendingBadge);
    }

    const actionsTd = document.createElement("td");
    actionsTd.className = "dash-table-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "dash-table-copy";
    copyBtn.textContent = "コピー";
    copyBtn.addEventListener("click", () => copyId(u.id, tr));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "dash-table-del";
    delBtn.setAttribute("aria-label", `${u.id} を削除`);
    delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    if (u.seeded) {
      delBtn.disabled = true;
      delBtn.title = "環境設定で定義されたIDは削除できません";
    }
    delBtn.addEventListener("click", () => {
      if (u.seeded) {
        showToast("環境設定で定義されたIDは削除できません");
        return;
      }
      showConfirm(`「${u.id}」を削除しますか？`, async () => {
        try {
          const { users: updated } = await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
          showToast("削除しました");
          renderTable(updated);
        } catch (e) {
          showToast(e.message);
        }
      });
    });

    actionsTd.append(copyBtn, delBtn);
    tr.append(idTd, typeTd, actionsTd);
    tbody.appendChild(tr);
  }

  userTableWrap.innerHTML = "";
  userTableWrap.appendChild(table);
}

async function loadUsers(options = {}) {
  const { preserveSearch = false } = options;
  userTableWrap.innerHTML = '<p class="dash-loading"><span class="admin-spinner"></span>読み込み中...</p>';
  updateStats([], undefined);
  if (!preserveSearch && userSearch) userSearch.value = "";
  try {
    const { users } = await api("/api/admin/users");
    renderTable(users);
  } catch (e) {
    userTableWrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">読み込みに失敗しました</p>
        <p class="dash-empty-desc">${e.message}</p>
        <button class="dash-btn dash-btn-secondary" type="button" id="retryLoad">再読み込み</button>
      </div>`;
    userTableWrap.querySelector("#retryLoad")?.addEventListener("click", loadUsers);
  }
}

function setFormMessage(text, type = "error") {
  addUserMessage.textContent = text;
  addUserMessage.classList.toggle("is-success", type === "success");
}

async function handleAddUser() {
  const id = newUserId.value.trim();
  const password = newUserPassword.value.trim();
  if (!id) {
    setFormMessage("IDを入力してください");
    return;
  }
  setFormMessage("");
  addUserBtn.disabled = true;
  quickAddBtn.disabled = true;
  try {
    const payload = { id };
    if (password) payload.password = password;
    const result = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    newUserId.value = "";
    newUserPassword.value = "";
    const initialPassword = result.initialPassword;
    setFormMessage(`「${id}」を追加しました`, "success");
    if (initialPassword) {
      showCredentialsDialog(id, initialPassword);
      try {
        await navigator.clipboard.writeText(`ID: ${id}\nパスワード: ${initialPassword}`);
        showToast("クリップボードにコピーしました");
      } catch {
        showToast("クリップボードへのコピーに失敗しました。表示中の情報を控えてください");
      }
    } else {
      showToast(`「${id}」を追加しました`);
    }
    renderTable(result.users);
    await copyId(id);
  } catch (e) {
    setFormMessage(e.message);
  } finally {
    addUserBtn.disabled = false;
    quickAddBtn.disabled = false;
  }
}

async function handleQuickAdd() {
  newUserId.value = generateAccessId();
  await handleAddUser();
}

async function handleLogin(e) {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "ログイン中...";
  try {
    const { user } = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: adminEmailInput.value.trim(),
        password: adminPasswordInput.value
      })
    });
    adminPasswordInput.value = "";
    showDashboard(user);
  } catch (err) {
    loginError.textContent = err.message;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "ログイン";
  }
}

async function boot() {
  try {
    const { user } = await api("/api/me");
    if (user.role === "admin") {
      showDashboard(user);
      return;
    }
    window.location.replace("/");
  } catch {
    showLogin();
  }
}

loginForm.addEventListener("submit", handleLogin);
logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  showLogin();
});
addUserBtn.addEventListener("click", handleAddUser);
generateIdBtn.addEventListener("click", () => {
  newUserId.value = generateAccessId();
  newUserId.focus();
  setFormMessage("");
});
quickAddBtn.addEventListener("click", handleQuickAdd);
refreshBtn.addEventListener("click", () => loadUsers({ preserveSearch: true }));
userSearch?.addEventListener("input", () => renderTable(state.users));
searchClear?.addEventListener("click", () => {
  userSearch.value = "";
  searchClear.hidden = true;
  renderTable(state.users);
  userSearch.focus();
});
newUserId?.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddUser(); });
passwordToggle?.addEventListener("click", () => {
  const show = adminPasswordInput.type === "password";
  adminPasswordInput.type = show ? "text" : "password";
  passwordToggle.classList.toggle("is-visible", show);
});
newUserPasswordToggle?.addEventListener("click", () => {
  const show = newUserPassword.type === "password";
  newUserPassword.type = show ? "text" : "password";
  newUserPasswordToggle.classList.toggle("is-visible", show);
});
credCloseBtn?.addEventListener("click", closeCredentialsDialog);
credCopyBtn?.addEventListener("click", async () => {
  const id = credId?.textContent || "";
  const password = credPassword?.textContent || "";
  if (!id || !password) return;
  try {
    await navigator.clipboard.writeText(`ID: ${id}\nパスワード: ${password}`);
    showToast("クリップボードにコピーしました");
  } catch {
    showToast("クリップボードへのコピーに失敗しました");
  }
});
credentialsOverlay?.addEventListener("click", (e) => {
  if (e.target === credentialsOverlay) closeCredentialsDialog();
});
dialogCancel.addEventListener("click", closeConfirm);
dialogConfirm.addEventListener("click", () => {
  const cb = confirmCb;
  closeConfirm();
  if (cb) cb();
});
dialogOverlay.addEventListener("click", (e) => {
  if (e.target === dialogOverlay) closeConfirm();
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!credentialsOverlay?.classList.contains("is-hidden")) {
    closeCredentialsDialog();
    return;
  }
  if (!dialogOverlay.classList.contains("is-hidden")) closeConfirm();
});

boot();
