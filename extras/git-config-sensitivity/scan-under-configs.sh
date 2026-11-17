#!/usr/bin/env bash
# Does a secret scanner see the same thing whatever the user's git configuration is?
#
#   ./scan-under-configs.sh gitleaks   /path/to/gitleaks
#   ./scan-under-configs.sh trufflehog /path/to/trufflehog
#
# Builds a throw-away repository that contains two strings in the SHAPE of
# credentials (random data, not credentials), and scans it once per git
# configuration. A scanner that runs `git log -p` / `git diff` and parses the
# output inherits every setting that changes that output - unless it pins the
# format (see SPEC.md, "Asking git for a diff you can parse").
set -euo pipefail
TOOL="${1:?gitleaks or trufflehog}"; BIN="${2:?path to the binary}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home" GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=a GIT_AUTHOR_EMAIL=a@example.com GIT_COMMITTER_NAME=a GIT_COMMITTER_EMAIL=a@example.com
mkdir -p "$HOME" "$WORK/repo/app/fixtures" "$WORK/repo/config/deploy"

: > "$WORK/default.gitconfig"
printf '[diff]\n\tnoprefix = true\n'       > "$WORK/diff.noprefix.gitconfig"
printf '[diff]\n\tmnemonicPrefix = true\n' > "$WORK/diff.mnemonicPrefix.gitconfig"
printf '[color]\n\tui = always\n'          > "$WORK/color.ui=always.gitconfig"

cd "$WORK/repo"
GIT_CONFIG_GLOBAL="$WORK/default.gitconfig" git init -q -b main .
python3 - <<'PY'
import base64, os, random, string
rnd = random.Random(7)
token = lambda: "ghp_" + "".join(rnd.choice(string.ascii_letters + string.digits) for _ in range(36))
body = base64.b64encode(os.urandom(600)).decode()
pem = "-----BEGIN RSA PRIVATE KEY-----\n" + "\n".join(body[i:i + 64] for i in range(0, len(body), 64)) + "\n-----END RSA PRIVATE KEY-----\n"
open("config/deploy/settings.env", "w").write("GITHUB_TOKEN=" + token() + "\n")
open("app/fixtures/prod.pem", "w").write(pem)
open("app/fixtures/ci.env", "w").write("GITHUB_TOKEN=" + token() + "\n")
PY
# The project allow-lists its top-level fixtures/ directory - not app/fixtures/.
printf '[extend]\nuseDefault = true\n\n[[allowlists]]\ndescription = "test fixtures"\npaths = [%s]\n' "'''^fixtures/'''" > .gitleaks.toml
GIT_CONFIG_GLOBAL="$WORK/default.gitconfig" git add -A
GIT_CONFIG_GLOBAL="$WORK/default.gitconfig" git commit -q -m "add files"

for cfg in default diff.noprefix diff.mnemonicPrefix color.ui=always; do
  export GIT_CONFIG_GLOBAL="$WORK/$cfg.gitconfig"
  if [ "$TOOL" = gitleaks ]; then
    code=0; "$BIN" git --no-banner --no-color --log-level error --report-format json --report-path "$WORK/out.json" . >/dev/null 2>&1 || code=$?
    files="$(python3 -c "import json,sys; print(sorted(f['File'] for f in json.load(open(sys.argv[1]))))" "$WORK/out.json")"
  else
    code=0; "$BIN" git "file://$WORK/repo" --no-verification --no-update --json 2>/dev/null > "$WORK/out.json" || code=$?
    files="$(python3 -c "
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.startswith('{')]
print(sorted(r['SourceMetadata']['Data']['Git']['file'] for r in rows if 'SourceMetadata' in r))" "$WORK/out.json")"
  fi
  printf '%-22s exit %s  %s\n' "$cfg" "$code" "$files"
done
