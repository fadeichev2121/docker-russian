// Docker Desktop Russian UI Translation Runtime v3.0
// Intelligent DOM Mutation Observer & Multi-level Matcher
(() => {
  "use strict";

  if (globalThis.__dockerRussian?.active) return;
  const changes = new Map();
  const oldLanguage = document.documentElement?.getAttribute("lang");
  let active = true;
  const DICT = __RU_DICTIONARY__;
  function remember(node, key, original, translated) {
    let entries = changes.get(node);
    if (!entries) { entries = new Map(); changes.set(node, entries); }
    const previous = entries.get(key);
    entries.set(key, { original: previous?.translated === original ? previous.original : original, translated });
  }

  function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  // Build case-insensitive lookup table for fallback
  const LOWER_DICT = Object.create(null);
  for (const [k, v] of Object.entries(DICT)) {
    LOWER_DICT[normalize(k).toLowerCase()] = v;
  }

  // Elements and containers that should NEVER be translated (terminals, logs, code, inputs)
  const OMIT = [
    "script", "style", "noscript", "svg", "canvas", "pre", "code", "kbd",
    "textarea", "input[type='text']", "input[type='search']", "input[type='password']",
    "[contenteditable='true']", ".xterm", ".xterm-screen", ".terminal",
    "[data-testid='terminal']", "[data-testid='log-viewer']", "[data-testid='logs-content']",
    "[data-testid='container-env-vars']", ".monaco-editor", ".cm-editor"
  ].join(",");

  const ATTRS = ["title", "aria-label", "placeholder", "data-placeholder", "data-tooltip-content", "data-tooltip", "alt"];

  function omitted(el) {
    if (!el || el.closest(OMIT)) return true;
    return false;
  }

  function matchDict(s) {
    if (Object.hasOwn(DICT, s)) return DICT[s];
    const lower = normalize(s).toLowerCase();
    if (lower && Object.hasOwn(LOWER_DICT, lower)) {
      const trans = LOWER_DICT[lower];
      if (s[0] === s[0].toUpperCase() && trans[0] !== trans[0].toUpperCase()) {
        return trans[0].toUpperCase() + trans.slice(1);
      }
      return trans;
    }
    return undefined;
  }

  function resolveTranslation(raw) {
    // 1. Direct dictionary match
    let res = matchDict(raw);
    if (res !== undefined) return res;

    // 2. Trailing colon: "Name:" -> "Имя:"
    if (raw.endsWith(":")) {
      const sub = matchDict(raw.slice(0, -1).trim());
      if (sub !== undefined) return sub + ":";
    }

    // 3. Trailing ellipsis: "Loading..." or "Loading…" -> "Загрузка..."
    if (raw.endsWith("...")) {
      const sub = matchDict(raw.slice(0, -3).trim());
      if (sub !== undefined) return sub + "...";
    } else if (raw.endsWith("…")) {
      const sub = matchDict(raw.slice(0, -1).trim());
      if (sub !== undefined) return sub + "…";
    }

    // 4. Trailing question mark: "Delete container?" -> "Удалить контейнер?"
    if (raw.endsWith("?")) {
      const sub = matchDict(raw.slice(0, -1).trim());
      if (sub !== undefined) return sub + "?";
    }

    // 5. Parenthesized count: "Containers (5)" -> "Контейнеры (5)"
    let m = /^(.+?)\s*\(([\d\w\s\.\/]+)\)$/.exec(raw);
    if (m) {
      const sub = matchDict(m[1].trim());
      if (sub !== undefined) return sub + " (" + m[2] + ")";
    }

    // 6. Dynamic patterns (counters, timestamps, memory, ports)
    if ((m = /^(\d+)\s+containers?$/i.exec(raw))) {
      return m[1] + " контейнеров";
    } else if ((m = /^(\d+)\s+images?$/i.exec(raw))) {
      return m[1] + " образов";
    } else if ((m = /^(\d+)\s+volumes?$/i.exec(raw))) {
      return m[1] + " томов";
    } else if ((m = /^(\d+)\s+builds?$/i.exec(raw))) {
      return m[1] + " сборок";
    } else if ((m = /^About\s+(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.exec(raw))) {
      const units = { second: "сек.", minute: "мин.", hour: "ч.", day: "дн.", week: "нед.", month: "мес.", year: "г." };
      const uKey = m[2].toLowerCase().replace(/s$/, "");
      return "Около " + m[1] + " " + (units[uKey] || m[2]) + " назад";
    } else if ((m = /^(\d+(?:\.\d+)?)\s*(GB|MB|KB)\s+allocated$/i.exec(raw))) {
      return "Выделено " + m[1] + " " + m[2];
    } else if ((m = /^(\d+(?:\.\d+)?)\s*(GB|MB|KB)\s+in use$/i.exec(raw))) {
      return "Используется " + m[1] + " " + m[2];
    } else if ((m = /^Port\s+(\d+)\s*->\s*(\d+)$/i.exec(raw))) {
      return "Порт " + m[1] + " → " + m[2];
    }

    return undefined;
  }

  function ru(text) {
    if (!text || text.length > 2500) return text;
    // Replace non-breaking spaces with standard space
    const normalized = text.replace(/\u00a0/g, " ");
    const trimmed = normalized.trim();
    if (!trimmed) return text;

    const translated = resolveTranslation(trimmed);
    if (!translated || translated === trimmed) return text;
    // Keep boundary spaces: React often places a link or inline code in the next node.
    const leading = /^\s*/.exec(text)[0];
    const trailing = /\s*$/.exec(text)[0];
    return leading + translated + trailing;
  }

  function textNode(node) {
    if (omitted(node.parentElement)) return;
    const original = node.nodeValue;
    const value = ru(original);
    if (value !== original) { remember(node, "text", original, value); node.nodeValue = value; }
  }

  function attributes(el) {
    // Localize input labels and hints, while leaving all user-entered values alone.
    if (omitted(el) && !(el.tagName === "INPUT" && !omitted(el.parentElement))) return;
    for (const name of ATTRS) {
      const original = el.getAttribute(name);
      if (!original) continue;
      const value = ru(original);
      if (value !== original) { remember(el, name, original, value); el.setAttribute(name, value); }
    }
    // Handle button value attribute
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit")) {
      const val = el.value;
      if (val) {
        const trans = ru(val);
        if (trans !== val) { remember(el, "value", val, trans); el.value = trans; }
      }
    }
  }

  function subtree(root) {
    if (root.nodeType === Node.TEXT_NODE) { textNode(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      attributes(root);
      if (root.closest(OMIT)) return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.matches(OMIT)) {
          attributes(node);
          return NodeFilter.FILTER_REJECT;
        }
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
    if (!active) return;
    const roots = [...pending];
    pending.clear();
    for (const node of changes.keys()) if (!node.isConnected) changes.delete(node);
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
    if (!active || !document.documentElement) return;
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

  globalThis.__dockerRussian = {
    get active() { return active; },
    stop(restore = true) {
      active = false;
      observer.disconnect();
      document.removeEventListener("DOMContentLoaded", start);
      pending.clear();
      if (restore) {
        for (const [node, entries] of changes) {
          if (!node.isConnected) continue;
          for (const [key, entry] of entries) {
            const current = key === "text" ? node.nodeValue : key === "value" ? node.value : node.getAttribute(key);
            if (current !== entry.translated) continue;
            if (key === "text") node.nodeValue = entry.original;
            else if (key === "value") node.value = entry.original;
            else node.setAttribute(key, entry.original);
          }
        }
        if (document.documentElement?.lang === "ru") {
          if (oldLanguage == null) document.documentElement.removeAttribute("lang");
          else document.documentElement.setAttribute("lang", oldLanguage);
        }
      }
      changes.clear();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
