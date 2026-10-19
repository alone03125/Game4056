# 参与开发

欢迎一起改《末日4056》！这个仓库的 `main` 分支受保护：**任何人（除了仓库所有者）都不能直接推送到 `main`**，所有改动都要通过 Pull Request（PR），由 [@alone03125](https://github.com/alone03125) 审阅通过、并且自动检查（CI）通过后才能合并。

## 流程

1. **拿到代码**
   - 没有仓库权限：在 GitHub 上点 **Fork**，把仓库复制到自己的账号下，然后克隆自己的 fork。
   - 被加为协作者（Collaborator）：可以直接克隆本仓库，但仍然只能在自己的分支上提交。
2. **新建分支**：`git checkout -b 你的分支名`（例如 `feat/new-zombie`、`fix/shop-price`），一个分支只做一件事。
3. **开发与自测**（见下文），提交并推送你的分支。
4. **开 PR**：在 GitHub 上对 `alone03125/Game4056` 的 `main` 发起 Pull Request，按模板写清楚改了什么、怎么验证的。
5. **审阅**：所有者审阅后可能会留言要求修改；在同一个分支上继续提交即可，PR 会自动更新。批准并且 CI 通过后合并。

## 本地开发

需要 Node.js 18 以上。

```bash
npm install          # 安装依赖
npm run dev          # 监听源码自动构建到 dist/
npm run serve        # 本地服务器 http://localhost:4056（联机也需要它）
```

提交前请至少跑一遍：

```bash
npm run typecheck    # 类型检查
npm run build        # 构建
npm run modtest      # 规则测试（PR 的自动检查也会跑这三项）
```

改动玩法或数值时，可以用无头测试看看影响（说明见 README 与 `docs/开发流程.md` 第 5 节）：`npm run sim -- 8 normal`、`npm run flowtest -- 4`、`npm run bosstest -- 6`、`npm run mptest -- 3 normal`。

## 约定

- **游戏内文字**只写对玩家有用的信息：不写掉落概率、随机范围、价格公式这类开发数值（这些写在 README 和开发文档里）；不使用「·」。
- **字号**统一为 12 的倍数（像素字体在这些字号下最清晰）。
- **逻辑和表现分开**：`src/world/`、`src/game/` 不依赖 three.js，可以在 Node 里无头运行；表现层通过 `Fx` 接口接收事件，联机通过 `NetHooks` 接口。
- **记录设计决定**：策划文档没写清楚、由你决定的细节，写进 `docs/开发流程.md` 的正文和文末的「更新日志」。
- **改动文档**放在 `userPrompt/`，按「第 N 次调整」命名。

## 关于字体

数字和英文原本使用策划提供的 NoitaPixel 字体，但它的版权属于 Nolla Games，没有开源协议，所以**没有放进这个公开仓库**。没有它时构建会自动只用开源的缝合像素字体 Fusion Pixel（汉字、数字、英文都能正常显示，只是数字和英文是 Fusion 的字形）。如果你本地有这个字体，放到 `assets/fonts/NoitaPixel.ttf`，运行 `npm run font`（需要 Python 与 fontTools）后再构建即可；请不要把它提交进仓库。
