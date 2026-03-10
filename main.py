"""
LBD Tracker - Desktop launcher
===============================
Reads config.ini next to the EXE, then either:
  - CLOUD MODE  (server_url is set)  -> opens the remote URL in a native-looking
    app window.  No local Flask server is started; everyone shares the same cloud.
  - LOCAL MODE  (server_url is blank) -> boots a local Waitress+Flask server on
    localhost and opens it in a native-looking app window.

No CMD window is ever shown (console=False in PyInstaller spec + CREATE_NO_WINDOW
for every subprocess call).
"""

import sys
import os
import threading
import time
import configparser
import urllib.request
import urllib.error
import json
import subprocess
import shutil
from pathlib import Path

# Windows constant - hides any child CMD windows
CREATE_NO_WINDOW = 0x08000000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_dir():
    """Directory of the EXE (frozen) or the script (dev)."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _load_config():
    base = _base_dir()
    cfg = configparser.ConfigParser()
    p = os.path.join(base, 'config.ini')
    if os.path.exists(p):
        cfg.read(p)
    return cfg, base


def _read_local_version(base):
    if getattr(sys, 'frozen', False):
        bundled = os.path.join(sys._MEIPASS, 'version.txt')
        if os.path.exists(bundled):
            return open(bundled).read().strip()
    p = os.path.join(base, 'version.txt')
    if os.path.exists(p):
        return open(p).read().strip()
    return '0.0.0'


def _parse_version(v):
    try:
        return tuple(int(x) for x in str(v).strip().split('.'))
    except Exception:
        return (0, 0, 0)


# ---------------------------------------------------------------------------
# Browser app-window helpers  (Edge / Chrome --app mode)
# ---------------------------------------------------------------------------

_EDGE_PATHS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]
_CHROME_PATHS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]


def _find_browser():
    """Return path to Edge or Chrome, or None."""
    for p in _EDGE_PATHS + _CHROME_PATHS:
        if os.path.exists(p):
            return p
    for name in ('msedge', 'edge', 'google-chrome', 'chrome'):
        found = shutil.which(name)
        if found:
            return found
    return None


def _open_app_window(url, base, log):
    """
    Open *url* in Edge/Chrome --app mode (no address bar / tabs).
    Returns the Popen object, or None when falling back to default browser.
    """
    browser = _find_browser()
    if browser:
        profile_dir = os.path.join(base, 'LBDTracker_profile')
        os.makedirs(profile_dir, exist_ok=True)
        cmd = [
            browser,
            f'--app={url}',
            f'--user-data-dir={profile_dir}',
            '--window-size=1440,920',
            '--disable-extensions',
            '--no-first-run',
            '--disable-default-apps',
        ]
        log(f'Launching app window: {browser}')
        # STARTUPINFO hides any flash of a console window on Windows
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        proc = subprocess.Popen(cmd, startupinfo=si)
        return proc
    else:
        log('No Edge/Chrome found - opening default browser')
        import webbrowser
        webbrowser.open(url)
        return None


# ---------------------------------------------------------------------------
# Background update checker
# ---------------------------------------------------------------------------

def _bg_update_check(update_url, base, port, log):
    """Check the hosted server for a newer EXE and post a notification."""
    if not update_url:
        return
    time.sleep(5)
    update_url = update_url.rstrip('/')
    log('Checking for updates...')
    try:
        req = urllib.request.Request(
            f'{update_url}/api/version',
            headers={'User-Agent': 'LBDTracker-Updater/1.0'},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
    except Exception as e:
        log(f'Update check failed: {e}')
        return

    remote = data.get('version', '0.0.0')
    dl_url = data.get('download_url')
    local  = _read_local_version(base)
    log(f'Local {local}  Remote {remote}')

    if _parse_version(remote) <= _parse_version(local) or not dl_url:
        return

    # Notify the local Flask server so the UI can show a banner
    try:
        payload = json.dumps({
            'remote_version': remote,
            'local_version': local,
            'download_url': dl_url,
        }).encode()
        urllib.request.urlopen(
            urllib.request.Request(
                f'http://127.0.0.1:{port}/api/notify-update',
                data=payload,
                headers={'Content-Type': 'application/json'},
                method='POST',
            ),
            timeout=3,
        )
        log('Update notification sent to app')
    except Exception as e:
        log(f'In-app notification failed: {e}')
        _show_update_dialog(remote, local, dl_url, base, log)


def _show_update_dialog(remote, local, dl_url, base, log):
    """Tkinter messagebox as a last-resort update prompt."""
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        yes = messagebox.askyesno(
            'LBD Tracker - Update Available',
            f'Version {remote} is available (you have {local}).\n\n'
            f'Download and restart now?',
        )
        root.destroy()
        if yes:
            _apply_update(dl_url, base, log)
    except Exception as e:
        log(f'Update dialog failed: {e}')


def _apply_update(dl_url, base, log):
    """Download new EXE, write a tiny batch file to swap it, then exit."""
    if not getattr(sys, 'frozen', False):
        log('Dev mode - skipping self-replace')
        return
    exe = sys.executable
    tmp = os.path.join(base, 'LBDTracker_update.exe')
    try:
        urllib.request.urlretrieve(dl_url, tmp)
    except Exception as e:
        log(f'Download failed: {e}')
        return
    bat = os.path.join(base, '_lbd_update.bat')
    with open(bat, 'w') as f:
        f.write(
            f'@echo off\n'
            f'timeout /t 2 /nobreak > nul\n'
            f'move /Y "{tmp}" "{exe}"\n'
            f'start "" "{exe}"\n'
            f'del "%~f0"\n'
        )
    # CREATE_NO_WINDOW prevents any CMD window from flashing
    subprocess.Popen(
        ['cmd', '/c', bat],
        creationflags=CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
        close_fds=True,
    )
    sys.exit(0)


# ---------------------------------------------------------------------------
# Flask startup helpers
# ---------------------------------------------------------------------------

def _wait_for_server(port, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def _fatal(msg):
    """Show a native error dialog (works even without a running server)."""
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror('LBD Tracker - Error', msg)
        root.destroy()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main entry point  (single, clean implementation)
# ---------------------------------------------------------------------------

def main():
    cfg, base = _load_config()

    # -- Logging -------------------------------------------------------
    log_path = os.path.join(Path.home(), 'LBDTracker_startup.log')

    def log(msg):
        try:
            with open(log_path, 'a') as f:
                f.write(f'{msg}\n')
        except Exception:
            pass

    log('--- LBD Tracker startup ---')
    log(f'Frozen: {getattr(sys, "frozen", False)}')

    # -- Read config values --------------------------------------------
    port       = int(cfg.get('app', 'port',       fallback='5000'))
    update_url =     cfg.get('app', 'update_url', fallback='').strip()
    server_url =     cfg.get('app', 'server_url', fallback='').strip()

    # ==================================================================
    # CLOUD MODE - EXE is just a thin wrapper around the hosted site
    # ==================================================================
    if server_url:
        log(f'Cloud mode -> {server_url}')
        proc = _open_app_window(server_url.rstrip('/'), base, log)
        # Background update check still runs
        threading.Thread(
            target=_bg_update_check,
            args=(update_url or server_url, base, port, log),
            daemon=True,
        ).start()
        if proc:
            proc.wait()
        else:
            # Default-browser fallback - keep process alive so EXE does not
            # vanish instantly (user closes it via Task Manager / Ctrl-C).
            try:
                while True:
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        log('Cloud-mode window closed - exiting')
        return

    # ==================================================================
    # LOCAL MODE - start a full Flask + Waitress server on localhost
    # ==================================================================

    # -- Python path ---------------------------------------------------
    meipass = sys._MEIPASS if getattr(sys, 'frozen', False) else base
    backend_path = os.path.join(meipass, 'backend')
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)

    # -- Data dir / env vars -------------------------------------------
    db_url = (cfg.get('database', 'url', fallback='') or '').strip()
    if db_url:
        os.environ['DATABASE_URL'] = db_url
        log(f'Remote DB: {db_url[:40]}...')
    else:
        data_dir = os.path.join(
            os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else base,
            'LBDTracker_data',
        )
        os.makedirs(data_dir, exist_ok=True)
        os.makedirs(os.path.join(data_dir, 'uploads'), exist_ok=True)
        os.environ['LBD_DATA_DIR'] = data_dir
        log(f'Local SQLite: {data_dir}')

    os.environ.setdefault('SECRET_KEY', cfg.get('app',   'secret_key', fallback='lbd-local-secret'))
    os.environ.setdefault('ADMIN_PIN',  cfg.get('admin', 'pin',        fallback='1234'))

    # -- Create Flask app ----------------------------------------------
    try:
        from app import create_app
        flask_app = create_app()
        log('Flask app created')
    except Exception as e:
        import traceback
        log(f'Flask create_app failed: {e}\n{traceback.format_exc()}')
        _fatal(f'Failed to start LBD Tracker:\n\n{e}\n\nLog: {log_path}')
        return

    # -- Start Waitress in a daemon thread -----------------------------
    def _serve():
        try:
            from waitress import serve
            serve(flask_app, host='127.0.0.1', port=port, threads=10)
        except Exception as e:
            log(f'Waitress error: {e}')

    threading.Thread(target=_serve, daemon=True).start()

    # -- Wait until Flask responds -------------------------------------
    log('Waiting for server...')
    if not _wait_for_server(port, timeout=30):
        log('Server did not start in time')
        _fatal(f'LBD Tracker server failed to start.\n\nLog: {log_path}')
        return
    log('Server ready')

    # -- Open native-looking app window --------------------------------
    url = f'http://127.0.0.1:{port}'
    proc = _open_app_window(url, base, log)

    # -- Background update check ---------------------------------------
    threading.Thread(
        target=_bg_update_check,
        args=(update_url, base, port, log),
        daemon=True,
    ).start()

    # -- Keep alive until the window is closed -------------------------
    if proc:
        log('Waiting for app window to close...')
        proc.wait()
        log('App window closed - exiting')
    else:
        try:
            while True:
                time.sleep(60)
        except KeyboardInterrupt:
            pass


# ---------------------------------------------------------------------------
if __name__ == '__main__':
    main()
