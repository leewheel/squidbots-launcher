# 🦑 征服艾泽拉斯 · 单机启动器

> **Conquest of Azeroth · 一键开服启动器**
> 把「本机跑一套 COA 服务器 + 客户端」变成双击一个 exe 的事：
> 启动 / 停止 MySQL、登录服、世界服，管设置、备份、国度与机器人，全部离线运行，界面全中文。

| 项目 | 说明 |
| :--- | :--- |
| **启动器版本** | `v1.0.0` |
| **运行平台** | Windows 10 / 11（x64） |
| **服务器核心** | AzerothCore 3.3.5a · Conquest of Azeroth 定制核心 |
| **界面语言** | 简体中文（可切 English / Français / Русский） |
| **网络** | 全离线，不需要外网，不下载任何东西 |
| **授权** | MIT（启动器）· 核心与模块见 [许可与致谢](#十一许可与致谢) |

---

## 📑 目录

- [一、这是什么](#一这是什么)
- [二、功能总览](#二功能总览)
- [三、发布目录结构](#三发布目录结构)
- [四、快速开始](#四快速开始)
- [五、多种玩法（多国度）](#五多种玩法多国度)
- [六、你可能会问](#六你可能会问)
- [七、汉化说明](#七汉化说明)
- [八、从源码构建](#八从源码构建)
- [九、验证记录](#九验证记录)
- [十、已知边界](#十已知边界)
- [十一、许可与致谢](#十一许可与致谢)

---

## 一、这是什么

一个 **Electron 桌面启动器**，专为「在自己的电脑上开一个带玩家机器人的征服艾泽拉斯服务器」而做：

```
┌──────────────┐      ┌──────────────────────────────────────────┐
│  启动器.exe  │ ───▶ │  MySQL 3395  →  世界服 8085  →  登录服 3724 │
│ （本仓库）   │      │  数据、日志、备份、设置都在这台机器上      │
└──────────────┘      └──────────────────────────────────────────┘
        │
        └──▶ Client\Ascension.exe（客户端，realmlist 自动指向本机）
```

它不下载游戏、不连任何服务器：客户端在你的 `Client\`，数据在 `Server\ClientData\`，
角色与账号在你自己的 MySQL 里，**断网也能玩**。

---

## 二、功能总览

### 🚀 服务管理

| 功能 | 说明 |
| :--- | :--- |
| 一键启动 / 停止 | MySQL → 世界服 → 登录服，按依赖顺序启动；停止时反向并且**等世界服存档完成** |
| 单个服务控制 | 逐项启动、停止，每个服务独立日志 |
| 端口占用检测 | 端口被别的程序占了会直接报出程序路径，绝不硬抢 |
| 崩溃监控与自动重启 | 世界服崩溃会弹 Windows 通知；可设置每小时最多自动重启 3 次 |
| 世界控制台 | 远程控制台（RA，本机 3443）下达 GM 指令，看在线人数、tick、运行时长 |

### 🎮 客户端

| 功能 | 说明 |
| :--- | :--- |
| realmlist 管理 | 写入 `WTF\Config.wtf` 与 `Data\<locale>\realmlist.wtf`，原文件自动备份 |
| 一键进游戏 | 「开始游戏」直接拉起客户端；可设「先开服再进游戏」 |
| 机器人插件 | SquidBots Lite 随客户端提供，无需再装 |
| 客户端体检 | 版本、补丁文件、Manastorm 客户端文件是否到位 |

### ⚙️ 服务端

| 功能 | 说明 |
| :--- | :--- |
| 服务器设置页 | 130+ 条**中文说明**的常用设置，以及全部键值的搜索 / 编辑 |
| 改前备份 | 每次改动先把原文件存进 `.coa-launcher\config-backups`，可随时回滚 |
| 模块开关 | 拍卖行机器人、Dungeon Clear、附魔师、Manastorm、轮转助手、CoA 挑战模式 |
| 服务器体检 | 核心文件、配置粘连、数据目录、端口、数据库、崩溃、备份、磁盘 |
| 安全修复 | 已知问题（配置缺键、粘连行、孤立掉落等）一键修，且只改它说明的那一行 |

### 💾 数据与玩法

| 功能 | 说明 |
| :--- | :--- |
| 数据库备份 / 恢复 | 一键 gzip 备份、恢复前自动再备份一份（可撤销）、每天自动备份保留 7 份 |
| 角色导出 / 导入 | 世界控制台 `pdump` 导出角色，或从 sql 导入 |
| SQL 控制台 | 只读默认，改动需明确允许且先备份 |
| 账号管理 | 界面建游戏账号（可给 GM 等级）、改密码 |
| 多国度 | 一台机器同时开 CoA / Wildcard / Reborn / Free Pick，账号共用（见[第五节](#五多种玩法多国度)） |

---

## 三、发布目录结构

```
征服艾泽拉斯/
├── CoA启动器.exe          ← 单文件便携版，双击即用（会自动找同级目录）
├── Client/                ← 客户端（Ascension.exe、Data、Interface…）
│   ├── Ascension.exe
│   ├── Data/enUS/realmlist.wtf
│   └── Interface/AddOns/  ← 含 SquidBotsLite、DungeonClear
└── Server/                ← 服务端（= 编译产物 RelWithDebInfo 的内容）
    ├── worldserver.exe    ← 世界服
    ├── authserver.exe     ← 登录服
    ├── configs/           ← worldserver.conf、authserver.conf、modules/*.conf
    ├── ClientData/        ← dbc / maps / vmaps / mmaps
    ├── mysql/             ← MySQL 9.7（bin/、Data/），端口 3395
    ├── Settings/          ← repack.json（端口与 RA 账号）、network.json
    ├── logs/              ← Server.log / Errors.log / Playerbots.log…
    ├── Backups/           ← 启动器做的数据库备份
    └── RELEASE.json       ← 版本标识
```

> 💡 **启动器不需要你选目录**：放在同级位置的 `Client\` 与 `Server\` 会被自动识别。
> 想换地方？设置里改一次即可，或者把整个目录搬走（相对位置不变就行）。

关键配置 `Server\Settings\repack.json`：

```json
{
  "mysqlPort": 3395,
  "authPort": 3724,
  "worldPort": 8085,
  "raPort": 3443,
  "raUsername": "local",
  "raPassword": "local",
  "coreVersion": "9.9"
}
```

---

## 四、快速开始

### 第一次玩：三步

```text
1) 双击  CoA启动器.exe
2) 主页点  「启动服务器」        ← MySQL → 世界服 → 登录服，约 40 秒
3) 状态变绿后点「开始游戏」       ← 客户端自动连 127.0.0.1 进服
```

### 服务一览

| 服务 | 端口 | 说明 |
| :--- | :--- | :--- |
| MySQL 数据库 | `3395` | 账号、角色、机器人、世界数据（用户名 / 密码 `trinity` / `trinity`） |
| 世界服务器 | `8085` | 游戏世界本体，机器人跑在这里 |
| 登录服务器 | `3724` | 客户端登录 |
| 远程控制台（RA） | `3443` | 仅本机，账号 `local` / `local` |

### 关闭时会发生什么

> ⚠️ **关闭启动器 = 停止服务器**。
> 启动器会先给世界服发 `server shutdown` 让它把角色数据存完（通常 30 秒～2 分钟，机器人越多越久），
> 再关 MySQL，然后退出。**不要在它保存时强杀进程**，否则这段时间的进度会丢。

想让它留在通知区域？设置里勾「关闭窗口后保留在通知区域」，此时关窗口不会停服。

---

## 五、多种玩法（多国度）

一台机器、一套账号、多个世界：登录后在游戏的国度列表里选。

| 国度 | 玩法 | 世界端口 | 角色库 |
| :--- | :--- | :---: | :--- |
| **Conquest of Azeroth** | 经典 COA：全部职业与内容 | `8085` | `acore_characters` |
| **Darkmoon**（Wildcard） | 只有「英雄」职业，法术与天赋随机抽取，每局不同 | `8185` | `acore_characters_wildcard` |
| **Bronzebeard**（Warcraft Reborn） | 原版十个职业，经过重新设计 | `8285` | `acore_characters_reborn` |
| **Dawnrise**（Free Pick） | 英雄职业 + 自由挑选每个法术与天赋（实验性，默认无机器人） | `8385` | `acore_characters_dawnrise` |

- **账号共用**：登录一次，切国度不用重新登录；
- **进度独立**：每个国度有自己的角色和机器人数据；
- **创建方式**：国度页点「开启」，约一分钟（会复制角色表结构与机器人库），内存不足时启动器会提示；
- 可设「随服务器启动」，开服时按顺序自动拉起多个世界。

---

## 六、你可能会问

<details>
<summary><b>启动器说「端口 3395 被其他程序占用」怎么办？</b></summary>

说明本机已经有一个 MySQL（很可能是另一套服务端）占着同一个端口。启动器会给出那个程序的完整路径。
先停掉那一套（或在 `Server\my.ini` 与 `Settings\repack.json` 里换端口，两处必须一致），再启动即可。
</details>

<details>
<summary><b>进游戏却看不到国度 / 连不上？</b></summary>

按顺序检查：① 三个服务是否都是「运行中」；② `Client\realmlist.wtf` 与 `Client\Data\enUS\realmlist.wtf`
是否为 `set realmlist 127.0.0.1`（「你的游戏」卡片会直接告诉你 realmlist 状态，可一键修复）；
③ 登录服 3724 是否被防火墙拦（默认只允许本机，不需要放行）。
</details>

<details>
<summary><b>机器人太多会不会卡？</b></summary>

默认 500 个随机机器人（在线约 500）。服务器设置页「机器人 → 机器人数量」可调低（如 100～200），
「单人自给自足」预设则会让机器人从 1 级陪你升级。内存估算：`500 个机器人 ≈ 4 GB`，
启动器体检页会按你的内存给出判断。
</details>

<details>
<summary><b>数据库 / 角色进度在哪里？怎么备份？</b></summary>

数据在 `Server\mysql\Data\`。备份：服务页 →「备份」→「立即备份」（存成 `Server\Backups\<时间戳>.sql.gz`），
也可以勾选「每天自动备份一次（保留 7 份）」。恢复前会自动再备份一份，所以要反悔也能回去。
</details>

<details>
<summary><b>我想改服务端设置 / 加模块 / 改经验倍率？</b></summary>

服务页右侧「服务器设置」里有 130+ 条带中文说明的常用项（倍率、难度、机器人、PvP、工具…），
也可以按关键词搜索全部键值直接改。改动前会自动备份，改坏了能一键回滚。
</details>

<details>
<summary><b>能不能开给局域网 / 公网的朋友？</b></summary>

可以。首页「谁可以加入」里把模式改成「其他电脑」，填上你的 IP/域名，启动器会改 `BindIP`、
写 realmlist、并在需要时帮你放行防火墙（Windows 会弹 UAC 询问）。
</details>

<details>
<summary><b>报错了怎么办？</b></summary>

设置 →「生成支持报告」，会把版本、服务状态、最近的日志（密码自动打码）打成一个 zip，
发给技术支持即可定位。服务端日志在 `Server\logs\`（`Server.log` / `Errors.log`）。
</details>

---

## 七、汉化说明

界面 100% 中文，且**不是机翻**——所有文案按游戏语境重写：

| 位置 | 覆盖情况 |
| :--- | :--- |
| 界面文案 | `zh.json` 1700+ 条，覆盖全部 `t()` 文案（1084 条） |
| 报错提示 | 122 条直译 + 44 条带变量模板（如「端口 {port} 已被其他程序占用」） |
| 系统对话框 | 打开目录、关闭拦截、启动失败、托盘菜单、Windows 通知 |
| 服务端设置 | 130+ 条常用设置的中文名称与说明 |
| 模块说明 | 机器人、拍卖行、Dungeon Clear、附魔师、Manastorm 等卡片正文 |

> 🔧 想加语言？在 `launcher/public/locales/` 放一份 `xx.json`（键值同 `zh.json`），
> 界面会自动出现该语言选项。检查缺漏：`node tools/i18n-check.mjs xx`。

---

## 八、从源码构建

```bash
cd launcher

npm install                      # 安装依赖
node node_modules/electron/install.js   # 如果 Electron 二进制没下载下来
npm test                         # 127 个测试，全绿再打包

# 单文件便携版（推荐，产物 dist/CoA-Launcher-<版本>.exe）
npx electron-builder --win portable --publish never
```

开发模式（不改动发布目录）：

```bash
npm start                        # 用源码直接跑界面
```

说明：

- 打包用 `electronDist = node_modules/electron/dist`（本地 Electron），**不联网**也能打包；
- 装成安装包（NSIS）而不是便携版：把 `package.json` 的 `win.target` 改成 `"nsis"` 再打包；
- 目录布局代码集中在 `launcher/src/layout.cjs`：一套启动器同时支持「官方整合包布局（`Core\…`）」与
  「本发布版布局（`Server\worldserver.exe` 在根目录）」。

---

## 九、验证记录

| 项目 | 结果 |
| :--- | :--- |
| 单元测试 | **127 / 127 通过**（`npm test`） |
| 端到端（真实端口） | 全部启动 → 三服务 running；世界运行 6 分钟，在线机器人 **512**、tick 63；全部停止 → 三服务 stopped |
| 停机数据安全 | 世界服把 817 条数据库查询写完才关 MySQL，`Server.log` 无 `Could not connect` |
| 日志门禁 | `Server.log` **0 ERROR / 0 WARNING / 0 Missing property**；`Errors.log` 仅剩 COA 客户端 DBC 固有缺口的 14 条提示 |
| 界面巡检 | 主页 / 模块 / 检查 / 国度 / 控制台 / 服务 / 设置 / 备份 八页全中文，无渲染错误 |
| 建号 | 界面建号成功；勾选 GM 会同时写入 `acore_auth.account_access`（等级 3，全国度） |

---

## 十、已知边界

- **纯离线**：不提供启动器在线更新，升级方式是用新的整合包目录替换（角色数据在 `Server\mysql`，可整包带走）。
- **启动器即服务器**：三个服务由启动器直接托管，所以关闭启动器会优雅停机（见[第四节](#四快速开始)）。
- **DBC 缺口**：`Errors.log` 里的 `did not match dbc effect data` 是 COA 客户端 DBC 的已知缺口，不影响游戏，无需处理。
- **多族群模块**：本发布版关闭（核心未带额外种族补丁）。
- **控制台 `account set gmlevel`**：上游核心该指令不落表，启动器已改为建号后直接写库补齐。

---

## 十一、许可与致谢

| 组件 | 许可 / 来源 |
| :--- | :--- |
| 本启动器 | MIT · 基于开源项目 **SquidBots Launcher Lite**（Zyth45）改造 |
| 服务器核心 | GPL-2.0 · [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk) / [Conquest-of-AzerothCore](https://github.com/jealous-sound/azerothcore-wotlk-coa) |
| 玩家机器人 | AGPL · [mod-playerbots](https://github.com/Zyth45/mod-playerbots) 及其上游 |
| Dungeon Clear | AGPL · Jared Wright 原模块的 SquidBots 版本 |
| 拍卖行机器人 | [mod-ah-bot-plus](https://github.com/NathanHandley/mod-ah-bot-plus)（Nathan Handley） |
| 附魔师 NPC | 构想来自 [mod-npc-enchanter](https://github.com/azerothcore/mod-npc-enchanter)（StygianTheBest） |
| MySQL / OpenSSL / Electron | 各自的许可（GPL-2.0 / Apache-2.0 / MIT） |

> 发布包内**不含任何游戏原始资源**：客户端与服务端数据均来自玩家自有的 Conquest of Azeroth 客户端与
> AzerothCore 公开源码；本仓库只提供启动器与整合脚本。
>
> 汉化与目录适配：**leewheel**，2026-11-02。

---

<p align="center">
  <sub>为「一个人的艾泽拉斯」而做 · Made with 🦑 for Conquest of Azeroth</sub>
</p>
