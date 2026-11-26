# 边缘便签（Edge Notes）

藏在 Windows 屏幕边缘的半透明便签。鼠标碰到边缘的细线，便签变成竖排标签滑出来；点标签打开，可以写文字、贴截图、列清单、设提醒。

## 功能

- 边缘细条 → 悬停展开叠瓦标签 → 点开便签（左 / 右停靠、多显示器）
- 图文混排：Ctrl+V 粘贴截图、拖入图片；双击图片全屏查看、缩放、复制、另存为
- 图片自由变换：点选图片后拖四角等比缩放（按住 Shift 自由拉伸）、拖四边单向拉伸；直接拖动图片可摆到便签任意位置；也可以嵌入文字中，靠左 / 居中 / 靠右 / 文字环绕；方向键微调，Delete 删除
- 清单：Ctrl+T 或清单按钮把当前行变成待办，回车自动延续；框选多行后点清单按钮可以一次转换（再点取消）
- 文字格式：字体、字号、加粗 / 斜体 / 下划线 / 删除线、文字颜色、高亮、项目符号 / 编号、清除格式；设置里可选便签默认字体和字号
- 提醒：快捷时间、自定义日期时间、重复（每天 / 工作日 / 每周 / 每月），三档强度；到点时边缘发光、弹出提醒卡片和 Windows 通知，可稍后 10 分钟
- 快速记录（Ctrl+Shift+Space）：识别“明早9点”“20分钟后”等时间，自动设提醒
- 全部便签窗口：全文搜索、按提醒 / 图片 / 清单 / 颜色筛选；归档与恢复；导出 Markdown
- 右键标签：颜色、重命名、钉住、移到最上、归档、删除（10 秒内可撤销）；拖动标签排序
- 设置：停靠边、显示器、展开 / 收起延迟、不透明度、标签大小、只显示色块、保持展开、深浅色主题、开机自启、自定义全局快捷键
- 数据只存在本机：`%APPDATA%\边缘便签`（notes.json + images），每天自动备份，保留 30 天

## 安装

到 [Releases](https://github.com/brainyangg-cloud/edge-notes/releases/latest) 下载 `EdgeNotes-Setup-x.y.z.exe`，双击安装（可以选择安装位置）。
第一次运行如果出现“Windows 已保护你的电脑”，点“更多信息”→“仍要运行”（安装包没有代码签名）。

## 自动更新

软件启动 15 秒后和之后每 4 小时，会去本仓库的 GitHub Releases 检查新版本，有新版本就在后台下载；
下载完成后弹出通知，点通知或托盘菜单“重启并更新”立即安装，不点的话下次退出时自动安装。
设置 → 更新 里可以手动检查，或关闭自动更新。

## 发布新版本

```bash
npm version patch          # 例如 1.0.0 → 1.0.1，会自动提交并打标签 v1.0.1
git push --follow-tags
```

推送 `v*` 标签后，GitHub Actions（`.github/workflows/release.yml`）会在 Windows 上打包安装程序并发布到 Releases，
已安装的用户随后会自动收到更新。

## 开发运行（需要 Node.js 18+）

```bash
npm install
npm start
```

打包安装程序（Windows 上）：`npm run dist`，生成 `dist/EdgeNotes-Setup-x.y.z.exe`。

## 结构

- `main.js`：主进程，负责窗口、托盘、全局快捷键、数据存储、提醒调度、备份、导出
- `updater.js`：自动更新（electron-updater + GitHub Releases）
- `preload.js`：渲染进程能调用的 API
- `renderer/edge.*`：边缘窗口（细条、标签、便签编辑器、提醒卡片）
- `renderer/capture.*`：快速记录　`manager.*`：全部便签和归档　`settings.*`：设置　`viewer.*`：看图　`welcome.*`：首次引导
- `build/icon.ico`：安装包和程序图标
