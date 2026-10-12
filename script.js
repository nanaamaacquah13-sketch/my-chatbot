// ================= Light/Dark theme switch =================
const themeToggle = document.getElementById("theme-toggle");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("theme", theme);
}

const savedTheme = localStorage.getItem("theme");
const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(savedTheme || (systemPrefersDark ? "dark" : "light"));

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

// ================= Chatbot =================
const chat = document.getElementById("chat");
const startersBox = document.getElementById("starters");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const keyBtn = document.getElementById("keyBtn");
const keyDialog = document.getElementById("keyDialog");
const keyInput = document.getElementById("keyInput");
const rememberKey = document.getElementById("rememberKey");
const keySave = document.getElementById("keySave");
const keyCancel = document.getElementById("keyCancel");

let history = [];        // conversation sent to Gemini
let pendingMessage = ""; // message waiting for an API key
let apiKey = localStorage.getItem("medlearn_key") || sessionStorage.getItem("medlearn_key") || "";

// ---------- Display helpers ----------
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Turns "- item" lines into bullet lists and **text** into bold
function renderText(text) {
  const lines = escapeHtml(text).split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.*)$/);
    if (match) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + match[1] + "</li>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += '<p style="margin:6px 0">' + line + "</p>";
    }
  }
  if (inList) html += "</ul>";
  return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = "bubble " + role;
  if (role === "bot") div.innerHTML = renderText(text);
  else div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "bubble bot";
  div.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// ---------- Start / reset ----------
function showStarters() {
  startersBox.innerHTML = "";
  startersBox.style.display = "flex";
  CONFIG.STARTERS.forEach((text) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.addEventListener("click", () => sendMessage(text));
    startersBox.appendChild(btn);
  });
}

function resetChat() {
  history = [];
  chat.innerHTML = "";
  addBubble("bot", CONFIG.WELCOME);
  showStarters();
}

// ---------- Talking to Gemini ----------
async function sendMessage(text) {
  text = text.trim();
  if (!text) return;

  if (!apiKey) {
    pendingMessage = text;
    keyDialog.showModal();
    return;
  }

  startersBox.style.display = "none";
  addBubble("user", text);
  history.push({ role: "user", parts: [{ text }] });
  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;
  const typing = showTyping();

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + CONFIG.MODEL + ":generateContent";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CONFIG.SYSTEM_PROMPT }] },
        contents: history
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || "Request failed (" + response.status + ")");
    }

    const data = await response.json();
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const reply = parts ? parts.map((p) => p.text || "").join("") : "";
    if (!reply) throw new Error("The model sent an empty reply. Please try rephrasing your question.");

    typing.remove();
    addBubble("bot", reply);
    history.push({ role: "model", parts: [{ text: reply }] });
  } catch (error) {
    typing.remove();
    history.pop(); // remove the failed question so you can try again
    addBubble("error", "Sorry, something went wrong: " + error.message);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// ---------- Events ----------
composer.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(input.value);
});

// Enter sends, Shift+Enter makes a new line
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(input.value);
  }
});

// Text box grows as you type
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = input.scrollHeight + "px";
});

clearBtn.addEventListener("click", resetChat);

keyBtn.addEventListener("click", () => {
  keyInput.value = "";
  keyDialog.showModal();
});

keyCancel.addEventListener("click", () => {
  pendingMessage = "";
  keyDialog.close();
});

keySave.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) return;
  apiKey = key;
  localStorage.removeItem("medlearn_key");
  sessionStorage.removeItem("medlearn_key");
  if (rememberKey.checked) localStorage.setItem("medlearn_key", key);
  else sessionStorage.setItem("medlearn_key", key);
  keyDialog.close();
  if (pendingMessage) {
    const message = pendingMessage;
    pendingMessage = "";
    sendMessage(message);
  }
});

// ---------- Go! ----------
resetChat();
