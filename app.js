const $ = (selector) => document.querySelector(selector);
const state = { user: null, folder: "inbox", mails: [], activeMail: null, search: "" };

const authView = $("#auth-view");
const mailView = $("#mail-view");
const authForm = $("#auth-form");
const authFeedback = $("#auth-feedback");
const composeDialog = $("#compose-dialog");
const readDialog = $("#read-dialog");

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function niceDate(value) {
  const date = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function feedback(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle("success", success);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function setAuthMode(mode) {
  const isRegister = mode === "register";
  $("#login-tab").classList.toggle("active", !isRegister);
  $("#register-tab").classList.toggle("active", isRegister);
  $("#auth-title").textContent = isRegister ? "Create your account" : "Welcome back";
  $("#auth-subtitle").textContent = isRegister ? "Choose a username for your GMS mailbox." : "Log in to open your GMS inbox.";
  $("#auth-submit").innerHTML = isRegister ? "Create account <span>→</span>" : "Log in <span>→</span>";
  $("#auth-password").autocomplete = isRegister ? "new-password" : "current-password";
  authForm.dataset.mode = mode;
  feedback(authFeedback, "");
}
function showMailApp(user) {
  state.user = user;
  authView.classList.add("hidden");
  mailView.classList.remove("hidden");
  $("#top-user").textContent = `Signed in as ${user.username}`;
  $("#top-user").classList.remove("hidden");
  $("#account-name").textContent = user.username;
  $("#avatar").textContent = user.username.slice(0, 1).toUpperCase();
  state.folder = "inbox";
  state.search = "";
  $("#search-input").value = "";
  setFolderUI();
  loadMails();
}
function showAuth() {
  state.user = null;
  mailView.classList.add("hidden");
  authView.classList.remove("hidden");
  $("#top-user").classList.add("hidden");
}
function setFolderUI() {
  document.querySelectorAll(".folder").forEach(button => button.classList.toggle("active", button.dataset.folder === state.folder));
  $("#folder-title").textContent = state.folder === "inbox" ? "Inbox" : "Sent mail";
  $("#folder-eyebrow").textContent = state.folder === "inbox" ? "YOUR MAIL" : "MESSAGES YOU SENT";
  $("#search-input").placeholder = state.folder === "inbox" ? "Search inbox..." : "Search sent mail...";
  $("#empty-title").textContent = state.search ? "No matching mail" : state.folder === "inbox" ? "Your inbox is clear" : "No sent mail yet";
  $("#empty-copy").textContent = state.search ? "Try another search term." : state.folder === "inbox" ? "When someone sends you mail, it will appear here." : "Messages you send will be saved here.";
  $("#empty-compose").classList.toggle("hidden", state.folder !== "inbox" && !state.search);
}
function renderMails(mails) {
  state.mails = mails;
  const list = $("#mail-list");
  list.innerHTML = "";
  $("#empty-state").classList.toggle("hidden", mails.length > 0);
  $("#mail-list").classList.toggle("hidden", mails.length === 0);
  if (state.folder === "inbox") {
    const unread = mails.filter(mail => !mail.isRead).length;
    $("#inbox-count").textContent = unread ? String(unread) : "0";
  }
  for (const mail of mails) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `mail-item ${state.folder === "inbox" && !mail.isRead ? "unread" : ""}`;
    item.innerHTML = `
      <span class="mail-dot"></span>
      <div class="mail-main">
        <div class="mail-line">
          <span class="mail-person">${escapeHTML(state.folder === "inbox" ? mail.sender : `To: ${mail.receiver}`)}</span>
          <time class="mail-date">${escapeHTML(niceDate(mail.createdAt))}</time>
        </div>
        <div class="mail-subject">${escapeHTML(mail.subject || "(No subject)")}</div>
        <div class="mail-preview">${escapeHTML(mail.body.slice(0, 180))}</div>
      </div>
      ${state.folder === "inbox" && !mail.isRead ? '<span class="mail-badge">UNREAD</span>' : ""}
    `;
    item.addEventListener("click", () => openMail(mail));
    list.appendChild(item);
  }
}
async function loadMails() {
  const notice = $("#notice");
  notice.classList.add("hidden");
  try {
    const data = state.search
      ? await api(`/api/search?q=${encodeURIComponent(state.search)}&folder=${state.folder}`)
      : await api(`/api/mail/${state.folder}`);
    renderMails(data.mails);
    setFolderUI();
  } catch (error) {
    if (error.message.includes("log in")) showAuth();
    else {
      notice.textContent = error.message;
      notice.classList.remove("hidden");
    }
  }
}
async function openMail(mail) {
  state.activeMail = mail;
  if (state.folder === "inbox" && !mail.isRead) {
    try {
      await api(`/api/mail/${mail.id}/read`, { method: "POST" });
      mail.isRead = true;
      await loadMails();
    } catch (error) { showNotice(error.message); }
  }
  $("#read-subject").textContent = mail.subject || "(No subject)";
  $("#read-meta").textContent = state.folder === "inbox"
    ? `From: ${mail.sender}  ·  To: ${mail.receiver}  ·  ${niceDate(mail.createdAt)}`
    : `To: ${mail.receiver}  ·  From: ${mail.sender}  ·  ${niceDate(mail.createdAt)}`;
  $("#read-body").textContent = mail.body;
  $("#toggle-read").classList.toggle("hidden", state.folder !== "inbox");
  $("#toggle-read").textContent = mail.isRead ? "Mark unread" : "Mark read";
  readDialog.showModal();
}
function showNotice(message) {
  $("#notice").textContent = message;
  $("#notice").classList.remove("hidden");
}
function openCompose() {
  $("#compose-form").reset();
  feedback($("#compose-feedback"), "");
  composeDialog.showModal();
  $("#receiver").focus();
}

$("#login-tab").addEventListener("click", () => setAuthMode("login"));
$("#register-tab").addEventListener("click", () => setAuthMode("register"));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = authForm.dataset.mode || "login";
  const submit = $("#auth-submit");
  submit.disabled = true;
  feedback(authFeedback, mode === "register" ? "Creating account..." : "Logging in...");
  try {
    const data = await api(`/api/${mode}`, {
      method: "POST",
      body: JSON.stringify({
        username: $("#auth-username").value.trim(),
        password: $("#auth-password").value
      })
    });
    authForm.reset();
    showMailApp(data.user);
  } catch (error) {
    feedback(authFeedback, error.message);
  } finally { submit.disabled = false; }
});

document.querySelectorAll(".folder").forEach(button => {
  button.addEventListener("click", () => {
    state.folder = button.dataset.folder;
    state.search = "";
    $("#search-input").value = "";
    setFolderUI();
    loadMails();
  });
});
$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.search = $("#search-input").value.trim();
  loadMails();
});
$("#compose-button").addEventListener("click", openCompose);
$("#empty-compose").addEventListener("click", openCompose);
$("#close-compose").addEventListener("click", () => composeDialog.close());
$("#close-read").addEventListener("click", () => readDialog.close());
$("#compose-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#send-button");
  button.disabled = true;
  feedback($("#compose-feedback"), "Sending...");
  try {
    await api("/api/mail", {
      method: "POST",
      body: JSON.stringify({
        receiver: $("#receiver").value.trim(),
        subject: $("#subject").value.trim(),
        body: $("#message-body").value
      })
    });
    feedback($("#compose-feedback"), "Mail sent and saved to the recipient's inbox!", true);
    $("#compose-form").reset();
    await loadMails();
    setTimeout(() => composeDialog.close(), 650);
  } catch (error) {
    feedback($("#compose-feedback"), error.message);
  } finally { button.disabled = false; }
});
$("#toggle-read").addEventListener("click", async () => {
  const mail = state.activeMail;
  if (!mail || state.folder !== "inbox") return;
  const endpoint = mail.isRead ? "unread" : "read";
  try {
    await api(`/api/mail/${mail.id}/${endpoint}`, { method: "POST" });
    mail.isRead = !mail.isRead;
    readDialog.close();
    await loadMails();
  } catch (error) { showNotice(error.message); }
});
$("#delete-read").addEventListener("click", async () => {
  const mail = state.activeMail;
  if (!mail || !confirm("Delete this mail from your " + state.folder + "?")) return;
  try {
    await api(`/api/mail/${mail.id}`, { method: "DELETE" });
    readDialog.close();
    await loadMails();
    showNotice("Mail deleted from your folder.");
  } catch (error) { showNotice(error.message); }
});
$("#logout-button").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  showAuth();
});
setAuthMode("login");
api("/api/me").then(data => {
  if (data.user) showMailApp(data.user);
}).catch(() => {});
