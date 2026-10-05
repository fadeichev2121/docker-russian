// Docker Desktop Russian UI Translation Runtime
(() => {
  "use strict";

  const DICT = __RU_DICTIONARY__;

  // Elements and containers that should NEVER be translated (terminals, logs, code, inputs)
  const OMIT = [
    "script", "style", "noscript", "svg", "canvas", "pre", "code", "kbd",
    "textarea", "input[type='text']", "input[type='search']", "input[type='password']",
    "[contenteditable='true']", ".xterm", ".xterm-screen", ".terminal",
    "[data-testid='terminal']", "[data-testid='log-viewer']", "[data-testid='logs-content']",
    "[data-testid='container-env-vars']", ".monaco-editor", ".cm-editor"
  ].join(",");

  const ATTRS = ["title", "aria-label", "placeholder", "data-placeholder", "data-tooltip-content"];

  function omitted(el) {
    if (!el || el.closest(OMIT)) return true;
    return false;
  }

  function ru(text) {
    if (!text || text.length > 2000) return text;
    const trimmed = text.trim();
    if (!trimmed) return text;

    let translated = Object.hasOwn(DICT, trimmed) ? DICT[trimmed] : undefined;

    // Dynamic patterns
    if (translated === undefined) {
      let m;
      if ((m = /^(\d+)\s+containers?$/i.exec(trimmed))) {
        translated = m[1] + " контейнеров";
      } else if ((m = /^(\d+)\s+images?$/i.exec(trimmed))) {
        translated = m[1] + " образов";
      } else if ((m = /^(\d+)\s+volumes?$/i.exec(trimmed))) {
        translated = m[1] + " томов";
      } else if ((m = /^About\s+(\d+)\s+(seconds?|minutes?|hours?|days?|months?|years?)\s+ago$/i.exec(trimmed))) {
        const units = { second: "сек.", minute: "мин.", hour: "ч.", day: "дн.", month: "мес.", year: "г." };
        const uKey = m[2].toLowerCase().replace(/s$/, "");
        translated = "Около " + m[1] + " " + (units[uKey] || m[2]) + " назад";
      } else if ((m = /^(\d+(?:\.\d+)?)\s*(GB|MB|KB)\s+allocated$/i.exec(trimmed))) {
        translated = "Выделено " + m[1] + " " + m[2];
      }
    }

    if (!translated || translated === trimmed) return text;
    const start = text.indexOf(trimmed);
    return text.slice(0, start) + translated + text.slice(start + trimmed.length);
  }

  function textNode(node) {
    if (omitted(node.parentElement)) return;
    const original = node.nodeValue;
    const value = ru(original);
    if (value !== original) node.nodeValue = value;
  }

  function attributes(el) {
    if (omitted(el)) return;
    for (const name of ATTRS) {
      const original = el.getAttribute(name);
      if (!original) continue;
      const value = ru(original);
      if (value !== original) el.setAttribute(name, value);
    }
  }

  function subtree(root) {
    if (root.nodeType === Node.TEXT_NODE) { textNode(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (root.closest(OMIT)) return;
      attributes(root);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.matches(OMIT)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) textNode(node);
      else attributes(node);
    }
  }

  const pending = new Set();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const roots = [...pending];
    pending.clear();
    for (const root of roots) {
      if (!root.isConnected) continue;
      if (roots.some(parent => parent !== root && parent.nodeType === Node.ELEMENT_NODE && parent.contains(root))) continue;
      subtree(root);
    }
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) pending.add(node);
      } else {
        pending.add(record.target);
      }
    }
    if (!scheduled && pending.size) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });

  function start() {
    if (!document.documentElement) return;
    document.documentElement.lang = "ru";
    const root = document.body || document.documentElement;
    subtree(root);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
