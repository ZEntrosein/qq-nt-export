"""Schema-tolerant, strictly read-only access to already decrypted databases."""
from __future__ import annotations

import hashlib
import sqlite3
from contextlib import closing
from pathlib import Path

from .protocol import Decoder, content, identifier, iso_time, millis, reference_matches


def connect(path):
    connection = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def columns(connection, table):
    return {str(row[1]) for row in connection.execute(f'PRAGMA table_info("{table}")')}


def scalar(row, key, default=""):
    value = row.get(key)
    return default if value is None else value


class LocalDatabase:
    def __init__(self, source, aux_dir=None):
        self.path = Path(source).resolve()
        self.connection = connect(self.path)
        self.decoder = Decoder()
        self.tables = {row[0] for row in self.connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.schemas = {table: columns(self.connection, table) for table in ("c2c_msg_table", "group_msg_table") if table in self.tables}
        if not self.schemas:
            raise ValueError("未找到私聊／群聊消息表；请选择已解密的 nt_msg 数据库")
        self.names, self.groups, self.cards = {}, {}, {}
        self._load_aux(Path(aux_dir).resolve() if aux_dir else self.path.parent)

    def close(self):
        self.connection.close()

    def _load_aux(self, root):
        for kind in ("group_info", "profile_info"):
            source = next((path for path in (root / f"{kind}_plain.db", root / f"{kind}.db") if path.is_file()), None)
            if source is None:
                continue
            try:
                with closing(connect(source)) as db:
                    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    if kind == "profile_info" and "profile_info_v6" in tables:
                        for raw in db.execute('SELECT * FROM "profile_info_v6"'):
                            row = dict(raw)
                            uid = str(scalar(row, "1000"))
                            name = str(scalar(row, "20002"))
                            if uid and name:
                                self.names[uid] = name
                    if kind == "group_info":
                        for table in ("group_list", "group_detail_info_ver1"):
                            if table in tables:
                                for raw in db.execute(f'SELECT * FROM "{table}"'):
                                    row = dict(raw)
                                    group_id = str(scalar(row, "60001"))
                                    name = str(scalar(row, "60007") or scalar(row, "60002"))
                                    if group_id and name:
                                        self.groups[group_id] = name
                        if "group_member3" in tables:
                            for raw in db.execute('SELECT * FROM "group_member3"'):
                                row = dict(raw)
                                uid, group_id = str(scalar(row, "1000")), str(scalar(row, "60001"))
                                name = str(scalar(row, "64003") or scalar(row, "20002"))
                                if uid and group_id and name:
                                    self.cards[(group_id, uid)] = name
            except sqlite3.DatabaseError as exc:
                self.decoder.warnings.append(f"辅助库 {kind} 读取失败：{exc}")

    def session_expression(self, table):
        schema = self.schemas[table]
        keys = ("40027", "40021", "40030") if table == "group_msg_table" else ("40021", "40030")
        parts = [f'''NULLIF(NULLIF(CAST("{key}" AS TEXT), ''), '0')''' for key in keys if key in schema]
        if not parts:
            raise ValueError(f"{table} 缺少会话标识字段")
        return "COALESCE(" + ", ".join(parts + ["'unknown'"]) + ")"

    def sessions(self, only=None):
        only = {str(value) for value in (only or [])}
        for table in self.schemas:
            expression = self.session_expression(table)
            for raw in self.connection.execute(f'SELECT {expression} AS session_id, COUNT(*) AS total FROM "{table}" GROUP BY {expression}'):
                session_id = str(raw["session_id"])
                schema = self.schemas[table]
                peer_qq = ""
                if table == "c2c_msg_table" and "40030" in schema:
                    row = self.connection.execute(f'SELECT "40030" FROM "{table}" WHERE {expression}=? AND "40030" IS NOT NULL LIMIT 1', (session_id,)).fetchone()
                    peer_qq = str(row[0] or "") if row else ""
                if only and session_id not in only and peer_qq not in only:
                    continue
                group = table == "group_msg_table"
                yield {"table": table, "id": session_id, "type": "group" if group else "private",
                       "name": (self.groups.get(session_id) if group else self.names.get(session_id)) or peer_qq or session_id,
                       "peerUin": session_id if group else peer_qq, "total": raw["total"]}

    def messages(self, session, since=None, until=None, limit=0):
        table = session["table"]
        schema = self.schemas[table]
        expression = self.session_expression(table)
        where, params = [f"{expression}=?"], [session["id"]]
        for value, operator in ((since, ">="), (until, "<")):
            if value is not None:
                if "40050" not in schema:
                    raise ValueError("数据库缺少时间字段，无法按时间筛选")
                where.append(f'"40050" {operator} ?')
                params.append(value)
        order = [f'"{key}"' for key in ("40050", "40003", "40001") if key in schema]
        query = f'SELECT rowid AS __rowid, * FROM "{table}" WHERE ' + " AND ".join(where)
        if order:
            query += " ORDER BY " + ", ".join(order)
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        return [self.message(dict(row), session) for row in self.connection.execute(query, params)]

    def message(self, row, session):
        elements = self.decoder.body(scalar(row, "40800", b""))
        uid, uin = str(scalar(row, "40020")), identifier(row.get("40033"))
        name = str(scalar(row, "40090") or scalar(row, "40093") or self.cards.get((session["id"], uid)) or self.names.get(uid) or uin or uid or "未知用户")
        msg_id = identifier(row.get("40001"))
        if not msg_id:
            material = str(row.get("__rowid", "")) + repr(row.get("40800", b""))
            msg_id = "db:" + hashlib.sha256((session["id"] + material).encode()).hexdigest()[:24]
        system = bool(elements) and all(element["type"] == "system" for element in elements)
        if not elements:
            elements = [{"type": "system" if row.get("40011") == 17 else "text", "data": {"text": "[系统消息]" if row.get("40011") == 17 else "[本地未保存消息正文]"}}]
        message = {"id": msg_id, "seq": identifier(row.get("40003")), "timestamp": millis(row.get("40050")),
            "time": iso_time(row.get("40050")), "sender": {"uid": uid, "uin": uin, "name": name,
            "nickname": str(scalar(row, "40093")), "groupCard": str(scalar(row, "40090"))},
            "type": "system" if system else "mixed", "system": system, "recalled": False,
            "content": content(elements), "direction": row.get("40013", 0), "databaseMsgType": row.get("40011", 0)}
        self.decoder.attach_cache(message, self.decoder.cached(row.get("40900"), msg_id))
        kinds = {element["type"] for element in elements if element["type"] != "reply"}
        if not system and len(kinds) == 1:
            message["type"] = next(iter(kinds))
        return message

    def lookup_quote(self, quote, session):
        reference = quote.get("reference", {})
        key, value = ("40001", reference.get("messageId")) if reference.get("messageId") else ("40003", reference.get("serverSeq"))
        table = session["table"]
        if not value or key not in self.schemas[table]:
            return None
        # Some SQLite builds store unsigned message IDs as signed 64-bit integers.
        try:
            numeric = int(value)
            sql_value = numeric - (1 << 64) if numeric >= (1 << 63) else numeric
        except (ValueError, TypeError):
            sql_value = value
        query = f'SELECT rowid AS __rowid, * FROM "{table}" WHERE {self.session_expression(table)}=? AND "{key}"=? LIMIT 3'
        candidates = [self.message(dict(row), session) for row in self.connection.execute(query, (session["id"], sql_value))]
        matches = [message for message in candidates if reference_matches(quote, message)]
        return matches[0] if len(matches) == 1 else None
