// ---------- Setup ----------
const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const startersBox = document.getElementById("starters");
const keyDialog = document.getElementById("keyDialog");
const keyInput = document.getElementById("keyInput");
const rememberBox = document.getElementById("rememberBox");

let history = [];      // conversation sent to Gemini
let busy = false;      // true while waiting for a reply

document.documentElement.style.setProperty("--brand", BOT_CONFIG.themeColor);
document.title = BOT_CONFIG.name;
document.getElementById("botEmoji").textContent = BOT_CONFIG.emoji;
document.getElementById("botName").textContent = BOT_CONFIG.name;
document.getElementById("botTagline").textContent = BOT_CONFIG.tagline;

// ---------- API key storage ----------
function getKey() {
  try {
    return sessionStorage.getItem("gemini_key") || localStorage.getItem("gemini_key") || "";
  } catch (e) {
    return "";
  }
}

function saveKey(key, remember) {
  try {
    sessionStorage.setItem("gemini_key", key);
  } catch (e) {}
  try {
    if (remember) localStorage.setItem("gemini_key", key);
    else localStorage.removeItem("gemini_key");
  } catch (e) {}
}

function openKeyDialog() {
  keyInput.value = "";
  try { rememberBox.checked = !!localStorage.getItem("gemini_key"); } catch (e) {}
  keyDialog.showModal();
}

document.getElementById("keyBtn").onclick = openKeyDialog;
document.getElementById("keyCancel").onclick = () => keyDialog.close();
document.getElementById("keySave").onclick = () => {
  const key = keyInput.value.trim();
  if (key) saveKey(key, rememberBox.checked);
  keyDialog.close();
};

// ---------- Safe formatting ----------
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatText(raw) {
  const lines = escapeHtml(raw).split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + bullet[1] + "</li>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim() !== "") html += "<p style='margin:4px 0'>" + line + "</p>";
    }
  }
  if (inList) html += "</ul>";
  return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// ---------- Chat display ----------
function addBubble(text, type) {
  const div = document.createElement("div");
  div.className = "bubble " + type;
  if (type === "bot") div.innerHTML = formatText(text);
  else div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function showThinking() {
  const div = document.createElement("div");
  div.className = "bubble bot dots";
  div.innerHTML = "<span></span><span></span><span></span>";
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// ---------- Friendly errors ----------
function errorMessage(status) {
  if (status === 400 || status === 403) return "Your API key doesn't seem to work. Click \"API key\" and paste a valid one.";
  if (status === 404) return "The model name wasn't found. Check the \"model\" line in config.js.";
  if (status === 429) return "Too many requests right now. Please wait a minute and try again.";
  if (status >= 500) return "Google's server is having trouble. Please try again soon.";
  return "Something went wrong (error " + status + "). Please try again.";
}

// ---------- Sending messages ----------
async function sendMessage(text) {
  text = text.trim();
  if (!text || busy) return;

  const key = getKey();
  if (!key) {
    addBubble("Please add your Gemini API key first (top right button).", "error");
    openKeyDialog();
    return;
  }

  startersBox.style.display = "none";
  addBubble(text, "user");
  history.push({ role: "user", parts: [{ text: text }] });
  input.value = "";
  input.style.height = "auto";

  busy = true;
  sendBtn.disabled = true;
  const thinking = showThinking();

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(BOT_CONFIG.model) + ":generateContent";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BOT_CONFIG.systemInstructions }] },
        contents: history
      })
    });

    thinking.remove();

    if (!response.ok) {
      history.pop();
      addBubble(errorMessage(response.status), "error");
      return;
    }

    const data = await response.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts) || [];
    const reply = parts.filter(p => !p.thought && p.text).map(p => p.text).join("");

    if (!reply) {
      history.pop();
      addBubble("I couldn't make a reply to that. Try rephrasing your question.", "error");
      return;
    }

    history.push({ role: "model", parts: [{ text: reply }] });
    addBubble(reply, "bot");
  } catch (err) {
    thinking.remove();
    history.pop();
    addBubble("I can't reach the internet. Check your connection and try again.", "error");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ---------- Buttons and keyboard ----------
sendBtn.onclick = () => sendMessage(input.value);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(input.value);
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

function startChat() {
  history = [];
  chat.innerHTML = "";
  addBubble(BOT_CONFIG.welcomeMessage, "bot");
  startersBox.innerHTML = "";
  startersBox.style.display = "flex";
  BOT_CONFIG.starterQuestions.forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = q;
    b.onclick = () => sendMessage(q);
    startersBox.appendChild(b);
  });
}

document.getElementById("newBtn").onclick = startChat;
startChat();
