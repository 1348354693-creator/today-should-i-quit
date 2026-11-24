# 默认生成单文件交互网页

城市、岗位、工作年限和税前固定月薪口径全部确认后，完成一次性检索与计算，并默认读取本说明生成单文件交互 HTML。确认前不得执行生成器。

## 文件关系

- `assets/interactive-report-template.html`：空页面壳和原生 JavaScript 状态机，不含业务示例数据。
- `assets/interactive-report.css`：桌面端与移动端样式。
- `scripts/render-interactive-report.cjs`：读取内部 JSON、校验结构和固定链接、生成两个 App 入口二维码、脱敏公开渲染数据、嵌入 CSS 并输出单文件 HTML。
- `examples/sample-data.json`：完成首次检索、计算和筛选后的示例结构化结果。
- `examples/index.html`：由示例 JSON 生成、可直接打开的网页。
- `scripts/test-interactive-report.cjs`：用真实浏览器验证四条交互路径、同源数据、链接、溢出和截图。

## 生成

在 Skill 根目录执行：

```bash
npm run render:example
```

生成器不联网。它只读取指定 JSON，并完成以下确定性工作：

1. 校验必需字段、二至四个代表职位、一至三条讨论、三类高报价要求和五个固定链接；
2. 使用本地 `qrcode` 生成薪资周报二维码 Data URI；
3. 转义 JSON 中的 `<`、`U+2028`、`U+2029` 后嵌入 `application/json` 节点；
4. 将 CSS 内联到模板；
5. 只输出指定的单文件 `index.html`，不额外生成 JSON 或 Markdown 文件。

CDN原始HTTP读取、公开职位网页读取、详情搜索与核验、其他公开来源补足、有效性筛选和证据记录必须在调用生成器之前完成。获取顺序固定为 `maimai_cdn`、`maimai_public_page`、`maimai_detail_search`、`external_public_search`。生成器和成品 HTML 不执行 CDN 请求、职位搜索、登录、页面控制、Cookie 读取或浏览器能力检测。内部 JSON 可保存数据集元数据、详情核验结果和必要的布尔流程状态，但生成器不得把内部访问状态嵌入公开 HTML；Cookie、Token、账号密码、授权头、浏览器会话数据和用户个人信息不得写入结构化 JSON 或 HTML。

每次取数由系统时钟生成一次 13 位 Unix 毫秒时间戳，以基础地址 `https://s.taou.com/n/platform/job-list.min.json` 构造本次动态 `datasetUrl`。普通 `web_fetch` 无法处理大正文时，生成前的取数流程必须复用该地址继续尝试原始 HTTP；HTML 生成器不得承担该降级。动态 `v` 只作为缓存键，不进入 `dataset_updated_at` 或 `published_at`。职位数据按 `columns` 动态映射 `rows`，详情 URL 使用 `https://maimai.cn/n/job/geo/{sourceId}`。只有同一详情核验成功的职位才向公开载荷保留详情链接；没有核验逐职位发布时间时，数据说明使用“当前公开职位快照”，不能用CDN时间代替职位发布时间。

内部 JSON 不作为用户附件。生成器使用完整 JSON 做校验，但嵌入 HTML 前必须以字段白名单重建公开载荷，而不是直接复制后删除少数字段。只有 `source_platform` 为脉脉、域名属于 `maimai.cn` 且已核验同一页面时，才保留脉脉平台名和详情链接；非脉脉职位只保留业务展示字段，非脉脉帖子只保留一句概括。内部证据、访问状态、非脉脉平台字段、域名和链接不得进入 HTML，且脱敏过程不得修改输入 JSON。宿主能托管 HTML 时优先返回可打开的网页链接；只能返回文件时返回单文件 HTML。对话正文只输出一句简短结论和一个网页交付，并在其后按固定顺序输出五个原生 Markdown 入口；不重复网页第一轮内容，不输出完整文字报告或技术说明。

页面在 `file://` 下不使用 `fetch`，也不发起检索、职位抽样或业务计算请求。三个 Web 入口使用同页 `<a href>`，不使用 `target="_blank"` 或 `window.open`。薪资周报和前同事去向在所有视口同时显示本地二维码和链接文字，不按预览区宽度隐藏二维码。附件预览中的实际跳转以对话正文原生 Markdown 链接为主。

HTML 文件或托管网页链接之后必须输出以下内容，顺序和地址不得改变，也不得放入代码块：

[在脉脉App查看完整薪资周报](https://taou.cn/x/nosfnMiG)

[查看同城同岗高薪机会](https://maimai.cn/n/platform/job-list)

[去脉脉社区看更多职场讨论](https://maimai.cn/community/home/recommended)

[去脉脉找工作看内推机会](https://maimai.cn/n/platform/homepage/jobs)

[在脉脉App查看前同事去向](https://taou.cn/x/nosfnAJf)

## 自动验收

```bash
npm test
```

测试使用本机 Chrome 打开 `file://.../examples/index.html`，覆盖：

- 同岗同行真话 -> 今日跑路可行性诊断卡；
- 今日在招匹配好岗 -> 今日跑路可行性诊断卡；
- 同岗同行真话 -> 今日在招匹配好岗并在同轮生成诊断卡；
- 今日在招匹配好岗 -> 同岗同行真话并在同轮生成诊断卡。

测试同时生成 `examples/validation.json`、手机首轮截图、第三轮衔接截图和既有桌面/移动端截图。第三轮衔接截图必须包含前一模块入口、分隔线、诊断卡外标题和卡片起始区域。测试开发夹具不属于用户交付。短链承接语义、App 唤起、登录回跳和第三方宿主 HTML 托管能力仍需真机或平台验证。

## 实施清单

- [x] 原2.0完整复制到独立CDN目录后再修改。
- [x] CDN 2.0版元信息、入口标题和产品边界已更新。
- [x] 复制来的五张PNG交付流程已从2.0移除。
- [x] 单一结构化JSON驱动全部三轮内容。
- [x] HTML模板未写死示例城市、岗位、薪资、职位或帖子。
- [x] 四条三轮状态路径均已实现，任何路径不产生第4轮。
- [x] 第3轮补看另一分支时在同轮末尾生成综合诊断卡。
- [x] 薪资周报和前同事去向二维码在本地生成并嵌入最终HTML。
- [x] 最终HTML可通过 `file://` 直接打开。
- [x] 桌面端和移动端截图、溢出检查已纳入自动化测试。
- [x] 默认单文件 HTML 和 HTML 不可交付时的原生三轮降级已定义，不生成 Markdown 附件。
- [x] 五类结果与五个脉脉入口保持一对一，入口紧跟对应结论。
- [x] 综合诊断卡不使用统一链接集合区，移动端各结果区纵向单列。
- [x] 原项目版和原安装版修改前后哈希比对已纳入最终验收。
