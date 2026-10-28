# QQ Chat Exporter renderer

These TypeScript sources are copied from the user's existing custom
QQ Chat Exporter `5.5.77-scheduled-zip.42` (snapshot 2026-10-28):

- Upstream: https://github.com/shuakami/qq-chat-exporter
- Custom development: https://github.com/ZEntrosein/qq-chat-exporter
- Files: `lib/core/exporter/ModernHtmlExporter.ts`, `ModernHtmlTemplates.ts`,
  `replyRender.ts`, `replyPreviewRenderer.ts`, `lib/core/resource/MediaExportState.ts`.

Copyright shuakami and QQ Chat Exporter contributors. Distributed under GPL v3;
see `LICENSE` here and at the project root. Original qq-nt-export code remains
available under its MIT license in `LICENSE-MIT-UPSTREAM`.

`renderer.mjs` is generated from these included sources by
`node tools/build-qce-renderer.mjs`. The adapter calls the existing HTML exporter;
it does not load NapCat, QQ, an API server or a login session.

`tools/render-qce.mjs` replaces the remote icon loader with local SVGs and
uses local avatar data (or the initials fallback) instead of remote qlogo loads.
The renderer retains the original layout, theme, reply previews, nested forwards
and dynamic-height virtual scrolling.

Small fork-local corrections: escaped metadata comments; escaped search highlights;
system messages keep a `.content` wrapper so initialization/filtering retains them,
and the displayed count includes these system records; nested forwarded records
have stable DOM IDs and quote navigation opens their parent cards. These do not change the
source plugin or its running installation.
