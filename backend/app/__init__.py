from flask import Flask, render_template
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO
import os

# Force-load async drivers so PyInstaller bundles them and engineio can find them
try:
    import simple_websocket          # noqa: F401 - required by engineio threading mode
    import engineio.async_drivers.threading  # noqa: F401
    import socketio.async_drivers.threading  # noqa: F401
except Exception:
    pass

db = SQLAlchemy()
socketio = SocketIO()


def create_app():
    # Setup paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    template_dir = os.path.join(os.path.dirname(base_dir), 'templates')
    static_dir = os.path.join(os.path.dirname(base_dir), 'static')

    app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)

    # Secret key (required for Flask sessions)
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'lbd-tracker-dev-secret-CHANGE-ME')
    app.config['PERMANENT_SESSION_LIFETIME'] = 60 * 60 * 24 * 30  # 30 days

    # Database: prefer DATABASE_URL env var (Railway PostgreSQL), fall back to SQLite
    database_url = os.environ.get('DATABASE_URL', '')
    if database_url:
        if database_url.startswith('postgres://'):
            database_url = database_url.replace('postgres://', 'postgresql://', 1)
        app.config['SQLALCHEMY_DATABASE_URI'] = database_url
        app.config['UPLOAD_FOLDER'] = os.environ.get('UPLOAD_FOLDER', '/tmp/lbd_uploads')
    else:
        data_dir = os.environ.get('LBD_DATA_DIR')
        if data_dir:
            db_path = os.path.join(data_dir, 'lbd_tracker.db')
            upload_path = os.path.join(data_dir, 'uploads')
            app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
            app.config['UPLOAD_FOLDER'] = upload_path
        else:
            backend_dir = os.path.dirname(base_dir)
            instance_dir = os.path.join(backend_dir, 'instance')
            os.makedirs(instance_dir, exist_ok=True)
            db_abs = os.path.join(instance_dir, 'lbd_tracker.db').replace('\\', '/')
            app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_abs}'
            app.config['UPLOAD_FOLDER'] = os.path.join(backend_dir, 'uploads')

    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500 MB
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

    # Initialize extensions
    db.init_app(app)
    CORS(app, supports_credentials=True)
    _async_mode = os.environ.get('SOCKETIO_ASYNC_MODE', 'threading')
    try:
        socketio.init_app(
            app,
            cors_allowed_origins='*',
            async_mode=_async_mode,
            # Waitress does not support WebSocket upgrades; force long-polling
            allow_upgrades=False,
            transports=['polling'],
            logger=False,
            engineio_logger=False,
        )
    except ValueError:
        socketio.init_app(
            app,
            cors_allowed_origins='*',
            allow_upgrades=False,
            transports=['polling'],
            logger=False,
            engineio_logger=False,
        )

    # Ensure upload / template / static directories exist
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(template_dir, exist_ok=True)
    os.makedirs(static_dir, exist_ok=True)

    # Register blueprints
    from app.routes import pdf_routes, tracker_routes, map_routes, lbd_routes
    from app.routes import admin_routes, auth_routes, update_routes, report_routes
    app.register_blueprint(pdf_routes.bp)
    app.register_blueprint(tracker_routes.bp)
    app.register_blueprint(map_routes.bp)
    app.register_blueprint(lbd_routes.bp)
    app.register_blueprint(admin_routes.bp)
    app.register_blueprint(auth_routes.bp)
    app.register_blueprint(update_routes.bp)
    app.register_blueprint(report_routes.bp)

    # Create / migrate tables, then seed admin
    with app.app_context():
        db.create_all()
        _migrate_schema(app)
        _seed_admin()

    # Start the nightly report scheduler (9 PM CST)
    _start_report_scheduler(app)

    @app.route('/')
    def index():
        return render_template('index.html')

    return app


# -- Seed default admin account ----------------------------------------
def _seed_admin():
    """Create the built-in admin account on first run if it does not exist."""
    from app.models.user import User
    admin_pin = os.environ.get('ADMIN_PIN', '9067')
    if not User.query.filter_by(username='admin').first():
        admin = User(name='Admin', username='admin', is_admin=True)
        admin.set_pin(admin_pin)
        db.session.add(admin)
        db.session.commit()


# -- Schema migration for SQLite ---------------------------------------
def _migrate_schema(app):
    """Add any columns that exist in models but not yet in the SQLite tables."""
    db_uri = app.config['SQLALCHEMY_DATABASE_URI']
    if not db_uri.startswith('sqlite:///'):
        return  # PostgreSQL handles this via db.create_all()
    import sqlite3
    db_path = db_uri.replace('sqlite:///', '')
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    _add_col(cur, 'power_blocks', 'power_block_number', 'TEXT')
    _add_col(cur, 'power_blocks', 'claimed_by', 'VARCHAR(100)')
    _add_col(cur, 'power_blocks', 'claimed_at', 'DATETIME')
    _add_col(cur, 'power_blocks', 'last_updated_by', 'VARCHAR(100)')
    _add_col(cur, 'power_blocks', 'last_updated_at', 'DATETIME')
    _add_col(cur, 'lbds', 'inventory_number', 'VARCHAR(100)')
    _add_col(cur, 'lbds', 'x_position', 'FLOAT')
    _add_col(cur, 'lbds', 'y_position', 'FLOAT')
    _add_col(cur, 'lbds', 'notes', 'TEXT')
    _add_col(cur, 'lbd_statuses', 'completed_by', 'VARCHAR(100)')
    _add_col(cur, 'site_areas', 'bbox_x', 'REAL')
    _add_col(cur, 'site_areas', 'bbox_y', 'REAL')
    _add_col(cur, 'site_areas', 'bbox_w', 'REAL')
    _add_col(cur, 'site_areas', 'bbox_h', 'REAL')
    _add_col(cur, 'site_areas', 'label_font_size', 'INTEGER')
    _add_col(cur, 'site_areas', 'polygon_points', 'TEXT')
    conn.commit()
    conn.close()


def _add_col(cur, table, col, dtype):
    try:
        cur.execute(f"PRAGMA table_info({table})")
        existing = {row[1] for row in cur.fetchall()}
        if col not in existing:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}")
    except Exception:
        pass


# -- Nightly report scheduler (9 PM CST) -----------------------------------
def _start_report_scheduler(app):
    """Spawn a daemon thread that generates a DailyReport at 9 PM CST each day."""
    import threading
    import time
    try:
        import pytz
        CST = pytz.timezone('America/Chicago')
    except ImportError:
        return   # pytz not available; skip scheduler

    def _scheduler():
        triggered_date = None
        while True:
            try:
                now_cst = __import__('datetime').datetime.now(CST)
                # Trigger once per day at 21:00 CST
                if now_cst.hour == 21 and triggered_date != now_cst.date():
                    triggered_date = now_cst.date()
                    with app.app_context():
                        from app.routes.report_routes import _get_or_generate_report
                        _get_or_generate_report(triggered_date)
            except Exception:
                pass
            time.sleep(60)   # check every minute

    t = threading.Thread(target=_scheduler, daemon=True)
    t.start()
