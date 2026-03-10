@echo off
REM Icon converter - Creates .ico from .png
REM Usage: icon_converter.py (requires Pillow)

from PIL import Image
import sys

def create_icon(png_path='icon.png', ico_path='icon.ico', size=(256, 256)):
    """Convert PNG to ICO"""
    try:
        img = Image.open(png_path)
        img = img.resize(size, Image.Resampling.LANCZOS)
        img.save(ico_path, 'ICO')
        print(f"✅ Icon created: {ico_path}")
        print("   Include in next build using LBDTracker.spec")
    except FileNotFoundError:
        print(f"❌ File not found: {png_path}")
        print("   Place icon.png in project root first")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == '__main__':
    create_icon()
