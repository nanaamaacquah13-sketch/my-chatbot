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

function addMessage(role, text, sources) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatText(text);
  wrap.appendChild(bubble);

  if (sources && sources.length) {
    const src = document.createElement("div");
    src.className = "sources";
    src.textContent = "Sources: " + sources.join(" \u00b7 ");
    wrap.appendChild(src);
  }

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

/* ---------- Notes (knowledge.md) ---------- */
let chunks = [];
let docFreq = Object.create(null);

const STOP = new Set(("and are but for from has have how into its that the their then there these they this was what when where which who why will with you your can does should would could about give tell").split(" "));

function words(s) {
  return (s.toLowerCase().match(/[a-z0-9]{3,}/g) || [])
    .filter((w) => !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function splitNotes(md) {
  const sections = [];
  let title = "Notes";
  let buf = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ title: title, body: body });
    buf = [];
  };
  md.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^#{1,4}\s+(.*)/);
    if (m) {
      flush();
      title = m[1].trim();
    } else {
      buf.push(line);
    }
  });
  flush();

  // cut long sections into pieces of about 1200 characters
  const out = [];
  sections.forEach((sec) => {
    if (sec.body.length <= 1200) {
      out.push(sec);
      return;
    }
    let piece = "";
    sec.body.split(/\n\s*\n/).forEach((par) => {
      if (piece && (piece + par).length > 1200) {
        out.push({ title: sec.title, body: piece.trim() });
        piece = "";
      }
      piece += par + "\n\n";
    });
    if (piece.trim()) out.push({ title: sec.title, body: piece.trim() });
  });
  return out;
}

function indexNotes(list) {
  docFreq = Object.create(null);
  list.forEach((c) => {
    c.counts = Object.create(null);
    words(c.title + " " + c.title + " " + c.body).forEach((w) => {
      c.counts[w] = (c.counts[w] || 0) + 1;
    });
    Object.keys(c.counts).forEach((w) => {
      docFreq[w] = (docFreq[w] || 0) + 1;
    });
  });
  return list;
}

function buildQuery(userText, botText) {
  const q = Object.create(null);
  words(botText || "").forEach((w) => { q[w] = 1; });
  words(userText || "").forEach((w) => { q[w] = 3; });
  return q;
}

function findNotes(query, k) {
  k = k || 4;
  const total = chunks.length;
  if (!total) return [];
  const scored = chunks.map((c) => {
    let score = 0;
    Object.keys(query).forEach((w) => {
      const tf = c.counts[w];
      if (tf) score += query[w] * (1 + Math.log(tf)) * Math.log(1 + total / docFreq[w]);
    });
    return { c: c, score: score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  if (best <= 0) return [];
  return scored.filter((s) => s.score >= best * 0.35).slice(0, k).map((s) => s.c);
}

async function loadNotes() {
  try {
    const res = await fetch("knowledge.md?t=" + Date.now());
    if (!res.ok) return;
    chunks = indexNotes(splitNotes(await res.text()));
  } catch (e) {
    chunks = [];
  }
}

/* ---------- Gemini call ---------- */
async function askGemini(notes) {
  let system = CONFIG.SYSTEM_PROMPT;
  if (notes.length) {
    system += "\n\n" + CONFIG.NOTES_RULES + "\n\nNOTES:\n" +
      notes.map((n, i) => "[" + (i + 1) + "] " + n.title + "\n" + n.body).join("\n\n");
  }
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + CONFIG.MODEL + ":generateContent";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getKey()
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
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
    const lastBot = history.slice().reverse().find((m) => m.role === "model");
    const notes = findNotes(buildQuery(text, lastBot ? lastBot.parts[0].text : ""));
    let reply = await askGemini(notes);
    const correct = reply.includes("[CORRECT]");
    reply = reply.replace(/\[CORRECT\]/g, "").trim();

    let sources = [];
    const used = reply.match(/\[USED:\s*([\d,\s]+)\]/i);
    if (used) {
      const nums = used[1].split(",").map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= notes.length);
      sources = Array.from(new Set(nums.map((n) => notes[n - 1].title)));
    }
    reply = reply.replace(/\[USED:[^\]]*\]/gi, "").trim();

    typing.remove();
    addMessage("bot", reply || "Hmm, I didn't get a reply. Try again?", sources);
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

loadNotes().then(() => {
  if (!chunks.length) {
    addMessage("bot", "Heads up: I couldn't load knowledge.md, so I'll answer without your notes. Make sure the file is in the same folder as index.html.");
  }
});
