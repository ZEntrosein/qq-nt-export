// GPL-3.0-only. Bundled from vendor/qce/lib; see vendor/qce/NOTICE.md and LICENSE.

// vendor/qce/lib/core/exporter/ModernHtmlExporter.ts
import fs from "fs";
import { promises as fsp } from "fs";
import path2 from "path";
import os from "os";
import { randomUUID } from "node:crypto";
import { pipeline } from "stream/promises";
import { once } from "events";

// vendor/qce/lib/core/exporter/replyRender.ts
function chooseReplyJumpTarget(data) {
  if (!data) return null;
  if (data.association?.version === 1 && data.association.status !== "resolved") return null;
  if (data.sourceAvailable === false) return null;
  const candidates = [data.referencedMessageId, data.replyMsgId, data.msgId];
  for (const raw of candidates) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (s.length === 0 || s === "0") continue;
    return s;
  }
  return null;
}
function formatReplyTimestamp(value) {
  if (value == null) return "";
  let ms = null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return "";
    ms = value > 1e12 ? value : value * 1e3;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return "";
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) return "";
      ms = n > 1e12 ? n : n * 1e3;
    } else {
      const parsed = Date.parse(trimmed);
      if (Number.isNaN(parsed)) return "";
      ms = parsed;
    }
  } else {
    return "";
  }
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// vendor/qce/lib/core/exporter/replyPreviewRenderer.ts
import path from "path";

// vendor/qce/lib/core/resource/MediaExportState.ts
function mediaExportState(info) {
  if (info?.status === "skipped") return { version: 1, status: "skipped", stage: "download", code: "download-skipped" };
  if (info?.status === "failed") return { version: 1, status: "failed", stage: "download", code: "download-failed" };
  const value = info?.exportState;
  if (value?.version === 1 && (value.status === "skipped" && value.stage === "download" && value.code === "download-skipped" || value.status === "failed" && (value.stage === "download" && value.code === "download-failed" || value.stage === "export" && ["source-missing", "copy-failed"].includes(value.code))))
    return { version: 1, status: value.status, stage: value.stage, code: value.code };
  return void 0;
}
function mediaExportKey(type, data) {
  const name = String(data?.localPath || data?.filename || data?.fileName || "").replace(/\\/g, "/").split("/").pop() || "";
  return name ? `${type}:${name}` : "";
}
function renderMediaState(info, type, escape) {
  const state = mediaExportState(info);
  if (!state) return "";
  const name = String(info?.filename || info?.fileName || "");
  const labels = { image: "\u56FE\u7247", video: "\u89C6\u9891", audio: "\u8BED\u97F3", file: "\u9644\u4EF6" }, label = labels[type] || "\u5A92\u4F53";
  const skipped = state.status === "skipped";
  const title = skipped ? "\u5DF2\u4E3B\u52A8\u8DF3\u8FC7\u4E0B\u8F7D" : state.stage === "download" ? "\u5A92\u4F53\u83B7\u53D6\u5931\u8D25" : "\u5A92\u4F53\u5BFC\u51FA\u5931\u8D25";
  return `<span class="export-media-issue ${skipped ? "export-media-skipped" : "export-media-failure"}" role="note"><strong>${skipped ? "\u2014" : "\u26A0"} ${title} \xB7 ${label}</strong><span>${escape(name || label)}</span><span>${skipped ? "\u672C\u6B21\u5BFC\u51FA\u9009\u62E9\u4E0D\u4E0B\u8F7D\u6B64\u7C7B\u8D44\u6E90\u3002" : "\u6B64\u5904\u539F\u6709\u5A92\u4F53\u672A\u6210\u529F\u4FDD\u5B58\uFF1B\u53EF\u91CD\u8BD5\u5931\u8D25\u5A92\u4F53\u6216\u4ECE\u5176\u4ED6\u5907\u4EFD\u8865\u9F50\u3002"}</span></span>`;
}
function decorateMediaHtml(html, type, data, escape) {
  if (!data?.localPath && !data?.exportState) return html;
  const key = mediaExportKey(type, data), end = html.indexOf(">");
  return key && end >= 0 ? html.slice(0, end) + ` data-media-export-key="${escape(key)}"` + html.slice(end) : html;
}

// vendor/qce/lib/core/exporter/replyPreviewRenderer.ts
function renderReplyPreviewElement(pe, ctx) {
  const data = pe, type = String(data?.type || "");
  const html = renderMediaState(data, type, ctx.escapeHtml) || renderReplyPreviewElementContent(pe, ctx);
  return ["image", "video", "audio", "file"].includes(type) ? decorateMediaHtml(html, type, data, ctx.escapeHtml) : html;
}
function renderReplyPreviewElementContent(pe, ctx) {
  if (!pe || typeof pe !== "object") return "";
  const e = pe;
  const text = typeof e.text === "string" ? e.text : "";
  switch (e.type) {
    case "image": {
      const localPath = typeof e.localPath === "string" ? e.localPath : "";
      if (localPath) {
        const baseName = path.basename(localPath);
        const dataUri = ctx.lookupDataUri("images", baseName);
        const imgSrc = dataUri || `${ctx.resourceBaseHref}/images/${baseName}`;
        return `<img src="${imgSrc}" class="reply-content-thumb" alt="\u5F15\u7528\u56FE\u7247" loading="lazy">`;
      }
      if (typeof e.originUrl === "string" && e.originUrl) {
        return `<img src="${ctx.escapeHtml(e.originUrl)}" class="reply-content-thumb" alt="\u5F15\u7528\u56FE\u7247" loading="lazy" onerror="this.replaceWith(document.createTextNode('[\u56FE\u7247]'))">`;
      }
      return ctx.escapeHtml(text || "[\u56FE\u7247]");
    }
    case "marketFace": {
      const url = typeof e.url === "string" ? e.url : "";
      if (url) {
        const alt = ctx.escapeHtml(e.faceName || "\u8868\u60C5");
        return `<img src="${ctx.escapeHtml(url)}" class="reply-content-emoji" alt="${alt}" loading="lazy">`;
      }
      return ctx.escapeHtml(text || "[\u8868\u60C5]");
    }
    case "face": {
      const id = e.faceIndex !== void 0 && e.faceIndex !== null ? String(e.faceIndex) : "";
      const friendly = id ? ctx.getFaceName(id) : "";
      return ctx.escapeHtml(friendly || text || "[\u8868\u60C5]");
    }
    case "video": {
      const label = e.fileName || text || "[\u89C6\u9891]";
      const localPath = typeof e.localPath === "string" ? e.localPath : "";
      if (localPath) {
        const baseName = path.basename(localPath);
        const dataUri = ctx.lookupDataUri("videos", baseName);
        const src = dataUri || `${ctx.resourceBaseHref}/videos/${baseName}`;
        return `<video src="${ctx.escapeHtml(src)}" class="reply-content-video" controls preload="metadata" title="${ctx.escapeHtml(String(label))}" onclick="event.stopPropagation()"></video>`;
      }
      return `<span class="reply-content-attachment">\u{1F3AC} ${ctx.escapeHtml(String(label))}</span>`;
    }
    case "audio": {
      const label = text || "[\u8BED\u97F3]";
      const localPath = typeof e.localPath === "string" ? e.localPath : "";
      if (localPath) {
        const baseName = path.basename(localPath);
        const dataUri = ctx.lookupDataUri("audios", baseName);
        const src = dataUri || `${ctx.resourceBaseHref}/audios/${baseName}`;
        return `<audio src="${ctx.escapeHtml(src)}" class="reply-content-audio" controls preload="metadata" title="${ctx.escapeHtml(String(label))}" onclick="event.stopPropagation()"></audio>`;
      }
      return `<span class="reply-content-attachment">\u{1F3B5} ${ctx.escapeHtml(String(label))}</span>`;
    }
    case "file": {
      const label = e.fileName || text || "[\u6587\u4EF6]";
      const localPath = typeof e.localPath === "string" ? e.localPath : "";
      if (localPath) {
        const baseName = path.basename(localPath);
        const dataUri = ctx.lookupDataUri("files", baseName);
        const href = dataUri || `${ctx.resourceBaseHref}/files/${baseName}`;
        return `<a class="reply-content-attachment" href="${ctx.escapeHtml(href)}" download="${ctx.escapeHtml(baseName)}" onclick="event.stopPropagation()">\u{1F4CE} ${ctx.escapeHtml(String(label))}</a>`;
      }
      return `<span class="reply-content-attachment">\u{1F4CE} ${ctx.escapeHtml(String(label))}</span>`;
    }
    case "forward": {
      const title = typeof e.title === "string" ? e.title.trim() : "";
      const label = title && title !== "\u804A\u5929\u8BB0\u5F55" ? `\u804A\u5929\u8BB0\u5F55 \xB7 ${title}` : "\u804A\u5929\u8BB0\u5F55";
      const count = Number(e.messageCount);
      const summary = Number.isSafeInteger(count) && count > 0 ? `\u8F6C\u53D1\u6D88\u606F \xB7 ${count} \u6761` : typeof e.summary === "string" && e.summary.trim() ? e.summary.trim() : "\u5408\u5E76\u8F6C\u53D1\u6D88\u606F";
      return `<span class="reply-content-forward"><span class="reply-forward-title">${ctx.escapeHtml(label)}</span><span class="reply-forward-summary">${ctx.escapeHtml(summary)}</span></span>`;
    }
    case "text":
    default:
      return ctx.escapeHtml(text);
  }
}
function renderReplyPreviewElements(elements, ctx) {
  if (!Array.isArray(elements) || elements.length === 0) return "";
  const parts = [];
  for (const pe of elements) {
    const piece = renderReplyPreviewElement(pe, ctx);
    if (piece) parts.push(piece);
  }
  return parts.join("");
}

// vendor/qce/lib/core/exporter/ModernHtmlTemplates.ts
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => k in vars ? vars[k] : "");
}
var MODERN_CSS = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* CSS Variables for Theme */
        :root {
            --bg-primary: #ffffff;
            --bg-secondary: #f5f5f7;
            --text-primary: #1d1d1f;
            --text-secondary: #86868b;
            --border-color: rgba(0, 0, 0, 0.08);
            --shadow: rgba(0, 0, 0, 0.05);
            --bubble-other: #f2f2f7;
            --bubble-self: #d1e9ff;
            --bubble-self-text: #1d1d1f;
            --at-mention-bg: rgba(29, 29, 31, 0.1);
            --at-mention-text: #1d1d1f;
            --reply-bg: rgba(29, 29, 31, 0.05);
            --reply-border: rgba(29, 29, 31, 0.25);
            --footer-gradient: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.02) 100%);
            --chat-scale: 1;
            --message-font-size: calc(17px * var(--chat-scale));
            --message-sender-size: calc(14px * var(--chat-scale));
            --message-time-size: calc(12px * var(--chat-scale));
        }
        
        [data-theme="dark"] {
            --bg-primary: #000000;
            --bg-secondary: #1c1c1e;
            --text-primary: #f5f5f7;
            --text-secondary: #98989f;
            --border-color: rgba(255, 255, 255, 0.12);
            --shadow: rgba(0, 0, 0, 0.3);
            --bubble-other: #1c1c1e;
            --bubble-self: #2d5a7b;
            --bubble-self-text: #e3f2fd;
            --at-mention-bg: rgba(245, 245, 247, 0.15);
            --at-mention-text: #f5f5f7;
            --reply-bg: rgba(255, 255, 255, 0.08);
            --reply-border: rgba(255, 255, 255, 0.2);
            --footer-gradient: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.03) 100%);
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5; 
            font-size: 17px;
            -webkit-font-smoothing: antialiased;
            transition: background 0.3s, color 0.3s;
        }
        
        /* Toolbar - \u5E95\u90E8\u80F6\u56CA */
        .toolbar {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(249, 249, 249, 0.78);
            backdrop-filter: saturate(180%) blur(20px);
            border-radius: 20px;
            padding: 8px;
            z-index: 1000;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08),
                        0 8px 32px rgba(0, 0, 0, 0.06),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
        }
        
        [data-theme="dark"] .toolbar {
            background: rgba(44, 44, 46, 0.78);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3),
                        0 8px 32px rgba(0, 0, 0, 0.25),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        
        .toolbar-content {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        
        /* \u65F6\u95F4\u8303\u56F4\u9009\u62E9\u80F6\u56CA */
        .time-range-container {
            position: relative;
        }
        .time-range-btn {
            padding: 8px 12px;
            border: none;
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.04);
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            color: var(--text-primary);
            font-size: 13px;
            font-weight: 500;
        }
        [data-theme="dark"] .time-range-btn {
            background: rgba(255, 255, 255, 0.08);
        }
        .time-range-btn:hover {
            background: rgba(0, 0, 0, 0.08);
        }
        [data-theme="dark"] .time-range-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        .time-range-btn svg {
            width: 16px !important;
            height: 16px !important;
            stroke-width: 2 !important;
        }
        .time-range-dropdown {
            position: absolute;
            bottom: calc(100% + 12px);
            right: 0;
            min-width: 240px;
            padding: 12px;
            border-radius: 14px;
            background: rgba(249, 249, 249, 0.88);
            backdrop-filter: saturate(180%) blur(20px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12),
                        0 8px 40px rgba(0, 0, 0, 0.08),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
            opacity: 0;
            transform: translateY(8px);
            pointer-events: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1001;
        }
        [data-theme="dark"] .time-range-dropdown {
            background: rgba(44, 44, 46, 0.88);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4),
                        0 8px 40px rgba(0, 0, 0, 0.3),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        .time-range-dropdown.active {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
        .time-range-inputs {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .time-range-input-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .time-range-input-group label {
            font-size: 12px;
            color: var(--text-secondary);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .time-range-input-group input {
            padding: 6px 10px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 8px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 13px;
            transition: all 0.2s;
        }
        [data-theme="dark"] .time-range-input-group input {
            border-color: rgba(255, 255, 255, 0.12);
            color-scheme: dark;
        }
        .time-range-input-group input:focus {
            outline: none;
            border-color: #1d1d1f;
            box-shadow: 0 0 0 3px rgba(29, 29, 31, 0.1);
        }
        [data-theme="dark"] .time-range-input-group input:focus {
            border-color: #f5f5f7;
            box-shadow: 0 0 0 3px rgba(245, 245, 247, 0.1);
        }
        .time-range-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(0, 0, 0, 0.08);
        }
        [data-theme="dark"] .time-range-actions {
            border-top-color: rgba(255, 255, 255, 0.12);
        }
        .time-range-actions button {
            flex: 1;
            padding: 6px 10px;
            border: none;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .time-range-actions .apply-btn {
            background: #1d1d1f;
            color: #ffffff;
        }
        [data-theme="dark"] .time-range-actions .apply-btn {
            background: #f5f5f7;
            color: #000000;
        }
        .time-range-actions .apply-btn:hover {
            opacity: 0.8;
        }
        .time-range-actions .clear-btn {
            background: rgba(0, 0, 0, 0.06);
            color: var(--text-primary);
        }
        [data-theme="dark"] .time-range-actions .clear-btn {
            background: rgba(255, 255, 255, 0.12);
        }
        .time-range-actions .clear-btn:hover {
            background: rgba(0, 0, 0, 0.1);
        }
        [data-theme="dark"] .time-range-actions .clear-btn:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        /* \u5206\u9694\u7EBF */
        .toolbar-separator {
            width: 1px;
            height: 20px;
            background: rgba(0, 0, 0, 0.08);
            margin: 0 4px;
        }
        
        [data-theme="dark"] .toolbar-separator {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-container {
            display: flex;
            align-items: center;
        }
        
        .search-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .search-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .search-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .search-input-wrapper {
            position: relative;
            width: 0;
            overflow: hidden;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .search-input-wrapper.active {
            width: 240px;
            margin-left: 4px;
        }
        
        .search-input {
            width: 100%;
            padding: 7px 32px 7px 12px;
            border: none;
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.06);
            color: var(--text-primary);
            font-size: 14px;
            outline: none;
            transition: all 0.2s;
            font-family: inherit;
        }
        
        [data-theme="dark"] .search-input {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-input:focus {
            background: rgba(0, 0, 0, 0.1);
        }
        
        [data-theme="dark"] .search-input:focus {
            background: rgba(255, 255, 255, 0.18);
        }
        
        .search-input::placeholder {
            color: var(--text-secondary);
        }
        
        .clear-search {
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 4px;
            border-radius: 50%;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .clear-search:hover {
            background: rgba(0, 0, 0, 0.1);
            color: var(--text-primary);
        }
        
        [data-theme="dark"] .clear-search:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .clear-search svg {
            width: 14px !important;
            height: 14px !important;
            stroke-width: 2.5 !important;
        }
        
        .toolbar-actions {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        
        .filter-container {
            position: relative;
        }
        
        .filter-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .filter-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .filter-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .filter-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .filter-dropdown {
            position: absolute;
            bottom: calc(100% + 12px);
            right: 0;
            min-width: 200px;
            max-width: 280px;
            padding: 6px;
            border-radius: 14px;
            background: rgba(249, 249, 249, 0.88);
            backdrop-filter: saturate(180%) blur(20px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12),
                        0 8px 40px rgba(0, 0, 0, 0.08),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
            opacity: 0;
            transform: translateY(8px);
            pointer-events: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1001;
        }
        
        [data-theme="dark"] .filter-dropdown {
            background: rgba(44, 44, 46, 0.88);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4),
                        0 8px 40px rgba(0, 0, 0, 0.3),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        
        .filter-dropdown.active {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
        
        /* \u7B5B\u9009\u641C\u7D22\u6846 */
        .filter-search-wrapper {
            padding: 4px 6px 8px;
            border-bottom: 1px solid rgba(0, 0, 0, 0.08);
            margin-bottom: 6px;
        }
        
        [data-theme="dark"] .filter-search-wrapper {
            border-bottom-color: rgba(255, 255, 255, 0.12);
        }
        
        .filter-search-input {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 8px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 13px;
            outline: none;
            transition: all 0.2s;
        }
        
        [data-theme="dark"] .filter-search-input {
            border-color: rgba(255, 255, 255, 0.12);
        }
        
        .filter-search-input:focus {
            border-color: #1d1d1f;
            box-shadow: 0 0 0 2px rgba(29, 29, 31, 0.1);
        }
        
        [data-theme="dark"] .filter-search-input:focus {
            border-color: #f5f5f7;
            box-shadow: 0 0 0 2px rgba(245, 245, 247, 0.1);
        }
        
        .filter-search-input::placeholder {
            color: var(--text-secondary);
        }
        
        /* \u7B5B\u9009\u9009\u9879\u5217\u8868\u5BB9\u5668 */
        .filter-options-list {
            max-height: 320px;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
        }
        
        .filter-options-list::-webkit-scrollbar {
            width: 6px;
        }
        
        .filter-options-list::-webkit-scrollbar-track {
            background: transparent;
        }
        
        .filter-options-list::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 3px;
        }
        
        [data-theme="dark"] .filter-options-list::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
        }
        
        .filter-option {
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.15s;
            font-size: 14px;
            color: var(--text-primary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .filter-option:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .filter-option:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .filter-option.active {
            background: rgba(0, 0, 0, 0.08);
            font-weight: 600;
        }
        
        [data-theme="dark"] .filter-option.active {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .filter-option.hidden {
            display: none;
        }
        
        /* \u65E0\u641C\u7D22\u7ED3\u679C\u63D0\u793A */
        .filter-no-result {
            padding: 12px;
            text-align: center;
            color: var(--text-secondary);
            font-size: 13px;
            display: none;
        }
        
        .filter-no-result.visible {
            display: block;
        }
        
        .github-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            text-decoration: none;
        }
        
        .github-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .github-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .github-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .theme-toggle {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .theme-toggle:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .theme-toggle:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .theme-toggle svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        /* \u641C\u7D22\u9AD8\u4EAE */
        mark.highlight {
            background: #00ffc860 !important;
            color: #000000 !important;
            font-weight: 600;
            padding: 2px 4px;
            border-radius: 4px;
        }
        
        [data-theme="dark"] mark.highlight {
            background: #00ffc860 !important;
            color: #000000 !important;
        }
        
        /* Hero Section - \u5DE6\u5BF9\u9F50 */
        .hero {
            padding: 80px 64px 48px;
            max-width: 980px;
            margin: 0 auto;
            border-bottom: 1px solid var(--border-color);
        }
        
        .hero-title {
            font-size: 64px;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 8px;
            letter-spacing: -0.03em;
            line-height: 1.05;
        }
        
        .hero-subtitle {
            font-size: 17px;
            color: var(--text-secondary);
            font-weight: 400;
            margin-bottom: 24px;
        }
        
        .hero-meta {
            display: flex;
            gap: 32px;
            flex-wrap: wrap;
        }
        .chat-layout {
            max-width: 1280px;
            margin: 0 auto;
            padding: 0 48px 120px;
        }
        .chat-main {
            min-width: 0;
        }
        
        .meta-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .meta-label {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 400;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .meta-value {
            font-size: 17px;
            color: var(--text-primary);
            font-weight: 500;
        }
        
        /* Chat Content */
        .chat-content {
            padding: 64px 0 120px;
            position: relative;
            max-width: 980px;
            margin: 0 auto;
        }
        
        /* \u865A\u62DF\u6EDA\u52A8\u5BB9\u5668 */
        .virtual-scroll-container {
            position: relative;
            overflow: hidden;
            overflow-anchor: none;
        }
        
        .virtual-scroll-spacer {
            width: 1px;
            pointer-events: none;
        }
        
        .virtual-scroll-content {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            overflow-anchor: none;
        }

        .virtual-scroll-content > .message-block {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            width: 100%;
            will-change: transform;
        }
        
        /* \u52A0\u8F7D\u6307\u793A\u5668 */
        .scroll-loader {
            text-align: center;
            padding: 20px;
            color: var(--text-secondary);
            font-size: 14px;
        }
        
        .message-block {
            margin-bottom: 32px;
        }
        .date-divider {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 32px 0 16px;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 0.1em;
            color: var(--text-secondary);
        }
        .date-divider::before,
        .date-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: var(--border-color);
        }
        .message {
            margin-bottom: 0;
            display: flex;
            gap: 16px;
            align-items: flex-start;
            contain: layout style paint;
            will-change: auto;
        }
        
        .message.self {
            flex-direction: row-reverse;
        }
        
        .avatar {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: var(--bg-secondary);
            flex-shrink: 0;
            overflow: hidden;
        }
        
        .avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        
        .message-wrapper {
            max-width: 65%;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .message-header {
            display: flex;
            align-items: baseline;
            gap: 10px;
            padding: 0 4px;
        }
        
        .message.self .message-header {
            flex-direction: row-reverse;
        }
        
        .sender {
            font-size: var(--message-sender-size);
            font-weight: 600;
            color: var(--text-primary);
        }

        /* \u7FA4\u5934\u8854\u5FBD\u7AE0\uFF08issue #331\uFF09 */
        .sender-title {
            display: inline-block;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.4;
            color: #fff;
            background: linear-gradient(135deg, #ff7a59, #ff4d4f);
            padding: 1px 6px;
            border-radius: 4px;
            margin-right: 6px;
            white-space: nowrap;
        }

        .time {
            font-size: var(--message-time-size);
            color: var(--text-secondary);
        }
        
        /* \u6D88\u606F\u6C14\u6CE1 - \u5E26\u89D2 */
        .message-bubble {
            padding: 14px 18px;
            border-radius: 20px;
            position: relative;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        
        .message.other .message-bubble {
            background: var(--bubble-other);
            color: var(--text-primary);
        }
        
        .message.self .message-bubble {
            background: var(--bubble-self);
            color: var(--bubble-self-text);
        }
        
        /* \u53BB\u6389\u6D88\u606F\u89D2 - \u76F4\u63A5\u7528\u5706\u89D2\u77E9\u5F62 */
        
        .content {
            font-size: var(--message-font-size);
            line-height: 1.47;
        }
        
        .text-content {
            display: inline;
        }
        
        /* \u56FE\u7247\u5185\u5BB9 */
        .image-content {
            margin: 10px 0 4px;
            border-radius: 16px;
            overflow: hidden;
            max-width: 320px;
        }
        
        .image-content img {
            width: 100%;
            height: auto;
            display: block;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        
        .image-content img:hover {
            opacity: 0.9;
        }
        
        /* @\u63D0\u53CA */
        .at-mention {
            background: var(--at-mention-bg);
            color: var(--at-mention-text);
            padding: 3px 8px;
            border-radius: 8px;
            font-weight: 600;
            display: inline;
            transition: background 0.2s;
        }
        
        .message.other .at-mention:hover {
            opacity: 0.85;
        }
        
        .message.self .at-mention {
            background: rgba(0, 0, 0, 0.1);
            color: var(--bubble-self-text);
        }
        
        .message.self .at-mention:hover {
            background: rgba(0, 0, 0, 0.15);
        }
        
        /* \u8868\u60C5 */
        .face-emoji {
            display: inline;
            font-size: 20px;
            margin: 0 2px;
            vertical-align: baseline;
        }
        
        /* \u5F15\u7528\u6D88\u606F */
        .reply-content {
            background: var(--reply-bg);
            border-left: 3px solid var(--reply-border);
            padding: 10px 12px;
            border-radius: 8px;
            margin-bottom: 8px;
            font-size: 13px;
            line-height: 1.5;
            color: var(--text-secondary);
            cursor: default;
            transition: all 0.2s;
        }
        
        .reply-content-clickable {
            cursor: pointer;
        }

        .reply-content-clickable:hover,
        .reply-content-clickable:focus-visible {
            background: var(--reply-border);
            opacity: 1;
            transform: translateX(2px);
        }
        
        .reply-content-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
        }
        
        .reply-content strong {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .reply-content-time {
            font-size: 11px;
            color: var(--text-tertiary);
            margin-left: 8px;
        }
        
        .reply-content-text {
            color: var(--text-secondary);
            margin-top: 4px;
            word-break: break-word;
        }
        
        .reply-content-image {
            margin-top: 6px;
            max-width: 80px;
            max-height: 80px;
            border-radius: 6px;
            object-fit: cover;
        }

        /* issue #128: \u5F15\u7528\u6846\u91CC\u8DDF\u6587\u5B57\u6DF7\u6392\u7684\u7F29\u7565\u56FE / \u8868\u60C5 */
        .reply-content-thumb {
            display: inline-block;
            vertical-align: middle;
            max-width: 64px;
            max-height: 64px;
            border-radius: 4px;
            object-fit: cover;
            margin: 0 4px;
        }
        .reply-content-emoji {
            display: inline-block;
            vertical-align: middle;
            width: 20px;
            height: 20px;
            margin: 0 2px;
        }
        .reply-content-video {
            display: block;
            width: min(240px, 100%);
            max-height: 160px;
            margin-top: 6px;
            border-radius: 6px;
            background: #000;
        }
        .reply-content-audio {
            display: block;
            width: min(260px, 100%);
            height: 34px;
            margin-top: 6px;
        }
        a.reply-content-attachment {
            color: inherit;
            text-decoration: underline;
        }

        .reply-content-forward {
            display: block;
            max-width: min(320px, 100%);
            box-sizing: border-box;
            margin-top: 4px;
            padding: 8px 10px;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            background: var(--bg-secondary);
            color: var(--text-primary);
            white-space: normal;
        }
        .reply-forward-title { display: block; font-weight: 600; }
        .reply-forward-title::before { content: '\u25A4 '; }
        .reply-forward-summary { display: block; margin-top: 2px; font-size: 11px; color: var(--text-secondary); }

        .export-media-issue { display: block; max-width: 100%; box-sizing: border-box; margin: 6px 0; padding: 10px 12px; border: 1px solid #ef9a9a; border-left: 4px solid #cf3131; border-radius: 8px; background: #fff0f0; color: #a21d26; overflow-wrap: anywhere; white-space: normal; }
        .export-media-issue strong, .export-media-issue span { display: block; color: inherit !important; }
        .export-media-issue span { margin-top: 3px; font-size: 12px; }
        .export-media-skipped { background: var(--bg-secondary); border-color: var(--border-color); color: var(--text-secondary); }
        [data-theme="dark"] .export-media-failure { background: #3b1c23; border-color: #ae5662; color: #ffb5bd; }
        
        .message.self .reply-content {
            background: rgba(0, 0, 0, 0.08);
            border-left-color: rgba(0, 0, 0, 0.25);
        }
        
        .message.self .reply-content:hover {
            background: rgba(0, 0, 0, 0.12);
        }
        
        .message.self .reply-content strong {
            color: var(--bubble-self-text);
        }
        
        /* \u97F3\u9891\u5305\u88C5\u5668 */
        .audio-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .audio-download-link {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            background: rgba(0, 0, 0, 0.05);
            border-radius: 8px;
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 13px;
            transition: all 0.2s;
        }
        
        .audio-download-link:hover {
            background: rgba(0, 0, 0, 0.1);
            color: var(--text-primary);
        }
        
        [data-theme="dark"] .audio-download-link {
            background: rgba(255, 255, 255, 0.08);
        }
        
        [data-theme="dark"] .audio-download-link:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        
        /* JSON \u5361\u7247 */
        .json-card {
            background: rgba(29, 29, 31, 0.06);
            border: 1px solid rgba(29, 29, 31, 0.1);
            border-radius: 12px;
            padding: 14px 16px;
            margin: 8px 0;
            transition: background 0.2s;
        }
        
        .json-card:hover {
            background: rgba(29, 29, 31, 0.08);
        }
        
        .message.self .json-card {
            background: rgba(0, 0, 0, 0.08);
            border-color: rgba(0, 0, 0, 0.15);
        }
        
        .message.self .json-card:hover {
            background: rgba(0, 0, 0, 0.12);
        }
        
        .json-title {
            font-weight: 600;
            font-size: 15px;
            margin-bottom: 6px;
            line-height: 1.3;
        }
        
        .json-description {
            font-size: 14px;
            opacity: 0.75;
            margin-bottom: 8px;
            line-height: 1.4;
        }
        
        .json-url {
            font-size: 12px;
            opacity: 0.6;
            text-decoration: none;
        }
        
        /* \u5E02\u573A\u8868\u60C5 */
        .market-face {
            display: inline-block;
            width: 80px;
            height: 80px;
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            vertical-align: middle;
            margin: 4px 0;
        }
        
        /* QQ\u8868\u60C5 */
        .face-emoji {
            display: inline-block;
            padding: 2px 8px;
            background: rgba(0, 0, 0, 0.05);
            border-radius: 6px;
            font-size: 13px;
            color: var(--text-secondary);
            margin: 0 2px;
        }
        
        [data-theme="dark"] .face-emoji {
            background: rgba(255, 255, 255, 0.1);
        }
        
        /* \u89C6\u9891\u64AD\u653E\u5668 */
        .message-video {
            max-width: 100%;
            width: 400px;
            max-height: 300px;
            border-radius: 12px;
            margin: 8px 0;
            display: block;
            background: #000;
        }
        
        /* \u97F3\u9891\u64AD\u653E\u5668 */
        .message-audio {
            width: 280px;
            max-width: 100%;
            margin: 8px 0;
            display: block;
        }
        
        /* \u5408\u5E76\u8F6C\u53D1\u6D88\u606F\u5361\u7247 */
        .forward-card {
            background: var(--bubble-other);
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 12px;
            padding: 12px 16px;
            margin: 4px 0;
            cursor: default;
            transition: all 0.2s;
        }

        details.forward-card-expandable {
            padding: 0;
            min-width: min(520px, 62vw);
            overflow: hidden;
        }

        .forward-card-summary {
            display: block;
            list-style: none;
            padding: 12px 16px;
            cursor: pointer;
            user-select: none;
        }

        .forward-card-summary::-webkit-details-marker {
            display: none;
        }

        .forward-card-summary::marker {
            display: none;
            content: '';
        }

        .forward-card-summary:focus-visible {
            outline: 2px solid var(--accent-color);
            outline-offset: -2px;
            border-radius: 11px;
        }

        details.forward-card-expandable[open] > .forward-card-summary {
            border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }

        [data-theme="dark"] details.forward-card-expandable[open] > .forward-card-summary {
            border-bottom-color: rgba(255, 255, 255, 0.1);
        }
        
        [data-theme="dark"] .forward-card {
            border-color: rgba(255, 255, 255, 0.1);
        }
        
        .message.self .forward-card {
            background: rgba(0, 0, 0, 0.05);
        }
        
        .forward-card-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .forward-card-icon {
            width: 20px;
            height: 20px;
            opacity: 0.7;
        }
        
        .forward-card-content {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.6;
            position: relative;
        }

        /* issue #434\uFF1A\u5D4C\u5957\u7684\u5408\u5E76\u8F6C\u53D1\u6D88\u606F\u5361\u7247\uFF0C\u7F29\u8FDB + \u5DE6\u4FA7\u5206\u9694\u7EBF\uFF0C\u533A\u5206\u5C42\u7EA7\u3002 */
        .forward-card-nested {
            margin-left: 8px;
            margin-top: 4px;
            border-left: 2px solid rgba(0, 0, 0, 0.08);
        }

        [data-theme="dark"] .forward-card-nested {
            border-left-color: rgba(255, 255, 255, 0.12);
        }
        
        .forward-card-footer {
            margin-top: 8px;
            font-size: 12px;
            color: var(--text-tertiary);
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
        }

        .forward-card-action {
            color: var(--accent-color);
            font-weight: 600;
        }

        .forward-card-action-collapse {
            display: none;
        }

        details.forward-card-expandable[open] > .forward-card-summary .forward-card-action-expand {
            display: none;
        }

        details.forward-card-expandable[open] > .forward-card-summary .forward-card-action-collapse {
            display: inline;
        }

        .forward-card-details {
            max-height: min(68vh, 680px);
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 8px 16px 16px;
            cursor: default;
            scrollbar-gutter: stable;
        }

        .forward-message-item {
            padding: 12px 0;
            border-bottom: 1px solid rgba(0, 0, 0, 0.07);
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }

        .forward-message-item:last-child {
            border-bottom: 0;
        }

        [data-theme="dark"] .forward-message-item {
            border-bottom-color: rgba(255, 255, 255, 0.09);
        }

        .forward-message-avatar {
            width: 32px;
            height: 32px;
            flex: 0 0 32px;
            border-radius: 50%;
            overflow: hidden;
            background: linear-gradient(135deg, #5b8ff9, #7b61ff);
            box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.05);
        }

        .forward-message-avatar img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .forward-message-avatar-fallback {
            display: none;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            line-height: 1;
        }

        .forward-message-main {
            flex: 1 1 auto;
            min-width: 0;
        }

        .forward-message-meta {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 6px;
        }

        .forward-message-sender {
            color: var(--text-primary);
            font-size: 13px;
            font-weight: 600;
            overflow-wrap: anywhere;
        }

        .forward-message-time {
            color: var(--text-tertiary);
            font-size: 11px;
            white-space: nowrap;
        }

        .forward-message-content {
            color: var(--text-primary);
            font-size: 14px;
            line-height: 1.55;
            user-select: text;
            overflow-wrap: anywhere;
        }

        .forward-message-content .image-content {
            max-width: 260px;
        }

        .forward-card-unavailable .forward-card-footer {
            justify-content: flex-end;
        }

        @media (max-width: 720px) {
            details.forward-card-expandable {
                min-width: min(78vw, 520px);
            }

            .forward-card-details {
                max-height: 62vh;
            }

            .forward-message-meta {
                display: block;
            }

            .forward-message-time {
                display: block;
                margin-top: 2px;
            }
        }
        
        /* \u56FE\u7247\u6A21\u6001\u6846 */
        .image-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            cursor: pointer;
        }
        
        .image-modal img {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 90vw;
            max-height: 90vh;
            object-fit: contain;
            border-radius: 8px;
        }
        
        /* \u6EDA\u52A8\u6761 */
        ::-webkit-scrollbar {
            width: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
            background: #d1d1d6;
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: #c7c7cc;
        }
        
        /* \u54CD\u5E94\u5F0F */
        @media (max-width: 768px) {
            .hero {
                padding: 48px 24px 32px;
            }
            
            .hero-title {
                font-size: 40px;
            }
            
            .hero-subtitle {
                font-size: 15px;
            }
            
            .hero-meta {
                gap: 24px;
            }
            
            .chat-content {
                padding: 48px 24px 80px;
            }
            
            .message {
                margin-bottom: 28px;
                gap: 12px;
            }
            
            .avatar {
                width: 38px;
                height: 38px;
            }
            
            .message-wrapper {
                max-width: 75%;
            }
        }
        
        /* Footer */
        .footer {
            margin-top: 100px;
            padding: 80px 0;
            background: var(--footer-gradient);
        }
        
        .footer-content {
            max-width: 800px;
            margin: 0 auto;
            text-align: center;
        }
        
        .footer-brand h3 {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.5px;
            color: var(--text-primary);
            margin-bottom: 8px;
        }
        
        .footer-version {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 500;
            margin-bottom: 32px;
        }
        
        .footer-info {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .footer-copyright {
            font-size: 15px;
            color: var(--text-primary);
            font-weight: 400;
        }
        
        .footer-copyright strong {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .footer-links {
            font-size: 14px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .footer-links a,
        .footer-links > span:not(.separator) {
            color: var(--text-primary);
            text-decoration: none;
            font-weight: 500;
        }
        
        .footer-links a {
            transition: opacity 0.2s;
        }
        
        .footer-links a:hover {
            opacity: 0.7;
        }
        
        .footer-links .separator {
            color: var(--text-secondary);
            font-weight: 300;
        }
        
        .footer-notice {
            font-size: 13px;
            color: var(--text-secondary);
            margin-top: 8px;
            font-weight: 400;
        }
        
        /* \u9690\u85CF\u6D88\u606F (\u641C\u7D22/\u7B5B\u9009) */
        .message.hidden {
            display: none !important;
        }
        @media (max-width: 1100px) {
            .chat-layout {
                padding: 0 24px 80px;
            }
            .chat-content {
                padding: 32px 0 80px;
            }
            .message-wrapper {
                max-width: 80%;
            }
        }
`;
var MODERN_TOOLBAR_HTML = `<div class="toolbar">
        <div class="toolbar-content">
            <div class="search-container">
                <button class="search-btn" id="searchBtn">
                    <i data-lucide="search"></i>
                </button>
                <div class="search-input-wrapper" id="searchWrapper">
                    <input type="text" id="searchInput" class="search-input" placeholder="\u641C\u7D22\u6D88\u606F...">
                    <button class="clear-search" id="clearSearch" style="display: none;">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-actions">
                <div class="filter-container">
                    <button class="filter-btn" id="filterBtn">
                        <i data-lucide="user"></i>
                    </button>
                    <div class="filter-dropdown" id="filterDropdown">
                        <div class="filter-search-wrapper">
                            <input type="text" class="filter-search-input" id="filterSearchInput" placeholder="\u641C\u7D22\u6210\u5458...">
                        </div>
                        <div class="filter-options-list" id="filterOptionsList">
                            <div class="filter-option active" data-value="all">\u5168\u90E8\u6210\u5458</div>
                        </div>
                        <div class="filter-no-result" id="filterNoResult">\u672A\u627E\u5230\u5339\u914D\u7684\u6210\u5458</div>
                    </div>
                </div>
                <div class="toolbar-separator"></div>
                <div class="time-range-container">
                    <button class="time-range-btn" id="timeRangeBtn">
                        <i data-lucide="calendar"></i>
                        <span id="timeRangeLabel">\u5168\u90E8\u65F6\u95F4</span>
                    </button>
                    <div class="time-range-dropdown" id="timeRangeDropdown">
                        <div class="time-range-inputs">
                            <div class="time-range-input-group">
                                <label for="startDate">\u5F00\u59CB\u65E5\u671F</label>
                                <input type="date" id="startDate" class="time-range-input">
                            </div>
                            <div class="time-range-input-group">
                                <label for="endDate">\u7ED3\u675F\u65E5\u671F</label>
                                <input type="date" id="endDate" class="time-range-input">
                            </div>
                        </div>
                        <div class="time-range-actions">
                            <button class="apply-btn" id="applyTimeRange">\u5E94\u7528</button>
                            <button class="clear-btn" id="clearTimeRange">\u6E05\u9664</button>
                        </div>
                    </div>
                </div>
                <div class="toolbar-separator"></div>
                <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank" class="github-btn" title="GitHub">
                    <i data-lucide="github"></i>
                </a>
                <div class="toolbar-separator"></div>
                <button class="theme-toggle" id="themeToggle" title="\u5207\u6362\u4E3B\u9898">
                    <i data-lucide="sun" id="themeIcon"></i>
                </button>
            </div>
        </div>
    </div>`;
var MODERN_FOOTER_HTML = `    <!-- Footer -->
    <footer class="footer">
        <div class="footer-content">
            <div class="footer-brand">
                <h3>QQ Chat Exporter Pro</h3>
            </div>
            <div class="footer-info">
                <p class="footer-copyright">Made with \u2764\uFE0F by <strong>shuakami</strong></p>
                <p class="footer-links">
                    <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank">GitHub</a>
                    <span class="separator">\xB7</span>
                    <span>GPL-3.0 License</span>
                </p>
                <p class="footer-notice">\u672C\u8F6F\u4EF6\u5B8C\u5168\u514D\u8D39\u5F00\u6E90 \xB7 \u5982\u679C\u6709\u5E2E\u52A9\u5230\u60A8\uFF0C\u6B22\u8FCE\u7ED9\u4E2A Star \u55B5\uFF0C\u8C22\u8C22\u55B5</p>
            </div>
        </div>
    </footer>`;
var MODERN_SINGLE_APP_JS = `
        function showImageModal(imgSrc) {
            var modal = document.getElementById('imageModal');
            var modalImg = document.getElementById('modalImage');
            modal.style.display = 'block';
            modalImg.src = imgSrc;
        }
        function hideImageModal() {
            document.getElementById('imageModal').style.display = 'none';
        }
        // ========== \u865A\u62DF\u6EDA\u52A8\u7BA1\u7406\u5668 ==========
        class VirtualScroller {
            constructor(container, items, options = {}) {
                this.container = container;
                this.options = {
                    itemHeight: options.itemHeight || 100,
                    bufferSize: options.bufferSize || 10,
                    ...options
                };

                this.allItems = [];
                this.itemHeights = [];
                this.itemOffsets = [0];
                this.knownHeights = new Map();
                this.startIndex = -1;
                this.endIndex = -1;
                this.scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
                this.containerHeight = 0;
                this.totalHeight = 0;
                this.isUpdating = false;
                this.updateScheduled = false;
                this.measureScheduled = false;
                this.resizeObserver = null;
                this.explicitResizeItems = new Set();
                this.handleDetailsToggle = this.handleDetailsToggle.bind(this);

                this.setItems(items);
                this.init();
            }

            getItemKey(item, index) {
                var blockId = item && item.getAttribute ? item.getAttribute('data-message-id') : null;
                if (blockId) return blockId;
                var message = item && item.querySelector ? item.querySelector('.message') : null;
                return message && message.id ? message.id : 'index-' + index;
            }

            normalizeHeight(value) {
                var height = Number(value);
                return Number.isFinite(height) && height > 0 ? height : this.options.itemHeight;
            }

            setItems(items) {
                this.allItems = Array.isArray(items) ? items : [];
                this.itemHeights = this.allItems.map((item, index) => {
                    var key = this.getItemKey(item, index);
                    var cached = this.knownHeights.get(key);
                    var measured = item && item.getAttribute
                        ? item.getAttribute('data-qce-virtual-height')
                        : null;
                    var height = this.normalizeHeight(cached || measured);
                    if (measured) this.knownHeights.set(key, height);
                    return height;
                });
                this.rebuildOffsets();
            }

            rebuildOffsets() {
                var offsets = new Array(this.itemHeights.length + 1);
                offsets[0] = 0;
                for (var i = 0; i < this.itemHeights.length; i++) {
                    offsets[i + 1] = offsets[i] + this.itemHeights[i];
                }
                this.itemOffsets = offsets;
                this.totalHeight = offsets[offsets.length - 1] || 0;
                if (this.spacer) this.spacer.style.height = this.totalHeight + 'px';
            }

            findIndexAtOffset(offset) {
                if (this.allItems.length === 0) return 0;
                var target = Math.max(0, Math.min(Number(offset) || 0, Math.max(0, this.totalHeight - 1)));
                var low = 0;
                var high = this.allItems.length;
                while (low < high) {
                    var mid = (low + high) >>> 1;
                    if (this.itemOffsets[mid + 1] <= target) low = mid + 1;
                    else high = mid;
                }
                return Math.min(low, this.allItems.length - 1);
            }

            getContainerTop() {
                return (window.pageYOffset || document.documentElement.scrollTop || 0)
                    + this.container.getBoundingClientRect().top;
            }

            init() {
                // \u521B\u5EFA\u865A\u62DF\u6EDA\u52A8\u7ED3\u6784
                this.container.classList.add('virtual-scroll-container');
                this.spacer = document.createElement('div');
                this.spacer.className = 'virtual-scroll-spacer';
                
                this.content = document.createElement('div');
                this.content.className = 'virtual-scroll-content';
                
                this.container.appendChild(this.spacer);
                this.container.appendChild(this.content);
                this.content.addEventListener('toggle', this.handleDetailsToggle, true);

                this.spacer.style.height = this.totalHeight + 'px';

                if (typeof ResizeObserver !== 'undefined') {
                    this.resizeObserver = new ResizeObserver(() => this.scheduleMeasurement());
                }

                // \u76D1\u542C\u6EDA\u52A8
                this.handleScroll = this.handleScroll.bind(this);
                window.addEventListener('scroll', this.handleScroll, { passive: true });
                window.addEventListener('resize', () => this.update());

                this.update();
            }

            handleDetailsToggle(event) {
                var target = event && event.target;
                if (!target || typeof target.matches !== 'function'
                    || !target.matches('details.forward-card-expandable')) return;

                var item = typeof target.closest === 'function'
                    ? target.closest('.message-block')
                    : null;
                // \u672A\u52A0\u8F7D\u5A92\u4F53\u901A\u5E38\u4E0D\u5141\u8BB8\u628A\u7F13\u5B58\u9AD8\u5EA6\u7F29\u5C0F\uFF0C\u4F46 details \u7684\u4E3B\u52A8\u6536\u8D77\u662F
                // \u5408\u6CD5\u7F29\u5C0F\u3002\u4EC5\u7ED9\u53D1\u751F toggle \u7684\u6D88\u606F\u653E\u884C\u4E24\u6B21\u6D4B\u91CF\uFF0C\u907F\u514D\u5F71\u54CD\u5176\u4ED6\u6D88\u606F\u3002
                if (item) this.explicitResizeItems.add(item);
                this.scheduleMeasurement();
                requestAnimationFrame(() => {
                    if (item) this.explicitResizeItems.add(item);
                    this.scheduleMeasurement();
                });
            }

            handleScroll() {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                this.scrollTop = scrollTop;
                if (this.updateScheduled || this.isUpdating) return;
                this.updateScheduled = true;
                requestAnimationFrame(() => {
                    this.updateScheduled = false;
                    this.update();
                });
            }

            update() {
                if (!this.allItems || this.allItems.length === 0 || this.isUpdating) return;

                this.isUpdating = true;
                try {
                    this.containerHeight = window.innerHeight;
                    this.scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
                    var containerTop = this.getContainerTop();
                    var visibleStart = Math.max(0, this.scrollTop - containerTop);
                    var visibleEnd = Math.max(0, visibleStart + this.containerHeight);
                    var firstVisible = this.findIndexAtOffset(visibleStart);
                    var lastVisible = this.findIndexAtOffset(visibleEnd);
                    var edgeBuffer = Math.max(2, Math.floor(this.options.bufferSize / 2));
                    var outsideWindow = this.startIndex < 0
                        || firstVisible < this.startIndex
                        || lastVisible >= this.endIndex;
                    var nearStartEdge = this.startIndex > 0
                        && firstVisible - this.startIndex < edgeBuffer;
                    var nearEndEdge = this.endIndex < this.allItems.length
                        && (this.endIndex - 1) - lastVisible < edgeBuffer;

                    // \u53EA\u6709\u63A5\u8FD1\u5DF2\u6E32\u67D3\u7A97\u53E3\u8FB9\u7F18\u65F6\u624D\u6574\u4F53\u6362\u7A97\u3002\u5426\u5219\u6BCF\u8DE8\u8FC7\u4E00\u6761\u6D88\u606F
                    // \u90FD innerHTML \u91CD\u5EFA\u4E00\u6B21\uFF0C\u4F1A\u9020\u6210\u56FE\u7247\u95EA\u70C1\u548C\u8089\u773C\u53EF\u89C1\u7684\u4E0A\u4E0B\u6296\u52A8\u3002
                    if (outsideWindow || nearStartEdge || nearEndEdge) {
                        var startIndex = Math.max(0, firstVisible - this.options.bufferSize);
                        var endIndex = Math.min(this.allItems.length, lastVisible + this.options.bufferSize + 1);
                        this.startIndex = startIndex;
                        this.endIndex = endIndex;
                        this.render();
                    }
                } finally {
                    this.isUpdating = false;
                }
            }

            positionRenderedItems() {
                Array.from(this.content.children).forEach(item => {
                    var index = Number(item.getAttribute('data-qce-virtual-index'));
                    if (!Number.isInteger(index) || index < 0 || index >= this.itemOffsets.length - 1) return;
                    item.style.transform = 'translateY(' + (this.itemOffsets[index] || 0) + 'px)';
                });
            }

            watchRenderedItem(item) {
                if (this.resizeObserver) this.resizeObserver.observe(item);
                item.querySelectorAll('img, video').forEach(media => {
                    var tagName = media.tagName ? media.tagName.toLowerCase() : '';
                    var isVideo = tagName === 'video';
                    if ((!isVideo && media.complete)
                        || (isVideo && media.readyState > 0)
                        || media.__qceHeightListenerAttached) return;
                    media.__qceHeightListenerAttached = true;
                    var events = isVideo
                        ? ['loadedmetadata', 'canplay', 'error']
                        : ['load', 'error'];
                    var settled = () => {
                        media.__qceHeightListenerAttached = false;
                        events.forEach(eventName => media.removeEventListener(eventName, settled));
                        this.scheduleMeasurement();
                    };
                    events.forEach(eventName => media.addEventListener(eventName, settled, { once: true }));
                });
            }

            hasPendingLayoutMedia(item) {
                return Array.from(item.querySelectorAll(
                    '.image-content img, .market-face, .reply-content-thumb, video'
                )).some(media => {
                    if (media.tagName && media.tagName.toLowerCase() === 'video') {
                        return media.readyState === 0;
                    }
                    return media.complete === false;
                });
            }

            render() {
                var wanted = [];
                var wantedSet = new Set();

                for (let i = this.startIndex; i < this.endIndex; i++) {
                    var item = this.allItems[i];
                    if (!item) continue;
                    item.setAttribute('data-qce-virtual-index', String(i));
                    wanted.push(item);
                    wantedSet.add(item);
                }

                // \u53EA\u79FB\u9664\u79BB\u5F00\u7F13\u51B2\u7A97\u53E3\u7684\u8FB9\u7F18\u8282\u70B9\u3002\u4ECD\u5728\u7A97\u53E3\u91CC\u7684\u6D88\u606F\u590D\u7528\u539F DOM\uFF0C
                // \u907F\u514D\u56FE\u7247\u3001\u89C6\u9891\u548C\u5934\u50CF\u5728\u6BCF\u6B21\u6362\u7A97\u65F6\u91CD\u65B0\u52A0\u8F7D\u5E76\u9020\u6210\u9AD8\u5EA6\u584C\u7F29\u3002
                Array.from(this.content.children).forEach(item => {
                    if (wantedSet.has(item)) return;
                    if (this.resizeObserver) this.resizeObserver.unobserve(item);
                    item.remove();
                });

                // \u4FDD\u6301 DOM \u987A\u5E8F\uFF0C\u4F46\u79FB\u52A8\u65E2\u6709\u8282\u70B9\u65F6\u4E0D\u514B\u9686\u3001\u4E0D\u6E05\u7A7A\u5BB9\u5668\u3002
                var referenceNode = this.content.firstChild;
                wanted.forEach(item => {
                    if (item !== referenceNode) {
                        this.content.insertBefore(item, referenceNode);
                    }
                    referenceNode = item.nextSibling;
                    this.watchRenderedItem(item);
                });

                this.positionRenderedItems();
                this.scheduleMeasurement();

                // \u91CD\u65B0\u521D\u59CB\u5316\u56FE\u6807
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons({
                        attrs: { 'stroke-width': 2 }
                    });
                }
            }

            scheduleMeasurement() {
                if (this.measureScheduled) return;
                this.measureScheduled = true;
                requestAnimationFrame(() => {
                    this.measureScheduled = false;
                    this.measureRenderedItems();
                });
            }

            measureRenderedItems() {
                if (!this.content || this.allItems.length === 0) return;
                var currentScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
                var containerTop = this.getContainerTop();
                var visibleOffset = Math.max(0, currentScrollTop - containerTop);
                var anchorIndex = this.findIndexAtOffset(visibleOffset);
                var anchorWithin = visibleOffset - (this.itemOffsets[anchorIndex] || 0);
                var changed = false;

                Array.from(this.content.children).forEach(item => {
                    var index = Number(item.getAttribute('data-qce-virtual-index'));
                    if (!Number.isInteger(index) || index < 0 || index >= this.itemHeights.length) return;
                    var rect = item.getBoundingClientRect();
                    var style = window.getComputedStyle(item);
                    var marginTop = parseFloat(style.marginTop) || 0;
                    var marginBottom = parseFloat(style.marginBottom) || 0;
                    var measured = rect.height + marginTop + marginBottom;
                    if (!Number.isFinite(measured) || measured <= 0) return;
                    var isExplicitResize = this.explicitResizeItems.has(item);
                    // \u5A92\u4F53\u5C1A\u672A\u5B8C\u6210\u5E03\u5C40\u65F6\uFF0C\u62D2\u7EDD\u628A\u7A33\u5B9A\u7F13\u5B58\u7F29\u5C0F\u4E3A\u4E34\u65F6\u584C\u7F29\u503C\uFF1B\u4F46
                    // details \u7684\u4E3B\u52A8\u5C55\u5F00/\u6536\u8D77\u5FC5\u987B\u63A5\u53D7\uFF0C\u5426\u5219\u4E0B\u4E00\u6761\u6D88\u606F\u4F1A\u91CD\u53E0\u6216
                    // \u5728\u6536\u8D77\u540E\u4ECD\u505C\u7559\u5728\u65E7 offset\uFF0C\u7559\u4E0B\u5927\u7247\u7A7A\u767D\u3002
                    if (this.hasPendingLayoutMedia(item)
                        && measured < this.itemHeights[index] - 0.5
                        && !isExplicitResize) return;
                    this.explicitResizeItems.delete(item);
                    if (Math.abs(measured - this.itemHeights[index]) > 0.5) {
                        this.itemHeights[index] = measured;
                        this.knownHeights.set(this.getItemKey(this.allItems[index], index), measured);
                        changed = true;
                    }
                });

                if (!changed) return;
                this.rebuildOffsets();
                this.positionRenderedItems();

                // \u9AD8\u5EA6\u4FEE\u6B63\u53D1\u751F\u5728\u89C6\u53E3\u4E0A\u65B9\u65F6\uFF0C\u7EF4\u6301\u5F53\u524D\u6D88\u606F\u5728\u5C4F\u5E55\u4E2D\u7684\u76F8\u5BF9\u4F4D\u7F6E\u3002
                var correctedOffset = (this.itemOffsets[anchorIndex] || 0) + anchorWithin;
                var targetScrollTop = containerTop + correctedOffset;
                var delta = targetScrollTop - currentScrollTop;
                if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
                this.scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
                // \u4FDD\u7559\u5F53\u524D\u7A97\u53E3\u548C\u5DF2\u52A0\u8F7D\u5A92\u4F53\u8282\u70B9\u3002\u65E7\u5B9E\u73B0\u4F1A\u5728\u6BCF\u6B21\u9AD8\u5EA6\u53D8\u5316\u540E\u5F3A\u5236
                // \u5B8C\u6574\u91CD\u5EFA\uFF0C\u6B63\u662F\u4F4E\u9891\u4F46\u5927\u5E45\u95EA\u52A8\u7684\u4E3B\u8981\u6765\u6E90\u3002
                this.update();
            }

            updateItems(items) {
                if (this.resizeObserver) this.resizeObserver.disconnect();
                this.explicitResizeItems.clear();
                this.content.innerHTML = '';
                this.setItems(items);
                this.scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                this.startIndex = -1;
                this.endIndex = -1;
                if (this.allItems.length === 0) {
                    this.startIndex = 0;
                    this.endIndex = 0;
                    return;
                }
                this.update();
            }

            destroy() {
                window.removeEventListener('scroll', this.handleScroll);
                if (this.resizeObserver) this.resizeObserver.disconnect();
                if (this.content) {
                    this.content.removeEventListener('toggle', this.handleDetailsToggle, true);
                }
                this.explicitResizeItems.clear();
                this.container.classList.remove('virtual-scroll-container');
            }
            scrollToIndex(index) {
                if (typeof index !== 'number' || index < 0) return;
                // \u5148\u628A\u76EE\u6807\u6240\u5728\u533A\u95F4\u540C\u6B65\u6E32\u67D3\u51FA\u6765\uFF0C\u5426\u5219 reply \u8DF3\u8F6C\u65F6\u76EE\u6807\u6D88\u606F
                // \u5F88\u53EF\u80FD\u8FD8\u4E0D\u5728 DOM \u4E2D\uFF0Cdocument.getElementById \u4F1A\u76F4\u63A5\u5931\u8D25\u3002
                this.startIndex = Math.max(0, index - this.options.bufferSize);
                this.endIndex = Math.min(this.allItems.length, index + this.options.bufferSize + 1);
                this.render();
                var containerTop = this.getContainerTop();
                var targetOffset = containerTop + (this.itemOffsets[index] || 0);
                window.scrollTo({
                    top: targetOffset,
                    behavior: 'auto'
                });
            }
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            var modal = document.getElementById('imageModal');
            if (modal) modal.addEventListener('click', hideImageModal);
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') hideImageModal();
            });
            
            // \u56DE\u590D\u6D88\u606F\u8DF3\u8F6C\u529F\u80FD
            window.scrollToMessage = function(msgId) {
                function containsTarget(block) {
                    return !!block && (block.id === msgId || (block.querySelectorAll &&
                        Array.from(block.querySelectorAll('[id]')).some(function(node) { return node.id === msgId; })));
                }
                var targetMsg = document.getElementById(msgId);
                if (!targetMsg && virtualScroller && Array.isArray(virtualScroller.allItems)) {
                    var targetIndex = virtualScroller.allItems.findIndex(function(block) {
                        return containsTarget(block);
                    });
                    if (targetIndex >= 0) {
                        virtualScroller.scrollToIndex(targetIndex);
                        targetMsg = document.getElementById(msgId);
                    }
                }
                // \u5F53\u524D\u641C\u7D22 / \u53D1\u9001\u8005 / \u65E5\u671F\u7B5B\u9009\u53EF\u80FD\u628A\u6E90\u6D88\u606F\u6392\u9664\u5728 DOM \u4E4B\u5916\u3002
                // \u82E5\u5B8C\u6574\u6D88\u606F\u96C6\u5408\u91CC\u786E\u5B9E\u5B58\u5728\u76EE\u6807\uFF0C\u6E05\u9664\u7B5B\u9009\u540E\u91CD\u8BD5\u4E00\u6B21\uFF0C\u4FDD\u8BC1\u5F15\u7528
                // \u70B9\u51FB\u7684\u8BED\u4E49\u59CB\u7EC8\u662F\u201C\u663E\u793A\u5E76\u5B9A\u4F4D\u6E90\u6D88\u606F\u201D\u3002
                if (!targetMsg && Array.isArray(originalMessages)) {
                    var sourceExists = originalMessages.some(function(block) {
                        return containsTarget(block);
                    });
                    var hadActiveFilters = (searchInput && searchInput.value)
                        || currentFilter !== 'all'
                        || (startDateInput && startDateInput.value)
                        || (endDateInput && endDateInput.value);
                    if (sourceExists && hadActiveFilters && typeof filterMessages === 'function') {
                        if (searchInput) searchInput.value = '';
                        currentFilter = 'all';
                        currentFilterUid = null;
                        if (startDateInput) startDateInput.value = '';
                        if (endDateInput) endDateInput.value = '';
                        if (filterOptionsList) {
                            filterOptionsList.querySelectorAll('.filter-option').forEach(function(option) {
                                option.classList.toggle('active', option.getAttribute('data-value') === 'all');
                            });
                        }
                        filterMessages();
                        setTimeout(function() { window.scrollToMessage(msgId); }, 100);
                        return;
                    }
                }
                if (targetMsg) {
                    var parent = targetMsg.parentElement;
                    while (parent) {
                        if (parent.tagName === 'DETAILS') parent.open = true;
                        parent = parent.parentElement;
                    }
                    // \u5E73\u6ED1\u6EDA\u52A8\u5230\u76EE\u6807\u6D88\u606F
                    targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    // \u9AD8\u4EAE\u52A8\u753B
                    targetMsg.style.transition = 'background 0.3s';
                    var originalBg = window.getComputedStyle(targetMsg).backgroundColor;
                    targetMsg.style.background = 'rgba(0, 122, 255, 0.1)';
                    
                    setTimeout(function() {
                        targetMsg.style.background = originalBg;
                        setTimeout(function() {
                            targetMsg.style.transition = '';
                        }, 300);
                    }, 1000);
                } else {
                    console.warn('[Reply Jump] \u672A\u627E\u5230\u76EE\u6807\u6D88\u606F:', msgId);
                }
            };
            // ========== \u65F6\u95F4\u8303\u56F4\u9009\u62E9 ==========
            var timeRangeBtn = document.getElementById('timeRangeBtn');
            var timeRangeDropdown = document.getElementById('timeRangeDropdown');
            var timeRangeLabel = document.getElementById('timeRangeLabel');
            var startDateInput = document.getElementById('startDate');
            var endDateInput = document.getElementById('endDate');
            var applyTimeRangeBtn = document.getElementById('applyTimeRange');
            var clearTimeRangeBtn = document.getElementById('clearTimeRange');
            var minDateKey = null;
            var maxDateKey = null;
            
            function clampDateValue(value) {
                if (!value) return '';
                var normalized = value.slice(0, 10);
                if (minDateKey && normalized < minDateKey) return minDateKey;
                if (maxDateKey && normalized > maxDateKey) return maxDateKey;
                return normalized;
            }
            
            function applyDateRangeLimits() {
                if (!startDateInput || !endDateInput) return;
                startDateInput.min = minDateKey || '';
                endDateInput.min = minDateKey || '';
                startDateInput.max = maxDateKey || '';
                endDateInput.max = maxDateKey || '';
            }
            
            function enforceInputRange() {
                if (startDateInput) {
                    startDateInput.value = clampDateValue(startDateInput.value);
                }
                if (endDateInput) {
                    endDateInput.value = clampDateValue(endDateInput.value);
                }
                if (startDateInput && endDateInput && startDateInput.value && endDateInput.value && startDateInput.value > endDateInput.value) {
                    endDateInput.value = startDateInput.value;
                }
            }
            
            // \u4ECElocalStorage\u6062\u590D\u65F6\u95F4\u8303\u56F4
            var savedTimeRange = localStorage.getItem('timeRange');
            if (savedTimeRange) {
                try {
                    var timeRange = JSON.parse(savedTimeRange);
                    startDateInput.value = timeRange.start || '';
                    endDateInput.value = timeRange.end || '';
                    updateTimeRangeLabel();
                } catch (e) {
                    // \u5FFD\u7565\u89E3\u6790\u9519\u8BEF
                }
            }
            
            function updateTimeRangeLabel() {
                var start = startDateInput.value;
                var end = endDateInput.value;
                if (start || end) {
                    timeRangeLabel.textContent = (start || '\u5F00\u59CB') + ' ~ ' + (end || '\u7ED3\u675F');
                } else {
                    timeRangeLabel.textContent = '\u5168\u90E8\u65F6\u95F4';
                }
            }
            
            if (startDateInput) {
                startDateInput.addEventListener('change', function() {
                    enforceInputRange();
                    updateTimeRangeLabel();
                });
            }
            
            if (endDateInput) {
                endDateInput.addEventListener('change', function() {
                    enforceInputRange();
                    updateTimeRangeLabel();
                });
            }
            
            // \u5207\u6362\u4E0B\u62C9\u83DC\u5355
            timeRangeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                timeRangeDropdown.classList.toggle('active');
            });
            
            // \u5E94\u7528\u65F6\u95F4\u8303\u56F4
            applyTimeRangeBtn.addEventListener('click', function() {
                enforceInputRange();
                var start = startDateInput.value;
                var end = endDateInput.value;
                
                // \u4FDD\u5B58\u5230localStorage
                localStorage.setItem('timeRange', JSON.stringify({
                    start: start,
                    end: end
                }));
                
                updateTimeRangeLabel();
                timeRangeDropdown.classList.remove('active');
                
                // \u5E94\u7528\u8FC7\u6EE4\u903B\u8F91
                filterMessages();
            });
            
            // \u6E05\u9664\u65F6\u95F4\u8303\u56F4
            clearTimeRangeBtn.addEventListener('click', function() {
                startDateInput.value = '';
                endDateInput.value = '';
                localStorage.removeItem('timeRange');
                updateTimeRangeLabel();
                timeRangeDropdown.classList.remove('active');
                
                // \u91CD\u65B0\u8FC7\u6EE4\u6D88\u606F\uFF08\u663E\u793A\u6240\u6709\u6D88\u606F\uFF09
                filterMessages();
            });
            
            // \u70B9\u51FB\u5916\u90E8\u5173\u95ED\u4E0B\u62C9\u83DC\u5355
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.time-range-container')) {
                    timeRangeDropdown.classList.remove('active');
                }
            });
            
            // \u6536\u96C6\u6240\u6709\u6D88\u606FDOM
            var messages = Array.from(document.querySelectorAll('.message'));
            var messageBlocks = Array.from(document.querySelectorAll('.message-block'));
            var dateKeySet = new Set();
            messageBlocks.forEach(function(block) {
                var dateValue = block.getAttribute('data-date');
                if (dateValue) {
                    dateKeySet.add(dateValue);
                }
            });
            var dateKeys = Array.from(dateKeySet).sort();
            minDateKey = dateKeys.length > 0 ? dateKeys[0] : null;
            maxDateKey = dateKeys.length > 0 ? dateKeys[dateKeys.length - 1] : null;
            applyDateRangeLimits();
            enforceInputRange();
            updateTimeRangeLabel();
            var total = messageBlocks.length;
            document.getElementById('info-total').textContent = total;
            
            if (messages.length > 0) {
                var firstTime = messageBlocks[0].querySelector('.time')?.textContent || '';
                var lastTime = messageBlocks[messageBlocks.length - 1].querySelector('.time')?.textContent || '';
                document.getElementById('info-range').textContent = firstTime + ' ~ ' + lastTime;
            }
            // \u521D\u59CB\u5316\u865A\u62DF\u6EDA\u52A8\uFF08\u6D88\u606F\u8D85\u8FC7100\u6761\u65F6\u542F\u7528\uFF09
            // issue #467\uFF1A\u5BFC\u51FA\u65F6\u53EF\u901A\u8FC7 window.__QCE_ENABLE_VIRTUAL_SCROLL=false \u5173\u95ED\uFF0C
            // \u8BA9\u6240\u6709\u6D88\u606F\u7559\u5728 DOM \u4E2D\uFF0C\u4FBF\u4E8E\u6253\u5370 / \u5BFC\u51FA PDF\uFF08\u9ED8\u8BA4\u4ECD\u542F\u7528\uFF09\u3002
            var virtualScroller = null;
            var configuredVirtualThreshold = Number(window.__QCE_VIRTUAL_SCROLL_THRESHOLD);
            var virtualScrollThreshold = Number.isFinite(configuredVirtualThreshold)
                && configuredVirtualThreshold >= 100
                ? configuredVirtualThreshold
                : 1200;
            if (window.__QCE_ENABLE_VIRTUAL_SCROLL !== false && messageBlocks.length > virtualScrollThreshold) {
                var chatContent = document.querySelector('.chat-content');
                // \u9875\u9762\u521D\u6B21\u52A0\u8F7D\u65F6\u6240\u6709\u6D88\u606F\u90FD\u8FD8\u5728 DOM\uFF0C\u5148\u8BB0\u5F55\u771F\u5B9E\u5916\u90E8\u9AD8\u5EA6\u4F5C\u4E3A\u52A8\u6001
                // \u865A\u62DF\u5217\u8868\u7684\u521D\u503C\u3002\u56FE\u7247\u540E\u7EED\u52A0\u8F7D\u9020\u6210\u7684\u53D8\u5316\u7531 ResizeObserver \u7EE7\u7EED\u4FEE\u6B63\u3002
                var originalBlocks = messageBlocks.map(function(block) {
                    var rect = block.getBoundingClientRect();
                    var style = window.getComputedStyle(block);
                    var measuredHeight = rect.height
                        + (parseFloat(style.marginTop) || 0)
                        + (parseFloat(style.marginBottom) || 0);
                    if (Number.isFinite(measuredHeight) && measuredHeight > 0) {
                        block.setAttribute('data-qce-virtual-height', String(measuredHeight));
                    }
                    // \u76F4\u63A5\u590D\u7528\u521D\u59CB DOM\u3002cloneNode \u4F1A\u4E22\u6389\u56FE\u7247\u5DF2\u7ECF\u52A0\u8F7D/\u89E3\u7801\u7684\u72B6\u6001\uFF0C
                    // \u540E\u7EED\u6362\u7A97\u65F6\u91CD\u65B0\u4EA7\u751F\u4E00\u6B21 0px -> \u5B9E\u9645\u9AD8\u5EA6\u7684\u5E03\u5C40\u53D8\u5316\u3002
                    return block;
                });
                chatContent.innerHTML = '';
                virtualScroller = new VirtualScroller(chatContent, originalBlocks, {
                    itemHeight: 120,
                    bufferSize: 30
                });
                console.log('\u542F\u7528\u865A\u62DF\u6EDA\u52A8\uFF0C\u5171', messageBlocks.length, '\u6761\u6D88\u606F');
            }
            // ========== \u521D\u59CB\u5316 Lucide \u56FE\u6807 ==========
            lucide.createIcons({
                attrs: {
                    'stroke-width': 2
                }
            });
            
            // ========== \u4E3B\u9898\u5207\u6362 ==========
            var themeToggle = document.getElementById('themeToggle');
            var themeIconElement = document.getElementById('themeIcon');
            var currentTheme = localStorage.getItem('theme') || 'light';
            
            function setTheme(theme) {
                if (theme === 'dark') {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    themeIconElement.setAttribute('data-lucide', 'moon');
                    localStorage.setItem('theme', 'dark');
                } else {
                    document.documentElement.removeAttribute('data-theme');
                    themeIconElement.setAttribute('data-lucide', 'sun');
                    localStorage.setItem('theme', 'light');
                }
                lucide.createIcons({
                    attrs: {
                        'stroke-width': 2
                    }
                });
            }
            
            setTheme(currentTheme);
            
            themeToggle.addEventListener('click', function() {
                currentTheme = localStorage.getItem('theme') || 'light';
                setTheme(currentTheme === 'dark' ? 'light' : 'dark');
            });
            
            // ========== \u53D1\u9001\u8005\u7B5B\u9009 ==========
            var filterBtn = document.getElementById('filterBtn');
            var filterDropdown = document.getElementById('filterDropdown');
            var filterOptionsList = document.getElementById('filterOptionsList');
            var filterSearchInput = document.getElementById('filterSearchInput');
            var filterNoResult = document.getElementById('filterNoResult');
            var currentFilter = 'all';
            var currentFilterUid = null;
            
            // \u4F7F\u7528 Map \u6309 UID \u6574\u5408\u53D1\u9001\u8005\uFF08\u540C\u4E00\u7528\u6237\u53EF\u80FD\u6709\u4E0D\u540C\u7FA4\u540D\u7247\uFF09
            // key: uid, value: { names: Set<string>, displayName: string }
            var sendersByUid = new Map();
            var senderNameToUid = new Map(); // \u7528\u4E8E\u53CD\u5411\u67E5\u627E
            
            // \u6536\u96C6\u6240\u6709\u53D1\u9001\u8005\uFF0C\u6309 UID \u6574\u5408
            // \u4F7F\u7528 messageBlocks \u800C\u4E0D\u662F messages\uFF0C\u56E0\u4E3A filterMessages \u4F7F\u7528\u7684\u662F originalMessages\uFF08\u4ECE messageBlocks \u514B\u9686\uFF09
            messageBlocks.forEach(function(block) {
                var messageEl = block.querySelector('.message');
                var sender = block.querySelector('.sender');
                var uid = messageEl ? (messageEl.getAttribute('data-sender-uid') || messageEl.getAttribute('data-uid')) : null;
                if (sender) {
                    var senderName = sender.textContent;
                    if (uid) {
                        // \u6709 UID\uFF0C\u6309 UID \u6574\u5408
                        if (!sendersByUid.has(uid)) {
                            sendersByUid.set(uid, { names: new Set(), displayName: senderName });
                        }
                        sendersByUid.get(uid).names.add(senderName);
                        senderNameToUid.set(senderName, uid);
                    } else {
                        // \u65E0 UID\uFF0C\u6309\u540D\u79F0\u4F5C\u4E3A\u552F\u4E00\u6807\u8BC6
                        if (!sendersByUid.has(senderName)) {
                            sendersByUid.set(senderName, { names: new Set([senderName]), displayName: senderName });
                        }
                        senderNameToUid.set(senderName, senderName);
                    }
                }
            });
            
            // \u751F\u6210\u7B5B\u9009\u9009\u9879
            sendersByUid.forEach(function(info, uid) {
                var option = document.createElement('div');
                option.className = 'filter-option';
                option.setAttribute('data-value', uid);
                // \u5982\u679C\u540C\u4E00\u7528\u6237\u6709\u591A\u4E2A\u540D\u7247\uFF0C\u663E\u793A\u6240\u6709\u540D\u7247
                var names = Array.from(info.names);
                if (names.length > 1) {
                    option.textContent = names[0] + ' (' + (names.length - 1) + '\u4E2A\u522B\u540D)';
                    option.setAttribute('title', names.join(', '));
                } else {
                    option.textContent = info.displayName;
                }
                // \u5B58\u50A8\u6240\u6709\u540D\u79F0\u7528\u4E8E\u641C\u7D22
                option.setAttribute('data-names', names.join('|').toLowerCase());
                filterOptionsList.appendChild(option);
            });
            
            // \u7B5B\u9009\u641C\u7D22\u529F\u80FD
            filterSearchInput.addEventListener('input', function(e) {
                var keyword = e.target.value.toLowerCase().trim();
                var options = filterOptionsList.querySelectorAll('.filter-option');
                var hasVisible = false;
                
                options.forEach(function(opt) {
                    var value = opt.getAttribute('data-value');
                    var names = opt.getAttribute('data-names') || opt.textContent.toLowerCase();
                    
                    if (value === 'all' || names.includes(keyword) || opt.textContent.toLowerCase().includes(keyword)) {
                        opt.classList.remove('hidden');
                        hasVisible = true;
                    } else {
                        opt.classList.add('hidden');
                    }
                });
                
                // \u663E\u793A/\u9690\u85CF\u65E0\u7ED3\u679C\u63D0\u793A
                if (hasVisible) {
                    filterNoResult.classList.remove('visible');
                } else {
                    filterNoResult.classList.add('visible');
                }
            });
            
            // \u5207\u6362\u4E0B\u62C9\u83DC\u5355
            filterBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                filterDropdown.classList.toggle('active');
                if (filterDropdown.classList.contains('active')) {
                    // \u6253\u5F00\u65F6\u805A\u7126\u641C\u7D22\u6846
                    setTimeout(function() {
                        filterSearchInput.focus();
                    }, 100);
                }
            });
            
            // \u9009\u62E9\u9009\u9879
            filterOptionsList.addEventListener('click', function(e) {
                if (e.target.classList.contains('filter-option')) {
                    // \u79FB\u9664\u6240\u6709active
                    filterOptionsList.querySelectorAll('.filter-option').forEach(function(opt) {
                        opt.classList.remove('active');
                    });
                    // \u6DFB\u52A0\u5F53\u524Dactive
                    e.target.classList.add('active');
                    var selectedValue = e.target.getAttribute('data-value');
                    if (selectedValue === 'all') {
                        currentFilter = 'all';
                        currentFilterUid = null;
                    } else {
                        currentFilter = selectedValue;
                        currentFilterUid = selectedValue;
                    }
                    filterDropdown.classList.remove('active');
                    // \u6E05\u7A7A\u641C\u7D22
                    filterSearchInput.value = '';
                    filterOptionsList.querySelectorAll('.filter-option').forEach(function(opt) {
                        opt.classList.remove('hidden');
                    });
                    filterNoResult.classList.remove('visible');
                    filterMessages();
                }
            });
            
            // \u70B9\u51FB\u5916\u90E8\u5173\u95ED
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.filter-container')) {
                    filterDropdown.classList.remove('active');
                }
            });
            
            // ========== \u641C\u7D22\u6846\u5C55\u5F00/\u6536\u8D77 ==========
            var searchBtn = document.getElementById('searchBtn');
            var searchWrapper = document.getElementById('searchWrapper');
            var searchInput = document.getElementById('searchInput');
            var searchActive = false;
            
            searchBtn.addEventListener('click', function() {
                searchActive = !searchActive;
                if (searchActive) {
                    searchWrapper.classList.add('active');
                    searchInput.focus();
                } else {
                    searchWrapper.classList.remove('active');
                    searchInput.value = '';
                    filterMessages();
                }
            });
            
            // \u70B9\u51FB\u5916\u90E8\u5173\u95ED\u641C\u7D22\u6846
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.search-container') && searchActive) {
                    searchActive = false;
                    searchWrapper.classList.remove('active');
                    if (!searchInput.value) {
                        searchInput.value = '';
                        filterMessages();
                    }
                }
            });
            
            // ========== \u9632\u6296\u51FD\u6570 ==========
            function debounce(func, wait) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, args), wait);
                };
            }
            
            // ========== \u641C\u7D22\u529F\u80FD + \u9AD8\u4EAE ==========
            var clearSearch = document.getElementById('clearSearch');
            var originalContents = new Map();
            var originalMessages = messageBlocks.map(block => block.cloneNode(true));
            
            // \u4FDD\u5B58\u539F\u59CB\u5185\u5BB9
            originalMessages.forEach(function(msg) {
                var content = msg.querySelector('.content');
                if (content) {
                    originalContents.set(msg, content.innerHTML);
                }
            });
            
            function escapeRegExp(string) {
                return string.replace(/[.*+?^$\\{\\}()|\\[\\]\\\\]/g, '\\\\$&');
            }
            
            function highlightText(text, searchTerm) {
                var escapedTerm = escapeRegExp(searchTerm);
                var regex = new RegExp('(' + escapedTerm + ')', 'gi');
                return String(text).split(regex).map(function(part, index) {
                    var safe = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return index % 2 ? '<mark class="highlight">' + safe + '</mark>' : safe;
                }).join('');
            }
            
            function filterMessages() {
                var searchTerm = searchInput.value.trim();
                var selectedSender = currentFilter;
                var selectedUid = currentFilterUid;
                var startDate = startDateInput ? startDateInput.value : '';
                var endDate = endDateInput ? endDateInput.value : '';
                var filteredMessages = [];
                var visibleCount = 0;
                
                // \u4F7F\u7528DocumentFragment\u4F18\u5316DOM\u64CD\u4F5C
                originalMessages.forEach(function(msg) {
                    // msg \u662F .message-block\uFF0C\u9700\u8981\u627E\u5230\u5185\u90E8\u7684 .message \u5143\u7D20
                    var messageEl = msg.querySelector('.message');
                    var sender = msg.querySelector('.sender');
                    var senderName = sender ? sender.textContent : '';
                    // \u4ECE .message \u5143\u7D20\u83B7\u53D6 data-sender-uid
                    var msgUid = messageEl ? (messageEl.getAttribute('data-sender-uid') || messageEl.getAttribute('data-uid')) : null;
                    var content = msg.querySelector('.content');
                    var originalContent = originalContents.get(msg);
                    
                    if (!content || !originalContent) return;
                    
                    // \u514B\u9686\u6D88\u606F\u7528\u4E8E\u8FC7\u6EE4
                    var msgClone = msg.cloneNode(true);
                    var contentClone = msgClone.querySelector('.content');
                    
                    // \u6062\u590D\u539F\u59CB\u5185\u5BB9
                    contentClone.innerHTML = originalContent;
                    
                    var contentText = contentClone.textContent.toLowerCase();
                    var searchLower = searchTerm.toLowerCase();
                    
                    // \u83B7\u53D6\u6D88\u606F\u65E5\u671F\u8FDB\u884C\u65F6\u95F4\u8303\u56F4\u7B5B\u9009
                    var messageDate = msgClone.getAttribute('data-date');
                    var matchTimeRange = true;
                    if (startDate || endDate) {
                        if (messageDate) {
                            if (startDate && messageDate < startDate) {
                                matchTimeRange = false;
                            }
                            if (endDate && messageDate > endDate) {
                                matchTimeRange = false;
                            }
                        }
                    }
                    
                    var matchSearch = searchTerm === '' || contentText.includes(searchLower) || senderName.toLowerCase().includes(searchLower);
                    
                    // \u53D1\u9001\u8005\u7B5B\u9009\uFF1A\u4F18\u5148\u4F7F\u7528 UID \u5339\u914D\uFF0C\u652F\u6301\u540C\u4E00\u7528\u6237\u4E0D\u540C\u7FA4\u540D\u7247
                    var matchSender = false;
                    if (selectedSender === 'all') {
                        matchSender = true;
                    } else if (selectedUid && msgUid) {
                        // \u57FA\u4E8E UID \u5339\u914D\uFF08\u6574\u5408\u540C\u4E00\u7528\u6237\u4E0D\u540C\u7FA4\u540D\u7247\uFF09
                        matchSender = msgUid === selectedUid;
                    } else {
                        // \u56DE\u9000\u5230\u540D\u79F0\u5339\u914D\uFF08\u517C\u5BB9\u65E0 UID \u7684\u60C5\u51B5\uFF09
                        matchSender = senderName === selectedSender;
                    }
                    
                    if (matchSearch && matchSender && matchTimeRange) {
                        visibleCount++;
                        
                        // \u9AD8\u4EAE\u5339\u914D\u6587\u672C
                        if (searchTerm && contentText.includes(searchLower)) {
                            var textContent = contentClone.querySelector('.text-content');
                            if (textContent) {
                                var originalText = textContent.textContent;
                                textContent.innerHTML = highlightText(originalText, searchTerm);
                            }
                        }
                        
                        filteredMessages.push(msgClone);
                    }
                });
                
                // \u66F4\u65B0\u865A\u62DF\u6EDA\u52A8\u5668
                if (virtualScroller) {
                    virtualScroller.updateItems(filteredMessages);
                    // \u5EF6\u8FDF\u6EDA\u52A8\u5230\u9876\u90E8\uFF0C\u786E\u4FDD\u865A\u62DF\u6EDA\u52A8\u5668\u5DF2\u66F4\u65B0
                    setTimeout(function() {
                        window.scrollTo({ top: 0, behavior: 'auto' });
                    }, 50);
                } else {
                    // \u975E\u865A\u62DF\u6EDA\u52A8\u6A21\u5F0F\uFF1A\u76F4\u63A5\u66F4\u65B0DOM
                    var chatContent = document.querySelector('.chat-content');
                    var fragment = document.createDocumentFragment();
                    filteredMessages.forEach(msg => fragment.appendChild(msg));
                    chatContent.innerHTML = '';
                    chatContent.appendChild(fragment);
                }
                
                // \u663E\u793A/\u9690\u85CF\u6E05\u9664\u6309\u94AE
                clearSearch.style.display = searchTerm ? 'block' : 'none';
                
                // \u66F4\u65B0\u7EDF\u8BA1
                document.getElementById('info-total').textContent = visibleCount + ' / ' + total;
                
                // \u66F4\u65B0\u56FE\u6807
                lucide.createIcons({
                    attrs: {
                        'stroke-width': 2
                    }
                });
            }
            
            // \u4F7F\u7528\u9632\u6296\u4F18\u5316\u641C\u7D22
            var debouncedFilter = debounce(filterMessages, 300);
            searchInput.addEventListener('input', debouncedFilter);
            
            clearSearch.addEventListener('click', function() {
                searchInput.value = '';
                filterMessages();
                searchInput.focus();
            });
            
            // \u9875\u9762\u52A0\u8F7D\u5B8C\u6210\u540E\u5E94\u7528\u5DF2\u4FDD\u5B58\u7684\u8FC7\u6EE4\u6761\u4EF6\uFF08\u5305\u62EC\u65F6\u95F4\u8303\u56F4\uFF09
            setTimeout(function() {
                filterMessages();
            }, 100);
        });
`;
var MODERN_SINGLE_SCRIPTS_HTML = `<script src="https://unpkg.com/lucide@latest"></script>
    <script>
${MODERN_SINGLE_APP_JS}
    </script>`;
var MODERN_SINGLE_HTML_TOP_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<!-- QCE_METADATA: {{METADATA_JSON}} -->
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>\u804A\u5929\u8BB0\u5F55 - {{CHAT_NAME_ESC}}</title>
{{STYLES}}
{{SCRIPTS}}
</head>
<body>
    <!-- Toolbar -->
    {{TOOLBAR}}
    <div class="chat-layout">
        <div class="chat-main">
            <!-- Hero Section -->
{{HEADER}}
            <!-- Chat Messages -->
            <div class="chat-content">
`;
var MODERN_SINGLE_HTML_BOTTOM_TEMPLATE = `            </div>
{{FOOTER}}
        </div>
    </div>

    <!-- Image Modal -->
    <div class="image-modal" id="imageModal">
        <img src="" alt="" id="modalImage">
</div>

<!-- \u7EDF\u8BA1\u5360\u4F4D\u56DE\u586B -->
<script>
(function(){
  try {
    var totalEl = document.getElementById('info-total');
    if (totalEl) totalEl.textContent = {{TOTAL_MESSAGES}};
    var rangeEl = document.getElementById('info-range');
    if (rangeEl) rangeEl.textContent = {{TIME_RANGE_JS}};
  } catch (e) { /* noop */ }
})();
</script>

</body>

</html>`;
var MODERN_CHUNKED_INDEX_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<!-- QCE_METADATA: {{METADATA_JSON}} -->
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>\u804A\u5929\u8BB0\u5F55 - {{CHAT_NAME_ESC}}</title>
<link rel="stylesheet" href="assets/style.css">
<script src="https://unpkg.com/lucide@latest"></script>
<script src="assets/app.js" defer></script>
<script src="data/manifest.js" defer></script>
</head>
<body>
    <!-- Toolbar -->
    {{TOOLBAR}}
    <div class="chat-layout">
        <div class="chat-main">
            <!-- Hero Section -->
{{HEADER}}
            <!-- Chat Messages -->
            <div class="chat-content" id="chatContent"></div>
{{FOOTER}}
        </div>
    </div>

    <!-- Image Modal -->
    <div class="image-modal" id="imageModal">
        <img src="" alt="" id="modalImage">
    </div>
</body>
</html>`;
var MODERN_CHUNKED_APP_JS = `/*!
 * QQ Chat Exporter Pro - Modern Chunked Viewer
 * - Streaming + Chunking + Indexing + Windowed rendering (no-OOM)
 * - \u4FDD\u6301\u539F UI\uFF08toolbar/\u4E3B\u9898/\u65F6\u95F4\u8303\u56F4/\u6210\u5458\u7B5B\u9009/\u641C\u7D22\uFF09\u4E00\u81F4
 *
 * \u6570\u636E\u534F\u8BAE\uFF08\u7531\u5BFC\u51FA\u5668\u751F\u6210\uFF09\uFF1A
 * - data/manifest.js: window.__QCE_MANIFEST__(manifest)
 * - data/chunks/c000001.js: window.__QCE_CHUNK__(chunk)
 * - data/index/msgid_bXX.js: window.__QCE_MSGID_INDEX__(bucket, pairs)
 */
(function () {
  'use strict';

  var manifest = null;
  var domReady = false;
  var initialized = false;

  // caches
  var chunkCache = new Map(); // chunkId -> chunkData
  var pendingChunk = new Map(); // chunkId -> { promise, resolve, reject }

  var msgIdToChunkId = new Map(); // domMsgId -> chunkId
  var loadedMsgIndexBuckets = new Set();
  var pendingMsgIndexBuckets = new Map(); // bucket -> { promise, resolve, reject }

  // active chunk list after applying chunk-level filters
  var activeChunks = [];
  var activePosByChunkId = new Map(); // chunkId -> activePos

  // rendered window state
  var rendered = []; // { pos:number, chunkId:string, el:HTMLElement|null, visibleCount:number }
  var loadedStartPos = 0;
  var loadedEndPos = -1;

  var isLoadingNext = false;
  var isLoadingPrev = false;

  // filter state
  var filterState = {
    searchTerm: '',
    searchLower: '',
    senderUid: null, // string | null
    startDate: '',
    endDate: ''
  };

  // UI refs
  var ui = {
    chatContent: null,
    topSentinel: null,
    bottomSentinel: null,

    infoTotal: null,
    infoRange: null,

    // search
    searchBtn: null,
    searchWrapper: null,
    searchInput: null,
    clearSearch: null,
    searchActive: false,

    // filter
    filterBtn: null,
    filterDropdown: null,
    filterOptionsList: null,
    filterSearchInput: null,
    filterNoResult: null,
    currentFilterUid: null,

    // time range
    timeRangeBtn: null,
    timeRangeDropdown: null,
    timeRangeLabel: null,
    startDateInput: null,
    endDateInput: null,
    applyTimeRangeBtn: null,
    clearTimeRangeBtn: null,
    minDateKey: null,
    maxDateKey: null,

    // theme
    themeToggle: null,
    themeIcon: null
  };

  function log() {
    try { console.log.apply(console, ['[QCE-Chunked]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, ['[QCE-Chunked]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ---------- JSONP callbacks ----------
  window.__QCE_MANIFEST__ = function (m) {
    manifest = m;
    tryInit();
  };

  window.__QCE_CHUNK__ = function (chunk) {
    chunkCache.set(chunk.id, chunk);
    var p = pendingChunk.get(chunk.id);
    if (p) {
      p.resolve(chunk);
      pendingChunk.delete(chunk.id);
    }
  };

  window.__QCE_MSGID_INDEX__ = function (bucket, pairs) {
    try {
      if (Array.isArray(pairs)) {
        for (var i = 0; i < pairs.length; i++) {
          var pair = pairs[i];
          if (pair && pair.length >= 2) {
            msgIdToChunkId.set(pair[0], pair[1]);
          }
        }
      }
    } finally {
      loadedMsgIndexBuckets.add(bucket);
      var p = pendingMsgIndexBuckets.get(bucket);
      if (p) {
        p.resolve();
        pendingMsgIndexBuckets.delete(bucket);
      }
    }
  };

  // ---------- image modal (\u4FDD\u6301\u539F\u51FD\u6570\u540D) ----------
  window.showImageModal = function (imgSrc) {
    var modal = document.getElementById('imageModal');
    var modalImg = document.getElementById('modalImage');
    if (!modal || !modalImg) return;
    modal.style.display = 'block';
    modalImg.src = imgSrc;
  };
  window.hideImageModal = function () {
    var modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
  };

  // ---------- DOM ready ----------
  document.addEventListener('DOMContentLoaded', function () {
    domReady = true;
    tryInit();
  });

  function tryInit() {
    if (initialized) return;
    if (!domReady || !manifest) return;
    initialized = true;
    init();
  }

  // ---------- helpers ----------
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^$\\{\\}()|\\[\\]\\\\]/g, '\\\\$&');
  }

  function highlightIn(root, searchTerm) {
    if (!root || !searchTerm) return;
    var escaped = escapeRegExp(searchTerm);
    if (!escaped) return;
    var regex = new RegExp('(' + escaped + ')', 'gi');
    var nodes = root.querySelectorAll('.text-content');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = el.textContent || '';
      if (!text) continue;
      // \u53EA\u5BF9\u7EAF\u6587\u672C span \u505A\u9AD8\u4EAE\uFF1A\u4FDD\u6301\u4E0E\u539F\u903B\u8F91\u4E00\u81F4
      el.innerHTML = text.replace(regex, '<mark class="highlight">$1</mark>');
    }
  }

  function setLucideIcons() {
    if (typeof lucide === 'undefined') return;
    lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }

  // ---------- Bloom filter (chunk-level indexing) ----------
  function base64ToBytes(b64) {
    if (!b64) return null;
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      return bytes;
    } catch (e) {
      return null;
    }
  }

  function fnv1a32(str, seed) {
    var h = (seed >>> 0) || 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0);
  }

  function bloomMightContain(bytes, bits, hashes, token) {
    if (!bytes || !bits || !hashes) return true;
    var h1 = fnv1a32(token, 0x811c9dc5);
    var h2 = fnv1a32(token, 0x811c9dc5 ^ 0x5bd1e995);
    for (var i = 0; i < hashes; i++) {
      var idx = (h1 + (i * h2)) % bits;
      var byteIndex = idx >>> 3;
      var mask = 1 << (idx & 7);
      if ((bytes[byteIndex] & mask) === 0) return false;
    }
    return true;
  }

  function getNgramSizeForTerm(termLower) {
    if (!termLower) return 0;
    if (termLower.length >= 3) return 3;
    if (termLower.length >= 2) return 2;
    return 0;
  }

  function ngramsOf(termLower, n) {
    var out = [];
    if (!termLower || termLower.length < n) return out;
    for (var i = 0; i <= termLower.length - n; i++) {
      out.push(termLower.slice(i, i + n));
    }
    return out;
  }

  function ensureChunkBloomDecoded(meta) {
    if (!meta) return meta;
    if (meta.textBloom && !meta._textBloomBytes) meta._textBloomBytes = base64ToBytes(meta.textBloom);
    if (meta.senderBloom && !meta._senderBloomBytes) meta._senderBloomBytes = base64ToBytes(meta.senderBloom);
    return meta;
  }

  function chunkPassesFilters(meta) {
    if (!meta) return false;

    // date range (chunk-level intersection)
    if (filterState.startDate && meta.endDate && meta.endDate < filterState.startDate) return false;
    if (filterState.endDate && meta.startDate && meta.startDate > filterState.endDate) return false;

    // sender (chunk-level bloom)
    if (filterState.senderUid && meta.senderBloom) {
      ensureChunkBloomDecoded(meta);
      var bcfg = manifest && manifest.bloom ? manifest.bloom : null;
      var bits = bcfg ? bcfg.senderBits : 0;
      var hashes = bcfg ? bcfg.senderHashes : 0;
      if (!bloomMightContain(meta._senderBloomBytes, bits, hashes, filterState.senderUid)) return false;
    }

    // search (chunk-level bloom)
    if (filterState.searchLower) {
      var n = getNgramSizeForTerm(filterState.searchLower);
      if (n > 0) {
        // \u5982\u679C\u5BFC\u51FA\u65F6\u6807\u8BB0\u8BE5 chunk bloom \u4E0D\u5B8C\u6574\uFF0C\u4E3A\u4E86\u4E0D\u6F0F\u7ED3\u679C\uFF0C\u8FD9\u91CC\u4E0D\u505A\u6392\u9664
        if (meta.textBloomIncomplete) return true;
        if (meta.textBloom) {
          ensureChunkBloomDecoded(meta);
          var bcfg2 = manifest && manifest.bloom ? manifest.bloom : null;
          var bits2 = bcfg2 ? bcfg2.textBits : 0;
          var hashes2 = bcfg2 ? bcfg2.textHashes : 0;
          var grams = ngramsOf(filterState.searchLower, n);
          for (var i = 0; i < grams.length; i++) {
            if (!bloomMightContain(meta._textBloomBytes, bits2, hashes2, grams[i])) return false;
          }
        }
      }
    }

    return true;
  }

  function messagePassesFilters(msg) {
    if (!msg) return false;

    // message-level date range
    if (filterState.startDate && msg.date && msg.date < filterState.startDate) return false;
    if (filterState.endDate && msg.date && msg.date > filterState.endDate) return false;

    // sender
    if (filterState.senderUid && msg.uid && msg.uid !== filterState.senderUid) return false;

    // search (exact contains)
    if (filterState.searchLower) {
      var term = filterState.searchLower;
      var hit = false;
      try {
        if (msg.text && String(msg.text).indexOf(term) >= 0) hit = true;
        else if (msg.nameLower && String(msg.nameLower).indexOf(term) >= 0) hit = true;
        else if (msg.textTruncated && msg.html) {
          // \u515C\u5E95\uFF1A\u5982\u679C text \u662F\u622A\u65AD\u7684\uFF0C\u907F\u514D\u6F0F\u7ED3\u679C\uFF0C\u7528 html \u505A\u5168\u6587 contains
          hit = (String(msg.html).toLowerCase().indexOf(term) >= 0);
        }
      } catch (e) {
        hit = false;
      }
      if (!hit) return false;
    }

    return true;
  }

  function computeTimeRangeText() {
    try {
      if (manifest && manifest.stats && manifest.stats.timeRangeText) return String(manifest.stats.timeRangeText);
      if (manifest && manifest.stats && manifest.stats.firstTime && manifest.stats.lastTime) {
        var a = new Date(manifest.stats.firstTime);
        var b = new Date(manifest.stats.lastTime);
        if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
          return a.toLocaleDateString('zh-CN') + ' \u81F3 ' + b.toLocaleDateString('zh-CN');
        }
      }
    } catch (e) {}
    return '--';
  }

  function updateHeaderStats(renderedVisibleCount) {
    // total scope estimation:
    var totalScope = null;
    if (!manifest || !manifest.stats) totalScope = null;
    else totalScope = manifest.stats.totalMessages;

    // sender-only exact total
    if (filterState.senderUid && manifest && Array.isArray(manifest.senders)) {
      for (var i = 0; i < manifest.senders.length; i++) {
        if (String(manifest.senders[i].uid) === String(filterState.senderUid)) {
          totalScope = manifest.senders[i].count;
          break;
        }
      }
    } else if (filterState.startDate || filterState.endDate || filterState.searchLower) {
      // fallback: sum chunk counts (upper bound / estimate)
      var s = 0;
      for (var j = 0; j < activeChunks.length; j++) {
        s += (activeChunks[j].count || 0);
      }
      totalScope = s;
    }

    if (ui.infoTotal) {
      if (totalScope != null) ui.infoTotal.textContent = String(renderedVisibleCount) + ' / ' + String(totalScope);
      else ui.infoTotal.textContent = String(renderedVisibleCount);
    }
  }

  function init() {
    ui.chatContent = document.getElementById('chatContent') || document.querySelector('.chat-content');
    if (!ui.chatContent) {
      warn('chatContent not found');
      return;
    }

    // create sentinels (always keep)
    ui.chatContent.innerHTML = '';
    ui.topSentinel = document.createElement('div');
    ui.topSentinel.id = 'qce-top-sentinel';
    ui.bottomSentinel = document.createElement('div');
    ui.bottomSentinel.id = 'qce-bottom-sentinel';
    ui.chatContent.appendChild(ui.topSentinel);
    ui.chatContent.appendChild(ui.bottomSentinel);

    ui.infoTotal = document.getElementById('info-total');
    ui.infoRange = document.getElementById('info-range');

    // modal close
    var modal = document.getElementById('imageModal');
    if (modal) modal.addEventListener('click', window.hideImageModal);
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') window.hideImageModal();
    });

    // icons
    setLucideIcons();

    // theme
    initThemeToggle();

    // time range
    initTimeRange();

    // sender filter
    initSenderFilter();

    // search
    initSearchUI();

    // header stats init
    if (ui.infoRange) ui.infoRange.textContent = computeTimeRangeText();
    if (ui.infoTotal && manifest && manifest.stats) ui.infoTotal.textContent = String(manifest.stats.totalMessages || '--');

    // build active chunk list
    rebuildActiveChunks();

    // initial load
    resetAndLoadAround(0);

    // observers
    setupObservers();
  }

  // ---------- Theme ----------
  function initThemeToggle() {
    ui.themeToggle = document.getElementById('themeToggle');
    ui.themeIcon = document.getElementById('themeIcon');
    if (!ui.themeToggle || !ui.themeIcon) return;

    var currentTheme = localStorage.getItem('theme') || 'light';

    function setTheme(theme) {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        ui.themeIcon.setAttribute('data-lucide', 'moon');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
        ui.themeIcon.setAttribute('data-lucide', 'sun');
        localStorage.setItem('theme', 'light');
      }
      setLucideIcons();
    }

    setTheme(currentTheme);

    ui.themeToggle.addEventListener('click', function () {
      currentTheme = localStorage.getItem('theme') || 'light';
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  // ---------- Time Range ----------
  function initTimeRange() {
    ui.timeRangeBtn = document.getElementById('timeRangeBtn');
    ui.timeRangeDropdown = document.getElementById('timeRangeDropdown');
    ui.timeRangeLabel = document.getElementById('timeRangeLabel');
    ui.startDateInput = document.getElementById('startDate');
    ui.endDateInput = document.getElementById('endDate');
    ui.applyTimeRangeBtn = document.getElementById('applyTimeRange');
    ui.clearTimeRangeBtn = document.getElementById('clearTimeRange');

    if (manifest && manifest.stats) {
      ui.minDateKey = manifest.stats.minDateKey || null;
      ui.maxDateKey = manifest.stats.maxDateKey || null;
    }

    function clampDateValue(value) {
      if (!value) return '';
      var normalized = value.slice(0, 10);
      if (ui.minDateKey && normalized < ui.minDateKey) return ui.minDateKey;
      if (ui.maxDateKey && normalized > ui.maxDateKey) return ui.maxDateKey;
      return normalized;
    }

    function applyDateRangeLimits() {
      if (!ui.startDateInput || !ui.endDateInput) return;
      ui.startDateInput.min = ui.minDateKey || '';
      ui.endDateInput.min = ui.minDateKey || '';
      ui.startDateInput.max = ui.maxDateKey || '';
      ui.endDateInput.max = ui.maxDateKey || '';
    }

    function enforceInputRange() {
      if (ui.startDateInput) ui.startDateInput.value = clampDateValue(ui.startDateInput.value);
      if (ui.endDateInput) ui.endDateInput.value = clampDateValue(ui.endDateInput.value);
      if (ui.startDateInput && ui.endDateInput && ui.startDateInput.value && ui.endDateInput.value && ui.startDateInput.value > ui.endDateInput.value) {
        ui.endDateInput.value = ui.startDateInput.value;
      }
    }

    function updateTimeRangeLabel() {
      if (!ui.timeRangeLabel || !ui.startDateInput || !ui.endDateInput) return;
      var start = ui.startDateInput.value;
      var end = ui.endDateInput.value;
      if (start || end) ui.timeRangeLabel.textContent = (start || '\u5F00\u59CB') + ' ~ ' + (end || '\u7ED3\u675F');
      else ui.timeRangeLabel.textContent = '\u5168\u90E8\u65F6\u95F4';
    }

    // restore from storage
    var saved = localStorage.getItem('timeRange');
    if (saved && ui.startDateInput && ui.endDateInput) {
      try {
        var r = JSON.parse(saved);
        ui.startDateInput.value = r.start || '';
        ui.endDateInput.value = r.end || '';
      } catch (e) {}
    }

    applyDateRangeLimits();
    enforceInputRange();
    updateTimeRangeLabel();

    if (ui.startDateInput) ui.startDateInput.addEventListener('change', function () { enforceInputRange(); updateTimeRangeLabel(); });
    if (ui.endDateInput) ui.endDateInput.addEventListener('change', function () { enforceInputRange(); updateTimeRangeLabel(); });

    if (ui.timeRangeBtn && ui.timeRangeDropdown) {
      ui.timeRangeBtn.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        ui.timeRangeDropdown.classList.toggle('active');
      });
    }

    if (ui.applyTimeRangeBtn) {
      ui.applyTimeRangeBtn.addEventListener('click', function () {
        enforceInputRange();
        var start = ui.startDateInput ? ui.startDateInput.value : '';
        var end = ui.endDateInput ? ui.endDateInput.value : '';
        localStorage.setItem('timeRange', JSON.stringify({ start: start, end: end }));
        updateTimeRangeLabel();
        if (ui.timeRangeDropdown) ui.timeRangeDropdown.classList.remove('active');

        // apply
        applyFiltersAndReload();
      });
    }

    if (ui.clearTimeRangeBtn) {
      ui.clearTimeRangeBtn.addEventListener('click', function () {
        if (ui.startDateInput) ui.startDateInput.value = '';
        if (ui.endDateInput) ui.endDateInput.value = '';
        localStorage.removeItem('timeRange');
        updateTimeRangeLabel();
        if (ui.timeRangeDropdown) ui.timeRangeDropdown.classList.remove('active');

        // apply
        applyFiltersAndReload();
      });
    }

    document.addEventListener('click', function (e) {
      if (!e || !ui.timeRangeDropdown) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.time-range-container')) {
        ui.timeRangeDropdown.classList.remove('active');
      }
    });
  }

  // ---------- Sender Filter ----------
  function initSenderFilter() {
    ui.filterBtn = document.getElementById('filterBtn');
    ui.filterDropdown = document.getElementById('filterDropdown');
    ui.filterOptionsList = document.getElementById('filterOptionsList');
    ui.filterSearchInput = document.getElementById('filterSearchInput');
    ui.filterNoResult = document.getElementById('filterNoResult');

    if (!ui.filterOptionsList) return;

    // populate from manifest.senders
    if (manifest && Array.isArray(manifest.senders)) {
      // sort: keep stable but prefer by count desc
      var list = manifest.senders.slice().sort(function (a, b) {
        return (b.count || 0) - (a.count || 0);
      });

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s) continue;
        var uid = String(s.uid || '');
        if (!uid) continue;

        var option = document.createElement('div');
        option.className = 'filter-option';
        option.setAttribute('data-value', uid);

        var aliases = Array.isArray(s.aliases) ? s.aliases.filter(Boolean) : [];
        var displayName = String(s.displayName || (aliases[0] || uid));

        if (aliases.length > 1) {
          option.textContent = displayName + ' (' + String(aliases.length - 1) + '\u4E2A\u522B\u540D)';
          option.setAttribute('title', aliases.join(', '));
        } else {
          option.textContent = displayName;
        }

        option.setAttribute('data-names', (aliases.join('|') + '|' + displayName).toLowerCase());
        ui.filterOptionsList.appendChild(option);
      }
    }

    if (ui.filterSearchInput) {
      ui.filterSearchInput.addEventListener('input', function (e) {
        var keyword = (e && e.target && e.target.value ? e.target.value : '').toLowerCase().trim();
        var options = ui.filterOptionsList.querySelectorAll('.filter-option');
        var hasVisible = false;

        for (var i = 0; i < options.length; i++) {
          var opt = options[i];
          var value = opt.getAttribute('data-value');
          var names = opt.getAttribute('data-names') || (opt.textContent || '').toLowerCase();
          if (value === 'all' || names.indexOf(keyword) >= 0 || (opt.textContent || '').toLowerCase().indexOf(keyword) >= 0) {
            opt.classList.remove('hidden');
            hasVisible = true;
          } else {
            opt.classList.add('hidden');
          }
        }

        if (ui.filterNoResult) {
          if (hasVisible) ui.filterNoResult.classList.remove('visible');
          else ui.filterNoResult.classList.add('visible');
        }
      });
    }

    if (ui.filterBtn && ui.filterDropdown) {
      ui.filterBtn.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        ui.filterDropdown.classList.toggle('active');
        if (ui.filterDropdown.classList.contains('active') && ui.filterSearchInput) {
          setTimeout(function () { ui.filterSearchInput.focus(); }, 100);
        }
      });
    }

    ui.filterOptionsList.addEventListener('click', function (e) {
      var t = e ? e.target : null;
      if (!t || !t.classList || !t.classList.contains('filter-option')) return;

      // clear active
      var opts = ui.filterOptionsList.querySelectorAll('.filter-option');
      for (var i = 0; i < opts.length; i++) opts[i].classList.remove('active');
      t.classList.add('active');

      var selected = t.getAttribute('data-value');
      if (selected === 'all') {
        ui.currentFilterUid = null;
      } else {
        ui.currentFilterUid = selected;
      }

      if (ui.filterDropdown) ui.filterDropdown.classList.remove('active');

      // clear filter search UI
      if (ui.filterSearchInput) ui.filterSearchInput.value = '';
      for (var j = 0; j < opts.length; j++) opts[j].classList.remove('hidden');
      if (ui.filterNoResult) ui.filterNoResult.classList.remove('visible');

      // apply
      applyFiltersAndReload();
    });

    document.addEventListener('click', function (e) {
      if (!e || !ui.filterDropdown) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.filter-container')) {
        ui.filterDropdown.classList.remove('active');
      }
    });
  }

  // ---------- Search UI ----------
  function initSearchUI() {
    ui.searchBtn = document.getElementById('searchBtn');
    ui.searchWrapper = document.getElementById('searchWrapper');
    ui.searchInput = document.getElementById('searchInput');
    ui.clearSearch = document.getElementById('clearSearch');

    if (!ui.searchBtn || !ui.searchWrapper || !ui.searchInput) return;

    function updateClearButton() {
      if (!ui.clearSearch) return;
      ui.clearSearch.style.display = ui.searchInput.value ? 'block' : 'none';
    }

    ui.searchBtn.addEventListener('click', function () {
      ui.searchActive = !ui.searchActive;
      if (ui.searchActive) {
        ui.searchWrapper.classList.add('active');
        ui.searchInput.focus();
      } else {
        ui.searchWrapper.classList.remove('active');
        ui.searchInput.value = '';
        updateClearButton();
        applyFiltersAndReload();
      }
    });

    document.addEventListener('click', function (e) {
      if (!e || !ui.searchActive) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.search-container')) {
        ui.searchActive = false;
        ui.searchWrapper.classList.remove('active');
        if (!ui.searchInput.value) {
          ui.searchInput.value = '';
          updateClearButton();
          applyFiltersAndReload();
        }
      }
    });

    var onSearchInput = debounce(function () {
      updateClearButton();
      applyFiltersAndReload();
    }, 300);

    ui.searchInput.addEventListener('input', onSearchInput);

    if (ui.clearSearch) {
      ui.clearSearch.addEventListener('click', function () {
        ui.searchInput.value = '';
        updateClearButton();
        applyFiltersAndReload();
        ui.searchInput.focus();
      });
    }

    updateClearButton();
  }

  // ---------- Apply filters and reload ----------
  function applyFiltersFromUI() {
    // time range
    var start = ui.startDateInput ? ui.startDateInput.value : '';
    var end = ui.endDateInput ? ui.endDateInput.value : '';
    filterState.startDate = start || '';
    filterState.endDate = end || '';

    // sender
    filterState.senderUid = ui.currentFilterUid ? String(ui.currentFilterUid) : null;

    // search
    var term = ui.searchInput ? String(ui.searchInput.value || '').trim() : '';
    filterState.searchTerm = term;
    filterState.searchLower = term ? term.toLowerCase() : '';
  }

  function applyFiltersAndReload() {
    applyFiltersFromUI();
    rebuildActiveChunks();
    resetAndLoadAround(0);
  }

  // ---------- Active chunk rebuild ----------
  function rebuildActiveChunks() {
    activeChunks = [];
    activePosByChunkId = new Map();

    var chunks = (manifest && Array.isArray(manifest.chunks)) ? manifest.chunks : [];
    for (var i = 0; i < chunks.length; i++) {
      var meta = chunks[i];
      if (chunkPassesFilters(meta)) {
        activePosByChunkId.set(meta.id, activeChunks.length);
        activeChunks.push(meta);
      }
    }
  }

  // ---------- Chunk loader ----------
  function loadChunk(meta) {
    if (!meta || !meta.id || !meta.file) return Promise.reject(new Error('bad chunk meta'));
    if (chunkCache.has(meta.id)) return Promise.resolve(chunkCache.get(meta.id));
    if (pendingChunk.has(meta.id)) return pendingChunk.get(meta.id).promise;

    var resolveFn, rejectFn;
    var p = new Promise(function (resolve, reject) {
      resolveFn = resolve;
      rejectFn = reject;
    });
    pendingChunk.set(meta.id, { promise: p, resolve: resolveFn, reject: rejectFn });

    var s = document.createElement('script');
    s.src = meta.file;
    s.async = true;
    s.onerror = function () {
      pendingChunk.delete(meta.id);
      rejectFn(new Error('failed to load chunk script: ' + meta.file));
    };
    // onload: actual data arrives via __QCE_CHUNK__
    document.head.appendChild(s);

    // \u5C3D\u91CF\u51CF\u5C0F DOM \u8D1F\u62C5\uFF1A\u52A0\u8F7D\u540E\u79FB\u9664 script \u6807\u7B7E\uFF08\u4E0D\u5F71\u54CD\u6267\u884C\uFF09
    s.onload = function () {
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };

    return p;
  }

  // ---------- MessageId index loader ----------
  function hashToBucket(str, bucketCount) {
    var h = fnv1a32(str, 0x811c9dc5);
    return (h % bucketCount) >>> 0;
  }

  function bucketHex2(bucket) {
    var hex = bucket.toString(16);
    if (hex.length < 2) hex = '0' + hex;
    return hex;
  }

  function loadMsgIndexBucket(bucket) {
    if (!manifest || !manifest.msgidIndex) return Promise.reject(new Error('msgid index not available'));
    var bucketCount = manifest.msgidIndex.bucketCount || 0;
    var dir = manifest.msgidIndex.dir || 'data/index';
    var prefix = manifest.msgidIndex.filePrefix || 'msgid_b';
    var ext = manifest.msgidIndex.fileExt || '.js';
    if (!bucketCount) return Promise.reject(new Error('msgid index bucketCount invalid'));

    if (loadedMsgIndexBuckets.has(bucket)) return Promise.resolve();
    if (pendingMsgIndexBuckets.has(bucket)) return pendingMsgIndexBuckets.get(bucket).promise;

    var resolveFn, rejectFn;
    var p = new Promise(function (resolve, reject) {
      resolveFn = resolve;
      rejectFn = reject;
    });
    pendingMsgIndexBuckets.set(bucket, { promise: p, resolve: resolveFn, reject: rejectFn });

    var s = document.createElement('script');
    s.src = dir + '/' + prefix + bucketHex2(bucket) + ext;
    s.async = true;
    s.onerror = function () {
      pendingMsgIndexBuckets.delete(bucket);
      rejectFn(new Error('failed to load msgid index bucket: ' + s.src));
    };
    document.head.appendChild(s);

    s.onload = function () {
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };

    return p;
  }

  // ---------- Render window ----------
  function clearRenderedDOM() {
    // keep sentinels
    if (!ui.chatContent || !ui.topSentinel || !ui.bottomSentinel) return;
    // remove everything between sentinels
    while (ui.chatContent.children.length > 2) {
      ui.chatContent.removeChild(ui.chatContent.children[1]);
    }
  }

  function resetWindowState() {
    rendered = [];
    loadedStartPos = 0;
    loadedEndPos = -1;
    isLoadingNext = false;
    isLoadingPrev = false;
  }

  function getMaxWindowChunks() {
    // \u4F60\u53EF\u4EE5\u5728\u5BFC\u51FA manifest \u91CC\u6269\u5C55\u8BBE\u7F6E\uFF1B\u8FD9\u91CC\u5148\u56FA\u5B9A 3
    return 3;
  }

  function renderChunkAtEnd(pos, chunk, meta) {
    var container = document.createElement('div');
    container.className = 'qce-chunk';
    container.setAttribute('data-chunk-id', chunk.id);
    container.setAttribute('data-chunk-pos', String(pos));

    var html = '';
    var visible = 0;
    var msgs = Array.isArray(chunk.messages) ? chunk.messages : [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (messagePassesFilters(m)) {
        visible++;
        html += m.html || '';
      }
    }

    if (visible === 0) {
      // \u4E0D\u63D2\u5165\u7A7A chunk\uFF08\u907F\u514D\u7A7A\u767D\u5360\u4F4D\u5F71\u54CD\u6EDA\u52A8\uFF09\uFF0C\u4F46\u4ECD\u8BB0\u5F55\u5230 rendered
      return { el: null, visibleCount: 0 };
    }

    container.innerHTML = html;
    ui.chatContent.insertBefore(container, ui.bottomSentinel);

    if (filterState.searchTerm) highlightIn(container, filterState.searchTerm);

    return { el: container, visibleCount: visible };
  }

  function renderChunkAtStart(pos, chunk, meta) {
    var container = document.createElement('div');
    container.className = 'qce-chunk';
    container.setAttribute('data-chunk-id', chunk.id);
    container.setAttribute('data-chunk-pos', String(pos));

    var html = '';
    var visible = 0;
    var msgs = Array.isArray(chunk.messages) ? chunk.messages : [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (messagePassesFilters(m)) {
        visible++;
        html += m.html || '';
      }
    }

    if (visible === 0) {
      return { el: null, visibleCount: 0 };
    }

    container.innerHTML = html;
    ui.chatContent.insertBefore(container, ui.topSentinel.nextSibling);

    if (filterState.searchTerm) highlightIn(container, filterState.searchTerm);

    return { el: container, visibleCount: visible };
  }

  function sumRenderedVisibleCount() {
    var s = 0;
    for (var i = 0; i < rendered.length; i++) s += (rendered[i].visibleCount || 0);
    return s;
  }

  function trimTopIfNeeded() {
    var maxChunks = getMaxWindowChunks();
    var loadedCount = loadedEndPos - loadedStartPos + 1;
    if (loadedCount <= maxChunks) return;

    // remove first rendered entry (loadedStartPos)
    var first = rendered.shift();
    loadedStartPos++;

    if (first && first.el) {
      var h = first.el.getBoundingClientRect().height || 0;
      try { first.el.parentNode && first.el.parentNode.removeChild(first.el); } catch (e) {}
      // \u5220\u9664\u4E0A\u65B9\u5185\u5BB9\u4F1A\u5BFC\u81F4\u89C6\u56FE\u8DF3\u52A8\uFF1A\u5411\u4E0A\u8865\u507F
      if (h) window.scrollBy(0, -h);
    }

    // memory: allow GC
    if (first && first.chunkId) chunkCache.delete(first.chunkId);
  }

  function trimBottomIfNeeded() {
    var maxChunks = getMaxWindowChunks();
    var loadedCount = loadedEndPos - loadedStartPos + 1;
    if (loadedCount <= maxChunks) return;

    // remove last rendered entry (loadedEndPos)
    var last = rendered.pop();
    loadedEndPos--;

    if (last && last.el) {
      try { last.el.parentNode && last.el.parentNode.removeChild(last.el); } catch (e) {}
    }
    if (last && last.chunkId) chunkCache.delete(last.chunkId);
  }

  function resetAndLoadAround(pos) {
    // pos: active chunk position
    clearRenderedDOM();
    resetWindowState();

    // clear chunk cache aggressively to keep memory bounded
    chunkCache.clear();
    pendingChunk.clear();

    if (!activeChunks || activeChunks.length === 0) {
      // show hint
      var hint = document.createElement('div');
      hint.className = 'scroll-loader';
      hint.textContent = '\u6CA1\u6709\u5339\u914D\u7684\u6D88\u606F';
      ui.chatContent.insertBefore(hint, ui.bottomSentinel);
      if (ui.infoTotal) ui.infoTotal.textContent = '0';
      return;
    }

    // clamp pos
    if (pos < 0) pos = 0;
    if (pos > activeChunks.length - 1) pos = activeChunks.length - 1;

    // compute window [start..end]
    var maxChunks = getMaxWindowChunks();
    var half = Math.floor(maxChunks / 2);
    var start = pos - half;
    if (start < 0) start = 0;
    var end = start + maxChunks - 1;
    if (end > activeChunks.length - 1) {
      end = activeChunks.length - 1;
      start = Math.max(0, end - maxChunks + 1);
    }

    loadedStartPos = start;
    loadedEndPos = start - 1;

    // scroll to top when filter changes
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }

    // load sequentially
    (async function () {
      for (var p = start; p <= end; p++) {
        await loadNextInternal();
      }
      updateHeaderStats(sumRenderedVisibleCount());
    })().catch(function (e) {
      warn('initial load error', e);
    });
  }

  async function loadNextInternal() {
    var nextPos = loadedEndPos + 1;
    if (nextPos < loadedStartPos) nextPos = loadedStartPos;
    if (nextPos >= activeChunks.length) return;

    var meta = activeChunks[nextPos];
    var chunk = await loadChunk(meta);
    var renderedChunk = renderChunkAtEnd(nextPos, chunk, meta);

    rendered.push({ pos: nextPos, chunkId: meta.id, el: renderedChunk.el, visibleCount: renderedChunk.visibleCount });
    loadedEndPos = nextPos;

    // trim
    trimTopIfNeeded();
  }

  async function loadPrevInternal() {
    var prevPos = loadedStartPos - 1;
    if (prevPos < 0) return;

    var meta = activeChunks[prevPos];
    var beforeHeight = 0;

    // we will render first, then scroll compensation by added height
    var chunk = await loadChunk(meta);
    var renderedChunk = renderChunkAtStart(prevPos, chunk, meta);

    // measure added height
    if (renderedChunk.el) beforeHeight = renderedChunk.el.getBoundingClientRect().height || 0;

    rendered.unshift({ pos: prevPos, chunkId: meta.id, el: renderedChunk.el, visibleCount: renderedChunk.visibleCount });
    loadedStartPos = prevPos;

    // compensate scroll because we inserted content above viewport
    if (beforeHeight) window.scrollBy(0, beforeHeight);

    // trim bottom
    trimBottomIfNeeded();
  }

  // ---------- Infinite scroll observers ----------
  function setupObservers() {
    // IntersectionObserver preferred
    if ('IntersectionObserver' in window && ui.topSentinel && ui.bottomSentinel) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e.isIntersecting) continue;
          if (e.target === ui.bottomSentinel) {
            if (!isLoadingNext) {
              isLoadingNext = true;
              (async function () {
                try {
                  await loadNextInternal();
                  updateHeaderStats(sumRenderedVisibleCount());
                } finally {
                  isLoadingNext = false;
                }
              })();
            }
          } else if (e.target === ui.topSentinel) {
            if (!isLoadingPrev) {
              isLoadingPrev = true;
              (async function () {
                try {
                  await loadPrevInternal();
                  updateHeaderStats(sumRenderedVisibleCount());
                } finally {
                  isLoadingPrev = false;
                }
              })();
            }
          }
        }
      }, { root: null, rootMargin: '1200px 0px 1200px 0px', threshold: 0.01 });

      io.observe(ui.bottomSentinel);
      io.observe(ui.topSentinel);
      return;
    }

    // fallback scroll listener
    window.addEventListener('scroll', debounce(function () {
      var st = window.pageYOffset || document.documentElement.scrollTop || 0;
      var docH = document.documentElement.scrollHeight || 0;
      var winH = window.innerHeight || 0;

      if (!isLoadingNext && (docH - (st + winH) < 1200)) {
        isLoadingNext = true;
        (async function () {
          try { await loadNextInternal(); updateHeaderStats(sumRenderedVisibleCount()); }
          finally { isLoadingNext = false; }
        })();
      }

      if (!isLoadingPrev && (st < 600)) {
        isLoadingPrev = true;
        (async function () {
          try { await loadPrevInternal(); updateHeaderStats(sumRenderedVisibleCount()); }
          finally { isLoadingPrev = false; }
        })();
      }
    }, 80), { passive: true });
  }

  // ---------- Reply jump: scrollToMessage (\u8DE8 chunk \u5B9A\u4F4D\u80FD\u529B\uFF1Amsgid index buckets) ----------
  window.scrollToMessage = function (msgId) {
    if (!msgId) return;

    // 1) if already in DOM
    var el = document.getElementById(msgId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try {
        el.style.transition = 'background 0.3s';
        var originalBg = window.getComputedStyle(el).backgroundColor;
        el.style.background = 'rgba(0, 122, 255, 0.1)';
        setTimeout(function () {
          el.style.background = originalBg;
          setTimeout(function () { el.style.transition = ''; }, 300);
        }, 1000);
      } catch (e) {}
      return;
    }

    // 2) locate by msgid index bucket (on-demand)
    if (!manifest || !manifest.msgidIndex) {
      warn('msgid index not available');
      return;
    }

    var bucketCount = manifest.msgidIndex.bucketCount || 0;
    if (!bucketCount) {
      warn('msgid index bucketCount invalid');
      return;
    }

    var bucket = hashToBucket(String(msgId), bucketCount);

    loadMsgIndexBucket(bucket).then(function () {
      var chunkId = msgIdToChunkId.get(String(msgId));
      if (!chunkId) {
        warn('msgId not found in index:', msgId);
        return;
      }

      // chunk must be in activeChunks (filtered scope), otherwise we should not change filters automatically
      var targetPos = activePosByChunkId.get(chunkId);
      if (typeof targetPos !== 'number') {
        warn('target chunk not in current filtered scope:', chunkId);
        return;
      }

      // jump window to that pos
      resetAndLoadAround(targetPos);

      // wait a bit for DOM insertion, then scroll
      setTimeout(function () {
        var e2 = document.getElementById(msgId);
        if (e2) {
          e2.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try {
            e2.style.transition = 'background 0.3s';
            var originalBg = window.getComputedStyle(e2).backgroundColor;
            e2.style.background = 'rgba(0, 122, 255, 0.1)';
            setTimeout(function () {
              e2.style.background = originalBg;
              setTimeout(function () { e2.style.transition = ''; }, 300);
            }, 1000);
          } catch (e) {}
        } else {
          warn('message still not found after jump:', msgId);
        }
      }, 400);
    }).catch(function (e) {
      warn('load msgid index bucket failed:', e);
    });
  };

  // done
  log('viewer initialized');
})();
`;

// vendor/qce/lib/core/exporter/ModernHtmlExporter.ts
var ModernHtmlExporter = class {
  options;
  mediaCopyFailures = /* @__PURE__ */ new Map();
  currentChatInfo;
  lastRenderedDate;
  /**
   * Issue #311: data URI 缓存。key 为 `<typeDir>/<basename>`，value 为完整
   * `data:<mime>;base64,...` 字符串。仅当 `embedResourcesAsDataUri=true`
   * 时被填充，否则始终为空，渲染路径走原有的 `./resources/...`。
   */
  dataUriCache = /* @__PURE__ */ new Map();
  /** Issue #311: 已尝试过、确认不可内联的资源 key，避免重复磁盘探测。 */
  dataUriMisses = /* @__PURE__ */ new Set();
  /**
   * 资源引用基础路径（URL 相对前缀）
   * - 单文件导出使用 './resources'（资源目录与 HTML 同级，便于独立移动）
   * - Chunked 方案使用 'resources'（无 ./ 前缀）
   * 
   * 修复 Issue #213: 自定义路径导出时图片无法显示的问题
   * 原因：之前使用 '../resources' 假设 HTML 在 exports 子目录，资源在父目录
   * 现在：资源目录与 HTML 文件同级，确保导出文件可独立移动
   */
  resourceBaseHref = "./resources";
  constructor(options) {
    this.options = {
      includeResourceLinks: true,
      includeSystemMessages: true,
      encoding: "utf8",
      // 更稳妥的 Node 编码常量
      embedResourcesAsDataUri: false,
      maxEmbedFileSizeBytes: 50 * 1024 * 1024,
      showSearchBar: true,
      enableVirtualScroll: true,
      ...options
    };
  }
  /**
   * 导出聊天记录为HTML（保持原签名，内部走流式）
   */
  async export(messages, chatInfo) {
    await this.exportFromIterable(messages, chatInfo);
  }
  /**
   * 新增：Chunked Viewer 导出（可选接口）
   * - 输出：index.html + assets/ + data/manifest(.js/.json) + data/chunks/*.js + data/index/msgid_bXX.js
   * - 特性：Streaming 写入、分块、索引、资源复制并发受限，避免 OOM
   */
  async exportChunked(messages, chatInfo, options) {
    return await this.exportChunkedFromIterable(messages, chatInfo, options);
  }
  /**
   * 新增：从 Iterable/AsyncIterable 进行 Chunked 导出（最低内存占用）
   */
  async exportChunkedFromIterable(messages, chatInfo, options = {}) {
    const encoding = this.options.encoding || "utf8";
    const outputDir = path2.dirname(this.options.outputPath);
    await fsp.mkdir(outputDir, { recursive: true });
    const assetsDirName = options.assetsDirName || "assets";
    const dataDirName = options.dataDirName || "data";
    const chunksDirName = options.chunksDirName || "chunks";
    const indexDirName = options.indexDirName || "index";
    const assetsDir = path2.join(outputDir, assetsDirName);
    const dataDir = path2.join(outputDir, dataDirName);
    const chunksDir = path2.join(dataDir, chunksDirName);
    const indexDir = path2.join(dataDir, indexDirName);
    await Promise.all([
      fsp.mkdir(assetsDir, { recursive: true }),
      fsp.mkdir(dataDir, { recursive: true }),
      fsp.mkdir(chunksDir, { recursive: true }),
      fsp.mkdir(indexDir, { recursive: true })
    ]);
    await fsp.writeFile(path2.join(assetsDir, "style.css"), MODERN_CSS, encoding);
    await fsp.writeFile(path2.join(assetsDir, "app.js"), MODERN_CHUNKED_APP_JS, encoding);
    if (this.options.includeResourceLinks) {
      const resourceTypes = ["images", "videos", "audios", "files"];
      await Promise.all(
        resourceTypes.map(
          (type) => fsp.mkdir(path2.join(outputDir, "resources", type), { recursive: true })
        )
      );
    }
    const concurrency = Math.max(2, Math.min(8, os.cpus().length || 4));
    const running = [];
    const copiedResources = [];
    let copiedCount = 0;
    const scheduleCopy = (task) => {
      const p = (async () => {
        try {
          const resourcePath = await task();
          if (resourcePath) copiedResources.push(resourcePath);
          copiedCount++;
        } catch (e) {
          console.error(`[ModernHtmlExporter][Chunked] \u590D\u5236\u8D44\u6E90\u5931\u8D25:`, e);
        }
      })();
      p.finally(() => {
        const idx = running.indexOf(p);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(p);
      return p;
    };
    const maxMessagesPerChunk = Math.max(100, options.maxMessagesPerChunk || 2e3);
    const maxChunkBytes = Math.max(1 * 1024 * 1024, options.maxChunkBytes || 50 * 1024 * 1024);
    const enableTextBloom = options.enableTextBloom !== false;
    const bloomTextBits = Math.max(2048, options.bloomTextBits || 16384);
    const bloomTextHashes = Math.max(2, options.bloomTextHashes || 6);
    const bloomSenderBits = Math.max(512, options.bloomSenderBits || 2048);
    const bloomSenderHashes = Math.max(2, options.bloomSenderHashes || 4);
    const bloomMaxCharsPerMessage = Math.max(256, options.bloomMaxCharsPerMessage || 8192);
    const storeTextMaxChars = Math.max(256, options.storeTextMaxChars || 4096);
    const msgIdIndexBucketCount = Math.max(8, Math.min(256, options.msgIdIndexBucketCount || 64));
    const writeManifestJson = options.writeManifestJson !== false;
    const chunksMeta = [];
    const sendersByUid = /* @__PURE__ */ new Map();
    let totalMessages = 0;
    let firstTime = null;
    let lastTime = null;
    let minDateKey = null;
    let maxDateKey = null;
    const bucketStreams = [];
    const bucketFirst = [];
    const bucketFilePrefix = "msgid_b";
    const bucketFileExt = ".js";
    const openBucketStreams = async () => {
      for (let i = 0; i < msgIdIndexBucketCount; i++) {
        const hex = i.toString(16).padStart(2, "0");
        const fileName = `${bucketFilePrefix}${hex}${bucketFileExt}`;
        const absPath = path2.join(indexDir, fileName);
        const ws = fs.createWriteStream(absPath, { encoding, flags: "w" });
        ws.on("error", (e) => console.error("[ModernHtmlExporter][Chunked] msgid index \u5199\u5165\u9519\u8BEF:", e));
        bucketStreams.push(ws);
        bucketFirst.push(true);
        await this.writeChunk(ws, `window.__QCE_MSGID_INDEX__ && window.__QCE_MSGID_INDEX__(${String(i)}, [
`);
      }
    };
    const closeBucketStreams = async () => {
      const tasks = [];
      for (let i = 0; i < bucketStreams.length; i++) {
        const ws = bucketStreams[i];
        tasks.push((async () => {
          await this.writeChunk(ws, `
]);
`);
          ws.end();
          await once(ws, "finish");
        })());
      }
      await Promise.all(tasks);
    };
    const hashToBucket = (msgId) => {
      const h = fnv1a32(msgId, 2166136261);
      return h % msgIdIndexBucketCount >>> 0;
    };
    let chunkIndex = 0;
    let chunkId = "";
    let chunkWs = null;
    let chunkCount = 0;
    let chunkBytes = 0;
    let chunkStartTs = 0;
    let chunkEndTs = 0;
    let chunkStartDate = "";
    let chunkEndDate = "";
    let chunkFirstMsgId = "";
    let chunkLastMsgId = "";
    let textBloom = null;
    let senderBloom = null;
    let textBloomIncomplete = false;
    let isFirstRecordInChunk = true;
    const chunkFileRel = (id) => {
      return path2.posix.join(dataDirName, chunksDirName, `${id}.js`);
    };
    const bucketFileRel = (bucket) => {
      const hex = bucket.toString(16).padStart(2, "0");
      return path2.posix.join(dataDirName, indexDirName, `${bucketFilePrefix}${hex}${bucketFileExt}`);
    };
    const startChunk = async () => {
      chunkIndex++;
      chunkId = `c${String(chunkIndex).padStart(6, "0")}`;
      const absPath = path2.join(chunksDir, `${chunkId}.js`);
      chunkWs = fs.createWriteStream(absPath, { encoding, flags: "w" });
      chunkWs.on("error", (e) => console.error("[ModernHtmlExporter][Chunked] chunk \u5199\u5165\u9519\u8BEF:", e));
      chunkCount = 0;
      chunkBytes = 0;
      chunkStartTs = 0;
      chunkEndTs = 0;
      chunkStartDate = "";
      chunkEndDate = "";
      chunkFirstMsgId = "";
      chunkLastMsgId = "";
      isFirstRecordInChunk = true;
      textBloomIncomplete = false;
      textBloom = enableTextBloom ? new BloomFilter(bloomTextBits, bloomTextHashes) : null;
      senderBloom = new BloomFilter(bloomSenderBits, bloomSenderHashes);
      await this.writeChunk(chunkWs, `window.__QCE_CHUNK__ && window.__QCE_CHUNK__({id:${JSON.stringify(chunkId)},messages:[
`);
      chunkBytes += Buffer.byteLength(`window.__QCE_CHUNK__ && window.__QCE_CHUNK__({id:${JSON.stringify(chunkId)},messages:[
`, encoding);
    };
    const finishChunk = async () => {
      if (!chunkWs) return;
      await this.writeChunk(chunkWs, `
]});
`);
      chunkBytes += Buffer.byteLength(`
]});
`, encoding);
      chunkWs.end();
      await once(chunkWs, "finish");
      const meta = {
        id: chunkId,
        file: chunkFileRel(chunkId),
        count: chunkCount,
        startTs: chunkStartTs,
        endTs: chunkEndTs,
        startDate: chunkStartDate,
        endDate: chunkEndDate,
        textBloom: textBloom ? textBloom.toBase64() : "",
        textBloomIncomplete,
        senderBloom: senderBloom ? senderBloom.toBase64() : "",
        firstMsgId: chunkFirstMsgId,
        lastMsgId: chunkLastMsgId,
        bytes: chunkBytes
      };
      chunksMeta.push(meta);
      chunkWs = null;
      textBloom = null;
      senderBloom = null;
    };
    await openBucketStreams();
    this.mediaCopyFailures.clear();
    this.currentChatInfo = chatInfo;
    this.lastRenderedDate = void 0;
    const oldResourceBaseHref = this.resourceBaseHref;
    this.resourceBaseHref = "resources";
    try {
      for await (const message of this.toAsyncIterable(messages)) {
        if (!this.options.includeSystemMessages && this.isSystemMessage(message)) continue;
        const t = this.safeToDate(message?.timestamp || message?.time);
        const ts = t ? t.getTime() : 0;
        const dateInfo = this.getMessageDateInfo(message);
        const dateKey = dateInfo?.key || "";
        if (t) {
          if (!firstTime || t < firstTime) firstTime = t;
          if (!lastTime || t > lastTime) lastTime = t;
        }
        if (dateKey) {
          if (!minDateKey || dateKey < minDateKey) minDateKey = dateKey;
          if (!maxDateKey || dateKey > maxDateKey) maxDateKey = dateKey;
        }
        const senderUid = String(message?.sender?.uid || message?.sender?.uin || "");
        const senderName = this.getDisplayName(message);
        const senderNameLower = senderName ? senderName.toLowerCase() : "";
        if (senderUid) {
          if (!sendersByUid.has(senderUid)) {
            sendersByUid.set(senderUid, { names: /* @__PURE__ */ new Set(), displayName: senderName, count: 0 });
          }
          const info = sendersByUid.get(senderUid);
          info.names.add(senderName);
          info.count++;
          if (!info.displayName) info.displayName = senderName;
        }
        if (!chunkWs) await startChunk();
        if (chunkCount === 0) {
          chunkStartTs = ts;
          chunkStartDate = dateKey;
          chunkFirstMsgId = `msg-${message.id}`;
        }
        chunkEndTs = ts;
        chunkEndDate = dateKey;
        chunkLastMsgId = `msg-${message.id}`;
        const html = this.renderMessage(message);
        const plain = this.extractPlainText(message);
        const plainLowerFull = plain ? plain.toLowerCase() : "";
        const storedText = plainLowerFull.slice(0, storeTextMaxChars);
        const textTruncated = plainLowerFull.length > storeTextMaxChars;
        if (senderBloom && senderUid) senderBloom.add(senderUid);
        if (enableTextBloom && textBloom) {
          const bloomText = plainLowerFull + " " + senderNameLower;
          const bloomSlice = bloomText.slice(0, bloomMaxCharsPerMessage);
          if (bloomText.length > bloomMaxCharsPerMessage) textBloomIncomplete = true;
          this.addTextToBloom(textBloom, bloomSlice);
        }
        const domMsgId = `msg-${message.id}`;
        const b = hashToBucket(domMsgId);
        const bws = bucketStreams[b];
        if (bws) {
          const pair = JSON.stringify([domMsgId, chunkId]);
          const sep = bucketFirst[b] ? "" : ",\n";
          bucketFirst[b] = false;
          await this.writeChunk(bws, sep + pair);
        }
        const record = {
          id: domMsgId,
          ts,
          date: dateKey,
          uid: senderUid,
          name: senderName,
          nameLower: senderNameLower,
          text: storedText,
          textTruncated,
          html
        };
        const json = JSON.stringify(record);
        const prefix = isFirstRecordInChunk ? "" : ",\n";
        isFirstRecordInChunk = false;
        await this.writeChunk(chunkWs, prefix + json);
        chunkBytes += Buffer.byteLength(prefix + json, encoding);
        totalMessages++;
        chunkCount++;
        if (this.options.includeResourceLinks) {
          for (const res of this.iterResources(message)) {
            while (running.length >= concurrency) await Promise.race(running);
            scheduleCopy(() => this.copyResourceFileStream(res, outputDir));
          }
        }
        if (chunkCount >= maxMessagesPerChunk || chunkBytes >= maxChunkBytes) {
          await finishChunk();
        }
      }
      if (chunkWs) await finishChunk();
      await Promise.all(running);
      await closeBucketStreams();
      const exportTimeIso = (/* @__PURE__ */ new Date()).toISOString();
      const timeRangeText = firstTime && lastTime ? `${firstTime.toLocaleDateString("zh-CN")} \u81F3 ${lastTime.toLocaleDateString("zh-CN")}` : "--";
      const senders = Array.from(sendersByUid.entries()).map(([uid, info]) => ({
        uid,
        displayName: info.displayName || uid,
        aliases: Array.from(info.names),
        count: info.count || 0
      }));
      const manifest = {
        format: "qce-modern-html-chunked",
        version: 1,
        exportTime: exportTimeIso,
        chat: {
          name: chatInfo.name,
          type: chatInfo.type,
          avatar: chatInfo.avatar,
          selfUid: chatInfo.selfUid,
          selfUin: chatInfo.selfUin,
          selfName: chatInfo.selfName
        },
        stats: {
          totalMessages,
          firstTime: firstTime ? firstTime.toISOString() : null,
          lastTime: lastTime ? lastTime.toISOString() : null,
          timeRangeText,
          minDateKey: minDateKey || null,
          maxDateKey: maxDateKey || null
        },
        chunking: {
          maxMessagesPerChunk,
          maxChunkBytes
        },
        bloom: {
          textBits: bloomTextBits,
          textHashes: bloomTextHashes,
          senderBits: bloomSenderBits,
          senderHashes: bloomSenderHashes
        },
        msgidIndex: {
          bucketCount: msgIdIndexBucketCount,
          dir: path2.posix.join(dataDirName, indexDirName),
          filePrefix: bucketFilePrefix,
          fileExt: bucketFileExt
        },
        paths: {
          assetsDir: assetsDirName,
          dataDir: dataDirName,
          chunksDir: path2.posix.join(dataDirName, chunksDirName),
          indexDir: path2.posix.join(dataDirName, indexDirName),
          resourcesDir: "resources"
        },
        senders,
        chunks: chunksMeta
      };
      const manifestJsPath = path2.join(dataDir, "manifest.js");
      const manifestJsonPath = path2.join(dataDir, "manifest.json");
      await fsp.writeFile(manifestJsPath, `window.__QCE_MANIFEST__ && window.__QCE_MANIFEST__(${JSON.stringify(manifest)});
`, encoding);
      if (writeManifestJson) {
        await fsp.writeFile(manifestJsonPath, JSON.stringify(manifest, null, 2), encoding);
      }
      const metadata = {
        messageCount: totalMessages,
        chatName: chatInfo.name,
        chatType: chatInfo.type,
        exportTime: exportTimeIso,
        mode: "chunked"
      };
      const headerHtml = this.generateHeader(chatInfo, { totalMessages }, timeRangeText);
      const indexHtml = renderTemplate(MODERN_CHUNKED_INDEX_HTML_TEMPLATE, {
        METADATA_JSON: JSON.stringify(metadata).replace(/</g, "\\u003c"),
        CHAT_NAME_ESC: this.escapeHtml(chatInfo.name),
        TOOLBAR: MODERN_TOOLBAR_HTML,
        HEADER: headerHtml,
        FOOTER: MODERN_FOOTER_HTML
      });
      await fsp.writeFile(this.options.outputPath, indexHtml.replace("</body>", this.mediaFailureScript() + "</body>"), encoding);
      return {
        outputDir,
        indexHtmlPath: this.options.outputPath,
        manifestJsPath,
        manifestJsonPath: writeManifestJson ? manifestJsonPath : void 0,
        chunkCount: chunksMeta.length,
        totalMessages,
        copiedResources
      };
    } catch (error) {
      console.error(`[ModernHtmlExporter][Chunked] \u5BFC\u51FA\u53D1\u751F\u9519\u8BEF:`, error);
      throw error;
    } finally {
      this.resourceBaseHref = oldResourceBaseHref;
      for (const ws of bucketStreams) {
        try {
          ws.destroy();
        } catch {
        }
      }
    }
  }
  /**
   * 从 Iterable/AsyncIterable 流式导出，最低内存占用
   */
  async exportFromIterable(messages, chatInfo) {
    const outputDir = path2.dirname(this.options.outputPath);
    await fsp.mkdir(outputDir, { recursive: true });
    const ws = fs.createWriteStream(this.options.outputPath, {
      encoding: this.options.encoding || "utf8",
      flags: "w"
    });
    this.mediaCopyFailures.clear();
    this.currentChatInfo = chatInfo;
    this.lastRenderedDate = void 0;
    const onError = (error) => {
      console.error("[ModernHtmlExporter] \u5199\u5165\u6D41\u9519\u8BEF:", error);
      try {
        ws.destroy();
      } catch {
      }
    };
    ws.on("error", onError);
    let totalMessages = 0;
    let firstTime = null;
    let lastTime = null;
    let copiedCount = 0;
    const copiedResources = [];
    const concurrency = Math.max(2, Math.min(8, os.cpus().length || 4));
    const running = [];
    const scheduleCopy = (task) => {
      const p = (async () => {
        try {
          const resourcePath = await task();
          if (resourcePath) {
            copiedResources.push(resourcePath);
          }
          copiedCount++;
        } catch (e) {
          console.error(`[ModernHtmlExporter] \u590D\u5236\u8D44\u6E90\u5931\u8D25:`, e);
        }
      })();
      p.finally(() => {
        const idx = running.indexOf(p);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(p);
      return p;
    };
    const useDataUri = this.options.includeResourceLinks === true && this.options.embedResourcesAsDataUri === true;
    if (this.options.includeResourceLinks && !useDataUri) {
      const resourceTypes = ["images", "videos", "audios", "files"];
      await Promise.all(
        resourceTypes.map(
          (type) => fsp.mkdir(path2.join(outputDir, "resources", type), { recursive: true })
        )
      );
    }
    try {
      const exportTimeIso = (/* @__PURE__ */ new Date()).toISOString();
      const metadata = {
        messageCount: 0,
        chatName: chatInfo.name,
        chatType: chatInfo.type,
        exportTime: exportTimeIso
      };
      const topHtml = renderTemplate(MODERN_SINGLE_HTML_TOP_TEMPLATE, {
        METADATA_JSON: JSON.stringify(metadata).replace(/</g, "\\u003c"),
        CHAT_NAME_ESC: this.escapeHtml(chatInfo.name),
        STYLES: this.generateStyles(),
        SCRIPTS: this.generateScripts(),
        TOOLBAR: this.generateToolbar(),
        HEADER: this.generateHeader(chatInfo, { totalMessages: "--" }, "--")
      });
      await this.writeChunk(ws, topHtml);
      for await (const message of this.toAsyncIterable(messages)) {
        const t = this.safeToDate(message?.timestamp || message?.time);
        if (t) {
          if (!firstTime || t < firstTime) firstTime = t;
          if (!lastTime || t > lastTime) lastTime = t;
        }
        if (!this.options.includeSystemMessages && this.isSystemMessage(message)) {
          continue;
        }
        if (useDataUri) {
          for (const res of this.iterResources(message)) {
            await this.preloadDataUri(res);
          }
        }
        const chunk = this.renderMessage(message);
        await this.writeChunk(ws, chunk + "\n");
        totalMessages++;
        if (this.options.includeResourceLinks && !useDataUri) {
          for (const res of this.iterResources(message)) {
            while (running.length >= concurrency) {
              await Promise.race(running);
            }
            scheduleCopy(() => this.copyResourceFileStream(res, outputDir));
          }
        }
      }
      await Promise.all(running);
      const timeRangeText = firstTime && lastTime ? `${firstTime.toLocaleDateString("zh-CN")} \u81F3 ${lastTime.toLocaleDateString("zh-CN")}` : "--";
      const timeRangeJs = JSON.stringify(timeRangeText);
      const bottomHtml = renderTemplate(MODERN_SINGLE_HTML_BOTTOM_TEMPLATE, {
        FOOTER: this.generateFooter(),
        TOTAL_MESSAGES: String(totalMessages),
        TIME_RANGE_JS: timeRangeJs
      });
      await this.writeChunk(ws, this.mediaFailureScript() + bottomHtml);
      ws.end();
      await once(ws, "finish");
      await this.updateMetadata(totalMessages);
      return copiedResources;
    } catch (error) {
      try {
        ws.destroy();
      } catch {
      }
      console.error(`[ModernHtmlExporter] \u5BFC\u51FA\u53D1\u751F\u9519\u8BEF:`, error);
      throw error;
    }
  }
  /* ------------------------ 工具方法：流式写入 ------------------------ */
  async writeChunk(stream, chunk) {
    if (!stream.write(chunk)) {
      await once(stream, "drain");
    }
  }
  toAsyncIterable(src) {
    if (src[Symbol.asyncIterator]) {
      return src;
    }
    const it = src;
    return (async function* () {
      for (const item of it) yield item;
    })();
  }
  safeToDate(input) {
    if (!input) return null;
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  /* ------------------------ 资源复制（流式 + 并发受限） ------------------------ */
  *iterResources(message) {
    const c = message?.content;
    if (c?.resources && Array.isArray(c.resources)) {
      for (const r of c.resources) {
        if (mediaExportState(r)) continue;
        const localPath = r?.localPath;
        if (localPath && this.isValidResourcePath(localPath)) {
          yield {
            type: r?.type || "file",
            fileName: path2.basename(localPath),
            localPath,
            url: r?.url
          };
        }
      }
    }
    if (c?.elements && Array.isArray(c.elements)) {
      yield* this.iterElementResources(c.elements);
    }
  }
  /** 合并转发详情里的媒体也要复制/内联，保证展开后仍能离线查看。 */
  *iterElementResources(elements) {
    for (const el of elements) {
      const data = el?.data;
      const elType = el?.type || "file";
      if (mediaExportState(data)) continue;
      if (elType === "reply" && Array.isArray(data?.previewElements)) {
        for (const preview of data.previewElements) {
          if (mediaExportState(preview) || !["image", "video", "audio", "file"].includes(preview?.type) || !preview?.localPath || !this.isValidResourcePath(preview.localPath)) continue;
          yield {
            type: preview.type,
            fileName: path2.basename(preview.localPath),
            localPath: preview.localPath,
            url: preview.originUrl
          };
        }
      }
      if (elType === "forward" && Array.isArray(data?.messages)) {
        for (const innerMessage of data.messages) {
          const innerElements = innerMessage?.content?.elements;
          if (Array.isArray(innerElements)) {
            yield* this.iterElementResources(innerElements);
          }
        }
        continue;
      }
      if (data && typeof data === "object" && data.localPath && this.isValidResourcePath(data.localPath)) {
        yield {
          type: elType,
          fileName: path2.basename(data.localPath),
          localPath: data.localPath,
          url: data.url
        };
      } else if (data && typeof data === "object" && (data.filename || data.md5)) {
        const fileName = data.filename || (data.md5 ? `${data.md5}.jpg` : null);
        if (fileName) {
          yield {
            type: elType,
            fileName,
            localPath: "",
            // 空路径，copyResourceFileStream 会从 ResourceHandler 目录查找
            url: data.url
          };
        }
      }
    }
  }
  /**
   * 更新HTML文件中的元数据注释
   */
  async updateMetadata(messageCount) {
    try {
      const content = await fsp.readFile(this.options.outputPath, "utf8");
      const metadataRegex = /<!-- QCE_METADATA: \{[^}]+\} -->/;
      const match = content.match(metadataRegex);
      if (match) {
        const metadataStr = match[0].match(/\{[^}]+\}/)?.[0];
        if (metadataStr) {
          const metadata = JSON.parse(metadataStr);
          metadata.messageCount = messageCount;
          const newMetadataComment = `<!-- QCE_METADATA: ${JSON.stringify(metadata).replace(/</g, "\\u003c")} -->`;
          const newContent = content.replace(metadataRegex, newMetadataComment);
          await fsp.writeFile(this.options.outputPath, newContent, "utf8");
        }
      }
    } catch (error) {
    }
  }
  async copyResourceFileStream(resource, outputDir) {
    let partial;
    try {
      let sourceAbsolutePath = "";
      let sourceExists = false;
      if (resource.localPath && resource.localPath.trim() !== "") {
        sourceAbsolutePath = this.resolveResourcePath(resource.localPath);
        sourceExists = await this.fileExists(sourceAbsolutePath);
        if (sourceExists) {
          const stat = await fsp.stat(sourceAbsolutePath);
          if (!stat.isFile() || stat.size === 0) {
            sourceExists = false;
          }
        }
      }
      if (!sourceExists && resource.fileName) {
        const typeDir2 = this.normalizeTypeDir(resource.type);
        const resourceHandlerDir = path2.join(
          this.options.resourceSourceRoot || path2.join(process.env["USERPROFILE"] || process.cwd(), ".qq-chat-exporter", "resources"),
          typeDir2
        );
        if (await this.fileExists(resourceHandlerDir)) {
          const files = await fsp.readdir(resourceHandlerDir);
          const baseName = resource.fileName.toLowerCase();
          const matchedFiles = files.filter((f) => {
            const fLower = f.toLowerCase();
            return fLower === baseName || fLower.endsWith("_" + baseName);
          });
          const matchedFile = matchedFiles.length === 1 ? matchedFiles[0] : void 0;
          if (matchedFile) {
            sourceAbsolutePath = path2.join(resourceHandlerDir, matchedFile);
            sourceExists = await this.fileExists(sourceAbsolutePath);
          }
        }
      }
      if (!sourceExists) {
        if (resource.localPath) this.recordCopyFailure(resource, "source-missing");
        return null;
      }
      const typeDir = this.normalizeTypeDir(resource.type);
      const targetRelativePath = path2.join("resources", typeDir, resource.fileName);
      const targetAbsolutePath = path2.join(outputDir, targetRelativePath);
      const exists = await this.fileExists(targetAbsolutePath);
      if (exists) {
        const stat = await fsp.stat(targetAbsolutePath);
        if (!stat.isFile() || stat.size === 0) {
          this.recordCopyFailure(resource, "copy-failed");
          return null;
        }
        this.mediaCopyFailures.delete(mediaExportKey(resource.type, resource));
        return targetRelativePath.replace(/\\/g, "/");
      }
      await fsp.mkdir(path2.dirname(targetAbsolutePath), { recursive: true });
      partial = path2.join(path2.dirname(targetAbsolutePath), ".qce-copy-" + randomUUID() + ".partial");
      await pipeline(
        fs.createReadStream(sourceAbsolutePath),
        fs.createWriteStream(partial, { flags: "wx", mode: 384 })
      );
      if ((await fsp.stat(partial)).size !== (await fsp.stat(sourceAbsolutePath)).size) throw new Error("\u5BFC\u51FA\u5A92\u4F53\u526F\u672C\u5927\u5C0F\u4E0D\u4E00\u81F4");
      try {
        await fsp.link(partial, targetAbsolutePath);
      } catch (error) {
        if (error.code === "EEXIST") {
          const stat = await fsp.stat(targetAbsolutePath);
          if (!stat.isFile() || stat.size === 0) throw error;
        } else await fsp.copyFile(partial, targetAbsolutePath, fs.constants.COPYFILE_EXCL);
      }
      this.mediaCopyFailures.delete(mediaExportKey(resource.type, resource));
      return targetRelativePath.replace(/\\/g, "/");
    } catch (error) {
      this.recordCopyFailure(resource, "copy-failed");
      console.error(`[ModernHtmlExporter] \u590D\u5236\u8D44\u6E90\u6587\u4EF6\u5931\u8D25:`, {
        resource,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    } finally {
      if (partial) await fsp.unlink(partial).catch(() => {
      });
    }
  }
  renderMediaElement(type, data, render) {
    const html = renderMediaState(data, type, (value) => this.escapeHtml(value)) || render();
    return decorateMediaHtml(html, type, data, (value) => this.escapeHtml(value));
  }
  recordCopyFailure(resource, code) {
    const key = mediaExportKey(resource.type, resource);
    if (key) this.mediaCopyFailures.set(key, { type: resource.type, fileName: resource.fileName, exportState: { version: 1, status: "failed", stage: "export", code } });
  }
  /** Patch already-streamed messages and later virtual/chunk insertions, without loading the full export. */
  mediaFailureScript() {
    if (!this.mediaCopyFailures.size) return "";
    const entries = [...this.mediaCopyFailures].map(([key, value]) => [key, { ...value, html: renderMediaState(value, value.type, (text) => this.escapeHtml(text)) }]);
    const json = JSON.stringify(entries).replace(/</g, "\\u003c");
    return "<script>(function(){var entries=" + json + ';window.__QCE_MEDIA_EXPORT_FAILURES=entries;var failures=new Map(entries);function patch(root){var nodes=[];if(root.matches&&root.matches("[data-media-export-key]"))nodes.push(root);if(root.querySelectorAll)nodes.push.apply(nodes,root.querySelectorAll("[data-media-export-key]"));nodes.forEach(function(node){var issue=failures.get(node.getAttribute("data-media-export-key"));if(!issue)return;var box=document.createElement("div");box.innerHTML=issue.html;node.replaceWith(box.firstChild);});}patch(document);new MutationObserver(function(records){records.forEach(function(record){record.addedNodes.forEach(patch);});}).observe(document.body,{childList:true,subtree:true});})();</script>';
  }
  normalizeTypeDir(type) {
    switch (type) {
      case "image":
        return "images";
      case "video":
        return "videos";
      case "audio":
        return "audios";
      case "file":
        return "files";
      default:
        return "files";
    }
  }
  /**
   * Issue #311: 解析资源在磁盘上的真实路径，规则与 `copyResourceFileStream`
   * 保持一致：先认 `localPath`，再退回到 ResourceHandler 默认资源目录按文件
   * 名匹配。返回 `null` 表示未找到。
   */
  async resolveResourceSourcePath(resource) {
    try {
      if (resource.localPath && resource.localPath.trim() !== "") {
        const candidate = this.resolveResourcePath(resource.localPath);
        if (await this.fileExists(candidate)) {
          const stat = await fsp.stat(candidate);
          if (!stat.isDirectory()) return candidate;
        }
      }
      if (resource.fileName) {
        const typeDir = this.normalizeTypeDir(resource.type);
        const resourceHandlerDir = path2.join(
          this.options.resourceSourceRoot || path2.join(process.env["USERPROFILE"] || process.cwd(), ".qq-chat-exporter", "resources"),
          typeDir
        );
        if (await this.fileExists(resourceHandlerDir)) {
          const files = await fsp.readdir(resourceHandlerDir);
          const baseName = resource.fileName.toLowerCase();
          const matchedFiles = files.filter((f) => {
            const fLower = f.toLowerCase();
            return fLower === baseName || fLower.endsWith("_" + baseName);
          });
          const matchedFile = matchedFiles.length === 1 ? matchedFiles[0] : void 0;
          if (matchedFile) {
            const fullPath = path2.join(resourceHandlerDir, matchedFile);
            if (await this.fileExists(fullPath)) return fullPath;
          }
        }
      }
    } catch {
    }
    return null;
  }
  /**
   * Issue #311: 把单个资源读入内存并缓存为 data URI。命中以下任一情况则跳
   * 过：缓存已存在、之前已记录过 miss、文件超过 `maxEmbedFileSizeBytes`。
   */
  async preloadDataUri(resource) {
    const key = this.dataUriCacheKey(resource);
    if (!key) return;
    if (this.dataUriCache.has(key) || this.dataUriMisses.has(key)) return;
    const sourcePath = await this.resolveResourceSourcePath(resource);
    if (!sourcePath) {
      if (resource.localPath) this.recordCopyFailure(resource, "source-missing");
      this.dataUriMisses.add(key);
      return;
    }
    try {
      const stat = await fsp.stat(sourcePath);
      const limit = this.options.maxEmbedFileSizeBytes ?? 0;
      if (limit > 0 && stat.size > limit) {
        this.dataUriMisses.add(key);
        return;
      }
      const buf = await fsp.readFile(sourcePath);
      const mime = this.guessMimeType(resource, sourcePath);
      const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
      this.dataUriCache.set(key, dataUri);
    } catch (error) {
      this.recordCopyFailure(resource, "copy-failed");
      console.error("[ModernHtmlExporter] \u8BFB\u53D6\u8D44\u6E90\u7528\u4E8E\u5185\u8054\u5931\u8D25:", {
        resource,
        error: error instanceof Error ? error.message : String(error)
      });
      this.dataUriMisses.add(key);
    }
  }
  /**
   * Issue #311: 生成稳定的资源 key，与 `renderImageElement` 等渲染路径中
   * 计算的 key 形状一致：`<typeDir>/<basename>`。
   */
  dataUriCacheKey(resource) {
    const typeDir = this.normalizeTypeDir(resource.type);
    const base = resource.localPath && resource.localPath.trim() ? path2.basename(resource.localPath) : resource.fileName || "";
    if (!base) return "";
    return `${typeDir}/${base}`;
  }
  /** Issue #311: 渲染期通过 `<typeDir>/<basename>` 查询已加载的 data URI。 */
  lookupDataUri(typeDir, fileName) {
    if (!typeDir || !fileName) return void 0;
    return this.dataUriCache.get(`${typeDir}/${fileName}`);
  }
  /**
   * Issue #311: 根据资源类型与文件扩展名推断 MIME。未识别的扩展名退回到
   * `application/octet-stream`，浏览器可在下载链接里正确处理。
   */
  guessMimeType(resource, sourcePath) {
    const ext = path2.extname(sourcePath || resource.fileName || "").toLowerCase();
    const map = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".heic": "image/heic",
      ".heif": "image/heif",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
      ".avi": "video/x-msvideo",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".amr": "audio/amr",
      ".silk": "audio/silk",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".json": "application/json",
      ".txt": "text/plain",
      ".html": "text/html"
    };
    if (ext && map[ext]) return map[ext];
    switch (resource.type) {
      case "image":
        return "image/jpeg";
      case "video":
        return "video/mp4";
      case "audio":
        return "audio/mpeg";
      default:
        return "application/octet-stream";
    }
  }
  async fileExists(p) {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  }
  /* ------------------------ 原有 HTML 片段生成（已解耦到模板） ------------------------ */
  generateStyles() {
    return `<style>
${MODERN_CSS}
</style>
`;
  }
  generateScripts() {
    const enableVirtualScroll = this.options.enableVirtualScroll !== false;
    const runtimeConfig = `<script>window.__QCE_ENABLE_VIRTUAL_SCROLL = ${enableVirtualScroll};</script>
`;
    return runtimeConfig + MODERN_SINGLE_SCRIPTS_HTML;
  }
  /**
   * 生成Toolbar（底部胶囊）
   */
  generateToolbar() {
    if (this.options.showSearchBar === false) {
      return MODERN_TOOLBAR_HTML.replace('<div class="toolbar">', '<div class="toolbar" style="display:none">');
    }
    return MODERN_TOOLBAR_HTML;
  }
  /**
   * Hero Section（左对齐，Apple风格）
   */
  generateHeader(chatInfo, stats, timeRange) {
    const currentTime = (/* @__PURE__ */ new Date()).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).replace(/\//g, "/");
    const total = typeof stats.totalMessages === "number" ? String(stats.totalMessages) : stats.totalMessages || "--";
    const range = timeRange ?? "--";
    return `<div class="hero">
        <h1 class="hero-title">${this.escapeHtml(chatInfo.name)}</h1>
        <p class="hero-subtitle">\u804A\u5929\u8BB0\u5F55</p>
        <div class="hero-meta">
            <div class="meta-item">
                <span class="meta-label">\u5BFC\u51FA\u65F6\u95F4</span>
                <span class="meta-value">${currentTime}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">\u6D88\u606F\u603B\u6570</span>
                <span class="meta-value" id="info-total">${this.escapeHtml(total)}</span>
        </div>
            <div class="meta-item">
                <span class="meta-label">\u65F6\u95F4\u8303\u56F4</span>
                <span class="meta-value" id="info-range">${this.escapeHtml(range)}</span>
                </div>
            </div>
        </div>`;
  }
  /**
   * 渲染单条消息（Apple风格带气泡角）
   */
  renderMessage(message) {
    if (this.isSystemMessage(message)) {
      const content2 = this.parseMessageContent(message);
      const dateInfo2 = this.getMessageDateInfo(message);
      const dateKey2 = dateInfo2?.key || "";
      const dateLabel2 = dateInfo2 ? this.formatDateLabel(dateInfo2.date) : "";
      let dateMarker2 = "";
      if (dateKey2 && this.lastRenderedDate !== dateKey2) {
        this.lastRenderedDate = dateKey2;
        dateMarker2 = `<div class="date-divider" data-date="${dateKey2}" data-label="${this.escapeHtml(dateLabel2)}" id="date-${dateKey2}">
                    ${this.escapeHtml(dateLabel2)}
                </div>`;
      }
      return `<div class="message-block" data-date="${dateKey2}" data-message-id="msg-${message.id}" id="msg-${message.id}">
                ${dateMarker2}
                <div class="system-message-container" style="text-align: center; margin: 12px 0;">
                    <div class="content">${content2}</div>
                    <div class="time" style="color: #999; font-size: 10px; margin-top: 2px;">${this.formatTime(message?.time)}</div>
                </div>
            </div>`;
    }
    const dateInfo = this.getMessageDateInfo(message);
    const dateKey = dateInfo?.key || "";
    const dateLabel = dateInfo ? this.formatDateLabel(dateInfo.date) : "";
    let dateMarker = "";
    if (dateKey && this.lastRenderedDate !== dateKey) {
      this.lastRenderedDate = dateKey;
      dateMarker = `<div class="date-divider" data-date="${dateKey}" data-label="${this.escapeHtml(dateLabel)}" id="date-${dateKey}">
                ${this.escapeHtml(dateLabel)}
            </div>`;
    }
    const isSelf = this.isSelfMessage(message);
    const cssClass = isSelf ? "self" : "other";
    const avatarContent = this.generateAvatarHtml(
      message?.sender?.uin,
      message?.sender?.name
    );
    const content = this.parseMessageContent(message);
    const senderUid = message?.sender?.uid || message?.sender?.uin || "";
    const senderTitle = message?.sender?.title;
    const titleHtml = senderTitle ? `<span class="sender-title">${this.escapeHtml(senderTitle)}</span>` : "";
    return `
        <div class="message-block" data-date="${dateKey}" data-message-id="msg-${message.id}">
            ${dateMarker}
            <div class="message ${cssClass}" data-date="${dateKey}" data-sender-uid="${this.escapeHtml(senderUid)}" id="msg-${message.id}">
                <div class="avatar">${avatarContent}</div>
                <div class="message-wrapper">
                    <div class="message-header">
                        ${titleHtml}<span class="sender">${this.escapeHtml(this.getDisplayName(message))}</span>
                        <span class="time">${this.formatTime(message?.time)}</span>
                    </div>
                    <div class="message-bubble">
                        <div class="content">${content}</div>
                    </div>
                </div>
            </div>
        </div>`;
  }
  isSystemMessage(message) {
    return message?.type === "system" || !!(message?.content?.elements && message.content.elements.some((el) => el?.type === "system"));
  }
  /**
   * 解析消息内容（按元素渲染）
   */
  parseMessageContent(message) {
    const elements = message?.content?.elements;
    if (!elements || elements.length === 0) {
      return `<span class="text-content">${this.escapeHtml(message?.content?.text || "[\u7A7A\u6D88\u606F]")}</span>`;
    }
    let result = "";
    for (const element of elements) {
      switch (element?.type) {
        case "text":
          result += this.renderTextElement(element.data);
          break;
        case "image":
          result += this.renderMediaElement("image", element.data, () => this.renderImageElement(element.data));
          break;
        case "audio":
          result += this.renderMediaElement("audio", element.data, () => this.renderAudioElement(element.data));
          break;
        case "video":
          result += this.renderMediaElement("video", element.data, () => this.renderVideoElement(element.data));
          break;
        case "file":
          result += this.renderMediaElement("file", element.data, () => this.renderFileElement(element.data));
          break;
        case "face":
          result += this.renderFaceElement(element.data);
          break;
        case "market_face":
          result += this.renderMarketFaceElement(element.data);
          break;
        case "reply":
          result += this.renderReplyElement(element.data);
          break;
        case "json":
          result += this.renderJsonElement(element.data);
          break;
        case "forward":
          result += this.renderForwardElement(element.data);
          break;
        case "system":
          result += this.renderSystemElement(element.data);
          break;
        case "location":
          result += this.renderLocationElement(element.data);
          break;
        default:
          const rawText = element?.data?.text || element?.data?.summary || element?.data?.content || "";
          if (rawText) result += `<span class="text-content">${this.escapeHtml(rawText)}</span>`;
      }
    }
    return result || `<span class="text-content">[\u7A7A\u6D88\u606F]</span>`;
  }
  /* ------------------------ 各类元素渲染 ------------------------ */
  renderTextElement(data) {
    const text = data?.text || "";
    return `<span class="text-content">${this.escapeHtml(text)}</span>`;
  }
  renderImageElement(data) {
    const filename = data?.filename || data?.file || data?.name || "\u56FE\u7247";
    let src = "";
    if (data?.localPath && this.isValidResourcePath(data.localPath)) {
      const baseName = path2.basename(data.localPath);
      const dataUri = this.lookupDataUri("images", baseName);
      src = dataUri || `${this.resourceBaseHref}/images/${baseName}`;
    } else if (data?.url) {
      const url = data.url;
      if (!url.startsWith("file://") && !url.startsWith("C:/") && !url.startsWith("D:/") && !url.match(/^[A-Z]:\\/)) {
        src = url;
      }
    } else if (data?.filename && this.options.includeResourceLinks) {
      const dataUri = this.lookupDataUri("images", data.filename);
      src = dataUri || `${this.resourceBaseHref}/images/${data.filename}`;
    }
    if (src) {
      return `<div class="image-content"><img src="${src}" alt="${this.escapeHtml(filename)}" loading="lazy" onclick="showImageModal(this.src)"></div>`;
    }
    return `<span class="text-content">\u{1F4F7} ${this.escapeHtml(filename)}</span>`;
  }
  renderAudioElement(data) {
    const duration = data?.duration || 0;
    const filename = data?.filename || data?.file || data?.name || "\u8BED\u97F3";
    let src = "";
    if (data?.localPath && this.isValidResourcePath(data.localPath)) {
      const baseName = path2.basename(data.localPath);
      const dataUri = this.lookupDataUri("audios", baseName);
      src = dataUri || `${this.resourceBaseHref}/audios/${baseName}`;
    } else if (data?.filename && this.options.includeResourceLinks) {
      const dataUri = this.lookupDataUri("audios", data.filename);
      src = dataUri || `${this.resourceBaseHref}/audios/${data.filename}`;
    } else if (data?.url) {
      const url = data.url;
      if (!url.startsWith("file://") && !url.startsWith("C:/") && !url.startsWith("D:/") && !url.match(/^[A-Z]:\\/)) {
        src = url;
      }
    }
    if (src) {
      const isAmr = src.startsWith("data:") ? filename.toLowerCase().endsWith(".amr") : src.toLowerCase().endsWith(".amr");
      const audioTag = `<audio src="${src}" controls class="message-audio" preload="metadata">[\u8BED\u97F3:${duration}\u79D2]</audio>`;
      const downloadLink = isAmr ? `<a href="${src}" download="${this.escapeHtml(filename)}" class="audio-download-link" title="\u6D4F\u89C8\u5668\u53EF\u80FD\u4E0D\u652F\u6301AMR\u683C\u5F0F\uFF0C\u70B9\u51FB\u4E0B\u8F7D">\u4E0B\u8F7D\u8BED\u97F3</a>` : "";
      return `<div class="audio-wrapper">${audioTag}${downloadLink}</div>`;
    }
    return `<span class="text-content">\u{1F3A4} [\u8BED\u97F3:${duration}\u79D2]</span>`;
  }
  renderVideoElement(data) {
    const filename = data?.filename || data?.file || data?.name || "\u89C6\u9891";
    let src = "";
    if (data?.localPath && this.isValidResourcePath(data.localPath)) {
      const baseName = path2.basename(data.localPath);
      const dataUri = this.lookupDataUri("videos", baseName);
      src = dataUri || `${this.resourceBaseHref}/videos/${baseName}`;
    } else if (data?.filename && this.options.includeResourceLinks) {
      const dataUri = this.lookupDataUri("videos", data.filename);
      src = dataUri || `${this.resourceBaseHref}/videos/${data.filename}`;
    } else if (data?.url) {
      const url = data.url;
      if (!url.startsWith("file://") && !url.startsWith("C:/") && !url.startsWith("D:/") && !url.match(/^[A-Z]:\\/)) {
        src = url;
      }
    }
    if (src) {
      return `<video src="${src}" controls class="message-video" preload="metadata">[\u89C6\u9891: ${this.escapeHtml(filename)}]</video>`;
    }
    return `<span class="text-content">\u{1F3AC} ${this.escapeHtml(filename)}</span>`;
  }
  renderFileElement(data) {
    const filename = data?.filename || data?.file || data?.name || "\u6587\u4EF6";
    let href = "";
    if (data?.localPath && this.isValidResourcePath(data.localPath)) {
      const baseName = path2.basename(data.localPath);
      const dataUri = this.lookupDataUri("files", baseName);
      href = dataUri || `${this.resourceBaseHref}/files/${baseName}`;
    } else if (data?.filename && this.options.includeResourceLinks) {
      const dataUri = this.lookupDataUri("files", data.filename);
      href = dataUri || `${this.resourceBaseHref}/files/${data.filename}`;
    } else if (data?.url) {
      const url = data.url;
      if (!url.startsWith("file://") && !url.startsWith("C:/") && !url.startsWith("D:/") && !url.match(/^[A-Z]:\\/)) {
        href = url;
      }
    }
    if (href) {
      return `<a href="${href}" class="message-file" download="${this.escapeHtml(filename)}">\u{1F4CE} ${this.escapeHtml(filename)}</a>`;
    }
    return `<span class="text-content">\u{1F4CE} ${this.escapeHtml(filename)}</span>`;
  }
  renderFaceElement(data) {
    const id = data?.id || data?.faceId || "";
    const name = data?.name || this.getFaceNameById(id) || `\u8868\u60C5${id}`;
    return `<span class="face-emoji">${this.escapeHtml(name)}</span>`;
  }
  /**
   * 根据QQ表情ID获取友好名称
   */
  getFaceNameById(id) {
    const faceMap = {
      "0": "/\u5FAE\u7B11",
      "1": "/\u6487\u5634",
      "2": "/\u8272",
      "3": "/\u53D1\u5446",
      "4": "/\u5F97\u610F",
      "5": "/\u6D41\u6CEA",
      "6": "/\u5BB3\u7F9E",
      "7": "/\u95ED\u5634",
      "8": "/\u7761",
      "9": "/\u5927\u54ED",
      "10": "/\u5C34\u5C2C",
      "11": "/\u53D1\u6012",
      "12": "/\u8C03\u76AE",
      "13": "/\u5472\u7259",
      "14": "/\u60CA\u8BB6",
      "15": "/\u96BE\u8FC7",
      "16": "/\u9177",
      "17": "/\u51B7\u6C57",
      "18": "/\u6293\u72C2",
      "19": "/\u5410",
      "20": "/\u5077\u7B11",
      "21": "/\u53EF\u7231",
      "22": "/\u767D\u773C",
      "23": "/\u50B2\u6162",
      "24": "/\u9965\u997F",
      "25": "/\u56F0",
      "26": "/\u60CA\u6050",
      "27": "/\u6D41\u6C57",
      "28": "/\u61A8\u7B11",
      "29": "/\u5927\u5175",
      "30": "/\u594B\u6597",
      "31": "/\u5492\u9A82",
      "32": "/\u7591\u95EE",
      "33": "/\u5618",
      "34": "/\u6655",
      "35": "/\u6298\u78E8",
      "36": "/\u8870",
      "37": "/\u9AB7\u9AC5",
      "38": "/\u6572\u6253",
      "39": "/\u518D\u89C1",
      "40": "/\u64E6\u6C57",
      "41": "/\u62A0\u9F3B",
      "42": "/\u9F13\u638C",
      "43": "/\u7CD7\u5927\u4E86",
      "44": "/\u574F\u7B11",
      "45": "/\u5DE6\u54FC\u54FC",
      "46": "/\u53F3\u54FC\u54FC",
      "47": "/\u54C8\u6B20",
      "48": "/\u9119\u89C6",
      "49": "/\u59D4\u5C48",
      "50": "/\u5FEB\u54ED\u4E86",
      "51": "/\u9634\u9669",
      "52": "/\u4EB2\u4EB2",
      "53": "/\u5413",
      "54": "/\u53EF\u601C",
      "55": "/\u83DC\u5200",
      "56": "/\u897F\u74DC",
      "57": "/\u5564\u9152",
      "58": "/\u7BEE\u7403",
      "59": "/\u4E52\u4E53",
      "60": "/\u5496\u5561",
      "61": "/\u996D",
      "62": "/\u732A\u5934",
      "63": "/\u73AB\u7470",
      "64": "/\u51CB\u8C22",
      "65": "/\u793A\u7231",
      "66": "/\u7231\u5FC3",
      "67": "/\u5FC3\u788E",
      "68": "/\u86CB\u7CD5",
      "69": "/\u95EA\u7535",
      "70": "/\u70B8\u5F39",
      "71": "/\u5200",
      "72": "/\u8DB3\u7403",
      "73": "/\u74E2\u866B",
      "74": "/\u4FBF\u4FBF",
      "75": "/\u6708\u4EAE",
      "76": "/\u592A\u9633",
      "77": "/\u793C\u7269",
      "78": "/\u62E5\u62B1",
      "79": "/\u5F3A",
      "80": "/\u5F31",
      "81": "/\u63E1\u624B",
      "82": "/\u80DC\u5229",
      "83": "/\u62B1\u62F3",
      "84": "/\u52FE\u5F15",
      "85": "/\u62F3\u5934",
      "86": "/\u5DEE\u52B2",
      "87": "/\u7231\u4F60",
      "88": "/NO",
      "89": "/OK",
      "96": "/\u8DF3\u8DF3",
      "97": "/\u53D1\u6296",
      "98": "/\u6004\u706B",
      "99": "/\u8F6C\u5708",
      "100": "/\u78D5\u5934",
      "101": "/\u56DE\u5934",
      "102": "/\u8DF3\u7EF3",
      "103": "/\u6325\u624B",
      "104": "/\u6FC0\u52A8",
      "105": "/\u8857\u821E",
      "106": "/\u732E\u543B",
      "107": "/\u5DE6\u592A\u6781",
      "108": "/\u53F3\u592A\u6781",
      "109": "/\u95ED\u773C",
      "110": "/\u6D41\u9F3B\u6D95",
      "111": "/\u60CA\u559C",
      "112": "/\u9A82\u4EBA",
      "116": "/\u7231\u60C5",
      "117": "/\u98DE\u543B",
      "118": "/\u8DF3\u8DF3",
      "120": "/\u98A4\u6296",
      "121": "/\u6004\u706B",
      "122": "/\u8F6C\u5708",
      "123": "/\u78D5\u5934",
      "124": "/\u56DE\u5934",
      "125": "/\u8DF3\u7EF3",
      "126": "/\u6295\u964D",
      "127": "/\u6FC0\u52A8",
      "128": "/\u4E71\u821E",
      "129": "/\u732E\u543B",
      "173": "/\u563F\u54C8",
      "174": "/\u6342\u8138",
      "175": "/\u5978\u7B11",
      "176": "/\u673A\u667A",
      "177": "/\u76B1\u7709",
      "178": "/\u8036",
      "179": "/\u5403\u74DC",
      "180": "/\u52A0\u6CB9",
      "181": "/\u6C57",
      "182": "/\u5929\u554A",
      "183": "/Emm",
      "184": "/\u793E\u4F1A\u793E\u4F1A",
      "185": "/\u65FA\u67F4",
      "186": "/\u597D\u7684",
      "187": "/\u6253\u8138",
      "188": "/\u54C7",
      "189": "/\u7FFB\u767D\u773C",
      "190": "/666",
      "191": "/\u8BA9\u6211\u770B\u770B",
      "192": "/\u53F9\u6C14",
      "193": "/\u82E6\u6DA9",
      "194": "/\u88C2\u5F00",
      "195": "/\u5634\u5507",
      "196": "/\u7231\u5FC3",
      "197": "/\u60CA\u559C",
      "201": "/\u751F\u6C14",
      "202": "/\u5403\u60CA",
      "203": "/\u9178\u4E86",
      "204": "/\u592A\u96BE\u4E86",
      "205": "/\u6211\u60F3\u5F00\u4E86",
      "206": "/\u53F3\u4E0A\u770B",
      "207": "/\u563F\u563F\u563F",
      "208": "/\u6342\u773C",
      "210": "/\u656C\u793C",
      "211": "/\u72D7\u5934",
      "212": "/\u5410\u820C",
      "214": "/\u54E6",
      "215": "/\u8BF7",
      "216": "/\u7741\u773C",
      "217": "/\u6572\u5F00\u5FC3",
      "218": "/\u9707\u60CA",
      "219": "/\u8BA9\u6211\u5EB7\u5EB7",
      "220": "/\u6478\u9C7C",
      "221": "/\u9B54\u9B3C\u7B11",
      "222": "/\u54E6\u54DF",
      "223": "/\u50BB\u773C",
      "224": "/\u62BD\u70DF",
      "225": "/\u7B11\u54ED",
      "226": "/\u6C6A\u6C6A",
      "227": "/\u6C57",
      "228": "/\u6253\u8138",
      "229": "/\u65E0\u8BED",
      "230": "/\u62E5\u62B1",
      "231": "/\u6478\u5934",
      "232": "/\u52A0\u6CB9",
      "233": "/\u9707\u60CA\u54ED",
      "234": "/\u6258\u816E",
      "235": "/\u6211\u9178\u4E86",
      "236": "/\u5FEB\u54ED\u4E86",
      "237": "/\u5403\u7CD6",
      "238": "/\u751F\u6C14",
      "260": "/\u62DC\u6258",
      "261": "/\u6C42\u4F60\u4E86",
      "262": "/\u597D\u7684",
      "263": "/\u6211\u60F3\u5F00\u4E86",
      "264": "/\u6BD4\u5FC3",
      "265": "/\u5575\u5575",
      "266": "/\u8E6D\u8E6D",
      "267": "/\u62CD\u624B",
      "268": "/\u4F5B\u7CFB",
      "269": "/\u559D\u5976\u8336",
      "270": "/\u5403\u7CD6",
      "271": "/Doge",
      "277": "/\u5403",
      "278": "/\u5446",
      "279": "/\u4ED4\u7EC6\u5206\u6790",
      "280": "/\u52A0\u6CB9",
      "281": "/\u5D07\u62DC",
      "282": "/\u6BD4\u5FC3",
      "283": "/\u5E86\u795D",
      "284": "/\u751F\u65E5\u5FEB\u4E50",
      "285": "/\u8214\u5C4F",
      "286": "/\u7B11\u54ED",
      "287": "/doge",
      "288": "/\u54C8\u54C8",
      "289": "/\u9178\u4E86",
      "290": "/\u6C6A\u6C6A",
      "291": "/\u54E6\u547C",
      "292": "/\u55B5\u55B5",
      "293": "/\u6C42\u62B1\u62B1",
      "294": "/\u671F\u5F85",
      "295": "/\u62DC\u6258\u4E86",
      "296": "/\u5143\u6C14\u6EE1\u6EE1",
      "297": "/\u6EE1\u5206",
      "298": "/\u574F\u7B11",
      "299": "/\u4F60\u771F\u68D2",
      "300": "/\u6536\u5230",
      "301": "/\u62D2\u7EDD",
      "302": "/\u5403\u74DC",
      "303": "/\u55EF\u54FC",
      "304": "/\u5403\u9CB8",
      "305": "/\u6C57",
      "306": "/\u65E0\u773C\u770B",
      "307": "/\u656C\u793C",
      "308": "/\u9762\u65E0\u8868\u60C5",
      "309": "/\u644A\u624B",
      "310": "/\u7075\u9B42\u51FA\u7A8D",
      "311": "/\u8111\u9614\u75BC",
      "312": "/\u6CA7\u6851",
      "313": "/\u6342\u8138\u54ED",
      "314": "/\u7B11cry",
      "315": "/\u65E0\u8BED\u51DD\u564E",
      "316": "/@\u6240\u6709\u4EBA",
      "317": "/\u88C2\u5F00",
      "318": "/\u53F9\u6C14",
      "319": "/\u6478\u9C7C",
      "320": "/\u5403",
      "321": "/\u5450",
      "322": "/\u5DE6\u770B\u770B",
      "323": "/\u53F3\u770B\u770B",
      "324": "/\u53F9\u6C14",
      "325": "/\u6211\u60F3\u5F00\u4E86",
      "326": "/\u65E0\u8BED",
      "327": "/\u95EE\u53F7",
      "328": "/\u6002",
      "329": "/\u72AC",
      "330": "/\u574F\u7B11",
      "331": "/\u559D\u5976\u8336",
      "332": "/\u5403\u74DC",
      "333": "/\u9B3C\u8138",
      "334": "/\u9707\u60CA",
      "335": "/\u563F\u563F",
      "336": "/\u6B6A\u5634",
      "337": "/\u72C2\u7B11",
      "338": "/\u563B\u563B",
      "339": "/\u6276\u5899",
      "340": "/\u6342\u8138",
      "341": "/\u594B\u6597",
      "342": "/\u767D\u773C"
    };
    return faceMap[String(id)] || `/\u8868\u60C5${id}`;
  }
  renderMarketFaceElement(data) {
    const name = data?.name || "\u5546\u57CE\u8868\u60C5";
    const url = data?.url || "";
    if (url) {
      return `<img src="${url}" alt="${this.escapeHtml(name)}" class="market-face" title="${this.escapeHtml(name)}">`;
    }
    return `<span class="text-content">[${this.escapeHtml(name)}]</span>`;
  }
  renderReplyElement(data) {
    const senderName = data?.senderName || "\u7528\u6237";
    const content = data?.content || data?.text || "\u5F15\u7528\u6D88\u606F";
    const jumpTarget = chooseReplyJumpTarget(data);
    const timeStr = formatReplyTimestamp(data?.timestamp ?? data?.time ?? null);
    const previewElements = Array.isArray(data?.previewElements) ? data.previewElements : [];
    let bodyHtml;
    if (previewElements.length > 0) {
      bodyHtml = renderReplyPreviewElements(previewElements, {
        resourceBaseHref: this.resourceBaseHref,
        escapeHtml: (s) => this.escapeHtml(s),
        lookupDataUri: (kind, baseName) => this.lookupDataUri(kind, baseName),
        getFaceName: (id) => this.getFaceNameById(id)
      });
    } else {
      let imageHtml = "";
      if (data?.imageUrl || data?.image) {
        const imgSrc = data?.imageUrl || data?.image;
        imageHtml = `<img src="${imgSrc}" class="reply-content-thumb" alt="\u5F15\u7528\u56FE\u7247">`;
      } else if (String(content).includes("[\u56FE\u7247]") && data?.elements) {
        const imgElement = data.elements.find((el) => el?.type === "image");
        if (imgElement?.data?.localPath) {
          const baseName = path2.basename(imgElement.data.localPath);
          const dataUri = this.lookupDataUri("images", baseName);
          const imgSrc = dataUri || `${this.resourceBaseHref}/images/${baseName}`;
          imageHtml = `<img src="${imgSrc}" class="reply-content-thumb" alt="\u5F15\u7528\u56FE\u7247" loading="lazy">`;
        }
      }
      bodyHtml = `${this.escapeHtml(content)}${imageHtml}`;
    }
    const dataAttr = jumpTarget ? `data-reply-to="msg-${this.escapeHtml(jumpTarget)}"` : "";
    const onClick = jumpTarget ? `onclick="scrollToMessage('msg-${this.escapeHtml(jumpTarget)}')"` : "";
    const keyboardAttrs = jumpTarget ? `role="button" tabindex="0" title="\u70B9\u51FB\u8DF3\u8F6C\u5230\u539F\u6D88\u606F" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();scrollToMessage('msg-${this.escapeHtml(jumpTarget)}')}"` : "";
    const replyClass = jumpTarget ? "reply-content reply-content-clickable" : "reply-content";
    return `<div class="${replyClass}" ${dataAttr} ${onClick} ${keyboardAttrs}>
            <div class="reply-content-header">
                <strong>${this.escapeHtml(senderName)}</strong>
                ${timeStr ? `<span class="reply-content-time">${this.escapeHtml(timeStr)}</span>` : ""}
            </div>
            <div class="reply-content-text">${bodyHtml}</div>
        </div>`;
  }
  renderJsonElement(data) {
    const title = data?.title || data?.summary || "JSON\u6D88\u606F";
    const description = data?.description || "";
    const url = data?.url || "";
    return `<div class="json-card">
            <div class="json-title">${this.escapeHtml(title)}</div>
            ${description ? `<div class="json-description">${this.escapeHtml(description)}</div>` : ""}
            ${url ? `<a href="${url}" target="_blank" class="json-url">${this.escapeHtml(url)}</a>` : ""}
        </div>`;
  }
  renderForwardInnerContent(message, depth) {
    const elements = Array.isArray(message?.content?.elements) ? message.content.elements : [];
    let result = "";
    for (const element of elements) {
      switch (element?.type) {
        case "text":
          result += this.renderTextElement(element.data);
          break;
        case "image":
          result += this.renderMediaElement("image", element.data, () => this.renderImageElement(element.data));
          break;
        case "audio":
          result += this.renderMediaElement("audio", element.data, () => this.renderAudioElement(element.data));
          break;
        case "video":
          result += this.renderMediaElement("video", element.data, () => this.renderVideoElement(element.data));
          break;
        case "file":
          result += this.renderMediaElement("file", element.data, () => this.renderFileElement(element.data));
          break;
        case "face":
          result += this.renderFaceElement(element.data);
          break;
        case "market_face":
          result += this.renderMarketFaceElement(element.data);
          break;
        case "at": {
          const name = element?.data?.name || "\u67D0\u4EBA";
          result += `<span class="at-mention">@${this.escapeHtml(name)}</span>`;
          break;
        }
        case "reply":
          result += this.renderReplyElement(element.data);
          break;
        case "json":
          result += this.renderJsonElement(element.data);
          break;
        case "forward":
          result += depth < 3 ? this.renderForwardElement(element.data, depth + 1) : `<span class="text-content">[\u5D4C\u5957\u8F6C\u53D1\u5C42\u7EA7\u8FC7\u6DF1]</span>`;
          break;
        case "system":
          result += this.renderSystemElement(element.data);
          break;
        case "location":
          result += this.renderLocationElement(element.data);
          break;
        default: {
          const rawText = element?.data?.text || element?.data?.summary || element?.data?.content || "";
          if (rawText) result += `<span class="text-content">${this.escapeHtml(rawText)}</span>`;
        }
      }
    }
    if (result) return result;
    const fallback = typeof message?.content?.text === "string" ? message.content.text : "";
    return `<span class="text-content">${this.escapeHtml(fallback || "[\u7A7A\u6D88\u606F]")}</span>`;
  }
  getForwardPreviewText(message) {
    const elements = Array.isArray(message?.content?.elements) ? message.content.elements : [];
    const raw = typeof message?.content?.text === "string" ? message.content.text : "";
    if (elements.some((element) => element?.type === "forward") && /^\[(?:转发消息|合并转发)/.test(raw.trim())) {
      return "[\u804A\u5929\u8BB0\u5F55]";
    }
    const cleaned = raw.replace(/\[(图片|视频|文件|语音):(undefined|null)?\]/g, "[$1]").replace(/\[图片:(?:[a-f0-9]{32})(?:\.[a-z0-9]+)?\]/gi, "[\u56FE\u7247]").replace(/\s+/g, " ").trim();
    if (cleaned) return cleaned;
    const labels = elements.map((element) => {
      switch (element?.type) {
        case "image":
          return "[\u56FE\u7247]";
        case "video":
          return "[\u89C6\u9891]";
        case "audio":
          return "[\u8BED\u97F3]";
        case "file":
          return `[\u6587\u4EF6: ${element?.data?.filename || element?.data?.file || "\u6587\u4EF6"}]`;
        case "face":
          return element?.data?.name || "[\u8868\u60C5]";
        case "market_face":
          return `[${element?.data?.name || "\u8868\u60C5"}]`;
        case "forward":
          return "[\u804A\u5929\u8BB0\u5F55]";
        default:
          return element?.data?.text || "";
      }
    }).filter(Boolean);
    return (labels.join(" ") || "[\u7A7A\u6D88\u606F]").replace(/\[图片:(?:[a-f0-9]{32})(?:\.[a-z0-9]+)?\]/gi, "[\u56FE\u7247]");
  }
  renderForwardMessageAvatar(sender) {
    const name = String(sender?.name || sender?.uin || sender?.uid || "\u672A\u77E5").trim() || "\u672A\u77E5";
    const firstCharacter = Array.from(name)[0] || "U";
    const rawExplicitUrl = typeof sender?.avatarUrl === "string" ? sender.avatarUrl.trim() : "";
    const explicitUrl = /^(?:https?:\/\/|data:image\/)/i.test(rawExplicitUrl) ? rawExplicitUrl : "";
    const numericId = [sender?.uin, sender?.uid].map((value) => String(value || "").trim()).find((value) => /^\d{5,14}$/.test(value));
    const avatarUrl = explicitUrl || (numericId ? `https://q1.qlogo.cn/g?b=qq&nk=${numericId}&s=100` : "");
    const fallback = `<span class="forward-message-avatar-fallback"${avatarUrl ? "" : ' style="display:inline-flex"'}>${this.escapeHtml(firstCharacter)}</span>`;
    if (!avatarUrl) {
      return `<div class="forward-message-avatar" aria-label="${this.escapeHtml(name)}\u7684\u5934\u50CF">${fallback}</div>`;
    }
    return `<div class="forward-message-avatar" aria-label="${this.escapeHtml(name)}\u7684\u5934\u50CF">
                <img src="${this.escapeHtml(avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">
                ${fallback}
            </div>`;
  }
  renderForwardElement(data, depth = 0) {
    const title = data?.title || "\u804A\u5929\u8BB0\u5F55";
    const rawSummary = typeof data?.summary === "string" ? data.summary : typeof data?.content === "string" ? data.content : "";
    const summaryLooksLikeXml = rawSummary.trim().startsWith("<") && /<\/?[a-zA-Z]/.test(rawSummary);
    const summary = summaryLooksLikeXml ? "\u67E5\u770B\u8F6C\u53D1\u6D88\u606F" : rawSummary || "\u67E5\u770B\u8F6C\u53D1\u6D88\u606F";
    const preview = data?.preview || [];
    const innerMessages = Array.isArray(data?.messages) ? data.messages : [];
    const messageCount = typeof data?.messageCount === "number" ? data.messageCount : innerMessages.length;
    let previewHtml = "";
    if (innerMessages.length > 0) {
      previewHtml = innerMessages.slice(0, 5).map((m) => {
        const name = this.escapeHtml(m?.sender?.name || (m?.sender?.uin ? String(m.sender.uin) : "\u672A\u77E5"));
        const text = this.getForwardPreviewText(m);
        const trimmed = text.length > 60 ? text.slice(0, 60) + "\u2026" : text;
        return `<div class="forward-card-line"><span class="forward-card-sender">${name}:</span> <span class="forward-card-body">${this.escapeHtml(trimmed)}</span></div>`;
      }).join("");
    } else if (Array.isArray(preview) && preview.length > 0) {
      previewHtml = preview.slice(0, 5).map((line) => {
        const text = typeof line === "string" ? line : line?.text || "";
        const trimmed = text.length > 80 ? text.slice(0, 80) + "\u2026" : text;
        return `<div class="forward-card-line"><span class="forward-card-body">${this.escapeHtml(trimmed)}</span></div>`;
      }).join("");
    } else if (!summaryLooksLikeXml && summary) {
      previewHtml = `<div class="forward-card-line"><span class="forward-card-body">${this.escapeHtml(summary)}</span></div>`;
    }
    const footerLabel = messageCount > 0 ? `\u8F6C\u53D1\u6D88\u606F \xB7 ${messageCount}\u6761` : "\u8F6C\u53D1\u6D88\u606F";
    const nestedClass = depth > 0 ? " forward-card-nested" : "";
    const summaryHtml = `<div class="forward-card-header">
                <svg class="forward-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>${this.escapeHtml(title)}</span>
            </div>
            <div class="forward-card-content">
                ${previewHtml || "\u70B9\u51FB\u67E5\u770B\u8F6C\u53D1\u7684\u804A\u5929\u8BB0\u5F55"}
            </div>`;
    if (innerMessages.length === 0) {
      return `<div class="forward-card forward-card-unavailable${nestedClass}">
                ${summaryHtml}
                <div class="forward-card-footer"><span>${this.escapeHtml(footerLabel)} \xB7 \u8BE6\u60C5\u672A\u968F\u5BFC\u51FA\u4FDD\u5B58</span></div>
            </div>`;
    }
    const detailHtml = innerMessages.map((message) => {
      const senderName = message?.sender?.name || (message?.sender?.uin ? String(message.sender.uin) : "\u672A\u77E5");
      const time = this.formatTime(message?.time || message?.timestamp);
      const content = this.renderForwardInnerContent(message, depth);
      const innerId = message?.id ? ` id="msg-${this.escapeHtml(String(message.id))}"` : "";
      return `<div class="forward-message-item"${innerId}>
                ${this.renderForwardMessageAvatar(message?.sender)}
                <div class="forward-message-main">
                    <div class="forward-message-meta">
                        <span class="forward-message-sender">${this.escapeHtml(senderName)}</span>
                        ${time ? `<time class="forward-message-time">${this.escapeHtml(time)}</time>` : ""}
                    </div>
                    <div class="forward-message-content">${content}</div>
                </div>
            </div>`;
    }).join("");
    return `<details class="forward-card forward-card-expandable${nestedClass}">
            <summary class="forward-card-summary" aria-label="\u5C55\u5F00\u6216\u6536\u8D77\u8F6C\u53D1\u7684\u804A\u5929\u8BB0\u5F55">
                ${summaryHtml}
                <div class="forward-card-footer">
                    <span>${this.escapeHtml(footerLabel)}</span>
                    <span class="forward-card-action forward-card-action-expand">\u5C55\u5F00</span>
                    <span class="forward-card-action forward-card-action-collapse">\u6536\u8D77</span>
                </div>
            </summary>
            <div class="forward-card-details">${detailHtml}</div>
        </details>`;
  }
  renderSystemElement(data) {
    const text = data?.text || data?.content || "\u7CFB\u7EDF\u6D88\u606F";
    return `<div class="system-message">${this.escapeHtml(text)}</div>`;
  }
  renderLocationElement(data) {
    const name = data?.name || "\u4F4D\u7F6E";
    const address = data?.address || "";
    const lat = data?.lat || data?.latitude || "";
    const lng = data?.lng || data?.longitude || "";
    let locationText = `\u{1F4CD} ${this.escapeHtml(name)}`;
    if (address) {
      locationText += ` - ${this.escapeHtml(address)}`;
    }
    if (lat && lng) {
      locationText += ` (${lat}, ${lng})`;
    }
    return `<span class="text-content">${locationText}</span>`;
  }
  generateFooter() {
    return MODERN_FOOTER_HTML;
  }
  /* ------------------------ Chunked：全文检索文本提取（新增） ------------------------ */
  /**
   * 提取消息的纯文本用于索引/搜索（不影响原 HTML 渲染）
   * - 仅用于 Chunked 模式 message.text 与 Bloom 建索引
   */
  extractPlainText(message) {
    const elements = message?.content?.elements;
    if (!elements || elements.length === 0) {
      return String(message?.content?.text || "");
    }
    const parts = [];
    for (const el of elements) {
      const t = el?.type;
      const d = el?.data || {};
      switch (t) {
        case "text":
          if (d?.text) parts.push(String(d.text));
          break;
        case "image":
          parts.push(`[\u56FE\u7247${d?.filename ? ":" + d.filename : ""}]`);
          break;
        case "audio":
          parts.push(`[\u8BED\u97F3${d?.duration ? ":" + d.duration + "\u79D2" : ""}]`);
          break;
        case "video":
          parts.push(`[\u89C6\u9891${d?.filename ? ":" + d.filename : ""}]`);
          break;
        case "file":
          parts.push(`[\u6587\u4EF6${d?.filename ? ":" + d.filename : ""}]`);
          break;
        case "face": {
          const id = d?.id || d?.faceId || "";
          const name = d?.name || this.getFaceNameById(id) || "";
          if (name) parts.push(String(name));
          break;
        }
        case "market_face":
          parts.push(`[${d?.name || "\u5546\u57CE\u8868\u60C5"}]`);
          break;
        case "reply":
          if (d?.content) parts.push(String(d.content));
          else if (d?.text) parts.push(String(d.text));
          else parts.push("[\u56DE\u590D]");
          break;
        case "json":
          parts.push(`${d?.title || d?.summary || "JSON"} ${d?.description || ""} ${d?.url || ""}`.trim());
          break;
        case "forward": {
          const fwdSummary = typeof d?.summary === "string" ? d.summary : "";
          const fwdSummaryLooksLikeXml = fwdSummary.trim().startsWith("<") && /<\/?[a-zA-Z]/.test(fwdSummary);
          const fwdSummaryClean = fwdSummaryLooksLikeXml ? "" : fwdSummary;
          parts.push(`${d?.title || "\u8F6C\u53D1"} ${fwdSummaryClean || d?.content || ""}`.trim());
          if (Array.isArray(d?.preview)) {
            for (const line of d.preview) {
              if (typeof line === "string" && line.trim()) parts.push(line);
            }
          }
          if (Array.isArray(d?.messages)) {
            for (const m of d.messages) {
              const name = m?.sender?.name || (m?.sender?.uin ? String(m.sender.uin) : "");
              const text = m?.content?.text || "";
              if (name) parts.push(String(name));
              if (text) parts.push(String(text));
            }
          }
          break;
        }
        case "location":
          parts.push(`${d?.name || "\u4F4D\u7F6E"} ${d?.address || ""}`.trim());
          break;
        case "system":
          parts.push(`${d?.text || d?.content || "\u7CFB\u7EDF\u6D88\u606F"}`.trim());
          break;
        default: {
          const rawText = d?.text || d?.summary || d?.content || "";
          if (rawText) parts.push(String(rawText));
        }
      }
    }
    return parts.join(" ").trim();
  }
  addTextToBloom(bloom, textLower) {
    if (!textLower) return;
    const ngrams = [2, 3];
    for (const n of ngrams) {
      if (textLower.length < n) continue;
      for (let i = 0; i <= textLower.length - n; i++) {
        bloom.add(textLower.slice(i, i + n));
      }
    }
  }
  /* ------------------------ 基础工具 ------------------------ */
  getDisplayName(message) {
    const s = message?.sender || {};
    if (s.remark) return String(s.remark);
    if (s.name) return String(s.name);
    if (s.uin) return String(s.uin);
    return s.uid || "\u672A\u77E5\u7528\u6237";
  }
  getMessageDateInfo(message) {
    const rawTimestamp = message?.timestamp;
    const date = typeof rawTimestamp === "number" ? new Date(rawTimestamp) : this.safeToDate(message?.time);
    if (!date || isNaN(date.getTime())) return null;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, date };
  }
  formatDateLabel(date) {
    const weekdays = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${weekdays[date.getDay()]}`;
  }
  isSelfMessage(message) {
    const senderUid = message?.sender?.uid;
    const senderUin = message?.sender?.uin;
    if (this.currentChatInfo?.selfUid && senderUid && senderUid === this.currentChatInfo.selfUid) {
      return true;
    }
    if (this.currentChatInfo?.selfUin && senderUin && String(senderUin) === String(this.currentChatInfo.selfUin)) {
      return true;
    }
    return false;
  }
  formatTime(time) {
    const date = this.safeToDate(time);
    if (!date) return "";
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }
  escapeHtml(text) {
    if (text == null) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  resolveResourcePath(resourcePath) {
    if (path2.isAbsolute(resourcePath)) return resourcePath;
    const resourceRoot = this.options.resourceSourceRoot || path2.join(os.homedir(), ".qq-chat-exporter", "resources");
    const resourceTypes = ["images/", "videos/", "audios/", "files/"];
    for (const type of resourceTypes) {
      if (resourcePath.startsWith(type)) {
        return path2.join(resourceRoot, resourcePath);
      }
    }
    if (resourcePath.startsWith("resources/")) {
      return path2.resolve(resourceRoot, resourcePath.substring(10));
    }
    const resourceTypeDirs = ["images", "videos", "audios", "files"];
    for (const type of resourceTypeDirs) {
      const fullPath = path2.join(resourceRoot, type, resourcePath);
      if (fs.existsSync(fullPath)) return fullPath;
    }
    return path2.resolve(resourceRoot, resourcePath);
  }
  isValidResourcePath(resourcePath) {
    if (!resourcePath || typeof resourcePath !== "string") return false;
    const trimmed = resourcePath.trim();
    const resourceTypePrefixes = ["images/", "videos/", "audios/", "files/"];
    const hasValidPrefix = resourceTypePrefixes.some((prefix) => trimmed.startsWith(prefix));
    return trimmed !== "" && (trimmed.startsWith("resources/") || hasValidPrefix || path2.isAbsolute(trimmed) || // 允许纯文件名（不含路径分隔符）
    trimmed.length > 0 && !trimmed.includes("\\") && !trimmed.includes("/"));
  }
  generateAvatarHtml(uin, name) {
    if (uin) {
      const avatarUrl = `http://q.qlogo.cn/g?b=qq&nk=${uin}&s=100`;
      const fallbackText = name ? name.charAt(0).toUpperCase() : uin.slice(-2);
      return `<img src="${avatarUrl}" alt="${this.escapeHtml(name || uin)}" onerror="this.style.display='none'; this.nextSibling.style.display='inline-flex';" />
                    <span style="display:none; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
    } else {
      const fallbackText = name ? name.charAt(0).toUpperCase() : "U";
      return `<span style="display:inline-flex; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
    }
  }
  /* ------------------------ 公共方法（供流式导出使用） ------------------------ */
  /**
   * 生成 HTML 文档头部（用于流式导出）
   */
  generateHtmlTop(chatInfo, metadata) {
    return renderTemplate(MODERN_SINGLE_HTML_TOP_TEMPLATE, {
      METADATA_JSON: JSON.stringify(metadata).replace(/</g, "\\u003c"),
      CHAT_NAME_ESC: this.escapeHtml(chatInfo.name),
      STYLES: this.generateStyles(),
      SCRIPTS: this.generateScripts(),
      TOOLBAR: this.generateToolbar(),
      HEADER: this.generateHeader(chatInfo, { totalMessages: "--" }, "--")
    });
  }
  /**
   * 生成 HTML 文档尾部（用于流式导出）
   */
  generateHtmlBottom(chatInfo, stats, exportTime) {
    const timeRangeText = "--";
    const timeRangeJs = JSON.stringify(timeRangeText);
    return renderTemplate(MODERN_SINGLE_HTML_BOTTOM_TEMPLATE, {
      FOOTER: this.generateFooter(),
      TOTAL_MESSAGES: String(stats.totalMessages),
      TIME_RANGE_JS: timeRangeJs
    });
  }
  /**
   * 渲染单条消息（公共方法，供流式导出使用）
   */
  renderMessagePublic(message) {
    return this.renderMessage(message);
  }
  /**
   * 迭代消息中的资源（公共方法，供流式导出使用）
   */
  *iterResourcesPublic(message) {
    yield* this.iterResources(message);
  }
  /**
   * 判断是否为系统消息（公共方法）
   */
  isSystemMessagePublic(message) {
    return this.isSystemMessage(message);
  }
};
function fnv1a32(str, seed) {
  let h = seed >>> 0 || 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var BloomFilter = class {
  bits;
  hashes;
  bytes;
  constructor(bits, hashes) {
    this.bits = bits >>> 0;
    this.hashes = hashes >>> 0;
    this.bytes = new Uint8Array(Math.ceil(this.bits / 8));
  }
  add(token) {
    if (!token) return;
    const h1 = fnv1a32(token, 2166136261);
    const h2 = fnv1a32(token, 2166136261 ^ 1540483477);
    for (let i = 0; i < this.hashes; i++) {
      const idx = (h1 + i * h2) % this.bits;
      const byteIndex = idx >>> 3;
      const mask = 1 << (idx & 7);
      this.bytes[byteIndex] |= mask;
    }
  }
  toBase64() {
    return Buffer.from(this.bytes).toString("base64");
  }
};
export {
  ModernHtmlExporter
};
