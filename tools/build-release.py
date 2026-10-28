"""Package only source-controlled/public files, excluding local accounts and caches."""
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {".git", ".venv", "node_modules", "work", "output", "output-qce", "reports", "test-output", "dist", "__pycache__"}


def main():
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if not (ROOT / "vendor/qce/renderer.mjs").is_file():
        raise SystemExit("Run npm run build:renderer before packaging")
    names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode("utf-8").split("\0")
    files = []
    for name in sorted(set(filter(None, names))):
        path = Path(name)
        if any(part in EXCLUDED or part.startswith(".venv-") for part in path.parts):
            continue
        if path.name == "config.json" or path.suffix in (".db", ".pyc") or path.name.endswith((".db-wal", ".db-shm", ".partial")):
            raise SystemExit("Refusing to package local/private file: " + name)
        source = ROOT / path
        if source.is_symlink() or not source.is_file():
            raise SystemExit("Refusing to package non-regular file: " + name)
        files.append((path.as_posix(), source.read_bytes()))
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    basename = "qq-nt-export-" + version
    destination = output / (basename + ".zip")
    checksums = "".join(hashlib.sha256(data).hexdigest() + "  " + name + "\n" for name, data in files)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in files:
            archive.writestr(basename + "/" + name, data)
        archive.writestr(basename + "/CHECKSUMS.sha256", checksums)
    checksum = hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix(".zip.sha256").write_text(checksum + "  " + destination.name + "\n", encoding="utf-8")
    print(json.dumps({"path": str(destination), "bytes": destination.stat().st_size, "sha256": checksum, "files": len(files)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
