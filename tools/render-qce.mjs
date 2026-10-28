// Render the same CleanMessage schema with the existing QCE HTML exporter.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ModernHtmlExporter } from '../vendor/qce/renderer.mjs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node tools/render-qce.mjs input.json output.html');
const data = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(data.messages)) throw new Error('Missing QCE messages array');
for (const message of data.messages) {
  if (typeof message.id !== 'string' || !/^[a-zA-Z0-9:_./-]+$/.test(message.id)) throw new Error('Unsafe/non-string message ID');
}
const exporter = new ModernHtmlExporter({outputPath: resolve(destination), resourceSourceRoot: resolve(destination, '../resources'),
  includeResourceLinks: true, embedResourcesAsDataUri: false, enableVirtualScroll: data.exportOptions?.options?.enableVirtualScroll !== false});
await exporter.export(data.messages, data.chatInfo);

// Keep the shared toolbar functional without fetching the icon library online.
const paths = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="m18 6-12 12M6 6l12 12"/>', user: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  github: '<circle cx="12" cy="12" r="9"/><path d="M9 22v-4m6 4v-4M8 11h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>'
};
const iconScript = `<script>window.lucide={createIcons:function(){document.querySelectorAll('[data-lucide]').forEach(function(node){var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');['id','class','style'].forEach(function(key){if(node.hasAttribute(key))svg.setAttribute(key,node.getAttribute(key));});svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');svg.innerHTML=(${JSON.stringify(paths)})[node.getAttribute('data-lucide')]||'<circle cx="12" cy="12" r="8"/>';node.replaceWith(svg);});}};</script>`;
let html = await readFile(destination, 'utf8');
html = html.replace(/<script src="https:\/\/unpkg\.com\/lucide@latest"><\/script>/g, () => iconScript);
// Chat data and missing media stay offline. Use a local avatar when supplied,
// otherwise retain the exporter's initials fallback without a qlogo request.
html = html.replace(/(<img\b[^>]*\bsrc="https?:\/\/[^"<>]*qlogo\.cn[^"<>]*"[^>]*>)\s*<span\b([^>]*)>([^<]*)<\/span>/g,
  (whole, image, attributes, label) => {
    const uin = /[?&](?:amp;)?nk=(\d+)/.exec(image)?.[1];
    const local = uin && data.avatars?.[uin];
    if (typeof local === 'string' && /^data:image\//.test(local)) {
      return image.replace(/src="[^"]*"/, 'src="' + local + '"') + '<span' + attributes + '>' + label + '</span>';
    }
    const visible = /style="/.test(attributes)
      ? attributes.replace(/style="(?:display:\s*none;?\s*)?/, 'style="display:inline-flex;')
      : attributes + ' style="display:inline-flex"';
    return '<span' + visible + '>' + label + '</span>';
  });
await writeFile(destination, html, 'utf8');
console.log(`HTML rendered: ${destination}`);
