# PyInstaller runtime hook: force-import all engineio/socketio async drivers
# so the frozen EXE can find them at startup
import importlib

_engineio_drivers = [
    'engineio.async_drivers.threading',
    'engineio.async_drivers.eventlet',
    'engineio.async_drivers.gevent',
    'engineio.async_drivers._websocket_wsgi',
]

_socketio_drivers = [
    'socketio.async_drivers.threading',
    'socketio.async_drivers.gevent',
]

for _mod in _engineio_drivers + _socketio_drivers:
    try:
        importlib.import_module(_mod)
    except Exception:
        pass

# Also ensure simple_websocket is loaded
try:
    import simple_websocket  # noqa: F401
except Exception:
    pass
