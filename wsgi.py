# Root-level WSGI entry for Railway/Render/Heroku
# Railway starts from project root; this sets the Python path then delegates to backend/wsgi.py

import sys, os

# Add backend to Python path
_backend = os.path.join(os.path.dirname(__file__), 'backend')
if _backend not in sys.path:
    sys.path.insert(0, _backend)

import eventlet
eventlet.monkey_patch()

from app import create_app, socketio

app = create_app()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
