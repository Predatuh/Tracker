from flask import Flask, render_template, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO
import os
import warnings

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

    app = Flask(
        __name__,
        template_folder=template_dir,
        static_folder=static_dir,
        static_url_path='/backend-static',
    )

    database_url = os.environ.get('DATABASE_URL', '')
    is_cloud_mode = bool(database_url)

    if is_cloud_mode and not os.environ.get('SECRET_KEY'):
        warnings.warn('SECRET_KEY is not set in cloud mode; using fallback secret key.', RuntimeWarning)
    if is_cloud_mode and not os.environ.get('ADMIN_PIN'):
        warnings.warn('ADMIN_PIN is not set in cloud mode; using fallback admin PIN.', RuntimeWarning)

    # Secret key (required for Flask sessions)
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'lbd-tracker-dev-secret-CHANGE-ME')
    app.config['PERMANENT_SESSION_LIFETIME'] = 60 * 60 * 24 * 30  # 30 days
    app.config['IS_CLOUD_MODE'] = is_cloud_mode
    app.config['MAIL_SMTP_HOST'] = os.environ.get('MAIL_SMTP_HOST', '')
    app.config['MAIL_SMTP_PORT'] = os.environ.get('MAIL_SMTP_PORT', '587')
    app.config['MAIL_SMTP_USERNAME'] = os.environ.get('MAIL_SMTP_USERNAME', '')
    app.config['MAIL_SMTP_PASSWORD'] = os.environ.get('MAIL_SMTP_PASSWORD', '')
    app.config['MAIL_FROM_EMAIL'] = os.environ.get('MAIL_FROM_EMAIL', '')
    app.config['MAIL_SMTP_USE_TLS'] = os.environ.get('MAIL_SMTP_USE_TLS', 'true')

    # Database: prefer DATABASE_URL env var (Railway PostgreSQL), fall back to SQLite
    if database_url:
        if database_url.startswith('postgres://'):
            database_url = database_url.replace('postgres://', 'postgresql://', 1)
        app.config['SQLALCHEMY_DATABASE_URI'] = database_url
        app.config['UPLOAD_FOLDER'] = os.environ.get('UPLOAD_FOLDER', '/tmp/lbd_uploads')
        # Connection pool settings for PostgreSQL over network
        app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
            'pool_size': 5,
            'pool_recycle': 300,
            'pool_pre_ping': True,
            'pool_timeout': 10,
        }
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
    # Allow cross-origin session cookies (Flutter web on localhost)
    app.config['SESSION_COOKIE_SAMESITE'] = 'None'
    app.config['SESSION_COOKIE_SECURE'] = True

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
        _migrate_tracker_columns(app)
        _recover_custom_columns(app)
        _seed_admin()
        _seed_trackers(app)

    # Start the nightly report scheduler (9 PM CST)
    _start_report_scheduler(app)

    @app.route('/')
    def index():
        return render_template('index.html')

    @app.route('/static/<path:path>')
    def frontend_static(path):
        return send_from_directory(static_dir, path)

    @app.route('/<path:path>')
    def frontend(path):
        requested_path = os.path.join(static_dir, path)
        if os.path.isfile(requested_path):
            return send_from_directory(static_dir, path)
        return render_template('index.html')

    @app.route('/manifest.json')
    def pwa_manifest():
        return app.send_static_file('manifest.json')

    @app.route('/sw.js')
    def pwa_sw():
        return app.send_static_file('sw.js'), 200, {'Content-Type': 'application/javascript', 'Service-Worker-Allowed': '/'}

    return app


# -- Seed default admin account ----------------------------------------
def _seed_admin():
    """Create the built-in admin account on first run if it does not exist."""
    from app.models.user import User
    admin_pin = os.environ.get('ADMIN_PIN', '1234')
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(name='Admin', username='admin', is_admin=True, role='admin')
        admin.set_pin(admin_pin)
        admin.email_verified = True
        db.session.add(admin)
        db.session.commit()
    elif not admin.role or admin.role != 'admin':
        admin.role = 'admin'
        db.session.commit()


# -- Schema migration for SQLite ---------------------------------------
def _migrate_schema(app):
    """Add any columns that exist in models but not yet in the DB tables."""
    db_uri = app.config['SQLALCHEMY_DATABASE_URI']
    if db_uri.startswith('sqlite:///'):
        _migrate_sqlite(app, db_uri)
    else:
        _migrate_generic(app)


def _migrate_generic(app):
    """For PostgreSQL / non-SQLite: use raw SQL via SQLAlchemy engine."""
    migrations = [
        ('power_blocks', 'power_block_number', 'VARCHAR(255)'),
        ('power_blocks', 'claimed_by', 'VARCHAR(100)'),
        ('power_blocks', 'claimed_people', "TEXT DEFAULT '[]'"),
        ('power_blocks', 'claimed_at', 'TIMESTAMP'),
        ('power_blocks', 'last_updated_by', 'VARCHAR(100)'),
        ('power_blocks', 'last_updated_at', 'TIMESTAMP'),
        ('lbds', 'inventory_number', 'VARCHAR(100)'),
        ('lbds', 'x_position', 'FLOAT'),
        ('lbds', 'y_position', 'FLOAT'),
        ('lbds', 'notes', 'TEXT'),
        ('lbd_statuses', 'completed_by', 'VARCHAR(100)'),
        ('site_areas', 'bbox_x', 'FLOAT'),
        ('site_areas', 'bbox_y', 'FLOAT'),
        ('site_areas', 'bbox_w', 'FLOAT'),
        ('site_areas', 'bbox_h', 'FLOAT'),
        ('site_areas', 'label_font_size', 'INTEGER'),
        ('site_areas', 'polygon_points', 'TEXT'),
        ('site_areas', 'label_color', 'VARCHAR(30)'),
        ('site_areas', 'label_offset_x', 'FLOAT'),
        ('site_areas', 'label_offset_y', 'FLOAT'),
        ('site_areas', 'zone', 'VARCHAR(50)'),
        ('users', 'role', "VARCHAR(20) DEFAULT 'user'"),
        ('users', 'permissions', "TEXT DEFAULT '[]'"),
        ('users', 'email', 'VARCHAR(255)'),
        ('users', 'job_site_name', 'VARCHAR(120)'),
        ('users', 'job_site_slug', 'VARCHAR(120)'),
        ('users', 'email_verified', 'BOOLEAN DEFAULT FALSE'),
        ('users', 'verification_code_hash', 'VARCHAR(255)'),
        ('users', 'verification_sent_at', 'TIMESTAMP'),
        ('users', 'verification_expires_at', 'TIMESTAMP'),
        ('users', 'verified_at', 'TIMESTAMP'),
        ('site_maps', 'image_data', 'BYTEA'),
        ('site_maps', 'image_mime', 'VARCHAR(50)'),
        ('trackers', 'dashboard_progress_label', "VARCHAR(100) DEFAULT 'Complete'"),
        ('trackers', 'dashboard_blocks_label', "VARCHAR(100) DEFAULT 'Power Blocks'"),
        ('trackers', 'dashboard_open_label', "VARCHAR(100) DEFAULT 'Open Tracker'"),
        ('trackers', 'job_site_name', 'VARCHAR(120)'),
    ]
    for table, col, dtype in migrations:
        try:
            db.session.execute(db.text(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {dtype}"
            ))
        except Exception:
            db.session.rollback()
    db.session.commit()


def _migrate_sqlite(app, db_uri):
    """SQLite-specific migration using PRAGMA table_info."""
    import sqlite3
    db_path = db_uri.replace('sqlite:///', '')
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    _add_col(cur, 'power_blocks', 'power_block_number', 'TEXT')
    _add_col(cur, 'power_blocks', 'claimed_by', 'VARCHAR(100)')
    _add_col(cur, 'power_blocks', 'claimed_people', "TEXT DEFAULT '[]'")
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
    _add_col(cur, 'site_areas', 'label_color', 'VARCHAR(30)')
    _add_col(cur, 'site_areas', 'label_offset_x', 'REAL')
    _add_col(cur, 'site_areas', 'label_offset_y', 'REAL')
    _add_col(cur, 'site_areas', 'zone', 'VARCHAR(50)')
    _add_col(cur, 'users', 'role', "VARCHAR(20) DEFAULT 'user'")
    _add_col(cur, 'users', 'permissions', "TEXT DEFAULT '[]'")
    _add_col(cur, 'users', 'email', 'VARCHAR(255)')
    _add_col(cur, 'users', 'job_site_name', 'VARCHAR(120)')
    _add_col(cur, 'users', 'job_site_slug', 'VARCHAR(120)')
    _add_col(cur, 'users', 'email_verified', 'BOOLEAN DEFAULT 0')
    _add_col(cur, 'users', 'verification_code_hash', 'VARCHAR(255)')
    _add_col(cur, 'users', 'verification_sent_at', 'DATETIME')
    _add_col(cur, 'users', 'verification_expires_at', 'DATETIME')
    _add_col(cur, 'users', 'verified_at', 'DATETIME')
    _add_col(cur, 'site_maps', 'image_data', 'BLOB')
    _add_col(cur, 'site_maps', 'image_mime', 'VARCHAR(50)')
    _add_col(cur, 'trackers', 'dashboard_progress_label', "VARCHAR(100) DEFAULT 'Complete'")
    _add_col(cur, 'trackers', 'dashboard_blocks_label', "VARCHAR(100) DEFAULT 'Power Blocks'")
    _add_col(cur, 'trackers', 'dashboard_open_label', "VARCHAR(100) DEFAULT 'Open Tracker'")
    _add_col(cur, 'trackers', 'job_site_name', 'VARCHAR(120)')
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


def _recover_custom_columns(app):
    """Detect custom status columns stored in status_colors or lbd_statuses
    but missing from the custom_columns admin setting, and restore them."""
    from app.models.admin_settings import AdminSettings
    from app.models.status import LBDStatus
    import json

    builtins = set(LBDStatus.STATUS_TYPES)
    existing_custom = AdminSettings.get('custom_columns') or []
    if existing_custom:
        return  # already populated, nothing to recover

    # Collect all non-builtin status types from lbd_statuses table
    try:
        rows = db.session.execute(
            db.text('SELECT DISTINCT status_type FROM lbd_statuses')
        ).fetchall()
        db_types = {r[0] for r in rows}
    except Exception:
        db_types = set()

    # Also check status_colors for additional keys
    color_keys = set()
    stored_colors = AdminSettings.get('status_colors')
    if isinstance(stored_colors, dict):
        color_keys = set(stored_colors.keys())

    all_known = db_types | color_keys
    custom = [k for k in all_known if k not in builtins]

    if custom:
        AdminSettings.set('custom_columns', custom)
        app.logger.info(f'Recovered custom columns: {custom}')


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


# -- Add tracker_id columns to existing tables (PostgreSQL + SQLite) ----
def _migrate_tracker_columns(app):
    """Add tracker_id columns to lbds, work_entries, daily_reports if missing."""
    from sqlalchemy import inspect as sa_inspect
    try:
        inspector = sa_inspect(db.engine)

        # lbds table
        lbd_cols = {c['name'] for c in inspector.get_columns('lbds')}
        if 'tracker_id' not in lbd_cols:
            db.session.execute(db.text('ALTER TABLE lbds ADD COLUMN tracker_id INTEGER'))
            app.logger.info('Added tracker_id to lbds table')

        # work_entries table
        we_cols = {c['name'] for c in inspector.get_columns('work_entries')}
        if 'tracker_id' not in we_cols:
            db.session.execute(db.text('ALTER TABLE work_entries ADD COLUMN tracker_id INTEGER'))
            app.logger.info('Added tracker_id to work_entries table')

        # daily_reports table
        dr_cols = {c['name'] for c in inspector.get_columns('daily_reports')}
        if 'tracker_id' not in dr_cols:
            db.session.execute(db.text('ALTER TABLE daily_reports ADD COLUMN tracker_id INTEGER'))
            # Drop old unique constraint on report_date if it exists (PostgreSQL)
            db_uri = app.config['SQLALCHEMY_DATABASE_URI']
            if 'postgresql' in db_uri:
                try:
                    db.session.execute(db.text(
                        'ALTER TABLE daily_reports DROP CONSTRAINT IF EXISTS daily_reports_report_date_key'
                    ))
                except Exception:
                    pass
            app.logger.info('Added tracker_id to daily_reports table')

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        app.logger.warning(f'tracker_id migration: {e}')


# -- Seed default trackers ------------------------------------------------
def _seed_trackers(app):
    """Create default LBD and Inverter DC Landing trackers on first run."""
    from app.models.tracker import Tracker
    from app.models.admin_settings import AdminSettings
    from app.models.status import LBDStatus
    from app.utils.job_sites import default_job_site
    import json

    job_site = default_job_site()

    deprecated_statuses = {'quality_check', 'quality_docs'}

    def _remove_deprecated_statuses(values):
        return [value for value in values if value not in deprecated_statuses]

    stored_colors = AdminSettings.get('status_colors') or {}
    if any(key in stored_colors for key in deprecated_statuses):
        AdminSettings.set(
            'status_colors',
            {key: value for key, value in stored_colors.items() if key not in deprecated_statuses}
        )
        stored_colors = AdminSettings.get('status_colors') or {}

    stored_names = AdminSettings.get('status_names') or {}
    if any(key in stored_names for key in deprecated_statuses):
        AdminSettings.set(
            'status_names',
            {key: value for key, value in stored_names.items() if key not in deprecated_statuses}
        )
        stored_names = AdminSettings.get('status_names') or {}

    col_order = AdminSettings.get('column_order')
    if col_order:
        cleaned_order = _remove_deprecated_statuses(col_order)
        if cleaned_order != col_order:
            AdminSettings.set('column_order', cleaned_order)
        col_order = cleaned_order

    # --- LBD Tracker ---
    lbd_tracker = Tracker.query.filter_by(slug='lbd').first()
    if not lbd_tracker:
        # Pull existing admin settings to populate the LBD tracker
        custom = AdminSettings.get('custom_columns') or []
        disabled = AdminSettings.get('disabled_builtins') or []

        # Build full type list: builtins minus disabled + custom
        types = [k for k in LBDStatus.STATUS_TYPES if k not in disabled]
        for c in custom:
            if c not in types:
                types.append(c)

        # Merge colors
        colors = dict(LBDStatus.STATUS_COLORS)
        colors.update(stored_colors)
        colors = {k: v for k, v in colors.items() if k in set(types)}

        # Merge names
        from app.models.admin_settings import AdminSettings as AS
        names = dict(AS.DEFAULT_NAMES)
        names.update(stored_names)
        names = {k: v for k, v in names.items() if k in set(types)}

        lbd_tracker = Tracker(
            name='LBD Tracker',
            slug='lbd',
            item_name_singular='LBD',
            item_name_plural='LBDs',
            stat_label='Total LBDs',
            job_site_name=job_site['name'],
            icon='🔌',
            sort_order=0,
        )
        lbd_tracker.set_status_types(types)
        lbd_tracker.set_status_colors(colors)
        lbd_tracker.set_status_names(names)
        if col_order:
            lbd_tracker.set_column_order(col_order)
        db.session.add(lbd_tracker)
        db.session.flush()

        # Assign all existing LBDs to this tracker
        db.session.execute(
            db.text('UPDATE lbds SET tracker_id = :tid WHERE tracker_id IS NULL'),
            {'tid': lbd_tracker.id}
        )
        # Assign existing work entries
        db.session.execute(
            db.text('UPDATE work_entries SET tracker_id = :tid WHERE tracker_id IS NULL'),
            {'tid': lbd_tracker.id}
        )
        # Assign existing daily reports
        db.session.execute(
            db.text('UPDATE daily_reports SET tracker_id = :tid WHERE tracker_id IS NULL'),
            {'tid': lbd_tracker.id}
        )
        db.session.commit()
        app.logger.info(f'Created LBD tracker (id={lbd_tracker.id}) and migrated existing data')
    else:
        tracker_changed = False
        if lbd_tracker.job_site_name != job_site['name']:
            lbd_tracker.job_site_name = job_site['name']
            tracker_changed = True
        types = _remove_deprecated_statuses(lbd_tracker.get_status_types())
        if types != lbd_tracker.get_status_types():
            lbd_tracker.set_status_types(types)
            tracker_changed = True

        colors = {
            key: value
            for key, value in lbd_tracker.get_status_colors().items()
            if key not in deprecated_statuses
        }
        if colors != lbd_tracker.get_status_colors():
            lbd_tracker.set_status_colors(colors)
            tracker_changed = True

        names = {
            key: value
            for key, value in lbd_tracker.get_status_names().items()
            if key not in deprecated_statuses
        }
        if names != lbd_tracker.get_status_names():
            lbd_tracker.set_status_names(names)
            tracker_changed = True

        tracker_order = lbd_tracker.get_column_order()
        if tracker_order:
            cleaned_tracker_order = _remove_deprecated_statuses(tracker_order)
            if cleaned_tracker_order != tracker_order:
                lbd_tracker.set_column_order(cleaned_tracker_order)
                tracker_changed = True

        if tracker_changed:
            db.session.commit()
            app.logger.info(f'Removed deprecated LBD tracker statuses from tracker id={lbd_tracker.id}')

    # --- Inverter DC Landing Tracker ---
    inv_tracker = Tracker.query.filter_by(slug='inverter-dc').first()
    if not inv_tracker:
        inv_tracker = Tracker(
            name='Inverter DC Landing',
            slug='inverter-dc',
            item_name_singular='Inverter',
            item_name_plural='Inverters',
            stat_label='Inverters Landed',
            job_site_name=job_site['name'],
            icon='⚡',
            sort_order=1,
        )
        inv_tracker.set_status_types(['dc_landing'])
        inv_tracker.set_status_colors({'dc_landing': '#FFB020'})
        inv_tracker.set_status_names({'dc_landing': 'DC Landing'})
        db.session.add(inv_tracker)
        db.session.commit()
        app.logger.info(f'Created Inverter DC Landing tracker (id={inv_tracker.id})')
    elif inv_tracker.job_site_name != job_site['name']:
        inv_tracker.job_site_name = job_site['name']
        db.session.commit()


