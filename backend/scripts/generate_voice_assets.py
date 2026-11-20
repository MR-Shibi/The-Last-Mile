"""Pre-generate static Urdu + English .mp3 prompts into frontend/public/audio/{lang}/{key}.mp3.

Usage (from backend/): python scripts/generate_voice_assets.py [--force]
Uses gTTS (needs network once at build time); the generated files are committed so the PWA
plays them offline. Only fixed UI prompt text is sent to the TTS service — never user data.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gtts import gTTS  # noqa: E402

from app.services.voice import PROMPTS, asset_path  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    for key, texts in PROMPTS.items():
        for lang, text in texts.items():
            out = asset_path(key, lang)
            out.parent.mkdir(parents=True, exist_ok=True)
            if out.exists() and out.stat().st_size > 0 and not args.force:
                print(f"skip  {out.relative_to(out.parents[3])}")
                continue
            gTTS(text=text, lang=lang).save(str(out))
            print(f"wrote {out.relative_to(out.parents[3])} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
