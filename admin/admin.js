const state = { users: [], accounts: [], admin: null };

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
const newDisplayName = document.querySelector("#newDisplayName");
const newAccountName = document.querySelector("#newAccountName");
const newContactName = document.querySelector("#newContactName");
const newPlanId = document.querySelector("#newPlanId");
const newMonthlyRevenue = document.querySelector("#newMonthlyRevenue");
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

const ERROR_MESSAGES = {
  "Not authenticated": "ログインが必要です。",
  Forbidden: "この操作を行う権限がありません。",
  "Invalid origin": "このアクセス元からは利用できません。",
  "Account user not found": "管理画面で顧客アカウントを作成してから利用してください。",
  account_suspended: "このアカウントは停止中です。",
  monthly_quota_exhausted: "今月の利用上限に達しています。",
  daily_quota_exhausted: "本日の利用上限に達しています。",
  cost_ratio_stop: "原価率が上限を超えています。",
  concurrent_limit: "同時接続数の上限に達しています。",
  password_change_required: "利用開始前にパスワードを変更してください。"
};

function displayErrorMessage(error) {
  const key = String(error || "").trim();
  return ERROR_MESSAGES[key] || key || "リクエストに失敗しました。";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
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
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("サーバーの応答を読み取れませんでした。");
    }
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error("ログイン試行回数が多すぎます。しばらく待ってください。");
    throw new Error(displayErrorMessage(payload.error));
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
  loadAccounts();
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
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
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

function closeCredentialsDialog() {
  if (credId) credId.textContent = "";
  if (credPassword) credPassword.textContent = "";
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

async function copyText(text, successMessage, failureMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
    return true;
  } catch {
    showToast(failureMessage);
    return false;
  }
}

async function copyId(id, rowEl) {
  const copied = await copyText(id, "IDをコピーしました。", "コピーに失敗しました。");
  if (!copied || !rowEl) return;
  rowEl.classList.add("is-copied");
  setTimeout(() => rowEl.classList.remove("is-copied"), 1400);
}

function updateStats(users, visible) {
  const total = users.length;
  const seeded = users.filter((u) => u.seeded).length;
  statTotal.textContent = String(total);
  statSeeded.textContent = String(seeded);
  statCustom.textContent = String(total - seeded);
  statVisible.textContent = visible === undefined ? "-" : String(visible);
  searchWrap.hidden = total === 0;
}

function searchableUserText(user) {
  return [
    user.id,
    user.display_name,
    user.account_name,
    user.customer_name,
    user.contact_name,
    user.account_id
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderTable(users) {
  state.users = sortUsers(users);
  const query = (userSearch?.value || "").trim().toLowerCase();
  const filtered = query ? state.users.filter((u) => searchableUserText(u).includes(query)) : state.users;

  updateStats(state.users, filtered.length);
  searchClear.hidden = !query;

  if (state.users.length === 0) {
    userTableWrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">アクセスIDがありません</p>
        <p class="dash-empty-desc">左のフォームから顧客アカウントとアクセスIDを作成してください。</p>
        <button class="dash-btn dash-btn-primary" type="button" id="emptyQuickAdd">自動生成して作成</button>
      </div>`;
    userTableWrap.querySelector("#emptyQuickAdd")?.addEventListener("click", handleQuickAdd);
    return;
  }

  if (filtered.length === 0) {
    userTableWrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">一致するIDがありません</p>
        <p class="dash-empty-desc">検索条件を変えてください。</p>
      </div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "dash-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>顧客 / アクセスID</th>
        <th>契約</th>
        <th>状態</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>`;
  const tbody = table.querySelector("tbody");

  for (const user of filtered) {
    const tr = document.createElement("tr");
    const name = user.display_name || user.customer_name || user.id;
    const account = user.account_name || user.customer_name || "未設定";
    tr.innerHTML = `
      <td class="dash-table-id">
        <strong>${esc(name)}</strong>
        <span class="dash-muted">${esc(user.id)}</span>
        <span class="dash-muted">${esc(account)}</span>
      </td>
      <td>
        ${esc(user.plan_id || "-")}
        <span class="dash-muted">${formatMoney(user.monthly_revenue_jpy || 0)} / 月</span>
      </td>
      <td></td>
      <td class="dash-table-actions"></td>`;

    const statusTd = tr.children[2];
    const badge = document.createElement("span");
    badge.className = `dash-table-badge ${user.seeded ? "" : "is-custom"}`.trim();
    badge.textContent = user.seeded ? "環境設定ID" : "管理追加";
    statusTd.appendChild(badge);
    if (user.mustChangePassword) {
      const pendingBadge = document.createElement("span");
      pendingBadge.className = "dash-table-badge is-pending";
      pendingBadge.textContent = "初期PW未変更";
      pendingBadge.style.marginLeft = "0.35rem";
      statusTd.appendChild(pendingBadge);
    }

    const actionsTd = tr.querySelector(".dash-table-actions");
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "dash-table-copy";
    copyBtn.textContent = "コピー";
    copyBtn.addEventListener("click", () => copyId(user.id, tr));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "dash-table-del";
    delBtn.setAttribute("aria-label", `${user.id} を削除`);
    delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    if (user.seeded) {
      delBtn.disabled = true;
      delBtn.title = "環境設定IDは削除できません。";
    }
    delBtn.addEventListener("click", () => {
      if (user.seeded) {
        showToast("環境設定IDは削除できません。");
        return;
      }
      showConfirm(`「${user.id}」を削除しますか？`, async () => {
        try {
          const { users: updated } = await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
          showToast("削除しました。");
          renderTable(updated);
          loadAccounts();
        } catch (error) {
          showToast(error.message);
        }
      });
    });

    actionsTd.append(copyBtn, delBtn);
    tbody.appendChild(tr);
  }

  userTableWrap.innerHTML = "";
  userTableWrap.appendChild(table);
}

function formatMinutes(seconds) {
  return `${Math.ceil(Number(seconds || 0) / 60)}分`;
}

function formatMoney(value) {
  return `${Math.round(Number(value || 0)).toLocaleString("ja-JP")}円`;
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function accountStatusLabel(account) {
  const status = String(account.status || "");
  const ratio = Number(account.cost_ratio || 0);
  const remaining = Number(account.remaining_seconds || 0);
  const dailyRemaining = Number(account.daily_remaining_seconds || 0);
  if (status !== "active") return "停止中";
  if (ratio >= 0.45) return "原価率注意";
  if (remaining <= 0 || dailyRemaining <= 0) return "上限到達";
  return "利用可能";
}

function accountStatusClass(account) {
  const label = accountStatusLabel(account);
  if (label === "利用可能") return "is-custom";
  if (label === "停止中") return "is-pending";
  return "is-danger";
}

function getAccountPanel() {
  let panel = document.querySelector("#accountUsagePanel");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.className = "dash-panel dash-panel-table dash-account-panel";
  panel.id = "accountUsagePanel";
  panel.innerHTML = `
    <div class="dash-panel-head">
      <div>
        <h2 class="dash-panel-title">契約アカウント</h2>
        <p class="dash-panel-desc">顧客別の利用量、売上、推定API原価、停止状態を確認します。</p>
      </div>
      <button class="dash-btn dash-btn-icon" id="refreshAccountsBtn" type="button" title="更新" aria-label="更新">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 4v6h6M20 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20 8a8 8 0 00-14.9-3M4 16a8 8 0 0014.9 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="dash-privacy-note">
      利用者側には契約名、残量、原価、売上を表示しません。管理画面だけが顧客台帳と利用量を持ちます。
    </div>
    <div class="dash-table-wrap" id="accountTableWrap">
      <p class="dash-loading"><span class="admin-spinner"></span>読み込み中...</p>
    </div>`;
  document.querySelector(".dash-panels")?.appendChild(panel);
  panel.querySelector("#refreshAccountsBtn")?.addEventListener("click", loadAccounts);
  return panel;
}

function renderAccounts(accounts) {
  state.accounts = accounts || [];
  const wrap = getAccountPanel().querySelector("#accountTableWrap");
  if (state.accounts.length === 0) {
    wrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">契約アカウントはまだありません</p>
        <p class="dash-empty-desc">左のフォームから管理者が顧客アカウントを作成してください。</p>
      </div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "dash-table dash-account-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>顧客</th>
        <th>プラン</th>
        <th>利用量</th>
        <th>収益性</th>
        <th>状態</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>`;
  const tbody = table.querySelector("tbody");

  for (const account of state.accounts) {
    const used = Number(account.month_seconds || 0);
    const reserved = Number(account.reserved_seconds || 0);
    const limit = Number(account.monthly_limit_seconds || Number(account.monthly_minutes || 0) * 60);
    const dailyUsed = Number(account.daily_seconds || 0);
    const dailyLimit = Number(account.daily_limit_seconds || Number(account.daily_minutes || 0) * 60);
    const ratio = Number(account.cost_ratio || 0);
    const monthlyRevenue = Number(account.monthly_revenue_jpy || account.monthly_price_jpy || 0);
    const adjustmentRevenue = Number(account.adjustment_revenue_jpy || 0);
    const revenue = Number(account.total_revenue_jpy || monthlyRevenue + adjustmentRevenue);
    const cost = Number(account.estimated_cost_jpy || 0);
    const grossProfit = revenue - cost;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${esc(account.customer_name || account.name || account.id)}</strong>
        <span class="dash-muted">${esc(account.name || account.id)}</span>
        ${account.contact_name ? `<span class="dash-muted">担当: ${esc(account.contact_name)}</span>` : ""}
        <span class="dash-muted">${esc(account.id)}</span>
      </td>
      <td>${esc(account.plan_name || account.plan_id)}</td>
      <td>
        今月 ${formatMinutes(used)} / ${formatMinutes(limit)}
        <span class="dash-muted">本日 ${formatMinutes(dailyUsed)} / ${formatMinutes(dailyLimit)}</span>
        <span class="dash-muted">残り ${formatMinutes(account.remaining_seconds || 0)}</span>
        <span class="dash-muted">予約中 ${formatMinutes(reserved)} / 追加 ${account.adjustment_minutes || 0}分</span>
        <span class="dash-muted">同時接続 ${account.active_sessions || 0}</span>
      </td>
      <td>
        <span>月額売上 ${formatMoney(monthlyRevenue)}</span>
        <span class="dash-muted">追加売上 ${formatMoney(adjustmentRevenue)}</span>
        <span class="dash-muted">合計売上 ${formatMoney(revenue)}</span>
        <span class="dash-muted">推定API原価 ${formatMoney(cost)}</span>
        <span class="dash-muted">粗利 ${formatMoney(grossProfit)}</span>
        <span class="dash-muted">原価率 ${formatPercent(ratio)}</span>
      </td>
      <td><span class="dash-table-badge ${accountStatusClass(account)}">${accountStatusLabel(account)}</span></td>
      <td class="dash-table-actions"></td>`;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = account.status === "active" ? "dash-table-copy is-danger-action" : "dash-table-copy";
    toggleBtn.textContent = account.status === "active" ? "停止" : "再開";
    toggleBtn.addEventListener("click", async () => {
      const next = account.status === "active" ? "suspended" : "active";
      try {
        await api(`/api/admin/accounts/${encodeURIComponent(account.id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: next })
        });
        showToast(next === "active" ? "再開しました。" : "停止しました。");
        loadAccounts();
      } catch (error) {
        showToast(error.message);
      }
    });

    const quotaForm = document.createElement("form");
    quotaForm.className = "dash-quota-form";
    quotaForm.innerHTML = `
      <input class="dash-quota-input" type="number" min="1" step="1" value="30" aria-label="追加分数" />
      <input class="dash-quota-price" type="number" min="0" step="100" value="0" aria-label="追加請求額" />
      <button class="dash-table-copy" type="submit">分数追加</button>`;
    quotaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const minutesInput = quotaForm.querySelector(".dash-quota-input");
      const priceInput = quotaForm.querySelector(".dash-quota-price");
      const minutes = Math.max(0, Number(minutesInput?.value || 0));
      const priceJpy = Math.max(0, Number(priceInput?.value || 0));
      if (!minutes) {
        showToast("追加分数を入力してください。");
        return;
      }
      try {
        await api(`/api/admin/accounts/${encodeURIComponent(account.id)}/quota-adjustments`, {
          method: "POST",
          body: JSON.stringify({ minutes, priceJpy, reason: "admin_adjustment" })
        });
        showToast(`${minutes}分を追加しました。`);
        loadAccounts();
      } catch (error) {
        showToast(error.message);
      }
    });

    tr.querySelector(".dash-table-actions").append(toggleBtn, quotaForm);
    tbody.appendChild(tr);
  }

  wrap.innerHTML = "";
  wrap.appendChild(table);
}

async function loadAccounts() {
  const panel = getAccountPanel();
  const wrap = panel.querySelector("#accountTableWrap");
  wrap.innerHTML = '<p class="dash-loading"><span class="admin-spinner"></span>読み込み中...</p>';
  try {
    const { accounts } = await api("/api/admin/accounts");
    renderAccounts(accounts);
  } catch (error) {
    wrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">利用状況を読み込めません</p>
        <p class="dash-empty-desc">${esc(error.message)}</p>
      </div>`;
  }
}

async function loadUsers(options = {}) {
  const { preserveSearch = false } = options;
  userTableWrap.innerHTML = '<p class="dash-loading"><span class="admin-spinner"></span>読み込み中...</p>';
  updateStats([], undefined);
  if (!preserveSearch && userSearch) userSearch.value = "";
  try {
    const { users } = await api("/api/admin/users");
    renderTable(users);
  } catch (error) {
    userTableWrap.innerHTML = `
      <div class="dash-empty">
        <p class="dash-empty-title">読み込みに失敗しました</p>
        <p class="dash-empty-desc">${esc(error.message)}</p>
        <button class="dash-btn dash-btn-secondary" type="button" id="retryLoad">再読み込み</button>
      </div>`;
    userTableWrap.querySelector("#retryLoad")?.addEventListener("click", loadUsers);
  }
}

function setFormMessage(text, type = "error") {
  addUserMessage.textContent = text;
  addUserMessage.classList.toggle("is-success", type === "success");
}

function clearCreateForm() {
  newDisplayName.value = "";
  newAccountName.value = "";
  newContactName.value = "";
  newMonthlyRevenue.value = "";
  newUserId.value = "";
  newUserPassword.value = "";
  newPlanId.value = "lite";
}

async function handleAddUser() {
  const id = newUserId.value.trim();
  const displayName = newDisplayName.value.trim();
  const accountName = newAccountName.value.trim();
  const contactName = newContactName.value.trim();
  const password = newUserPassword.value.trim();
  if (!displayName && !accountName) {
    setFormMessage("顧客名または会社名を入力してください。");
    return;
  }
  if (!id) {
    setFormMessage("アクセスIDを入力してください。");
    return;
  }

  setFormMessage("");
  addUserBtn.disabled = true;
  quickAddBtn.disabled = true;
  try {
    const payload = {
      id,
      displayName: displayName || accountName,
      customerName: displayName || accountName,
      accountName: accountName || displayName,
      contactName,
      planId: newPlanId.value || "lite",
      monthlyRevenueJpy: Number(newMonthlyRevenue.value || 0)
    };
    if (password) payload.password = password;
    const result = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    clearCreateForm();
    setFormMessage(`「${id}」を作成しました。`, "success");
    if (result.initialPassword) {
      showCredentialsDialog(id, result.initialPassword);
      await copyText(
        `アクセスID: ${id}\nパスワード: ${result.initialPassword}`,
        "認証情報をコピーしました。",
        "コピーに失敗しました。表示中の認証情報を控えてください。"
      );
    } else {
      showToast(`「${id}」を作成しました。`);
    }
    renderTable(result.users);
    loadAccounts();
  } catch (error) {
    setFormMessage(error.message);
  } finally {
    addUserBtn.disabled = false;
    quickAddBtn.disabled = false;
  }
}

async function handleQuickAdd() {
  if (!newDisplayName.value.trim() && !newAccountName.value.trim()) {
    newDisplayName.value = "新規顧客";
    newAccountName.value = "新規アカウント";
  }
  newUserId.value = generateAccessId();
  await handleAddUser();
}

async function handleLogin(event) {
  event.preventDefault();
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
  } catch (error) {
    loginError.textContent = error.message;
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
newUserId?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAddUser();
});
passwordToggle?.addEventListener("click", () => {
  const show = adminPasswordInput.type === "password";
  adminPasswordInput.type = show ? "text" : "password";
  passwordToggle.classList.toggle("is-visible", show);
  passwordToggle.setAttribute("aria-label", show ? "パスワードを隠す" : "パスワードを表示");
});
newUserPasswordToggle?.addEventListener("click", () => {
  const show = newUserPassword.type === "password";
  newUserPassword.type = show ? "text" : "password";
  newUserPasswordToggle.classList.toggle("is-visible", show);
  newUserPasswordToggle.setAttribute("aria-label", show ? "パスワードを隠す" : "パスワードを表示");
});
credCloseBtn?.addEventListener("click", closeCredentialsDialog);
credCopyBtn?.addEventListener("click", async () => {
  const id = credId?.textContent || "";
  const password = credPassword?.textContent || "";
  if (!id || !password) return;
  await copyText(`アクセスID: ${id}\nパスワード: ${password}`, "コピーしました。", "コピーに失敗しました。");
});
credentialsOverlay?.addEventListener("click", (event) => {
  if (event.target === credentialsOverlay) closeCredentialsDialog();
});
dialogCancel.addEventListener("click", closeConfirm);
dialogConfirm.addEventListener("click", () => {
  const cb = confirmCb;
  closeConfirm();
  if (cb) cb();
});
dialogOverlay.addEventListener("click", (event) => {
  if (event.target === dialogOverlay) closeConfirm();
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!credentialsOverlay?.classList.contains("is-hidden")) {
    closeCredentialsDialog();
    return;
  }
  if (!dialogOverlay.classList.contains("is-hidden")) closeConfirm();
});

boot();
