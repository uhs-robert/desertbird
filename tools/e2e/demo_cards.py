#!/usr/bin/env python3
"""Draws the title cards and the end card of the demo video as transparent 1280x720 PNGs.

Usage: demo_cards.py <out dir> <logo png> <title font file> <title>...
Writes title_<n>.png for each title (n from 1) and end.png. ffmpeg drawtext cannot pick the weight of a variable font, so the cards are drawn here and demo_video.mjs overlays them.
"""
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("demo_cards: Python Pillow is missing. Install it (pip install pillow, or your distribution package python-pillow).")

WIDTH, HEIGHT = 1280, 720
SAND = (217, 160, 102, 255)
STRIP = (12, 14, 20, 170)
WHITE = (255, 255, 255, 255)
WEIGHT_EXTRA_BOLD = 800
WEIGHT_MEDIUM = 500
WEIGHT_BOLD = 700
TAGLINE = "Vim keys for Thunderbird and Betterbird"
URL = "addons.thunderbird.net"
NAME = "DesertBird"


def load_font(path, size, weight):
    font = ImageFont.truetype(path, size)
    font.set_variation_by_axes([weight])
    return font


def strip_card(logo, top, logo_px):
    card = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    draw.rectangle((0, top, WIDTH, HEIGHT), fill=STRIP)
    draw.rectangle((56, top + 28, 62, HEIGHT - 44), fill=SAND)
    card.alpha_composite(logo.resize((logo_px, logo_px), Image.LANCZOS), (WIDTH - logo_px - 64, top + 28))
    return card, draw


def title_card(logo, font_path, number, title):
    card, draw = strip_card(logo, 500, 96)
    draw.text((90, 520), f"{number:02d}", font=load_font(font_path, 26, WEIGHT_BOLD), fill=SAND)
    draw.text((90, 552), title, font=load_font(font_path, 76, WEIGHT_EXTRA_BOLD), fill=WHITE)
    draw.text((90, 636), NAME, font=load_font(font_path, 30, WEIGHT_MEDIUM), fill=WHITE[:3] + (210,))
    return card


def end_card(logo, font_path):
    card, draw = strip_card(logo, 380, 160)
    draw.text((90, 420), NAME, font=load_font(font_path, 112, WEIGHT_EXTRA_BOLD), fill=WHITE)
    draw.text((92, 560), TAGLINE, font=load_font(font_path, 38, WEIGHT_MEDIUM), fill=WHITE[:3] + (230,))
    draw.text((92, 624), URL, font=load_font(font_path, 32, WEIGHT_BOLD), fill=SAND)
    return card


def main():
    if len(sys.argv) < 5:
        sys.exit("usage: demo_cards.py <out dir> <logo png> <title font file> <title>...")
    out_dir, logo_path, font_path, *titles = sys.argv[1:]
    try:
        load_font(font_path, 20, WEIGHT_MEDIUM)
    except OSError as error:
        sys.exit(f"demo_cards: cannot load the title font {font_path} ({error}). Install Manrope or set DEMO_TITLE_FONT to a Manrope variable font file.")
    logo = Image.open(logo_path).convert("RGBA")
    for number, title in enumerate(titles, 1):
        title_card(logo, font_path, number, title).save(f"{out_dir}/title_{number}.png")
    end_card(logo, font_path).save(f"{out_dir}/end.png")


if __name__ == "__main__":
    main()
