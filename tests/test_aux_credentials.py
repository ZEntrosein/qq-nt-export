"""Regression tests for the upstream key-scan -> auxiliary-decrypt handoff."""
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import ntqq_aux_decrypt as auxiliary


class AuxiliaryCredentialTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "test-output").mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="aux-test-", dir=ROOT / "test-output")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_current_scanner_output_is_accepted_without_legacy_file(self):
        hit = {"key_hex": "AB" * 32, "salt_hex": "CD" * 16, "pid": 1, "salt_match": False}
        source = self.root / "ntqq_key_scan.json"
        source.write_text(json.dumps({"all_hits": [hit, hit, {"key_hex": "invalid"}]}), encoding="utf-8")
        path, entries = auxiliary.load_credentials(str(self.root))
        self.assertEqual(Path(path), source)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["key_hex"], "ab" * 32)
        self.assertFalse(entries[0]["salt_match"])  # Auxiliary salts differ from the main message DB.

    def test_legacy_credential_bundle_remains_supported(self):
        hit = {"key_hex": "01" * 32, "salt_hex": "02" * 16}
        source = self.root / "ntqq_db_key.json"
        source.write_text(json.dumps({"all_nt_db_keys": [hit]}), encoding="utf-8")
        path, entries = auxiliary.load_credentials(str(self.root))
        self.assertEqual(Path(path), source)
        self.assertEqual(entries, [hit])

    @unittest.skipUnless(importlib.util.find_spec("sqlcipher3"), "requires SQLCipher for synthetic encryption")
    def test_scan_results_decrypt_both_synthetic_auxiliary_databases(self):
        from sqlcipher3 import dbapi2 as cipher
        raw = self.root / "nt_db"
        work = self.root / "work"
        raw.mkdir(); work.mkdir()
        hits = []
        for index, name in enumerate(("group_info", "profile_info"), 1):
            plain = self.root / (name + "-source.db")
            connection = sqlite3.connect(plain)
            connection.execute("CREATE TABLE demo (name TEXT)")
            connection.execute("INSERT INTO demo VALUES (?)", (name,))
            connection.commit(); connection.close()
            key, salt = f"{index:02x}" * 32, f"{index + 10:02x}" * 16
            encrypted = self.root / (name + "-cipher.db")
            connection = cipher.connect(plain)
            try:
                connection.execute("ATTACH DATABASE ? AS encrypted KEY ?", (str(encrypted), f"x'{key}{salt}'"))
                connection.execute("PRAGMA encrypted.cipher_page_size=4096")
                connection.execute("SELECT sqlcipher_export('encrypted')")
                connection.execute("DETACH DATABASE encrypted")
            finally:
                connection.close()
            (raw / (name + ".db")).write_bytes(b"\0" * 1024 + encrypted.read_bytes())
            hits.append({"key_hex": key, "salt_hex": salt, "pid": 1, "salt_match": False})
        (work / "ntqq_key_scan.json").write_text(json.dumps({"all_hits": hits}), encoding="utf-8")
        config = {"db_path": str(raw / "nt_msg.db"), "work_dir": str(work)}
        with patch.object(auxiliary, "load_config", return_value=config), patch.object(sys, "argv", ["ntqq_aux_decrypt.py"]):
            self.assertEqual(auxiliary.main(), 0)
        for name in ("group_info", "profile_info"):
            connection = sqlite3.connect((work / (name + "_plain.db")).as_uri() + "?mode=ro", uri=True)
            try:
                self.assertEqual(connection.execute("SELECT name FROM demo").fetchone()[0], name)
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
