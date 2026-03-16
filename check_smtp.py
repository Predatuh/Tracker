import os
import sys

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, 'backend')
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import create_app
from app.utils.mailers import can_send_email, mail_config


def _masked(value: str) -> str:
    if not value:
        return ''
    if len(value) <= 4:
        return '*' * len(value)
    return f"{value[:2]}{'*' * max(0, len(value) - 4)}{value[-2:]}"


def main():
    app = create_app()
    with app.app_context():
        config = mail_config()
        configured = can_send_email()

    required = ['host', 'from_email']
    missing = [key for key in required if not config.get(key)]

    print('SMTP configuration status')
    print('-------------------------')
    print(f"Configured: {'yes' if configured else 'no'}")
    print(f"Host: {config.get('host') or '(missing)'}")
    print(f"Port: {config.get('port')}")
    print(f"Username: {_masked(str(config.get('username') or '')) or '(empty)'}")
    print(f"Password: {'set' if config.get('password') else '(empty)'}")
    print(f"From email: {config.get('from_email') or '(missing)'}")
    print(f"TLS: {config.get('use_tls')}")

    if missing:
        print('')
        print('Missing required values:')
        for key in missing:
            print(f'- {key}')
        print('')
        print('Expected Railway variables:')
        print('- MAIL_SMTP_HOST')
        print('- MAIL_SMTP_PORT')
        print('- MAIL_SMTP_USERNAME')
        print('- MAIL_SMTP_PASSWORD')
        print('- MAIL_FROM_EMAIL')
        print('- MAIL_SMTP_USE_TLS')
        return 1

    print('')
    print('SMTP config is present. Next step: register a test account and confirm the verification email arrives.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())