// Adapter host for Go parsers and appliers. Speaks the protocol in
// adapters/PROTOCOL.md:
//
//	udts-go <adapter-name>          a parser
//	udts-go apply:<applier-name>    an applier
//
// prints one "hello" JSON line describing the library under test, then answers
// one JSON line per request line read from stdin. A panic inside a library is
// reported as an error for that request; the process keeps running.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"unicode/utf8"
)

// M is a JSON object. Adapters leave out what a library does not provide.
type M = map[string]any

type adapter struct {
	meta  M
	parse func(data []byte) ([]M, error)
}

var adapters = map[string]adapter{}

// An applier patches one file: the text of one file section and the old
// content (nil when there was no file) give the new content.
type applier struct {
	meta      M
	applyFile func(patch []byte, old []byte) ([]byte, error)
}

var appliers = map[string]applier{}

func safeApply(a applier, patch []byte, old []byte) (out []byte, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return a.applyFile(patch, old)
}

func short(err error) string {
	msg := err.Error()
	if len(msg) > 500 {
		msg = msg[:500]
	}
	return msg
}

// serveApplier answers "apply-file" requests.
func serveApplier(a applier) {
	out := json.NewEncoder(os.Stdout)
	out.SetEscapeHTML(false)
	hello := M{"hello": true, "input": "bytes", "language": "Go", "runtime": runtime.Version()}
	for k, v := range a.meta {
		hello[k] = v
	}
	hello["version"] = moduleVersion(a.meta["package"].(string))
	out.Encode(hello)
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<20), 1<<26)
	for in.Scan() {
		var req struct {
			ID   string  `json:"id"`
			Path string  `json:"path"`
			Old  *string `json:"old"`
			Out  string  `json:"out"`
		}
		if err := json.Unmarshal(in.Bytes(), &req); err != nil {
			continue
		}
		patch, err := os.ReadFile(req.Path)
		var old []byte
		if err == nil && req.Old != nil {
			old, err = os.ReadFile(*req.Old)
		}
		var result []byte
		if err == nil {
			result, err = safeApply(a, patch, old)
		}
		if err == nil {
			err = os.WriteFile(req.Out, result, 0o644)
		}
		if err != nil {
			out.Encode(M{"id": req.ID, "ok": false, "error": short(err)})
			continue
		}
		out.Encode(M{"id": req.ID, "ok": true})
	}
}

// jb turns bytes into JSON: a string when they are valid UTF-8, else {"base64": ...}.
func jb(s string) any {
	if utf8.ValidString(s) {
		return s
	}
	return M{"base64": base64.StdEncoding.EncodeToString([]byte(s))}
}

// devnull maps the conventional placeholder for "no file on this side" to null.
func devnull(name string) any {
	if name == "/dev/null" {
		return nil
	}
	return jb(name)
}

func moduleVersion(path string) string {
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range info.Deps {
			if dep.Path == path {
				return dep.Version
			}
		}
	}
	return ""
}

func safeParse(a adapter, data []byte) (files []M, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return a.parse(data)
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: udts-go <adapter-name>")
		os.Exit(2)
	}
	if name, isApplier := strings.CutPrefix(os.Args[1], "apply:"); isApplier {
		a, ok := appliers[name]
		if !ok {
			fmt.Fprintln(os.Stderr, "unknown applier", name)
			os.Exit(2)
		}
		serveApplier(a)
		return
	}
	a, ok := adapters[os.Args[1]]
	if !ok {
		fmt.Fprintln(os.Stderr, "unknown adapter", os.Args[1])
		os.Exit(2)
	}
	out := json.NewEncoder(os.Stdout)
	out.SetEscapeHTML(false)
	hello := M{"hello": true, "input": "bytes", "language": "Go", "runtime": runtime.Version()}
	for k, v := range a.meta {
		hello[k] = v
	}
	hello["version"] = moduleVersion(a.meta["package"].(string))
	out.Encode(hello)

	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<20), 1<<26)
	for in.Scan() {
		var req struct {
			ID   string `json:"id"`
			Path string `json:"path"`
		}
		if err := json.Unmarshal(in.Bytes(), &req); err != nil {
			continue
		}
		data, err := os.ReadFile(req.Path)
		var files []M
		if err == nil {
			files, err = safeParse(a, data)
		}
		if err != nil {
			msg := err.Error()
			if len(msg) > 500 {
				msg = msg[:500]
			}
			out.Encode(M{"id": req.ID, "ok": false, "error": msg})
			continue
		}
		if files == nil {
			files = []M{}
		}
		out.Encode(M{"id": req.ID, "ok": true, "files": files})
	}
}
