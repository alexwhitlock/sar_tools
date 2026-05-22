from db.members_db import get_members_connection


def lookup_tag(tag_serial):
    with get_members_connection() as conn:
        row = conn.execute(
            "SELECT tag_serial, d4h_ref FROM nfc_tags WHERE tag_serial = ?",
            (tag_serial,),
        ).fetchone()
        return dict(row) if row else None


def link_tag(tag_serial, d4h_ref):
    """Associate a tag with a d4h_ref. Returns status dict."""
    with get_members_connection() as conn:
        existing = conn.execute(
            "SELECT d4h_ref FROM nfc_tags WHERE tag_serial = ?",
            (tag_serial,),
        ).fetchone()
        if existing:
            if existing["d4h_ref"] == str(d4h_ref):
                return {"status": "already_this"}
            other = conn.execute(
                "SELECT name FROM members WHERE d4h_ref = ?",
                (existing["d4h_ref"],),
            ).fetchone()
            return {
                "status": "already_other",
                "name": other["name"] if other else existing["d4h_ref"],
            }
        conn.execute(
            "INSERT INTO nfc_tags (tag_serial, d4h_ref) VALUES (?, ?)",
            (tag_serial, str(d4h_ref)),
        )
        return {"status": "linked"}
