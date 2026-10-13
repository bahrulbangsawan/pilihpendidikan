#!/bin/sh
# pilih-jobs installer for macOS and Linux (job-tracker-spec 22 §2).
#
#   curl -LsSf https://pilihpendidikan.com/install-cli.sh | sh
#
# 1. Installs uv with Astral's official installer (https://astral.sh/uv) when
#    `uv` is not on PATH yet.
# 2. `uv tool install --python 3.12 pilih-jobs` (an isolated environment; uv
#    downloads Python 3.12 if needed). Re-running upgrades it.
# 3. `pilih-jobs browser install` (Chromium for Playwright, about 550 MB).
#
# Options (environment variables):
#   PILIH_JOBS_VERSION=X.Y.Z    install that version instead of the latest
#   PILIH_JOBS_PACKAGE=<spec>   install this requirement or wheel path instead
#                               (testing; CI passes the wheel it just built)
#   PILIH_JOBS_NO_BROWSER=1     skip step 3 (run `pilih-jobs browser install` later)
#   PILIH_JOBS_WITH_DEPS=1      Linux: also install Chromium's system libraries (sudo)
#
# Verify before running: this file is versioned in the pilihpendidikan
# repository (apps/home/public/install-cli.sh), and every CLI release lists
# its SHA-256 in SHA256SUMS on the GitHub release:
#
#   curl -LsSf https://pilihpendidikan.com/install-cli.sh -o install-cli.sh
#   shasum -a 256 install-cli.sh      # compare with SHA256SUMS
#   sh install-cli.sh
#
# It never asks for your password except through sudo with
# PILIH_JOBS_WITH_DEPS=1, and it never signs you in: run `pilih-jobs login`.

set -eu

say() {
  printf 'pilih-jobs installer: %s\n' "$1"
}

fail() {
  printf 'pilih-jobs installer: error: %s\n' "$1" >&2
  exit 1
}

has() {
  command -v "$1" >/dev/null 2>&1
}

main() {
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) fail "this script supports macOS and Linux; on Windows use install-cli.ps1 (see https://jobs.pilihpendidikan.com/cli)" ;;
  esac

  if ! has uv; then
    say "installing uv (https://astral.sh/uv)"
    if has curl; then
      curl -LsSf https://astral.sh/uv/install.sh | sh
    elif has wget; then
      wget -qO- https://astral.sh/uv/install.sh | sh
    else
      fail "neither curl nor wget is available to download uv"
    fi
    # The uv installer puts uv in $XDG_BIN_HOME or ~/.local/bin and updates the
    # shell profile for new terminals; make it visible to this one too.
    PATH="${XDG_BIN_HOME:-$HOME/.local/bin}:$HOME/.cargo/bin:$PATH"
    export PATH
    has uv || fail "uv was installed but is not on PATH; open a new terminal and run this script again"
  fi

  spec="${PILIH_JOBS_PACKAGE:-pilih-jobs}"
  if [ -z "${PILIH_JOBS_PACKAGE:-}" ] && [ -n "${PILIH_JOBS_VERSION:-}" ]; then
    spec="pilih-jobs==${PILIH_JOBS_VERSION}"
  fi
  say "installing ${spec} with uv (Python 3.12)"
  uv tool install --python 3.12 --upgrade "$spec"

  bin_dir="$(uv tool dir --bin)"
  pilih_jobs="${bin_dir}/pilih-jobs"
  [ -x "$pilih_jobs" ] || fail "pilih-jobs was not found in ${bin_dir}"

  if [ "${PILIH_JOBS_NO_BROWSER:-}" = "1" ]; then
    say "skipping the browser download (run: pilih-jobs browser install)"
  else
    say "downloading Chromium for browser automation (about 550 MB)"
    if [ "$(uname -s)" = "Linux" ] && [ "${PILIH_JOBS_WITH_DEPS:-}" = "1" ]; then
      "$pilih_jobs" --yes browser install --with-deps </dev/null
    else
      "$pilih_jobs" --yes browser install </dev/null
    fi
  fi

  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *)
      uv tool update-shell || true
      say "added ${bin_dir} to your shell profile; open a new terminal to use pilih-jobs"
      ;;
  esac

  say "done. Next steps:"
  printf '  pilih-jobs doctor    # checks the setup and prints the fix for each problem\n'
  printf '  pilih-jobs login     # approve this device in your browser\n'
  if [ "$(uname -s)" = "Linux" ] && [ "${PILIH_JOBS_WITH_DEPS:-}" != "1" ]; then
    printf '  pilih-jobs browser install --with-deps   # if doctor lists missing system libraries\n'
  fi
}

main "$@"
