// pilih-jobs form extraction, version 1 (job-tracker-spec 18 §6.2).
//
// A static asset evaluated by PageObserver with frame.evaluate(script, args) in each
// frame it observes. It assigns stable refs (data-pj-ref) to candidate elements and
// returns PLAIN DATA ONLY: fields, controls, errors and detection signals. It never
// clicks, types, navigates or reads cookies/storage. Labels and texts are untrusted page
// content; Python classifies controls, computes signatures and the form hash.
//
// args: { prefix: "" | "fr<n>:", start: <int>, issued: [<ref>…], maxFields, maxOptions,
//         maxControls, textLimit, confirmSelectors: [<css>…] }
(args) => {
  const VERSION = 1;
  const prefix = String(args.prefix || "");
  let counter = Number(args.start) | 0;
  const issued = new Set(Array.isArray(args.issued) ? args.issued : []);
  const maxFields = Number(args.maxFields) || 300;
  const maxOptions = Number(args.maxOptions) || 200;
  const maxControls = Number(args.maxControls) || 120;
  const textLimit = Number(args.textLimit) || 16384;
  const seenRefs = new Set();

  // Liveness counter for the executor's click postcondition (18 §6.3).
  if (!window.__pjMutationObserver) {
    window.__pjMutations = 0;
    try {
      window.__pjMutationObserver = new MutationObserver((records) => {
        window.__pjMutations = (window.__pjMutations || 0) + records.length;
      });
      window.__pjMutationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    } catch (_e) {
      window.__pjMutationObserver = true;
    }
  }

  const collapse = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const clip = (s, n) => {
    const t = collapse(s);
    return t.length > n ? t.slice(0, n) : t;
  };

  // ------------------------------------------------------------------ traversal
  const parentComposed = (n) => {
    if (!n) return null;
    if (n.parentElement) return n.parentElement;
    const root = n.getRootNode ? n.getRootNode() : null;
    return root && root.host ? root.host : null;
  };

  const all = [];
  const closedShadows = [];
  const walk = (root) => {
    const kids = root.children || [];
    for (const el of kids) {
      all.push(el);
      if (el.shadowRoot) {
        walk(el.shadowRoot);
      } else if (
        el.tagName.includes("-") &&
        el.children.length === 0 &&
        !el.shadowRoot
      ) {
        const r = el.getBoundingClientRect();
        if (r.width >= 10 && r.height >= 10 && !collapse(el.textContent)) {
          closedShadows.push({ tag: el.tagName.toLowerCase(), box: boxOf(r) });
        }
      }
      if (el.tagName !== "IFRAME" && el.tagName !== "FRAME") walk(el);
    }
  };

  const boxOf = (r) => ({
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  });
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const inViewport = (r) => r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;

  // ------------------------------------------------------------------ visibility
  const hiddenByAncestors = (el) => {
    for (let n = el; n; n = parentComposed(n)) {
      if (n.nodeType !== 1) continue;
      if (n.hasAttribute("inert")) return true;
      if (n.getAttribute("aria-hidden") === "true") return true;
    }
    return false;
  };
  const boxVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const style = getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const x = r.left + window.scrollX;
    const y = r.top + window.scrollY;
    if (x + r.width <= 0 || y + r.height <= 0) return false; // pushed off-canvas
    return true;
  };
  const isVisible = (el) => !hiddenByAncestors(el) && boxVisible(el);

  // ------------------------------------------------------------------ text
  const CONTROL_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "OPTION", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const visibleText = (node, depth) => {
    if (!node || (depth || 0) > 12) return "";
    let out = "";
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        out += child.nodeValue;
      } else if (child.nodeType === 1) {
        if (CONTROL_TAGS.has(child.tagName)) continue;
        const role = child.getAttribute("role");
        if (role === "listbox" || role === "option") continue;
        if (child.getAttribute("aria-hidden") === "true") continue;
        const style = getComputedStyle(child);
        if (style.display === "none" || style.visibility === "hidden") continue;
        out += " " + visibleText(child, (depth || 0) + 1) + " ";
      }
    }
    return out;
  };
  const rootOf = (el) => (el.getRootNode ? el.getRootNode() : document);
  const byId = (el, id) => {
    const root = rootOf(el);
    return (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id);
  };
  const idrefText = (el, attr) => {
    const ids = collapse(el.getAttribute(attr)).split(" ").filter(Boolean);
    return collapse(
      ids
        .map((id) => {
          const target = byId(el, id);
          return target ? visibleText(target) || target.textContent : "";
        })
        .join(" ")
    );
  };
  const humanize = (s) =>
    collapse(
      String(s || "")
        .replace(/\[(\d+)\]/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_\-\[\].]+/g, " ")
    ).toLowerCase();

  const CONTAINER_SEL =
    "fieldset, [role=group], [role=radiogroup], .field, .question, .form-group, .application-question, [class*='field'], [class*='question'], [class*='form-group']";
  const LABEL_LIKE_SEL = "label, legend, .label, [class*='label'], h3, h4, h5, p, span, div";
  const UPLOAD_VERB_RE = /^(attach|upload|choose|browse|select|pilih|unggah|lampirkan)\b/i;

  const fieldContainers = (el) => {
    const out = [];
    let n = parentComposed(el);
    for (let i = 0; n && i < 6; i += 1, n = parentComposed(n)) {
      if (n.tagName === "FORM" || n.tagName === "BODY") break;
      if (n.matches && n.matches(CONTAINER_SEL)) out.push(n);
    }
    return out;
  };
  const fieldContainer = (el) => fieldContainers(el)[0] || null;

  // The nearest label-like text before `el` inside `container` (18 §6.2 rule 5).
  const precedingLabelText = (container, el) => {
    if (!container) return "";
    const nodes = Array.from(container.querySelectorAll(LABEL_LIKE_SEL));
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      if (node.contains(el)) continue;
      if (!(node.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (node.querySelector && node.querySelector("input, select, textarea, [contenteditable], button")) continue;
      const t = collapse(visibleText(node));
      if (t && t.length <= 300) return t;
    }
    return "";
  };
  const containerLabel = (el) => {
    for (const container of fieldContainers(el)) {
      let legend = "";
      if (container.tagName === "FIELDSET") {
        const lg = container.querySelector("legend");
        if (lg && !lg.contains(el)) legend = collapse(visibleText(lg));
      }
      const preceding = precedingLabelText(container, el);
      const text = legend && preceding && legend !== preceding ? `${legend} ${preceding}` : legend || preceding;
      if (text) return text;
    }
    return "";
  };

  const resolveLabel = (el, opts) => {
    const sources = [];
    const texts = [];
    const add = (source, text) => {
      const t = collapse(text);
      if (t) {
        sources.push(source);
        texts.push(t);
      }
    };
    if (el.hasAttribute("aria-labelledby")) add("aria-labelledby", idrefText(el, "aria-labelledby"));
    add("aria-label", el.getAttribute("aria-label"));
    let labelFor = "";
    if (el.id) {
      const root = rootOf(el);
      const labels = root.querySelectorAll ? root.querySelectorAll("label[for]") : [];
      for (const label of labels) {
        if (label.htmlFor === el.id) {
          labelFor = collapse(visibleText(label));
          if (labelFor) break;
        }
      }
    }
    if (opts && opts.hiddenFile && UPLOAD_VERB_RE.test(labelFor)) labelFor = "";
    add("label_for", labelFor);
    const wrapping = el.closest ? el.closest("label") : null;
    if (wrapping && !(opts && opts.skipWrapping)) add("label_wrapping", visibleText(wrapping));
    add("container", containerLabel(el));
    add("placeholder", el.getAttribute("placeholder"));
    add("title", el.getAttribute("title"));
    add("name", humanize(el.getAttribute("name") || el.id || ""));
    return { label: texts[0] || "", sources: sources.slice(0, 8), raw: texts[0] || "" };
  };

  const describe = (el) => {
    let text = el.hasAttribute("aria-describedby") ? idrefText(el, "aria-describedby") : "";
    if (!text) {
      const container = fieldContainer(el);
      if (container) {
        const help = container.querySelector(".help, .hint, .description, .instructions, [class*='help'], [class*='hint'], small");
        if (help && !help.contains(el)) text = collapse(visibleText(help));
      }
    }
    return clip(text, 300);
  };

  const sectionOf = (el) => {
    let n = el;
    for (let depth = 0; n && depth < 12; depth += 1, n = parentComposed(n)) {
      if (n.tagName === "FIELDSET") {
        const lg = n.querySelector("legend");
        if (lg && !lg.contains(el)) return clip(visibleText(lg), 120);
      }
      let sib = n.previousElementSibling;
      for (let i = 0; sib && i < 25; i += 1, sib = sib.previousElementSibling) {
        if (/^H[1-6]$/.test(sib.tagName) || sib.getAttribute("role") === "heading") {
          return clip(visibleText(sib) || sib.textContent, 120);
        }
        const inner = sib.querySelector && sib.querySelector("h1, h2, h3, h4, h5, h6, [role=heading]");
        if (inner) return clip(visibleText(inner) || inner.textContent, 120);
      }
    }
    return "";
  };

  const STAR_RE = /\*\s*$/;
  const cleanLabel = (s) =>
    clip(
      collapse(s)
        .replace(/\s*\((required|wajib|optional|opsional)\)\s*$/i, "")
        .replace(/\s*\*+\s*$/, "")
        .replace(/\s*:\s*$/, ""),
      300
    );

  const isRequired = (el, labelRaw) => {
    if (el.required) return true;
    if (el.getAttribute("aria-required") === "true") return true;
    if (STAR_RE.test(labelRaw || "")) return true;
    const container = fieldContainer(el);
    if (container) {
      if (container.hasAttribute("data-required") && container.getAttribute("data-required") !== "false") return true;
      if (container.classList && container.classList.contains("required")) return true;
    }
    return false;
  };

  // ------------------------------------------------------------------ refs
  const refByEl = new Map();
  const assignRef = (el) => {
    if (refByEl.has(el)) return refByEl.get(el);
    let ref = el.getAttribute("data-pj-ref");
    const ours = !!ref && ref.startsWith(prefix) && /^f\d+$/.test(ref.slice(prefix.length));
    if (!ours || !issued.has(ref) || seenRefs.has(ref)) {
      counter += 1;
      ref = `${prefix}f${counter}`;
      el.setAttribute("data-pj-ref", ref);
    }
    seenRefs.add(ref);
    refByEl.set(el, ref);
    return ref;
  };

  const formActionPath = (el) => {
    const form = el.form || (el.closest ? el.closest("form") : null);
    try {
      return new URL(form ? form.getAttribute("action") || location.href : location.href, location.href).pathname;
    } catch (_e) {
      return location.pathname;
    }
  };

  const isDisabled = (el) =>
    !!el.disabled ||
    el.getAttribute("aria-disabled") === "true" ||
    !!(el.closest && el.closest("fieldset[disabled]"));

  // ------------------------------------------------------------------ classification
  const TEXT_TYPES = {
    text: "text", search: "text", email: "email", tel: "tel", url: "url", number: "number",
    date: "date", month: "month", "datetime-local": "text", time: "text", week: "text",
    password: "text",
  };
  const BUTTON_INPUT_TYPES = new Set(["submit", "button", "image"]);

  const fields = [];
  const controls = [];
  const fieldEls = [];
  const groupByKey = new Map();
  const hiddenFiles = [];

  const optionOf = (opt) => ({
    value: clip(opt.value, 200),
    label: clip(opt.label || opt.textContent, 200),
    selected: !!opt.selected,
    disabled: !!opt.disabled,
  });

  const ariaOptions = (listbox) => {
    if (!listbox) return [];
    const opts = Array.from(listbox.querySelectorAll("[role=option]")).slice(0, maxOptions);
    return opts.map((o) => ({
      value: clip(o.getAttribute("data-value") || o.getAttribute("value") || o.id || o.textContent, 200),
      label: clip(o.getAttribute("aria-label") || visibleText(o) || o.textContent, 200),
      selected: o.getAttribute("aria-selected") === "true",
      disabled: o.getAttribute("aria-disabled") === "true",
    }));
  };

  const pushField = (el, kind, extra) => {
    if (fields.length >= maxFields) return null;
    const lab = resolveLabel(el, extra && extra.labelOpts);
    const labelRaw = lab.raw;
    const ref = assignRef(el);
    const r = (extra && extra.boxEl ? extra.boxEl : el).getBoundingClientRect();
    const field = {
      ref,
      kind,
      tag: el.tagName.toLowerCase(),
      input_type: (el.getAttribute("type") || "").toLowerCase() || null,
      name: el.getAttribute("name") || null,
      id_attr: el.id || null,
      autocomplete: el.getAttribute("autocomplete") || null,
      label: cleanLabel(labelRaw),
      label_sources: lab.sources,
      description: describe(el),
      required: isRequired(el, labelRaw),
      options: [],
      options_dynamic: false,
      accept: null,
      multiple: !!el.multiple,
      value: null,
      checked: null,
      has_value: false,
      disabled: isDisabled(el),
      readonly: !!el.readOnly || el.getAttribute("aria-readonly") === "true",
      invalid: false,
      validation_message: null,
      section: sectionOf(el) || null,
      action_path: formActionPath(el),
      box: boxOf(r),
      in_viewport: inViewport(r),
      hidden_input: false,
      trigger_ref: null,
      group: null,
      masked: !!(el.getAttribute("data-mask") || el.getAttribute("mask") || el.getAttribute("data-inputmask")),
      file_names: [],
      options_truncated: false,
    };
    if (extra) Object.assign(field, extra.fields || {});
    fields.push(field);
    fieldEls.push(el);
    return field;
  };

  const setValueState = (field, el) => {
    const kind = field.kind;
    if (kind === "select") {
      const opts = Array.from(el.options || []);
      field.options_truncated = opts.length > maxOptions;
      field.options = opts.slice(0, maxOptions).map(optionOf);
      const selected = opts.filter((o) => o.selected && o.value !== "");
      field.value = selected.map((o) => o.value).join("\n") || "";
      field.has_value = selected.length > 0;
    } else if (kind === "checkbox") {
      const checked = el.tagName === "INPUT" ? !!el.checked : el.getAttribute("aria-checked") === "true";
      field.checked = checked;
      field.value = checked ? "true" : "false";
      field.has_value = checked;
    } else if (kind === "file") {
      field.accept = el.getAttribute("accept") ? clip(el.getAttribute("accept"), 200) : null;
      field.file_names = Array.from(el.files || []).map((f) => clip(f.name, 255));
      field.has_value = field.file_names.length > 0;
      field.value = field.file_names.join("\n");
    } else if (kind === "contenteditable") {
      field.value = el.innerText || "";
      field.has_value = !!collapse(field.value);
    } else if (kind === "combobox") {
      const listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      const listbox = listId ? byId(el, listId) : null;
      let options = ariaOptions(listbox);
      if (!options.length && el.list) {
        options = Array.from(el.list.options || []).slice(0, maxOptions).map(optionOf);
      }
      if (!options.length && el.getAttribute("role") === "listbox") options = ariaOptions(el);
      field.options = options;
      field.options_dynamic = options.length === 0;
      const v = el.value !== undefined ? el.value : collapse(el.textContent);
      field.value = String(v || "");
      field.has_value = !!collapse(field.value) || options.some((o) => o.selected);
    } else {
      field.value = String(el.value || "");
      field.has_value = field.value.length > 0;
    }
    if (el.getAttribute("aria-invalid") === "true") {
      field.invalid = true;
    } else if (field.has_value && el.matches && el.matches(":invalid") && el.validationMessage) {
      field.invalid = true;
    }
    if (field.invalid) {
      field.validation_message =
        clip(el.validationMessage || (el.hasAttribute("aria-errormessage") ? idrefText(el, "aria-errormessage") : ""), 300) || null;
    }
  };

  const associatedLabelVisible = (el) => {
    const labels = el.labels ? Array.from(el.labels) : [];
    return labels.some((l) => isVisible(l));
  };

  walk(document);
  const controlledIds = new Set();
  for (const cb of document.querySelectorAll("[role=combobox], input[aria-autocomplete]")) {
    for (const attr of ["aria-controls", "aria-owns"]) {
      collapse(cb.getAttribute(attr)).split(" ").filter(Boolean).forEach((id) => controlledIds.add(id));
    }
  }
  const SKIP_INPUT_TYPES = new Set(["hidden", "reset", "color", "range"]);
  for (const el of all) {
    if (fields.length >= maxFields && controls.length >= maxControls) break;
    const tag = el.tagName;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) continue;
      if (BUTTON_INPUT_TYPES.has(type)) {
        if (isVisible(el)) controls.push({ el, kind: type === "button" ? "button" : "submit" });
        continue;
      }
      if (type === "file") {
        if (isVisible(el)) {
          const f = pushField(el, "file");
          if (f) setValueState(f, el);
        } else if (!hiddenByAncestors(el)) {
          hiddenFiles.push(el);
        }
        continue;
      }
      if (type === "radio" || type === "checkbox") {
        if (!(isVisible(el) || (!hiddenByAncestors(el) && associatedLabelVisible(el)))) continue;
        const form = el.form || el.closest("form");
        const name = el.getAttribute("name");
        const key = name ? `${type}|${name}|${form ? Array.prototype.indexOf.call(document.forms, form) : -1}` : null;
        if (key) {
          let group = groupByKey.get(key);
          if (!group) {
            group = { type, els: [] };
            groupByKey.set(key, group);
            group.order = fields.length;
            group.placeholderIndex = fields.length;
            fields.push(null);
            fieldEls.push(null);
          }
          group.els.push(el);
          continue;
        }
        if (type === "checkbox") {
          const f = pushField(el, "checkbox", { labelOpts: { skipWrapping: false } });
          if (f) setValueState(f, el);
        }
        continue;
      }
      if (!isVisible(el)) continue;
      if (el.getAttribute("role") === "combobox" || el.hasAttribute("list") || el.getAttribute("aria-autocomplete")) {
        const f = pushField(el, "combobox");
        if (f) setValueState(f, el);
        continue;
      }
      const kind = TEXT_TYPES[type] || "text";
      const f = pushField(el, kind);
      if (f) setValueState(f, el);
      continue;
    }
    if (tag === "TEXTAREA") {
      if (!isVisible(el)) continue;
      const f = pushField(el, "textarea");
      if (f) setValueState(f, el);
      continue;
    }
    if (tag === "SELECT") {
      if (!isVisible(el)) continue;
      const f = pushField(el, "select");
      if (f) setValueState(f, el);
      continue;
    }
    if (tag === "BUTTON" || role === "button") {
      if (isVisible(el) && !(el.closest && el.closest("[role=listbox]"))) {
        const kind = tag === "BUTTON" && el.type === "submit" && el.form ? "submit" : "button";
        controls.push({ el, kind });
      }
      continue;
    }
    if (tag === "A" && el.hasAttribute("href")) {
      if (isVisible(el)) controls.push({ el, kind: "link" });
      continue;
    }
    if (role === "combobox" || role === "listbox") {
      if (!isVisible(el)) continue;
      if (role === "listbox" && (el.closest("[role=combobox]") || (el.id && controlledIds.has(el.id)))) continue;
      const f = pushField(el, "combobox");
      if (f) setValueState(f, el);
      continue;
    }
    if (role === "radiogroup") {
      if (!isVisible(el)) continue;
      const radios = Array.from(el.querySelectorAll("[role=radio]"));
      if (!radios.length) continue;
      const f = pushField(el, "radio_group");
      if (f) {
        f.options = radios.slice(0, maxOptions).map((r) => ({
          value: clip(r.getAttribute("data-value") || r.getAttribute("value") || r.id || r.textContent, 200),
          label: clip(r.getAttribute("aria-label") || visibleText(r) || r.textContent, 200),
          selected: r.getAttribute("aria-checked") === "true",
          disabled: r.getAttribute("aria-disabled") === "true",
        }));
        radios.forEach((r) => r.setAttribute("data-pj-group", f.ref));
        const sel = f.options.find((o) => o.selected);
        f.value = sel ? sel.value : "";
        f.has_value = !!sel;
        f.required = f.required || radios.some((r) => r.getAttribute("aria-required") === "true");
      }
      continue;
    }
    if (role === "checkbox" || role === "switch") {
      if (!isVisible(el)) continue;
      const f = pushField(el, "checkbox");
      if (f) setValueState(f, el);
      continue;
    }
    if (el.isContentEditable) {
      if (!isVisible(el)) continue;
      const parentEditable = parentComposed(el);
      if (parentEditable && parentEditable.isContentEditable) continue;
      const f = pushField(el, "contenteditable");
      if (f) setValueState(f, el);
      continue;
    }
  }

  // ------------------------------------------------------------------ groups
  for (const group of groupByKey.values()) {
    const els = group.els;
    const first = els[0];
    if (group.type === "checkbox" && els.length === 1) {
      const saved = fields.length;
      const f = pushField(first, "checkbox");
      if (f) {
        setValueState(f, first);
        fields.splice(saved, 1);
        fieldEls.splice(saved, 1);
        fields[group.placeholderIndex] = f;
        fieldEls[group.placeholderIndex] = first;
      }
      continue;
    }
    const kind = group.type === "radio" ? "radio_group" : "checkbox_group";
    const container = first.closest("fieldset, [role=radiogroup], [role=group]") || fieldContainer(first);
    const saved = fields.length;
    const f = pushField(first, kind, { labelOpts: { skipWrapping: true }, boxEl: container || first });
    if (!f) continue;
    fields.splice(saved, 1);
    fieldEls.splice(saved, 1);
    fields[group.placeholderIndex] = f;
    fieldEls[group.placeholderIndex] = first;
    if (container && container.tagName === "FIELDSET") {
      const lg = container.querySelector("legend");
      const legendText = lg ? collapse(visibleText(lg)) : "";
      if (legendText) {
        f.label = cleanLabel(legendText);
        f.label_sources = ["container"].concat(f.label_sources.filter((s) => s !== "container")).slice(0, 8);
        if (STAR_RE.test(legendText)) f.required = true;
      }
    } else if (f.label_sources[0] === "label_for" || f.label_sources[0] === "aria-label") {
      const pre = precedingLabelText(container, first);
      if (pre) {
        f.label = cleanLabel(pre);
        if (STAR_RE.test(pre)) f.required = true;
        f.label_sources = ["container"].concat(f.label_sources.filter((s) => s !== "container")).slice(0, 8);
      }
    }
    f.options = els.slice(0, maxOptions).map((r) => {
      const lab = resolveLabel(r);
      return {
        value: clip(r.value, 200),
        label: clip(cleanLabel(lab.raw) || r.value, 200),
        selected: !!r.checked,
        disabled: !!r.disabled,
      };
    });
    f.options_truncated = els.length > maxOptions;
    els.forEach((r) => r.setAttribute("data-pj-group", f.ref));
    const checked = els.filter((r) => r.checked).map((r) => r.value);
    f.value = checked.join("\n");
    f.has_value = checked.length > 0;
    f.required = f.required || els.some((r) => r.required || r.getAttribute("aria-required") === "true");
    f.disabled = els.every((r) => isDisabled(r));
  }

  // ------------------------------------------------------------------ hidden file inputs
  const uploadFor = new Map();
  for (const input of hiddenFiles) {
    let trigger = null;
    if (input.id) {
      const root = rootOf(input);
      for (const label of root.querySelectorAll ? root.querySelectorAll("label[for]") : []) {
        if (label.htmlFor === input.id && isVisible(label)) {
          trigger = label;
          break;
        }
      }
      if (!trigger) {
        for (const b of root.querySelectorAll ? root.querySelectorAll("[aria-controls]") : []) {
          if (collapse(b.getAttribute("aria-controls")).split(" ").includes(input.id) && isVisible(b)) {
            trigger = b;
            break;
          }
        }
      }
    }
    if (!trigger) {
      const UPLOAD_TEXT_RE = /attach|upload|choose|browse|select file|resume|cv\b|file|pilih|unggah|lampir/i;
      let n = parentComposed(input);
      for (let i = 0; n && !trigger && i < 3; i += 1, n = parentComposed(n)) {
        let fallback = null;
        for (const b of n.querySelectorAll("button, [role=button], input[type=button]")) {
          if (!isVisible(b)) continue;
          const t = collapse(visibleText(b) || b.getAttribute("aria-label") || b.value);
          if (!t) continue;
          if (UPLOAD_TEXT_RE.test(t)) {
            trigger = b;
            break;
          }
          if (!fallback) fallback = b;
        }
        if (!trigger && fallback && n.tagName !== "FORM") trigger = fallback;
        if (n.tagName === "FORM") break;
      }
    }
    if (!trigger) continue;
    const f = pushField(input, "file", { labelOpts: { hiddenFile: true }, boxEl: trigger, fields: { hidden_input: true } });
    if (!f) continue;
    setValueState(f, input);
    const triggerRef = assignRef(trigger);
    f.trigger_ref = triggerRef;
    uploadFor.set(trigger, f.ref);
    if (!controls.some((c) => c.el === trigger)) controls.push({ el: trigger, kind: "button" });
  }

  const finalFields = fields.filter(Boolean);
  const fieldByEl = new Map();
  fieldEls.forEach((el, i) => {
    if (el && fields[i]) fieldByEl.set(el, fields[i]);
  });

  // ------------------------------------------------------------------ controls
  const COOKIE_RE = /cookie|consent|gdpr|onetrust|cookiebot|truste|cmp-|privacy-banner|cc-banner/i;
  const inCookieBanner = (el) => {
    let n = el;
    for (let i = 0; n && i < 10; i += 1, n = parentComposed(n)) {
      if (n.nodeType !== 1) continue;
      const hint = `${n.id || ""} ${typeof n.className === "string" ? n.className : ""} ${n.getAttribute("aria-label") || ""} ${n.getAttribute("data-testid") || ""}`;
      if (COOKIE_RE.test(hint)) return true;
    }
    return false;
  };
  const formHasFields = (form) => {
    if (!form) return false;
    for (const el of fieldByEl.keys()) {
      if (form.contains(el)) return true;
    }
    return false;
  };
  const WIZARD_SEL = "form, [role=form], [class*='wizard'], [class*='step'], [class*='application']";
  const outControls = [];
  const seenControls = new Set();
  for (const c of controls) {
    if (outControls.length >= maxControls) break;
    const el = c.el;
    if (seenControls.has(el)) continue;
    seenControls.add(el);
    const ref = assignRef(el);
    const r = el.getBoundingClientRect();
    const form = el.form || (el.closest ? el.closest("form") : null);
    let text = collapse(visibleText(el));
    if (!text && el.tagName === "INPUT") text = collapse(el.value);
    if (!text) text = collapse(el.getAttribute("aria-label") || el.getAttribute("title") || "");
    if (!text) {
      const img = el.querySelector && el.querySelector("img[alt]");
      if (img) text = collapse(img.getAttribute("alt"));
    }
    const controlsFile = uploadFor.get(el) || null;
    let href = null;
    if (c.kind === "link") {
      try {
        href = el.href ? String(el.href) : null;
      } catch (_e) {
        href = null;
      }
    }
    let formAction = null;
    if (c.kind === "submit" && form) {
      try {
        // `button.formAction` falls back to the document URL, not the form's action.
        const own = el.getAttribute("formaction");
        formAction = own ? new URL(own, location.href).href : String(form.action || "") || null;
      } catch (_e) {
        formAction = null;
      }
    }
    outControls.push({
      ref,
      kind: c.kind,
      form_action: formAction,
      tag: el.tagName.toLowerCase(),
      type_attr: (el.getAttribute("type") || "").toLowerCase() || null,
      text: clip(text, 120),
      aria_label: clip(el.getAttribute("aria-label"), 120) || null,
      hint: clip(`${el.id || ""} ${el.getAttribute("name") || ""} ${el.getAttribute("data-qa") || ""} ${el.getAttribute("data-testid") || ""}`, 120),
      href,
      in_form: !!form,
      form_has_fields: formHasFields(form),
      in_wizard: !!(el.closest && el.closest(WIZARD_SEL)),
      in_cookie_banner: inCookieBanner(el),
      upload_for: controlsFile,
      enabled: !isDisabled(el),
      in_viewport: inViewport(r),
      box: boxOf(r),
    });
  }

  // ------------------------------------------------------------------ errors (18 §7.3)
  const errors = [];
  const seenErr = new Set();
  const pushErr = (ref, text) => {
    const t = clip(text, 300);
    if (!t || errors.length >= 30) return;
    const key = `${ref || ""}|${t}`;
    if (seenErr.has(key)) return;
    seenErr.add(key);
    errors.push({ ref, text: t });
  };
  const nearestFieldRef = (errEl) => {
    if (errEl.id) {
      for (const [el, f] of fieldByEl.entries()) {
        const ids = `${el.getAttribute("aria-describedby") || ""} ${el.getAttribute("aria-errormessage") || ""}`.split(/\s+/);
        if (ids.includes(errEl.id)) return f.ref;
      }
    }
    // The nearest small container holding exactly one field; page-level banners stay
    // unattached (ref null).
    let n = parentComposed(errEl);
    for (let i = 0; n && i < 4; i += 1, n = parentComposed(n)) {
      if (/^(FORM|BODY|MAIN|SECTION|ARTICLE|HTML)$/.test(n.tagName) || n.getAttribute("role") === "main") break;
      const inside = [];
      for (const [el, f] of fieldByEl.entries()) {
        if (n.contains(el)) inside.push(f.ref);
      }
      if (inside.length === 1) return inside[0];
      if (inside.length > 1) return null;
    }
    return null;
  };
  for (const f of finalFields) {
    if (f.invalid) pushErr(f.ref, f.validation_message || "Invalid value");
  }
  const ERROR_WORDS_RE = /error|invalid|required|must|please (enter|provide|select|fix|correct)|cannot|failed|try again|wajib|harus|tidak valid|gagal|kesalahan/i;
  for (const el of document.querySelectorAll("[role=alert], [aria-live=assertive]")) {
    if (!isVisible(el)) continue;
    const t = collapse(visibleText(el));
    if (t) pushErr(nearestFieldRef(el), t);
  }
  for (const el of document.querySelectorAll("[aria-live=polite], [role=status]")) {
    if (!isVisible(el)) continue;
    const t = collapse(visibleText(el));
    if (t && ERROR_WORDS_RE.test(t)) pushErr(nearestFieldRef(el), t);
  }
  for (const el of document.querySelectorAll(".error, .field-error, [data-error], .invalid-feedback, .error-message")) {
    if (!isVisible(el)) continue;
    if (fieldByEl.has(el)) continue;
    const t = collapse(visibleText(el));
    if (t) pushErr(nearestFieldRef(el), t);
  }

  // ------------------------------------------------------------------ signals (18 §8)
  const iframes = Array.from(document.querySelectorAll("iframe, frame")).slice(0, 40).map((f) => {
    const r = f.getBoundingClientRect();
    let src = "";
    try {
      src = f.src ? String(f.src) : f.getAttribute("src") || "";
    } catch (_e) {
      src = f.getAttribute("src") || "";
    }
    return { src, name: f.getAttribute("name") || "", title: clip(f.getAttribute("title"), 120), box: boxOf(r), visible: isVisible(f) };
  });
  const scripts = Array.from(document.querySelectorAll("script[src]")).slice(0, 120).map((s) => {
    try {
      return String(s.src);
    } catch (_e) {
      return s.getAttribute("src") || "";
    }
  });
  const q = (sel) => {
    try {
      return document.querySelector(sel) !== null;
    } catch (_e) {
      return false;
    }
  };
  const passwords = Array.from(document.querySelectorAll("input[type=password]"));
  const confirm = {};
  for (const sel of Array.isArray(args.confirmSelectors) ? args.confirmSelectors : []) {
    try {
      confirm[sel] = Array.from(document.querySelectorAll(sel)).some((e) => isVisible(e));
    } catch (_e) {
      confirm[sel] = false;
    }
  }
  const main = document.querySelector("main, [role=main]") || document.body;
  let mainText = "";
  try {
    mainText = main ? main.innerText || "" : "";
  } catch (_e) {
    mainText = "";
  }
  if (mainText.length > textLimit) mainText = mainText.slice(0, textLimit);

  return {
    version: VERSION,
    next: counter,
    url: location.href,
    origin: location.origin,
    title: clip(document.title, 200),
    fields: finalFields,
    controls: outControls,
    errors,
    opaque: closedShadows.slice(0, 10),
    signals: {
      iframes,
      scripts,
      turnstile: q("[name='cf-turnstile-response'], .cf-turnstile"),
      recaptcha: q(".g-recaptcha, [name='g-recaptcha-response']"),
      hcaptcha: q(".h-captcha, [name='h-captcha-response']"),
      password_visible: passwords.filter((p) => isVisible(p)).length,
      password_total: passwords.length,
      confirm,
      main_text: mainText,
      has_main: !!document.querySelector("main, [role=main]"),
      form_count: document.forms.length,
    },
  };
}
