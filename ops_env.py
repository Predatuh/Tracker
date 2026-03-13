import configparser
import os
from pathlib import Path


_BASE_DIR = Path(__file__).resolve().parent


def _load_config():
    cfg = configparser.ConfigParser()
    config_path = _BASE_DIR / 'config.ini'
    if config_path.exists():
        cfg.read(config_path)
    return cfg


def _first_non_empty(*values):
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ''


def _require(label, *values):
    result = _first_non_empty(*values)
    if result:
        return result
    raise SystemExit(
        f'Missing required configuration for {label}. '\
        'Set it via environment variable or config.ini before running this script.'
    )


def get_db_url():
    cfg = _load_config()
    return _require(
        'database URL',
        os.environ.get('TRACKER_DATABASE_URL'),
        os.environ.get('DATABASE_URL'),
        cfg.get('database', 'url', fallback=''),
    )


def get_site_url():
    cfg = _load_config()
    return _require(
        'site URL',
        os.environ.get('TRACKER_SITE_URL'),
        cfg.get('app', 'server_url', fallback=''),
    ).rstrip('/')


def get_admin_name():
    return _first_non_empty(os.environ.get('TRACKER_ADMIN_NAME'), 'Admin')


def get_admin_pin():
    cfg = _load_config()
    return _require(
        'admin PIN',
        os.environ.get('TRACKER_ADMIN_PIN'),
        os.environ.get('ADMIN_PIN'),
        cfg.get('admin', 'pin', fallback=''),
    )


def login_session(base_url=None, admin_name=None, admin_pin=None):
    import requests

    base_url = (base_url or get_site_url()).rstrip('/')
    admin_name = admin_name or get_admin_name()
    admin_pin = admin_pin or get_admin_pin()
    session = requests.Session()
    response = session.post(
        f'{base_url}/api/auth/login',
        json={'name': admin_name, 'pin': admin_pin},
        timeout=30,
    )
    if response.status_code != 200:
        raise SystemExit(f'Login failed: {response.status_code} {response.text[:200]}')
    return session, base_url