# Splitsy — Setup Guide

Everything you need to get Splitsy live on the internet so you and your mates can use it. Budget about 30–45 minutes for the whole thing. All free.

---

## What you'll set up

1. **GitHub** — stores your code (like a Google Drive for code)
2. **Firebase** — the database that stores group/expense data
3. **Vercel** — hosts the website (gives you a real URL)


---

## STEP 1 — Create a GitHub account

1. Go to **https://github.com/signup**
2. Create an account with your email
3. Verify your email when they send the confirmation


---

## STEP 2 — Set up Firebase (the database)

This is the longest step but it's just clicking through screens.

### 2a. Create a Firebase project

1. Go to **https://console.firebase.google.com**
2. Sign in with a Google account (create one if needed)
3. Click **"Create a project"** (or "Add project")
4. Name it **splitsy** → click Continue
5. Turn OFF Google Analytics (you don't need it) → click **Create Project**
6. Wait for it to finish → click **Continue**

### 2b. Create the Realtime Database

1. In the left sidebar, click **"Build"** → **"Realtime Database"**
2. Click **"Create Database"**
3. Choose a location (pick the closest one to you, e.g. Australia for you)
4. Select **"Start in test mode"** → click **Enable**
5. You'll see an empty database — that's fine!

### 2c. Set the database rules

1. In the Realtime Database page, click the **"Rules"** tab at the top
2. Replace everything in the editor with this:

```json
{
  "rules": {
    "groups": {
      "$groupId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

3. Click **"Publish"**

### 2d. Register a Web App and get your config

1. Click the **gear icon** (⚙️) next to "Project Overview" in the top-left
2. Click **"Project settings"**
3. Scroll down to **"Your apps"** section
4. Click the **web icon** (looks like `</>`)
5. Enter nickname: **splitsy** → click **"Register app"**
6. You'll see a code block with `firebaseConfig`. It looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB.....................",
  authDomain: "splitsy-xxxxx.firebaseapp.com",
  databaseURL: "https://splitsy-xxxxx-default-rtdb.firebaseio.com",
  projectId: "splitsy-xxxxx",
  storageBucket: "splitsy-xxxxx.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123def456"
};
```

7. **Copy ALL of those values** — you'll paste them into the code in Step 3
8. Click **"Continue to console"**


---

## STEP 3 — Upload the code to GitHub

### 3a. Install Git and Node.js

**On Mac** (open Terminal app):
```bash
# Install Homebrew first (if you don't have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install Git and Node
brew install git node
```

**On Windows** — download and install:
- Git: https://git-scm.com/download/win
- Node.js: https://nodejs.org (click the LTS/recommended version)

### 3b. Download and edit the project

1. Unzip the **splitsy.zip** file you downloaded from Claude
2. Open the unzipped `splitsy` folder
3. Open the file `src/firebase.js` in any text editor (TextEdit on Mac, Notepad on Windows — or VS Code if you have it)
4. Replace each `"PASTE_YOUR_..._HERE"` value with the matching value from Step 2d
5. Save the file

### 3c. Test it works locally (optional but recommended)

Open Terminal/Command Prompt, navigate to the splitsy folder:

```bash
cd ~/Downloads/splitsy    # or wherever you unzipped it

npm install               # installs dependencies (takes a minute)
npm run dev               # starts the app locally
```

You'll see a URL like `http://localhost:5173` — open that in your browser. You should see Splitsy! Press `Ctrl+C` to stop when done testing.

### 3d. Push to GitHub

1. Go to **https://github.com/new**
2. Repository name: **splitsy**
3. Keep it **Public** (needed for free Vercel hosting)
4. Do NOT check any boxes (no README, no .gitignore)
5. Click **"Create repository"**
6. Back in Terminal, run these commands one at a time:

```bash
cd ~/Downloads/splitsy    # or wherever your project is

git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/splitsy.git
git push -u origin main
```

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

It'll ask for your GitHub credentials — use your username and a **personal access token** (not your password):
- Go to https://github.com/settings/tokens → "Generate new token (classic)"
- Give it a name, select the **repo** scope, generate it
- Copy the token and paste it as your password


---

## STEP 4 — Deploy to Vercel (get your live URL)

1. Go to **https://vercel.com/signup**
2. Click **"Continue with GitHub"** and authorise it
3. Click **"Add New..."** → **"Project"**
4. Find **splitsy** in your repos and click **"Import"**
5. Framework Preset should auto-detect as **Vite** — leave it
6. Click **"Deploy"**
7. Wait about 60 seconds...
8. You'll get a URL like **https://splitsy-abc123.vercel.app** 🎉

**That's your live URL!** Share it with your mates. Anyone who opens it can create or join groups.


---

## How it works once it's live

- You open `https://splitsy-abc123.vercel.app` and create a group
- Hit **"Copy Link"** or **"✉ Invite"** to share with friends
- The link looks like `https://splitsy-abc123.vercel.app/#a1b2c3d4`
- Your friends open it, enter their name, and they're in
- Everyone adds expenses and the app splits them in real time
- The "Settle Up" tab shows the minimum payments to square up


---

## Troubleshooting

**"npm: command not found"** — Node.js isn't installed. Re-do Step 3a.

**App loads but groups don't save** — Check your `src/firebase.js` has the right `databaseURL`. It should look like `https://splitsy-xxxxx-default-rtdb.firebaseio.com`.

**Vercel deployment fails** — Check the build log. Usually it's a typo in firebase.js. Fix it, commit and push again:
```bash
git add .
git commit -m "Fix config"
git push
```
Vercel auto-redeploys when you push.

**"Permission denied" in Firebase** — Your database rules might have expired (test mode lasts 30 days). Redo Step 2c to update the rules.


---

## Optional: Custom domain

If you ever want a nicer URL like `splitsy.com`:
1. Buy a domain (Namecheap, Google Domains, etc.)
2. In Vercel dashboard → your project → Settings → Domains → Add your domain
3. Follow Vercel's instructions to update your DNS
