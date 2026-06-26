// =====================================================
//  IZU CHAT — script.js (v4)
//  Firebase v10 Modular SDK
//
//  NEW in v4:
//   ✏️  Edit own messages (live update for everyone)
//   ↩️  Reply / quote any message
//   👥  Message grouping (consecutive same-user)
//   💻  Code formatting (`inline` and ```blocks```)
//
//  ⚠️  Replace firebaseConfig below with your own.
//  ⚠️  Firestore rules must allow update on /messages
//      and read/write on /reactions (see README.md).
// =====================================================

// ── 🔥 YOUR FIREBASE CONFIG ────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
// ──────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp,
  doc, setDoc, deleteDoc, updateDoc        // updateDoc is NEW (for editing)
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Guard: catch un-configured app immediately
if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  document.body.innerHTML = `
    <div style="height:100vh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;font-family:sans-serif;background:#0B0C10;color:#E4E4F0;
      text-align:center;padding:24px;gap:16px;">
      <span style="font-size:3rem">⚡</span>
      <h2 style="color:#7C5DFA">Firebase Not Configured</h2>
      <p style="color:#55566E;max-width:360px;line-height:1.6">
        Open <code style="color:#9D7BFF">script.js</code> and replace
        <code style="color:#9D7BFF">firebaseConfig</code> with your credentials.
        See <strong>README.md</strong> for setup steps.
      </p>
    </div>`;
  throw new Error("Configure firebaseConfig in script.js first.");
}

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ══════════════════════════════════════════════════════
//  SESSION STATE
// ══════════════════════════════════════════════════════

let username       = "";
const uid          = "u_" + Math.random().toString(36).slice(2, 10);
let lastSentAt     = 0;
let notifEnabled   = false;
let soundEnabled   = false;
let unreadCount    = 0;
let isTabVisible   = true;
let typingTimerId  = null;
let toastTimerId   = null;
let rateTimerId    = null;
let isFirstLoad    = true;
let emojiOpen      = false;

// Edit & Reply state
let editingMsgId   = null;     // null = new message mode, string = editing existing
let replyingTo     = null;     // null or { msgId, username, preview }

// Message grouping state
let lastMsgUid     = "";       // uid of the most recently rendered message
let lastMsgTime    = 0;        // timestamp (ms) of the most recently rendered message

// Date separator state
let lastDateStr    = "";

// Typing + Reactions state
const typingUsers  = {};
const reactionsMap = {};       // msgId → { emoji → Set<uid> }

// ══════════════════════════════════════════════════════
//  DOM REFERENCES
// ══════════════════════════════════════════════════════

const joinScreen    = document.getElementById("join-screen");
const chatScreen    = document.getElementById("chat-screen");
const nameInput     = document.getElementById("name-input");
const joinBtn       = document.getElementById("join-btn");
const messagesEl    = document.getElementById("messages");
const msgInput      = document.getElementById("msg-input");
const sendBtn       = document.getElementById("send-btn");
const notifBtn      = document.getElementById("notif-btn");
const soundBtn      = document.getElementById("sound-btn");
const typingBar     = document.getElementById("typing-bar");
const typingLabel   = document.getElementById("typing-label");
const toastEl       = document.getElementById("in-app-toast");
const rateBar       = document.getElementById("rate-bar");
const youLabel      = document.getElementById("you-label");
const fileInput     = document.getElementById("file-input");
const attachBtn     = document.getElementById("attach-btn");
const emojiBtn      = document.getElementById("emoji-btn");
const emojiPanel    = document.getElementById("emoji-panel");
const scrollBtn     = document.getElementById("scroll-btn");
const onlineCountEl = document.getElementById("online-count");
const charCounter   = document.getElementById("char-counter");
const lightbox      = document.getElementById("lightbox");
const lbImg         = document.getElementById("lb-img");

// Context bars (reply / edit)
const replyBar      = document.getElementById("reply-bar");
const replyLabel    = document.getElementById("reply-label");
const replyPreview  = document.getElementById("reply-preview");
const replyCancel   = document.getElementById("reply-cancel");
const editBar       = document.getElementById("edit-bar");
const editPreview   = document.getElementById("edit-preview");
const editCancel    = document.getElementById("edit-cancel");

// ══════════════════════════════════════════════════════
//  USERNAME COLORS
// ══════════════════════════════════════════════════════

const USER_COLORS = [
  "#7C5DFA","#FF6B9D","#30D9A0","#FBBF24",
  "#60A5FA","#F97316","#A3E635","#E879F9"
];

function getUserColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

// ══════════════════════════════════════════════════════
//  CODE FORMATTING  (NEW in v4)
//  Parses ``` blocks, `inline`, and URLs — in that order
// ══════════════════════════════════════════════════════

function parseText(container, text) {
  // 1. Split on ```code blocks```
  const codeBlockParts = text.split(/(```[\s\S]*?```)/g);
  codeBlockParts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      // Captured group → code block (strip the ``` delimiters)
      container.appendChild(buildCodeBlock(part.slice(3, -3)));
    } else {
      // 2. Split on `inline code`
      const inlineParts = part.split(/(`[^`\n]+`)/g);
      inlineParts.forEach((inPart, j) => {
        if (!inPart) return;
        if (j % 2 === 1) {
          // Captured group → inline code (strip backticks)
          const code = createElement("code", "inline-code");
          code.textContent = inPart.slice(1, -1);
          container.appendChild(code);
        } else {
          // 3. Plain text → linkify URLs
          linkify(container, inPart);
        }
      });
    }
  });
}

function buildCodeBlock(code) {
  const pre    = createElement("pre", "code-block");
  const codeEl = createElement("code");
  codeEl.textContent = code.trim();
  pre.appendChild(codeEl);

  // Copy button
  const copyBtn = createElement("button", "code-copy");
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", e => {
    e.stopPropagation();
    navigator.clipboard.writeText(code.trim())
      .then(() => {
        copyBtn.textContent = "✓";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("copied");
        }, 2000);
      })
      .catch(() => { copyBtn.textContent = "!"; });
  });
  pre.appendChild(copyBtn);
  return pre;
}

// ══════════════════════════════════════════════════════
//  URL AUTO-LINKING  (XSS-safe — DOM only, no innerHTML)
// ══════════════════════════════════════════════════════

function linkify(container, text) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      const a = createElement("a", "msg-link");
      a.href = part; a.textContent = part;
      a.target = "_blank"; a.rel = "noopener noreferrer";
      container.appendChild(a);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

// ══════════════════════════════════════════════════════
//  QUOTE BLOCK BUILDER  (NEW in v4)
// ══════════════════════════════════════════════════════

function buildQuoteBlock(replyTo) {
  const block = createElement("div", "quote-block");
  block.style.borderLeftColor = getUserColor(replyTo.username);

  const name = createElement("span", "quote-name");
  name.textContent = replyTo.username;
  name.style.color = getUserColor(replyTo.username);

  const text = createElement("span", "quote-text");
  text.textContent = replyTo.preview;

  block.appendChild(name);
  block.appendChild(text);

  // Click the quote → scroll to & highlight the original message
  block.addEventListener("click", e => {
    e.stopPropagation();
    const target = document.querySelector(
      `.msg-row[data-msg-id="${CSS.escape(replyTo.msgId)}"]`
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("highlight");
      setTimeout(() => target.classList.remove("highlight"), 1400);
    }
  });

  return block;
}

// ══════════════════════════════════════════════════════
//  EDIT MODE  (NEW in v4)
// ══════════════════════════════════════════════════════

function startEdit(msgId, currentText) {
  cancelReply();                           // can't edit and reply simultaneously
  editingMsgId = msgId;
  msgInput.value = currentText;
  editPreview.textContent = currentText.slice(0, 80) + (currentText.length > 80 ? "…" : "");
  editBar.classList.remove("hidden");
  msgInput.classList.add("editing-mode");
  sendBtn.classList.add("editing");
  msgInput.focus();
  msgInput.setSelectionRange(currentText.length, currentText.length);
}

function cancelEdit() {
  if (!editingMsgId) return;
  editingMsgId = null;
  msgInput.value = "";
  editBar.classList.add("hidden");
  msgInput.classList.remove("editing-mode");
  sendBtn.classList.remove("editing");
  charCounter.textContent = "";
  charCounter.className = "char-counter";
}

editCancel.addEventListener("click", cancelEdit);

// ══════════════════════════════════════════════════════
//  REPLY MODE  (NEW in v4)
// ══════════════════════════════════════════════════════

function startReply(msgId, username, preview) {
  cancelEdit();                            // can't reply and edit simultaneously
  replyingTo = { msgId, username, preview };
  replyLabel.textContent = "Replying to " + username;
  replyPreview.textContent = preview.slice(0, 90) + (preview.length > 90 ? "…" : "");
  replyBar.classList.remove("hidden");
  msgInput.focus();
}

function cancelReply() {
  if (!replyingTo) return;
  replyingTo = null;
  replyBar.classList.add("hidden");
}

replyCancel.addEventListener("click", cancelReply);

// ══════════════════════════════════════════════════════
//  EMOJI PICKER  (input emojis)
// ══════════════════════════════════════════════════════

const INPUT_EMOJIS = [
  "😀","😂","🥰","😍","😎","😅","😭","🤔",
  "😤","🥳","🤯","🫡","😈","👻","🤖","😴",
  "👍","👎","❤️","🔥","💯","🙏","💪","👏",
  "✅","⚡","🎉","💀","👀","💎","🚀","⭐",
  "🎮","🎵","🏆","🌊","🍕","💰","🎯","🌙"
];

function buildEmojiPicker() {
  INPUT_EMOJIS.forEach(emoji => {
    const btn = createElement("button", "emoji-item");
    btn.textContent = emoji; btn.title = emoji;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const s = msgInput.selectionStart, en = msgInput.selectionEnd;
      msgInput.value = msgInput.value.slice(0, s) + emoji + msgInput.value.slice(en);
      msgInput.selectionStart = msgInput.selectionEnd = s + emoji.length;
      msgInput.focus();
    });
    emojiPanel.appendChild(btn);
  });
}

emojiBtn.addEventListener("click", e => {
  e.stopPropagation();
  emojiOpen = !emojiOpen;
  emojiPanel.classList.toggle("hidden", !emojiOpen);
  emojiBtn.classList.toggle("active", emojiOpen);
});

// ══════════════════════════════════════════════════════
//  SOUND  (Web Audio API)
// ══════════════════════════════════════════════════════

soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
  soundBtn.classList.toggle("enabled", soundEnabled);
  soundBtn.title = soundEnabled ? "Sound on — click to mute" : "Enable message sound";
  if (soundEnabled) playPing();
});

function playPing() {
  if (!soundEnabled) return;
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

// ══════════════════════════════════════════════════════
//  IMAGE LIGHTBOX
// ══════════════════════════════════════════════════════

function openLightbox(src) {
  lbImg.src = src;
  lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  lightbox.classList.add("hidden");
  lbImg.src = "";
  document.body.style.overflow = "";
}

document.getElementById("lb-close-bg").addEventListener("click", closeLightbox);
document.getElementById("lb-close-btn").addEventListener("click", closeLightbox);
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeLightbox(); cancelEdit(); cancelReply(); } });

// Delegate image clicks → lightbox
messagesEl.addEventListener("click", e => {
  if (e.target.classList.contains("img-bubble")) openLightbox(e.target.src);
});

// ══════════════════════════════════════════════════════
//  PRESENCE  (online user count)
// ══════════════════════════════════════════════════════

async function registerPresence() {
  await setDoc(doc(db, "presence", uid), { username, ts: Date.now() }).catch(() => {});
}
function startPresence() {
  registerPresence();
  setInterval(registerPresence, 30000);
}
function listenPresence() {
  onSnapshot(collection(db, "presence"), snap => {
    const now    = Date.now();
    const active = snap.docs.filter(d => now - (d.data().ts || 0) < 60000).length;
    onlineCountEl.textContent = active === 1 ? "1 online" : `${active} online`;
  });
}

// ══════════════════════════════════════════════════════
//  SCROLL-TO-BOTTOM BUTTON
// ══════════════════════════════════════════════════════

messagesEl.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = messagesEl;
  scrollBtn.classList.toggle("hidden", scrollHeight - scrollTop - clientHeight < 120);
});
scrollBtn.addEventListener("click", () => {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
});

// ══════════════════════════════════════════════════════
//  MESSAGE REACTIONS
// ══════════════════════════════════════════════════════

const REACT_EMOJIS = ["👍","❤️","😂","😮","😢","🔥"];

function listenReactions() {
  onSnapshot(collection(db, "reactions"), snap => {
    snap.docChanges().forEach(ch => {
      const data = ch.doc.data();
      if (!data.msgId) return;
      const { msgId, uid: rUid, emoji } = data;

      if (!reactionsMap[msgId]) reactionsMap[msgId] = {};

      if (ch.type === "removed") {
        Object.values(reactionsMap[msgId]).forEach(s => s.delete(rUid));
      } else {
        // Scrub old entry (emoji may have changed), then add new
        Object.values(reactionsMap[msgId]).forEach(s => s.delete(rUid));
        if (!reactionsMap[msgId][emoji]) reactionsMap[msgId][emoji] = new Set();
        reactionsMap[msgId][emoji].add(rUid);
      }
      // Clean empty sets
      for (const e of Object.keys(reactionsMap[msgId])) {
        if (reactionsMap[msgId][e].size === 0) delete reactionsMap[msgId][e];
      }
      refreshReactionRow(msgId);
    });
  });
}

function refreshReactionRow(msgId) {
  const row = document.querySelector(`.msg-row[data-msg-id="${CSS.escape(msgId)}"]`);
  if (!row) return;
  const rr = row.querySelector(".reaction-row");
  if (!rr) return;
  rr.innerHTML = "";

  Object.entries(reactionsMap[msgId] || {}).forEach(([emoji, uids]) => {
    if (!uids.size) return;
    const chip = createElement("button", `reaction-chip${uids.has(uid) ? " mine" : ""}`);
    chip.title = uids.has(uid) ? "Remove reaction" : "React with " + emoji;
    const es = createElement("span"); es.textContent = emoji;
    const cs = createElement("span"); cs.textContent = uids.size;
    chip.appendChild(es); chip.appendChild(cs);
    chip.addEventListener("click", () => toggleReaction(msgId, emoji));
    rr.appendChild(chip);
  });
}

async function toggleReaction(msgId, emoji) {
  const ref = doc(db, "reactions", `${msgId}___${uid}`);
  const existing = Object.entries(reactionsMap[msgId] || {})
    .find(([, uids]) => uids.has(uid))?.[0];
  if (existing === emoji) await deleteDoc(ref).catch(console.error);
  else await setDoc(ref, { msgId, uid, emoji }).catch(console.error);

  const row = document.querySelector(`.msg-row[data-msg-id="${CSS.escape(msgId)}"]`);
  if (row) row.classList.remove("picking");
}

// ══════════════════════════════════════════════════════
//  DATE SEPARATOR HELPERS
// ══════════════════════════════════════════════════════

function getDateLabel(ts) {
  const d    = new Date(ts.toMillis());
  const now  = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString())  return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday:"long", month:"short", day:"numeric" });
}

function maybeInsertDateSep(ts) {
  if (!ts) return;
  const key = new Date(ts.toMillis()).toDateString();
  if (key === lastDateStr) return;
  lastDateStr = key;
  lastMsgUid  = "";    // reset grouping across day boundaries
  lastMsgTime = 0;
  const sep  = createElement("div", "date-sep");
  const span = createElement("span"); span.textContent = getDateLabel(ts);
  sep.appendChild(span);
  messagesEl.appendChild(sep);
}

// ══════════════════════════════════════════════════════
//  JOIN ROOM
// ══════════════════════════════════════════════════════

joinBtn.addEventListener("click", join);
nameInput.addEventListener("keydown", e => { if (e.key === "Enter") join(); });

function join() {
  const raw = nameInput.value.trim();
  if (!raw) {
    nameInput.classList.remove("shake");
    void nameInput.offsetWidth;
    nameInput.classList.add("shake");
    nameInput.placeholder = "Enter a name first!";
    return;
  }
  username = raw.slice(0, 20);
  youLabel.textContent = "👤 " + username;
  joinScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  msgInput.focus();

  buildEmojiPicker();
  startPresence();
  listenPresence();
  listenMessages();
  listenTyping();
  listenReactions();

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("beforeunload", () => {
    stopTyping();
    deleteDoc(doc(db, "presence", uid)).catch(() => {});
  });

  // Global click → close emoji panel and any open reaction pickers
  document.addEventListener("click", e => {
    if (emojiOpen && !emojiBtn.contains(e.target) && !emojiPanel.contains(e.target)) {
      emojiOpen = false;
      emojiPanel.classList.add("hidden");
      emojiBtn.classList.remove("active");
    }
    if (!e.target.closest(".msg-row")) {
      document.querySelectorAll(".msg-row.picking")
        .forEach(r => r.classList.remove("picking"));
    }
  });
}

// ══════════════════════════════════════════════════════
//  SEND / EDIT MESSAGE
// ══════════════════════════════════════════════════════

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === "Escape")               { cancelEdit(); cancelReply(); }
});

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;

  // ── EDIT MODE ──────────────────────────────────────
  if (editingMsgId) {
    await updateDoc(doc(db, "messages", editingMsgId), {
      text,
      edited:   true,
      editedAt: serverTimestamp()
    }).catch(err => {
      console.error("Edit failed:", err);
      alert("Could not save edit. Check your connection.");
    });
    cancelEdit();
    return;
  }

  // ── NEW MESSAGE ────────────────────────────────────
  if (Date.now() - lastSentAt < 1500) { showRateBar(); return; }
  lastSentAt = Date.now();
  msgInput.value = "";
  charCounter.textContent = "";
  charCounter.className = "char-counter";
  stopTyping();

  const msgData = { uid, username, type: "text", text, ts: serverTimestamp() };

  // Attach reply data if replying
  if (replyingTo) {
    msgData.replyTo = {
      msgId:    replyingTo.msgId,
      username: replyingTo.username,
      preview:  replyingTo.preview
    };
    cancelReply();
  }

  await addDoc(collection(db, "messages"), msgData).catch(err => {
    console.error("Send failed:", err);
    alert("Could not send message. Check your connection.");
  });
}

// ══════════════════════════════════════════════════════
//  SEND FILE / IMAGE
// ══════════════════════════════════════════════════════

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = "";

  if (file.size > 200 * 1024) {
    alert(`File too large.\nMax: 200 KB  |  Yours: ${formatBytes(file.size)}\n\nFor bigger files use Firebase Storage.`);
    return;
  }
  const base64  = await readAsBase64(file);
  const ext     = file.name.split(".").pop().toLowerCase();
  const isImage = ["jpg","jpeg","png","gif","webp","svg"].includes(ext);

  await addDoc(collection(db, "messages"), {
    uid, username,
    type: isImage ? "image" : "file",
    text: base64, fileName: file.name,
    fileSize: formatBytes(file.size),
    ts: serverTimestamp()
  }).catch(err => {
    console.error("File send failed:", err);
    alert("Could not send file — may be too large for Firestore.");
  });
});

function readAsBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ══════════════════════════════════════════════════════
//  LISTEN FOR MESSAGES  (real-time)
//  Handles: added (new), modified (edited), removed (deleted)
// ══════════════════════════════════════════════════════

function listenMessages() {
  const q = query(
    collection(db, "messages"),
    orderBy("ts", "asc"),
    limit(120)
  );

  onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {

      // ── New message ──────────────────────────────
      if (change.type === "added") {
        const data  = change.doc.data();
        const docId = change.doc.id;
        const isOwn = data.uid === uid;
        const isNew = !isFirstLoad;
        renderMessage(docId, data, isOwn, isNew);
        if (isNew && !isOwn) onIncomingMessage(data);

      // ── Edited message ───────────────────────────
      } else if (change.type === "modified") {
        const data  = change.doc.data();
        const docId = change.doc.id;
        if (data.type !== "text") return;   // only text messages are editable

        const row    = document.querySelector(`.msg-row[data-msg-id="${CSS.escape(docId)}"]`);
        if (!row) return;
        const bubble = row.querySelector(".msg-bubble");
        if (!bubble) return;

        // Re-render bubble content from updated data
        bubble.innerHTML = "";
        if (data.replyTo) bubble.appendChild(buildQuoteBlock(data.replyTo));
        parseText(bubble, data.text);
        if (data.edited) {
          const mark = createElement("span", "edit-mark");
          mark.textContent = " (edited)";
          bubble.appendChild(mark);
        }

      // ── Deleted message ──────────────────────────
      } else if (change.type === "removed") {
        const row = document.querySelector(
          `.msg-row[data-msg-id="${CSS.escape(change.doc.id)}"]`
        );
        if (row) {
          row.classList.add("deleting");
          row.style.opacity = "0";
          row.style.transform = "scale(.94)";
          setTimeout(() => row.remove(), 280);
        }
      }
    });

    isFirstLoad = false;
    scrollToBottom();
  });
}

// ══════════════════════════════════════════════════════
//  RENDER A MESSAGE  (v4 — with grouping, reply, edit, code)
// ══════════════════════════════════════════════════════

function renderMessage(docId, data, isOwn, isNew) {
  // Remove welcome intro once real messages appear
  const intro = document.getElementById("room-intro");
  if (intro) intro.remove();

  // ── Date separator (resets grouping if new day) ──
  if (data.ts) maybeInsertDateSep(data.ts);

  // ── Message grouping ─────────────────────────────
  // Group if same user sent the previous message within 2 minutes
  const msgTime  = data.ts ? data.ts.toMillis() : Date.now();
  const isGrouped = data.uid === lastMsgUid
    && (msgTime - lastMsgTime) < 120_000
    && !data.replyTo;      // replies always show full meta regardless
  lastMsgUid  = data.uid;
  lastMsgTime = msgTime;

  // ── Row ──────────────────────────────────────────
  const row = createElement("div", [
    "msg-row",
    isOwn ? "own" : "other",
    isNew && !isOwn ? "flash" : "",
    isGrouped       ? "grouped" : ""
  ].filter(Boolean).join(" "));
  row.dataset.msgId = docId;

  // ── Meta: username + timestamp ───────────────────
  const timeStr = data.ts
    ? new Date(data.ts.toMillis()).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })
    : new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

  const meta = createElement("div", "msg-meta");
  if (!isOwn) {
    const nameSpan = createElement("span", "u-name");
    nameSpan.textContent = data.username;
    nameSpan.style.color = getUserColor(data.username);
    meta.appendChild(nameSpan);
  }
  const timeSpan = createElement("span");
  timeSpan.textContent = timeStr;
  meta.appendChild(timeSpan);

  // ── Content wrapper: bubble + actions ────────────
  const content = createElement("div", "msg-content");

  // Build the message bubble / image / file
  let bubble;
  if (data.type === "image") {
    bubble       = createElement("img", "img-bubble");
    bubble.src   = data.text;
    bubble.alt   = data.fileName || "image";
    bubble.title = "Click to expand";
    // clicks handled by messagesEl delegation → openLightbox()

  } else if (data.type === "file") {
    bubble          = createElement("a", "file-bubble");
    bubble.href     = data.text;
    bubble.download = data.fileName;
    const icon = createElement("span", "f-icon");
    icon.textContent = getFileIcon(data.fileName);
    const info  = createElement("div");
    const fname = createElement("div", "f-name"); fname.textContent = data.fileName;
    const fsize = createElement("div", "f-size"); fsize.textContent = `${data.fileSize} — click to download`;
    info.appendChild(fname); info.appendChild(fsize);
    bubble.appendChild(icon); bubble.appendChild(info);

  } else {
    // Text message: quote block → parsed text → edit mark
    bubble = createElement("div", "msg-bubble");
    if (data.replyTo) bubble.appendChild(buildQuoteBlock(data.replyTo));
    parseText(bubble, data.text);
    if (data.edited) {
      const mark = createElement("span", "edit-mark");
      mark.textContent = " (edited)";
      bubble.appendChild(mark);
    }
  }

  // ── Hover action buttons ──────────────────────────
  const actions = createElement("div", "msg-actions");

  // Reply (all messages)
  const replyBtnEl = createElement("button", "action-btn");
  replyBtnEl.textContent = "↩️"; replyBtnEl.title = "Reply";
  replyBtnEl.addEventListener("click", e => {
    e.stopPropagation();
    const preview = data.type === "image" ? "🖼️ Image"
      : data.type === "file" ? `📎 ${data.fileName}`
      : data.text;
    startReply(docId, data.username, preview);
  });
  actions.appendChild(replyBtnEl);

  // React (all messages)
  const reactBtnEl = createElement("button", "action-btn");
  reactBtnEl.textContent = "😊"; reactBtnEl.title = "React";
  reactBtnEl.addEventListener("click", e => {
    e.stopPropagation();
    document.querySelectorAll(".msg-row.picking").forEach(r => {
      if (r !== row) r.classList.remove("picking");
    });
    row.classList.toggle("picking");
  });
  actions.appendChild(reactBtnEl);

  if (isOwn) {
    // Edit (text messages only)
    if (data.type === "text") {
      const editBtnEl = createElement("button", "action-btn edit-btn");
      editBtnEl.textContent = "✏️"; editBtnEl.title = "Edit message";
      editBtnEl.addEventListener("click", () => startEdit(docId, data.text));
      actions.appendChild(editBtnEl);
    }
    // Delete (all types)
    const delBtnEl = createElement("button", "action-btn del-btn");
    delBtnEl.textContent = "🗑️"; delBtnEl.title = "Delete message";
    delBtnEl.addEventListener("click", async () => {
      if (!confirm("Delete this message for everyone?")) return;
      await deleteDoc(doc(db, "messages", docId)).catch(console.error);
    });
    actions.appendChild(delBtnEl);
  }

  content.appendChild(bubble);
  content.appendChild(actions);

  // ── Reaction picker ───────────────────────────────
  const picker = createElement("div", "reaction-picker");
  REACT_EMOJIS.forEach(emoji => {
    const btn = createElement("button", "react-emoji-btn");
    btn.textContent = emoji; btn.title = emoji;
    btn.addEventListener("click", e => { e.stopPropagation(); toggleReaction(docId, emoji); });
    picker.appendChild(btn);
  });

  // ── Reaction chips row ────────────────────────────
  const reactionRow = createElement("div", "reaction-row");

  // ── Assemble ─────────────────────────────────────
  row.appendChild(meta);
  row.appendChild(content);
  row.appendChild(picker);
  row.appendChild(reactionRow);
  messagesEl.appendChild(row);
}

// ══════════════════════════════════════════════════════
//  INCOMING MESSAGE HANDLING
// ══════════════════════════════════════════════════════

function onIncomingMessage(data) {
  const preview =
    data.type === "image" ? "🖼️ Sent an image"
    : data.type === "file" ? `📎 ${data.fileName}`
    : data.text;

  showToast(data.username, getUserColor(data.username), preview);
  playPing();

  if (!isTabVisible) {
    unreadCount++;
    document.title = `(${unreadCount}) Izu Chat ⚡`;
  }
  if (notifEnabled && !isTabVisible) {
    new Notification(`${data.username} • Izu Chat`, {
      body: preview.slice(0, 100),
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>",
      tag:  "izuchat-msg"
    });
  }
}

function showToast(name, color, body) {
  clearTimeout(toastTimerId);
  toastEl.innerHTML = "";
  const ns = createElement("span", "t-name");
  ns.textContent = name; ns.style.color = color;
  toastEl.appendChild(ns);
  toastEl.appendChild(document.createTextNode(": " + (body.length > 70 ? body.slice(0,70)+"…" : body)));
  toastEl.classList.remove("hidden");
  toastTimerId = setTimeout(() => toastEl.classList.add("hidden"), 3500);
}

// ══════════════════════════════════════════════════════
//  BROWSER NOTIFICATIONS
// ══════════════════════════════════════════════════════

notifBtn.addEventListener("click", async () => {
  if (notifEnabled) {
    notifEnabled = false;
    notifBtn.classList.remove("enabled");
    notifBtn.title = "Enable notifications";
    return;
  }
  const p = await Notification.requestPermission();
  if (p === "granted") {
    notifEnabled = true;
    notifBtn.classList.add("enabled");
    notifBtn.title = "Notifications on";
    new Notification("Izu Chat ⚡", { body: "You'll be notified of new messages.", tag:"izuchat-setup" });
  } else {
    alert("Notifications blocked. Enable them in your browser settings.");
  }
});

// ══════════════════════════════════════════════════════
//  TYPING INDICATOR + CHARACTER COUNTER  (combined)
// ══════════════════════════════════════════════════════

msgInput.addEventListener("input", () => {
  // Typing status
  setTypingStatus(true);
  clearTimeout(typingTimerId);
  typingTimerId = setTimeout(stopTyping, 3000);

  // Character counter (shows when approaching the 300-char limit)
  const len = msgInput.value.length;
  if (len > 240) {
    const rem = 300 - len;
    charCounter.textContent = rem;
    charCounter.className = `char-counter ${rem < 20 ? "danger" : "warn"}`;
  } else {
    charCounter.textContent = "";
    charCounter.className = "char-counter";
  }
});

async function setTypingStatus(on) {
  const ref = doc(db, "typing", uid);
  if (on) await setDoc(ref, { username, ts: Date.now() }).catch(() => {});
  else    await deleteDoc(ref).catch(() => {});
}

function stopTyping() {
  clearTimeout(typingTimerId);
  setTypingStatus(false);
}

function listenTyping() {
  onSnapshot(collection(db, "typing"), snap => {
    const now = Date.now();
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (id === uid) return;
      if (ch.type === "removed") { delete typingUsers[id]; }
      else {
        const d = ch.doc.data();
        if (now - d.ts < 4000) typingUsers[id] = d.username;
        else delete typingUsers[id];
      }
    });
    renderTyping();
  });
}

function renderTyping() {
  const names = Object.values(typingUsers);
  if (!names.length) { typingBar.classList.add("hidden"); return; }
  typingBar.classList.remove("hidden");
  typingLabel.textContent =
    names.length === 1 ? `${names[0]} is typing`
    : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
    : `${names.length} people are typing`;
}

// ══════════════════════════════════════════════════════
//  TAB VISIBILITY
// ══════════════════════════════════════════════════════

function onVisibilityChange() {
  isTabVisible = !document.hidden;
  if (isTabVisible) { unreadCount = 0; document.title = "Izu Chat ⚡"; }
}

// ══════════════════════════════════════════════════════
//  RATE LIMIT BAR
// ══════════════════════════════════════════════════════

function showRateBar() {
  clearTimeout(rateTimerId);
  rateBar.classList.remove("hidden");
  rateTimerId = setTimeout(() => rateBar.classList.add("hidden"), 2500);
}

// ══════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════

function scrollToBottom() {
  const { scrollTop, scrollHeight, clientHeight } = messagesEl;
  if (scrollHeight - scrollTop - clientHeight < 120 || isFirstLoad)
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function createElement(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

function formatBytes(b) {
  return b < 1024 ? b+" B" : b < 1048576 ? (b/1024).toFixed(1)+" KB" : (b/1048576).toFixed(1)+" MB";
}

function getFileIcon(name) {
  const ext = (name||"").split(".").pop().toLowerCase();
  return {
    pdf:"📄",doc:"📝",docx:"📝",xls:"📊",xlsx:"📊",csv:"📊",
    ppt:"📊",pptx:"📊",zip:"🗜️",rar:"🗜️","7z":"🗜️",
    mp3:"🎵",wav:"🎵",ogg:"🎵",mp4:"🎬",mov:"🎬",avi:"🎬",mkv:"🎬",
    txt:"📃",json:"📦",js:"💻",ts:"💻",py:"🐍",
    html:"🌐",css:"🎨",c:"💻",cpp:"💻",java:"☕",sh:"💻"
  }[ext] || "📎";
}
