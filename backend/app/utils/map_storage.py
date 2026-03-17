import mimetypes
import os

from flask import current_app
from werkzeug.utils import secure_filename

from app import db


MAP_FILE_EXTENSIONS = ('.svg', '.png', '.jpg', '.jpeg', '.gif')


def map_search_dirs(upload_folder):
    return [
        os.path.join(upload_folder, 'maps'),
        upload_folder,
    ]


def list_uploaded_map_files(upload_folder):
    candidates = []
    for directory in map_search_dirs(upload_folder):
        if not os.path.isdir(directory):
            continue
        for entry in os.scandir(directory):
            if not entry.is_file():
                continue
            if not entry.name.lower().endswith(MAP_FILE_EXTENSIONS):
                continue
            candidates.append(entry.path)
    candidates.sort(key=lambda path: os.path.getmtime(path), reverse=True)
    return candidates


def _persist_site_map_path(site_map, file_path):
    normalized = os.path.abspath(file_path)
    changed = False
    if site_map.file_path != normalized:
        site_map.file_path = normalized
        changed = True
    basename = os.path.basename(normalized)
    if basename and site_map.name != basename:
        site_map.name = basename
        changed = True
    if changed:
        db.session.commit()
    return normalized


def _extension_for_site_map(site_map):
    existing_ext = os.path.splitext(site_map.name or '')[1].lower()
    if existing_ext in MAP_FILE_EXTENSIONS:
        return existing_ext
    if site_map.svg_content:
        return '.svg'
    mime = site_map.image_mime or mimetypes.guess_type(site_map.name or '')[0] or 'image/png'
    guessed_ext = mimetypes.guess_extension(mime) or '.png'
    if guessed_ext == '.jpe':
        guessed_ext = '.jpg'
    return guessed_ext


def restore_site_map_file(site_map, upload_folder=None):
    if not site_map:
        return None

    upload_folder = upload_folder or current_app.config.get('UPLOAD_FOLDER', '')
    maps_folder = os.path.join(upload_folder, 'maps')
    os.makedirs(maps_folder, exist_ok=True)

    filename = secure_filename(site_map.name or '')
    if not filename:
        filename = f'site_map_{site_map.id}{_extension_for_site_map(site_map)}'
    elif os.path.splitext(filename)[1].lower() not in MAP_FILE_EXTENSIONS:
        filename = f'{filename}{_extension_for_site_map(site_map)}'

    restored_path = os.path.join(maps_folder, filename)

    if site_map.svg_content:
        with open(restored_path, 'w', encoding='utf-8') as handle:
            handle.write(site_map.svg_content)
        return _persist_site_map_path(site_map, restored_path)

    if site_map.image_data:
        with open(restored_path, 'wb') as handle:
            handle.write(site_map.image_data)
        return _persist_site_map_path(site_map, restored_path)

    return None


def resolve_site_map_file(site_map, upload_folder=None):
    if not site_map:
        return None

    upload_folder = upload_folder or current_app.config.get('UPLOAD_FOLDER', '')

    if site_map.file_path and os.path.exists(site_map.file_path):
        return os.path.abspath(site_map.file_path)

    uploaded_files = list_uploaded_map_files(upload_folder)
    target_names = []
    for name in [site_map.name, os.path.basename(site_map.file_path or '')]:
        cleaned = str(name or '').strip()
        if cleaned:
            target_names.append(cleaned.lower())

    for target_name in target_names:
        for file_path in uploaded_files:
            if os.path.basename(file_path).lower() == target_name:
                return _persist_site_map_path(site_map, file_path)

    if uploaded_files:
        return _persist_site_map_path(site_map, uploaded_files[0])

    restored_path = restore_site_map_file(site_map, upload_folder)
    if restored_path:
        return restored_path

    return site_map.file_path