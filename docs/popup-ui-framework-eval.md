# Popup UI 框架引入评估 (M1 → M2 过渡前)

> 上下文：用户要求 popup 用 shadcn/UI 重设计 + 设置项展现优化。在动手前需要先定 framework 路径,避免做完发现 Chrome 商店审核 / 体积 / 维护性问题反工。

## 现状基线

- popup.html: 559 行 (含 inline `<style>` ~330 行)
- popup.js: 489 行 (vanilla JS,无 framework)
- styles.css: 1481 行 (content script 用,popup 部分 inline 在 popup.html)
- 零 build step,零 npm runtime deps
- Chrome 商店当前审核延迟稳定 (v1.1.2 当天通过)

## 三条路径对比

### A. 全量 shadcn/UI (Vite + Tailwind + Radix)

shadcn/UI 不是一个安装即用的组件库,它是一组"复制粘贴到你项目"的 React 组件配方,底层依赖 Radix Primitives + Tailwind。

| 维度 | 评估 |
|---|---|
| **构建链** | 必须引入: React (~45KB gzip) + Tailwind (CSS purge 后 ~10-20KB) + Radix Primitives (按需 ~5-15KB/component) + Vite build pipeline |
| **体积** | popup bundle 总增量约 **+60-100KB gzip**(取决于用了几个 Radix 组件)。当前 popup.js 不到 20KB,扩展整包 ~120KB,翻倍以上 |
| **开发量** | 改造 popup.html → React 组件,popup.js 逻辑迁 React hooks/state。预估 **3-5 dev day** |
| **维护** | React + Radix 版本升级 / Tailwind config 维护 / Vite 配置漂移风险 |
| **视觉接近度** | ⭐⭐⭐⭐⭐ 像素级 shadcn |
| **build step** | 必须;每次 popup 改动要 `vite build`,bb-browser dev 流程从"改文件 + reload"变"改文件 + build + reload" |
| **Chrome 审核** | React + Tailwind 是审核员熟悉栈,**无审核延迟风险**;但首次提交大改可能多 1 轮人工 review |
| **rollback 难度** | 高 — 全 React 化后回 vanilla 几乎重写 |

**适合**:长期看 popup 会变成"另一个 SPA"且团队接受 React 栈。

---

### B. shadcn 风格 minimal (手写 CSS + design tokens)

不引 framework,手写 CSS 模仿 shadcn 视觉语言(neutral palette + 圆角 + subtle shadow + spacing scale)。

| 维度 | 评估 |
|---|---|
| **构建链** | 零增量 — 仍是现有 `popup.html` inline `<style>` + `popup.js` vanilla |
| **体积** | popup.html CSS 部分预估 +5-10KB;无 JS 增量。整包基本不变 |
| **开发量** | 重写 popup.html `<style>` 块 + 调整 HTML 结构。**1-2 dev day**(主要时间在 design token 提炼 + 多次迭代视觉) |
| **维护** | 同现状(单一 popup.html 维护) |
| **视觉接近度** | ⭐⭐⭐ — shadcn "感觉",不会像素级一致(无 Radix 动画 / focus-ring 细节) |
| **build step** | 无 |
| **Chrome 审核** | 同现状,无影响 |
| **rollback 难度** | 低 — 只是 CSS / HTML 改动 |

**适合**:看重快速迭代 + 维持现有"零 build / 直接 reload"工作流;接受"shadcn-ish"而非 100% 复刻。

---

### C. Headless 组件 + 自己样式 (Radix 单独 / Headless UI)

只引 Radix Primitives (或 @headlessui/react,但 popup 不在 React) 的少数组件 (e.g. Dropdown / Tabs / Dialog),样式自己写。

| 维度 | 评估 |
|---|---|
| **构建链** | 需引入 React + 选定 Radix 组件 + bundler(Vite/esbuild)。比 A 轻但仍是新栈 |
| **体积** | +25-40KB gzip(取决组件数) |
| **开发量** | 中等 — 选 3-5 个组件 + 自己写样式。**2-3 dev day** |
| **维护** | Radix + React 版本管理,但组件少所以面积小 |
| **视觉接近度** | ⭐⭐⭐⭐ — 行为像 shadcn(键盘导航/无障碍)但样式自己控制 |
| **build step** | 必须(React) |
| **Chrome 审核** | 同 A |
| **rollback 难度** | 中 |

**适合**:看重"交互一致性 / 无障碍"(键盘 focus 顺序 / aria-* 自动)但不愿全押 React。

---

## 决策建议矩阵

| 用户优先级 | 推荐路径 |
|---|---|
| "像素级 shadcn,体积/维护不在意" | **A 全量 shadcn** |
| "shadcn 视觉感觉就行,要快要稳" | **B minimal 手写** ✨ |
| "交互无障碍要 shadcn 级,样式可松一点" | **C headless** |
| "M2 紧迫,popup 重设计先视觉过得去" | **B minimal 手写** |

## 我的推荐:B (minimal 手写)

理由:
1. **节奏匹配 M2**:M1 刚 ship,M2 (#47/#48/#49/#50) 还在排期,如果 popup 改造耗 3-5d 会卡 M2 整个 sprint。B 的 1-2d 不影响 M2
2. **零 build 保 dev workflow**:用户已经习惯 "改 → `npm run build:dist` → reload" 的 dev3 流程,引 Vite 后会变"改 → build → bundle → copy → reload",每次 reload 慢 5-10s,真测痛苦
3. **Chrome 商店 ship 风险最低**:无新依赖,审核员看到的还是熟悉的代码结构。当前 v1.1.x 都是当天审核通过,引 React 即使审核员不卡,bundle 体积大也会影响下载/启动速度
4. **未来不锁死**:B 实现完后,如果 M3+ 真的需要 Radix 级交互组件,从 B 升 C 比从 A 降 B 容易得多
5. **rollback 摩擦低**:用户拍方向后实际用上看不顺眼,B 的回滚成本是几小时,A/C 是几天

**只有一种情况选 A**:用户/团队已经在用 React 做扩展,且 popup 会涨到"几十个 section / 多 tab / 子页面",彼时 vanilla 维护成本超过 React 引入成本。当前 popup 8 个 section 还远没到这个临界点。

## 配套建议(无论选哪条)

- 抽 design tokens 进 `<style>` 顶部 CSS 变量块(目前 popup.html 已有 `:root {}` 5 个变量,可扩到 ~15-20 个覆盖 spacing/radius/shadow)
- 把 inline 长 `<style>` 拆到独立 `popup.css`(可选,改 size 不变)
- popup section 加 collapsible(`<details>`)分组,降低视觉密度

## 给用户决策的一句话总结

如果用户回答"我就要 shadcn 那个视觉,体积不在乎" → **A**
如果用户回答"看着像 shadcn 就行,别拖 M2" → **B**(我的推荐)
如果用户回答"功能上要 shadcn 一样好用,样式可以自己调" → **C**
