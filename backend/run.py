import configparser
import os
import logging
from pathlib import Path

# Ensure localhost dev runs with non-secure cookies before the app module is imported.
os.environ.setdefault('LOCAL_HTTP_DEV', '1')


def _load_local_config():
    root_dir = Path(__file__).resolve().parent.parent
    config_path = root_dir / 'config.ini'
    if not config_path.exists():
        return

    parser = configparser.ConfigParser()
    parser.read(config_path)

    database_url = parser.get('database', 'url', fallback='').strip()
    secret_key = parser.get('app', 'secret_key', fallback='').strip()
    admin_pin = parser.get('admin', 'pin', fallback='').strip()

    if database_url:
        os.environ.setdefault('DATABASE_URL', database_url)
    if secret_key:
        os.environ.setdefault('SECRET_KEY', secret_key)
    if admin_pin:
        os.environ.setdefault('ADMIN_PIN', admin_pin)


_load_local_config()

from waitress import serve
from app import create_app

# Configure logging to file
log_file = os.path.join(os.path.expanduser('~'), 'flask_debug.log')
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)
logger.info(f"Flask logging to: {log_file}")

if __name__ == '__main__':
    app = create_app()
    logger.info("Starting Flask app with Waitress server...")
    port = int(os.environ.get('PORT', os.environ.get('APP_PORT', '5000')))
    local_http_dev = os.environ.get('LOCAL_HTTP_DEV', '').strip().lower() in {'1', 'true', 'yes'}

    if local_http_dev:
        logger.info("Starting Flask app in local HTTP dev mode on http://127.0.0.1:%s", port)
        app.run(host='127.0.0.1', port=port, use_reloader=False, threaded=True)
    else:
        # Use Waitress for large file support (handles 255 MB+ PDFs)
        logger.info("Starting Flask app with Waitress server on http://localhost:%s", port)
        serve(app, host='localhost', port=port, threads=10)
