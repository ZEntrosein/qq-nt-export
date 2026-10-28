"""Generate synthetic demo exports for browser QA, never real chat records."""
import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.fixtures import START, body, create, text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    movie = None
    if ffmpeg:
        path = directory / "synthetic-video.mp4"
        result = subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1:r=5",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", str(path)], capture_output=True)
        if result.returncode:
            raise RuntimeError("Synthetic FFmpeg video generation failed")
        movie = path.read_bytes()
    fixture = create(directory / "source", video=movie)

    def export(folder):
        result = subprocess.run([sys.executable, str(ROOT / "scripts/ntqq_export_qce.py"), "--src", str(fixture["source"]),
            "--media-root", str(fixture["media"]), "--outdir", str(directory / folder), "--only", "111111", "--zip", "--keep-folder",
            "--config", str(directory / "no-config.json")], capture_output=True, text=True, encoding="utf-8", errors="replace")
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        html = next((directory / folder).rglob("*.html"))
        return {"html": str(html), "json": str(html.with_suffix(".json")), "zip": str(next((directory / folder).rglob("*.zip"))),
                "folder": str(html.parent), "resources": str(html.parent / "resources")}

    small = export("small")
    connection = sqlite3.connect(fixture["source"])
    for index in range(1210):
        connection.execute('INSERT INTO group_msg_table ("40001","40003","40011","40013","40020","40021","40027","40030","40033","40050","40093","40800") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (10000 + index, 2000 + index, 2, 0, "u_demo", "111111", "111111", "111111", 123456789, START + 100 + index,
             "演示成员", body(text("普通消息 " + str(index)))))
    connection.commit()
    connection.close()
    large = export("large")
    print(json.dumps({"small": small, "large": large, "realVideo": movie is not None}, ensure_ascii=False))


if __name__ == "__main__":
    main()
