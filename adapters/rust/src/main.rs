//! Adapter host for Rust parsers and appliers. Speaks the protocol in
//! adapters/PROTOCOL.md:
//!
//!     udts-rust <adapter-name>          a parser
//!     udts-rust apply:<applier-name>    an applier
//!
//! prints one "hello" JSON line describing the library under test, then
//! answers one JSON line per request line read from stdin. A panic inside a
//! library is reported as an error for that request; the process keeps running.

use base64::Engine;
use serde_json::{json, Map, Value};
use std::io::{self, BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};

mod crates;

/// The normalised parse of one diff: one JSON object per file section.
pub type Files = Vec<Value>;

pub struct Adapter {
    pub meta: Value,
    pub parse: fn(&[u8]) -> Result<Files, String>,
}

/// An applier patches one file: the text of one file section and the old
/// content (None when there was no file) give the new content.
pub struct Applier {
    pub meta: Value,
    pub apply_file: fn(&[u8], Option<&[u8]>) -> Result<Vec<u8>, String>,
}

/// Bytes as JSON: a string when they are valid UTF-8, else {"base64": ...}.
pub fn jb(bytes: &[u8]) -> Value {
    match std::str::from_utf8(bytes) {
        Ok(s) => Value::String(s.to_owned()),
        Err(_) => json!({ "base64": base64::engine::general_purpose::STANDARD.encode(bytes) }),
    }
}

/// "/dev/null" is the conventional placeholder for "no file on this side".
pub fn devnull(name: &str) -> Value {
    if name == "/dev/null" {
        Value::Null
    } else {
        Value::String(name.to_owned())
    }
}

/// One JSON document on one line, in plain ASCII (see PROTOCOL.md, "A line ends with LF").
fn json_line(value: &Value) -> String {
    let text = serde_json::to_string(value).expect("a JSON value can be written");
    let mut out = String::with_capacity(text.len() + 1);
    for c in text.chars() {
        if (c as u32) < 0x7f {
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{:04x}", unit));
            }
        }
    }
    out.push('\n');
    out
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    let text = payload
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown".to_owned());
    format!("panic: {}", text)
}

fn short(mut message: String) -> String {
    if message.len() > 500 {
        let mut end = 500;
        while !message.is_char_boundary(end) {
            end -= 1;
        }
        message.truncate(end);
    }
    message
}

fn hello(meta: &Value) -> Value {
    let mut hello = Map::new();
    hello.insert("hello".into(), Value::Bool(true));
    hello.insert("language".into(), "Rust".into());
    hello.insert("runtime".into(), format!("rustc {}", env!("UDTS_RUSTC_VERSION")).into());
    for (k, v) in meta.as_object().expect("meta is an object") {
        hello.insert(k.clone(), v.clone());
    }
    Value::Object(hello)
}

fn answer(request: &Value, adapter: Option<&Adapter>, applier: Option<&Applier>) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let fail = |message: String| json!({ "id": id, "ok": false, "error": short(message) });
    let path = match request.get("path").and_then(Value::as_str) {
        Some(p) => p,
        None => return fail("request without a path".to_owned()),
    };
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(e) => return fail(format!("cannot read {}: {}", path, e)),
    };
    if let Some(a) = applier {
        let old = match request.get("old").and_then(Value::as_str) {
            Some(p) => match std::fs::read(p) {
                Ok(d) => Some(d),
                Err(e) => return fail(format!("cannot read {}: {}", p, e)),
            },
            None => None,
        };
        let result = catch_unwind(AssertUnwindSafe(|| (a.apply_file)(&data, old.as_deref()))).unwrap_or_else(|p| Err(panic_message(p)));
        return match result {
            Ok(content) => match request.get("out").and_then(Value::as_str).map(|out| std::fs::write(out, content)) {
                Some(Ok(())) => json!({ "id": id, "ok": true }),
                Some(Err(e)) => fail(format!("cannot write the result: {}", e)),
                None => fail("request without an output path".to_owned()),
            },
            Err(message) => fail(message),
        };
    }
    let a = adapter.expect("a parser or an applier");
    match catch_unwind(AssertUnwindSafe(|| (a.parse)(&data))).unwrap_or_else(|p| Err(panic_message(p))) {
        Ok(files) => json!({ "id": id, "ok": true, "files": files }),
        Err(message) => fail(message),
    }
}

fn main() {
    let name = match std::env::args().nth(1) {
        Some(n) => n,
        None => {
            eprintln!("usage: udts-rust <adapter-name> | apply:<applier-name>");
            std::process::exit(2);
        }
    };
    let (adapter, applier) = match name.strip_prefix("apply:") {
        Some(n) => (None, crates::applier(n)),
        None => (crates::adapter(&name), None),
    };
    if adapter.is_none() && applier.is_none() {
        eprintln!("unknown adapter {}", name);
        std::process::exit(2);
    }
    // A panic is reported to the harness as the answer; the default message on stderr adds nothing.
    std::panic::set_hook(Box::new(|_| {}));
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let meta = adapter.as_ref().map(|a| &a.meta).or(applier.as_ref().map(|a| &a.meta)).expect("meta");
    out.write_all(json_line(&hello(meta)).as_bytes()).and_then(|_| out.flush()).expect("stdout");
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut line = Vec::new();
    loop {
        line.clear();
        // Lines end with LF and nothing else.
        match input.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let request: Value = match serde_json::from_slice(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let response = answer(&request, adapter.as_ref(), applier.as_ref());
        if out.write_all(json_line(&response).as_bytes()).and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}
