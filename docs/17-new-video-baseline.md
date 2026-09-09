# 新视频制作基线

本轮是可复用代码整合，不是把旧视频换标题发布，也不是批准所有素材组合。
2026-09-09，Zhengjiazhi 要求筛选有用改动合并，随后制作完整新视频。实际合并与测试状态以STATUS.md和GitHub当前提交为准。

## 可用模块与入口

在 `studio/` 下使用仓库锁定的Node和pnpm：

| 用途 | 代码 | 验证/预览命令 |
| --- | --- | --- |
| 二维过程插画、20秒按需加载参考 | `src/video/illustration-system/` | `pnpm illustration:proof --stills-only` |
| 微磨砂内容卡片 | `src/video/glass-card-preview/`，`FrostedCard` | `pnpm cards:proof` |
| 加载、调用、路由三组静态分镜 | `src/video/illustration-storyboards/` | `pnpm storyboards:proof` |
| 对象、动作、事实声明与证据绑定 | `src/shared/illustration-system-contract.mjs` | `pnpm illustration:test` |
| 字幕分段与一致节奏 | `src/server/production/subtitle-segmentation.mjs`、`presentation-pacing.mjs` | `pnpm verify` |
| 锁定字体、完整边框、连续水印 | `src/video/load-video-fonts.jsx`、`components/visual-system-v1/` | `pnpm verify` |

`illustration:proof`默认指向已认可方向的20秒二维样例；不加`--stills-only`会生成样例MP4。
`illustration:catalog`保留早期12秒动作例子供开发测试，它们没有自动获得视觉认可。
静态分镜的帧0/1/2是三个独立关键姿态，不是0.1秒动画。
新入口均为独立组件/预览，不会自动替换正式渲染器中的全部卡片或图案。

## 新片必须重新完成的工作

1. 确认主题、受众和主张，核对一手资料；不把旧Agent Skill示例当成新片事实。
2. 写自然语速的讲稿，以内容决定时长，不凑十分钟。
3. 每段先确定解释目标、对象、变化和结果证据，再选文字、卡片或独立插画；复用画风与对象，不机械复制构图。
4. 用真实中文内容和目标画幅检查关键帧，再确认动作时序、旁白、字幕与品牌水印。
5. 完整渲染后做全流机器QA、视觉检查、连续1×观看和人工确认，最后另行决定发布。

普通内容卡片保持纯文字、完整边缘、清晰深色字，长文字拓宽或撑高；不在标题前添加装饰图标。
插画使用纸页、窗口、数据库、数据包和实际分支，不强套玻璃卡片材质；连线只走横竖。
复制保留原件，内容实际进入容器后才算载入，收到返回才显示结果，选中能力不等于任务完成。

## 历史长片工具的边界

现存`render:long-review` / `qa:long-review`及v004系列脚本、render-job示例服务旧Agent Skill长片的恢复与审查。
其中通用长片合同仍固定1920×1080、30fps、18000帧，QA仍有18场旧时序假设。
它们不能直接作为任意新主题、任意时长视频的默认入口。新片需要自己的composition、时长与分段配置，
复用安全发布、来源绑定和解码检查；若推广这些固定合同，应先补回归，再走新的渲染验收。
保留历史工具不构成重新运行旧job的授权；旧生产输入和媒体均不提交。

## 视觉认可与代码版本

原样例的用户认可绑定见 [二维样例](./14-editorial-illustration.md)、[卡片材质](./15-thin-frosted-card.md)、[三组分镜](./16-illustration-storyboards.md)。
整合改变提交、命令和依赖锁的来源指纹时，新验证另记；不能修改旧manifest或把旧哈希冒充新版本。
静态像素一致只说明画面未漂移，不证明动画时序、旁白同步或完整成片合格。
取消的粒子封面、被否定的深色3D空间与知识旅程不属于本制作基线。
