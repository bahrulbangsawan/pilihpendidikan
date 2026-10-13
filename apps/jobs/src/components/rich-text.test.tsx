// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { safeHref } from "@/lib/safe-url";
import { render } from "@/test/render";
import { MarkdownLite, PlainText } from "./rich-text";

afterEach(() => {
  document.body.replaceChildren();
});

const SAFE_SCHEME_RE = /^(https?:|mailto:)/;

const HOSTILE = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(2)">',
  "[click me](javascript:alert(3))",
  "javascript:alert(4)",
  "[data](data:text/html;base64,PHNjcmlwdD4=)",
  "[rel](/settings)",
  '<a href="javascript:alert(5)">x</a>',
].join("\n\n");

describe("T11-XSS untrusted text renders inert", () => {
  it("T11-XSS a note with <script>, onerror and javascript: links creates no script, handler or unsafe link", () => {
    const view = render(<MarkdownLite text={HOSTILE} />);
    const { container } = view;
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    for (const anchor of container.querySelectorAll("a")) {
      expect(anchor.getAttribute("href")).toMatch(SAFE_SCHEME_RE);
    }
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("[click me](javascript:alert(3))");
    view.unmount();
  });

  it("T11-XSS a scraped posting renders as plain text; only http(s) URLs become links", () => {
    const view = render(
      <PlainText
        text={
          '<b>Apply</b> now: https://acme.example/jobs/1 or javascript:alert(1) <iframe src="x">'
        }
      />
    );
    const anchors = view.container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe(
      "https://acme.example/jobs/1"
    );
    expect(anchors[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchors[0]?.getAttribute("target")).toBe("_blank");
    expect(view.container.querySelector("b, iframe")).toBeNull();
    expect(view.container.textContent).toContain("<b>Apply</b>");
    view.unmount();
  });

  it("T11-XSS Markdown-lite keeps bold, italic, lists and safe links", () => {
    const view = render(
      <MarkdownLite
        text={
          "**Recruiter** called, _nice_.\n\n- send [portfolio](https://me.example)\n- mail me@example.com\n1. first"
        }
      />
    );
    expect(view.container.querySelector("strong")?.textContent).toBe(
      "Recruiter"
    );
    expect(view.container.querySelector("em")?.textContent).toBe("nice");
    expect(view.container.querySelectorAll("ul li")).toHaveLength(2);
    expect(view.container.querySelectorAll("ol li")).toHaveLength(1);
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe(
      "https://me.example/"
    );
    view.unmount();
  });

  it("T11-XSS safeHref allows only absolute http(s) and mailto", () => {
    expect(safeHref("https://acme.example/x")).toBe("https://acme.example/x");
    expect(safeHref("mailto:hr@acme.example")).toBe("mailto:hr@acme.example");
    expect(safeHref(" JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("vbscript:msgbox")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
    expect(safeHref("https://user:pass@acme.example")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
