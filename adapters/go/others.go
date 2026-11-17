package main

import (
	"bytes"
	"strings"

	rd "github.com/reviewdog/reviewdog/diff"
	sg "github.com/sourcegraph/go-diff/diff"
	"github.com/waigani/diffparser"
)

// markedLines converts hunk lines that still carry their marker column, with
// "\ No newline at end of file" delivered as a line of its own.
func markedLines(body string) []M {
	lines := []M{}
	body = strings.TrimSuffix(body, "\n")
	if body == "" {
		return lines
	}
	for _, s := range strings.Split(body, "\n") {
		if strings.HasPrefix(s, "\\") {
			if n := len(lines); n > 0 {
				lines[n-1]["no_newline"] = true
			}
			continue
		}
		kind := "unknown"
		text := s
		if len(s) > 0 {
			switch s[0] {
			case ' ':
				kind = "context"
			case '+':
				kind = "add"
			case '-':
				kind = "delete"
			}
			text = s[1:]
		} else {
			kind = "context"
		}
		lines = append(lines, M{"type": kind, "text": jb(text)})
	}
	return lines
}

// reviewdog takes names from the "---"/"+++" lines only; for a section without them the
// fields stay empty, which the adapter reports as "not determined".
func rdName(name string) any {
	if name == "" {
		return M{"unknown": true}
	}
	return devnull(name)
}

func zeroIsNone(n int) any {
	if n == 0 {
		return nil
	}
	return n
}

func init() {
	adapters["sourcegraph-go-diff"] = adapter{
		meta: M{
			"name": "go-diff (sourcegraph)", "package": "github.com/sourcegraph/go-diff", "homepage": "https://github.com/sourcegraph/go-diff",
			"api": "diff.ParseMultiFileDiff(bytes)",
			// Names are returned as written, prefix included; the hunk body is returned as raw bytes.
			// "\ No newline" lines are not part of Hunk.Body; the library keeps a byte offset
			// (OrigNoNewlineAt) for the old side only, which has no counterpart in the protocol.
			"pathStyle": "raw", "statuses": []string{}, "noNewline": "none",
			"scope": []string{"git", "git-config", "gnu"},
			"notes": `README: "Unified diff parser and printer for Go". The hunk body comes back as bytes; the adapter splits it at LF.`,
		},
		parse: func(data []byte) ([]M, error) {
			fds, err := sg.ParseMultiFileDiff(data)
			if err != nil {
				return nil, err
			}
			out := []M{}
			for _, fd := range fds {
				hunks := []M{}
				for _, h := range fd.Hunks {
					hunks = append(hunks, M{"old_start": h.OrigStartLine, "old_lines": h.OrigLines, "new_start": h.NewStartLine, "new_lines": h.NewLines, "section": jb(h.Section), "lines": markedLines(string(h.Body))})
				}
				out = append(out, M{"old_path": devnull(fd.OrigName), "new_path": devnull(fd.NewName), "hunks": hunks})
			}
			return out, nil
		},
	}
	rdTypes := map[rd.LineType]string{rd.LineUnchanged: "context", rd.LineAdded: "add", rd.LineDeleted: "delete"}
	adapters["reviewdog-diff"] = adapter{
		meta: M{
			"name": "reviewdog/diff", "package": "github.com/reviewdog/reviewdog", "homepage": "https://github.com/reviewdog/reviewdog/tree/master/diff",
			"api":       "diff.ParseMultiFile(reader)",
			"pathStyle": "raw", "statuses": []string{}, "noNewline": "none",
			"scope": []string{"git", "git-config", "gnu"},
			"notes": "The parser behind `reviewdog -f=diff` and its diff filtering. Names are returned as written; reviewdog strips the prefix later (-strip).",
		},
		parse: func(data []byte) ([]M, error) {
			fds, err := rd.ParseMultiFile(bytes.NewReader(data))
			if err != nil {
				return nil, err
			}
			out := []M{}
			for _, fd := range fds {
				hunks := []M{}
				for _, h := range fd.Hunks {
					lines := []M{}
					for _, l := range h.Lines {
						kind, ok := rdTypes[l.Type]
						if !ok {
							kind = "unknown"
						}
						lines = append(lines, M{"type": kind, "text": jb(l.Content), "old_no": zeroIsNone(l.LnumOld), "new_no": zeroIsNone(l.LnumNew)})
					}
					hunks = append(hunks, M{"old_start": h.StartLineOld, "old_lines": h.LineLengthOld, "new_start": h.StartLineNew, "new_lines": h.LineLengthNew, "section": jb(h.Section), "lines": lines})
				}
				out = append(out, M{"old_path": rdName(fd.PathOld), "new_path": rdName(fd.PathNew), "hunks": hunks})
			}
			return out, nil
		},
	}
	adapters["waigani-diffparser"] = adapter{
		meta: M{
			"name": "diffparser (waigani)", "package": "github.com/waigani/diffparser", "homepage": "https://github.com/waigani/diffparser",
			"api":       "diffparser.Parse(text)",
			"pathStyle": "stripped", "statuses": []string{"added", "deleted"}, "noNewline": "none",
			"scope": []string{"git"},
			"notes": `README: "Parses a git diff".`,
		},
		parse: func(data []byte) ([]M, error) {
			d, err := diffparser.Parse(string(data))
			if err != nil {
				return nil, err
			}
			out := []M{}
			for _, f := range d.Files {
				status := "modified"
				switch f.Mode {
				case diffparser.NEW:
					status = "added"
				case diffparser.DELETED:
					status = "deleted"
				}
				hunks := []M{}
				for _, h := range f.Hunks {
					lines := []M{}
					for _, l := range h.WholeRange.Lines {
						switch l.Mode {
						case diffparser.ADDED:
							lines = append(lines, M{"type": "add", "text": jb(l.Content), "new_no": l.Number})
						case diffparser.REMOVED:
							lines = append(lines, M{"type": "delete", "text": jb(l.Content), "old_no": l.Number})
						default:
							lines = append(lines, M{"type": "context", "text": jb(l.Content)})
						}
					}
					hunks = append(hunks, M{"old_start": h.OrigRange.Start, "old_lines": h.OrigRange.Length, "new_start": h.NewRange.Start, "new_lines": h.NewRange.Length, "lines": lines})
				}
				m := M{"status": status, "hunks": hunks}
				if status != "added" {
					m["old_path"] = jb(f.OrigName)
				} else {
					m["old_path"] = nil
				}
				if status != "deleted" {
					m["new_path"] = jb(f.NewName)
				} else {
					m["new_path"] = nil
				}
				out = append(out, m)
			}
			return out, nil
		},
	}
}
