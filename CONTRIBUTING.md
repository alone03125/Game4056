# 小组成员协作指南

这份文档写给小组成员。没用过 Git 和 GitHub 也没关系，照着下面的步骤一条一条做就行。命令都可以直接复制粘贴。

## 规则只有一条

**`main` 分支（大家共用的正式版本）不能直接修改。** 每个人在自己的“分支”上改代码，改完在 GitHub 上提一个“PR”（合并请求），由仓库所有者 [@alone03125](https://github.com/alone03125) 审阅通过、并且自动检查通过以后，才会合并进 `main`。直接推送到 `main` 会被 GitHub 拒绝，所以不用担心误操作弄坏大家的代码。

## 几个词的意思

| 词 | 意思 |
| --- | --- |
| 仓库（repository） | 项目的全部代码和修改历史，放在 GitHub 上 |
| 克隆（clone） | 把仓库下载到自己电脑上，只需要做一次 |
| 分支（branch） | 一份独立的副本，在上面怎么改都不影响别人 |
| 提交（commit） | 给当前的修改存一个档，附上一句说明 |
| 推送（push） | 把自己电脑上的提交上传到 GitHub |
| 拉取（pull） | 把 GitHub 上别人的新提交下载到自己电脑上 |
| PR（Pull Request） | 请求把自己分支上的修改合并进 `main` |

---

## 一、准备工作（只需要做一次）

### 1. 注册 GitHub 并接受邀请

1. 在 <https://github.com> 注册账号，把**用户名**发给 alone03125。
2. alone03125 把你加为协作者后，你会收到一封邀请邮件。点邮件里的链接，或者登录 GitHub 后打开 <https://github.com/alone03125/Game4056/invitations>，点“Accept invitation”。

没有接受邀请的话，后面推送时会提示没有权限。

### 2. 安装软件

- **Git**：<https://git-scm.com/downloads>，下载后一路点“Next”用默认选项安装。
- **Node.js**：<https://nodejs.org/>，下载标着 LTS 的版本，用默认选项安装。
- **代码编辑器**（推荐）：[VS Code](https://code.visualstudio.com/)。

### 3. 打开终端

下面所有命令都在终端里输入。**Windows 请使用 Git Bash**（安装 Git 时自带），不要用 PowerShell，否则 `npm` 命令可能报错。

- 在文件夹的空白处右键 →“显示更多选项”→“Open Git Bash here”，终端就会在这个文件夹里打开。
- 也可以在 VS Code 里点菜单“终端”→“新建终端”，再在终端右上角的“+”旁边的下拉箭头里选择“Git Bash”。
- Mac 用自带的“终端”，命令完全一样。

在终端里粘贴：Git Bash 用 `Shift + Insert` 或右键“Paste”；按回车执行。

### 4. 告诉 Git 你是谁

把引号里的内容换成你自己的，然后运行：

```bash
git config --global user.name "你的GitHub用户名"
```

```bash
git config --global user.email "你的邮箱"
```

仓库是公开的，这个邮箱会出现在提交记录里。如果不想公开真实邮箱，可以在 GitHub 右上角头像 →“Settings”→“Emails”里勾选“Keep my email addresses private”，然后改用页面上显示的那个以 `@users.noreply.github.com` 结尾的地址。

### 5. 克隆仓库

在你想放项目的文件夹（比如桌面）里打开 Git Bash，运行：

```bash
git clone https://github.com/alone03125/Game4056.git
```

完成后会多出一个 `Game4056` 文件夹。进入它并安装依赖：

```bash
cd Game4056
```

```bash
npm install
```

以后每次干活，都在 `Game4056` 文件夹里打开终端（或者用 VS Code 打开这个文件夹，再新建终端）。

### 6. 试着运行游戏

```bash
npm run build
```

然后双击打开 `dist/Game4056.html` 就能玩。要测试联机，运行 `npm run serve`，再用浏览器打开 <http://localhost:4056>；在终端按 `Ctrl + C` 关闭服务器。

---

## 二、每次开始干活：同步并新建分支

每做一件新的事情（加一个功能、修一个问题），都先运行这三条命令：

```bash
git switch main
```

```bash
git pull
```

```bash
git switch -c 名字缩写/做什么
```

- 第一条：切换到 `main` 分支。
- 第二条：把别人已经合并的最新代码下载下来。
- 第三条：从最新的 `main` 新建一个你自己的分支并切换过去。分支名用英文或拼音、不要有空格，例如 `xm/new-gun`、`zh/fix-shop-price`。

如果 `git pull` 下载下来的修改里有 `package.json`，再运行一次 `npm install`。不确定的话运行一次也没有坏处。

随时可以运行 `git status` 看看自己在哪个分支上（第一行 `On branch ...`）以及改了哪些文件。

## 三、修改并自己测试

用 VS Code 修改代码。改完以后运行 `npm run build`，再刷新浏览器里的游戏看看效果。

准备提交之前，依次运行下面三条命令，确认都没有报错（PR 的自动检查也会跑这三项，有一项不通过就不能合并）：

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run modtest
```

## 四、提交并推送

```bash
git status
```

先看一眼改动的文件列表，确认没有不该提交的东西。`node_modules/`、`dist/` 这些自动生成的文件已经被设置为忽略，不会出现在这里。

```bash
git add -A
```

```bash
git commit -m "用一句话说明改了什么"
```

```bash
git push -u origin HEAD
```

- `git add -A`：把所有改动放进这次提交。
- `git commit -m "..."`：存档。说明可以写中文，例如 `"商店刷新价格改为 500"`。
- `git push -u origin HEAD`：把当前分支上传到 GitHub。同一个分支以后再推送，只需要运行 `git push`。

**第一次推送时**会弹出 GitHub 登录窗口：选“Sign in with your browser”，在浏览器里登录并点授权。之后电脑会记住登录状态，不用再登录。

一件事可以分成多次提交，每次 `add`、`commit`、`push` 就行。

## 五、在 GitHub 上提 PR

1. 打开 <https://github.com/alone03125/Game4056>。刚推送过的话，页面上方会出现一条黄色提示，点里面的“Compare & pull request”。
   - 没有看到提示：点上方的“Pull requests”→“New pull request”，左边的 base 选 `main`，右边的 compare 选你的分支，再点“Create pull request”。
2. 标题写清楚改了什么。正文里已经有模板，按提示填写；勾选框把 `[ ]` 改成 `[x]` 就是打勾。
3. 点“Create pull request”。

然后等待两件事：

- **自动检查**：一两分钟后 PR 页面下方会出现结果。绿色对勾表示通过；红色叉号表示有问题，点旁边的“Details”看报错，在自己电脑上改好后再 `add`、`commit`、`push`，PR 会自动更新。
- **审阅**：alone03125 会看你的修改，可能会留言请你修改。同样是在**同一个分支**上继续改、提交、推送，不要新开 PR。审阅批准并且检查通过后，PR 就会被合并。

## 六、PR 合并以后

```bash
git switch main
```

```bash
git pull
```

```bash
git branch -d 你的分支名
```

最后一条删除已经没用的本地分支。之后要做新的事情，回到第二步新建分支。

## 七、别人先合并了，我的分支需要同步

你还在改的时候，别人的 PR 可能已经合并进了 `main`。PR 页面提示“This branch is out-of-date”或“This branch has conflicts”，或者你想用上别人的新代码时，运行：

```bash
git switch main
```

```bash
git pull
```

```bash
git switch 你的分支名
```

```bash
git merge main --no-edit
```

- **没有冲突**：直接运行 `git push` 就完成了。
- **有冲突**（终端里出现 `CONFLICT`）：说明你和别人改了同一个地方，需要你决定保留哪一份。
  1. 用 VS Code 打开提示冲突的文件，冲突的地方会标出“当前更改”（你的）和“传入的更改”（`main` 上别人的）。
  2. 点上方的“采用当前更改”（Accept Current Change）、“采用传入的更改”（Accept Incoming Change）或“保留双方更改”（Accept Both Changes），或者直接手动改成正确的样子，确保文件里不再留有 `<<<<<<<`、`=======`、`>>>>>>>` 这些标记。
  3. 所有冲突文件都处理完后运行：

```bash
git add -A
```

```bash
git commit --no-edit
```

```bash
git push
```

冲突自己拿不准时，可以先不处理，在小组群里问一下，或者在 PR 下留言。

**减少冲突的办法**：分工时尽量别让两个人同时改同一个文件的同一块；一个 PR 只做一件事，做完尽快提交，不要攒很多天。

---

## 常见问题

**`npm` 报错“无法加载文件……因为在此系统上禁止运行脚本”**：你在用 PowerShell。改用 Git Bash（见第一步第 3 条）。

**推送时提示 `protected branch` 或被拒绝**：你在 `main` 上提交了。先把这些提交搬到新分支，再让本地的 `main` 回到和 GitHub 一致（第三条命令会丢掉 `main` 上还没提交的修改，所以先确认 `git status` 显示没有未提交的修改）：

```bash
git switch -c 名字缩写/做什么
```

```bash
git switch main
```

```bash
git reset --hard origin/main
```

然后切回新分支（`git switch 名字缩写/做什么`），按第四步推送、第五步提 PR。

**推送时提示 `Permission denied` 或 `403`**：还没有接受协作邀请（见第一步第 1 条），或者登录的不是自己的 GitHub 账号。

**切换分支时提示 `Your local changes ... would be overwritten`**：当前分支上还有没提交的修改。先按第四步提交，再切换。

**终端突然变成一个看不懂的编辑界面**：这是 Git 打开了 Vim 编辑器让你写说明。按 `Esc`，输入 `:wq`，再按回车就能保存退出。

**想放弃某个文件的修改**：运行 `git restore 文件路径`。这会把文件恢复成上次提交时的样子，放弃的修改找不回来。

**弄乱了不知道怎么办**：先别继续输命令，把 `git status` 的输出截图发到小组群里问。

---

## 写代码的约定

- **一个 PR 只做一件事**，标题说清楚是什么。
- **游戏内文字**只写对玩家有用的信息，不写掉落概率、随机范围、价格公式这类开发数值；不使用“·”。
- **字号**统一为 12 的倍数，像素字体在这些字号下最清晰。
- **记录设计决定**：改动文档没写清楚、由你自己决定的细节，写进 [`docs/开发流程.md`](docs/开发流程.md)，并在文末的“更新日志”里追加一条。
- **改动文档**放在 `userPrompt/`，按“第 N 次调整”命名。

代码大致的位置：

| 想改什么 | 去哪里找 |
| --- | --- |
| 区域、敌人、辐射、难度等数值 | `src/config.ts` |
| 子弹、枪械、道具 | `src/data/` |
| 玩家、敌人、子弹的行为，商店和流程 | `src/game/` |
| 地图生成 | `src/world/` |
| 模型、贴图、特效 | `src/render/` |
| 音效和音乐 | `src/audio/` |
| 界面和菜单 | `src/ui/` |
| 联机 | `src/net/`、`serve.mjs` |

改了玩法或数值，想看看对难度的影响，可以用无头测试（说明见 `docs/开发流程.md` 第 5 节），例如 `npm run sim -- 8 normal` 会让 AI 自动玩 8 局普通难度。

## 关于字体

数字和英文原本使用 NoitaPixel 字体，它的版权属于 Nolla Games、没有开源协议，所以没有放进这个公开仓库。没有它时构建会自动只用开源的 Fusion Pixel 字体，游戏照常显示，只是数字和英文的字形不同。即使你手上有这个字体，也不要把它提交进仓库。
