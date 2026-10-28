# QCE 兼容导出

从已经解密的 QQNT 本地数据库，生成与定制版 QQ Chat Exporter 插件兼容的
JSON、HTML、TXT、Excel 和 ZIP。HTML 使用现有插件
`5.5.77-scheduled-zip.42` 的渲染器源码，保留排版、夜间模式、引用预览、
引用跳转、合并记录展开和动态高度虚拟滚动。

## 支持范围

| 项目 | 本版本的行为 |
| --- | --- |
| JSON | `metadata / chatInfo / statistics / messages / exportOptions`；消息使用 `CleanMessage` 结构 |
| 媒体目录 | `resources/images`、`videos`、`audios`、`files`，JSON 使用相对路径 |
| 本地媒体 | 按消息路径、文件名、MD5 和 QQ 图片 CRC64 缓存名定位；复制图片、视频、语音、普通文件 |
| 媒体去重 | 内容 SHA-256 去重；同名而内容不同的文件不会错误合并；重复运行生成独立结果 |
| 语音 | 附带原插件所用的 silk-wasm，将 SILK 转为 WAV；同时保留 SILK 原文件 |
| 引用 | 保留字符串消息 ID 和序号；补充本地原消息或缓存中的媒体预览；可跳转到本次导出的原消息 |
| 合并转发 | 递归读取 `40900` 缓存，保留深层消息和媒体，最多 32 层 |
| TXT | 发送者、时间、内容、相对资源路径、引用和嵌套记录层级 |
| Excel | 聊天记录、统计信息、发送者统计、资源列表；资源表含失败状态与嵌套定位 |
| ZIP | 每个会话独立打包，带选定的所有格式及同一套资源；默认不另留未压缩副本 |
| 失败清单 | JSON 中保留失败标记，HTML 显示失败占位；`resources/media-report.json` 保存完整清单、时间及层级 |

这条导出通道只整理当前机器已有的本地数据。没有缓存的原图、视频、语音，
以及本地没有保存完整内容的转发卡片，会保留缺失提示；不会调用 NapCat、
登录接口或尝试从 QQ 服务器补下载。只有缩略图、哈希与原媒体不符时，
不会冒充原文件保存成功。

输出结构和阅读方式兼容，并不意味着数据库中一定具备插件在线补取到的全部数据。
数据库字段在不同 QQ 版本上可能有差异；未知元素保留原始数据并显示提示。
本次使用合成数据库和真实浏览器验证，未启动、登录或扫描用户的 QQ。

## Windows 准备

需要 Python 3.10+（兼容导出已用 3.12 验证）；HTML 与 SILK 转码需要 Node.js 18+。
发布包中已经包含 HTML 渲染器和 SILK/WASM 运行文件，普通使用不需要 `npm install`。

在项目文件夹打开 PowerShell：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
node --version
```

### 已经有解密后的数据库

将下列文件放在同一目录，例如 `E:/QQArchive/work/`：

```text
nt_msg_plain.db
group_info_plain.db       # 可选，但建议保留
profile_info_plain.db     # 可选，但建议保留
```

也可使用 `nt_msg.db`、`group_info.db`、`profile_info.db` 的文件名，前提是文件已经解密。

导出全部格式，并按会话输出 ZIP：

```powershell
.\.venv\Scripts\python.exe .\scripts\ntqq_export_qce.py `
  --src "E:/QQArchive/work/nt_msg_plain.db" `
  --media-root "E:/你的QQ数据目录/nt_qq/nt_data" `
  --outdir "E:/QQArchive/exports" `
  --formats json,html,txt,excel `
  --zip
```

`--media-root` 应指向真实媒体缓存目录，不是安装 QQ 软件的目录。
媒体分散在多个地方时可以重复提供：

```powershell
--media-root "E:/QQ数据/nt_qq/nt_data" --media-root "E:/QQ数据/FileRecv"
```

只处理指定会话及日期：

```powershell
.\.venv\Scripts\python.exe .\scripts\ntqq_export_qce.py `
  --src "E:/QQArchive/work/nt_msg_plain.db" `
  --media-root "E:/你的QQ数据目录/nt_qq/nt_data" `
  --outdir "E:/QQArchive/exports" `
  --only 123456789 `
  --since 2026-10-19 --until 2026-10-26 `
  --formats json,html,txt,excel --zip
```

时间范围为 `[since, until)`，上述例子包含 19 日零点起至 25 日全天。
这与任务“昨天／完整一周”的边界约定一致。

### 还没有解密数据库

按上游说明准备 `config.json`。扫描密钥时，对应 Windows QQ 账号需要处于已登录状态。
这些上游脚本不会由兼容导出入口自动运行，也不会自动启动第二个 QQ。

```powershell
.\.venv\Scripts\python.exe .\scripts\ntqq_key_scan.py
# 密钥成功保存后，可以正常退出 QQ。
.\.venv\Scripts\python.exe .\scripts\ntqq_decrypt.py
.\.venv\Scripts\python.exe .\scripts\ntqq_aux_decrypt.py
```

随后使用上面的兼容导出命令。也可以直接复用配置中的 `work_dir`：

```powershell
.\.venv\Scripts\python.exe .\scripts\ntqq_export.py --qce --zip
```

`config.json` 中含密钥，`work` 中含明文聊天库，均不要发送到 GitHub。

## 输出与阅读

```text
exports/
  群名/
    群名-[2026-10-19-2026-10-25]-2026-10-26_04-03-33.zip
  qce-export-index-....json
```

压缩包中：

```text
群名-[覆盖日期]-执行日期.json
群名-[覆盖日期]-执行日期.html
群名-[覆盖日期]-执行日期.txt
群名-[覆盖日期]-执行日期.xlsx
resources/
  media-report.json
  images/
  videos/
  audios/
  files/
```

群名会移除 Windows 文件名不允许的字符。覆盖日期使用实际导出消息的日期；
同批次存在同名会话时会添加会话 ID，避免混在一起。

- HTML：解压后双击打开，保持 `resources` 与 HTML 同级。
- 原有离线阅读器：可以打开此 JSON 与资源目录，也可以直接选择 ZIP。
- TXT、Excel：保存媒体位置及引用／转发层级。阅读媒体本体仍需同级资源目录。
- 不加 `--zip`：生成未压缩目录；`--zip --keep-folder` 同时保留 ZIP 与目录。
- 原包与旧导出不会被覆盖；同秒重复执行会添加后缀。

`resources/media-report.json` 的 `failures[].occurrences[]` 提供顶层消息 ID、
媒体所在消息的时间、发送者和 `tree` 嵌套路径。导出完成后的索引也会保留
`mediaFailed`，便于判断哪些会话需要补齐缓存后重新整理。

当前未增加插件界面的定时任务、失败媒体补齐按钮或历史任务管理；这些属于原插件
的任务系统。本 fork 本次提供的是本地数据库的兼容导出入口。

## 开发与验证

```powershell
npm ci --ignore-scripts
npm run build:renderer
.\.venv\Scripts\python.exe -m unittest tests.test_qce -v
npm run test:silk
$env:QCE_READER_PATH = "E:/原项目/qce-viewer/offline/qq-json-reader.html"
npm run test:browser
```

浏览器测试使用 `playwright-core` 和本机 Edge（无界面、独立临时上下文）。
可用 `QCE_BROWSER_PATH` 指定其他 Chromium；合成视频由可用的 FFmpeg 生成。
测试夹具是虚构会话，生成后自动清理，不访问真实 QQ 数据。

## 来源与许可

- 上游取钥匙、解密及旧导出器：[q957506633/qq-nt-export](https://github.com/q957506633/qq-nt-export)，保留 MIT 授权。
- HTML 渲染器：[shuakami/qq-chat-exporter](https://github.com/shuakami/qq-chat-exporter)
  及本地定制版，GPL-3.0；完整源码、构建入口与授权随仓库提供。
- 数据库字段和 QQ 图片缓存路径参考：[QQBackup/QQDecrypt](https://github.com/QQBackup/QQDecrypt)、
  [Tealina28/QQNT_Export](https://github.com/Tealina28/QQNT_Export)。
- SILK 解码：[idranme/silk-wasm](https://github.com/idranme/silk-wasm)，MIT，附带授权。

包含这些组件的兼容版整体按 GPL-3.0 分发，详见根目录 `LICENSE` 与 `vendor/qce/NOTICE.md`。
