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

// ================= Page elements =================
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
const kbStatus = document.getElementById("kbStatus");

// ================= Chat state =================
let history = [];        // your plain questions and the bot's replies
let pendingMessage = ""; // message waiting for an API key
let apiKey = localStorage.getItem("medlearn_key") || sessionStorage.getItem("medlearn_key") || "";

// ================= Notes (RAG) settings and state =================
const KB = {
  use: CONFIG.useKnowledge !== false,
  file: CONFIG.knowledgeFile || "knowledge.md",
  method: CONFIG.searchMethod === "keywords" ? "keywords" : "meaning",
  topK: Number(CONFIG.topK) || 3,
  model: CONFIG.embeddingModel || "gemini-embedding-2",
  rules: CONFIG.knowledgeRules || ""
};

const MAX_NOTE_CHARS = 1500;               // longer notes are split at blank lines
const EMBED_BATCH_SIZE = 50;               // notes per request
const CACHE_KEY = "medlearn_embeddings";   // where the saved vectors live

let notes = [];            // each: { noteId, title, label, text, titleWords, textWords }
let vectors = [];          // one list of numbers per note
let cacheId = "";          // fingerprint of knowledge.md (changes when you edit it)
let knowledgeReady = Promise.resolve();

// ================= Notes: status line =================
function setStatus(text, isWarning) {
  if (!KB.use) {
    kbStatus.hidden = true;
    return;
  }
  kbStatus.hidden = false;
  kbStatus.textContent = text;
  kbStatus.classList.toggle("warn", Boolean(isWarning));
}

function noteCountText() {
  const count = new Set(notes.map((n) => n.noteId)).size;
  return count + (count === 1 ? " note" : " notes");
}

function showReadyStatus(method, extra) {
  const label = method === "meaning" ? "meaning search" : "keyword search";
  setStatus("📚 " + noteCountText() + " loaded · " + label + (extra ? " " + extra : ""), Boolean(extra));
}

// ================= Notes: reading knowledge.md =================
function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(16) + "-" + text.length;
}

// Splits a long note at blank lines into parts of about MAX_NOTE_CHARS
function splitLongText(text) {
  if (text.length <= MAX_NOTE_CHARS) return [text];
  const paragraphs = text.split(/\n\s*\n/);
  const parts = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > MAX_NOTE_CHARS) {
      parts.push(current);
      current = paragraph;
    } else {
      current = current ? current + "\n\n" + paragraph : paragraph;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Words used by the keyword search
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "what", "when", "where",
  "which", "who", "how", "why", "does", "did", "can", "could", "would", "should",
  "will", "with", "from", "that", "this", "these", "those", "have", "has", "had",
  "was", "were", "been", "about", "into", "than", "then", "them", "they", "their",
  "there", "its", "our", "out", "any", "all", "give", "tell", "explain", "please",
  "between", "difference"
]);

function stem(word) {
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

// Turns the text of knowledge.md into a list of notes.
// Everything above the first "## " line is ignored.
function parseNotes(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const found = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^##(?!#)\s*(.+?)\s*$/);
    if (match) {
      if (current) found.push(current);
      current = { title: match[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) found.push(current);

  const result = [];
  found.forEach((note, noteId) => {
    const text = note.lines.join("\n").trim();
    if (!text) return; // a title with no text is skipped
    const parts = splitLongText(text);
    parts.forEach((part, index) => {
      const label = parts.length > 1 ? note.title + " (part " + (index + 1) + "/" + parts.length + ")" : note.title;
      result.push({
        noteId,
        title: note.title,
        label,
        text: part,
        titleWords: new Set(tokenize(note.title)),
        textWords: new Set(tokenize(part))
      });
    });
  });
  return result;
}

async function loadNotes() {
  setStatus("📚 Loading notes…");
  let raw = "";
  try {
    const response = await fetch(KB.file, { cache: "no-cache" });
    if (!response.ok) throw new Error("not found");
    raw = await response.text();
  } catch (error) {
    notes = [];
    setStatus("📚 Can't find " + KB.file + ". Put it in the same folder as index.html, or set useKnowledge to false in config.js.", true);
    return;
  }

  notes = parseNotes(raw);
  vectors = [];
  cacheId = fingerprint(raw) + "|" + KB.model + "|" + MAX_NOTE_CHARS;

  if (notes.length === 0) {
    setStatus("📚 " + KB.file + " has no notes yet. Start each note with a line like: ## My note title", true);
  }
}

// ================= Notes: embeddings (meaning search) =================
async function embedTexts(texts) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + KB.model + ":batchEmbedContents";
  const all = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: "models/" + KB.model,
          content: { parts: [{ text }] }
        }))
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || "Request failed (" + response.status + ")");
    }

    const data = await response.json();
    if (!data.embeddings || data.embeddings.length !== batch.length) {
      throw new Error("Google sent back an unexpected embedding reply.");
    }
    data.embeddings.forEach((item) => {
      // Rounded to 5 decimals so the saved copy takes less space
      all.push(item.values.map((v) => Math.round(v * 100000) / 100000));
    });
  }
  return all;
}

function loadCachedVectors() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (saved && saved.id === cacheId && Array.isArray(saved.vectors) && saved.vectors.length === notes.length) {
      return saved.vectors;
    }
  } catch (error) {
    console.warn("Could not read saved embeddings:", error);
  }
  return null;
}

function saveCachedVectors(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ id: cacheId, vectors: list }));
  } catch (error) {
    console.warn("Could not save embeddings (they will be made again next time):", error);
  }
}

async function prepareEmbeddings() {
  if (vectors.length === notes.length) {
    showReadyStatus("meaning");
    return;
  }
  if (!apiKey) {
    setStatus("📚 " + noteCountText() + " found · enter your API key to switch on meaning search", true);
    return;
  }

  const cached = loadCachedVectors();
  if (cached) {
    vectors = cached;
    showReadyStatus("meaning");
    return;
  }

  setStatus("📚 Preparing " + noteCountText() + " for meaning search…");
  try {
    const texts = notes.map((n) => "title: " + n.title + " | text: " + n.text);
    vectors = await embedTexts(texts);
    saveCachedVectors(vectors);
    showReadyStatus("meaning");
  } catch (error) {
    console.warn("Embeddings failed:", error);
    vectors = [];
    showReadyStatus("keywords", "(meaning search unavailable: " + error.message + ")");
  }
}

// Runs on page load, and again when you save an API key
async function initKnowledge() {
  if (!KB.use) {
    setStatus("", false);
    return;
  }
  try {
    if (notes.length === 0) await loadNotes();
    if (notes.length === 0) return;
    if (KB.method === "keywords") {
      showReadyStatus("keywords");
      return;
    }
    await prepareEmbeddings();
  } catch (error) {
    console.error(error);
    if (notes.length > 0) showReadyStatus("keywords", "(meaning search unavailable)");
  }
}

// ================= Notes: finding the best ones =================
function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function keywordSearch(question, topK) {
  const terms = [...new Set(tokenize(question))];
  if (terms.length === 0) return [];

  const scored = notes.map((note) => {
    let points = 0;
    for (const term of terms) {
      if (note.titleWords.has(term)) points += 2;
      else if (note.textWords.has(term)) points += 1;
    }
    return { note, score: points / (terms.length * 2) };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function findNotes(question) {
  if (!KB.use || notes.length === 0) return { found: [], method: "none" };

  if (KB.method === "meaning" && vectors.length === notes.length) {
    try {
      const [queryVector] = await embedTexts(["task: search result | query: " + question]);
      const found = notes
        .map((note, i) => ({ note, score: cosine(queryVector, vectors[i]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, KB.topK);
      showReadyStatus("meaning");
      return { found, method: "meaning" };
    } catch (error) {
      console.warn("Meaning search failed, using keywords instead:", error);
      showReadyStatus("keywords", "(meaning search unavailable right now)");
    }
  }

  return { found: keywordSearch(question, KB.topK), method: "keywords" };
}

function buildPromptWithNotes(question, found) {
  let text = "NOTES:\n";
  if (found.length === 0) text += "(No matching notes were found.)\n";
  found.forEach((item, i) => {
    text += "\n[" + (i + 1) + "] " + item.note.label + "\n" + item.note.text + "\n";
  });
  text += "\nQUESTION:\n" + question;
  return text;
}

// ================= Display helpers =================
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

function previewText(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 220 ? flat.slice(0, 220) + "…" : flat;
}

// Adds an openable "Sources" section under a bot reply
function addSources(bubble, found, method) {
  if (found.length === 0) return;

  const details = document.createElement("details");
  details.className = "sources";

  const summary = document.createElement("summary");
  summary.textContent = "Sources (" + found.length + ") · " + (method === "meaning" ? "meaning search" : "keyword search");
  details.appendChild(summary);

  found.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "source-item";

    const title = document.createElement("div");
    title.className = "source-title";
    title.textContent = "[" + (i + 1) + "] " + item.note.label + " · score " + item.score.toFixed(2);

    const preview = document.createElement("div");
    preview.className = "source-preview";
    preview.textContent = previewText(item.note.text);

    row.appendChild(title);
    row.appendChild(preview);
    details.appendChild(row);
  });

  bubble.appendChild(details);
  chat.scrollTop = chat.scrollHeight;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "bubble bot";
  div.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// ================= Start / reset =================
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

// ================= Talking to Gemini =================
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
    // Wait until your notes are ready, then pick the best ones for this question
    await knowledgeReady;
    const search = await findNotes(text);
    const useNotes = KB.use && notes.length > 0;

    // The history keeps your plain question. Only this one request carries the notes.
    const contents = history.slice();
    if (useNotes) {
      contents[contents.length - 1] = {
        role: "user",
        parts: [{ text: buildPromptWithNotes(text, search.found) }]
      };
    }
    const systemText = useNotes ? CONFIG.SYSTEM_PROMPT + "\n\n" + KB.rules : CONFIG.SYSTEM_PROMPT;

    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + CONFIG.MODEL + ":generateContent";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: contents
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
    const bubble = addBubble("bot", reply);
    if (useNotes) addSources(bubble, search.found, search.method);
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

// ================= Events =================
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

  // Now that there is a key, prepare the meaning search if it wasn't ready yet
  knowledgeReady = initKnowledge();

  if (pendingMessage) {
    const message = pendingMessage;
    pendingMessage = "";
    sendMessage(message);
  }
});

// ================= Go! =================
resetChat();
knowledgeReady = initKnowledge();
