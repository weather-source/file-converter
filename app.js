/* ===== 本地文件转换器 · 纯浏览器端实现，无任何外部依赖 ===== */
"use strict";

/* ---------- 常量 ---------- */
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "svg", "avif"];
const DOC_EXTS = ["md", "markdown", "txt", "html", "htm", "csv", "json"];
const PPTX_EXTS = ["pptx"];

// 每种输入格式可转换到的目标格式
const CONV_MAP = {
  // 图片（canvas 系）
  png: ["jpeg", "webp", "bmp", "ico"],
  jpg: ["png", "webp", "bmp", "ico"],
  jpeg: ["png", "webp", "bmp", "ico"],
  webp: ["png", "jpeg", "bmp", "ico"],
  gif: ["png", "jpeg", "webp", "bmp", "ico"],
  bmp: ["png", "jpeg", "webp", "ico"],
  ico: ["png", "jpeg", "webp", "bmp"],
  svg: ["png", "jpeg", "webp", "bmp", "ico"],
  avif: ["png", "jpeg", "webp", "bmp", "ico"],
  // 文档
  md: ["html", "txt", "pdf"],
  markdown: ["html", "txt", "pdf"],
  txt: ["md", "html", "pdf"],
  html: ["md", "txt"],
  htm: ["md", "txt"],
  csv: ["json", "md"],
  json: ["csv", "md"],
  // 演示文稿
  pptx: ["pdf", "png"],
};

const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const isSupported = (ext) => IMAGE_EXTS.includes(ext) || DOC_EXTS.includes(ext) || ext === "pptx";

/* ---------- 状态 ---------- */
const state = { files: [], target: null, converting: false };

/* ---------- DOM ---------- */
const $ = (s) => document.querySelector(s);
const dropzone = $("#dropzone");
const fileInput = $("#fileInput");
const fileList = $("#fileList");
const formatGroup = $("#formatGroup");
const qualityRow = $("#qualityRow");
const qualityInput = $("#quality");
const qualityVal = $("#qualityVal");
const convertBtn = $("#convertBtn");
const resultList = $("#resultList");
const doneNote = $("#doneNote");

/* ---------- 工具 ---------- */
const extOf = (name) => (name.split(".").pop() || "").toLowerCase();
const baseName = (name) => name.replace(/\.[^.]+$/, "");
const isImage = (ext) => IMAGE_EXTS.includes(ext);
const isDoc = (ext) => DOC_EXTS.includes(ext);
const fmtSize = (n) =>
  n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB";
const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
}

function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

/* ================= 图片转换 ================= */

function loadBitmap(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("无法解码该图片"));
    };
    img.src = url;
  });
}

function drawCanvas(img, w, h, fillBg) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");
  if (fillBg) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function canvasBlob(canvas, mime, quality) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("浏览器不支持导出 " + mime))), mime, quality)
  );
}

// 生成多尺寸 ICO（内嵌 PNG）
async function buildIco(img) {
  const entries = [];
  for (const size of ICO_SIZES) {
    const c = drawCanvas(img, size, size, false);
    const blob = await canvasBlob(c, "image/png");
    entries.push({ size, buf: new Uint8Array(await blob.arrayBuffer()) });
  }
  const count = entries.length;
  const header = new DataView(new ArrayBuffer(6 + 16 * count));
  header.setUint8(0, 0);
  header.setUint8(1, 0);
  header.setUint16(2, 1, true); // type: icon
  header.setUint16(4, count, true);
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const p = 6 + 16 * i;
    header.setUint8(p, e.size >= 256 ? 0 : e.size); // width
    header.setUint8(p + 1, e.size >= 256 ? 0 : e.size); // height
    header.setUint8(p + 2, 0); // palette
    header.setUint8(p + 3, 0);
    header.setUint16(p + 4, 1, true); // planes
    header.setUint16(p + 6, 32, true); // bpp
    header.setUint32(p + 8, e.buf.length, true);
    header.setUint32(p + 12, offset, true);
    offset += e.buf.length;
  });
  const total = 6 + 16 * count + entries.reduce((s, e) => s + e.buf.length, 0);
  const out = new Uint8Array(total);
  out.set(new Uint8Array(header.buffer), 0);
  let cur = 6 + 16 * count;
  for (const e of entries) {
    out.set(e.buf, cur);
    cur += e.buf.length;
  }
  return new Blob([out], { type: "image/x-icon" });
}

async function convertImage(file, target, quality) {
  const { img, url } = await loadBitmap(file);
  try {
    const q = quality / 100;
    if (target === "ico") return await buildIco(img);
    const mimeMap = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp" };
    const c = drawCanvas(img, img.naturalWidth || img.width, img.naturalHeight || img.height, target === "jpeg");
    return await canvasBlob(c, mimeMap[target], target === "png" ? undefined : q);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ================= 文档转换 ================= */

/* --- 迷你 Markdown 解析器（md → html） --- */
function inlineMd(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s;
}

function mdToHtml(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let html = "", i = 0, para = [];
  const flush = () => {
    if (para.length) {
      html += "<p>" + para.map(inlineMd).join("<br>") + "</p>\n";
      para = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    // 代码块
    if (/^```/.test(line)) {
      flush();
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += "<pre><code" + (lang ? ' class="language-' + lang + '"' : "") + ">" +
        escapeHtml(buf.join("\n")) + "</code></pre>\n";
      continue;
    }
    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      html += `<h${h[1].length}>` + inlineMd(h[2]) + `</h${h[1].length}>\n`;
      i++;
      continue;
    }
    // 分割线
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      flush();
      html += "<hr>\n";
      i++;
      continue;
    }
    // 引用
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      html += "<blockquote>" + mdToHtml(buf.join("\n")) + "</blockquote>\n";
      continue;
    }
    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) buf.push(lines[i++]);
      html += "<ul>" + buf.map((l) => "<li>" + inlineMd(l.replace(/^\s*[-*+]\s+/, "")) + "</li>").join("") + "</ul>\n";
      continue;
    }
    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(lines[i++]);
      html += "<ol>" + buf.map((l) => "<li>" + inlineMd(l.replace(/^\s*\d+[.)]\s+/, "")) + "</li>").join("") + "</ol>\n";
      continue;
    }
    // 空行
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return html;
}

/* --- HTML → Markdown --- */
function htmlToMd(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node, listCtx) => {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    const kids = Array.from(node.childNodes).map((n) => walk(n)).join("");
    switch (tag) {
      case "h1": return "\n\n# " + kids.trim() + "\n";
      case "h2": return "\n\n## " + kids.trim() + "\n";
      case "h3": return "\n\n### " + kids.trim() + "\n";
      case "h4": return "\n\n#### " + kids.trim() + "\n";
      case "h5": return "\n\n##### " + kids.trim() + "\n";
      case "h6": return "\n\n###### " + kids.trim() + "\n";
      case "p": case "div": case "section": case "article":
        return "\n\n" + kids.trim() + "\n";
      case "br": return "\n";
      case "hr": return "\n\n---\n";
      case "strong": case "b": return "**" + kids.trim() + "**";
      case "em": case "i": return "*" + kids.trim() + "*";
      case "del": case "s": case "strike": return "~~" + kids.trim() + "~~";
      case "code":
        if (node.closest("pre")) return kids;
        return "`" + kids.trim() + "`";
      case "pre": {
        const codeEl = node.querySelector("code");
        const raw = codeEl ? codeEl.textContent : node.textContent;
        return "\n\n```\n" + raw.replace(/\n+$/, "") + "\n```\n";
      }
      case "a": {
        const href = node.getAttribute("href") || "";
        return href ? "[" + kids.trim() + "](" + href + ")" : kids;
      }
      case "img": {
        const alt = node.getAttribute("alt") || "";
        const src = node.getAttribute("src") || "";
        return "![" + alt + "](" + src + ")";
      }
      case "ul": case "ol":
        return "\n" + Array.from(node.children).map((li, idx) => {
          const t = Array.from(li.childNodes).map((n) => walk(n)).join("").trim();
          const prefix = tag === "ol" ? (idx + 1) + ". " : "- ";
          return prefix + t.replace(/\n+/g, "\n  ");
        }).join("\n") + "\n";
      case "blockquote":
        return "\n" + kids.trim().split("\n").map((l) => "> " + l).join("\n") + "\n";
      case "script": case "style": case "head": return "";
      case "table": {
        const rows = Array.from(node.querySelectorAll("tr"));
        if (!rows.length) return "";
        const cells = (tr) => Array.from(tr.cells).map((c) => walk(c).trim().replace(/\|/g, "\\|"));
        const head = cells(rows[0]);
        const body = rows.slice(1).map(cells);
        let md = "\n\n| " + head.join(" | ") + " |\n| " + head.map(() => "---").join(" | ") + " |\n";
        for (const r of body) md += "| " + r.join(" | ") + " |\n";
        return md + "\n";
      }
      case "td": case "th": case "li": case "tr": case "tbody": case "thead": return kids;
      default: return kids;
    }
  };
  return walk(doc.body).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* --- HTML → 纯文本 --- */
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((n) => n.remove());
  return (doc.body.innerText || doc.body.textContent).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* --- 纯文本 → Markdown / HTML --- */
function textToMd(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).join("\n") + "\n";
}
function textToHtml(text, title) {
  const paras = text.split(/\r?\n\r?\n/).map((p) => p.trim()).filter(Boolean);
  const body = paras
    .map((p) => "<p>" + escapeHtml(p).replace(/\n/g, "<br>") + "</p>")
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/* --- md → 纯文本（去语法） --- */
function mdToText(src) {
  return src
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/^```.*\n?|```$/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)([^*_]+)\1/g, "$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*_]{3,}$/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .trim() + "\n";
}

/* --- CSV 解析 / 生成 --- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const head = rows[0].map((h, i) => h.trim() || "col" + (i + 1));
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => (o[h] = r[i] !== undefined ? r[i] : ""));
    return o;
  });
}

function csvEscape(v) {
  v = String(v ?? "");
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function objectsToCsv(objs) {
  if (!objs.length) return "";
  const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))];
  const lines = [keys.map(csvEscape).join(",")];
  for (const o of objs) lines.push(keys.map((k) => csvEscape(o[k])).join(","));
  return lines.join("\n") + "\n";
}

function objectsToMdTable(objs) {
  if (!objs.length) return "（空数据）\n";
  const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))];
  const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  let md = "| " + keys.map(esc).join(" | ") + " |\n";
  md += "| " + keys.map(() => "---").join(" | ") + " |\n";
  for (const o of objs) md += "| " + keys.map((k) => esc(o[k])).join(" | ") + " |\n";
  return md + "\n";
}

async function convertDoc(file, target) {
  const text = await readText(file);
  const ext = extOf(file.name);
  const name = baseName(file.name);
  const isMdSrc = ext === "md" || ext === "markdown";

  if (target === "html") {
    let body;
    if (isMdSrc) body = mdToHtml(text);
    else if (ext === "html" || ext === "htm") body = text; // 原样
    else body = textToHtml(text, name).replace(/^[\s\S]*<main>\n?|<\/main>[\s\S]*$/g, "");
    return new Blob(
      [`<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${escapeHtml(name)}</title>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`],
      { type: "text/html" }
    );
  }
  if (target === "md") {
    if (ext === "html" || ext === "htm") return new Blob([htmlToMd(text)], { type: "text/markdown" });
    if (ext === "csv") return new Blob([objectsToMdTable(rowsToObjects(parseCsv(text)))], { type: "text/markdown" });
    if (ext === "json") {
      let data;
      try { data = JSON.parse(text); } catch { throw new Error("JSON 解析失败"); }
      const objs = Array.isArray(data) ? data : [data];
      return new Blob([objectsToMdTable(objs.every((o) => o && typeof o === "object" && !Array.isArray(o)) ? objs : [{ value: JSON.stringify(data) }])], { type: "text/markdown" });
    }
    return new Blob([textToMd(text)], { type: "text/markdown" });
  }
  if (target === "txt") {
    if (isMdSrc) return new Blob([mdToText(text)], { type: "text/plain" });
    if (ext === "html" || ext === "htm") return new Blob([htmlToText(text)], { type: "text/plain" });
    return new Blob([text], { type: "text/plain" });
  }
  if (target === "json") {
    if (ext !== "csv") throw new Error("仅支持 CSV → JSON");
    return new Blob([JSON.stringify(rowsToObjects(parseCsv(text)), null, 2) + "\n"], { type: "application/json" });
  }
  if (target === "csv") {
    if (ext !== "json") throw new Error("仅支持 JSON → CSV");
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("JSON 解析失败"); }
    const objs = Array.isArray(data) ? data : [data];
    if (!objs.every((o) => o && typeof o === "object" && !Array.isArray(o)))
      throw new Error("需要对象数组，如 [{...},{...}]");
    return new Blob([objectsToCsv(objs)], { type: "text/csv" });
  }
  throw new Error("不支持的目标格式");
}

/* ================= PPTX → PDF / PNG（尽力渲染） ================= */

const tagsLocal = (root, name) =>
  Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);
const attrL = (el, name) => {
  const a = Array.from(el.attributes).find((x) => x.localName === name);
  return a ? a.value : null;
};

// 常用主题色映射
const SCHEME_COLORS = {
  bg1: "FFFFFF", lt1: "FFFFFF", tx1: "000000", dk1: "000000",
  bg2: "E7E6E6", lt2: "E7E6E6", tx2: "44546A", dk2: "44546A",
  accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5",
  accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47",
};

function solidColorOf(container) {
  if (!container) return null;
  const sf = Array.from(container.children).find((c) => c.localName === "solidFill") ||
    tagsLocal(container, "solidFill")[0];
  if (!sf) return null;
  const srgb = tagsLocal(sf, "srgbClr")[0];
  if (srgb) return "#" + (attrL(srgb, "val") || "000000").replace(/^#/, "");
  const scheme = tagsLocal(sf, "schemeClr")[0];
  if (scheme) {
    const v = SCHEME_COLORS[(attrL(scheme, "val") || "").toLowerCase()];
    return v ? "#" + v : null;
  }
  return null;
}

function parseSlideRels(xml) {
  const map = {};
  if (!xml) return map;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  for (const rel of tagsLocal(doc, "Relationship")) {
    map[attrL(rel, "Id")] = attrL(rel, "Target") || "";
  }
  return map;
}

// 解析一页幻灯片为形状/图片列表（按文档顺序）
function parseSlideShapes(doc, relMap) {
  const items = [];
  const spTree = tagsLocal(doc, "spTree")[0];
  if (!spTree) return items;
  for (const el of spTree.getElementsByTagName("*")) {
    if (el.localName === "sp") {
      let x = 0, y = 0, w = 0, h = 0, fill = null;
      const spPr = tagsLocal(el, "spPr")[0];
      if (spPr) {
        const xfrm = tagsLocal(spPr, "xfrm")[0];
        if (xfrm) {
          const off = tagsLocal(xfrm, "off")[0], ext = tagsLocal(xfrm, "ext")[0];
          if (off) { x = +attrL(off, "x") || 0; y = +attrL(off, "y") || 0; }
          if (ext) { w = +attrL(ext, "cx") || 0; h = +attrL(ext, "cy") || 0; }
        }
        fill = solidColorOf(spPr);
      }
      const paras = [];
      const txBody = tagsLocal(el, "txBody")[0];
      if (txBody) {
        for (const p of Array.from(txBody.children).filter((c) => c.localName === "p")) {
          const pPr = Array.from(p.children).find((c) => c.localName === "pPr");
          const algn = pPr ? attrL(pPr, "algn") : null;
          const segs = [];
          for (const r of tagsLocal(p, "r")) {
            const t = tagsLocal(r, "t")[0];
            if (!t) continue;
            const rPr = tagsLocal(r, "rPr")[0];
            const sz = rPr ? +attrL(rPr, "sz") || 0 : 0; // 百分之一磅
            const bold = rPr ? attrL(rPr, "b") === "1" : false;
            const color = rPr ? solidColorOf(rPr) : null;
            segs.push({ text: t.textContent, sizePt: sz ? sz / 100 : 18, bold, color });
          }
          paras.push({ algn: algn === "ctr" ? "ctr" : algn === "r" ? "r" : "l", segs, empty: segs.length === 0 });
        }
      }
      items.push({ kind: "sp", x, y, w, h, fill, paras });
    } else if (el.localName === "pic") {
      const blip = tagsLocal(el, "blip")[0];
      const rid = blip ? attrL(blip, "embed") : null;
      let x = 0, y = 0, w = 0, h = 0;
      const spPr = tagsLocal(el, "spPr")[0];
      if (spPr) {
        const xfrm = tagsLocal(spPr, "xfrm")[0];
        if (xfrm) {
          const off = tagsLocal(xfrm, "off")[0], ext = tagsLocal(xfrm, "ext")[0];
          if (off) { x = +attrL(off, "x") || 0; y = +attrL(off, "y") || 0; }
          if (ext) { w = +attrL(ext, "cx") || 0; h = +attrL(ext, "cy") || 0; }
        }
      }
      const target = rid ? relMap[rid] : null;
      if (target) {
        items.push({
          kind: "pic", x, y, w, h,
          path: "ppt/" + target.replace(/^\.\.\//, "").replace(/^\//, "").replace(/^ppt\//, ""),
        });
      }
    }
  }
  return items;
}

// 逐字换行（对中英文都稳妥）
function wrapChars(ctx, paras, maxW, pxPerPt, baseFont) {
  const out = []; // { chars:[{ch,w,px,bold,color}], lh, algn }
  for (const para of paras) {
    const chars = [];
    let maxPx = 18 * pxPerPt;
    for (const seg of para.segs) {
      const px = Math.max(8, seg.sizePt * pxPerPt);
      maxPx = Math.max(maxPx, px);
      for (const ch of seg.text) {
        if (ch === "\n" || ch === "\r") continue;
        if (ch === "\u000b") { chars.push({ br: true }); continue; }
        chars.push({ ch, px, bold: seg.bold, color: seg.color || "#1a1a1a" });
      }
    }
    const lines = [];
    let line = [], w = 0;
    for (const item of chars) {
      if (item.br) { lines.push(line); line = []; w = 0; continue; }
      ctx.font = (item.bold ? "bold " : "") + item.px + "px " + baseFont;
      const cw = ctx.measureText(item.ch).width;
      if (w + cw > maxW && line.length) { lines.push(line); line = []; w = 0; }
      line.push({ ...item, w: cw });
      w += cw;
    }
    if (line.length || (!chars.length && para.empty)) lines.push(line);
    for (const ln of lines) {
      out.push({
        chars: ln,
        lh: (ln.length ? Math.max(...ln.map((c) => c.px)) : 18 * pxPerPt) * 1.35,
        algn: para.algn,
      });
    }
  }
  return out;
}

async function loadBlobImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("图片解码失败")); };
    img.src = url;
  });
}

async function renderSlideCanvas(items, zip, cx, cy, W) {
  const scale = W / cx;
  const H = Math.max(1, Math.round(cy * scale));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const pxPerPt = W / (cx / 12700);
  const FONT = '"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif';

  for (const it of items) {
    const X = it.x * scale, Y = it.y * scale, Wd = it.w * scale, Hd = it.h * scale;
    try {
      if (it.kind === "pic") {
        const data = zip[it.path];
        if (data) {
          const img = await loadBlobImage(new Blob([data]));
          ctx.drawImage(img, X, Y, Wd || img.naturalWidth * scale, Hd || img.naturalHeight * scale);
          URL.revokeObjectURL(img.src);
        }
        continue;
      }
      if (it.fill && Wd > 0 && Hd > 0) {
        ctx.fillStyle = it.fill;
        ctx.fillRect(X, Y, Wd, Hd);
      }
      if (!it.paras.length) continue;
      const padX = Math.min(24, Wd * 0.06);
      const padY = Math.min(18, Hd * 0.05);
      const lines = wrapChars(ctx, it.paras, Math.max(20, Wd - padX * 2), pxPerPt, FONT);
      let y = Y + padY;
      for (const ln of lines) {
        if (y + ln.lh > Y + Hd + 4) break; // 溢出截断
        const lineW = ln.chars.reduce((s, ch) => s + ch.w, 0);
        let x = X + padX;
        if (ln.algn === "ctr") x += (Wd - padX * 2 - lineW) / 2;
        else if (ln.algn === "r") x += Wd - padX * 2 - lineW;
        for (const ch of ln.chars) {
          ctx.font = (ch.bold ? "bold " : "") + ch.px + "px " + FONT;
          ctx.fillStyle = ch.color;
          ctx.fillText(ch.ch, x, y);
          x += ch.w;
        }
        y += ln.lh;
      }
    } catch (e) { /* 单个形状失败不中断整页 */ }
  }
  return c;
}

async function canvasesToPdf(canvases, pageWpt, pageHpt) {
  const pdf = await PDFLib.PDFDocument.create();
  for (const c of canvases) {
    const img = await pdf.embedPng(c.toDataURL("image/png"));
    const page = pdf.addPage([pageWpt, pageHpt]);
    page.drawImage(img, { x: 0, y: 0, width: pageWpt, height: pageHpt });
  }
  return new Blob([await pdf.save()], { type: "application/pdf" });
}

async function convertPptx(file, target) {
  if (typeof fflate === "undefined" || typeof PDFLib === "undefined")
    throw new Error("转换组件加载失败，请刷新页面");
  const zip = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
  const dec = new TextDecoder();
  const readStr = (n) => (zip[n] ? dec.decode(zip[n]) : null);
  const presXml = readStr("ppt/presentation.xml");
  if (!presXml) throw new Error("不是有效的 PPTX 文件（旧版 .ppt 不受支持，请先另存为 .pptx）");
  const m = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const cx = m ? +m[1] : 12192000, cy = m ? +m[2] : 6858000;

  const presDoc = new DOMParser().parseFromString(presXml, "text/xml");
  const presRels = parseSlideRels(readStr("ppt/_rels/presentation.xml.rels"));
  const slidePaths = tagsLocal(presDoc, "sldId")
    .map((sid) => {
      // sldId 同时带无前缀 id="256" 与带前缀 r:id="rIdN"，必须取带前缀的关系 ID
      const relAttr = Array.from(sid.attributes).find((a) => a.localName === "id" && a.name !== "id");
      const t = presRels[relAttr ? relAttr.value : ""] || "";
      return "ppt/" + t.replace(/^\.\.\//, "").replace(/^\//, "").replace(/^ppt\//, "");
    })
    .filter((p) => zip[p]);
  if (!slidePaths.length) throw new Error("未找到幻灯片");

  const W = 1600;
  const canvases = [];
  for (const path of slidePaths) {
    const relPath = path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
    const relMap = parseSlideRels(readStr(relPath));
    const items = parseSlideShapes(new DOMParser().parseFromString(readStr(path), "text/xml"), relMap);
    canvases.push(await renderSlideCanvas(items, zip, cx, cy, W));
  }
  if (!canvases.length) throw new Error("未能渲染任何幻灯片");

  if (target === "png") {
    return Promise.all(canvases.map((c) => canvasBlob(c, "image/png")));
  }
  return [await canvasesToPdf(canvases, cx / 12700, cy / 12700)];
}

/* ================= TXT / MD → PDF（A4 排版） ================= */

function mdBlocksForPdf(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let para = [], inCode = false, codeBuf = [];
  const flush = () => {
    if (para.length) { blocks.push({ type: "p", text: para.join("\n") }); para = []; }
  };
  const strip = (s) => s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)([^*_]+)\1/g, "$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) { blocks.push({ type: "code", text: codeBuf.join("\n") }); codeBuf = []; inCode = false; }
      else { flush(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); blocks.push({ type: "h", level: h[1].length, text: strip(h[2]) }); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flush(); blocks.push({ type: "hr" }); continue; }
    if (/^>\s?/.test(line)) { flush(); blocks.push({ type: "quote", text: strip(line.replace(/^>\s?/, "")) }); continue; }
    if (/^\s*[-*+]\s+/.test(line)) {
      flush();
      blocks.push({ type: "li", text: strip(line.replace(/^\s*[-*+]\s+/, "")) });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flush();
      blocks.push({ type: "li", text: strip(line.replace(/^\s*\d+[.)]\s+/, "")) });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    para.push(strip(line));
  }
  flush();
  if (inCode && codeBuf.length) blocks.push({ type: "code", text: codeBuf.join("\n") });
  return blocks;
}

async function textToPdf(text, markdown) {
  const SCALE = 2;
  const W = 1191, H = 1684, M = 128; // A4 @144dpi，边距 64pt
  const CW = W - M * 2;
  const FONT = '"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif';
  const MONO = 'Consolas,"Courier New",monospace';

  const pages = [];
  let ctx, y;
  const newPage = () => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    pages.push(c);
    y = M;
  };
  newPage();
  const need = (h) => {
    if (y + h > H - M) newPage();
  };
  const wrapText = (s, font, maxW) => {
    ctx.font = font;
    const lines = [];
    for (const raw of s.split("\n")) {
      let line = "";
      for (const ch of raw) {
        if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
        else line += ch;
      }
      lines.push(line);
    }
    return lines;
  };
  const drawBlock = (text, font, lh, color, opts) => {
    opts = opts || {};
    const lines = wrapText(text, font, CW - (opts.indent || 0));
    for (const ln of lines) {
      need(lh);
      if (opts.bar) {
        ctx.fillStyle = "#c9c9c9";
        ctx.fillRect(M - 18, y - lh * 0.8, 5, lh);
      }
      ctx.font = font;
      ctx.fillStyle = color || "#1a1a1a";
      ctx.fillText(ln, M + (opts.indent || 0), y);
      y += lh;
    }
  };

  const styles = {
    h1: { font: "bold 52px " + FONT, lh: 66 },
    h2: { font: "bold 40px " + FONT, lh: 54 },
    h3: { font: "bold 32px " + FONT, lh: 44 },
    h4: { font: "bold 26px " + FONT, lh: 38 },
    body: { font: "22px " + FONT, lh: 34 },
    code: { font: "19px " + MONO, lh: 28 },
  };

  if (markdown) {
    for (const b of mdBlocksForPdf(text)) {
      if (b.type === "hr") {
        need(30);
        ctx.fillStyle = "#d0d0d0";
        ctx.fillRect(M, y, CW, 2);
        y += 30;
      } else if (b.type === "code") {
        for (const ln of b.text.split("\n")) {
          need(30);
          ctx.fillStyle = "#f0f0f0";
          ctx.fillRect(M - 10, y - 22, CW + 20, 28);
          ctx.font = styles.code.font;
          ctx.fillStyle = "#1a1a1a";
          ctx.fillText(ln, M, y);
          y += 28;
        }
        y += 10;
      } else if (b.type === "li") {
        drawBlock("• " + b.text, styles.body.font, styles.body.lh, "#1a1a1a", { indent: 16 });
      } else if (b.type === "quote") {
        drawBlock(b.text, styles.body.font, styles.body.lh, "#666666", { indent: 16, bar: true });
      } else if (b.type === "h") {
        const st = styles["h" + Math.min(4, b.level)];
        y += 12;
        drawBlock(b.text, st.font, st.lh, "#111111");
        if (b.level <= 2) {
          need(16);
          ctx.fillStyle = "#d8d8d8";
          ctx.fillRect(M, y, CW, 2);
          y += 16;
        }
      } else {
        drawBlock(b.text, styles.body.font, styles.body.lh, "#1a1a1a");
      }
      y += 10;
    }
  } else {
    for (const para of text.split(/\r?\n/)) {
      if (!para.trim()) { y += 17; continue; }
      drawBlock(para, styles.body.font, styles.body.lh, "#1a1a1a");
    }
  }
  return [await canvasesToPdf(pages, 595.28, 841.89)];
}

/* ================= 主流程 ================= */

function extTargetLabel(t) { return t.toUpperCase(); }

function renderFiles() {
  fileList.innerHTML = "";
  state.files.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "file-item";
    li.innerHTML = `<span class="file-name">${escapeHtml(item.file.name)}</span>
      <span class="file-meta">${escapeHtml(extOf(item.file.name).toUpperCase())} · ${fmtSize(item.file.size)}</span>
      <span class="file-status wait">待转换</span>
      <button class="file-remove" aria-label="移除">✕</button>`;
    li.querySelector(".file-remove").onclick = () => {
      state.files.splice(idx, 1);
      renderFiles();
    };
    fileList.appendChild(li);
  });
  renderFormats();
  convertBtn.disabled = !state.files.length || !state.target || state.converting;
}

function renderFormats() {
  const exts = [...new Set(state.files.map((f) => extOf(f.file.name)))];
  let targets = null;
  if (exts.length) {
    targets = CONV_MAP[exts[0]] || [];
    for (const e of exts) {
      const t = CONV_MAP[e] || [];
      targets = targets.filter((x) => t.includes(x));
    }
  }
  formatGroup.innerHTML = "";
  if (!state.files.length) {
    formatGroup.innerHTML = '<p class="empty-hint">请先在上方添加文件</p>';
    state.target = null;
    qualityRow.hidden = true;
    return;
  }
  if (!targets.length) {
    formatGroup.innerHTML = '<p class="empty-hint">所选文件类型无法互相转换到同一目标，请分开转换</p>';
    state.target = null;
    qualityRow.hidden = true;
    return;
  }
  targets.forEach((t) => {
    const b = document.createElement("button");
    b.className = "chip" + (state.target === t ? " active" : "");
    b.textContent = extTargetLabel(t);
    b.onclick = () => {
      state.target = t;
      renderFiles();
    };
    formatGroup.appendChild(b);
  });
  if (!targets.includes(state.target)) state.target = null;
  qualityRow.hidden = !(state.target === "jpeg" || state.target === "webp");
}

function addFiles(list) {
  for (const f of list) {
    const e = extOf(f.name);
    if (isSupported(e)) state.files.push({ file: f });
  }
  renderFiles();
}

/* --- 事件绑定 --- */
const hasDragFiles = (e) => {
  const dt = e.dataTransfer;
  return !!dt && Array.prototype.indexOf.call(dt.types || [], "Files") !== -1;
};

// 全页拖放：文件拖到页面任何位置松手都能添加，
// 并阻止浏览器用默认行为打开被拖入的文件（这是"拖了没反应"的常见原因）
let dragDepth = 0;
window.addEventListener("dragover", (e) => {
  if (hasDragFiles(e)) e.preventDefault();
});
window.addEventListener("dragenter", (e) => {
  if (!hasDragFiles(e)) return;
  dragDepth++;
  dropzone.classList.add("dragover");
});
window.addEventListener("dragleave", (e) => {
  if (!hasDragFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzone.classList.remove("dragover");
});
window.addEventListener("drop", (e) => {
  if (!hasDragFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove("dragover");
  addFiles(e.dataTransfer.files);
});

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});
["dragover", "dragenter"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
dropzone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
});
dropzone.addEventListener("drop", (e) => e.preventDefault()); // 只管视觉，真正的添加在 window 级处理，避免重复
window.addEventListener("paste", (e) => {
  if (e.clipboardData && e.clipboardData.files.length) addFiles(e.clipboardData.files);
});

qualityInput.addEventListener("input", () => {
  qualityVal.textContent = qualityInput.value + "%";
});

convertBtn.addEventListener("click", async () => {
  if (state.converting || !state.target || !state.files.length) return;
  state.converting = true;
  convertBtn.disabled = true;
  convertBtn.classList.add("converting");
  convertBtn.textContent = "转换中…";
  resultList.innerHTML = "";
  doneNote.hidden = true;

  const target = state.target;
  const quality = +qualityInput.value;
  let okCount = 0;

  const queue = [...state.files];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const ext = extOf(item.file.name);
    const li = document.createElement("li");
    li.className = "result-item";
    li.innerHTML = `<span class="file-name">${escapeHtml(item.file.name)} → ${escapeHtml(target.toUpperCase())}</span>
      <span class="file-status wait">转换中…</span>`;
    resultList.appendChild(li);
    const statusEl = li.querySelector(".file-status");

    try {
      let out;
      if (ext === "pptx") out = await convertPptx(item.file, target);
      else if (isImage(ext)) out = await convertImage(item.file, target, quality);
      else if (target === "pdf") out = await textToPdf(await readText(item.file), ext === "md" || ext === "markdown");
      else out = await convertDoc(item.file, target);
      const outs = Array.isArray(out) ? out : [out];
      const base = baseName(item.file.name);
      let totalSize = 0;
      outs.forEach((blob, k) => {
        totalSize += blob.size;
        const nm = outs.length > 1
          ? base + "-" + String(k + 1).padStart(2, "0") + "." + target
          : base + "." + target;
        const row = document.createElement("li");
        row.className = "result-item";
        row.innerHTML = `<span class="file-name">${escapeHtml(nm)}</span>
          <span class="file-status ok">✓ ${fmtSize(blob.size)}</span>`;
        const btn = document.createElement("button");
        btn.className = "dl-btn";
        btn.textContent = "下载";
        btn.onclick = () => download(blob, nm);
        row.insertBefore(btn, row.querySelector(".file-status"));
        resultList.appendChild(row);
        setTimeout(() => download(blob, nm), (i * 400) + k * 150);
      });
      okCount++;
      statusEl.textContent = "✓ " + (outs.length > 1 ? outs.length + " 个文件 · " : "") + fmtSize(totalSize);
      statusEl.className = "file-status ok";
      // 转换完成后从待转换列表移除
      const idx = state.files.indexOf(item);
      if (idx > -1) state.files.splice(idx, 1);
    } catch (err) {
      statusEl.textContent = "✗ " + (err && err.message ? err.message : "转换失败");
      statusEl.className = "file-status err";
    }
    renderFiles();
  }

  if (okCount && state.files.length === 0) {
    state.target = null;
    renderFiles();
  }
  if (okCount) doneNote.hidden = false;
  state.converting = false;
  convertBtn.classList.remove("converting");
  convertBtn.textContent = "开始转换";
  convertBtn.disabled = !state.files.length || !state.target;
});

/* ================= 深色 / 浅色主题切换 ================= */
const themeToggle = $("#themeToggle");
function applyTheme(t) {
  document.body.dataset.theme = t;
  themeToggle.textContent = t === "light" ? "☾" : "☀";
}
let theme = "dark";
try { theme = localStorage.getItem("fc-theme") === "light" ? "light" : "dark"; } catch (e) {}
applyTheme(theme);
themeToggle.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  try { localStorage.setItem("fc-theme", theme); } catch (e) {}
  applyTheme(theme);
});
