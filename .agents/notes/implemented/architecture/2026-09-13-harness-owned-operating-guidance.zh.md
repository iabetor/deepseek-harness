# Agent Note: harness 自有的执行纪律

Status: implemented

[English](2026-09-13-harness-owned-operating-guidance.md) | 中文

## Problem

三条在实践中耗费墙钟时间的执行习惯此前没有提示词归属。实测会话日志三者俱现：一条因环境原因（缺少 Playwright 浏览器）失败的命令被原样重跑，又花掉它完整的时长去学到同一个事实；长命令串行执行，而本可并行的工作在等待；一条长命令的输出被直接管入过滤器，于是之后就该输出提出的问题只能靠完整重跑一次来回答。

所有既有归属者都不对。[提示词归属决策](2026-07-05-prompt-variables-and-tool-guidance-ownership.zh.md)把跨调用习惯交给所属工具包的提示词段、把单工具语义交给工具描述——但这两条规则不是单工具规则：它们管的是要不要调用*任何*长命令或已失败命令，因此没有任何单个工具包拥有它们。部署 persona 作为归属者则犯了相反的错：规则必须对 harness 组成的每个 agent 都成立，而 agent preset 会整体遮蔽 `deployment:persona-*`，于是 persona 层的规则在有人选择另一个 preset 的瞬间就消失了。

## Decision

`dsh-system-prompt` 拥有一个新段 `harness:operating-guidance`，注册顺序为 `-900`——位于 `harness:identity`（`-1000`）之后、`deployment:persona-prefix` 槽位（`0`）之前。

**文本是代码字面量，不是部署配置。** 最直观的形态是仿照 `personaPrefix` 增加一个 `operatingGuidance: string` 配置字段，在 `dsh-base` bundle 里设一次让所有 profile 继承。该形态在此不成立：patch 会替换目标行的整个 `config`，而 Web、headless、ACP、SDK 与 sdk-minimal 各 bundle 都会重述 `system-prompt` 行。因此设在 base 层的值会被之后每个修补该行的 mode bundle 丢弃——这与「一条所有 profile 都应共享的规则」恰好相反。已对真实组合出的层列表验证：使用配置字段形态时，`web-app`、`headless`、`acp-app`、`sdk-app` 全部丢失该文本。代码字面量形态能到达这四者，因为任何 bundle 都无法替换插件自己注册的内容。

**用布尔值而非字符串来开关。** `includeOperatingGuidance` 默认为 `true`，与紧邻其上的 `includeHarnessIdentity` 一致。sdk-minimal bundle 将其设为 `false`，理由与它已经设置 `includeHarnessIdentity: false` 和 `includeRuntimeContext: false` 相同：该 profile 固定了一份逐字节最小的提示词，而一条它未要求的规则会破坏这份固定。

该段名由 harness 自有，因此带作用域的 `deployment:persona-prefix`——agent preset 替换 persona 的方式——不会移除它。该名称与其他内建段一样被保留：再次注册它会抛错。

文本把三条习惯表述为一条纪律：因环境原因已失败的命令会以同样方式再次失败，因此不要重跑以确认——报告该限制，或先说明什么变了；时长未知或较长的命令应放到后台，让独立工作继续；长命令的输出先落盘再交给任何过滤器读取，这样之后就该输出提出的第二个问题就不必再付一次运行的代价。每句在加入前都在真实会话中实测过——第三句来自一次因管道输出被丢弃而花掉三轮全量测试与两次快照刷新的会话。规则保持简短，因为它会在每次请求中渲染，并与 persona 争夺模型的注意力。

## Alternatives considered

**base bundle 行上的部署配置（`operatingGuidance`）。** 由实测而非偏好否决：每个 mode bundle 都会替换该行的整个 config，因此该值在每个于 base 层之后修补 `system-prompt` 的 profile 中都会消失。在全部五个 bundle 中重述该字符串会让一条共享规则变成五份独立漂移的副本。

**在 `dsh-tool-bash` 中作为跨调用习惯注册，紧邻既有的 exit-code 指导。** 最接近的邻居，如果该规则是单工具规则，这本会是答案。但它不是：该规则也覆盖通过同一 shell 触达的 `pnpm` 类命令，而替换 shell provider 的部署会静默失去它。

**放进部署 persona 或随附 preset 的 `dsh-persona` 行。** 否决原因是 preset 会遮蔽 persona 槽位：该规则只对恰好重述它的 preset 生效，而对任何新的或用户自撰的 preset 消失，包括 `$DSH_HOME/.agent-presets` 下的 `liangshen` 式自定义 preset。

**依赖模型阅读工具描述。** 否决原因是这次失败并不是缺少工具契约——`bash` 已经记录了 `run_in_background`，而且那次重跑语法正确。模型知道怎么做这两件事；它缺的是一条「这些就是默认做法」的常驻指令。

## Consequences

每个基于 base 的 profile 现在都会在 persona 之前渲染这条纪律：Web、headless、desktop、ACP、SDK 与 cortex，以及每个 agent preset，而 `sdk-minimal` 已选择退出。由于该段位于 `-900`，处在第一方前缀之内，它是一个稳定的 KV-cache 前缀——文本固定且不含变量——因此代价是每次请求一个常量块，而不是每轮失效。

该文本是模型可见的，现在由断言组装后提示词的各包固定：`dsh-system-prompt`、`dsh-agent-loop`、`dsh-persona`、`dsh-tool-bash`、`dsh-tool-fs`、`dsh-tool-fs-search` 与 `dsh-tool-web` 各自在自己的套件中固定该字面量，因此改写规则会让测试失败而不是静默上线。`dsh-system-prompt` 还固定了它与 `DEPLOYMENT_PERSONA_PREFIX` 的顺序关系以及退出开关。

[指导归属决策](2026-07-05-prompt-variables-and-tool-guidance-ownership.zh.md)仍然有效：本段是又一条跨调用习惯，由提示词注册表而非某个工具包拥有，因为它跨越多个工具。其会话提示词快照携带新块，已在同一次改动中刷新。
