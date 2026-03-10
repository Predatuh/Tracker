# LBD Tracker — Deployment Guide

## What this covers
1. Deploy to **Railway** (free hosting + PostgreSQL database)
2. Share that database with the **Windows EXE** on your USB drive
3. Real-time sync between EXE and website via WebSockets

---

## 1. Deploy to Railway

### One-time setup
1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo** → select this repo
3. Once linked, click **+ Plugin → PostgreSQL** to add a database

### Environment variables to set in Railway
In your service settings → **Variables** tab, add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | *(auto-set when you add PostgreSQL plugin — copy from the plugin's Connect tab)* |
| `SECRET_KEY` | Any long random string, e.g. `my-super-secret-abc-123-xyz-789` |
| `ADMIN_PIN` | Your chosen 4-digit admin PIN (default: `1234`) |

4. Railway will auto-deploy. Your site URL will be something like `https://lbd-tracker-xyz.railway.app`

---

## 2. Use the EXE with the shared database

1. Copy `config.ini.example` → `config.ini` (in the same folder as the EXE)
2. Edit `config.ini`:
   ```ini
   [database]
   url = postgresql://...   ← paste your Railway DATABASE_URL here

   [admin]
   pin = 1234               ← must match ADMIN_PIN on Railway
   
   [app]
   secret_key = same-secret-key-as-railway
   ```
3. Run `LBDTracker.exe` — it opens a browser automatically

> **No internet?** Leave `url` blank to use a local SQLite database on that PC.

---

## 3. Account system

| Account type | Can do |
|---|---|
| **Guest** (no login) | View map and dashboard only |
| **Regular user** | Check/uncheck status boxes on LBDs |
| **Admin** | Everything — edit layout, resize PBs, add labels, bulk actions |

- To create an account: click **Login → Create Account**, enter your name + a 4-digit PIN
- PIN must be exactly 4 digits (0–9)
- To sign in as Admin: name = `Admin`, PIN = your `ADMIN_PIN`
- Admin account is created automatically on first run

---

## 4. Build the EXE (Windows)

```powershell
pip install pyinstaller waitress
pyinstaller build.spec
```

Output: `dist\LBDTracker.exe`

Put these files on the USB together:
```
LBDTracker.exe
config.ini          ← your database URL goes here
```

---

## 5. Real-time sync

Changes made anywhere (EXE or website) instantly push to all connected browsers/tabs via Socket.IO.
- Status checkbox toggles broadcast immediately
- Bulk complete/clear broadcasts immediately
- Map layout changes (PB positions, labels) are stored in localStorage and do NOT sync across devices (by design — only the admin on a specific machine controls layout)
