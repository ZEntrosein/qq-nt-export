"""Find local media under explicitly selected roots, copy once, and report gaps."""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

DIRECTORIES = {"image": "images", "video": "videos", "audio": "audios", "file": "files"}
EXTENSIONS = {
    "image": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".apng"},
    "video": {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv"},
    "audio": {".wav", ".mp3", ".ogg", ".opus", ".m4a", ".aac", ".amr", ".silk", ".slk", ".ptt"},
}
HASH = re.compile(r"[a-f0-9]{32}", re.IGNORECASE)


@lru_cache(maxsize=4096)
def qq_cache_name(md5, folder):
    """QQ's signed CRC64 cache naming; documented by QQNT_Export/elements.py."""
    value = -1
    for byte in (folder + ":" + md5.upper()).encode("ascii"):
        entry = (byte ^ value) & 255
        for _ in range(8):
            entry = (entry >> 1) ^ -7661587058870466123 if entry & 1 else entry >> 1
        value = entry ^ (value >> 8)
    return f"Cache_{value:x}"


def inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def safe_name(value, fallback="聊天记录", limit=70):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(value)).strip(" .")[:limit].rstrip(" .")
    if name.upper().split(".")[0] in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}:
        name = "_" + name
    return name or fallback


def fingerprint(path):
    md5, sha = hashlib.md5(), hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            md5.update(block)
            sha.update(block)
    return md5.hexdigest(), sha.hexdigest()


def sniff(path):
    with path.open("rb") as stream:
        header = stream.read(40)
    if header.startswith(b"\xff\xd8\xff"):
        return "image", ".jpg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", ".png"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image", ".gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image", ".webp"
    if header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "audio", ".wav"
    if b"#!SILK_V3" in header:
        return "audio", ".silk"
    if header.startswith(b"#!AMR"):
        return "audio", ".amr"
    if len(header) > 12 and header[4:8] == b"ftyp":
        return ("audio", ".m4a") if b"M4A" in header[:24] else ("video", ".mp4")
    suffix = path.suffix.lower()
    for kind, extensions in EXTENSIONS.items():
        if suffix in extensions:
            return kind, suffix
    return "file", suffix or ".bin"


def iter_media(message, trail=None):
    trail = list(trail or [])
    for position, element in enumerate(message["content"]["elements"]):
        kind, data = element["type"], element["data"]
        if kind in DIRECTORIES:
            yield message, kind, data, trail
        elif kind == "reply":
            for preview in data.get("previewElements", []):
                if preview.get("type") in DIRECTORIES:
                    yield message, preview["type"], preview, trail + [{"kind": "reply", "messageId": data.get("reference", {}).get("messageId", ""), "timestamp": data.get("timestamp", 0)}]
        elif kind == "forward":
            for index, nested in enumerate(data.get("messages", [])):
                branch = {"kind": "forward", "title": data.get("title", "聊天记录"), "index": index + 1,
                          "messageId": nested.get("messageId") or nested["id"], "timestamp": nested.get("timestamp", 0)}
                yield from iter_media(nested, trail + [branch])


class MediaLibrary:
    def __init__(self, roots, excluded=(), progress=None):
        self.roots = list(dict.fromkeys(Path(root).expanduser().resolve() for root in roots))
        self.excluded = [Path(path).resolve() for path in excluded]
        self.index = {}
        self.hashes = {}
        self.progress = progress or (lambda message: None)
        self.indexed = False

    def allowed(self, path):
        try:
            return not path.is_symlink() and any(inside(path.resolve(), root) for root in self.roots) and path.is_file() and path.stat().st_size > 0
        except OSError:
            return False

    def build_index(self):
        if self.indexed:
            return
        count = 0
        for root in self.roots:
            if not root.is_dir():
                self.progress(f"媒体目录不存在：{root}")
                continue
            for base, directories, files in os.walk(root, followlinks=False):
                directory = Path(base)
                directories[:] = [name for name in directories if not (directory / name).is_symlink()
                                  and inside((directory / name).resolve(), root)
                                  and not any(inside((directory / name).resolve(), skip) for skip in self.excluded)]
                for name in files:
                    path = directory / name
                    if path.is_symlink():
                        continue
                    keys = {name.casefold(), path.stem.casefold(), *(match.lower() for match in HASH.findall(name))}
                    for key in keys:
                        self.index.setdefault(key, []).append(path)
                    count += 1
                    if count % 10000 == 0:
                        self.progress(f"已索引 {count} 个本地媒体文件")
        self.indexed = True
        self.progress(f"本地媒体索引完成：{count} 个文件")

    def find(self, kind, data):
        paths = []
        names = [data.get("filename"), data.get("fileName")]
        for value in data.get("sourcePaths", []):
            candidate = Path(value)
            names.append(candidate.name)
            if candidate.is_absolute():
                paths.append(candidate)
            else:
                paths.extend(root / candidate for root in self.roots)
        explicit = {str(path).casefold() for path in paths}
        self.build_index()
        md5 = str(data.get("md5", "")).lower()
        if kind == "image" and HASH.fullmatch(md5):
            for cache_folder in ("chatraw", "chatimg", "chatthumb"):
                cache_name = qq_cache_name(md5, cache_folder)
                unsigned_name = "Cache_" + format(int(cache_name[6:], 16) & ((1 << 64) - 1), "x")
                names.extend((cache_name, cache_name + "_hd", unsigned_name, unsigned_name + "_hd"))
        for key in [md5] + [str(name).casefold() for name in names if name]:
            paths.extend(self.index.get(key, []))
        seen, matches = set(), {}
        for path in paths:
            key = str(path).casefold()
            if key in seen or not self.allowed(path):
                continue
            seen.add(key)
            actual_kind, extension = sniff(path)
            if kind != "file" and actual_kind not in (kind, "file"):
                continue
            stat = path.stat()
            cache_key = (path.resolve(), stat.st_size, stat.st_mtime_ns)
            if cache_key not in self.hashes:
                self.hashes[cache_key] = fingerprint(path)
            actual_md5, sha = self.hashes[cache_key]
            if md5 and actual_md5 != md5:
                continue
            candidate = (path, actual_md5, sha, extension)
            if key in explicit:
                return candidate
            matches.setdefault(sha, candidate)
        # Basename equality does not establish identity when two cached files differ.
        return next(iter(matches.values())) if len(matches) == 1 else None


class MediaExporter:
    def __init__(self, library, output, node="node", silk_decoder=None):
        self.library, self.output = library, Path(output)
        self.node, self.silk_decoder = node, silk_decoder
        self.saved, self.failed = {}, {}
        self.issues = []

    def process(self, messages):
        for message in messages:
            per_message = {}
            for owner, kind, data, trail in iter_media(message):
                identity = (kind, data.get("md5") or data.get("filename") or data.get("fileName") or repr(data.get("sourcePaths", [])))
                try:
                    found = self.library.find(kind, data)
                    if not found:
                        raise FileNotFoundError("本地缓存未找到与该媒体匹配的文件")
                    source, md5, sha, extension = found
                    asset_key = (kind, sha)
                    if asset_key not in self.saved:
                        directory = DIRECTORIES[kind]
                        # QCE readers recognize an MD5 prefix when repairing cross-export references.
                        # Include SHA-256 too so even a hash collision cannot overwrite another file.
                        filename = md5 + "_" + sha[:12] + extension
                        destination = self.output / "resources" / directory / filename
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        partial = destination.with_suffix(destination.suffix + ".partial")
                        try:
                            shutil.copyfile(source, partial)
                            copied_md5, copied_sha = fingerprint(partial)
                            if copied_sha != sha:
                                raise OSError("复制后文件校验不一致")
                            partial.replace(destination)
                        finally:
                            partial.unlink(missing_ok=True)
                        entry = {"localPath": f"{directory}/{filename}", "size": destination.stat().st_size,
                                 "md5": md5, "sha256": sha, "type": kind, "filename": data.get("filename") or data.get("fileName") or source.name}
                        if kind == "audio" and extension == ".silk":
                            entry["originalLocalPath"] = entry["localPath"]
                            if self.silk_decoder:
                                wav = destination.with_suffix(".wav")
                                result = subprocess.run([self.node, str(self.silk_decoder), str(destination), str(wav)], capture_output=True, text=True, encoding="utf-8", timeout=120)
                                if result.returncode or not wav.is_file():
                                    wav.unlink(missing_ok=True)
                                    entry["playbackUnsupported"] = True
                                    entry["playbackError"] = "SILK 转 WAV 失败：" + result.stderr[:200]
                                    self.issues.append({"type": "audio", "filename": entry["filename"], "reason": entry["playbackError"]})
                                else:
                                    wav_md5, wav_sha = fingerprint(wav)
                                    playable = wav.with_name(wav_md5 + "_" + wav_sha[:12] + ".wav")
                                    wav.replace(playable)
                                    entry["originalSize"] = entry["size"]
                                    entry["originalMd5"] = entry["md5"]
                                    entry["localPath"] = f"{directory}/{playable.name}"
                                    entry["size"] = playable.stat().st_size
                                    entry["md5"], entry["sha256"] = wav_md5, wav_sha
                            else:
                                entry["playbackUnsupported"] = True
                        self.saved[asset_key] = entry
                    entry = self.saved[asset_key]
                    data.update({key: value for key, value in entry.items() if key not in ("type", "filename")})
                    data.pop("exportState", None)
                    data["filename"] = data.get("filename") or data.get("fileName") or entry["filename"]
                    data["fileName"] = data["filename"]
                    resource = {**entry, "filename": data["filename"]}
                except (OSError, ValueError, subprocess.SubprocessError) as exc:
                    state = {"version": 1, "status": "failed", "stage": "export", "code": "source-missing" if isinstance(exc, FileNotFoundError) else "copy-failed"}
                    data["exportState"] = state
                    resource = {"type": kind, "filename": data.get("filename") or data.get("fileName") or "未知媒体", "size": data.get("size", 0), "md5": data.get("md5", ""), "exportState": state}
                    occurrence = {"messageId": message["id"], "timestamp": owner.get("timestamp", 0), "time": owner.get("time", ""),
                                  "sender": owner.get("sender", {}), "tree": trail}
                    if identity not in self.failed:
                        self.failed[identity] = {**resource, "reason": str(exc), "occurrences": []}
                    self.failed[identity]["occurrences"].append(occurrence)
                data.pop("sourcePaths", None)
                # Each nested message retains its own resource list; quoted media belongs to its reply.
                entries = owner["content"].setdefault("resources", [])
                key = (kind, resource.get("localPath") or resource.get("md5") or resource["filename"])
                owner_key = (id(owner), key)
                if owner_key not in per_message:
                    entries.append(resource)
                    per_message[owner_key] = True
        return self.report()

    def report(self):
        return {"version": 1, "mode": "local-cache", "saved": len(self.saved), "failed": len(self.failed),
                "total": len(self.saved) + len(self.failed), "resources": list(self.saved.values()),
                "failures": list(self.failed.values()), "playbackWarnings": list(self.issues)}
