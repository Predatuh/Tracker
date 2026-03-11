# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, get_module_file_attribute
import os

block_cipher = None

# Collect PyMuPDF data and binaries
try:
    fitz_datas = collect_data_files('fitz')
    fitz_binaries = collect_dynamic_libs('fitz')
except Exception:
    fitz_datas = []
    fitz_binaries = []

# Collect OpenCV binaries (opencv-python-headless)
try:
    cv2_datas = collect_data_files('cv2')
    cv2_binaries = collect_dynamic_libs('cv2')
except Exception:
    cv2_datas = []
    cv2_binaries = []

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[] + fitz_binaries + cv2_binaries,
    datas=[
        ('backend/templates', 'backend/templates'),
        ('backend/static', 'backend/static'),
        ('backend/app', 'backend/app'),
        ('version.txt', '.'),
    ] + fitz_datas + cv2_datas,
    hiddenimports=[
        # flask / socketio
        'flask',
        'flask_cors',
        'flask_sqlalchemy',
        'flask_socketio',
        'socketio',
        'socketio.async_drivers',
        'socketio.async_drivers.threading',
        'socketio.async_drivers.gevent',
        'engineio',
        'engineio.async_drivers',
        'engineio.async_drivers.threading',
        'engineio.async_drivers.eventlet',
        'engineio.async_drivers.gevent',
        'engineio.async_drivers._websocket_wsgi',
        'simple_websocket',
        'wsproto',
        'sqlalchemy',
        'PyPDF2',
        'fitz',
        'pymupdf',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'PIL.ImageFont',
        'requests',
        'werkzeug',
        'waitress',
        'pytz',
        'h11',
        'bidict',
        'tkinter',
        'tkinter.messagebox',
        'cv2',
        'numpy',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['rthook_socketio.py'],
    excludedimports=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='LBDTracker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
