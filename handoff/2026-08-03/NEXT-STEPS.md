# 下一步执行清单

## A. 先完成云端闭环

- [ ] 请用户在 OneDrive 桌面窗口完成微软账号登录；
- [ ] 确认实际同步根目录，预期为 `C:\Users\User\OneDrive`；
- [ ] 在 OneDrive 内创建 `AI Concept Studio` 素材目录；
- [ ] 创建本机文件 `studio/config/cloud-backup.local.json`，将 `mediaRoot` 指向该目录；
- [ ] 运行 `pnpm run cloud:backup`；
- [ ] 核对成片、素材和 `backup-manifest.json` 已进入 OneDrive；
- [ ] 等待 OneDrive 显示同步完成；
- [ ] 核对 `GET /api/cloud` 返回 `protected`；
- [ ] 确认控制台顶部显示“代码与视频已云端备份”。

不要把 `cloud-backup.local.json` 提交到 GitHub。

## B. 制作第一个非黄金样例

- [ ] 运行一次创作者信号采集；
- [ ] 刷新热点概念雷达；
- [ ] 只从正式候选池选择概念；
- [ ] 人工确认该概念确实被多个主流创作者近期讨论；
- [ ] 启动 Research Agent；
- [ ] 补齐定义、背景、机制、对比、边界、产品影响和产品决策的官方证据；
- [ ] 解决关键冲突并人工批准事实。

## C. 继续建设 Agent

推荐顺序：

1. Script Agent：只允许使用已批准证据包；
2. Storyboard Agent：落实真实产品纪录片视觉；
3. Asset Agent：生成真实录屏与图表素材清单；
4. Voice Agent：选择可长期使用的中文旁白方案；
5. Render Agent：升级为 8～12 分钟模板；
6. QA Agent：加入事实—字幕—画面一致性检查；
7. 周期调度：支持每周 2～3 条，但发布保持人工确认。

每新增一个模块，都要先用黄金样例回归，再接入真实选题。

