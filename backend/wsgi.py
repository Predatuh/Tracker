# Production entry point for gunicorn + eventlet (Railway / any Linux host)
# Usage: gunicorn --worker-class eventlet -w 1 wsgi:app
import eventlet
eventlet.monkey_patch()  # Must be first, before any other imports

from app import create_app, socketio

app = create_app()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)
