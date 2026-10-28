"""Synthetic QQNT protobuf/SQLite fixtures; no account data or credentials."""
import base64
import hashlib
import io
import sqlite3
import wave
from pathlib import Path

START = 1792368000
LARGE_ID = 9007199254740993123
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg1sAAAAASUVORK5CYII=")


def varint(number):
    result = bytearray()
    while number > 127:
        result.append((number & 127) | 128)
        number >>= 7
    result.append(number)
    return bytes(result)


def field(key, value):
    if isinstance(value, int):
        return varint(key << 3) + varint(value)
    value = value.encode() if isinstance(value, str) else value
    return varint(key << 3 | 2) + varint(len(value)) + value


def element(kind, **values):
    return field(45002, kind) + b"".join(field(int(key), value) for key, value in values.items())


def text(value):
    return element(1, **{"45101": value})


def body(*elements):
    return b"".join(field(40800, value) for value in elements)


def cached(msg_id, *elements, nested=(), timestamp=START + 10):
    return (field(40001, msg_id) + field(40003, msg_id % 10000) + field(40050, timestamp)
            + field(40020, "u_demo") + field(40033, 123456789) + field(40093, "演示成员")
            + b"".join(field(40800, value) for value in elements)
            + b"".join(field(40900, value) for value in nested))


def create(root, video=None):
    root = Path(root)
    media = root / "nt_data"
    for folder in ("chatpic", "video", "Ptt", "files"):
        (media / folder).mkdir(parents=True, exist_ok=True)
    image = media / "chatpic" / "演示图片.png"
    image.write_bytes(PNG)
    movie = media / "video" / "演示视频.mp4"
    movie.write_bytes(video if video is not None else b"\x00\x00\x00\x18ftypmp42" + b"synthetic-video-fixture")
    wav = io.BytesIO()
    with wave.open(wav, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b"\0\0" * 800)
    voice = media / "Ptt" / "演示语音.wav"
    voice.write_bytes(wav.getvalue())
    attachment = media / "files" / "附件.txt"
    attachment.write_text("附件原始内容", encoding="utf-8")

    def resource(kind, path):
        data = path.read_bytes()
        return element(kind, **{"45402": path.name, "45403": str(path), "45405": len(data),
                                "45406": hashlib.md5(data).digest(), **({"45411": 1, "45412": 1} if kind == 2 else {})})
    pic, vid = resource(2, image), resource(5, movie)
    missing = element(2, **{"45402": "缺失图片.jpg", "45406": b"\x11" * 16})
    quote = element(7, **{"47401": LARGE_ID, "47402": 10, "47403": 123456789,
                          "47404": START, "47416": 8888888888888888, "47413": "原始图片"})
    snapshot_quote = element(7, **{"47401": 79999999, "47403": 123456789, "47404": START - 100,
                                   "47423": vid, "47413": "被引用的视频"})
    forward = element(16, **{"48601": "synthetic-resid", "48602": '<msg><item><title>聊天记录</title></item><summary>演示转发</summary></msg>'})
    deepest = cached(503, text("深层文字 @所有人"), vid, resource(4, voice), missing)
    inner = cached(502, forward, nested=[deepest])
    outer = cached(501, text("外层图片"), pic)
    cache = field(40900, outer) + field(40900, inner)
    source = root / "nt_msg_plain.db"
    connection = sqlite3.connect(source)
    names = ["40001", "40003", "40011", "40012", "40013", "40020", "40021", "40027", "40030", "40033", "40050", "40090", "40093", "40800", "40900"]
    sql_columns = ",".join('"' + name + '" ' + ("BLOB" if name in ("40800", "40900") else "") for name in names)
    for table in ("group_msg_table", "c2c_msg_table"):
        connection.execute(f'CREATE TABLE "{table}" ({sql_columns})')

    def insert(mid, timestamp, elements, group="111111", cached_blob=None, seq=None, table="group_msg_table"):
        values = [mid, seq or mid % 10000, 2, 0, 0, "u_demo", group, group if table.startswith("group") else None,
                  group if table.startswith("group") else "234567890", 123456789, timestamp, "演示名片", "演示成员", body(*elements), cached_blob]
        connection.execute(f'INSERT INTO "{table}" VALUES (' + ",".join("?" for _ in names) + ")", values)

    insert(LARGE_ID, START, [text("第一条图片 @所有人"), pic], seq=10)
    insert(1002, START + 1, [quote, text("引用图片")])
    insert(1003, START + 2, [vid])
    insert(1004, START + 3, [forward], cached_blob=cache)
    insert(1005, START + 4, [snapshot_quote, text("聊天记录后的消息：仅保留引用的视频消息")])
    insert(1006, START + 5, [missing])
    insert(1007, START + 6, [resource(3, attachment)])
    insert(1008, START + 7, [element(8, **{"48214": "演示成员拍了拍 @其他成员"})])
    insert(2001, START, [text("另一群的独立消息")], group="222222")
    insert(3001, START, [text("私聊消息")], group="u_peer", table="c2c_msg_table")
    connection.commit()
    connection.close()
    auxiliary = sqlite3.connect(root / "group_info_plain.db")
    auxiliary.executescript('CREATE TABLE group_list ("60001", "60007"); CREATE TABLE group_member3 ("60001", "1000", "64003", "20002");')
    auxiliary.executemany('INSERT INTO group_list VALUES (?,?)', [("111111", "演示群:一"), ("222222", "演示群:二")])
    auxiliary.execute('INSERT INTO group_member3 VALUES (?,?,?,?)', ("111111", "u_demo", "演示名片", "演示成员"))
    auxiliary.commit()
    auxiliary.close()
    return {"source": source, "media": media, "image": image, "video": movie, "voice": voice, "attachment": attachment}
