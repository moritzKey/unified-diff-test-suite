//! The libraries under test. An adapter translates a library's own result
//! into the shape the harness compares (adapters/PROTOCOL.md). It does not
//! repair anything: a wrong value is passed on as it is.
//!
//! The versions are pinned in Cargo.toml and repeated here for the report.

use crate::{devnull, jb, Adapter, Applier, Files};
use serde_json::{json, Map, Value};

pub fn adapter(name: &str) -> Option<Adapter> {
    match name {
        "diffy" => Some(Adapter { meta: diffy_meta(), parse: diffy_parse_git }),
        "diffy-unidiff" => Some(Adapter { meta: diffy_unidiff_meta(), parse: diffy_parse_plain }),
        "patch" => Some(Adapter { meta: patch_meta(), parse: patch_parse }),
        "gitpatch" => Some(Adapter { meta: gitpatch_meta(), parse: gitpatch_parse }),
        "unidiff" => Some(Adapter { meta: unidiff_meta(), parse: unidiff_parse }),
        _ => None,
    }
}

pub fn applier(name: &str) -> Option<Applier> {
    match name {
        "diffy" => Some(Applier { meta: diffy_apply_meta(), apply_file: diffy_apply }),
        _ => None,
    }
}

// ---- diffy ---------------------------------------------------------------------

const DIFFY: &str = "0.5.2";

fn diffy_meta() -> Value {
    json!({
        "name": "diffy",
        "package": "diffy",
        "version": DIFFY,
        "homepage": "https://github.com/bmwill/diffy",
        "api": "PatchSet::parse_bytes(input, ParseOptions::gitdiff())",
        "input": "bytes",
        // Names are given as written, except for renames and copies, which
        // come from the "rename from"/"copy from" lines and have no prefix.
        "pathStyle": "raw",
        "statuses": ["added", "deleted", "renamed", "copied"],
        "noNewline": "line",
        "scope": ["git", "git-wrapped", "git-config"],
        "notes": "ParseOptions::gitdiff(): git's extended format, mail headers and signatures skipped, binary files detected. It needs the \"diff --git\" line; for diffs without one there is ParseOptions::unidiff(), tested separately."
    })
}

fn diffy_unidiff_meta() -> Value {
    json!({
        "name": "diffy (unidiff mode)",
        "package": "diffy",
        "version": DIFFY,
        "homepage": "https://github.com/bmwill/diffy",
        "api": "PatchSet::parse_bytes(input, ParseOptions::unidiff())",
        "input": "bytes",
        "pathStyle": "raw",
        "statuses": ["added", "deleted"],
        "noNewline": "line",
        "scope": ["gnu"],
        "notes": "ParseOptions::unidiff(): \"---\"/\"+++\" headers and hunks, as GNU diff writes them."
    })
}

fn diffy_mode(mode: Option<&diffy::patch_set::FileMode>) -> Value {
    use diffy::patch_set::FileMode;
    match mode {
        None => Value::Null,
        Some(FileMode::Regular) => "100644".into(),
        Some(FileMode::Executable) => "100755".into(),
        Some(FileMode::Symlink) => "120000".into(),
        Some(FileMode::Gitlink) => "160000".into(),
    }
}

fn diffy_hunks(patch: &diffy::Patch<'_, [u8]>) -> Vec<Value> {
    use diffy::Line;
    patch
        .hunks()
        .iter()
        .map(|h| {
            let lines: Vec<Value> = h
                .lines()
                .iter()
                .map(|line| {
                    let (kind, text): (&str, &[u8]) = match line {
                        Line::Context(t) => ("context", t),
                        Line::Delete(t) => ("delete", t),
                        Line::Insert(t) => ("add", t),
                    };
                    // A line keeps its "\n"; diffy leaves it off the last line of a
                    // file that does not end with one.
                    match text.strip_suffix(b"\n") {
                        Some(body) => json!({ "type": kind, "text": jb(body) }),
                        None => json!({ "type": kind, "text": jb(text), "no_newline": true }),
                    }
                })
                .collect();
            let mut hunk = Map::new();
            hunk.insert("old_start".into(), h.old_range().start().into());
            hunk.insert("old_lines".into(), h.old_range().len().into());
            hunk.insert("new_start".into(), h.new_range().start().into());
            hunk.insert("new_lines".into(), h.new_range().len().into());
            if let Some(context) = h.function_context() {
                // The text after "@@", with the line end diffy keeps on it.
                hunk.insert("section".into(), jb(context.strip_suffix(b"\n").unwrap_or(context)));
            }
            hunk.insert("lines".into(), lines.into());
            Value::Object(hunk)
        })
        .collect()
}

fn diffy_parse_git(data: &[u8]) -> Result<Files, String> {
    diffy_parse(data, diffy::patch_set::ParseOptions::gitdiff())
}

fn diffy_parse_plain(data: &[u8]) -> Result<Files, String> {
    diffy_parse(data, diffy::patch_set::ParseOptions::unidiff())
}

fn diffy_parse(data: &[u8], options: diffy::patch_set::ParseOptions) -> Result<Files, String> {
    use diffy::patch_set::{FileOperation, PatchKind, PatchSet};
    let mut files = Vec::new();
    for item in PatchSet::parse_bytes(data, options) {
        let file_patch = item.map_err(|e| e.to_string())?;
        let mut f = Map::new();
        match file_patch.operation() {
            FileOperation::Create(path) => {
                f.insert("status".into(), "added".into());
                f.insert("old_path".into(), Value::Null);
                f.insert("new_path".into(), jb(path));
            }
            FileOperation::Delete(path) => {
                f.insert("status".into(), "deleted".into());
                f.insert("old_path".into(), jb(path));
                f.insert("new_path".into(), Value::Null);
            }
            FileOperation::Modify { original, modified } => {
                f.insert("status".into(), "modified".into());
                f.insert("old_path".into(), jb(original));
                f.insert("new_path".into(), jb(modified));
            }
            FileOperation::Rename { from, to } => {
                f.insert("status".into(), "renamed".into());
                f.insert("path_style".into(), "stripped".into());
                f.insert("old_path".into(), jb(from));
                f.insert("new_path".into(), jb(to));
            }
            FileOperation::Copy { from, to } => {
                f.insert("status".into(), "copied".into());
                f.insert("path_style".into(), "stripped".into());
                f.insert("old_path".into(), jb(from));
                f.insert("new_path".into(), jb(to));
            }
        }
        f.insert("old_mode".into(), diffy_mode(file_patch.old_mode()));
        f.insert("new_mode".into(), diffy_mode(file_patch.new_mode()));
        match file_patch.patch() {
            PatchKind::Text(patch) => {
                f.insert("binary".into(), false.into());
                f.insert("hunks".into(), diffy_hunks(patch).into());
            }
            PatchKind::Binary(_) => {
                f.insert("binary".into(), true.into());
                f.insert("hunks".into(), Value::Array(vec![]));
            }
        }
        files.push(Value::Object(f));
    }
    Ok(files)
}

fn diffy_apply_meta() -> Value {
    json!({
        "name": "diffy",
        "package": "diffy",
        "version": DIFFY,
        "homepage": "https://github.com/bmwill/diffy",
        "api": "PatchSet::parse_bytes, then apply_bytes(old, patch) or BinaryPatch::apply(old)",
        "applies": "file",
        "input": "bytes",
        "binary": true,
        "notes": "Parsed with ParseOptions::gitdiff() when the text starts with \"diff --git\", else with unidiff()."
    })
}

fn diffy_apply(patch: &[u8], old: Option<&[u8]>) -> Result<Vec<u8>, String> {
    use diffy::patch_set::{ParseOptions, PatchKind, PatchSet};
    let options = if patch.starts_with(b"diff --git ") { ParseOptions::gitdiff() } else { ParseOptions::unidiff() };
    let mut parsed = Vec::new();
    for item in PatchSet::parse_bytes(patch, options) {
        parsed.push(item.map_err(|e| e.to_string())?);
    }
    if parsed.len() != 1 {
        return Err(format!("PatchSet found {} patches in the text of one file section", parsed.len()));
    }
    let base = old.unwrap_or(b"");
    match parsed[0].patch() {
        PatchKind::Text(p) => diffy::apply_bytes(base, p).map_err(|e| e.to_string()),
        PatchKind::Binary(b) => b.apply(base).map_err(|e| e.to_string()),
    }
}

// ---- patch and gitpatch (the same interface in two crates) -----------------------

macro_rules! patch_like {
    ($krate:ident, $meta:ident, $parse:ident, $name:expr, $package:expr, $version:expr, $home:expr) => {
        fn $meta() -> Value {
            json!({
                "name": $name,
                "package": $package,
                "version": $version,
                "homepage": $home,
                "api": "Patch::from_multiple(&str)",
                "input": "string",
                "pathStyle": "raw",
                // The library does not say whether a file is new, deleted or renamed.
                "statuses": [],
                // Patch::end_newline is one flag for the whole patch; it does not say which side it is about.
                "noNewline": "none",
                "scope": ["git", "gnu"],
                "notes": "Documented as a parser for \"patches in the unified diff format\"; git's extended headers are not mentioned."
            })
        }

        fn $parse(data: &[u8]) -> Result<Files, String> {
            use $krate::{Line, Patch};
            let text = std::str::from_utf8(data).map_err(|e| e.to_string())?;
            let patches = Patch::from_multiple(text).map_err(|e| e.to_string())?;
            Ok(patches
                .iter()
                .map(|p| {
                    let hunks: Vec<Value> = p
                        .hunks
                        .iter()
                        .map(|h| {
                            let lines: Vec<Value> = h
                                .lines
                                .iter()
                                .map(|line| match line {
                                    Line::Context(t) => json!({ "type": "context", "text": t }),
                                    Line::Remove(t) => json!({ "type": "delete", "text": t }),
                                    Line::Add(t) => json!({ "type": "add", "text": t }),
                                })
                                .collect();
                            json!({
                                "old_start": h.old_range.start,
                                "old_lines": h.old_range.count,
                                "new_start": h.new_range.start,
                                "new_lines": h.new_range.count,
                                // range_hint is everything after the closing "@@", its leading space included.
                                "section": h.range_hint.strip_prefix(' ').unwrap_or(h.range_hint),
                                "lines": lines,
                            })
                        })
                        .collect();
                    json!({
                        "old_path": devnull(&p.old.path),
                        "new_path": devnull(&p.new.path),
                        "hunks": hunks,
                    })
                })
                .collect())
        }
    };
}

patch_like!(patch, patch_meta, patch_parse, "patch (Rust)", "patch", "0.7.0", "https://github.com/uniphil/patch-rs");
patch_like!(gitpatch, gitpatch_meta, gitpatch_parse, "gitpatch", "gitpatch", "0.7.1", "https://github.com/gitpatch-rs/gitpatch");

// ---- unidiff ---------------------------------------------------------------------

fn unidiff_meta() -> Value {
    json!({
        "name": "unidiff (Rust)",
        "package": "unidiff",
        "version": "0.4.1",
        "homepage": "https://github.com/messense/unidiff-rs",
        "api": "PatchSet::new().parse(&str)",
        "input": "string",
        "pathStyle": "raw",
        "statuses": ["added", "deleted"],
        "noNewline": "line",
        "scope": ["git", "gnu"],
        "notes": "A port of Python's unidiff. \"\\ No newline at end of file\" arrives as a line of its own with the type \"\\\" when it stands inside a hunk; after the last line of a hunk the library does not deliver it."
    })
}

fn unidiff_parse(data: &[u8]) -> Result<Files, String> {
    let text = std::str::from_utf8(data).map_err(|e| e.to_string())?;
    let mut set = unidiff::PatchSet::new();
    set.parse(text).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for f in set.files() {
        let mut hunks = Vec::new();
        for h in f.hunks() {
            let mut lines: Vec<Value> = Vec::new();
            for line in h.lines() {
                let kind = match line.line_type.as_str() {
                    "+" => "add",
                    "-" => "delete",
                    " " => "context",
                    "\\" => {
                        // The marker belongs to the line before it.
                        if let Some(Value::Object(previous)) = lines.last_mut() {
                            previous.insert("no_newline".into(), true.into());
                        }
                        continue;
                    }
                    other => {
                        lines.push(json!({ "type": format!("unknown({:?})", other), "text": line.value }));
                        continue;
                    }
                };
                lines.push(json!({
                    "type": kind,
                    "text": line.value,
                    "old_no": line.source_line_no,
                    "new_no": line.target_line_no,
                }));
            }
            hunks.push(json!({
                "old_start": h.source_start,
                "old_lines": h.source_length,
                "new_start": h.target_start,
                "new_lines": h.target_length,
                "section": h.section_header,
                "lines": lines,
            }));
        }
        let status = if f.is_added_file() {
            "added"
        } else if f.is_removed_file() {
            "deleted"
        } else {
            "modified"
        };
        files.push(json!({
            "old_path": devnull(&f.source_file),
            "new_path": devnull(&f.target_file),
            "status": status,
            "additions": f.added(),
            "deletions": f.removed(),
            "hunks": hunks,
        }));
    }
    Ok(files)
}
