# Facebook 和 X 测试接入

Facebook、X 为额外可选渠道，默认不选；TikTok、Instagram、YouTube 保留原有必选规则。当前只部署测试服。

## 配置与真实联调

1. 在测试服使用的 Upload-Post Profile 连接 Facebook 和 X。
2. Facebook 仅面向公共主页。确认目标 Page ID 后设置服务器环境变量 `UPLOAD_POST_FACEBOOK_PAGE_ID`；不在仓库存放实际凭据。
3. 该 Page ID 会保存到每条提交。批准和失败重试会读取 Upload-Post 当前可访问 Page 及固定主页设置；固定主页与提交目标不一致时拒绝发布。
4. 使用已确认的测试视频，按正常审批流程做真实发布。当前账号尚未连接，自动测试均使用隔离数据库和模拟平台响应，未实际发布。
5. 观察发布状态和下一轮 Analytics 同步。实时真实数据回收的验证仍需已连接账号。

## 发布口径

- Facebook 使用 `facebook_media_type=REELS`，分别发送标题、说明和 Page ID。当前限制为 3–90 秒、9:16、至少 540×960。
- X 使用 `x_title` 拼接标题和文案，按单帖处理，最多 280 加权字符。ASCII 按 1，其余 Unicode 码点保守按 2；不会自动拆成多帖。可关闭文案同步单独编辑 X。
- Upload-Post 默认移除 X 文案中的可点击链接，不能直接把它当作网站链接转化渠道。链接附加服务如需使用，应另外确认。
- 当前 X 视频时长上限按 Upload-Post 标准账号 20 分钟校验。

## 数据回收

- 沿用 15 分钟任务、原生平台视频 ID、发布状态/失败重试和已保存快照流程。
- Facebook 账号级请求携带 `page_id`；页面以 reach 优先展示触达。
- X 页面以 impressions 优先展示曝光，识别 retweets / retweet_count。
- Facebook/X 不加入估算新增粉丝分配。接口没有返回的单视频新增粉丝、收藏或留存均显示缺失，不补 0。
- 看板、视频详情、周报渠道支持五个平台；TikTok 曲线分仍只属于 TikTok。
- 浏览量里程碑通知继续按原三平台真实 views 口径处理，不把 Facebook reach 或 X impressions 当播放量。
- 有机历史视频导入脚本暂维持原三平台；Facebook/X 本次回收覆盖系统发布记录及已有原生 ID 记录。
- 公共主页粉丝总数不能当作单视频新增粉丝；触达、曝光不能描述成统一的视频播放量。

## 验证命令

- `node scripts/verify-facebook-x.cjs`：参数和文案验证。
- `node scripts/verify-facebook-x.cjs --db`：仅允许测试 Lark 应用；创建随机隔离 schema，模拟发布、回收、审批和重试，完成后删除该 schema。
- `node scripts/verify-tiktok-retention.cjs --db`：留存相关回归。
- `npm run build`：构建。

## 官方参考

- https://docs.upload-post.com/api/upload-video/
- https://docs.upload-post.com/api/get-analytics/
- https://docs.upload-post.com/api/facebook-page/
- https://docs.upload-post.com/api/video-requirements/
- https://docs.upload-post.com/resources/character-limits/
