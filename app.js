/* ===== 本地文件转换器 · 纯浏览器端实现，无任何外部依赖 ===== */
"use strict";

/* ---------- 常量 ---------- */
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "svg", "avif"];
const DOC_EXTS = ["md", "markdown", "txt", "html", "htm", "csv", "json"];

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
  md: ["html", "txt"],
  markdown: ["html", "txt"],
  txt: ["md", "html"],
  html: ["md", "txt"],
  htm: ["md", "txt"],
  csv: ["json", "md"],
  json: ["csv", "md"],
};

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

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
    if (isImage(e) || isDoc(e)) state.files.push({ file: f });
  }
  renderFiles();
}

/* --- 事件绑定 --- */
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
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
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

  for (let i = 0; i < state.files.length; i++) {
    const item = state.files[i];
    const ext = extOf(item.file.name);
    const outName = baseName(item.file.name) + "." + target;
    const li = document.createElement("li");
    li.className = "result-item";
    li.innerHTML = `<span class="file-name">${escapeHtml(outName)}</span>
      <span class="file-status wait">转换中…</span>`;
    resultList.appendChild(li);
    const statusEl = li.querySelector(".file-status");

    try {
      let blob;
      if (isImage(ext)) blob = await convertImage(item.file, target, quality);
      else blob = await convertDoc(item.file, target);
      item.result = blob;
      okCount++;
      const btn = document.createElement("button");
      btn.className = "dl-btn";
      btn.textContent = "下载";
      btn.onclick = () => download(blob, outName);
      li.insertBefore(btn, statusEl);
      statusEl.textContent = "✓ " + fmtSize(blob.size);
      statusEl.className = "file-status ok";
      // 自动逐个下载（多个文件间隔触发，避免被浏览器拦截）
      setTimeout(() => download(blob, outName), i * 400);
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
