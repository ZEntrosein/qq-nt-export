"""Offline conversion entry point. Never opens a QQ process or network socket."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from .database import LocalDatabase
from .media import DIRECTORIES, MediaExporter, MediaLibrary, inside, safe_name
from .output import archive, document, write_excel, write_json, write_text
from .protocol import resolve_quotes

ROOT = Path(__file__).resolve().parents[2]


def parse_time(value):
    if value is None:
        return None
    try:
        return int(value) if value.isdigit() else int(datetime.fromisoformat(value).timestamp())
    except ValueError as exc:
        raise argparse.ArgumentTypeError("时间应为 Unix 秒或 YYYY-MM-DD[THH:MM:SS]") from exc


def parser():
    result = argparse.ArgumentParser(description="将已解密的 QQNT 数据库导出为 QCE 兼容的 JSON/HTML/TXT/Excel，与 resources 一起打包。")
    result.add_argument("--src", help="已解密的 nt_msg.db 或 nt_msg_plain.db")
    result.add_argument("--aux-dir", help="包含解密后的 group_info/profile_info 数据库的目录")
    result.add_argument("--outdir", help="输出目录；每个会话独立保存")
    result.add_argument("--only", nargs="+", help="仅指定群号、私聊 QQ 号或 UID")
    result.add_argument("--since", type=parse_time, help="起始时间，包含边界")
    result.add_argument("--until", type=parse_time, help="终止时间，不包含边界；例如 2026-10-26 表示到 25 日结束")
    result.add_argument("--limit", type=int, default=0, help="每个会话的最大消息数；0=全部")
    result.add_argument("--formats", default=None, help="逗号分隔 json,html,txt,excel；默认全部")
    result.add_argument("--media-root", action="append", default=[], help="QQ 本地媒体目录，可以重复指定；通常为账号的 nt_data")
    result.add_argument("--zip", action="store_true", help="每个会话分别输出 ZIP")
    result.add_argument("--keep-folder", action="store_true", help="输出 ZIP 时额外保留未压缩目录")
    result.add_argument("--node", default="node", help="Node.js 程序路径，用于原版 HTML 渲染和 SILK 解码")
    result.add_argument("--no-virtual-scroll", action="store_true", help="HTML 保留全部消息 DOM，便于浏览器 Ctrl+F")
    result.add_argument("--no-silk-transcode", action="store_true", help="保留 SILK 原文件，跳过转 WAV")
    result.add_argument("--config", default=str(ROOT / "config.json"), help="可选的上游配置文件")
    return result


def load_config(path):
    path = Path(path)
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8-sig") as stream:
        return json.load(stream)


def coverage(messages):
    times = [message["timestamp"] for message in messages if message["timestamp"] > 0]
    if not times:
        return "时间未知"
    first = datetime.fromtimestamp(min(times) / 1000).strftime("%Y-%m-%d")
    last = datetime.fromtimestamp(max(times) / 1000).strftime("%Y-%m-%d")
    return first if first == last else first + "-" + last


def main(argv=None):
    argument_parser = parser()
    args = argument_parser.parse_args(argv)
    if args.limit < 0:
        argument_parser.error("--limit 不能为负数")
    if args.since is not None and args.until is not None and args.since >= args.until:
        argument_parser.error("起始时间必须早于终止时间")
    database = None
    try:
        config = load_config(args.config)
        settings = config.get("qce", {})
        requested = args.formats or settings.get("formats", "json,html,txt,excel")
        if isinstance(requested, list):
            requested = ",".join(requested)
        formats = list(dict.fromkeys("excel" if item.strip().lower() == "xlsx" else item.strip().lower() for item in requested.split(",") if item.strip()))
        if not formats or any(item not in {"json", "html", "txt", "excel"} for item in formats):
            argument_parser.error("--formats 仅支持 json,html,txt,excel")
        source = Path(args.src or Path(config.get("work_dir") or ROOT / "work") / "nt_msg_plain.db").expanduser().resolve()
        if not source.is_file():
            raise ValueError("找不到明文数据库；请先完成密钥提取与解密，或使用 --src 指定明文文件")
        with source.open("rb") as stream:
            if stream.read(16) != b"SQLite format 3\0":
                raise ValueError("输入文件不是明文 SQLite；请先解密，不要直接选择 QQ 的加密原库")
        output = Path(args.outdir or settings.get("output_dir") or ROOT / "output-qce").expanduser().resolve()
        roots = list(args.media_root or settings.get("media_roots", []))
        if not roots and config.get("db_path"):
            candidate = Path(config["db_path"]).expanduser().resolve().parent.parent / "nt_data"
            if candidate.is_dir():
                roots.append(str(candidate))
        raw_database_directory = Path(config["db_path"]).expanduser().resolve().parent if config.get("db_path") else None
        if (raw_database_directory and inside(output, raw_database_directory)) or any(inside(output, Path(root).expanduser().resolve()) for root in roots):
            raise ValueError("输出目录必须位于 QQ 原始数据库和媒体缓存目录之外")
        if "excel" in formats and importlib.util.find_spec("openpyxl") is None:
            raise ValueError("Excel 导出需要 openpyxl；请执行 python -m pip install -r requirements.txt")
        node = shutil.which(args.node)
        if "html" in formats and not node:
            raise ValueError("HTML 复用原插件渲染器，需要 Node.js 18+；请安装 Node.js 或用 --node 指定路径")
        if "html" in formats and not (ROOT / "vendor/qce/renderer.mjs").is_file():
            raise ValueError("缺少已构建的 HTML 渲染器；请使用完整发布包，或运行 tools/build-qce-renderer.mjs")
        if node:
            check = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=15)
            if check.returncode or int(check.stdout.lstrip("v").split(".")[0]) < 18:
                raise ValueError("需要 Node.js 18 或更新版本")
        if not roots:
            print("[!] 未找到媒体目录；请用 --media-root 指定 nt_data。缺失媒体将保留失败标记和完整清单。")
        print("[*] 仅处理明文数据库和本地缓存，不连接 QQ 或 NapCat。")
        output.mkdir(parents=True, exist_ok=True)
        library = MediaLibrary(roots, excluded=[output], progress=lambda text: print("[*] " + text))
        database = LocalDatabase(source, args.aux_dir)
        sessions = list(database.sessions(args.only))
        if not sessions:
            raise ValueError("指定的会话条件未匹配到本地记录")
        run_time = datetime.now()
        run_stamp = run_time.strftime("%Y-%m-%d_%H-%M-%S")
        run_id = run_time.strftime("%Y%m%d-%H%M%S-%f")
        manifest = {"version": 1, "profile": "qce", "generatedAt": run_time.astimezone().isoformat(), "sessions": []}
        folders = {}
        zip_output = args.zip or settings.get("zip", False)
        for index, session in enumerate(sessions, 1):
            warning_start = len(database.decoder.warnings)
            print(f"[*] 读取会话 {index}/{len(sessions)}：{session['name']}")
            messages = database.messages(session, args.since, args.until, args.limit)
            if not messages:
                continue
            resolve_quotes(messages, lambda quote: database.lookup_quote(quote, session))
            self_uid, self_uin = config.get("self_uid", ""), str(config.get("self_qq") or "")
            self_senders = {(message["sender"]["uid"], message["sender"].get("uin", "")) for message in messages if message.get("direction") in (1, 2)}
            if len(self_senders) == 1 and not self_uid and not self_uin:
                self_uid, self_uin = next(iter(self_senders))
            chat_info = {"name": session["name"], "type": session["type"], "peerUid": session["id"],
                         "uin": session["peerUin"], "selfUid": self_uid, "selfUin": self_uin,
                         "participantCount": len({message["sender"]["uid"] or message["sender"].get("uin", "") for message in messages})}
            if session["type"] == "group":
                chat_info["groupId"] = session["id"]
            folder = safe_name(session["name"])
            if folder.casefold() in folders and folders[folder.casefold()] != (session["type"], session["id"]):
                folder += "_" + safe_name(session["id"], limit=20)
            folders[folder.casefold()] = (session["type"], session["id"])
            parent = output / folder
            parent.mkdir(exist_ok=True)
            base = f"{safe_name(session['name'])}-[{coverage(messages)}]-{run_stamp}"
            destination = parent / (base + ".zip" if zip_output else base)
            if destination.exists() or (parent / base).exists():
                base += "_" + run_time.strftime("%f")
                destination = parent / (base + ".zip" if zip_output else base)
            with tempfile.TemporaryDirectory(prefix=".qce-stage-", dir=parent) as temporary:
                stage = Path(temporary)
                for directory in DIRECTORIES.values():
                    (stage / "resources" / directory).mkdir(parents=True)
                silk_decoder = ROOT / "tools/decode-silk.mjs" if node and not args.no_silk_transcode else None
                media = MediaExporter(library, stage, node or args.node, silk_decoder)
                report = media.process(messages)
                data = document(messages, chat_info, report)
                data["exportOptions"]["filters"] = {"since": args.since, "untilExclusive": args.until}
                data["exportOptions"]["options"]["enableVirtualScroll"] = not args.no_virtual_scroll
                report["parseWarnings"] = database.decoder.warnings[warning_start:]
                # Existing readers treat root-level *.json as chat documents.
                # Keep the diagnostic sidecar inside resources so ZIPs open directly.
                write_json(stage / "resources" / "media-report.json", report)
                json_path = stage / (base + ".json")
                if "json" in formats or "html" in formats:
                    write_json(json_path, data)
                if "txt" in formats:
                    write_text(stage / (base + ".txt"), data)
                if "excel" in formats:
                    write_excel(stage / (base + ".xlsx"), data)
                if "html" in formats:
                    rendered = subprocess.run([node, str(ROOT / "tools/render-qce.mjs"), str(json_path), str(stage / (base + ".html"))],
                        capture_output=True, text=True, encoding="utf-8", errors="replace")
                    if rendered.returncode:
                        raise ValueError("HTML 渲染失败：" + rendered.stderr[-1000:])
                    if "json" not in formats:
                        json_path.unlink()
                if zip_output:
                    # Keep the archive outside its input tree to avoid including itself.
                    handle, temporary_archive = tempfile.mkstemp(prefix=".qce-archive-", suffix=".zip", dir=parent)
                    os.close(handle)
                    try:
                        archive(stage, temporary_archive)
                        Path(temporary_archive).replace(destination)
                    finally:
                        Path(temporary_archive).unlink(missing_ok=True)
                    if args.keep_folder:
                        shutil.copytree(stage, parent / base)
                else:
                    shutil.copytree(stage, destination)
            result = {"chatInfo": chat_info, "messages": len(messages), "formats": formats, "path": str(destination),
                      "mediaSaved": report["saved"], "mediaFailed": report["failed"], "parseWarnings": len(report["parseWarnings"]),
                      "status": "partial" if report["failed"] or report["parseWarnings"] else "success"}
            manifest["sessions"].append(result)
            print(f"[{'部分完成' if result['status'] == 'partial' else '完成'}] {len(messages)} 条消息；媒体已保存 {report['saved']}/{report['total']}，失败 {report['failed']}：{destination}")
            write_json(output / ("qce-export-index-" + run_id + ".json"), manifest)
        if not manifest["sessions"]:
            raise ValueError("选定时间范围内没有消息")
        print("[RESULT] " + json.dumps({"ok": True, "sessions": len(manifest["sessions"]), "output": str(output),
            "mediaFailed": sum(value["mediaFailed"] for value in manifest["sessions"])}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, sqlite3.DatabaseError, subprocess.SubprocessError) as exc:
        print("[X] " + str(exc), file=sys.stderr)
        return 1
    finally:
        if database:
            database.close()
