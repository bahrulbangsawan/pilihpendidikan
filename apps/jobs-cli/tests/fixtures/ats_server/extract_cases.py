# ruff: noqa: E501 - fixture HTML and data rows are kept on one line
"""Static forms for the extraction-script unit tests (18 §13.1, T18-U-EXTRACT).

Each case is served at `/extract/<name>` on the apply host. `fields` lists the expected
`(label, kind, required)` of every extracted field in document order; `controls` lists
expected `(text, role_hint)` pairs that must be present; `opaque` is the expected number
of opaque regions; `options` maps a field label to its expected option labels.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from starlette.responses import Response
from tests.fixtures.ats_server.server import OTHER_HOST, Handler, PageCtx, html


@dataclass
class ExtractCase:
    name: str
    body: str
    fields: list[tuple[str, str, bool]]
    controls: list[tuple[str, str]] = field(default_factory=list)
    opaque: int = 0
    options: dict[str, list[str]] = field(default_factory=dict)
    absent_controls: list[str] = field(default_factory=list)


C = ExtractCase
CASES: list[ExtractCase] = [
    # ---------------------------------------------------------------- label resolution
    C(
        "aria_labelledby",
        '<span id="l1">Preferred name</span><input aria-labelledby="l1">',
        [("Preferred name", "text", False)],
    ),
    C(
        "aria_labelledby_multi",
        '<span id="a">Home</span><span id="b">address</span><input aria-labelledby="a b">',
        [("Home address", "text", False)],
    ),
    C("aria_label", '<input aria-label="Middle name">', [("Middle name", "text", False)]),
    C(
        "label_for",
        '<label for="x">Given name</label><input id="x">',
        [("Given name", "text", False)],
    ),
    C("label_wrapping", "<label>Nickname <input name=nick></label>", [("Nickname", "text", False)]),
    C(
        "fieldset_legend",
        "<fieldset><legend>Portfolio URL</legend><input type=url name=p></fieldset>",
        [("Portfolio URL", "url", False)],
    ),
    C(
        "container_text",
        '<div class="application-question"><div class="application-label">Current company</div><div class="application-field"><input name="org"></div></div>',
        [("Current company", "text", False)],
    ),
    C(
        "placeholder",
        '<input placeholder="City of residence">',
        [("City of residence", "text", False)],
    ),
    C("title_attr", '<input title="Postal code">', [("Postal code", "text", False)]),
    C("name_humanized", '<input name="first_name">', [("first name", "text", False)]),
    C("name_camel", '<input name="currentEmployer">', [("current employer", "text", False)]),
    C(
        "label_priority",
        '<label for="y">Visible label</label><input id="y" aria-label="Aria wins" placeholder="ph">',
        [("Aria wins", "text", False)],
    ),
    # ---------------------------------------------------------------- required detection
    C(
        "required_attr",
        "<label>Email <input type=email required></label>",
        [("Email", "email", True)],
    ),
    C(
        "aria_required",
        '<label>Phone <input type=tel aria-required="true"></label>',
        [("Phone", "tel", True)],
    ),
    C("star_label", '<label for="s">Surname *</label><input id="s">', [("Surname", "text", True)]),
    C(
        "container_required_class",
        '<div class="field required"><label for="r">School</label><input id="r"></div>',
        [("School", "text", True)],
    ),
    C(
        "data_required",
        '<div class="form-group" data-required="true"><label for="d">Degree</label><input id="d"></div>',
        [("Degree", "text", True)],
    ),
    C(
        "hidden_star_not_required",
        '<label for="h">Hobby<span style="display:none">*</span></label><input id="h">',
        [("Hobby", "text", False)],
    ),
    # ---------------------------------------------------------------- kinds and options
    C(
        "select_options",
        '<label for="c">Country</label><select id="c"><option value="">Pick</option><option value="ID">Indonesia</option><option value="SG" disabled>Singapore</option></select>',
        [("Country", "select", False)],
        options={"Country": ["Pick", "Indonesia", "Singapore"]},
    ),
    C(
        "radio_group",
        "<fieldset><legend>Willing to relocate? *</legend><label><input type=radio name=rel value=y> Yes</label><label><input type=radio name=rel value=n> No</label></fieldset>",
        [("Willing to relocate?", "radio_group", True)],
        options={"Willing to relocate?": ["Yes", "No"]},
    ),
    C(
        "checkbox_group",
        "<fieldset><legend>Languages</legend><label><input type=checkbox name=lang value=en> English</label><label><input type=checkbox name=lang value=id> Indonesian</label></fieldset>",
        [("Languages", "checkbox_group", False)],
        options={"Languages": ["English", "Indonesian"]},
    ),
    C(
        "single_checkbox",
        "<label><input type=checkbox name=terms required> I agree to the terms</label>",
        [("I agree to the terms", "checkbox", True)],
    ),
    C(
        "textarea",
        '<label for="t">Why do you want this job?</label><textarea id="t"></textarea>',
        [("Why do you want this job?", "textarea", False)],
    ),
    C(
        "date_month",
        "<label>Start date <input type=date name=sd></label><label>Graduation <input type=month name=gm></label>",
        [("Start date", "date", False), ("Graduation", "month", False)],
    ),
    C(
        "number_url",
        "<label>Years of experience <input type=number name=y></label><label>Website <input type=url name=w></label>",
        [("Years of experience", "number", False), ("Website", "url", False)],
    ),
    C(
        "combobox_static",
        '<label for="cb">Location</label><input id="cb" role="combobox" aria-controls="lb"><ul id="lb" role="listbox"><li role="option">Jakarta</li><li role="option">Bandung</li></ul>',
        [("Location", "combobox", False)],
        options={"Location": ["Jakarta", "Bandung"]},
    ),
    C(
        "combobox_dynamic",
        '<label for="cd">School</label><input id="cd" role="combobox" aria-autocomplete="list">',
        [("School", "combobox", False)],
    ),
    C(
        "contenteditable",
        '<div id="ce-l">Cover note</div><div contenteditable="true" aria-labelledby="ce-l" style="min-height:40px"></div>',
        [("Cover note", "contenteditable", False)],
    ),
    C(
        "file_visible",
        '<label for="f">Resume</label><input type=file id=f accept=".pdf">',
        [("Resume", "file", False)],
    ),
    C(
        "file_hidden_trigger",
        '<div class="field"><label>Cover letter</label><input type=file id=cl style="display:none"><button type=button onclick="cl.click()">Attach</button></div>',
        [("Cover letter", "file", False)],
        controls=[("Attach", "upload_trigger")],
    ),
    C(
        "many_options",
        "<label for=m>Pick</label><select id=m>"
        + "".join(f"<option>o{i}</option>" for i in range(250))
        + "</select>",
        [("Pick", "select", False)],
    ),
    # ---------------------------------------------------------------- hidden / inert
    C(
        "display_none",
        '<input name="ssn" style="display:none"><label>Visible <input name=v></label>',
        [("Visible", "text", False)],
    ),
    C(
        "visibility_hidden",
        '<input name="secret" style="visibility:hidden"><label>Shown <input name=s></label>',
        [("Shown", "text", False)],
    ),
    C(
        "aria_hidden_ancestor",
        '<div aria-hidden="true"><input name="trap"></div><label>Real <input name=r></label>',
        [("Real", "text", False)],
    ),
    C(
        "inert_ancestor",
        '<div inert><input name="trap"></div><label>Live <input name=l></label>',
        [("Live", "text", False)],
    ),
    C(
        "offscreen",
        '<input name="ssn" style="position:absolute;left:-9999px"><label>Kept <input name=k></label>',
        [("Kept", "text", False)],
    ),
    C(
        "zero_size",
        '<input name="tiny" style="width:0;height:0;border:0;padding:0"><label>Normal <input name=n></label>',
        [("Normal", "text", False)],
    ),
    C(
        "hidden_type",
        "<input type=hidden name=csrf value=1><label>Only <input name=o></label>",
        [("Only", "text", False)],
    ),
    # ---------------------------------------------------------------- shadow DOM and frames
    C(
        "open_shadow",
        '<div id="host"></div><script>const r=document.getElementById("host").attachShadow({mode:"open"});r.innerHTML=\'<label>Shadow field <input name="sh"></label>\';</script>',
        [("Shadow field", "text", False)],
    ),
    C(
        "closed_shadow",
        '<x-closed style="display:block;width:80px;height:40px"></x-closed><script>customElements.define("x-closed",class extends HTMLElement{constructor(){super();this.attachShadow({mode:"closed"}).innerHTML="<input>"}})</script><label>Outside <input name=o></label>',
        [("Outside", "text", False)],
        opaque=1,
    ),
    C(
        "same_origin_iframe",
        '<label>Top <input name=t></label><iframe src="/extract/frame_inner" width=400 height=120></iframe>',
        [("Top", "text", False), ("Inner field", "text", False)],
    ),
    C(
        "cross_origin_iframe",
        '<label>Top <input name=t></label><iframe src="http://'
        + OTHER_HOST
        + ':__PORT__/extract/frame_inner" title="Embedded" width=400 height=120></iframe>',
        [("Top", "text", False)],
        opaque=1,
    ),
    # ---------------------------------------------------------------- controls
    C(
        "controls_roles",
        '<form><label>Name <input name=n></label><button type=button>Back</button><button type=submit>Next</button><button type=button>Add another education</button><button type=button>Remove</button></form><a href="/elsewhere">Blog</a>',
        [("Name", "text", False)],
        controls=[
            ("Back", "previous"),
            ("Next", "next"),
            ("Add another education", "add_section"),
            ("Remove", "remove_section"),
            ("Blog", "navigation"),
        ],
    ),
    C(
        "submit_vs_apply",
        "<form><label>Email <input type=email name=e></label><button type=submit>Apply</button></form>",
        [("Email", "email", False)],
        controls=[("Apply", "submit")],
    ),
    C(
        "apply_entry",
        '<main><h1>Engineer</h1><a href="/apply-form">Apply now</a></main>',
        [],
        controls=[("Apply now", "apply_entry")],
    ),
    C(
        "cookie_banner",
        '<div class="cookie-consent"><button>Accept all</button><button>Reject all</button></div><label>Name <input name=n></label>',
        [("Name", "text", False)],
        controls=[("Accept all", "cookie_consent_accept"), ("Reject all", "cookie_consent_reject")],
    ),
    C(
        "login_controls",
        "<button>Sign in</button><button>Create account</button>",
        [],
        controls=[("Sign in", "login"), ("Create account", "sign_up")],
    ),
    C(
        "multilingual",
        "<form><label>Nama <input name=n></label><button type=button>Kembali</button><button type=submit>Lanjutkan</button></form>",
        [("Nama", "text", False)],
        controls=[("Kembali", "previous"), ("Lanjutkan", "next")],
    ),
]
FRAME_INNER = "<label>Inner field <input name=inner></label>"


def extract_handlers() -> dict[str, Handler]:
    handlers: dict[str, Handler] = {}

    def make(case: ExtractCase) -> Handler:
        async def handle(ctx: PageCtx) -> Response:
            return html(
                f"<main>{case.body.replace('__PORT__', str(ctx.port))}</main>", title=case.name
            )

        return handle

    for case in CASES:
        handlers[f"/extract/{case.name}"] = make(case)

    async def inner(ctx: PageCtx) -> Response:
        return html(FRAME_INNER, title="inner")

    handlers["/extract/frame_inner"] = inner
    return handlers
