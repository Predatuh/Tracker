import os
import logging
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
    # Use Waitress for large file support (handles 255 MB+ PDFs)
    serve(app, host='localhost', port=5000, threads=10)
