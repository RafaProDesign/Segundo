# Segundo's Rhythm — setting it up

One shared log for you, your partner and anyone else you give the address to.

**There is nothing to configure.** No database to create, no keys to copy, no
files to edit. Sync uses Netlify's own storage, which needs no setup when the
site is deployed.

You do this once. It takes about ten minutes, and most of that is waiting.

---

## 1. Put the files on GitHub

Netlify can only run the sync code if the site comes from a repository — that is
the whole reason GitHub is involved. You will not need to use it again except to
drop in an updated file.

1. Go to **https://github.com** and sign up. Free, no card.
2. Click **+** (top right) → **New repository**.
3. Name it `segundo`, choose **Private**, click **Create repository**.
4. On the next page click **uploading an existing file**.
5. Open the `segundo-app` folder on your computer, select **everything inside
   it**, and drag that into the browser.

> **This is the one step that can go wrong.** Drag the *contents* —
> `netlify.toml`, `package.json`, the `public` folder and the `netlify` folder.
> Do **not** drag the `segundo-app` folder itself, or everything ends up one
> level too deep and Netlify will not find it.

6. Click **Commit changes**.

---

## 2. Connect Netlify to it

1. Go to **https://app.netlify.com** and sign up (you can use your GitHub
   account, which saves a step).
2. **Add new site** → **Import an existing project** → **GitHub**.
3. Authorise Netlify when asked, then pick your `segundo` repository.
4. Leave every build setting alone — the repo already tells Netlify what to do.
   Click **Deploy**.

Give it a minute or two. When it finishes you get an address like
`random-name-123.netlify.app`.

Under **Site configuration → Change site name** you can make it something you
can actually type, such as `segundo.netlify.app`.

---

## 3. Load your nine days

Open the address in a browser → **Setup** → **Backup** → **Import backup** →
choose `segundo-backup.json` (inside the `public` folder).

That is 192 events across 13–21 September. Do this **once, from one device** —
it goes straight to the shared log, so every other device will already have it.

Importing merges rather than replaces, so running it twice changes nothing.

---

## 4. Put it on the phones

On each phone, open the address in **Safari** → **Share** → **Add to Home
Screen**. It then runs full-screen with its own icon.

Nothing to set up on the second phone. It opens, it has the data.

In **Setup → This device**, each person can put their name in so entries show
who logged them. That name is stored on that phone, not in the shared log.

---

## Sharing it

Send the address. Anyone who opens it can read and add entries — there is no
sign-in, which is what makes it effortless for your partner and a dog sitter.

It also means **the address is the only thing protecting the log**. It is dog
data, so that is a fair trade, but do not post it publicly.

---

## Things worth knowing

**Logging works without signal.** A tap on a walk is saved on the phone and
queued. It uploads by itself the next time the app is open with a connection.
**Setup → Sync** tells you if anything is waiting.

**It checks for changes every 20 seconds** while the app is open, and
immediately whenever you bring it back to the foreground. So an entry your
partner adds shows up on your phone within a few seconds of you looking at it.

**Back it up now and then.** Setup → Backup → Download backup. That file is the
only copy that does not depend on anyone's servers.

**Costs nothing.** Netlify's free tier covers this comfortably — a year of
logging is well under a megabyte.

---

## Updating the app later

When I send you a new version, open your repository on GitHub, click **Add file
→ Upload files**, drag the changed files in, and commit. Netlify redeploys on
its own within a minute.

Your log is never in those files, so an update cannot touch your data.

---

## What is in this folder

| File | What it does |
|---|---|
| `public/index.html` | The whole app |
| `public/store.js` | Talks to the shared log, holds a queue when offline |
| `public/segundo-backup.json` | Your 13–21 September data, 192 events |
| `public/manifest.webmanifest`, `public/icon*` | Home-screen name and icon |
| `netlify/functions/log.mjs` | The shared log itself — the only server-side code |
| `netlify.toml` | Tells Netlify where things are. Nothing to edit. |
| `package.json` | Lists the one dependency the sync code needs |
| `SETUP.md` | This file |
