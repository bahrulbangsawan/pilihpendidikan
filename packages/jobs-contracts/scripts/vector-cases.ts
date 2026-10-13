// Hand-written golden cases for test-vectors/*.json.
//
// Every expected key, canonical URL, registrable domain and normalized text
// here is written by hand from 03 §4.2 and the Public Suffix List, NOT
// computed by the implementation: `bun run build` fails if the
// implementation disagrees, and only then writes the vectors (adding the
// SHA-256 hashes, computed with node:crypto, independently of WebCrypto).
import type { FingerprintInput } from "../src/fingerprint";

export interface FingerprintCase {
  input: FingerprintInput;
  key: string;
  name: string;
}

const GH = "https://boards.greenhouse.io/acme/jobs";

export const FINGERPRINT_CASES: FingerprintCase[] = [
  // --- src| keys: every stable source kind -----------------------------------
  {
    name: "greenhouse: src key ignores url, title and location",
    input: {
      source_kind: "greenhouse",
      source_org: "acme",
      source_job_ref: "4012345",
      title: "Backend Engineer",
      company_domain: "acme.com",
      location_primary: "Jakarta",
      apply_url: `${GH}/4012345?gh_src=abc`,
    },
    key: "src|greenhouse|acme|4012345",
  },
  {
    name: "greenhouse: org is normalized (case, spaces)",
    input: {
      source_kind: "greenhouse",
      source_org: "  Acme   Corp ",
      source_job_ref: "4012346",
      title: "Data Engineer",
    },
    key: "src|greenhouse|acme corp|4012346",
  },
  {
    name: "greenhouse: org punctuation stripped except . (Acme, Inc.)",
    input: {
      source_kind: "greenhouse",
      source_org: "Acme, Inc.",
      source_job_ref: "99",
      title: "QA Engineer",
    },
    key: "src|greenhouse|acme inc.|99",
  },
  {
    name: "lever: uuid ref kept verbatim",
    input: {
      source_kind: "lever",
      source_org: "netflix",
      source_job_ref: "5f0c8a2e-1d3b-4c7e-9a1f-2b3c4d5e6f70",
      title: "Senior Software Engineer",
    },
    key: "src|lever|netflix|5f0c8a2e-1d3b-4c7e-9a1f-2b3c4d5e6f70",
  },
  {
    name: "lever: ref is trimmed",
    input: {
      source_kind: "lever",
      source_org: "acme",
      source_job_ref: " 123 ",
      title: "Designer",
    },
    key: "src|lever|acme|123",
  },
  {
    name: "ashby: board name lowercased",
    input: {
      source_kind: "ashby",
      source_org: "Ramp",
      source_job_ref: "a1b2c3d4-0000-4000-8000-000000000001",
      title: "Product Manager",
    },
    key: "src|ashby|ramp|a1b2c3d4-0000-4000-8000-000000000001",
  },
  {
    name: "smartrecruiters: company identifier",
    input: {
      source_kind: "smartrecruiters",
      source_org: "BoschGroup",
      source_job_ref: "743999912345678",
      title: "Embedded Software Engineer",
    },
    key: "src|smartrecruiters|boschgroup|743999912345678",
  },
  {
    name: "workable: ref case preserved",
    input: {
      source_kind: "workable",
      source_org: "tokopedia",
      source_job_ref: "A1B2C3D4E5",
      title: "Android Developer",
    },
    key: "src|workable|tokopedia|A1B2C3D4E5",
  },
  {
    name: "workday: tenant org",
    input: {
      source_kind: "workday",
      source_org: "nvidia",
      source_job_ref: "JR1987654",
      title: "Systems Software Engineer",
    },
    key: "src|workday|nvidia|JR1987654",
  },
  {
    name: "stable kind without a ref falls back to gen",
    input: {
      source_kind: "greenhouse",
      source_org: "acme",
      source_job_ref: null,
      title: "Data Analyst",
      company_domain: "acme.com",
      location_primary: "Jakarta",
      apply_url: `${GH}/1`,
    },
    key: "gen|acme.com|data analyst|jakarta|https://boards.greenhouse.io/acme/jobs/1",
  },
  {
    name: "stable kind with a whitespace-only ref falls back to gen",
    input: {
      source_kind: "lever",
      source_org: "acme",
      source_job_ref: "   ",
      title: "Recruiter",
      company_domain: "acme.com",
      apply_url: "https://jobs.lever.co/acme/x",
    },
    key: "gen|acme.com|recruiter||https://jobs.lever.co/acme/x",
  },
  // --- gen| keys ---------------------------------------------------------------
  {
    name: "career_page: gen key with location",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Senior Software Engineer",
      location_primary: "Jakarta, Indonesia",
      apply_url: "https://careers.acme.com/jobs/123",
    },
    key: "gen|acme.com|senior software engineer|jakarta indonesia|https://careers.acme.com/jobs/123",
  },
  {
    name: "gen key without location",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Product Designer",
      location_primary: null,
      apply_url: "https://careers.acme.com/jobs/77",
    },
    key: "gen|acme.com|product designer||https://careers.acme.com/jobs/77",
  },
  {
    name: "company domain: uppercase www host, multi-level suffix co.id",
    input: {
      source_kind: "career_page",
      company_domain: "WWW.ACME.CO.ID",
      title: "Finance Staff",
      location_primary: "Surabaya",
      apply_url: "https://acme.co.id/karir/12",
    },
    key: "gen|acme.co.id|finance staff|surabaya|https://acme.co.id/karir/12",
  },
  {
    name: "company domain given as a URL (com.au)",
    input: {
      source_kind: "generic_listing",
      company_domain: "https://jobs.acme.com.au/careers",
      title: "Nurse",
      location_primary: "Sydney NSW",
      apply_url: "https://jobs.acme.com.au/careers/88",
    },
    key: "gen|acme.com.au|nurse|sydney nsw|https://jobs.acme.com.au/careers/88",
  },
  {
    name: "no company domain: apply_url host (co.uk)",
    input: {
      source_kind: "custom_url",
      title: "Barista",
      location_primary: "London",
      apply_url: "https://jobs.example.co.uk/apply/9",
    },
    key: "gen|example.co.uk|barista|london|https://jobs.example.co.uk/apply/9",
  },
  {
    name: "no company domain or apply_url: canonical_url host and url",
    input: {
      source_kind: "custom_url",
      title: "Founding Engineer",
      canonical_url: "https://www.startup.io/jobs/2",
    },
    key: "gen|startup.io|founding engineer||https://www.startup.io/jobs/2",
  },
  {
    name: "NFKC: fullwidth title",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Ｓｏｆｔｗａｒｅ\u3000Ｅｎｇｉｎｅｅｒ",
      apply_url: "https://acme.com/jobs/1",
    },
    key: "gen|acme.com|software engineer||https://acme.com/jobs/1",
  },
  {
    name: "punctuation: c++ kept, parentheses stripped",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "C++ Developer (Embedded)",
      apply_url: "https://acme.com/jobs/2",
    },
    key: "gen|acme.com|c++ developer embedded||https://acme.com/jobs/2",
  },
  {
    name: "punctuation: c#, / and .net kept",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Senior C#/.NET Engineer",
      apply_url: "https://acme.com/jobs/3",
    },
    key: "gen|acme.com|senior c#/.net engineer||https://acme.com/jobs/3",
  },
  {
    name: "punctuation: em dash and pipe removed, spaces collapsed",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Backend Engineer — Payments | Remote",
      apply_url: "https://acme.com/jobs/4",
    },
    key: "gen|acme.com|backend engineer payments remote||https://acme.com/jobs/4",
  },
  {
    name: "tracking params dropped from the url part",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Account Executive",
      location_primary: "Singapore",
      apply_url:
        "https://careers.acme.com/jobs/5?utm_source=linkedin&utm_medium=social&ref=abc&lang=en&gh_src=x&fbclid=1&gclid=2&source=feed&lever-source=y",
    },
    key: "gen|acme.com|account executive|singapore|https://careers.acme.com/jobs/5?lang=en",
  },
  {
    name: "query params sorted",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Engineer",
      apply_url: "https://careers.acme.com/jobs?team=eng&b=2&a=1",
    },
    key: "gen|acme.com|engineer||https://careers.acme.com/jobs?a=1&b=2&team=eng",
  },
  {
    name: "default port and fragment dropped, uppercase scheme/host lowered",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Engineer",
      apply_url: "HTTPS://Careers.ACME.com:443/Jobs/8#apply",
    },
    key: "gen|acme.com|engineer||https://careers.acme.com/Jobs/8",
  },
  {
    name: "IDN company and apply hosts in punycode",
    input: {
      source_kind: "career_page",
      company_domain: "bücher.de",
      title: "Buchhändler (m/w/d)",
      location_primary: "München",
      apply_url: "https://karriere.bücher.de/stellen/1",
    },
    key: "gen|xn--bcher-kva.de|buchhändler m/w/d|münchen|https://karriere.xn--bcher-kva.de/stellen/1",
  },
  {
    name: "private suffix github.io keeps the user label",
    input: {
      source_kind: "custom_url",
      company_domain: "acme.github.io",
      title: "Open Source Maintainer",
      apply_url: "https://acme.github.io/jobs/1",
    },
    key: "gen|acme.github.io|open source maintainer||https://acme.github.io/jobs/1",
  },
  {
    name: "multi-level suffix co.id from a subdomain",
    input: {
      source_kind: "career_page",
      company_domain: "careers.telkom.co.id",
      title: "Network Engineer",
      location_primary: "Bandung",
      apply_url: "https://careers.telkom.co.id/vacancy/31",
    },
    key: "gen|telkom.co.id|network engineer|bandung|https://careers.telkom.co.id/vacancy/31",
  },
  {
    name: "academic suffix ac.id",
    input: {
      source_kind: "career_page",
      company_domain: "www.ui.ac.id",
      title: "Dosen Ilmu Komputer",
      location_primary: "Depok",
      apply_url: "https://www.ui.ac.id/lowongan/7",
    },
    key: "gen|ui.ac.id|dosen ilmu komputer|depok|https://www.ui.ac.id/lowongan/7",
  },
  {
    name: "manual posting with no host or url",
    input: {
      source_kind: "manual",
      title: "Office Manager",
      location_primary: "Bandung",
    },
    key: "gen||office manager|bandung|",
  },
  {
    name: "mailto apply_url contributes no url",
    input: {
      source_kind: "email",
      company_domain: "acme.co.id",
      title: "Finance Staff",
      location_primary: "Surabaya",
      apply_url: "mailto:hr@acme.co.id?subject=Apply",
    },
    key: "gen|acme.co.id|finance staff|surabaya|",
  },
  {
    name: "IP host has no registrable domain: host itself",
    input: {
      source_kind: "custom_url",
      title: "QA Tester",
      apply_url: "http://192.168.1.10:8080/jobs/1",
    },
    key: "gen|192.168.1.10|qa tester||http://192.168.1.10:8080/jobs/1",
  },
  {
    name: "unicode location keeps letters, strips comma",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com.br",
      title: "Engenheiro de Dados",
      location_primary: "São Paulo, Brasil",
      apply_url: "https://acme.com.br/vagas/3",
    },
    key: "gen|acme.com.br|engenheiro de dados|são paulo brasil|https://acme.com.br/vagas/3",
  },
  {
    name: "NBSP, zero-width space, tab and newline",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "  Senior\tData\u00a0Engineer\u200b\n",
      location_primary: "Remote\u2003(Indonesia)",
      apply_url: "https://acme.com/jobs/12",
    },
    key: "gen|acme.com|senior data engineer|remote indonesia|https://acme.com/jobs/12",
  },
  {
    name: "emoji and ampersand stripped",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "🚀 R&D Engineer",
      apply_url: "https://acme.com/jobs/13",
    },
    key: "gen|acme.com|rd engineer||https://acme.com/jobs/13",
  },
  {
    name: "dots kept: Sr. Node.js",
    input: {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Sr. Node.js Developer",
      apply_url: "https://acme.com/jobs/14",
    },
    key: "gen|acme.com|sr. node.js developer||https://acme.com/jobs/14",
  },
  {
    name: "Indonesian title with slash",
    input: {
      source_kind: "career_page",
      company_domain: "acme.co.id",
      title: "Staf Admin/Keuangan",
      location_primary: "Jakarta Selatan",
      apply_url: "https://acme.co.id/karir/staf-admin",
    },
    key: "gen|acme.co.id|staf admin/keuangan|jakarta selatan|https://acme.co.id/karir/staf-admin",
  },
];

export interface UrlCase {
  input: string;
  name: string;
  output: string | null;
}

export const CANONICAL_URL_CASES: UrlCase[] = [
  {
    name: "utm_*, gh_src, ref, source, fbclid, gclid, lever-source dropped",
    input:
      "https://careers.acme.com/jobs/5?utm_source=linkedin&utm_medium=social&ref=abc&lang=en&gh_src=x&fbclid=1&gclid=2&source=feed&lever-source=y",
    output: "https://careers.acme.com/jobs/5?lang=en",
  },
  {
    name: "tracking names match case-insensitively",
    input: "https://acme.com/jobs?UTM_Source=x&Ref=y&id=3",
    output: "https://acme.com/jobs?id=3",
  },
  {
    name: "percent-encoded tracking name is decoded for the check",
    input: "https://acme.com/jobs?utm%5Fsource=x&id=3",
    output: "https://acme.com/jobs?id=3",
  },
  {
    name: "only tracking params: no ?",
    input: "https://acme.com/jobs/9?utm_campaign=x",
    output: "https://acme.com/jobs/9",
  },
  {
    name: "similar names are kept (referrer, sources, lever_source)",
    input: "https://acme.com/j?sources=a&referrer=b&lever_source=c",
    output: "https://acme.com/j?lever_source=c&referrer=b&sources=a",
  },
  {
    name: "params sorted by name",
    input: "https://careers.acme.com/jobs?team=eng&b=2&a=1",
    output: "https://careers.acme.com/jobs?a=1&b=2&team=eng",
  },
  {
    name: "same name sorted by whole segment",
    input: "https://acme.com/j?b=2&a=2&a=1",
    output: "https://acme.com/j?a=1&a=2&b=2",
  },
  {
    name: "valueless param kept",
    input: "https://acme.com/j?remote&a=1",
    output: "https://acme.com/j?a=1&remote",
  },
  {
    name: "empty segments dropped",
    input: "https://acme.com/j?a=1&&b=2&",
    output: "https://acme.com/j?a=1&b=2",
  },
  {
    name: "segments kept verbatim (+ and %2B)",
    input: "https://acme.com/search?q=c%2B%2B+dev",
    output: "https://acme.com/search?q=c%2B%2B+dev",
  },
  {
    name: "space in query percent-encoded by the URL parser",
    input: "https://acme.com/jobs?q=data engineer",
    output: "https://acme.com/jobs?q=data%20engineer",
  },
  {
    name: "empty ? removed",
    input: "https://acme.com/jobs?",
    output: "https://acme.com/jobs",
  },
  {
    name: "https default port dropped",
    input: "https://careers.acme.com:443/jobs/6",
    output: "https://careers.acme.com/jobs/6",
  },
  {
    name: "http default port dropped",
    input: "http://careers.acme.com:80/jobs/6",
    output: "http://careers.acme.com/jobs/6",
  },
  {
    name: "non-default port kept",
    input: "http://careers.acme.com:8080/jobs/6",
    output: "http://careers.acme.com:8080/jobs/6",
  },
  {
    name: "fragment dropped",
    input: "https://careers.acme.com/jobs/7#apply",
    output: "https://careers.acme.com/jobs/7",
  },
  {
    name: "scheme and host lowercased, path case kept",
    input: "HTTPS://Careers.ACME.com/Jobs/8",
    output: "https://careers.acme.com/Jobs/8",
  },
  {
    name: "IDN host to punycode",
    input: "https://karriere.bücher.de/stellen/1",
    output: "https://karriere.xn--bcher-kva.de/stellen/1",
  },
  {
    name: "non-ASCII path percent-encoded",
    input: "https://acme.com/lowongan/kasir-é",
    output: "https://acme.com/lowongan/kasir-%C3%A9",
  },
  {
    name: "empty path becomes /",
    input: "https://acme.com",
    output: "https://acme.com/",
  },
  {
    name: "dot segments resolved",
    input: "https://acme.com/a/../jobs/./10",
    output: "https://acme.com/jobs/10",
  },
  {
    name: "userinfo dropped",
    input: "https://user:secret@acme.com/jobs/1",
    output: "https://acme.com/jobs/1",
  },
  {
    name: "surrounding whitespace ignored",
    input: "  https://acme.com/jobs/1  ",
    output: "https://acme.com/jobs/1",
  },
  {
    name: "IPv6 host and port",
    input: "http://[::1]:8080/x",
    output: "http://[::1]:8080/x",
  },
  {
    name: "Greenhouse board url with gh_src",
    input: "https://boards.greenhouse.io/acme/jobs/4012345?gh_src=7f3a2c",
    output: "https://boards.greenhouse.io/acme/jobs/4012345",
  },
  {
    name: "Lever url with lever-source",
    input: "https://jobs.lever.co/acme/5f0c8a2e?lever-source=LinkedIn",
    output: "https://jobs.lever.co/acme/5f0c8a2e",
  },
  {
    name: "mailto is not canonicalized",
    input: "mailto:hr@acme.com",
    output: null,
  },
  {
    name: "javascript: is refused",
    input: "javascript:alert(1)",
    output: null,
  },
  { name: "ftp is refused", input: "ftp://acme.com/jobs.txt", output: null },
  { name: "no scheme is not a URL", input: "acme.com/jobs", output: null },
  { name: "empty input", input: "", output: null },
];

export interface DomainCase {
  include_private?: boolean;
  input: string;
  public_suffix: string | null;
  registrable_domain: string | null;
}

export const REGISTRABLE_DOMAIN_CASES: DomainCase[] = [
  {
    input: "example.com",
    registrable_domain: "example.com",
    public_suffix: "com",
  },
  {
    input: "www.example.com",
    registrable_domain: "example.com",
    public_suffix: "com",
  },
  {
    input: "a.b.c.example.com",
    registrable_domain: "example.com",
    public_suffix: "com",
  },
  { input: "com", registrable_domain: null, public_suffix: "com" },
  {
    input: "example.co.uk",
    registrable_domain: "example.co.uk",
    public_suffix: "co.uk",
  },
  {
    input: "careers.example.co.uk",
    registrable_domain: "example.co.uk",
    public_suffix: "co.uk",
  },
  { input: "co.uk", registrable_domain: null, public_suffix: "co.uk" },
  {
    input: "jobs.seek.com.au",
    registrable_domain: "seek.com.au",
    public_suffix: "com.au",
  },
  {
    input: "careers.telkom.co.id",
    registrable_domain: "telkom.co.id",
    public_suffix: "co.id",
  },
  {
    input: "www.ui.ac.id",
    registrable_domain: "ui.ac.id",
    public_suffix: "ac.id",
  },
  { input: "ac.id", registrable_domain: null, public_suffix: "ac.id" },
  {
    input: "acme.com.br",
    registrable_domain: "acme.com.br",
    public_suffix: "com.br",
  },
  {
    input: "acme.github.io",
    registrable_domain: "acme.github.io",
    public_suffix: "github.io",
  },
  { input: "github.io", registrable_domain: null, public_suffix: "github.io" },
  {
    input: "acme.github.io",
    include_private: false,
    registrable_domain: "github.io",
    public_suffix: "io",
  },
  {
    input: "www.github.com",
    registrable_domain: "github.com",
    public_suffix: "com",
  },
  {
    input: "acme.pages.dev",
    registrable_domain: "acme.pages.dev",
    public_suffix: "pages.dev",
  },
  {
    input: "acme.herokuapp.com",
    registrable_domain: "acme.herokuapp.com",
    public_suffix: "herokuapp.com",
  },
  {
    input: "ec2-1-2-3-4.us-east-1.compute.amazonaws.com",
    registrable_domain: "ec2-1-2-3-4.us-east-1.compute.amazonaws.com",
    public_suffix: "us-east-1.compute.amazonaws.com",
  },
  {
    input: "WWW.EXAMPLE.COM",
    registrable_domain: "example.com",
    public_suffix: "com",
  },
  {
    input: "  Example.ORG  ",
    registrable_domain: "example.org",
    public_suffix: "org",
  },
  {
    input: "example.com.",
    registrable_domain: "example.com",
    public_suffix: "com",
  },
  {
    input: "bücher.de",
    registrable_domain: "xn--bcher-kva.de",
    public_suffix: "de",
  },
  {
    input: "www.münchen.de",
    registrable_domain: "xn--mnchen-3ya.de",
    public_suffix: "de",
  },
  {
    input: "acme.公司.cn",
    registrable_domain: "acme.xn--55qx5d.cn",
    public_suffix: "xn--55qx5d.cn",
  },
  {
    input: "公司.cn",
    registrable_domain: null,
    public_suffix: "xn--55qx5d.cn",
  },
  {
    input: "acme.ελ",
    registrable_domain: "acme.xn--qxam",
    public_suffix: "xn--qxam",
  },
  {
    input: "foo.bar.ck",
    registrable_domain: "foo.bar.ck",
    public_suffix: "bar.ck",
  },
  { input: "bar.ck", registrable_domain: null, public_suffix: "bar.ck" },
  { input: "www.ck", registrable_domain: "www.ck", public_suffix: "ck" },
  { input: "a.www.ck", registrable_domain: "www.ck", public_suffix: "ck" },
  {
    input: "city.kawasaki.jp",
    registrable_domain: "city.kawasaki.jp",
    public_suffix: "kawasaki.jp",
  },
  {
    input: "foo.bar.kawasaki.jp",
    registrable_domain: "foo.bar.kawasaki.jp",
    public_suffix: "bar.kawasaki.jp",
  },
  {
    input: "example.zzunlisted",
    registrable_domain: "example.zzunlisted",
    public_suffix: "zzunlisted",
  },
  { input: "localhost", registrable_domain: null, public_suffix: "localhost" },
  { input: "192.168.1.1", registrable_domain: null, public_suffix: null },
  { input: "[::1]", registrable_domain: null, public_suffix: null },
  { input: "", registrable_domain: null, public_suffix: null },
  {
    input: "https://jobs.lever.co/acme/123",
    registrable_domain: "lever.co",
    public_suffix: "co",
  },
  {
    input: "boards.greenhouse.io",
    registrable_domain: "greenhouse.io",
    public_suffix: "io",
  },
  {
    input: "nvidia.wd5.myworkdayjobs.com",
    registrable_domain: "myworkdayjobs.com",
    public_suffix: "com",
  },
  {
    input: "id.indeed.com",
    registrable_domain: "indeed.com",
    public_suffix: "com",
  },
];

export const NORMALIZE_TEXT_CASES: { input: string; output: string }[] = [
  { input: "Backend Engineer", output: "backend engineer" },
  {
    input: "  Senior   Software\tEngineer \n",
    output: "senior software engineer",
  },
  {
    input: "Ｓｏｆｔｗａｒｅ\u3000Ｅｎｇｉｎｅｅｒ",
    output: "software engineer",
  },
  { input: "C++ Developer", output: "c++ developer" },
  { input: "C# / .NET", output: "c# / .net" },
  { input: "CI/CD Engineer", output: "ci/cd engineer" },
  { input: "Full-Stack Developer", output: "full-stack developer" },
  { input: "R&D Engineer", output: "rd engineer" },
  {
    input: "Backend Engineer — Payments | Remote",
    output: "backend engineer payments remote",
  },
  { input: "Engineer (Remote)", output: "engineer remote" },
  { input: "Data\u00a0Engineer\u200b", output: "data engineer" },
  { input: "🚀 Growth Marketer", output: "growth marketer" },
  { input: "Ingenieur (m/w/d) – München", output: "ingenieur m/w/d münchen" },
  { input: "São Paulo, Brasil", output: "são paulo brasil" },
  { input: "Straße", output: "straße" },
  { input: "ΟΔΟΣ", output: "οδος" },
  { input: "50% Remote! $120k+", output: "50 remote 120k+" },
  { input: "Sr. Node.js Developer", output: "sr. node.js developer" },
  { input: "“Quoted” ‘Title’", output: "quoted title" },
  { input: "Ⅳ ﬁnance", output: "iv finance" },
  { input: "\u0085x\u3000y\u2028z", output: "x y z" },
  { input: "", output: "" },
  { input: " , ; ", output: "" },
];

export const CONTENT_HASH_CASES: { description: string; title: string }[] = [
  {
    title: "Backend Engineer",
    description: "Build APIs in Go.\nWork with PostgreSQL.",
  },
  {
    title: "  BACKEND   engineer ",
    description: "Build APIs in Go. Work with PostgreSQL.",
  },
  { title: "Data Engineer", description: "" },
  {
    title: "Insinyur Data",
    description: "Membangun pipeline data — Python & SQL.",
  },
];

export const DEDUPE_GROUP_CASES: {
  input: {
    company_domain: string | null;
    location_primary: string | null;
    title: string;
  };
  key: string | null;
}[] = [
  {
    input: {
      company_domain: "careers.acme.com",
      title: "Backend Engineer",
      location_primary: "Jakarta, Indonesia",
    },
    key: "acme.com|backend engineer|jakarta indonesia",
  },
  {
    input: {
      company_domain: "ACME.COM",
      title: "backend   engineer",
      location_primary: "Jakarta Indonesia",
    },
    key: "acme.com|backend engineer|jakarta indonesia",
  },
  {
    input: {
      company_domain: "acme.co.uk",
      title: "Nurse",
      location_primary: null,
    },
    key: "acme.co.uk|nurse|",
  },
  {
    input: { company_domain: null, title: "Nurse", location_primary: "London" },
    key: null,
  },
];

export const LEGACY_CASES: {
  key: string;
  legacy_id: string;
  user_id: string;
}[] = [
  {
    user_id: "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    legacy_id: "3f2b9c1e-7a6d-4e2f-9b1c-0d8e7f6a5b4c",
    key: "legacy|usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D|3f2b9c1e-7a6d-4e2f-9b1c-0d8e7f6a5b4c",
  },
  {
    user_id: "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    legacy_id: "backend-engineer-acme",
    key: "legacy|usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D|backend-engineer-acme",
  },
];

/** ULID time encodings (the ULID spec example is 1469918176385 → 01ARYZ6S41). */
export const ULID_TIME_CASES: { ms: number; time: string }[] = [
  { ms: 0, time: "0000000000" },
  { ms: 1, time: "0000000001" },
  { ms: 31, time: "000000000Z" },
  { ms: 32, time: "0000000010" },
  { ms: 1_469_918_176_385, time: "01ARYZ6S41" },
  { ms: 281_474_976_710_655, time: "7ZZZZZZZZZ" },
];

export const ID_VALIDITY_CASES: {
  prefix: string;
  valid: boolean;
  value: string;
}[] = [
  { prefix: "app", value: "app_01JA6V8M3W8Z1T6Q4Y2B7K9C0D", valid: true },
  { prefix: "app", value: "app_01ja6v8m3w8z1t6q4y2b7k9c0d", valid: false },
  { prefix: "app", value: "app_81JA6V8M3W8Z1T6Q4Y2B7K9C0D", valid: false },
  { prefix: "app", value: "app_01JA6V8M3W8Z1T6Q4Y2B7K9C0", valid: false },
  { prefix: "app", value: "app_01JA6V8M3W8Z1T6Q4Y2B7K9COD", valid: false },
  { prefix: "app", value: "evt_01JA6V8M3W8Z1T6Q4Y2B7K9C0D", valid: false },
  { prefix: "obs", value: "obs_01JA6V8M3W8Z1T6Q4Y2B7K9C0D", valid: true },
  { prefix: "lse", value: "lse_7ZZZZZZZZZZZZZZZZZZZZZZZZZ", valid: true },
];

/**
 * The legal stage edges with their actors, restated by hand from 03 §5.1 and
 * the driver's interpretation (PLAN leaf-1.1 brief). stage.ts must agree.
 */
export const LEGAL_STAGE_EDGES: [string, string, string[]][] = [
  ["saved", "preparing", ["user", "system"]],
  ["saved", "ready", ["user", "automation"]],
  ["saved", "applied", ["user", "automation"]],
  ["saved", "withdrawn", ["user"]],
  ["saved", "rejected", ["user"]],
  ["preparing", "ready", ["user", "automation", "system"]],
  ["preparing", "applied", ["user", "automation"]],
  ["preparing", "withdrawn", ["user"]],
  ["preparing", "rejected", ["user"]],
  ["ready", "preparing", ["user"]],
  ["ready", "applied", ["user", "automation"]],
  ["ready", "withdrawn", ["user"]],
  ["ready", "rejected", ["user"]],
  ["applied", "interviewing", ["user"]],
  ["applied", "offer", ["user"]],
  ["applied", "withdrawn", ["user"]],
  ["applied", "rejected", ["user"]],
  ["interviewing", "offer", ["user"]],
  ["interviewing", "withdrawn", ["user"]],
  ["interviewing", "rejected", ["user"]],
  ["offer", "accepted", ["user"]],
  ["offer", "withdrawn", ["user"]],
  ["offer", "rejected", ["user"]],
  ["rejected", "saved", ["user"]],
  ["withdrawn", "saved", ["user"]],
];
