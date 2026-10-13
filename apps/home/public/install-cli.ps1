# pilih-jobs installer for Windows (job-tracker-spec 22 §2).
#
#   powershell -ExecutionPolicy ByPass -c "irm https://pilihpendidikan.com/install-cli.ps1 | iex"
#
# 1. Installs uv with Astral's official installer (https://astral.sh/uv) when
#    `uv` is not on PATH yet.
# 2. `uv tool install --python 3.12 pilih-jobs` (an isolated environment; uv
#    downloads Python 3.12 if needed). Re-running upgrades it.
# 3. `pilih-jobs browser install` (Chromium for Playwright, about 550 MB).
#
# Options (environment variables):
#   $env:PILIH_JOBS_VERSION = "X.Y.Z"   install that version instead of the latest
#   $env:PILIH_JOBS_PACKAGE = "<spec>"  install this requirement or wheel path instead
#                                       (testing; CI passes the wheel it just built)
#   $env:PILIH_JOBS_NO_BROWSER = "1"    skip step 3 (run `pilih-jobs browser install` later)
#
# Verify before running: this file is versioned in the pilihpendidikan
# repository (apps/home/public/install-cli.ps1), and every CLI release lists
# its SHA-256 in SHA256SUMS on the GitHub release:
#
#   irm https://pilihpendidikan.com/install-cli.ps1 -OutFile install-cli.ps1
#   (Get-FileHash install-cli.ps1 -Algorithm SHA256).Hash   # compare with SHA256SUMS
#   powershell -ExecutionPolicy ByPass -File install-cli.ps1
#
# It never signs you in: run `pilih-jobs login` afterwards.

function Install-PilihJobs {
  $ErrorActionPreference = "Stop"

  function Say([string]$Message) {
    Write-Host "pilih-jobs installer: $Message"
  }

  function Invoke-Checked([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
      throw "pilih-jobs installer: $What failed (exit $LASTEXITCODE)"
    }
  }

  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Say "installing uv (https://astral.sh/uv)"
    # A separate process, as Astral documents it, so its settings stay its own.
    Invoke-Checked "the uv installer" {
      powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    }
    # The uv installer puts uv in %USERPROFILE%\.local\bin and updates the user
    # PATH for new terminals; make it visible to this one too.
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
      throw "pilih-jobs installer: uv was installed but is not on PATH; open a new terminal and run this script again"
    }
  }

  $spec = "pilih-jobs"
  if ($env:PILIH_JOBS_PACKAGE) {
    $spec = $env:PILIH_JOBS_PACKAGE
  } elseif ($env:PILIH_JOBS_VERSION) {
    $spec = "pilih-jobs==$($env:PILIH_JOBS_VERSION)"
  }
  Say "installing $spec with uv (Python 3.12)"
  Invoke-Checked "uv tool install" { uv tool install --python 3.12 --upgrade $spec }

  $binDir = (uv tool dir --bin).Trim()
  $pilihJobs = Join-Path $binDir "pilih-jobs.exe"
  if (-not (Test-Path $pilihJobs)) {
    throw "pilih-jobs installer: pilih-jobs.exe was not found in $binDir"
  }

  if ($env:PILIH_JOBS_NO_BROWSER -eq "1") {
    Say "skipping the browser download (run: pilih-jobs browser install)"
  } else {
    Say "downloading Chromium for browser automation (about 550 MB)"
    Invoke-Checked "pilih-jobs browser install" { & $pilihJobs --yes browser install }
  }

  $onPath = ($env:Path -split ";") | Where-Object { $_.TrimEnd("\") -ieq $binDir.TrimEnd("\") }
  if (-not $onPath) {
    uv tool update-shell
    Say "added $binDir to your PATH; open a new terminal to use pilih-jobs"
  }

  Say "done. Next steps:"
  Write-Host "  pilih-jobs doctor    # checks the setup and prints the fix for each problem"
  Write-Host "  pilih-jobs login     # approve this device in your browser"
}

Install-PilihJobs
