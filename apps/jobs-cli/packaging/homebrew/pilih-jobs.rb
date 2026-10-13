# TEMPLATE — Homebrew formula for pilih-jobs (job-tracker-spec 22 §2, §7 step 8).
#
# Not a published formula. `packaging/render.py` fills the placeholders for one
# release (version, sdist URL and SHA-256 from `uv build`) and replaces the
# resources marker below with one `resource` per runtime dependency, pinned by
# `uv.lock`: the sdist where PyPI has one, the platform wheel otherwise
# (Playwright and patchright publish wheels only; curl_cffi's sdist downloads
# curl-impersonate while it builds, which a Homebrew build must not do).
# The rendered file goes to the tap `pilihpendidikan/homebrew-tap` as
# `Formula/pilih-jobs.rb`:
#
#   brew install pilihpendidikan/tap/pilih-jobs
#
# Before the first publish (owner): `brew install --build-from-source`,
# `brew test pilih-jobs` and `brew audit --strict --online pilih-jobs` in the
# tap on macOS arm64 / x64 and Linux.
class PilihJobs < Formula
  include Language::Python::Virtualenv

  desc "Local CLI of the pilihpendidikan Job Tracker: discovery, browser automation, sync"
  homepage "https://jobs.pilihpendidikan.com/cli"
  url "@SDIST_URL@"
  sha256 "@SDIST_SHA256@"
  license "MIT"

  livecheck do
    url "https://pypi.org/pypi/pilih-jobs/json"
    regex(/"version":\s*"(\d+(?:\.\d+)+)"/i)
  end

  # Native extensions built from their sdists: pydantic-core, orjson and
  # cryptography (Rust / maturin), cffi, greenlet, lxml, msgspec, psutil and
  # zstandard (C).
  depends_on "maturin" => :build
  depends_on "pkgconf" => :build
  depends_on "rust" => :build
  depends_on "openssl@3"
  depends_on "python@3.12"

  uses_from_macos "libffi"
  uses_from_macos "libxml2"
  uses_from_macos "libxslt"
  uses_from_macos "zlib"

  # @RESOURCES@

  # Resources that are platform wheels, installed with pip as they are.
  WHEEL_RESOURCES = %w[@WHEEL_RESOURCES@].freeze

  def install
    venv = virtualenv_create(libexec, "python3.12")
    venv.pip_install resources.reject { |r| WHEEL_RESOURCES.include?(r.name) }
    resources.select { |r| WHEEL_RESOURCES.include?(r.name) }.each do |r|
      r.fetch
      wheel = buildpath/"wheels"/File.basename(r.url)
      wheel.dirname.mkpath
      cp r.cached_download, wheel
      system libexec/"bin/python", "-m", "pip", "install", "--no-deps", "--no-index", wheel
    end
    venv.pip_install_and_link buildpath
  end

  def caveats
    <<~EOS
      Download the browser once (about 550 MB), then sign in:
        pilih-jobs browser install
        pilih-jobs login
      `pilih-jobs doctor` checks the setup. `brew upgrade pilih-jobs` updates it.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/pilih-jobs --json version")
    assert_match "pilih-jobs", shell_output("#{bin}/pj --help")
  end
end
