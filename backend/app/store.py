import os
import sqlite3
from contextlib import closing
from pathlib import Path


def db_path():
    return Path(os.getenv("KARL_DB_PATH", "karl.db"))


def database():
    connection = sqlite3.connect(db_path(), timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return closing(connection)
