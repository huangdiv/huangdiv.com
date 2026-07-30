# 黄笛的博客 - Code Wiki 完整文档

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [项目架构与目录结构](#3-项目架构与目录结构)
4. [核心配置详解](#4-核心配置详解)
5. [内容组织系统](#5-内容组织系统)
6. [布局模板系统](#6-布局模板系统)
7. [数据与静态资源](#7-数据与静态资源)
8. [功能模块详解](#8-功能模块详解)
9. [CI/CD 与部署流程](#9-cicd-与部署流程)
10. [项目运行方式](#10-项目运行方式)
11. [扩展与自定义指南](#11-扩展与自定义指南)
12. [许可协议](#12-许可协议)

---

## 1. 项目概述

### 1.1 项目简介

本项目是 **黄笛的个人博客**（https://huangdiv.com），基于 [Hugo](https://gohugo.io/) 静态网站生成器构建，使用 [MemE](https://github.com/reuixiy/hugo-theme-meme) 主题，通过 GitHub Actions 自动部署到 GitHub Pages。

### 1.2 作者信息

- **姓名**: 黄笛
- **身份**: 中学物理教师 / 业余程序员 / 生活探险家
- **邮箱**: i@huangdiv.com
- **网站**: https://huangdiv.com
- **GitHub**: https://github.com/huangdiv

### 1.3 博客内容定位

博客主要涵盖三大内容板块：
- **教育** (`/edu/`): 教育教学笔记、给家长的建议等
- **技术** (`/tech/`): 编程学习、用户脚本、工具分享等
- **生活** (`/life/`): 个人随想、年终总结、生活感悟

### 1.4 关键特性

| 特性 | 说明 |
|------|------|
| 静态站点 | 基于 Hugo 生成，速度快、安全性高 |
| MemE 主题 | 高度定制化的中文博客主题 |
| Waline 评论 | 集成 Waline 评论系统（后端部署在 comments.huangdiv.com） |
| 深/浅色模式 | 支持主题切换，系统偏好自动适配 |
| Atom/RSS 订阅 | 提供多种订阅方式 |
| SEO 优化 | JSON-LD、Open Graph、Twitter Cards |
| Service Worker | 支持 PWA 离线访问 |
| 自动部署 | GitHub Actions 一键构建部署 |

---

## 2. 技术栈与依赖

### 2.1 核心技术

| 技术 | 版本/说明 | 用途 |
|------|-----------|------|
| [Hugo](https://gohugo.io/) | Extended 版本 | 静态网站生成器 |
| [MemE Theme](https://github.com/reuixiy/hugo-theme-meme) | Git Submodule | 博客主题 |
| [Waline](https://waline.js.org/) | v3 | 评论系统前端/后端 |
| [Goldmark](https://github.com/yuin/goldmark) | Hugo 内置 | Markdown 渲染器 |
| [GitHub Actions](https://github.com/features/actions) | - | CI/CD 自动化 |
| [GitHub Pages](https://pages.github.com/) | - | 静态托管 |

### 2.2 前端库（CDN 加载）

| 库 | 版本 | 用途 | 来源 |
|----|------|------|------|
| Noto Serif SC | - | 中文衬线字体 | Google Fonts |
| Source Code Pro | - | 代码等宽字体 | Google Fonts |
| medium-zoom | latest | 图片缩放 | jsDelivr CDN |
| instant.page | 5.1.0 | 预加载加速 | jsDelivr CDN |
| clipboard-polyfill | 2.8.6 | 剪贴板复制 | jsDelivr CDN |
| Waline Client | v3 | 评论系统前端 | unpkg CDN |

### 2.3 Git 子模块

```toml
# .gitmodules
[submodule "themes/meme"]
    path = themes/meme
    url = https://github.com/reuixiy/hugo-theme-meme.git
```

---

## 3. 项目架构与目录结构

### 3.1 完整目录树

```
/workspace/
├── .github/
│   └── workflows/
│       └── build.yml                  # GitHub Actions 构建部署配置
├── archetypes/
│   └── default.md                     # 新文章模板（Front Matter 模板）
├── content/                           # 内容目录（所有文章 Markdown）
│   ├── about/
│   │   └── _index.md                  # 关于页面
│   ├── edu/
│   │   ├── _index.md                  # 教育分区首页
│   │   ├── 教育之32条.md
│   │   └── 寒假来了-给家长的建议.md
│   ├── life/
│   │   ├── _index.md                  # 生活分区首页
│   │   ├── 2020.md                    # 草稿
│   │   ├── 三十而立.md
│   │   └── 你何时睡觉.md
│   ├── tags/
│   │   └── _index.md                  # 标签云页面
│   └── tech/
│       ├── _index.md                  # 技术分区首页
│       └── 河南专技在线辅助.md
├── data/                              # 数据文件目录
│   ├── SVG.toml                       # 自定义 SVG 图标（Brand + 菜单项）
│   └── Socials.toml                   # 社交链接配置
├── layouts/                           # 布局模板覆盖目录
│   └── partials/
│       ├── components/
│       │   └── comments.html          # 评论组件（多评论系统支持）
│       └── custom/
│           ├── script.html            # 自定义脚本加载（Waline 初始化）
│           └── waline.html            # Waline 评论具体实现
├── static/                            # 静态资源目录（原样复制到输出）
│   ├── icons/
│   │   ├── android-chrome-512x512.png
│   │   ├── apple-touch-icon.png
│   │   ├── mstile-150x150.png
│   │   └── safari-pinned-tab.svg
│   ├── CNAME                          # 自定义域名配置
│   ├── favicon.ico
│   ├── jumpto.html                    # 超级书签工具页面
│   ├── manifest.json                  # PWA 应用清单
│   ├── robots.txt                     # 搜索引擎爬虫规则
│   └── seats-generator.html           # 班级座位表管理工具
├── themes/
│   └── meme/                          # MemE 主题（Git Submodule）
├── .gitignore                         # Git 忽略规则
├── .gitmodules                        # Git 子模块配置
├── .hugo_build.lock                   # Hugo 构建锁文件
├── LICENSE                            # CC BY-NC-SA 4.0 许可协议
├── README.md                          # 项目说明
└── config.toml                        # Hugo 主配置文件
```

### 3.2 架构设计原理

```
                    ┌─────────────────────┐
                    │   config.toml       │  全局配置
                    └─────────┬───────────┘
                              │
┌──────────┐    ┌─────────────▼─────────────┐    ┌──────────────┐
│  content/ │───▶│        Hugo 引擎         │◀───│  themes/meme │
│ Markdown  │    │  (Goldmark 渲染 + 模板)   │    │  MemE 主题   │
└──────────┘    └─────────────┬─────────────┘    └──────────────┘
                              │
                    ┌─────────▼───────────┐
                    │   layouts/ 覆盖     │  自定义模板
                    └─────────┬───────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
┌─────────▼────────┐ ┌────────▼─────────┐ ┌───────▼──────────┐
│   data/ 数据     │ │  static/ 静态     │ │  archetypes/ 模板 │
│  (SVG + Socials) │ │  (资源 + 工具页)  │ │  (新文章默认值)  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
                              │
                    ┌─────────▼───────────┐
                    │   GitHub Actions    │  自动构建部署
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │  GitHub Pages + CDN │  生产环境
                    └─────────────────────┘
```

---

## 4. 核心配置详解

文件: [config.toml](file:///workspace/config.toml)

### 4.1 站点基础配置 (L1-L57)

| 配置项 | 值 | 说明 |
|--------|----|------|
| `baseURL` | `https://huangdiv.com/` | 站点根 URL |
| `title` | `黄笛的博客` | 站点标题 |
| `languageCode` | `zh-CN` | 语言代码 |
| `hasCJKLanguage` | `true` | 启用中日韩语言支持（影响字数统计） |
| `theme` | `meme` | 使用 MemE 主题 |
| `copyright` | CC BY-NC-SA 4.0 | 版权信息，支持 Markdown |
| `defaultContentLanguage` | `zh-cn` | 默认内容语言 |
| `summaryLength` | `42` | 摘要字数限制（词） |
| `enableGitInfo` | `true` | 启用 Git 版本信息（lastmod 等） |
| `enableRobotsTXT` | `true` | 自动生成 robots.txt |
| `pagerSize` | `5` | 每页显示文章数 |

### 4.2 分类系统配置 (L53-L57)

```toml
[taxonomies]
    category = "categories"
    tag = "tags"
```

Hugo 内置两种分类法：Category（部类）和 Tag（标签）。但实际使用中，本博客采用 **分区（Sections）** 方式进行树状分类。

### 4.3 Markdown 渲染配置 (L68-L97)

Markdown 处理器使用 Goldmark，主要配置：
- 支持定义列表、脚注、删除线、表格、任务列表
- 自动标题 ID（GitHub 风格）
- 允许不安全的 HTML（`unsafe = true`，用于嵌入代码等）
- 代码高亮使用 Chroma，带行号，使用 CSS 类而非内联样式

### 4.4 相关文章配置 (L103-L117)

```toml
[related]
    threshold = 80
    [[related.indices]]
        name = "categories"  weight = 100
    [[related.indices]]
        name = "tags"        weight = 95
    [[related.indices]]
        name = "date"        weight = 10   pattern = "2006"
```

基于分类(100权重)、标签(95权重)、年份(10权重)计算相关文章，阈值80。

### 4.5 菜单配置 (L182-L235)

| 菜单项 | URL | 权重 | 图标 |
|--------|-----|------|------|
| 教育 | `/edu/` | 2 | edu |
| 技术 | `/tech/` | 3 | tech |
| 生活 | `/life/` | 4 | life |
| 标签 | `/tags/` | 5 | tags |
| 网盘 | `https://pan.huangdiv.com` | 6 | pan（外链） |
| 关于 | `/about/` | 7 | user-circle |
| 主题切换 | - | 8 | `theme-switcher`（特殊标识） |
| 语言切换 | - | 9 | `lang-switcher`（特殊标识） |

### 4.6 作者信息 (L1501-L1515)

```toml
[params.author]
    name = "黄笛"
    email = "i@huangdiv.com"
    motto = "黄笛，中学物理老师，业余程序员，生活探险家"
    avatar = "/icons/apple-touch-icon.png"
    website = "https://huangdiv.com"
    twitter = "huangdiv"
    fediverse = "@huangdiv@mastodon.social"
```

### 4.7 评论系统配置 (L607-L733)

当前启用 **Waline** 评论系统，配置了多个评论系统的支持框架：

| 系统 | 启用状态 | 说明 |
|------|----------|------|
| Waline | ✅ 启用 | `serverURL: https://comments.huangdiv.com` |
| Disqus | ❌ 未启用 | 需配置 shortname |
| Valine | ❌ 未启用 | 已配置 AppId/AppKey（旧版） |
| Utterances | ❌ 未启用 | 基于 GitHub Issues |
| Gitalk | ❌ 未启用 | 基于 GitHub Issues |
| Giscus | ❌ 未启用 | 基于 GitHub Discussions |
| Remark42 | ❌ 未启用 | 自建评论系统 |

### 4.8 字体与排版配置 (L998-L1120)

- 正文字体: `'Noto Serif SC', serif`（思源宋体）
- 代码字体: `'Source Code Pro', 'Noto Serif SC', monospace`
- 标题字体: `'Noto Serif SC', serif`
- 基础字号: 18px
- 行高: 2
- 段首缩进: 开启
- 两端对齐: 开启
- 中文着重号: 开启（语法 `..文本..`）
- 中文标点纠正: 开启

---

## 5. 内容组织系统

### 5.1 内容分区（Sections）

博客使用 Hugo 的 Sections 机制进行内容组织，对应 `content/` 下的一级子目录：

| 分区 | 路径 | 配置文件 | 内容说明 |
|------|------|----------|----------|
| 关于 | `content/about/` | [_index.md](file:///workspace/content/about/_index.md) | 个人介绍页 |
| 教育 | `content/edu/` | [_index.md](file:///workspace/content/edu/_index.md) | 教育类文章 |
| 生活 | `content/life/` | [_index.md](file:///workspace/content/life/_index.md) | 生活随想类 |
| 技术 | `content/tech/` | [_index.md](file:///workspace/content/tech/_index.md) | 技术分享类 |
| 标签 | `content/tags/` | [_index.md](file:///workspace/content/tags/_index.md) | 标签云汇总页 |

主分区配置 (`mainSections`):
```toml
mainSections = ["edu", "life", "tech"]
```

### 5.2 Front Matter 模板

文件: [archetypes/default.md](file:///workspace/archetypes/default.md)

使用 `hugo new` 创建新文章时的默认模板：

```toml
+++
title = "{{ replace .Name "-" " " | title }}"  # 标题：从文件名自动生成
date = "{{ .Date }}"                             # 日期：自动填充当前时间
tags = ["", ""]                                  # 标签数组
slug = ""                                        # URL 别名
+++
```

### 5.3 文章 Front Matter 字段详解

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `title` | string | 文章标题（必选） | `"教育之32条"` |
| `date` | datetime | 发布时间 | `2022-10-20` |
| `slug` | string | 自定义 URL 片段 | `"32-suggestions-for-education"` |
| `subtitle` | string | 副标题/摘要 | `"2019年终总结..."` |
| `description` | string | SEO 描述（优先级最高） | `"专业技术人员继续教育..."` |
| `tags` | []string | 标签数组 | `["建议", "寒假"]` |
| `draft` | bool | 是否为草稿（默认false） | `true` |
| `toc` | bool | 是否显示目录 | `true` |
| `dropcap` | bool | 首字下沉 | `true` |
| `dropCapAfterHr` | bool | 分隔线后首字下沉 | `true` |
| `meta` | bool | 是否显示文章元信息 | `true` |
| `comments` | bool | 是否开启评论 | `true` |
| `displayCopyright` | bool | 是否显示版权信息 | `false` |
| `badge` | bool | 是否显示更新徽章 | `false` |
| `gitinfo` | bool | 是否显示 Git 信息 | `true` |
| `indentFirstParagraph` | bool | 首段是否缩进 | `false` |
| `original` | bool | 是否原创（影响版权） | `true` |

### 5.4 文章示例分析

#### 示例1: 教育类文章
文件: [教育之32条.md](file:///workspace/content/edu/教育之32条.md)
- 无 slug：URL 自动生成为 `/edu/教育之32条/`
- 启用首字下沉和元信息

#### 示例2: 技术类文章
文件: [河南专技在线辅助.md](file:///workspace/content/tech/河南专技在线辅助.md)
- 自定义 slug：URL 为 `/tech/ghlearning-assist/`
- 配置了自定义 description 用于 SEO
- 启用目录 (`toc: true`)
- 使用 `<!--more-->` 标记摘要截断位置
- 包含完整代码块（JavaScript）

#### 示例3: 草稿文章
文件: [2020.md](file:///workspace/content/life/2020.md)
- `draft: true`：不会在生产构建中出现

### 5.5 内容写作规范

1. **Markdown 语法**: 使用标准 CommonMark + Hugo 扩展
2. **摘要截断**: 使用 `<!--more-->` 标记（无空格）
3. **脚注**: 使用 `[^id]` 语法，返回符号为 `↩`
4. **着重号**: MemE 自定义语法 `..需要着重的文本..`
5. **自定义链接引用**: 文末使用 `[id]: url` 引用式链接
6. **代码高亮**: 使用三反引号围栏，指定语言

---

## 6. 布局模板系统

### 6.1 Hugo 模板查找机制

Hugo 采用主题模板 + 站点覆盖的机制，查找优先级：
1. `layouts/` （项目根目录，本项目自定义）
2. `themes/meme/layouts/` （主题默认模板）

本项目通过在 `layouts/` 下创建同名文件来 **覆盖或扩展** 主题模板。

### 6.2 自定义布局文件清单

| 文件 | 路径 | 作用 |
|------|------|------|
| comments.html | [layouts/partials/components/comments.html](file:///workspace/layouts/partials/components/comments.html) | 多评论系统容器组件 |
| script.html | [layouts/partials/custom/script.html](file:///workspace/layouts/partials/custom/script.html) | 页面底部自定义脚本加载入口 |
| waline.html | [layouts/partials/custom/waline.html](file:///workspace/layouts/partials/custom/waline.html) | Waline 评论系统具体实现 |

### 6.3 comments.html 组件详解 (L1-L39)

```
触发条件:
  1. 文章级 comments 参数 OR 全局 enableComments = true
  2. hugo.Environment == "production"（仅生产环境）
  3. 文章属于 mainSections OR 显式开启了 comments

渲染流程:
  ├─ 非 autoLoadComments 模式 → 渲染「加载评论」按钮
  ├─ enableDisqus → #disqus_thread 容器
  ├─ enableWaline → #walineComments 容器 ← 当前启用
  ├─ enableValine → #vcomments 容器
  ├─ enableUtterances → #utterances 容器
  ├─ enableGitalk → #gitalk-container 容器
  ├─ enableGiscus → #giscus 容器
  └─ enableRemark42 → #remark42 容器
```

### 6.4 script.html 脚本加载入口 (L1-L7)

作为主题自定义脚本钩子，按以下条件加载 Waline：
1. 评论开关开启
2. 生产环境
3. 文章属于主分区或显式开评论
4. `enableWaline = true`

符合条件时加载 `custom/waline.html` 部分。

### 6.5 waline.html 实现详解 (L1-L15)

```html
<!-- 1. 加载 Waline 样式 -->
<link rel="stylesheet" href="https://unpkg.com/@waline/client@v3/dist/waline.css" />

<script type="module">
    // 2. ES Module 方式导入 Waline
    import { init } from 'https://unpkg.com/@waline/client@v3/dist/waline.js';

    function loadComments() {
        if (document.getElementById('walineComments')) {
            init({
                el: '#walineComments',                      // 挂载容器
                serverURL: "https://comments.huangdiv.com",  // Waline 服务端
                dark: 'html[data-theme="dark"]'              // 深色模式选择器
            });
        }
    }
    window.loadComments = loadComments;  // 暴露到全局供按钮触发
</script>
```

**设计要点**:
- 使用 ES Module (type="module") 而非传统脚本标签
- `window.loadComments` 暴露函数：配合「加载评论」按钮实现按需加载（`autoLoadComments = false`）
- `dark` 参数自动适配 MemE 主题的深/浅色模式切换

---

## 7. 数据与静态资源

### 7.1 数据文件 (data/)

#### 7.1.1 SVG.toml - 图标配置
文件: [data/SVG.toml](file:///workspace/data/SVG.toml)

Hugo 数据文件可以按 key 覆盖主题的同名配置。本项目覆盖以下 SVG 图标：

| Key | 用途 | 来源 |
|-----|------|------|
| `brand` | 站点品牌 Logo（顶栏左侧） | 自定义 Inkscape 设计的心形图案 |
| `edu` | 教育菜单图标 | Font Awesome（学院/黑板图标） |
| `tech` | 技术菜单图标 | Font Awesome（代码图标） |
| `life` | 生活菜单图标 | Font Awesome（咖啡/生活图标） |
| `pan` | 网盘菜单图标 | Font Awesome（云盘图标） |

**SVG 规范**:
- 必须包含 `class="brand"`（品牌）或 `class="icon"`（菜单图标）
- 使用 `viewBox` 而非固定宽高以便缩放
- 品牌图尺寸: 30x30px (`siteBrandSVGWidth/Height`)

#### 7.1.2 Socials.toml - 社交链接配置
文件: [data/Socials.toml](file:///workspace/data/Socials.toml)

| ID | 链接 | 图标 | 权重 |
|----|------|------|------|
| rss | `/rss.xml` | rss | 1 |
| email | `mailto:i@huangdiv.com` | envelope | 2 |
| github | `https://github.com/huangdiv` | github | 3 |
| x | `https://x.com/huangdiv` | x | 4 |
| telegram | `https://t.me/huangdiv` | telegram | 5 |
| linkedin | `https://linkedin.com/in/huangdiv` | linkedin | 6 |

通过 `enableSocials = true` 开启后，社交链接显示在页脚。

### 7.2 静态资源 (static/)

#### 7.2.1 站点图标 (PWA + Favicon)

| 文件 | 尺寸/用途 |
|------|-----------|
| [favicon.ico](file:///workspace/static/favicon.ico) | 浏览器标签页图标 |
| [apple-touch-icon.png](file:///workspace/static/icons/apple-touch-icon.png) | iOS 添加到主屏图标，也用作 avatar/siteLogo |
| [android-chrome-512x512.png](file:///workspace/static/icons/android-chrome-512x512.png) | Android PWA 图标 |
| [mstile-150x150.png](file:///workspace/static/icons/mstile-150x150.png) | Windows 磁贴图标 |
| [safari-pinned-tab.svg](file:///workspace/static/icons/safari-pinned-tab.svg) | Safari 固定标签页图标 |
| [manifest.json](file:///workspace/static/manifest.json) | PWA 应用清单 (standalone 模式) |

#### 7.2.2 PWA Manifest 配置
```json
{
    "name": "HuangDi's Blog",
    "short_name": "HD Blog",
    "theme_color": "#fff",
    "background_color": "#fff",
    "display": "standalone",
    "orientation": "portrait-primary",
    "start_url": "./?utm_source=homescreen"
}
```

#### 7.2.3 robots.txt
文件: [robots.txt](file:///workspace/static/robots.txt)

```
User-agent: *
Disallow: /uploads/
Sitemap: https://huangdiv.com/sitemap.xml
```

配合 `enableRobotsTXT = true`，Hugo 会合并主题默认 robots 和此配置。

#### 7.2.4 CNAME - 自定义域名
```
huangdiv.com
```

使 GitHub Pages 启用自定义域名，同时需要 DNS 配置 CNAME/A 记录指向 GitHub Pages。

---

### 7.3 独立工具页面

博客在 `static/` 下部署了两个独立的纯前端工具页面，不经过 Hugo 模板渲染：

#### 7.3.1 jumpto.html - 超级书签工具
文件: [jumpto.html](file:///workspace/static/jumpto.html)

**功能**: 提供一系列 JavaScript 书签（Bookmarklet），用户拖动到书签栏即可在任意网页使用。

**内置书签列表**:
| 功能 | 实现原理 |
|------|----------|
| 🔓 解除复制限制 (4个版本) | 覆盖 copy/cut/contextmenu/selectstart 等事件 |
| 📑 网页自由编辑 | 切换 `document.body.contenteditable` |
| 🛒 历史价格查询 | 跳转到 hisprice.cn 查询 |
| 🌗 夜间模式 | 注入 CSS 覆盖页面为深色 |
| ⏸ 网页分屏 | Frameset 左右并排当前页和输入网址 |
| ✒️ 字体查询 | 加载 fount.js 识别字体 |
| 📽️ VIP视频解析 (2个) | 跳转到视频解析接口 |
| 🔑 显示星号密码 | 转换 password input 为 text |
| 🔍 Crx搜搜 | Chrome/Edge 扩展离线安装下载 |
| 📏 网页标注 | 加载 spacing.js 标注间距 |
| 🌸 采集到花瓣 | 加载花瓣网采集脚本 |
| 📝 临时编辑器 | data URI 打开可编辑空白 HTML |

**附加功能**: URL Query 参数跳转
- 访问 `/jumpto.html?https://example.com` 会自动正则匹配并 302 跳转

#### 7.3.2 seats-generator.html - 班级座位表管理工具
文件: [seats-generator.html](file:///workspace/static/seats-generator.html)

**功能概述**: 面向教师的班级座位管理 Web 应用，纯前端实现（localStorage 存储）。

**核心功能模块**:
1. **班级管理**: 创建/切换/删除多个班级配置
2. **座位布局**:
   - 行列数配置（座位尺寸 CSS 变量: `--seat-width/height`）
   - 讲台位置（上下左右）
   - 过道设置
3. **学生管理**:
   - 批量导入学生姓名
   - 拖动调整座位
   - 随机排座（可锁定学生）
4. **签到功能**:
   - 点击座位标记出席/缺席/迟到
   - 签到统计
   - 导出签到记录
5. **数据持久化**: localStorage 保存
6. **导出**: 支持导出图片 / CSV / 打印

**UI 设计系统** (CSS 变量定义，L15-L41):
```css
--primary: #3b82f6;        /* 主色 - 蓝色 */
--success: #10b981;        /* 成功 - 绿色 */
--warning: #f59e0b;        /* 警告 - 橙色 */
--danger:  #ef4444;        /* 危险 - 红色 */
--radius-sm/md/lg          /* 圆角分级 6/10/14px */
--shadow-sm/md/lg          /* 阴影分级 */
```

---

## 8. 功能模块详解

### 8.1 首页系统 (Home Layout)

配置项: `homeLayout = "posts"`（文章摘要布局）

MemE 支持四种首页布局：
1. **poetry** (诗意人生): 展示诗句（`homePoetry` 配置）
2. **footage** (视频片段): 全屏视频首页
3. **posts** (文章摘要): ✅ 当前使用 - 显示最新5篇文章摘要
4. **page** (普通页面): 自定义静态首页

### 8.2 订阅系统 (Atom & RSS)

**输出配置**:
```toml
home = ["HTML", "SectionsAtom", "SectionsRSS"]
[services.rss]
    limit = -1  # 无限制文章数
```

**订阅地址**:
- Atom: https://huangdiv.com/atom.xml
- RSS: https://huangdiv.com/rss.xml

**自定义 Feed 页脚** (feedFooter):
```
> 阅读原文：<{{ .Permalink }}>  
> 博客公告：博客现已开通邮件订阅，欢迎[通过 Substack 订阅](...)支持我的创作！
```

### 8.3 深色模式系统

| 配置项 | 值 | 说明 |
|--------|----|------|
| `enableDarkMode` | true | 启用功能 |
| `defaultTheme` | light | 默认浅色 |
| `overrideSystemPreferences` | false | 不强制覆盖系统偏好 |
| `hideThemeToggle` | false | 显示切换按钮 |

**实现原理**:
- MemE 主题通过 `data-theme` 属性切换
- Waline 评论同步适配: `dark: 'html[data-theme="dark"]'`
- 主题色 (HSL):
  - 浅色主色: `220, 90%, 56%`
  - 深色主色: `201, 65%, 62%`

### 8.4 SEO 优化模块

```toml
jsonLD = true           # 结构化数据 (Google 结构化数据测试工具)
openGraph = true        # Facebook/LinkedIn 社交卡片
twitterCards = true     # Twitter 卡片 (需配合 openGraph)
autoDetectImages = true # 自动探测文章首图作为社交卡片图
```

**Twitter 配置**: `siteTwitter = "huangdiv"`

### 8.5 代码高亮与复制

| 功能 | 配置 |
|------|------|
| 代码高亮引擎 | Chroma (Hugo 内置) |
| 行号 | 显示，表格形式 (`lineNumbersInTable`) |
| CSS 类模式 | `noClasses = false`（使用外部 CSS 而非内联样式） |
| 最大高度 | 20em，超出滚动 (`enableOverflowY = true`) |
| 复制按钮 | 开启，自动隐藏 (`enableCopy + enableCopyAutoHide`) |
| 依赖库 | clipboard-polyfill@2.8.6 |

### 8.6 性能优化模块

| 功能 | 说明 |
|------|------|
| `enableServiceWorker` | PWA 离线缓存（仅生产环境） |
| `enableSmoothScroll` | 浏览器平滑滚动 |
| `enableMediumZoom` | medium-zoom 图片灯箱效果 |
| `enableInstantPage` | instant.page 鼠标悬停预加载下一页 |
| `enableFingerprint` | CSS/JS 文件指纹（缓存破坏） |
| HTML 压缩 | `minify.tdewolff.html.keepWhitespace = false` |

---

## 9. CI/CD 与部署流程

### 9.1 GitHub Actions 工作流
文件: [.github/workflows/build.yml](file:///workspace/.github/workflows/build.yml)

```yaml
name: build

on:
  push:
    branches:
    - master          # 仅 master 分支推送触发

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - name: 'Building...'
      uses: reuixiy/hugo-deploy@v1      # MemE 作者提供的专用 Action
      env:
        DEPLOY_REPO: huangdiv/huangdiv.github.io   # 部署目标仓库
        DEPLOY_BRANCH: build                       # 部署目标分支
        DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}      # SSH 部署密钥
        TZ: Asia/Shanghai                          # 时区（lastmod 等）
```

### 9.2 部署架构

```
代码仓库 (源)                    部署仓库 (目标)
huangdiv/huangdiv.com      ──▶   huangdiv/huangdiv.github.io
  └─ master 分支                └─ build 分支 (Hugo 生成产物)
        │                               │
        │  GitHub Actions 触发          │  GitHub Pages 托管
        ▼                               ▼
   hugo --gc --minify           https://huangdiv.com (自定义域名 CNAME)
```

**部署 Action (reuixiy/hugo-deploy@v1) 执行步骤**:
1. Checkout 源仓库及子模块 (`themes/meme`)
2. 安装 Hugo Extended 最新版
3. 安装 Hugo 依赖（如 PostCSS）
4. 执行 `hugo --gc --minify` 生成站点
5. 通过 SSH 密钥认证，强制推送 `public/` 目录到目标仓库的 build 分支

### 9.3 所需 GitHub Secrets

| Secret 名称 | 说明 | 生成方式 |
|-------------|------|----------|
| `DEPLOY_KEY` | SSH 私钥 | `ssh-keygen -t ed25519`，公钥添加到部署目标仓库的 Deploy Keys |

---

## 10. 项目运行方式

### 10.1 环境要求

| 工具 | 版本要求 | 安装方式 |
|------|----------|----------|
| Git | 任意 | `apt install git` / 官网 |
| Hugo | **Extended** 版本 (>= 0.80) | `brew install hugo` / [官网下载](https://github.com/gohugoio/hugo/releases) |

> ⚠️ **重要**: 必须使用 **Hugo Extended** 版本（包含 SCSS 编译能力），否则 MemE 主题无法构建。普通版本会报 SCSS 相关错误。

### 10.2 本地开发环境搭建

```bash
# Step 1: 克隆仓库（含子模块）
git clone --recursive https://github.com/huangdiv/huangdiv.com.git
cd huangdiv.com

# 如果已经克隆但忘记 --recursive，补拉子模块
git submodule update --init --recursive

# Step 2: 启动本地开发服务器 (默认端口 1313)
hugo server -D

# 常用参数组合
hugo server \
    -D \              # 包含草稿 (draft: true)
    --disableFastRender \  # 关闭快速渲染（完整重建，调试用）
    --gc \            # 启动时清理缓存
    -p 1313           # 指定端口

# 访问
# 浏览器打开: http://localhost:1313
```

### 10.3 生产构建

```bash
# 生成最终静态文件到 public/ 目录
hugo --gc --minify

# 验证产物
ls -la public/
# 输出应包含: index.html, atom.xml, rss.xml, sitemap.xml, categories/, tags/, edu/, tech/, life/, about/, icons/ ...
```

### 10.4 创建新文章

```bash
# 方式1: 使用 archetype 模板自动生成 Front Matter
hugo new edu/我的新文章.md
# 生成: content/edu/我的新文章.md
# Front Matter 的 title 自动从文件名替换 "-" 为空格并首字母大写
# date 自动填充当前时间

# 方式2: 使用自定义编辑器打开 (可选配置 newContentEditor)
# config.toml: newContentEditor = "code"
# 执行 hugo new 后会自动用 VS Code 打开新文件

# 方式3: 手动创建
# 直接在对应 content 子目录创建 .md 文件，手写 Front Matter
```

### 10.5 常用 Hugo 命令速查

| 命令 | 用途 |
|------|------|
| `hugo server -D` | 本地开发（含草稿） |
| `hugo server -D --navigateToChanged` | 自动跳转到最新修改的页面 |
| `hugo config` | 打印合并后的完整配置（用于调试） |
| `hugo config mounts` | 查看虚拟文件系统挂载 |
| `hugo list drafts` | 列出所有草稿文章 |
| `hugo list future` | 列出未来发布的文章 |
| `hugo list expired` | 列出已过期的文章 |
| `hugo env` | 打印 Hugo 环境信息（确认是否 Extended） |
| `hugo mod clean` | 清理模块缓存 |

---

## 11. 扩展与自定义指南

### 11.1 自定义新菜单项

在 `config.toml` 的 `[menu]` 区块添加：
```toml
[[menu.main]]
    pageref = "/new-section/"     # 内链用 pageref
    # url = "https://external.com" # 外链用 url
    name = "新分区"
    weight = 10                   # 越小越靠前
    pre = "internal"              # internal | external
    post = "new-icon"             # SVG.toml 中的图标 key
```

然后在 `data/SVG.toml` 中添加对应图标 SVG，在 `content/new-section/_index.md` 创建分区首页。

### 11.2 切换评论系统

以启用 Giscus 为例：
1. 在 `config.toml` 设置 `enableGiscus = true`，填入 giscusRepo、giscusRepoId 等配置
2. 关闭不需要的: `enableWaline = false`
3. 对应 comments.html 会自动渲染 `#giscus` 容器
4. MemE 主题内置了 Giscus 加载脚本（无需额外 layouts 覆盖）

### 11.3 自定义 Waline 样式/功能

编辑 [layouts/partials/custom/waline.html](file:///workspace/layouts/partials/custom/waline.html)，在 `init()` 的参数中添加 Waline v3 支持的配置：

```js
init({
    el: '#walineComments',
    serverURL: "https://comments.huangdiv.com",
    dark: 'html[data-theme="dark"]',
    // 可扩展:
    // locale: { placeholder: '说点什么...' },
    // emoji: ['https://unpkg.com/@waline/emojis@1.2.0/weibo'],
    // requiredMeta: ['nick', 'mail'],
    // pageview: true,
    // search: false,
})
```

### 11.4 添加新的内容分区

1. 创建 `content/newsection/_index.md`（分区首页 Front Matter）
2. 在 `config.toml` 的 `mainSections` 添加 `"newsection"`
3. 在菜单项中添加入口（参考 11.1）
4. 在 `data/SVG.toml` 中添加对应图标
5. （可选）在菜单配置中添加对应的 `[[menu.main]]`

### 11.5 升级 MemE 主题

```bash
# 拉取主题最新提交
cd themes/meme
git fetch
git checkout <latest-tag-or-commit>  # 建议固定 tag 而非 master 分支
cd ../..

# 或者更新到子模块配置的最新
git submodule update --remote themes/meme

# 验证升级后本地构建
hugo server -D
# 确认无报错后提交子模块版本变更
git add themes/meme
git commit -m "chore: upgrade MemE theme to vX.X.X"
```

---

## 12. 许可协议

### 12.1 博客内容版权

文件: [LICENSE](file:///workspace/LICENSE)

博客文章内容采用 **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** (CC BY-NC-SA 4.0) 协议发布。

| 条款 | 说明 |
|------|------|
| **BY (署名)** | 必须给出适当的署名，提供指向本许可协议的链接 |
| **NC (非商业性)** | 不得将本作品用于商业目的 |
| **SA (相同方式共享)** | 基于本作品改编，必须采用相同的许可协议 |

### 12.2 代码部分

- 博客源码配置: 同内容 CC BY-NC-SA 4.0
- 用户脚本 (`河南专技在线辅助` 等): 作者保留所有权利，免费使用
- 工具页面代码 (`jumpto.html`, `seats-generator.html`): CC BY-NC-SA 4.0
- MemE 主题: 遵循其自身 [GPL-2.0 协议](https://github.com/reuixiy/hugo-theme-meme/blob/master/LICENSE)
- Hugo: 遵循 Apache 2.0 / MIT 双协议

---

## 附录: 关键配置速查表

### Front Matter 常用字段

```yaml
---
title: 文章标题
subtitle: 副标题（可选）
date: 2025-01-01T00:00:00+08:00
slug: custom-url-slug
description: SEO 用描述（优先级高于 summary/自动摘要）
tags: ["标签1", "标签2"]
categories: ["分类1"]      # 仅 categoryBy=categories 时用
draft: false               # 草稿不发布

# 显示控制
toc: true                  # 目录
dropCap: true              # 首字下沉
meta: true                 # 元信息（日期/分类/字数/阅读时间）
comments: true             # 评论区
displayCopyright: false    # 版权声明
badge: true                # 更新徽章
gitinfo: true              # Git 提交信息
share: false               # 分享按钮
related: false             # 相关文章

# 排版控制
indentFirstParagraph: false
indent: "margin"           # margin | indent
align: "justify"           # justify | left | right | center
dropCap: false
smallCaps: false
katex: false               # 数学公式（单篇开启）
mathjax: false
mermaid: false
---
```

### Hugo 环境变量

| 变量 | 用途 | 生产值 |
|------|------|--------|
| `HUGO_ENV` / `hugo.Environment` | 控制生产/开发 | `production`（hugo 命令默认） |
| `HUGO_ENVIRONMENT` | 同上别名 | - |
| `TZ` | 时区（CI 中） | `Asia/Shanghai` |

---

*文档生成时间: 2026-07-29*  
*基于仓库状态 commit: 当前工作区*  
*Code Wiki v1.0*
