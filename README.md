# MeeDoo Backstage 接手指南

团队短视频后台：Lark 登录 → 上传 → 审批 → 五平台发布 → 定时回收数据 → 数据页与每周核算。技术栈为 Next.js App Router、React、TypeScript、PostgreSQL；通过 Upload-Post 对接社交平台。

## 接手前必读

1. **完整阅读 [AGENTS.md](AGENTS.md)**，遵守测试/正式环境规则。
2. 执行 `git status --short --branch` 和 `git log -5 --oneline`，核对分支及未提交修改，不覆盖其他人的工作。本轮开发沿用 `feature/weekly-work-report`，之后以实际状态为准。
3. 默认只在测试服修改、构建和验证。每次正式发布需要用户明确授权；授权不会延续到下一次发布。
4. 密码、API Key、OAuth Token、数据库连接串不写入源码、文档、日志或 Git。
5. 此文描述仓库代码，不代表服务器部署状态；核对 `/opt/meedoo/.deployed-revision` 和实际源码才能确认上线版本。

## 环境与启动

| 环境 | 地址                                         | 用途                 |
| ---- | -------------------------------------------- | -------------------- |
| 测试 | `backstagetest.meedoo.fun` / `69.164.253.58` | 默认开发、构建、验证 |
| 正式 | `backstage.meedoo.fun` / `162.35.168.250`    | 每次发布须明确授权   |

- 项目目录：`/opt/meedoo`；环境文件：`/etc/meedoo/meedoo.env`。
- 服务：`meedoo.service`；同步：`meedoo-sync.timer` / `meedoo-sync.service`。
- 测试 Lark App ID 必须是 `cli_aa1a6845a1f8de15`，不得与正式凭据混用。
- 需要 Node.js、pnpm（版本见 `package.json`）、PostgreSQL、`ffprobe`；服务器另使用 Nginx、systemd。

本地使用独立测试数据库及凭据，将 `.env.example` 复制为未跟踪的 `.env.local` 并填写：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

主要环境变量：

| 变量                                                          | 用途                                        |
| ------------------------------------------------------------- | ------------------------------------------- |
| `APP_URL`                                                     | 当前环境公开地址，影响回调和媒体链接        |
| `LARK_APP_ID`、`LARK_APP_SECRET`、`LARK_SCOPES`、`LARK_BRAND` | Lark OAuth                                  |
| `SESSION_SECRET`、`LARK_AUTH_REQUIRED`                        | 会话与认证开关                              |
| `DATABASE_URL`                                                | 当前环境数据库                              |
| `UPLOAD_POST_API_KEY`、`UPLOAD_POST_PROFILE`                  | 发布和取数                                  |
| `UPLOAD_POST_FACEBOOK_PAGE_ID`                                | Facebook 目标公共主页，五平台提交前必须配置 |
| `UPLOAD_POST_WEBHOOK_SECRET`、`CRON_SECRET`                   | Webhook、同步接口认证                       |
| `UPLOAD_POST_HISTORY_AFTER`                                   | 历史同步下界                                |
| `MEEDOO_MEDIA_DIR`、`MEDIA_URL_SECRET`                        | 视频存储与签名链接                          |
| `LARK_NOTIFY_ENABLED`、`LARK_BASE_APP_TOKEN`                  | 通知、可选 Base 操作                        |

直接由 Node 执行的脚本不会自动读取 Next.js 的 `.env.local`，运行前需由受控环境注入变量，勿在命令输出中打印秘密值。

## 目录与模块

```text
app/
  upload/                    上传页
  approvals/                 审批列表、单条审批
  records/                   上传与审核历史
  dashboard/                 Video Data、视频详情
  weekly-report/             规则、核算、转化
  login/                     登录入口
  api/                       服务端接口
  layout.tsx                 全局布局、Provider、样式加载顺序
  globals.css                公共组件及页面补充样式
components/
  upload/
    use-upload-workflow.ts   文件/表单状态与提交编排
    upload-transport.ts      断点续传、分片重试与合并
    use-platform-connection.ts  平台连接检查
    platform-content-form.tsx   共用/独立文案表单
    upload-model.ts          上传界面类型、常量、结果转换
  app-shell.tsx              导航、通知
  auth-provider.tsx          浏览器登录状态
  language-provider.tsx      中英文切换
  tiktok-retention-chart.tsx 留存曲线
lib/                         业务、数据库和平台接入
styles/
  base.css                   基础布局与原始公共样式
  team-performance.css       团队/个人表现，含历史排行榜样式
  video-data.css             数据列表、筛选与指标样式
scripts/                     验证、历史导入、归因重算
deploy/                      Nginx/systemd 模板
docs/                        专项说明、历史发布记录
```

`lib/` 不全是浏览器代码。只有 `social-platforms.ts`、`upload-title.ts` 等无秘密、无数据库依赖的纯函数可以在前端使用。平台密钥和数据库访问必须留在服务端。

| 模块          | 核心文件（均在 `lib/` 下，除注明外）                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| 登录/权限     | `auth.ts`、`server-auth.ts`、`safe-return-to.ts`、根目录 `proxy.ts`                          |
| 上传/媒体     | `upload-staging.ts`、`video-probe.ts`、`media-url.ts`                                        |
| 五平台文案    | `social-platforms.ts`、`platform-content.ts`                                                 |
| 审批/发布     | `approvals.ts`、`publish-approved.ts`、`social-publish-fields.ts`、`facebook-destination.ts` |
| 状态/记录     | `publication-status.ts`、`records.ts`                                                        |
| 平台请求/同步 | `upload-post.ts`、`upload-post-sync.ts`、`profile-analytics.ts`                              |
| 数据页/缓存   | `dashboard-data.ts`、`dashboard-cache.ts`                                                    |
| 视频详情      | `video-detail-data.ts`                                                                       |
| 粉丝归因      | `follower-history.ts` 及各数据汇总模块                                                       |
| TikTok 留存   | `tiktok-retention.ts`、`tiktok-retention-backfill.ts`                                        |
| 原有评分兼容  | `equivalent-retention.ts`，不能当作废代码直接删除                                            |
| 周报/核算     | `weekly-report-data.ts`、`libtv-accounting.ts`                                               |
| 通知/维护     | `notifications.ts`、`video-milestones.ts`、`maintenance.ts`、`cleanup-file.ts`               |
| 数据库        | `db.ts`：连接、事务、幂等结构初始化                                                          |

## 关键流程与规则

### 视频生成（MiniMax H3）

视频流程中的 `/generate` 支持参考图、首尾帧、提示词、时长、比例、清晰度和成片预览下载。国内站密钥通过服务器 `MINIMAX_API_KEY` 配置，前端不配置或接触密钥。任务绑定登录员工及需求名称，保存平台实际返回的 Token/秒数；费用按国内单价快照预估，缺失用量不填零。生成不会自动发布，下载后走原上传审批流程。

入口：`app/generate/page.tsx`；服务端：`lib/generation.ts`；参考图缓存：`lib/generation-minimax-files.ts`；模型适配：`lib/generation-provider.ts`（MiniMax H3、Seedance 2.0／2.5）；纯参数与计费规则：`lib/generation-model.ts`；接口：`app/api/generation/`；样式：`styles/generation.css`。任务/素材保存在 `generation_tasks`、`generation_assets`，生成成片保存 14 天后自动清理，记录与用量保留；已提交到上传流程的视频仍长期保存。需要安装独立 `meedoo-generation.timer`，在浏览器关闭后继续回收任务。上线配置、异常任务对账与验证方法见 [MiniMax 接手说明](docs/minimax-generation.md)。

### 上传、审批、发布

1. `/api/uploads/init` 创建会话，通过 `/api/uploads/[id]/chunks/[index]` 上传分片，`/complete` 合并并校验视频。
2. `/api/upload-post/publish` 创建待审批记录，**此时不对外发布**。
3. Approver 批准后，`publish-approved.ts` 才向 Upload-Post 提交签名媒体链接及文案。
4. 轮询、Webhook、定时同步回收状态并保存 Provider ID、平台原生 ID 和链接。

- 最大 1.5 GB、16 MB 分片，支持断点续传；视频要求竖屏 9:16，另有平台限制。
- 新提交使用服务器启用的平台，默认共用文案，可关闭同步独立编辑。五个平台分别通过 `MEEDOO_PLATFORM_TIKTOK_ENABLED`、`MEEDOO_PLATFORM_INSTAGRAM_ENABLED`、`MEEDOO_PLATFORM_YOUTUBE_ENABLED`、`MEEDOO_PLATFORM_FACEBOOK_ENABLED`、`MEEDOO_PLATFORM_X_ENABLED` 控制；未配置默认启用，`true/1/on` 启用，其他显式值关闭。修改 `/etc/meedoo/meedoo.env` 后重启服务生效，不需重建前端。正式服目前 Facebook/X 为 `false`，测试服保留五个平台。关闭的平台从上传入口、数据筛选与分布中隐藏，并禁止新提交、审批发布和重试；历史记录和数据同步保留。旧五平台待审批记录如含关闭平台，必须先处理目标平台或重新启用，不能静默漏发。
- 历史三平台记录继续兼容，不应强制补为五平台重新发布。
- Facebook 固定目标 Page ID，X 限制为单帖，细节见 [Facebook/X 接入](docs/facebook-x.md)。
- 重试结果不明确时保持待核对状态，不能盲目再次发布，避免重复帖。
- 已提交视频长期保存，包括待审批、驳回、撤回、已发布。只清理过期且未提交的会话/分片；不要恢复旧版 3/7/60 天删除策略。

### 数据回收与页面

`meedoo-sync.timer` 每 15 分钟调用 `/api/upload-post/sync`，回收历史、发布状态、视频与账号指标，处理维护任务并刷新数据页缓存。数据库锁防止完整同步重叠。

Analytics 按最久未尝试记录轮转，每轮最多 80 条并有时间预算。因此每 15 分钟调度不等于所有视频每 15 分钟更新成功。

数据页读服务端预计算缓存（1/7/30/90/365 天），同步后刷新，接口也有冷启动和过期刷新路径。不要改为每次打开页面重新请求 Provider 或在浏览器计算整套归因。

### 指标口径

- **粉丝归因**：直接视频新增粉丝优先；估算使用账号历史高水位正向增量，按发布后 96 小时内符合条件视频的播放增量分配。无播放增量不分配。Facebook/X 没有直接数据时不套用估算。
- **YouTube**：账号订阅总数变化不能替代视频 `subscribersGained/subscribersLost`。Google OAuth / YouTube Analytics 直接接入仍暂停，未经要求不要恢复。
- **TikTok 留存**：真实留存曲线面积 ÷ 视频时长 × 100。末尾缺口严格小于 1 秒且至少有两个采样点时，沿用最后点补齐积分，并标注近似秒数；不补画采样点。中间缺口或末尾缺少至少 1 秒仍不评分。算法 v2，上线须重算历史存储结果并刷新缓存。缺失显示不可用，不用零或推测曲线填充。完成率、3 秒留存、曲线评分分开展示。历史曲线取决于 Provider 权限和返回数据。
- **综合评分**：保留原有观看质量的兼容计算，新增曲线不意味着修改奖金权重。
- **曝光口径**：Facebook/Instagram 优先 reach，X 优先 impressions，不应将平台字段解释为完全相同的播放次数。
- **排行榜**：入口暂时隐藏，共用样式/计算仍可能有引用，删除前须检查。

### 周报与 LIBTV

- 周期为新加坡时区周一至周日；审批摘要另按 Puerto Rico 时区执行，不要混淆。
- 人民币成本 = 创作积分 × 649 ÷ 16,300。
- 统计全部成员创作积分，排除 `member_id = 0` 系统每日清零；文件和记录均有去重。
- 批准视频取自 `uploads`：`review_status = 'approved'`、`removed_at IS NULL`、`created_at` 在所选周内。不是 CSV 任务数，也不是审批时间。
- 只有 approver 可上传 CSV；成员对应关系只在服务器配置文件维护，页面只读展示，旧 `action=map` API 已禁用。

### Accounting 成员对应配置

实际配置：`/etc/meedoo/libtv-member-mappings.json`，可用 `LIBTV_MEMBER_MAPPINGS_FILE` 指定其他绝对路径。仓库的 `config/libtv-member-mappings.example.json` 仅为示例，不能直接作为真实配置使用。

- 首次部署前，载入该服务器的环境后执行 `pnpm accounting:mappings:export`，将其 `libtv_member_mappings` 原样导出；不会覆盖已有文件或修改旧表。正式环境仍需明确发布授权。
- `memberId` 对应 LIBTV CSV 的成员 ID，`uploaderOpenId` 对应网站 `meedoo_users.open_id`；两种 ID 都是字符串，目前按一对一映射校验。`memberName`、`uploaderName` 只供维护者辨认，重命名不影响匹配。Haniya → Yihan Liang、XiaoAn → 小安的正式映射在正式部署时从正式数据库导出，不能复制测试环境的用户 ID。
- 配置实时从服务端读取，修改后刷新 Accounting 即生效，无需重建或重启。先写临时文件、校验 JSON 后原子替换，保留部署前备份和服务可读的私有权限。
- 未配置成员不自动按姓名归并；仅明确 ID 映射参与个人视频分摊。空列表表示没有映射。丢失/损坏文件、重复成员 ID 或网站用户 ID、无效网站用户会使接口报错，不静默退回旧表，避免核算用错人。
- 配置留在 `/etc/meedoo`，不要随源码覆盖；旧数据库表保留供回滚及审计，应用不再读取或写入它。

## 数据表

| 表                                                   | 用途                        |
| ---------------------------------------------------- | --------------------------- |
| `meedoo_users`                                       | 用户与角色                  |
| `uploads`、`upload_reviews`                          | 视频、归属、审批审计        |
| `upload_sessions`、`upload_session_chunks`           | 临时上传、续传              |
| `publications`                                       | 每个平台发布 ID、状态、链接 |
| `metric_snapshots`、`profile_metric_snapshots`       | 视频/账号指标历史           |
| `publication_follower_attributions`                  | 归因记录                    |
| `webhook_deliveries`、`notifications`                | 回调去重、通知队列          |
| `maintenance_state`                                  | 缓存版本及维护状态          |
| `libtv_imports`、`libtv_credit_entries`              | CSV 导入与积分              |
| `libtv_accounting_settings`、`libtv_member_mappings` | 核算设置与成员映射          |

`db.ts` 的 `ensureSchema()` 当前负责幂等建表/加字段，有进程内缓存。它不是完整版本化迁移系统。结构修改需要考虑旧版兼容、数据库备份与回滚；独立迁移体系留待后续建设。

## 修改与验证

```bash
pnpm format
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

- `format` / `format:check`：Prettier 格式化/检查。
- `typecheck`：TypeScript；`lint` 是兼容别名，不代表 ESLint。
- `test`：留存计算、五平台契约验证，模拟外部发布请求。
- `test:integration`：仅在测试环境运行，覆盖可靠性、留存回填、五平台数据库行为，使用隔离 schema 并清理，需要测试数据库权限和环境变量。
- `verify-analytics-performance.cjs` 是专项性能脚本，只有相关修改或排障才运行，不必每次发布测速。

现有脚本不是完整端到端测试。上传改动还应检查分片续传、必填校验、缺少连接时禁用提交、审批状态；未经授权不要为了测试发布真实帖子。

### 发布与回滚

1. 确认主机、分支、当前版本和未提交修改。
2. 独立 staging 目录准备候选源码，按锁文件安装依赖，在测试服构建并运行相关检查。
3. 在受控 `.deploy-backups` 备份源码、构建产物和数据库，不将密钥放入可公开归档。
4. 部署已验证源码与构建，必要时执行兼容结构更新，再重启测试服务。
5. 验证相关页面/接口、`meedoo.service` 与 `meedoo-sync.timer`，失败恢复备份。回滚代码不会自动撤销数据库变更。
6. 记录版本、备份、结果。用户明确要求后才发布正式服，之后恢复测试优先。

`deploy/` 是配置模板，不是完整自动部署工具；不要把工作目录中的一次性脚本当成通用发布入口，它们可能固定旧提交和文件清单。

## 故障排查入口

| 现象                  | 先查                                                              |
| --------------------- | ----------------------------------------------------------------- |
| 上传按钮不可用        | 五平台连接、Facebook Page、文案长度、登录和视频校验               |
| 发布长时间处理中      | publication、Provider request ID、Webhook、同步结果，避免重复发布 |
| 数据未更新            | timer、最新快照、轮转、缓存版本                                   |
| TikTok 无曲线         | `profile_analytics` 能力、Provider 返回；重新连接后再验证历史视频 |
| YouTube 新增粉丝不同  | 直接指标还是估算，有无误用账号总量                                |
| Accounting 视频数不同 | 创建时间、审批状态、软删除、成员映射、新加坡周界                  |

## 进一步阅读与待整理项

- [Lark 配置](docs/lark-setup.md)
- [Facebook/X](docs/facebook-x.md)
- [性能审查](docs/performance-review-2026-09-14.md)
- [可靠性发布记录](docs/reliability-release-2026-09-14.md)
- [历史待办](TODO.md)：包含历史口径，以本 README、当前代码和用户最新要求为准。

历史导入脚本只覆盖原有三平台，默认 dry-run。`history:apply`、`followers:apply` 会写库；Lark Base 的 `--reset-lark` 会替换表，不作为日常部署步骤。执行前阅读脚本和输出报告，并确认目标环境及授权。

后续逐步拆分数据查询与指标汇总、同步任务，建立版本化迁移及翻译字典。结构整理不应同时改变指标、奖金或发布规则。

每次交接记录分支/提交、变更目的、验证项目、两台服务器版本、备份位置、未完成项及需要的账号权限；不记录秘密值。

MiniMax 参考图在选图后同步到平台，默认保留原图；超过 5 MB 时可选择压缩到约 1 MB 后上传；缩略图下可查看状态并重试。实现及排障见 [生成模块文档](docs/minimax-generation.md#reference-pre-upload-2026-09-16)。

## 视频素材生图

视频生成页右侧的 Seedream 图片工作台支持 2K 文生图、上传图编辑和连续修改；操作、后台队列和接手说明见 [Seedream image studio](docs/seedream-image-studio.md)。

生成记录：视频流程只显示个人视频/图片历史（含审批人），支持分页；数据看板下的 `/generation-history` 提供审批人可见的团队视频和图片记录、类型筛选、预览及下载。详见 [生成记录说明](docs/seedream-image-studio.md#生成记录入口与分页)。

## Assignment System

任务创作入口 `/assignments`：需求 → 摘要 → 故事板（生成／上传）→ 分镜 → 逐镜视频生成 → ZIP 下载。模块、权限、模型配置和验证说明见 [docs/assignments.md](docs/assignments.md)。

任务系统开关：`/etc/meedoo/features.json` 的 `assignments`（布尔值）。正式服暂设为 `false`，测试服为 `true`；开关同步控制导航、页面和任务 API，缺少配置默认关闭。详见 [任务系统说明](docs/assignments.md)。手机端通过顶部“菜单”打开完整导航，相关实现为 `components/app-shell.tsx` 与 `styles/base.css`。
