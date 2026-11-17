"""Reference parser for unified diffs as written by git and GNU diff.

A single file without dependencies. It is the Python twin of src/refparse.js
and passes the whole corpus; the two are developed independently enough to be
a check on each other.

The one rule that matters: a hunk is read by COUNTING the lines its
``@@ -a,b +c,d @@`` header announces. Inside a hunk a line is content no matter
what it looks like. Everything is bytes; lines end at LF and nowhere else.

    from udiff_reference import parse_diff, resolve_names, status_of

    result = parse_diff(open("change.diff", "rb").read())
    for f in result["files"]:
        names = resolve_names(f)
        print(status_of(f), names["old_path"], names["new_path"], len(f["hunks"]))
"""

from __future__ import annotations

import base64
import re
import zlib
from typing import Optional

__all__ = [
    "parse_diff",
    "resolve_names",
    "infer_prefixes",
    "status_of",
    "unquote_c",
    "apply_hunks",
    "decode_binary_block",
    "to_json",
]

DEV_NULL = b"/dev/null"

HUNK_RE = re.compile(rb"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$", re.S)
INDEX_RE = re.compile(rb"^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d{6}))?$")
COMBINED_INDEX_RE = re.compile(rb"^index ([0-9a-f]+(?:,[0-9a-f]+)+)\.\.([0-9a-f]+)$")
SIMILARITY_RE = re.compile(rb"^(dis)?similarity index (\d+)%$")
MODE_RE = re.compile(rb"^(old mode|new mode|deleted file mode|new file mode) (\d{6})$")
COMBINED_HUNK_RE = re.compile(rb"^(@{3,}) ((?:-\d+(?:,\d+)? )+)\+(\d+)(?:,(\d+))? (@{3,})(.*)$", re.S)

_ESCAPES = {
    ord("a"): 7, ord("b"): 8, ord("t"): 9, ord("n"): 10, ord("v"): 11, ord("f"): 12, ord("r"): 13,
    ord('"'): ord('"'), ord("\\"): ord("\\"),
}


def unquote_c(buf: bytes, pos: int = 0):
    """Parse a C-quoted string starting at buf[pos] (which must be a double quote).

    Returns (value, end) with `end` just past the closing quote, or None if the
    text is not a well-formed quoted string.
    """
    if pos >= len(buf) or buf[pos] != 0x22:
        return None
    out = bytearray()
    i = pos + 1
    n = len(buf)
    while i < n:
        b = buf[i]
        if b == 0x22:
            return bytes(out), i + 1
        if b != 0x5C:
            out.append(b)
            i += 1
            continue
        if i + 1 >= n:
            return None
        e = buf[i + 1]
        if e in _ESCAPES:
            out.append(_ESCAPES[e])
            i += 2
            continue
        # \NNN: exactly three octal digits, the first one 0..3
        if i + 3 < n and 0x30 <= e <= 0x33 and 0x30 <= buf[i + 2] <= 0x37 and 0x30 <= buf[i + 3] <= 0x37:
            out.append(((e - 0x30) << 6) | ((buf[i + 2] - 0x30) << 3) | (buf[i + 3] - 0x30))
            i += 4
            continue
        return None
    return None


def _split_lines(data: bytes):
    """Split at LF only (never at CR, FF, U+2028 ...)."""
    lines = data.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    return lines


def _empty_file(kind: str, start: int) -> dict:
    return {
        "kind": kind,  # 'git' | 'plain' | 'combined'
        "start_line": start,
        "end_line": start,
        "header_old": None,
        "header_new": None,
        "old_name": None,
        "new_name": None,
        "has_file_lines": False,
        "old_is_null": False,
        "new_is_null": False,
        "old_trailer": None,
        "new_trailer": None,
        "rename_from": None,
        "rename_to": None,
        "copy_from": None,
        "copy_to": None,
        "old_mode": None,
        "new_mode": None,
        "is_new": False,
        "is_deleted": False,
        "similarity": None,
        "dissimilarity": None,
        "index_old": None,
        "index_new": None,
        "binary": False,  # False | 'differ' | 'patch'
        "binary_patch": None,
        "hunks": [],
        "parents": 0,
        "combined_path": None,
    }


def _parse_file_line(rest: bytes):
    """The text after '--- ' or '+++ '. Returns (name, is_null, trailer)."""
    if rest[:1] == b'"':
        q = unquote_c(rest, 0)
        if q is not None:
            value, end = q
            after = rest[end:]
            if after == b"" or after[:1] == b"\t":
                return value, False, (after[1:] if after else None)
    tab = rest.find(b"\t")
    name = rest if tab == -1 else rest[:tab]
    trailer = None if tab == -1 else rest[tab + 1:]
    if name == DEV_NULL:
        return None, True, trailer
    return name, False, trailer


def _common_path_suffix(a: bytes, b: bytes) -> int:
    """Length of the longest common suffix that starts with "/" and has something
    after it ("/src/app.js"), or 0. What precedes it is the prefix of each name."""
    k = best = 0
    while k < len(a) and k < len(b) and a[len(a) - 1 - k] == b[len(b) - 1 - k]:
        k += 1
        if a[len(a) - k] == 0x2F and k > 1:
            best = k
    return best


def _same_path_score(a: bytes, b: bytes) -> int:
    """0 if a and b are not the same path behind two prefixes; larger for a longer shared path."""
    if a == b:
        return len(a) + 1
    return _common_path_suffix(a, b)


def _same_modulo_prefix(a: bytes, b: bytes) -> bool:
    return _same_path_score(a, b) > 0


def _parse_git_header_names(rest: bytes):
    """Split the text after 'diff --git ' into its two names, or return None."""
    if rest[:1] == b'"':
        q1 = unquote_c(rest, 0)
        if q1 is None or rest[q1[1]:q1[1] + 1] != b" ":
            return None
        second = rest[q1[1] + 1:]
        if second[:1] == b'"':
            q2 = unquote_c(second, 0)
            if q2 is None or q2[1] != len(second):
                return None
            return q1[0], q2[0]
        return q1[0], second
    if rest[-1:] == b'"':
        i = rest.find(b' "')
        while i != -1:
            q2 = unquote_c(rest, i + 1)
            if q2 is not None and q2[1] == len(rest):
                return rest[:i], q2[0]
            i = rest.find(b' "', i + 1)
    candidates = []
    i = rest.find(b" ")
    while i != -1:
        a, b = rest[:i], rest[i + 1:]
        score = _same_path_score(a, b) if a and b else 0
        if score > 0:
            candidates.append((score, a, b))
        i = rest.find(b" ", i + 1)
    if candidates:
        # Several spaces may qualify; the right one leaves the longest shared path.
        candidates.sort(key=lambda c: -c[0])
        if len(candidates) == 1 or candidates[0][0] > candidates[1][0]:
            return candidates[0][1], candidates[0][2]
        return None
    first = rest.find(b" ")
    if first != -1 and first == rest.rfind(b" ") and 0 < first < len(rest) - 1:
        return rest[:first], rest[first + 1:]
    return None


def _parse_path_value(rest: bytes) -> bytes:
    if rest[:1] == b'"':
        q = unquote_c(rest, 0)
        if q is not None and q[1] == len(rest):
            return q[0]
    return rest


class _Parser:
    def __init__(self, lines):
        self.lines = lines
        self.files = []
        self.errors = []

    def error(self, index, message):
        self.errors.append({"line": index + 1, "message": message})

    def run(self):
        lines = self.lines
        n = len(lines)
        i = 0
        while i < n:
            line = lines[i]
            if line.startswith(b"diff --git "):
                i = self.git_section(i)
            elif line.startswith(b"diff --cc ") or line.startswith(b"diff --combined "):
                i = self.combined_section(i)
            elif (
                line.startswith(b"--- ")
                and i + 2 < n
                and lines[i + 1].startswith(b"+++ ")
                and lines[i + 2].startswith(b"@@ -")
            ):
                i = self.plain_section(i)
            elif line.startswith(b"Binary files ") and line.endswith(b" differ"):
                self.plain_binary_notice(i)
                i += 1
            else:
                i += 1  # prelude: commit headers, statistics, "Only in ...", mail signatures
        return {"files": self.files, "errors": self.errors}

    # ---- git sections ----

    def git_section(self, start):
        lines = self.lines
        n = len(lines)
        f = _empty_file("git", start)
        names = _parse_git_header_names(lines[start][len(b"diff --git "):])
        if names is not None:
            f["header_old"], f["header_new"] = names
        i = start + 1
        while i < n:
            line = lines[i]
            m = MODE_RE.match(line)
            if m:
                what, mode = m.group(1), m.group(2).decode("ascii")
                if what == b"old mode":
                    f["old_mode"] = mode
                elif what == b"new mode":
                    f["new_mode"] = mode
                elif what == b"deleted file mode":
                    f["old_mode"] = mode
                    f["is_deleted"] = True
                else:
                    f["new_mode"] = mode
                    f["is_new"] = True
            elif line.startswith(b"rename from "):
                f["rename_from"] = _parse_path_value(line[12:])
            elif line.startswith(b"rename to "):
                f["rename_to"] = _parse_path_value(line[10:])
            elif line.startswith(b"copy from "):
                f["copy_from"] = _parse_path_value(line[10:])
            elif line.startswith(b"copy to "):
                f["copy_to"] = _parse_path_value(line[8:])
            else:
                m = SIMILARITY_RE.match(line)
                if m:
                    f["dissimilarity" if m.group(1) else "similarity"] = int(m.group(2))
                else:
                    m = INDEX_RE.match(line)
                    if not m:
                        break
                    f["index_old"] = m.group(1).decode("ascii")
                    f["index_new"] = m.group(2).decode("ascii")
                    if m.group(3):
                        mode = m.group(3).decode("ascii")
                        if f["old_mode"] is None:
                            f["old_mode"] = mode
                        if f["new_mode"] is None:
                            f["new_mode"] = mode
            i += 1
        if i < n and lines[i].startswith(b"Binary files ") and lines[i].endswith(b" differ"):
            f["binary"] = "differ"
            i += 1
        elif i < n and lines[i] == b"GIT binary patch":
            i = self.binary_patch(i + 1, f)
        elif i + 1 < n and lines[i].startswith(b"--- ") and lines[i + 1].startswith(b"+++ "):
            self.file_lines(f, i)
            i = self.hunks(i + 2, f)
        f["end_line"] = i
        self.files.append(f)
        return i

    def file_lines(self, f, i):
        f["has_file_lines"] = True
        f["old_name"], f["old_is_null"], f["old_trailer"] = _parse_file_line(self.lines[i][4:])
        f["new_name"], f["new_is_null"], f["new_trailer"] = _parse_file_line(self.lines[i + 1][4:])

    def hunks(self, i, f):
        lines = self.lines
        while i < len(lines) and lines[i].startswith(b"@@ -"):
            nxt = self.hunk(i, f)
            if nxt == i:
                break
            i = nxt
        return i

    def hunk(self, start, f):
        lines = self.lines
        n = len(lines)
        m = HUNK_RE.match(lines[start])
        if not m:
            self.error(start, "malformed hunk header")
            return start
        old_start = int(m.group(1))
        old_lines = 1 if m.group(2) is None else int(m.group(2))
        new_start = int(m.group(3))
        new_lines = 1 if m.group(4) is None else int(m.group(4))
        tail = m.group(5)
        h = {
            "old_start": old_start,
            "old_lines": old_lines,
            "new_start": new_start,
            "new_lines": new_lines,
            "section": tail[1:] if tail[:1] == b" " else tail,
            "lines": [],
        }
        old_left, new_left = old_lines, new_lines
        old_no, new_no = old_start, new_start
        i = start + 1
        while old_left > 0 or new_left > 0:
            if i >= n:
                self.error(i - 1, "hunk is shorter than its header announces")
                break
            line = lines[i]
            c = line[:1] if line else b" "  # an empty line is an empty context line
            if c == b"\\":
                if not h["lines"]:
                    self.error(i, '"\\ No newline" marker without a preceding line')
                    break
                h["lines"][-1]["no_newline"] = True
                i += 1
                continue
            text = line[1:]
            if c == b" ":
                if old_left == 0 or new_left == 0:
                    self.error(i, "context line beyond the range announced in the hunk header")
                    break
                h["lines"].append({"type": " ", "text": text, "no_newline": False, "old_no": old_no, "new_no": new_no})
                old_no += 1
                new_no += 1
                old_left -= 1
                new_left -= 1
            elif c == b"-":
                if old_left == 0:
                    self.error(i, "deleted line beyond the range announced in the hunk header")
                    break
                h["lines"].append({"type": "-", "text": text, "no_newline": False, "old_no": old_no, "new_no": None})
                old_no += 1
                old_left -= 1
            elif c == b"+":
                if new_left == 0:
                    self.error(i, "added line beyond the range announced in the hunk header")
                    break
                h["lines"].append({"type": "+", "text": text, "no_newline": False, "old_no": None, "new_no": new_no})
                new_no += 1
                new_left -= 1
            else:
                self.error(i, "hunk is shorter than its header announces")
                break
            i += 1
        if i < n and lines[i][:1] == b"\\" and h["lines"]:
            h["lines"][-1]["no_newline"] = True
            i += 1
        f["hunks"].append(h)
        return i

    def binary_patch(self, i, f):
        lines = self.lines
        n = len(lines)
        f["binary"] = "patch"
        f["binary_patch"] = []
        while i < n and len(f["binary_patch"]) < 2:
            m = re.match(rb"^(literal|delta) (\d+)$", lines[i])
            if not m:
                break
            block = {"method": m.group(1).decode("ascii"), "size": int(m.group(2)), "data": []}
            i += 1
            while i < n and lines[i]:
                block["data"].append(lines[i])
                i += 1
            if i < n:
                i += 1
            f["binary_patch"].append(block)
        if not f["binary_patch"]:
            self.error(i, "GIT binary patch without data")
        return i

    # ---- plain (GNU diff) ----

    def plain_section(self, start):
        f = _empty_file("plain", start)
        self.file_lines(f, start)
        i = self.hunks(start + 2, f)
        f["end_line"] = i
        self.files.append(f)
        return i

    def plain_binary_notice(self, i):
        line = self.lines[i]
        f = _empty_file("plain", i)
        f["binary"] = "differ"
        f["end_line"] = i + 1
        body = line[len(b"Binary files "):len(line) - len(b" differ")]
        candidates = []
        p = body.find(b" and ")
        while p != -1:
            candidates.append((body[:p], body[p + 5:]))
            p = body.find(b" and ", p + 1)
        pick = None
        if len(candidates) == 1:
            pick = candidates[0]
        elif len(candidates) > 1:
            same = [c for c in candidates if _same_modulo_prefix(c[0], c[1])]
            if len(same) == 1:
                pick = same[0]
        if pick is not None:

            def side(raw):
                if raw[:1] == b'"':
                    q = unquote_c(raw, 0)
                    if q is not None and q[1] == len(raw):
                        return q[0]
                return None if raw == DEV_NULL else raw

            f["old_name"], f["new_name"] = side(pick[0]), side(pick[1])
            f["old_is_null"], f["new_is_null"] = pick[0] == DEV_NULL, pick[1] == DEV_NULL
        self.files.append(f)

    # ---- combined diffs ----

    def combined_section(self, start):
        lines = self.lines
        n = len(lines)
        f = _empty_file("combined", start)
        head = lines[start]
        f["combined_path"] = _parse_path_value(head[head.index(b" ", 5) + 1:])
        i = start + 1
        while i < n:
            line = lines[i]
            m = COMBINED_INDEX_RE.match(line)
            if m:
                f["index_old"] = m.group(1).decode("ascii")
                f["index_new"] = m.group(2).decode("ascii")
                f["parents"] = len(m.group(1).split(b","))
            else:
                m = re.match(rb"^mode (\d{6}(?:,\d{6})+)\.\.(\d{6})$", line)
                if m:
                    f["old_mode"], f["new_mode"] = m.group(1).decode("ascii"), m.group(2).decode("ascii")
                else:
                    m = re.match(rb"^new file mode (\d{6})$", line)
                    if m:
                        f["new_mode"], f["is_new"] = m.group(1).decode("ascii"), True
                    else:
                        m = re.match(rb"^deleted file mode (\d{6}(?:,\d{6})*)$", line)
                        if not m:
                            break
                        f["old_mode"], f["is_deleted"] = m.group(1).decode("ascii"), True
            i += 1
        if i < n and lines[i].startswith(b"Binary files ") and lines[i].endswith(b" differ"):
            f["binary"] = "differ"
            i += 1
        elif i + 1 < n and lines[i].startswith(b"--- ") and lines[i + 1].startswith(b"+++ "):
            self.file_lines(f, i)
            i += 2
            while i < n and lines[i].startswith(b"@@@"):
                nxt = self.combined_hunk(i, f)
                if nxt == i:
                    break
                i = nxt
        f["end_line"] = i
        self.files.append(f)
        return i

    def combined_hunk(self, start, f):
        lines = self.lines
        n = len(lines)
        m = COMBINED_HUNK_RE.match(lines[start])
        if not m or m.group(1) != m.group(5):
            self.error(start, "malformed combined hunk header")
            return start
        n_parents = len(m.group(1)) - 1
        ranges = []
        for part in m.group(2).strip().split(b" "):
            mm = re.match(rb"^-(\d+)(?:,(\d+))?$", part)
            ranges.append({"start": int(mm.group(1)), "lines": 1 if mm.group(2) is None else int(mm.group(2))})
        if len(ranges) != n_parents:
            self.error(start, "combined hunk header does not match its number of parents")
            return start
        if not f["parents"]:
            f["parents"] = n_parents
        tail = m.group(6)
        h = {
            "parents": ranges,
            "new_start": int(m.group(3)),
            "new_lines": 1 if m.group(4) is None else int(m.group(4)),
            "section": tail[1:] if tail[:1] == b" " else tail,
            "lines": [],
        }
        left = [r["lines"] for r in ranges]
        new_left = h["new_lines"]
        i = start + 1
        while new_left > 0 or any(x > 0 for x in left):
            if i >= n:
                self.error(i - 1, "combined hunk is shorter than its header announces")
                break
            line = lines[i]
            if line[:1] == b"\\":
                if h["lines"]:
                    h["lines"][-1]["no_newline"] = True
                i += 1
                continue
            markers = line[:n_parents]
            if len(markers) < n_parents or any(c not in b" +-" for c in markers):
                self.error(i, "combined hunk is shorter than its header announces")
                break
            # A line with "-" in any column is absent from the result; it was present in exactly
            # the parents whose column says "-". Any other line is in the result and in every
            # parent whose column is " ".
            in_result = b"-" not in markers
            for p in range(n_parents):
                col = markers[p:p + 1]
                if (col == b" ") if in_result else (col == b"-"):
                    left[p] -= 1
            if in_result:
                new_left -= 1
            if new_left < 0 or any(x < 0 for x in left):
                self.error(i, "combined hunk has more lines than its header announces")
                break
            h["lines"].append({"markers": markers.decode("ascii"), "text": line[n_parents:], "no_newline": False})
            i += 1
        if i < n and lines[i][:1] == b"\\" and h["lines"]:
            h["lines"][-1]["no_newline"] = True
            i += 1
        f["hunks"].append(h)
        return i


def parse_diff(data) -> dict:
    """Parse a diff given as bytes (preferred) or str (encoded as UTF-8).

    Returns {"files": [...], "errors": [...]}; errors is empty for anything git
    or GNU diff wrote.
    """
    if isinstance(data, str):
        data = data.encode("utf-8")
    return _Parser(_split_lines(bytes(data))).run()


# ---- names ---------------------------------------------------------------------


def infer_prefixes(f: dict):
    """The prefixes a git section was written with, as (src, dst), or None.

    The text does not declare them. They follow from the fact that - renames
    aside - both names on the "diff --git" line are the same path.
    """
    a, b = f["header_old"], f["header_new"]
    for frm, to in ((f["rename_from"], f["rename_to"]), (f["copy_from"], f["copy_to"])):
        if frm is not None and to is not None and a is not None and b is not None:
            if a.endswith(frm) and b.endswith(to):
                return a[:len(a) - len(frm)], b[:len(b) - len(to)]
    if a is None or b is None:
        a, b = f["old_name"], f["new_name"]
    if a is None or b is None:
        return None
    if a == b:
        return b"", b""
    k = _common_path_suffix(a, b)
    if k > 0:
        return a[:len(a) - k + 1], b[:len(b) - k + 1]
    return None


def _strip(name, prefix):
    if name is None or prefix is None:
        return None
    return name[len(prefix):] if name.startswith(prefix) else None


def resolve_names(f: dict, prefixes=None) -> dict:
    """Names of a parsed file section.

    Returns old_name/new_name (as the diff spells them, prefix included) and
    old_path/new_path (inside the repository); the side that does not exist is
    None. Pass `prefixes=(src, dst)` whenever you know how the diff was made.
    """
    if f["kind"] == "combined":
        path = f["combined_path"]
        return {
            "old_name": None if f["old_is_null"] else f["old_name"],
            "new_name": None if f["new_is_null"] else f["new_name"],
            "old_path": None if f["is_new"] else path,
            "new_path": None if f["is_deleted"] else path,
        }
    if f["has_file_lines"]:
        old_name, new_name = f["old_name"], f["new_name"]
    else:
        old_name, new_name = f["header_old"], f["header_new"]
    pre = prefixes if prefixes is not None else infer_prefixes(f)
    absent_old = f["is_new"] or f["old_is_null"]
    absent_new = f["is_deleted"] or f["new_is_null"]
    old_path = f["rename_from"] if f["rename_from"] is not None else f["copy_from"]
    new_path = f["rename_to"] if f["rename_to"] is not None else f["copy_to"]
    if old_path is None and pre is not None:
        old_path = _strip(f["old_name"] if f["old_name"] is not None else f["header_old"], pre[0])
    if new_path is None and pre is not None:
        new_path = _strip(f["new_name"] if f["new_name"] is not None else f["header_new"], pre[1])
    if old_path is None and new_path is not None and f["rename_to"] is None and f["copy_to"] is None:
        old_path = new_path
    if new_path is None and old_path is not None and f["rename_from"] is None and f["copy_from"] is None:
        new_path = old_path
    if f["kind"] == "git" and pre is not None and not f["has_file_lines"]:
        old_name = pre[0] + old_path if old_path is not None else f["header_old"]
        new_name = pre[1] + new_path if new_path is not None else f["header_new"]
    return {
        "old_name": None if absent_old else old_name,
        "new_name": None if absent_new else new_name,
        "old_path": None if absent_old else old_path,
        "new_path": None if absent_new else new_path,
    }


def status_of(f: dict) -> str:
    """One of: added, deleted, renamed, copied, modified."""
    if f["is_new"] or (f["old_is_null"] and not f["new_is_null"]):
        return "added"
    if f["is_deleted"] or (f["new_is_null"] and not f["old_is_null"]):
        return "deleted"
    if f["rename_from"] is not None or f["rename_to"] is not None:
        return "renamed"
    if f["copy_from"] is not None or f["copy_to"] is not None:
        return "copied"
    return "modified"


# ---- applying ------------------------------------------------------------------


def apply_hunks(hunks, old: bytes) -> bytes:
    """Apply parsed hunks to `old`, strictly: every context and deleted line must
    match byte for byte at the announced position. Raises ValueError otherwise."""
    old_lines = old.split(b"\n")
    old_final_newline = old_lines[-1] == b""
    if old_final_newline:
        old_lines.pop()
    out = []
    marks = []
    cursor = 0
    last_from_hunk = False
    for index, h in enumerate(hunks):
        start = h["old_start"] - 1 if h["old_lines"] > 0 else h["old_start"]
        if start < cursor or start > len(old_lines):
            raise ValueError("hunk %d does not fit the old file" % (index + 1))
        out.extend(old_lines[cursor:start])
        marks.extend([False] * (start - cursor))
        cursor = start
        for ln in h["lines"]:
            if ln["type"] != "+":
                if cursor >= len(old_lines) or old_lines[cursor] != ln["text"]:
                    raise ValueError("hunk %d does not match old line %d" % (index + 1, cursor + 1))
                cursor += 1
            if ln["type"] != "-":
                out.append(ln["text"])
                marks.append(ln["no_newline"])
        last_from_hunk = True
    if cursor < len(old_lines):
        last_from_hunk = False
    out.extend(old_lines[cursor:])
    marks.extend([False] * (len(old_lines) - cursor))
    if not out:
        return b""
    lacks_newline = marks[-1] if last_from_hunk else not old_final_newline
    return b"\n".join(out) + (b"" if lacks_newline else b"\n")


_B85 = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~"
_B85_DECODE = {c: i for i, c in enumerate(_B85)}


def _apply_delta(base: bytes, delta: bytes) -> bytes:
    pos = 0

    def varint():
        nonlocal pos
        result = shift = 0
        while True:
            b = delta[pos]
            pos += 1
            result |= (b & 0x7F) << shift
            shift += 7
            if not b & 0x80:
                return result

    base_size = varint()
    result_size = varint()
    if base_size != len(base):
        raise ValueError("delta does not fit its base")
    out = bytearray()
    while pos < len(delta):
        op = delta[pos]
        pos += 1
        if op & 0x80:
            offset = size = 0
            for bit, shift in ((0x01, 0), (0x02, 8), (0x04, 16), (0x08, 24)):
                if op & bit:
                    offset |= delta[pos] << shift
                    pos += 1
            for bit, shift in ((0x10, 0), (0x20, 8), (0x40, 16)):
                if op & bit:
                    size |= delta[pos] << shift
                    pos += 1
            if size == 0:
                size = 0x10000
            out += base[offset:offset + size]
        elif op:
            out += delta[pos:pos + op]
            pos += op
        else:
            raise ValueError("delta opcode 0 is reserved")
    if len(out) != result_size:
        raise ValueError("delta produced the wrong number of bytes")
    return bytes(out)


def decode_binary_block(block: dict, other: bytes = b"") -> bytes:
    """Reconstruct one side of a 'GIT binary patch' block; `other` is the opposite side."""
    deflated = bytearray()
    for line in block["data"]:
        c = line[0]
        length = c - 0x41 + 1 if 0x41 <= c <= 0x5A else c - 0x61 + 27
        chunk = bytearray()
        body = line[1:]
        for i in range(0, len(body), 5):
            acc = 0
            for ch in body[i:i + 5]:
                acc = acc * 85 + _B85_DECODE[ch]
            chunk += acc.to_bytes(4, "big")
        deflated += chunk[:length]
    raw = zlib.decompress(bytes(deflated))
    if len(raw) != block["size"]:
        raise ValueError("binary block has the wrong size")
    return raw if block["method"] == "literal" else _apply_delta(other, raw)


# ---- JSON form (the schema of the corpus) ------------------------------------------


def _jb(value):
    if value is None:
        return None
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError:
        return {"base64": base64.b64encode(value).decode("ascii")}


_TYPE = {" ": "context", "+": "add", "-": "delete"}


def to_json(f: dict, prefixes=None) -> dict:
    """One parsed file section in the JSON form used by the corpus."""
    if f["kind"] == "combined":
        names = resolve_names(f)
        return {
            "combined": True,
            "status": "added" if f["is_new"] else "deleted" if f["is_deleted"] else "modified",
            "path": _jb(f["combined_path"]),
            "old_name": _jb(names["old_name"]),
            "new_name": _jb(names["new_name"]),
            "parents": f["parents"],
            "binary": "notice" if f["binary"] else False,
            "hunks": [
                {
                    "parent_ranges": h["parents"],
                    "new_start": h["new_start"],
                    "new_lines": h["new_lines"],
                    "section": _jb(h["section"]),
                    "lines": [
                        {"markers": ln["markers"], "text": _jb(ln["text"]), **({"no_newline": True} if ln["no_newline"] else {})}
                        for ln in h["lines"]
                    ],
                }
                for h in f["hunks"]
            ],
        }
    names = resolve_names(f, prefixes)
    additions = sum(1 for h in f["hunks"] for ln in h["lines"] if ln["type"] == "+")
    deletions = sum(1 for h in f["hunks"] for ln in h["lines"] if ln["type"] == "-")
    return {
        # A bare "Binary files a/x and b/x differ" line of GNU diff is not a patch for that file;
        # a parser may report it as a file or pass over it.
        **({"optional": True} if f["kind"] == "plain" and f["binary"] else {}),
        "status": status_of(f) if f["kind"] == "git" else None,
        "old_name": _jb(names["old_name"]),
        "new_name": _jb(names["new_name"]),
        "old_path": _jb(names["old_path"]),
        "new_path": _jb(names["new_path"]),
        "old_mode": f["old_mode"],
        "new_mode": f["new_mode"],
        "similarity": f["similarity"],
        "binary": "notice" if f["binary"] == "differ" else "patch" if f["binary"] == "patch" else False,
        "additions": None if f["binary"] else additions,
        "deletions": None if f["binary"] else deletions,
        "hunks": [
            {
                "old_start": h["old_start"],
                "old_lines": h["old_lines"],
                "new_start": h["new_start"],
                "new_lines": h["new_lines"],
                "section": _jb(h["section"]),
                "lines": [
                    {
                        "type": _TYPE[ln["type"]],
                        "text": _jb(ln["text"]),
                        "old_no": ln["old_no"],
                        "new_no": ln["new_no"],
                        **({"no_newline": True} if ln["no_newline"] else {}),
                    }
                    for ln in h["lines"]
                ],
            }
            for h in f["hunks"]
        ],
    }
