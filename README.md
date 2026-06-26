# ⚡ Izu Chat — Setup Guide (v2)

Real-time public chat room. No login. Just enter a name and talk.

---

## What's New in v2
- 🟢 Live online user count
- 😊 Emoji picker (40 emojis, inserts at cursor)
- 🔊 Sound toggle (Web Audio API)
- 🎨 Username color coding (unique per name)
- 🔗 Clickable URLs auto-detected in messages
- ⬇️ Scroll-to-bottom floating button

---

## Firebase Setup (5 Steps)

### 1. Create Project
Go to https://console.firebase.google.com → Add project → name it (e.g. izu-chat) → Create.

### 2. Register Web App
On the project home, click the Web icon `</>` → nickname it → Register app → copy the `firebaseConfig` object shown.

### 3. Paste Config into script.js
Replace the `firebaseConfig` block at the top of script.js with your own values.

### 4. Enable Firestore
Build → Firestore Database → Create database → Start in test mode → Pick a location (asia-south1 for India) → Enable.

### 5. Set Security Rules
Firestore → Rules tab → replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /messages/{msg} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['uid','username','type','text','ts'])
        && request.resource.data.text is string
        && request.resource.data.text.size() <= 300000;
    }

    match /typing/{uid} {
      allow read, write: if true;
    }

    // NEW in v2: required for online user count
    match /presence/{uid} {
      allow read, write: if true;
    }

  }
}
```

Click Publish.

---

## Running the App

Open via a local server (NOT by double-clicking index.html — ES modules won't work on file://).

VS Code: Right-click index.html → Open with Live Server

Python:
```
python -m http.server 3000
```
Then open http://localhost:3000

---

## File Structure

```
izu-chat/
├── index.html   — Page structure
├── style.css    — All styling + new emoji/scroll styles
├── script.js    — Firebase + all v2 features
└── README.md    — This file
```

---

## Known Limitations

| Issue | Reason | Fix |
|---|---|---|
| Files max 200 KB | Firestore 1 MB doc limit | Use Firebase Storage |
| Last 120 messages shown | Firestore query limit | Adjust limit(120) in script.js |
| Presence doesn't instantly remove on tab close | beforeunload is unreliable | Entry auto-expires from count after 60s |
| No moderation | Public room, no auth | Add Firebase Auth + Admin SDK |

---

## What's New in v3
- 💬 Message reactions (👍❤️😂😮😢🔥)
- 🗑️ Delete your own messages
- 🖼️ Image lightbox (click any image to expand)
- 📅 Date separators (Today / Yesterday / date)
- 🔢 Character counter (shows when typing near limit)

## Updated Firestore Rules (v3)

Add `reactions` to your rules alongside the existing collections:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /messages/{msg} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['uid','username','type','text','ts'])
        && request.resource.data.text is string
        && request.resource.data.text.size() <= 300000;
      allow delete: if true;
    }

    match /typing/{uid}   { allow read, write: if true; }
    match /presence/{uid} { allow read, write: if true; }

    // NEW in v3
    match /reactions/{r}  { allow read, write: if true; }

  }
}
```

Note: `allow delete` was added to `/messages/{msg}` so users can delete their own messages.

---

## What's New in v4
- ✏️ Edit your own messages (shows "(edited)" for everyone)
- ↩️ Reply / quote any message — click the quote to jump back to original
- 👥 Message grouping — consecutive messages from same user are visually grouped
- 💻 Code formatting — wrap in \`backticks\` for inline, \`\`\`triple\`\`\` for blocks with a Copy button

## Updated Firestore Rules (v4)
Add `allow update` to `/messages` so edits work:

```
match /messages/{msg} {
  allow read:   if true;
  allow create: if request.resource.data.keys().hasAll(['uid','username','type','text','ts'])
    && request.resource.data.text is string
    && request.resource.data.text.size() <= 300000;
  allow delete: if true;
  allow update: if true;   // NEW — enables message editing
}
match /typing/{uid}    { allow read, write: if true; }
match /presence/{uid}  { allow read, write: if true; }
match /reactions/{r}   { allow read, write: if true; }
```
