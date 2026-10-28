"""Decode the documented QQNT message wire format without loading QQ or its DLLs.

Field references: QQBackup/QQDecrypt and Tealina28/QQNT_Export/element.proto.
Unknown elements retain their bytes; nested messages and quote snapshots keep scope.
"""
from __future__ import annotations

import copy
import html
import json
import re
from datetime import datetime, timezone
from xml.etree import ElementTree

MAX_DEPTH = 32
MAX_FIELDS = 100_000


def identifier(value):
    if value is None or value == "":
        return ""
    if isinstance(value, int) and value < 0:
        value &= (1 << 64) - 1
    result = str(value)
    return result if result != "0" else ""


def millis(value):
    try:
        number = int(value or 0)
        return number * 1000 if 0 < number < 100_000_000_000 else max(0, number)
    except (ValueError, TypeError):
        return 0


def iso_time(value):
    try:
        return datetime.fromtimestamp(millis(value) / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError, OSError):
        return "1970-01-01T00:00:00.000Z"


def fields(blob):
    """Strictly bound every protobuf field; never accept a truncated byte slice."""
    blob = bytes(blob or b"")
    cursor, result, count = 0, {}, 0

    def varint():
        nonlocal cursor
        number = 0
        for shift in range(0, 70, 7):
            if cursor >= len(blob):
                raise ValueError("truncated varint")
            byte = blob[cursor]
            cursor += 1
            number |= (byte & 127) << shift
            if byte < 128:
                return number
        raise ValueError("varint exceeds 10 bytes")

    while cursor < len(blob):
        tag = varint()
        number, wire = tag >> 3, tag & 7
        if not number or count >= MAX_FIELDS:
            raise ValueError("invalid/excessive protobuf fields")
        count += 1
        if wire == 0:
            value = varint()
        elif wire in (1, 2, 5):
            length = varint() if wire == 2 else (8 if wire == 1 else 4)
            if length > len(blob) - cursor:
                raise ValueError("truncated protobuf field")
            value = blob[cursor:cursor + length]
            cursor += length
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        result.setdefault(number, []).append((wire, value))
    return result


def number(data, key, default=0):
    return next((value for wire, value in data.get(key, []) if wire == 0), default)


def binaries(data, key):
    return [value for wire, value in data.get(key, []) if wire == 2]


def string(data, key, default=""):
    values = binaries(data, key)
    return values[0].decode("utf-8", "replace") if values else default


def digest(data, *keys):
    for key in keys:
        for value in binaries(data, key):
            if len(value) == 16:
                return value.hex()
            text = value.decode("ascii", "ignore").strip()
            if re.fullmatch(r"[a-fA-F0-9]{32}", text):
                return text.lower()
    return ""


def plain_text(elements):
    labels = {"image": "[图片]", "video": "[视频]", "audio": "[语音]", "file": "[文件]", "forward": "[聊天记录]"}
    output = []
    for element in elements:
        kind, data = element["type"], element["data"]
        if kind in ("text", "system"):
            output.append(str(data.get("text", "")))
        elif kind == "reply":
            continue
        elif kind in labels:
            output.append(labels[kind] + (" " + data["filename"] if data.get("filename") else ""))
        elif kind == "face":
            output.append(data.get("name") or f"[表情{data.get('faceIndex', '')}]")
        elif kind == "json":
            output.append(data.get("text") or data.get("title") or "[卡片消息]")
        else:
            output.append(data.get("text") or "[未识别消息]")
    return "".join(output)


def content(elements):
    text = plain_text(elements)
    return {"text": text, "html": html.escape(text), "elements": elements, "resources": [], "mentions": []}


def preview_elements(elements):
    result = []
    for element in elements:
        kind, data = element["type"], element["data"]
        if kind == "reply":
            continue
        if kind == "forward":
            result.append({"type": "forward", "text": "[聊天记录]", "title": data.get("title", "聊天记录"),
                           "messageCount": data.get("messageCount", 0), "resId": data.get("resId", "")})
        else:
            result.append({"type": kind, "text": data.get("text", ""), **copy.deepcopy(data),
                           "fileName": data.get("filename", "")})
    return result


class Decoder:
    def __init__(self):
        self.warnings = []

    def error(self, text, raw=b""):
        self.warnings.append(text)
        return {"type": "unknown", "data": {"text": f"[消息解析未完成：{text}]", "rawHex": bytes(raw).hex()}}

    def body(self, raw, depth=0, direct=False):
        if depth > MAX_DEPTH:
            return [self.error("嵌套层级超过 32 层", raw)]
        try:
            root = fields(raw)
            items = [raw] if direct or 45002 in root else binaries(root, 40800)
            if not items and raw:
                return [self.error("未找到 40800 消息元素", raw)]
            return [self.element(item, depth + 1) for item in items]
        except (ValueError, TypeError) as exc:
            return [self.error(str(exc), raw)]

    def element(self, raw, depth):
        try:
            data = fields(raw)
            kind = number(data, 45002)
            text = string(data, 45101)
            if kind == 1:
                return {"type": "text", "data": {"text": text}}
            if kind in (2, 3, 4, 5):
                media_type = {2: "image", 3: "file", 4: "audio", 5: "video"}[kind]
                return {"type": media_type, "data": {
                    "filename": string(data, 45402), "size": number(data, 45405),
                    "md5": digest(data, 45406, 45407, 45424),
                    "sourcePaths": [value for value in (string(data, 45812), string(data, 45403), string(data, 46403), string(data, 45814)) if value],
                    "url": string(data, 45804) or string(data, 45803) or string(data, 45802),
                    "width": number(data, 45411) or number(data, 45413) or number(data, 46413),
                    "height": number(data, 45412) or number(data, 45414) or number(data, 46414),
                    "duration": number(data, 45906) if kind == 4 else number(data, 45410),
                    "transcript": string(data, 45923),
                }}
            if kind == 6:
                return {"type": "face", "data": {"faceIndex": number(data, 47601), "name": string(data, 47602)}}
            if kind == 7:
                previews = []
                for item in binaries(data, 47423):
                    previews.extend(self.body(item, depth, direct=True))
                original_id = identifier(number(data, 47401))
                seq = identifier(number(data, 47402))
                return {"type": "reply", "data": {
                    "messageId": original_id, "referencedMessageId": "", "sourceAvailable": False,
                    "reference": {"version": 1, "messageId": original_id, "serverSeq": seq, "clientSeq": "",
                                  "snapshotId": identifier(number(data, 47416)), "senderUid": string(data, 40020),
                                  "senderUin": identifier(number(data, 47403)), "timestamp": identifier(number(data, 47404))},
                    "senderUin": identifier(number(data, 47403)), "senderUid": string(data, 40020),
                    "senderName": "", "timestamp": number(data, 47404),
                    "content": string(data, 47413) or plain_text(previews), "previewElements": preview_elements(previews),
                }}
            if kind == 8:
                parts = [string(data, key) for key in (48214, 48271, 47713, 48504, 48507)]
                text = " ".join(part for part in parts if part) or text or "[系统消息]"
                return {"type": "system", "data": {"text": text}}
            if kind == 16:
                card = {"title": "聊天记录", "resId": string(data, 48601), "messages": [], "messageCount": 0}
                xml = string(data, 48602)
                if xml:
                    try:
                        root = ElementTree.fromstring(xml)
                        card["title"] = root.findtext(".//item/title") or root.findtext(".//title") or "聊天记录"
                        card["summary"] = root.findtext(".//summary") or ""
                    except ElementTree.ParseError:
                        card["summary"] = "合并聊天记录"
                    card["rawXml"] = xml
                return {"type": "forward", "data": card}
            if kind == 10:
                raw_json = string(data, 47901)
                try:
                    card = json.loads(raw_json)
                except (ValueError, TypeError):
                    card = {}
                if card.get("app") in ("com.tencent.multimsg", "com.tencent.multimsg_new"):
                    detail = next(iter(card.get("meta", {}).values()), {})
                    return {"type": "forward", "data": {"title": detail.get("title", "聊天记录"),
                        "summary": detail.get("summary", ""), "resId": detail.get("resid", ""), "messages": [],
                        "messageCount": 0, "rawJson": raw_json}}
                return {"type": "json", "data": {"content": raw_json, "text": card.get("prompt", "[卡片消息]")}}
            if kind == 11:
                return {"type": "image", "data": {"filename": "", "md5": digest(data, 80903), "size": 0,
                    "description": string(data, 80900), "sourcePaths": [], "sticker": True}}
            if kind == 9:
                details = binaries(data, 48403)
                wallet = fields(details[0]) if details else {}
                return {"type": "text", "data": {"text": "[红包／转账] " + (string(wallet, 48443) or string(wallet, 48444) or text)}}
            if text or string(data, 48701) or string(data, 48705):
                return {"type": "text", "data": {"text": text or string(data, 48701) or string(data, 48705)}}
            return {"type": "unknown", "data": {"text": f"[未识别消息类型 {kind}]", "elementType": kind, "rawHex": raw.hex()}}
        except (ValueError, TypeError, AttributeError) as exc:
            return self.error(str(exc), raw)

    def cached(self, blob, scope, depth=0):
        if not blob:
            return []
        if depth > MAX_DEPTH:
            self.warnings.append("合并记录缓存超过 32 层")
            return []
        try:
            root = fields(blob)
            if 40001 in root or 40050 in root or 40800 in root:
                return [self.record(root, scope, depth)]
            return [self.record(fields(item), f"{scope}/{index}", depth) for index, item in enumerate(binaries(root, 40900))]
        except (ValueError, TypeError) as exc:
            self.warnings.append(f"合并／引用缓存解析失败：{exc}")
            return []

    def record(self, data, scope, depth):
        elements = [self.element(item, depth + 1) for item in binaries(data, 40800)]
        nested = []
        for index, item in enumerate(binaries(data, 40900)):
            nested.extend(self.cached(item, f"{scope}/{index}", depth + 1))
        msg_id = identifier(number(data, 40001))
        message = {"id": f"forward:{scope}:{msg_id or 'snapshot'}", "messageId": msg_id,
            "seq": identifier(number(data, 40003)), "timestamp": millis(number(data, 40050)),
            "time": iso_time(number(data, 40050)),
            "sender": {"uid": string(data, 40020), "uin": identifier(number(data, 40033)),
                       "name": string(data, 40093) or identifier(number(data, 40033)) or string(data, 40020) or "未知用户"},
            "content": content(elements)}
        self.attach_cache(message, nested)
        return message

    def attach_cache(self, message, cached):
        elements = message["content"]["elements"]
        quotes = [element["data"] for element in elements if element["type"] == "reply"]
        consumed = set()
        for quote in quotes:
            matches = [item for item in cached if reference_matches(quote, item)]
            if len(matches) == 1:
                source = matches[0]
                fill_quote(quote, source, available=False)
                consumed.add(id(source))
        forwards = [element["data"] for element in elements if element["type"] == "forward"]
        remaining = [item for item in cached if id(item) not in consumed]
        if len(forwards) == 1:
            forwards[0]["messages"] = remaining
            forwards[0]["messageCount"] = len(remaining)
            forwards[0]["availability"] = "cached" if remaining else "not-cached"
        elif len(forwards) > 1 and remaining:
            self.warnings.append(f"{message['id']}：多个转发卡片无法唯一分配缓存，已保留原缓存")
            message["cachedMessages"] = remaining
        message["content"]["text"] = plain_text(elements)


def reference_matches(quote, message):
    reference = quote.get("reference", {})
    mid, seq = reference.get("messageId"), reference.get("serverSeq")
    identity = identifier(message.get("messageId") or message.get("id"))
    if mid:
        matched = mid == identity
    elif seq:
        matched = seq == message.get("seq")
    else:
        return False
    sender = message.get("sender", {})
    for field, target in (("senderUid", "uid"), ("senderUin", "uin")):
        if reference.get(field) and sender.get(target) and reference[field] != sender[target]:
            return False
    expected_time = millis(reference.get("timestamp"))
    actual_time = millis(message.get("timestamp"))
    if expected_time and actual_time and expected_time != actual_time:
        return False
    return matched


def fill_quote(quote, source, available):
    quote.update({"senderName": source["sender"]["name"], "senderUin": source["sender"].get("uin", ""),
        "timestamp": source.get("timestamp", 0) / 1000, "content": source["content"]["text"],
        "previewElements": preview_elements(source["content"]["elements"]), "sourceAvailable": available,
        "referencedMessageId": source["id"] if available else ""})


def resolve_quotes(messages, lookup=None):
    """Only jump within the current scope; cached snapshots never impersonate IDs."""
    by_id, by_seq = {}, {}
    for message in messages:
        for key, index in ((identifier(message.get("messageId") or message.get("id")), by_id), (message.get("seq"), by_seq)):
            if key:
                index.setdefault(key, []).append(message)
    for message in messages:
        for element in message["content"]["elements"]:
            data = element["data"]
            if element["type"] == "forward":
                resolve_quotes(data.get("messages", []))
            elif element["type"] == "reply":
                reference = data.get("reference", {})
                matches = by_id.get(reference.get("messageId"), []) if reference.get("messageId") else by_seq.get(reference.get("serverSeq"), [])
                matches = [candidate for candidate in matches if candidate is not message and reference_matches(data, candidate)]
                if len(matches) == 1:
                    fill_quote(data, matches[0], True)
                elif not matches and lookup:
                    source = lookup(data)
                    if source:
                        fill_quote(data, source, False)
