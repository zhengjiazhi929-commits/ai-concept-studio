# 轻薄微磨砂卡片：已认可的静态材质参考

2026-09-09 整合说明：本页保留原候选、认可范围与当时的交付状态；之后用户已另行授权筛选并合并有用代码。当前整合/测试状态见 [STATUS](./STATUS.md)，新片使用边界见 [制作基线](./17-new-video-baseline.md)。原媒体清单与生产 Gate 不回写。

状态：三张静态材质样张已获 Zhengjiazhi 视觉认可；尚未接入正式视频或获得生产发布批准。

## 用户确认与版本绑定：2026-09-08

交付Single/Wide/Flow三张实际PNG后，助手询问“这版的轻薄感和边缘清晰度符合你的预期吗？”，
Zhengjiazhi 回复“可以”。这确认了本版本的静态卡片材质，可作为后续普通内容卡片的复用参考，
不是仅认可参考图，也不扩大为视频动效、全片、任何新布局或Git发布批准。

- 材质ID：`mint-frosted-thin-v001`；组件：`FrostedCard`。
- 候选目录：`outputs/studio/glass-card-preview/candidate-ys7XeP`。
- Git HEAD：`1c6f44e4bc1388bd00f62c9fffc4a6bdd740dd7d`；本地新实现尚未提交，不能只凭HEAD识别版本。
- visualSourceHash：`d567b46a7e84765ec5ce60e7abbe1d10b11894126a049d69eefa9a616c93b1f1`。
- candidateHash：`047b59c32810a8fc0549988bf9a117da2dcfe4925eb75f64e62d80ce4a9812bd`。
- Single PNG：`69a41d665d08eccbf01c310f23e88ac3365b140fbeb9a065259f180aebb6ee8a`。
- Wide PNG：`a73a82419313675e3c2726d438950381d59f506e65e9f5a67f4caa90262f382e`。
- Flow PNG：`affaf0d033b7741301bb9311ebfe4e37290e64746e259118e11be0609c162f66`。

复用时保持薄荷主题、细亮完整四边、柔和投影和清楚的深色文字；内容卡片不加装饰图标，
长文本优先拓宽或撑高。插画对象是否采用该材质取决于表达需要，不能全部强套。
不同画幅、字号、文字量、状态或动画组合仍须独立适配检查。

原PNG、manifest、gallery与生成时visual-review保持不可变；其中待人工审查字段是生成时快照，
本节记录后续真实用户反馈。组件的productionApproved不改为true，也不触碰任何Episode Gate。
接入正式卡片入口、渲染新视频、commit/push/merge仍须对应的任务授权与验收。

## 目标与边界

2026-09-08，Zhengjiazhi 选择第二张参考：轻薄微磨砂、细亮边、柔和投影，保留薄荷主题和清晰深色字。
目标是改善内容卡片材质，不改变知识结构、正文、字号合同和二维插画方向。
本轮仅独立候选组件及三张1080p代码渲染PNG，不改正式视频/旧样片、不接Episode、不调用付费接口、不提交或合并。

风险 R1：独立预览路径，不进入现有渲染器；停止使用新入口即可回退，所有旧来源和媒体保留。
输入为仓库内固定中文示例，不读取生产Episode。通过布局、文本、字体及来源绑定专项和PNG视觉检查后交付用户确认。

## 材质原则

- 整体背景沿用既有浅薄荷，不照搬参考的暖粉配色、白字和强光晕。
- 用细的完整外缘、内高光和有方向的软投影说明厚度；不靠强泛光、大片模糊或深重阴影。
- 透光层与文字层分离，只模糊背景，不模糊文字、不降低整个卡片的透明度。
- 48px卡片标题与36px说明保持清晰；长标题优先拓宽卡片，正文自然换行并撑高，不用省略/裁切/缩字。
- 同级卡片复用同一材质；强调状态只微调薄荷色，不取消边缘，也不加图标或完成勾。
- 普通内容卡片不是插画对象；本材质不自动套到纸页、上下文边界或所有视频元素。
- 高光细边和软阴影的组合、46px圆角来自已指定的玻璃参考，是本候选的明确材质选择；不是全站UI默认风格。

## 实现与验收

- `studio/src/video/glass-card-preview/material.mjs`：候选材质token与受约束的样式函数。
- `cards.jsx`：纯文字FrostedCard、横向关系和三种固定使用场景。
- `root.jsx` / `index.jsx`：三个独立1帧Composition，复用锁定中文字体和既有动态Logo组件。
- 不修改旧illustration-system和production入口；此处静态PNG不能证明动效表现或全片渲染性能。
- 视觉检查针对真实PNG的四边辨识、材质轻薄度、字与底对比、最长内容以及多卡片连线净空。

样式确认只绑定以上实际版本；用户对参考图的选择和随后对生成样张的认可为两个独立事件。
后续接入普通内容卡片时沿用本组件，不重新临时绘制，但不跳过新布局和视频验收。

## 本轮交付与验证

- 最终目录：`outputs/studio/glass-card-preview/candidate-ys7XeP`，三张1920×1080静态PNG和离线画廊，不含MP4。
- sourceHash：`d567b46a7e84765ec5ce60e7abbe1d10b11894126a049d69eefa9a616c93b1f1`；HEAD `1c6f44e4bc1388bd00f62c9fffc4a6bdd740dd7d`。
- 三张图分别覆盖短内容、长标题/两行正文、三个同级卡片与水平流程。它们不是由独立绘图工具临时加工，而是同一FrostedCard组件的实际渲染输出。
- 材质/真实React markup与proof专项共16/16；静态PNG完整像素解码，当前来源前后匹配。
- 主/子代理实际逐张查看：四边、圆角连续可辨，文字清楚无裁切；箭头留在卡间净空，未发现新的可见阻塞。
- Impeccable检查限定两轮：首轮检查三图，修正来源记录后第二轮确认最终三图SHA与已检查图完全一致；不无限重绘。没有改变视觉代码来迎合检查结果。
- 材质是可复现的CSS微磨砂表达，未宣称物理折射或正式视频动效验证；当前只确认宽屏静态显示，未经用户批准不接生产。

运行（在studio下使用锁定Node）：

```sh
node --test tests/glass-card-material.test.mjs tests/glass-card-proof.test.mjs
taskpolicy -b nice -n 20 node scripts/render-glass-card-proof.mjs
```

每次生成新的candidate目录；保留首轮candidate-QzfQZj，不覆盖已存在图片。字体与直接执行包文件、ESM/CJS入口都入指纹；传递依赖仅由锁文件绑定。
