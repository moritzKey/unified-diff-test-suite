package main

import (
	"bytes"
	"fmt"

	bluekeyes "github.com/bluekeyes/go-gitdiff/gitdiff"
)

func init() {
	appliers["go-gitdiff"] = applier{
		meta: M{
			"name":     "go-gitdiff",
			"package":  "github.com/bluekeyes/go-gitdiff",
			"homepage": "https://github.com/bluekeyes/go-gitdiff",
			"api":      "gitdiff.Parse, then gitdiff.Apply(dst, src, file)",
			"applies":  "file",
			"binary":   true,
			"notes":    "Apply is strict: text fragments must match exactly where their header says.",
		},
		applyFile: func(patch []byte, old []byte) ([]byte, error) {
			files, _, err := bluekeyes.Parse(bytes.NewReader(patch))
			if err != nil {
				return nil, err
			}
			if len(files) != 1 {
				return nil, fmt.Errorf("Parse found %d files in the text of one file section", len(files))
			}
			var out bytes.Buffer
			if err := bluekeyes.Apply(&out, bytes.NewReader(old), files[0]); err != nil {
				return nil, err
			}
			return out.Bytes(), nil
		},
	}
}
