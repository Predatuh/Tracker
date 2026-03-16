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
| `ADMIN_PIN` | Required. Use a strong PIN or passcode you will not commit into scripts. |
| `MAIL_SMTP_HOST` | Your SMTP host, for example `smtp.gmail.com` or your mail provider host |
| `MAIL_SMTP_PORT` | Usually `587` for TLS |
| `MAIL_SMTP_USERNAME` | SMTP login username |
| `MAIL_SMTP_PASSWORD` | SMTP login password or app password |
| `MAIL_FROM_EMAIL` | The address verification emails should come from |
| `MAIL_SMTP_USE_TLS` | `true` for most providers |

4. Railway will auto-deploy. Your site URL will be something like `https://lbd-tracker-xyz.railway.app`

### Verification email setup
1. Configure the six `MAIL_*` variables above in Railway before allowing public account registration.
2. Use a real mailbox that can send externally; Gmail and Outlook usually require an app password.
3. After deploy, create a test account and confirm you receive the verification code email.
4. If SMTP is missing in local development, the backend returns a preview code in the API response instead of silently failing.

---

## 2. Use the EXE with the shared database

1. Copy `config.ini.example` → `config.ini` (in the same folder as the EXE)
2. Edit `config.ini`:
   ```ini
   [database]
   url = postgresql://...   ← paste your Railway DATABASE_URL here

   [admin]
   pin = your-admin-pin     ← must match ADMIN_PIN on Railway
   
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

- To create an account: click **Login → Create Account**, enter your name, 4-digit PIN, recovery email, and site token
- PIN must be exactly 4 digits (0–9)
- New accounts must verify their email before they can sign in
- To sign in as Admin: name = `Admin`, PIN = your `ADMIN_PIN`
- Admin account is created automatically on first run
- Helper scripts should use env vars like `TRACKER_SITE_URL`, `TRACKER_ADMIN_PIN`, and `TRACKER_DATABASE_URL` instead of hardcoded production secrets

## 4.1. Before Going Live

- Rotate any previously exposed DB passwords or admin PINs before launch
- Verify `SECRET_KEY` and `ADMIN_PIN` are set in Railway; cloud boot now fails fast if they are missing
- Confirm you can restore from a DB backup before announcing the system as live
- Review the new Admin `Activity` tab to confirm changes are being logged

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
