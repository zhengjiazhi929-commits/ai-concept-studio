# 威胁模型与权限矩阵

更新时间：2026-08-25

## 保护目标

1. 操作员身份与五道人审决定。
2. Episode 历史、当前版本、审批哈希和 QA 证据。
3. API Key、Cookie、本地路径和用户数据。
4. Provider 费用、调用次数和结算记录。
5. 本机文件、内网服务、素材与最终媒体。

## 攻击面与控制

| 威胁 | 失败后果 | 控制与验证 |
|---|---|---|
| 网页提示词注入 | 外部文本驱动工具/发布 | 外部内容只进结构化数据；工具允许列表；Agent 无自扩权 |
| SSRF / DNS rebinding / redirect SSRF | 探测内网、云元数据 | 仅 HTTPS；解析全部 IP；拒绝私网/保留地址；每跳重验；有限重定向 |
| 路径穿越 / symlink | 读取秘密或覆盖任意文件 | lexical + realpath 边界；拒绝 symlink；固定根；原子临时文件 |
| 伪造 actor / CSRF | 冒充人类批准或消费费用 | 一次性解锁码、短期 HttpOnly session、SameSite、CSRF；客户端 actor 拒绝 |
| 审批 TOCTOU | 审批后替换素材/声音 | 批准时重读真实字节；绑定版本、bytes、SHA-256、机器报告；CAS 提交 |
| 上传竞争 / 崩溃 | 孤儿文件、状态指向错误版本 | 私有 staging；marker 先于公开 hard-link；上传/恢复共享锁；CAS；已提交文件按 inode/bytes/hash/Episode 元数据复核 |
| Provider 结果提交不明 | 重复扣费或丢失成功结果 | 预算冻结；禁止自动重试；鉴权人工裁决；审计 reconciliation |
| 未知价格 / 配置漂移 | 超预算 | 调用前冻结配置快照；价格未知 fail closed；一次性次数/金额 Capability |
| 日志泄密 | Key/Token 扩散 | 值模式 + 敏感字段名递归脱敏；错误响应同一规则；合成测试秘密 |
| 审计篡改 | 决策与费用不可追责 | sequence + previousHash + hash；读取和追加前验证；损坏即拒绝 |
| 恶意媒体 / 超大文件 | 内存/磁盘耗尽、解析漏洞 | 请求流硬上限；格式头；本地受限 ffprobe/ffmpeg 探测与首帧/首秒解码；轨道、编码、尺寸、像素、时长、文件大小和子进程超时上限 |
| 依赖供应链 | CI/本机执行恶意代码 | frozen lockfile、最小 CI 权限、prod audit high fail、无秘密 PR 运行；当前只完成本地等价门禁，hosted GitHub Actions 尚未运行 |
| 自动发布 | 未批准内容公开 | `autoPublish=false`；无 Publisher 主路径；最终 Gate 后仍需独立发布决定 |

## 工具与人工审批矩阵

| 行为 | 默认权限 | 额外条件 | 人工 Gate |
|---|---|---|---|
| 读取 tracked fixture | 允许 | 路径/Schema 校验 | 无 |
| 抓取公开来源 | 拒绝直到授权 | 网络 Capability、SSRF、大小/超时/速率 | 选题/研究结果仍要审 |
| 模型/图片/TTS Provider | 拒绝直到授权 | Provider/model/scope/次数/费用/TTL 一次性 grant | 对应产物 Gate |
| 本地文件写入 | 拒绝直到授权 | 固定根、操作、Episode、次数、CAS | 产物 Gate |
| 非浏览器服务 Token | 默认禁止 | 仅测试/受控 CLI 显式启用；Provider 裁决永不允许；不得用于浏览器 | 不能替代任何 Gate |
| 本地离线旁白 | 分镜 Gate 后允许生成候选 | 固定 Python/依赖/模型/音色哈希；Python socket API 应用层拒绝；离线环境变量；候选 manifest | 素材/声音 |
| Remotion 渲染 | 只有素材 Gate 后 | 当前上游哈希、版本化输出、低并发 | 最终成片 |
| 发布/删除/覆盖 | 默认禁止 | 独立明确授权与恢复方案 | 最终 Gate 也不自动授权发布 |
| 控制模式升级 | 默认禁止 | 版本绑定评测、真实 shadow、release owner | assisted/active 各自人工决定 |

## 残余风险原则

- localhost 不是身份认证的替代品。
- 自动语义/画面检查不是事实核验或完整主观观看的替代品。
- 签名评测基础设施不等于已经有足够真实 shadow 证据。
- Python socket API 拒绝不是操作系统级沙箱或全机流量取证；`configuredExternalCalls=0`
  只描述本项目生成路径，不证明同机其他进程没有网络。
- ffprobe/ffmpeg 仍是本地原生媒体解析器。当前通过大小、格式、资源、超时和有限解码降低
  暴露面，但没有进程级容器/系统调用沙箱；公开不可信上传前需增加 OS 级隔离并持续跟进补丁。
- 当前 Kokoro 音色包的许可证未被独立核实；候选只可用于本地内部评审，不能据此进行
  公开、商业发布或分发权重。
- 发布到公网前必须重新建模多用户、队列、对象存储和租户隔离。
