import os
import smtplib
from email.message import EmailMessage

from flask import current_app


def mail_config():
    return {
        'host': current_app.config.get('MAIL_SMTP_HOST') or os.environ.get('MAIL_SMTP_HOST', ''),
        'port': int(current_app.config.get('MAIL_SMTP_PORT') or os.environ.get('MAIL_SMTP_PORT', '587') or 587),
        'username': current_app.config.get('MAIL_SMTP_USERNAME') or os.environ.get('MAIL_SMTP_USERNAME', ''),
        'password': current_app.config.get('MAIL_SMTP_PASSWORD') or os.environ.get('MAIL_SMTP_PASSWORD', ''),
        'from_email': current_app.config.get('MAIL_FROM_EMAIL') or os.environ.get('MAIL_FROM_EMAIL', ''),
        'use_tls': str(current_app.config.get('MAIL_SMTP_USE_TLS') or os.environ.get('MAIL_SMTP_USE_TLS', 'true')).strip().lower() not in {'0', 'false', 'no', 'off'},
    }


def can_send_email():
    config = mail_config()
    return bool(config['host'] and config['from_email'])


def send_email_message(to_email, subject, text_body, html_body=None):
    config = mail_config()
    if not can_send_email():
        raise RuntimeError('Email delivery is not configured')

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = config['from_email']
    msg['To'] = to_email
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype='html')

    with smtplib.SMTP(config['host'], config['port'], timeout=20) as smtp:
        smtp.ehlo()
        if config['use_tls']:
            smtp.starttls()
            smtp.ehlo()
        if config['username']:
            smtp.login(config['username'], config['password'])
        smtp.send_message(msg)


def send_verification_email(user, code):
    job_site = user.job_site_name or 'your assigned job site'
    subject = f'Verify your {job_site} account'
    text_body = (
        f'Hi {user.name},\n\n'
        f'Use this verification code to finish setting up your account for {job_site}: {code}\n\n'
        'This code expires in 15 minutes. If you did not request this account, you can ignore this email.\n'
    )
    html_body = (
        f'<p>Hi {user.name},</p>'
        f'<p>Use this verification code to finish setting up your account for <strong>{job_site}</strong>:</p>'
        f'<p style="font-size:28px;font-weight:700;letter-spacing:6px;">{code}</p>'
        '<p>This code expires in 15 minutes.</p>'
    )
    send_email_message(user.email, subject, text_body, html_body)