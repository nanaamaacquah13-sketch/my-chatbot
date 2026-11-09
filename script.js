const chat = document.getElementById("chat");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const startersEl = document.getElementById("starters");
const themeBtn = document.getElementById("themeBtn");
const infoBtn = document.getElementById("infoBtn");
const infoDialog = document.getElementById("infoDialog");
const closeInfo = document.getElementById("closeInfo");
const canvas = document.getElementById("confetti");
const ctx = canvas.getContext("2d");

let history = [];
let busy = false;

/* ---------- Light / dark toggle ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  try { localStorage.setItem("medlearn-theme", theme); } catch (e) {}
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("medlearn-theme"); } catch (e) {}
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
})();

themeBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ---------- Info pop-up ---------- */
infoBtn.addEventListener("click", () => infoDialog.showModal());
closeInfo.addEventListener("click", () => infoDialog.close());
infoDialog.addEventListener("click", (e) => {
  if (e.target === infoDialog) infoDialog.close();
});

/* ---------- API key (kept in this browser only, never in the code) ---------- */
const keyBtn = document.getElementById("keyBtn");
const keyDialog = document.getElementById("keyDialog");
const keyInput = document.getElementById("keyInput");
const saveKey = document.getElementById("saveKey");
const removeKey = document.getElementById("removeKey");

function getKey() {
  try { return localStorage.getItem("medlearn-key") || ""; } catch (e) { return ""; }
}

keyBtn.addEventListener("click", () => {
  keyInput.value = "";
  keyDialog.showModal();
});

saveKey.addEventListener("click", () => {
  // remove any spaces or line breaks that came along when pasting
  const value = keyInput.value.replace(/\s+/g, "");
  if (!value) return;
  try { localStorage.setItem("medlearn-key", value); } catch (e) {}
  keyInput.value = "";
  keyDialog.close();
  input.focus();
});

removeKey.addEventListener("click", () => {
  try { localStorage.removeItem("medlearn-key"); } catch (e) {}
  keyInput.value = "";
  keyDialog.close();
});

keyDialog.addEventListener("click", (e) => {
  if (e.target === keyDialog) keyDialog.close();
});

/* ---------- Messages ---------- */
function formatText(text) {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function copyText(text, button) {
  const done = () => {
    button.textContent = "Copied!";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  try { document.execCommand("copy"); done(); } catch (e) {}
  area.remove();
}

function addMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatText(text);
  wrap.appendChild(bubble);

  if (role === "bot") {
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => copyText(text, copyBtn));
    wrap.appendChild(copyBtn);
  }

  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return wrap;
}

function showTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg bot typing";
  wrap.innerHTML = '<div class="bubble">Thinking...</div>';
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return wrap;
}

/* ---------- Gemini call ---------- */
async function askGemini() {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + CONFIG.MODEL + ":generateContent";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getKey()
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CONFIG.SYSTEM_PROMPT }] },
      contents: history
    })
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || "Something went wrong.");
  }
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || "").join("");
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || busy) return;

  if (!getKey()) {
    keyInput.value = "";
    keyDialog.showModal();
    return;
  }

  startersEl.innerHTML = "";
  addMessage("user", text);
  history.push({ role: "user", parts: [{ text }] });
  input.value = "";
  busy = true;
  sendBtn.disabled = true;

  const typing = showTyping();
  try {
    let reply = await askGemini();
    const correct = reply.includes("[CORRECT]");
    reply = reply.replace(/\[CORRECT\]/g, "").trim();
    typing.remove();
    addMessage("bot", reply || "Hmm, I didn't get a reply. Try again?");
    history.push({ role: "model", parts: [{ text: reply }] });
    if (correct) launchConfetti();
  } catch (err) {
    typing.remove();
    history.pop();
    addMessage("bot", "Oops, I couldn't answer: " + err.message);
  }

  busy = false;
  sendBtn.disabled = false;
  input.focus();
}

sendBtn.addEventListener("click", () => sendMessage(input.value));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage(input.value);
});

/* ---------- Confetti ---------- */
let pieces = [];
let confettiRunning = false;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function launchConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#ff5c9a", "#ffffff", "#ffd1e3", "#ffc93c", "#8ee3ef", "#b983ff"];
  for (let i = 0; i < 160; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.4,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: 2 + Math.random() * 3.5,
      speedX: -1.5 + Math.random() * 3,
      angle: Math.random() * Math.PI * 2,
      spin: -0.2 + Math.random() * 0.4
    });
  }
  if (!confettiRunning) {
    confettiRunning = true;
    requestAnimationFrame(drawConfetti);
  }
}

function drawConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pieces.forEach((p) => {
    p.x += p.speedX;
    p.y += p.speedY;
    p.angle += p.spin;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  });
  pieces = pieces.filter((p) => p.y < canvas.height + 30);
  if (pieces.length) {
    requestAnimationFrame(drawConfetti);
  } else {
    confettiRunning = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* ---------- Start ---------- */
addMessage("bot", CONFIG.WELCOME);
CONFIG.STARTERS.forEach((q) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = q;
  b.addEventListener("click", () => sendMessage(q));
  startersEl.appendChild(b);
});
