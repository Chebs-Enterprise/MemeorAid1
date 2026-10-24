"""
Lightweight, idempotent schema upgrades.

``db.create_all()`` creates *missing tables* but never alters an existing one.
The notification tables were extended with new columns (title, dedupekey,
channels, readat, deletedat), so a database created before this feature keeps
the old ``notifications`` table and every query fails with "no such column".

The project deliberately has no migration framework (this is a prototype that
also runs on SQLite), so this module does the minimum safe thing: inspect the
live schema and add only the columns that are missing, using the dialect's own
type compiler. It never drops or rewrites anything, is safe to run on every
startup, and works on both SQLite and PostgreSQL.

New tables are still handled by ``db.create_all()``; this is only for columns
added to tables that already existed.
"""
from sqlalchemy import inspect, text

# table -> [(column, sqlalchemy_type, server_default_or_None)]
_ADDED_COLUMNS = {
    "notifications": [
        ("title", "String(120)", None),
        ("dedupekey", "String(160)", None),
        ("channels", "String(60)", "'inapp'"),
        ("readat", "DateTime", None),
        ("deletedat", "DateTime", None),
    ],
}


def _type_sql(bind, type_spec):
    """Compile a simple ``String(n)``/``DateTime`` spec for this dialect."""
    from sqlalchemy import DateTime, String

    if type_spec.startswith("String("):
        length = int(type_spec[len("String("):-1])
        return String(length).compile(dialect=bind.dialect)
    if type_spec == "DateTime":
        return DateTime().compile(dialect=bind.dialect)
    raise ValueError(f"Unsupported column type spec: {type_spec}")


def ensure_schema(db):
    """Add any missing notification columns to an existing database.

    Returns the list of ``table.column`` names that were added (useful for a
    startup log, and empty on a fresh database because ``create_all`` already
    created the full table).
    """
    added = []
    bind = db.engine
    inspector = inspect(bind)

    for table, columns in _ADDED_COLUMNS.items():
        if table not in inspector.get_table_names():
            continue  # create_all will make it with every column
        existing = {c["name"] for c in inspector.get_columns(table)}
        for name, type_spec, default in columns:
            if name in existing:
                continue
            clause = f'ALTER TABLE {table} ADD COLUMN {name} {_type_sql(bind, type_spec)}'
            if default is not None:
                clause += f" DEFAULT {default}"
            with bind.begin() as conn:
                conn.execute(text(clause))
            added.append(f"{table}.{name}")

    return added
