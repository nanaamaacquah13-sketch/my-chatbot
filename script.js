const C = window.CONFIG;
const chat = document.getElementById("chat");
const startersBox = document.getElementById("starters");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const toggle = document.getElementById("themeToggle");

let history = [];
let chunks = [];
let chunkVectors = null;
let busy = false;

// ---------- Light / dark mode ----------
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  toggle.textContent = t === "dark" ? "☀️" : "🌙";
  try { localStorage.setItem("theme", t); } catch (e) {}
}
let savedTheme = null;
try { savedTheme = localStorage.getItem("theme"); } catch (e) {}
setTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
toggle.onclick = () =>
  setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");

// ---------- Confetti ----------
const cv = document.getElementById("confetti");
const cx = cv.getContext("2d");
function confetti() {
  cv.width = innerWidth;
  cv.height = innerHeight;
  const colors = ["#BA0C2F", "#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#ffffff"];
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2,
    y: innerHeight * 0.6,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 16 - 4,
    s: Math.random() * 8 + 4,
    c: colors[Math.floor(Math.random() * colors.length)],
    r: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 0.4
  }));
  let frame = 0;
  (function step() {
    cx.clearRect(0, 0, cv.width, cv.height);
    bits.forEach(p => {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.save();
      cx.translate(p.x, p.y);
      cx.rotate(p.r);
      cx.fillStyle = p.c;
      cx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      cx.restore();
    });
    if (++frame < 150) requestAnimationFrame(step);
    else cx.clearRect(0, 0, cv.width, cv.height);
  })();
}

// ---------- Messages ----------
function fmt(t) {
  return t
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-*] (.+)$/gm, "• $1")
    .replace(/\n/g, "<br>");
}
function addMsg(role, text, notes) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "bot") div.innerHTML = fmt(text);
  else div.textContent = text;
  if (notes && notes.length) {
    const s = document.createElement("div");
    s.className = "sources";
    s.textContent = "Notes searched: " + notes.map((n, i) => "[" + (i + 1) + "] " + n.text.slice(0, 50) + "…").join("  ");
    div.appendChild(s);
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// ---------- Gemini API ----------
async function api(path, body) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": C.API_KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("API error " + r.status);
  return r.json();
}

// ---------- Your notes (RAG) ----------
async function loadKnowledge() {
  if (!C.useKnowledge) return;
  try {
    const r = await fetch(C.knowledgeFile);
    if (!r.ok) throw new Error("no notes");
    const t = await r.text();
    chunks = t.split(/\n(?=#)|\n{2,}/).map(s => s.trim()).filter(s => s.length > 40);
  } catch (e) { chunks = []; }
}
async function embedAll(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const d = await api("models/" + C.embeddingModel + ":batchEmbedContents", {
      requests: batch.map(t => ({ model: "models/" + C.embeddingModel, content: { parts: [{ text: t }] } }))
    });
    d.embeddings.forEach(e => out.push(e.values));
  }
  return out;
}
function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / Math.sqrt(x * y);
}
function keywordScore(q, c) {
  const words = q.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const t = c.toLowerCase();
  return words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
}
async function findNotes(q) {
  if (!chunks.length) return [];
  let scores = null;
  if (C.searchMethod === "meaning") {
    try {
      if (!chunkVectors) chunkVectors = await embedAll(chunks);
      const qv = (await embedAll([q]))[0];
      scores = chunkVectors.map(v => cosine(qv, v));
    } catch (e) { scores = null; }
  }
  if (!scores) scores = chunks.map(c => keywordScore(q, c));
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .slice(0, C.topK)
    .filter(x => x.s > 0)
    .map(x => ({ text: chunks[x.i] }));
}

// ---------- Sending a message ----------
async function send(text) {
  text = text.trim();
  if (busy || !text) return;
  if (!C.API_KEY || C.API_KEY.startsWith("PASTE")) {
    addMsg("bot", "The API key is missing. Please add it in config.js.");
    return;
  }
  busy = true;
  sendBtn.disabled = true;
  startersBox.style.display = "none";
  addMsg("user", text);
  const typing = addMsg("bot", "Thinking…");
  try {
    let notes = [];
    let sys = C.SYSTEM_PROMPT;
    let userText = text;
    if (C.useKnowledge) {
      notes = await findNotes(text);
      sys += "\n\n" + C.knowledgeRules;
      if (notes.length) {
        userText = "NOTES:\n" + notes.map((n, i) => "[" + (i + 1) + "] " + n.text).join("\n\n") + "\n\nSTUDENT MESSAGE: " + text;
      }
    }
    const contents = history.slice(-18).concat([{ role: "user", parts: [{ text: userText }] }]);
    const d = await api("models/" + C.MODEL + ":generateContent", {
      systemInstruction: { parts: [{ text: sys }] },
      contents: contents
    });
    let reply = ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [])
      .map(p => p.text || "").join("").trim();
    if (!reply) throw new Error("empty reply");
    const correct = /^\s*\[CORRECT\]/i.test(reply);
    reply = reply.replace(/^\s*\[CORRECT\]\s*/i, "");
    history.push({ role: "user", parts: [{ text: text }] });
    history.push({ role: "model", parts: [{ text: reply }] });
    typing.remove();
    addMsg("bot", reply, notes);
    if (correct) confetti();
  } catch (e) {
    typing.remove();
    addMsg("bot", "Sorry, something went wrong (" + e.message + "). Please try again.");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ---------- Start ----------
form.addEventListener("submit", e => {
  e.preventDefault();
  const t = input.value;
  input.value = "";
  send(t);
});
addMsg("bot", C.WELCOME);
C.STARTERS.forEach(s => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = s;
  b.onclick = () => send(s);
  startersBox.appendChild(b);
});
loadKnowledge();
