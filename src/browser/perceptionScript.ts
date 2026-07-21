/**
 * The perception script — EVE's retina.
 *
 * Injected into the page by every adapter, it walks the rendered document
 * and returns only what a sighted human could perceive: visible text, its
 * geometry, and coarse affordance cues (looks clickable, looks editable,
 * looks disabled, holds focus). It deliberately discards anything invisible:
 * `display:none`/`visibility:hidden` subtrees, zero-area boxes, transparent
 * text and off-screen content beyond one viewport of scroll lookahead.
 *
 * The script is a plain string so the same code runs identically under
 * Playwright, Puppeteer and Selenium.
 */
export const PERCEPTION_SCRIPT = `
(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const results = [];
  const dialogs = [];
  let id = 0;

  const INTERACTIVE_TAGS = new Set(["A","BUTTON","INPUT","SELECT","TEXTAREA","SUMMARY","OPTION","LABEL"]);
  const ROLE_MAP = {
    button: "button", link: "link", textbox: "textbox", checkbox: "checkbox",
    radio: "radio", combobox: "select", listbox: "select", slider: "slider",
    tab: "tab", menuitem: "menuitem", option: "menuitem", progressbar: "progress",
    dialog: "dialog", alertdialog: "dialog", alert: "alert", heading: "heading",
    img: "image", listitem: "listitem", cell: "text", grid: "table", table: "table"
  };

  function toHex(cssColor) {
    const m = cssColor && cssColor.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return undefined;
    const parts = m[1].split(",").map(s => parseFloat(s));
    if (parts.length >= 4 && parts[3] === 0) return undefined;
    const hex = n => Math.round(n).toString(16).padStart(2, "0");
    return "#" + hex(parts[0]) + hex(parts[1]) + hex(parts[2]);
  }

  function roleOf(el, style) {
    const explicit = el.getAttribute("role");
    if (explicit && ROLE_MAP[explicit]) return ROLE_MAP[explicit];
    const tag = el.tagName;
    if (tag === "BUTTON") return "button";
    if (tag === "A" && el.hasAttribute("href")) return "link";
    if (tag === "SELECT") return "select";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "IMG" || tag === "SVG" || tag === "svg") return "image";
    if (tag === "PROGRESS") return "progress";
    if (tag === "DIALOG") return "dialog";
    if (tag === "LI") return "listitem";
    if (tag === "TABLE") return "table";
    if (/^H[1-6]$/.test(tag)) return "heading";
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "submit" || type === "button" || type === "image" || type === "reset") return "button";
      return "textbox";
    }
    if (style.cursor === "pointer") return "button";
    return "text";
  }

  function directText(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    text = text.replace(/\\s+/g, " ").trim();
    if (!text) {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        text = el.value || el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
        const lbl = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl && lbl.innerText) text = (lbl.innerText.replace(/\\s+/g," ").trim() + " " + text).trim();
      } else if (tag === "IMG") {
        text = el.getAttribute("alt") || "";
      } else if (tag === "SELECT") {
        const opt = el.selectedOptions && el.selectedOptions[0];
        text = (opt && opt.innerText) || el.getAttribute("aria-label") || "";
      } else {
        text = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      }
    }
    // Leaf-ish interactive containers (e.g. <a><span>Save</span></a>): use
    // the full innerText when it is short — a human reads the whole control.
    if (!text && el.innerText && el.innerText.length < 120 && el.childElementCount <= 3) {
      text = el.innerText.replace(/\\s+/g, " ").trim();
    }
    return text.slice(0, 300);
  }

  function isLoadingIndicator(el, style, role) {
    if (role === "progress") return true;
    if (el.getAttribute("aria-busy") === "true") return true;
    const cls = (el.className && typeof el.className === "string") ? el.className.toLowerCase() : "";
    return /\\b(spinner|loading|loader|skeleton)\\b/.test(cls);
  }

  let loadingIndicator = document.readyState !== "complete";
  const active = document.activeElement;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  let el = walker.currentNode;
  const maxElements = 600;

  while (el && results.length < maxElements) {
    if (el.nodeType === Node.ELEMENT_NODE && el.tagName !== "SCRIPT" && el.tagName !== "STYLE" && el.tagName !== "NOSCRIPT") {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.05) {
        // Skip entire invisible subtree.
        let next = walker.nextSibling();
        if (!next) {
          while (walker.parentNode() && !(next = walker.nextSibling()));
        }
        el = next;
        continue;
      }
      const rect = el.getBoundingClientRect();
      const visibleOnOrNearScreen = rect.bottom > -vh && rect.top < vh * 2 && rect.width > 0 && rect.height > 0;
      if (visibleOnOrNearScreen) {
        const role = roleOf(el, style);
        if (isLoadingIndicator(el, style, role)) loadingIndicator = true;
        const text = directText(el);
        const tag = el.tagName;
        const editable = (tag === "TEXTAREA") ||
          (tag === "INPUT" && !["checkbox","radio","submit","button","reset","image","range","file","hidden"].includes((el.getAttribute("type")||"text").toLowerCase())) ||
          el.isContentEditable;
        const interactive = INTERACTIVE_TAGS.has(tag) || style.cursor === "pointer" ||
          el.hasAttribute("onclick") || (el.tabIndex >= 0 && tag !== "BODY") ||
          ["button","link","textbox","checkbox","radio","select","tab","menuitem","slider"].includes(role);
        const disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true";

        const isDialog = role === "dialog" || role === "alert" || (tag === "DIALOG" && el.open);
        if (isDialog && rect.width > 40 && rect.height > 40) {
          dialogs.push({
            text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 500),
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          });
        }

        if (text || interactive || role === "image" || editable) {
          results.push({
            id: id++,
            role,
            text,
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            interactive: interactive && !isDialog,
            disabled,
            editable,
            focused: el === active,
            clippedByViewport: rect.right > vw + 1 || rect.left < -1,
            color: toHex(style.color),
            backgroundColor: toHex(style.backgroundColor),
            fontSize: parseFloat(style.fontSize) || undefined
          });
        }
      }
    }
    el = walker.nextNode();
  }

  return {
    url: location.href,
    title: document.title,
    viewport: { width: vw, height: vh },
    scrollY: window.scrollY,
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    elements: results,
    dialogs,
    loadingIndicator
  };
})()
`;
