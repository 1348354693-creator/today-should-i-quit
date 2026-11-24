#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright-core");
const {
  buildDiscussionKeywords,
  buildDiscussionSearchPlan,
  discoverDiscussions,
  rejectReason
} = require("./discussion-search-policy.cjs");
const {
  ACQUISITION_METHODS,
  DEFAULT_POLL_INTERVAL_MS,
  JOB_LIST_URL,
  LOGIN_PROMPT,
  LOGIN_WAIT_MS,
  MAIMAI_CDN_BASE_URL,
  POST_LOGIN_LIST_WAIT_MS,
  REQUIRED_CDN_COLUMNS,
  assertNoCredentialFields,
  buildMaimaiCdnUrl,
  buildMaimaiDetailUrl,
  calculateAverageMonthlySalary,
  classifyPublicFailure,
  detailMatchesCandidate,
  isMaimaiCdnUrl,
  isMaimaiJobDetailUrl,
  isVerifiedMaimaiJob,
  monthlySalaryMidpoint,
  parseCdnDataset,
  parseSalaryText,
  selectFeaturedJobs,
  runJobAcquisition
} = require("./job-acquisition-policy.cjs");

const ROOT = path.resolve(__dirname, "..");
const FIXED_TEST_TIMESTAMP = 1763265600123;
const FIXED_TEST_CDN_URL = buildMaimaiCdnUrl(FIXED_TEST_TIMESTAMP);
const FIXED_LAST_MODIFIED = "2026-11-06T09:52:02Z";
const DATA_PATH = path.join(ROOT, "examples", "sample-data.json");
const INDEX_PATH = path.join(ROOT, "examples", "index.html");
const VALIDATION_PATH = path.join(ROOT, "examples", "validation.json");
const SCREENSHOT_DIR = path.join(ROOT, "examples", "screenshots");
const FIXED_LINKS = [
  "https://taou.cn/x/nosfnMiG",
  "https://maimai.cn/n/platform/job-list",
  "https://maimai.cn/community/home/recommended",
  "https://maimai.cn/n/platform/homepage/jobs",
  "https://taou.cn/x/nosfnAJf"
];
const CTA_MAP = {
  salary_weekly: FIXED_LINKS[0],
  high_salary_jobs: FIXED_LINKS[1],
  peer_discussions: FIXED_LINKS[2],
  referral_network: FIXED_LINKS[3],
  former_colleagues: FIXED_LINKS[4]
};
const WEB_ENTRY_KEYS = ["high_salary_jobs", "peer_discussions", "referral_network"];
const APP_ENTRY_KEYS = ["salary_weekly", "former_colleagues"];
const DELIVERY_LINKS = [
  { label: "在脉脉App查看完整薪资周报", url: FIXED_LINKS[0] },
  { label: "查看同城同岗高薪机会", url: FIXED_LINKS[1] },
  { label: "去脉脉社区看更多职场讨论", url: FIXED_LINKS[2] },
  { label: "去脉脉找工作看内推机会", url: FIXED_LINKS[3] },
  { label: "在脉脉App查看前同事去向", url: FIXED_LINKS[4] }
];
const FORBIDDEN_PUBLIC_SOURCES = ["猎聘", "职友集", "BOSS直聘", "智联招聘", "前程无忧", "liepin.com", "jobui.com", "zhipin.com", "zhaopin.com", "51job.com"];
const EVIDENCE_SUMMARY_PATTERN = /该帖子讨论了|这篇帖子讨论了|发帖人表示|帖子提到/;
const FORBIDDEN_DISCUSSION_HOOK_PATTERN = /他最后会怎么选|后来怎么样了|原因竟然是这个|看看避坑指南|真相让人意外|结果所有人都没想到/;
const FINAL_OUTRO = "恭喜完成今日“电子裸辞”体验！人可以先继续搬砖，心记得每天过来刷刷同岗新报价和好机会";
const PATHS = [
  { name: "peer_to_final", firstAction: "peer", secondAction: "finish-from-peer", expectedSecondBranch: null },
  { name: "jobs_to_final", firstAction: "jobs", secondAction: "finish-from-jobs", expectedSecondBranch: null },
  { name: "peer_to_jobs_and_final", firstAction: "peer", secondAction: "jobs-after-peer", expectedSecondBranch: "jobs" },
  { name: "jobs_to_peer_and_final", firstAction: "jobs", secondAction: "peer-after-jobs", expectedSecondBranch: "peer" }
];
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "narrow", width: 360, height: 800 },
  { name: "doubao-preview", width: 520, height: 900 },
  { name: "desktop", width: 1440, height: 1000 }
];

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("未找到可用的 Chrome、Edge 或 Chromium");
  return found;
}

function assertStaticSourceContracts() {
  const template = fs.readFileSync(path.join(ROOT, "assets", "interactive-report-template.html"), "utf8");
  const renderer = fs.readFileSync(path.join(ROOT, "scripts", "render-interactive-report.cjs"), "utf8");
  const skill = fs.readFileSync(path.join(ROOT, "SKILL.md"), "utf8");
  const evidenceRules = fs.readFileSync(path.join(ROOT, "references", "evidence-rules.md"), "utf8");
  const testCases = fs.readFileSync(path.join(ROOT, "references", "test-cases.md"), "utf8");
  const reportTemplate = fs.readFileSync(path.join(ROOT, "references", "report-template.md"), "utf8");
  const generationRules = fs.readFileSync(path.join(ROOT, "references", "interactive-report-generation.md"), "utf8");
  const jobPolicy = fs.readFileSync(path.join(ROOT, "scripts", "job-acquisition-policy.cjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const css = fs.readFileSync(path.join(ROOT, "assets", "interactive-report.css"), "utf8");
  const dynamicCdnContract = [skill, evidenceRules, generationRules, testCases, jobPolicy, renderer].join("\n");
  const popupPattern = /window\.open\s*\(|target\s*=\s*["']_blank|\.target\s*=\s*["']_blank/;

  assert.equal(path.basename(ROOT), "salary-level-assessment-v2-cdn2", "新Skill目录名不正确");
  assert.ok(skill.includes("name: salary-level-assessment-v2-cdn2"), "Skill技术名称未更新");
  assert.ok(skill.includes('display_name: "今日宜离职跑路吗"'), "Skill展示名称未更新");
  assert.ok(skill.includes('entry_title: "心疼老己每一天！输入城市、岗位、工作年限和税前固定月薪，看同岗报价、好岗与真话，测测今天适不适合跑路"'), "Skill入口标题未更新");
  assert.ok(skill.includes("# 今日宜离职跑路吗 CDN 2.0版"), "Skill一级标题未更新");
  assert.ok(skill.includes("入口说明：心疼老己每一天！输入城市、岗位、工作年限和税前固定月薪，看同岗报价、好岗与真话，测测今天适不适合跑路"), "Skill入口说明未更新");
  assert.equal(packageJson.name, "salary-level-assessment-v2-cdn2", "package.json包名未更新");
  assert.equal(packageLock.name, "salary-level-assessment-v2-cdn2", "package-lock.json包名未更新");
  assert.equal(packageLock.packages?.[""]?.name, "salary-level-assessment-v2-cdn2", "锁文件根包名未更新");
  [
    "<title>今日宜离职跑路吗</title>",
    "同岗报价、好岗与真话｜最多3轮",
    "今日在职性价比",
    "高薪的坑位都在挑什么人？",
    "带薪摸鱼1分钟，继续看看真话与好岗",
    "1 听同岗同行真话",
    "2 看今日在招匹配好岗",
    "同岗同行真话速览：",
    "今日在招匹配好岗速览：",
    "今日跑路可行性诊断卡",
    "今日宜离职跑路吗？先看这份行情底牌",
    FINAL_OUTRO
  ].forEach((text) => assert.ok(template.includes(text), `网页模板缺少固定文案：${text}`));
  assert.ok(template.includes('create("h2", "", data.result.headline)'), "首轮评估标题必须继续读取data.result.headline");
  assert.ok(template.includes('create("h2", "final-section-heading", "今日跑路可行性诊断卡")'), "诊断卡外标题必须使用final-section-heading");
  assert.match(css, /\.bubble h2\.final-section-heading\s*\{[\s\S]*?margin:\s*32px 0 16px;[\s\S]*?padding-top:\s*24px;[\s\S]*?border-top:\s*1px solid var\(--line\);[\s\S]*?\}/, "诊断卡分隔样式不完整");
  assert.ok(reportTemplate.includes("只作为界面包装") && testCases.includes("不得生成离职评分"), "文档必须限定跑路包装文案的真实性边界");

  assert.equal(popupPattern.test(template), false, "模板不得新开窗口");
  assert.equal(popupPattern.test(renderer), false, "生成器不得注入新开窗口行为");
  assert.equal(/renderFallback|fallback\.md/.test(renderer), false, "HTML生成器不得输出Markdown附件");
  assert.equal(fs.existsSync(path.join(ROOT, "examples", "fallback.md")), false, "示例目录不应保留Markdown交付物");
  assert.ok(skill.includes("默认生成单文件交互 HTML"), "SKILL必须明确默认生成单文件HTML");
  assert.ok(skill.includes("薪资口径确认前不得搜索、计算、生成结构化 JSON 或生成网页"), "SKILL必须禁止口径确认前执行");
  assert.ok(skill.includes("25K是税前固定月薪吗？是否包含奖金、补贴、股票或其他收入？") || testCases.includes("25K是税前固定月薪吗？是否包含奖金、补贴、股票或其他收入？"), "验收契约必须包含精确薪资口径追问");
  assert.ok(skill.includes("HTML 文件或托管网页链接之后按固定顺序输出五个原生 Markdown 链接"), "SKILL必须定义HTML后的五个Markdown入口");
  assert.equal(skill.includes("单文件 HTML 是唯一用户可见文件"), false, "SKILL不得继续要求HTML是唯一用户可见内容");
  assert.equal(skill.includes("对话正文不单独展示这两个入口"), false, "SKILL不得禁止对话正文展示App入口");
  assert.equal(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.app-entry-desktop\s*\{[^}]*display:\s*none/.test(css), false, "640px媒体查询不得隐藏App二维码");
  assert.equal(/\.app-entry-desktop\s*\{[^}]*display:\s*none/.test(css), false, "任何样式都不得隐藏App二维码容器");
  assert.equal(template.includes("app-entry-mobile"), false, "App入口不得再按宽度拆分为移动端替代内容");
  assert.equal(css.includes(".app-entry-mobile"), false, "CSS不得保留按宽度切换App入口的旧规则");
  DELIVERY_LINKS.forEach(({ label, url }) => {
    const markdown = `[${label}](${url})`;
    assert.ok(skill.includes(markdown), `SKILL缺少原生Markdown入口：${label}`);
    assert.ok(reportTemplate.includes(markdown), `报告模板缺少原生Markdown入口：${label}`);
    assert.ok(generationRules.includes(markdown), `生成说明缺少原生Markdown入口：${label}`);
    assert.ok(testCases.includes(markdown), `验收案例缺少原生Markdown入口：${label}`);
  });
  const fencedBlocks = [...skill.matchAll(/```[\s\S]*?```/g)].map((match) => match[0]).join("\n");
  DELIVERY_LINKS.forEach(({ url }) => assert.equal(fencedBlocks.includes(url), false, `最终交付Markdown链接不得写入代码块：${url}`));
  const deliveryStart = skill.indexOf("> 评估完成：");
  const deliveryEnd = skill.indexOf("不要展示或附加", deliveryStart);
  assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart, "SKILL缺少可校验的最终回复示例");
  const deliveryExample = skill.slice(deliveryStart, deliveryEnd);
  const markdownLinks = [...deliveryExample.matchAll(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/gm)].map((match) => ({ label: match[1], url: match[2] }));
  assert.deepEqual(markdownLinks, DELIVERY_LINKS, "最终回复示例中的五个Markdown链接标签、地址或顺序错误");
  assert.equal(deliveryExample.includes("```"), false, "最终回复示例不得使用代码块");
  ["HTML渲染校验通过", "证据规则校验通过", "数据脱敏完成", "二维码完整", "环境无浏览器", "测试结果", "技术实现说明", "JSON一致性", "无网络请求", "交叉验证过程"].forEach((text) => {
    assert.equal(deliveryExample.includes(text), false, `最终回复示例不得包含技术文案：${text}`);
  });
  assert.equal(/复制链接|点击图片|点击查看/.test(template), false, "HTML不得制造虚假图片交互或复制按钮");
  assert.ok(skill.includes("只有宿主明确不支持文件或 HTML、HTML 生成失败，或者宿主无法返回网页文件或托管链接时"), "SKILL必须限定原生对话降级条件");
  assert.equal(skill.includes("默认在当前对话原生交付"), false, "SKILL不得保留默认原生对话旧规则");
  assert.equal(skill.includes("仅在用户主动要求"), false, "SKILL不得保留主动要求才生成HTML的旧规则");
  assert.equal(MAIMAI_CDN_BASE_URL, "https://s.taou.com/n/platform/job-list.min.json", "CDN基础地址错误");
  assert.equal(new URL(MAIMAI_CDN_BASE_URL).search, "", "CDN基础地址不得带固定参数");
  assert.ok(skill.includes(MAIMAI_CDN_BASE_URL) && evidenceRules.includes(MAIMAI_CDN_BASE_URL), "文档必须记录稳定CDN基础地址");
  assert.ok(skill.includes("Unix 毫秒时间戳") && evidenceRules.includes("复用同一个完整地址"), "文档必须定义动态时间戳和单次运行复用");
  assert.equal(dynamicCdnContract.includes("v" + "=2"), false, "源码和文档不得保留固定版本参数");
  assert.equal(/\b[1-9]\d{12}\b/.test([skill, evidenceRules, generationRules, jobPolicy, renderer].join("\n")), false, "生产源码和文档不得写死示例时间戳");
  assert.ok(evidenceRules.includes("每个 `rows` 元素必须按 `columns` 动态映射"), "证据规则必须定义动态列映射");
  assert.ok(evidenceRules.includes("不能代替 `published_at`") && reportTemplate.includes("当前公开职位快照"), "数据集时间不得代替职位发布时间");
  assert.ok(testCases.includes("CDN下载失败") && testCases.includes("maimai_detail_search") && testCases.includes("external_public_search"), "验收案例必须覆盖四级降级");
  assert.ok(evidenceRules.includes("前三层脉脉有效职位不足时才调用"), "脉脉职位不足时才可使用其他公开来源");
  assert.ok(evidenceRules.includes("人物背景 -> 具体数字、现实反差或核心问题 -> 可选的真实钩子"), "证据规则必须定义同行概括顺序");
  assert.ok(reportTemplate.includes("HTML 和降级文字对话必须直接读取同一份内部 JSON 中的 `discussions[].summary`"), "网页和文字降级必须使用同一份同行概括数据");
  assert.ok(evidenceRules.includes("路径级 `site:`") && evidenceRules.includes("域名级 `site:maimai.cn") && evidenceRules.includes("普通公开搜索"), "证据规则必须定义三级公开搜索");
  assert.ok(evidenceRules.includes("城市只作最后的排序加分"), "城市不能作为帖子硬门槛");
  assert.ok(evidenceRules.includes("sitemap lastmod") && evidenceRules.includes("不能用 `lastmod` 代替发帖时间"), "证据规则必须区分lastmod和发布时间");
  assert.ok(reportTemplate.includes("展示一至三条"), "报告模板必须允许一至三条同行内容");
  assert.ok(skill.includes("请在90秒内使用脉脉App扫描当前页面二维码登录。登录成功后会自动继续；超时将改用其他公开招聘来源。"), "SKILL必须包含限时登录提示");
  assert.ok(evidenceRules.includes("每隔三至五秒") && evidenceRules.includes("二十秒仍未出现职位列表"), "证据规则必须定义轮询和登录后等待上限");
  assert.ok(evidenceRules.includes("不能在同一轮持续等待和检查时") && evidenceRules.includes("不得声称已等待九十秒"), "宿主不能持续等待时必须直接降级");
  assert.ok(generationRules.includes("生成器和成品 HTML 不执行 CDN 请求、职位搜索、登录、页面控制、Cookie 读取"), "HTML生成边界必须排除职位登录流程");
  assert.ok(generationRules.includes("CDN原始HTTP读取") && generationRules.includes("调用生成器之前完成"), "CDN读取必须发生在HTML生成前");
  assert.equal(/fetch\s*\(|document\.cookie|localStorage|sessionStorage/.test(jobPolicy), false, "职位获取流程不得读取凭证或调用页面接口");
  assert.equal(/require\(["']qrcode["']\)|data:image\//.test(jobPolicy), false, "职位获取流程不得生成或保存登录二维码");
  assert.ok(renderer.includes("isVerifiedMaimaiJob"), "公开渲染必须从内部证据派生脉脉职位身份");
  assert.ok(renderer.includes("buildPublicJob") && renderer.includes("buildPublicDiscussion"), "职位和帖子公开数据必须使用字段白名单构造");
}

function makeAcquisitionJob(id, overrides = {}) {
  return {
    id,
    source_url: `https://maimai.cn/n/platform/job-detail/${id}`,
    company: `公司${id}`,
    title: `后端岗位${id}`,
    location: "北京",
    experience: "5-10年",
    salary_min_yuan: 30000,
    salary_max_yuan: 50000,
    salary_months: 12,
    published_at: "2026-11-01",
    verified_at: "2026-11-04",
    ...overrides
  };
}

function makeBrowser(states, jobs = [], overrides = {}) {
  let stateIndex = 0;
  const calls = { open: [], foreground: 0, inspect: 0, waits: [], filters: [], readJobs: 0, readCriteria: [], openInApp: 0 };
  return {
    available: true,
    canContinuouslyMonitor: true,
    sameDeviceMobile: false,
    supportsAppDeepLink: false,
    calls,
    async open(url, options) { calls.open.push({ url, options }); },
    async bringToFront() { calls.foreground += 1; },
    async inspect() {
      calls.inspect += 1;
      const state = states[Math.min(stateIndex, states.length - 1)];
      stateIndex += 1;
      return typeof state === "string" ? { state } : state;
    },
    async wait(ms) { calls.waits.push(ms); },
    async applyFilters(criteria) { calls.filters.push(criteria); },
    async readJobs(criteria) { calls.readJobs += 1; calls.readCriteria.push(criteria); return { jobs }; },
    async openInApp() { calls.openInApp += 1; },
    ...overrides
  };
}

function makeCdnFixture() {
  const columns = [
    "description", "salaryText", "sourceId", "experienceText", "companyName",
    "title", "locationText", "city", "extraField"
  ];
  return {
    schemaVersion: 1,
    columns,
    rows: [
      ["负责高并发服务和系统稳定性", "45k-75k·16薪", "cdn-1", "3-5年", "公司A", "服务端开发工程师", "北京 · 海淀区", "北京", "extra"],
      ["负责交易平台后端架构", "30k-50k·12薪", "cdn-2", "5-10年", "公司B", "后端工程师", "北京 · 朝阳区", "北京", "extra"],
      ["负责Agent框架", "50k以上·16薪", "cdn-3", "3-5年", "公司C", "后端开发工程师", "北京 · 全部", "北京", "extra"]
    ]
  };
}

function makeCdnCandidate(id = "detail-1", overrides = {}) {
  const sourceUrl = buildMaimaiDetailUrl(id);
  return {
    id,
    job_id: id,
    source_id: id,
    acquisition_method: "maimai_cdn",
    dataset_url: FIXED_TEST_CDN_URL,
    dataset_schema_version: 1,
    dataset_updated_at: "2026-11-06T09:52:02Z",
    source_platform: "脉脉",
    source_url: sourceUrl,
    detail_url: sourceUrl,
    detail_verified: false,
    page_public_readable: false,
    company: "公司D",
    title: "后端开发工程师",
    location: "北京 · 海淀区",
    city: "北京",
    experience: "3-5年",
    salary_text: "35k-55k·16薪",
    salary_min_yuan: 35000,
    salary_max_yuan: 55000,
    salary_months: 16,
    description: "负责后端系统设计",
    requirements: "负责后端系统设计",
    published_at: null,
    date_posted: null,
    ...overrides
  };
}

function matchingDetail(candidate, overrides = {}) {
  return {
    state: "job_detail",
    page_type: "job_detail",
    detail_url: candidate.detail_url,
    source_url: candidate.detail_url,
    source_id: candidate.source_id,
    company: candidate.company,
    title: candidate.title,
    location: candidate.location,
    city: candidate.city,
    experience: candidate.experience,
    salary_min_yuan: candidate.salary_min_yuan,
    salary_max_yuan: candidate.salary_max_yuan,
    salary_months: candidate.salary_months,
    datePosted: "2026-11-08T09:30:00+08:00",
    ...overrides
  };
}

async function assertCdnJobAcquisitionPolicy(sourceData) {
  assert.equal(buildMaimaiCdnUrl(FIXED_TEST_TIMESTAMP), `${MAIMAI_CDN_BASE_URL}?v=${FIXED_TEST_TIMESTAMP}`);
  assert.equal(isMaimaiCdnUrl(FIXED_TEST_CDN_URL), true);
  assert.equal(isMaimaiCdnUrl(MAIMAI_CDN_BASE_URL), false, "无参数地址不得用于取数");
  assert.equal(isMaimaiCdnUrl(`${MAIMAI_CDN_BASE_URL}?${"v" + "=2"}`), false, "固定短参数不得用于取数");
  assert.equal(isMaimaiCdnUrl(`${FIXED_TEST_CDN_URL}&v=${FIXED_TEST_TIMESTAMP}`), false, "不得存在重复v参数");
  assert.equal(isMaimaiCdnUrl(`${MAIMAI_CDN_BASE_URL}?v=0000000000001`), false, "时间戳不得以零填充");
  assert.match(buildMaimaiCdnUrl(), /^https:\/\/s\.taou\.com\/n\/platform\/job-list\.min\.json\?v=\d{13}$/);
  [0, -1, 123456789012, 12345678901234, 1.5, Number.MAX_SAFE_INTEGER + 1].forEach((value) => {
    assert.throws(() => buildMaimaiCdnUrl(value), /13位正整数/, `无效时间戳应被拒绝：${value}`);
  });
  assert.equal(JOB_LIST_URL, CTA_MAP.high_salary_jobs, "用户侧高薪机会入口不得改成CDN地址");
  assert.deepEqual(ACQUISITION_METHODS, ["maimai_cdn", "maimai_public_page", "maimai_detail_search", "external_public_search"]);
  assert.equal(LOGIN_WAIT_MS, 90_000);
  assert.equal(POST_LOGIN_LIST_WAIT_MS, 20_000);
  assert.ok(DEFAULT_POLL_INTERVAL_MS >= 3_000 && DEFAULT_POLL_INTERVAL_MS <= 5_000);

  const fixture = makeCdnFixture();
  const parsed = parseCdnDataset(JSON.stringify(fixture), { last_modified: "2026-11-06T09:52:02Z" });
  assert.deepEqual(REQUIRED_CDN_COLUMNS.filter((key) => !parsed.columns.includes(key)), []);
  assert.equal(parsed.records[0].sourceId, "cdn-1", "columns/rows必须动态映射");
  assert.equal(parsed.records[0].description, "负责高并发服务和系统稳定性", "description必须按列名读取");
  assert.equal(parsed.dataset_updated_at, "2026-11-06T09:52:02Z");
  assert.throws(() => parseCdnDataset({ schemaVersion: 1, columns: [], rows: [] }), /缺少必要字段/);
  assert.throws(() => parseCdnDataset({ schemaVersion: 1, columns: fixture.columns, rows: [["x"]] }), /缺少 sourceId/);

  assert.deepEqual(parseSalaryText("45k-75k·16薪"), { salary_min_yuan: 45000, salary_max_yuan: 75000, salary_months: 16 });
  assert.deepEqual(parseSalaryText("30K - 50K × 12薪"), { salary_min_yuan: 30000, salary_max_yuan: 50000, salary_months: 12 });
  ["50k以上", "面议", "45k", "45k-", "60万年薪"].forEach((value) => assert.equal(parseSalaryText(value), null, `不完整薪资不得入样：${value}`));
  const salaryA = parseSalaryText("45k-75k·12薪");
  const salaryB = parseSalaryText("45k-75k·16薪");
  assert.equal(monthlySalaryMidpoint(salaryA), 60000);
  assert.equal(monthlySalaryMidpoint(salaryB), 60000, "薪数不得进入固定月薪中点");
  assert.equal(calculateAverageMonthlySalary([salaryA, salaryB]), 60000, "平均报价只能使用月薪区间中点");

  assert.equal(buildMaimaiDetailUrl("abc-123"), "https://maimai.cn/n/job/geo/abc-123");
  assert.throws(() => buildMaimaiDetailUrl(""), /sourceId/);
  assert.equal(isMaimaiJobDetailUrl("https://maimai.cn/n/job/geo/abc-123", "abc-123"), true);
  assert.equal(isMaimaiJobDetailUrl("https://maimai.cn/n/platform/job-list", "abc-123"), false);

  const criteria = { city: "北京", role: "后端开发工程师", role_terms: ["后端", "服务端"], experience_years: 5 };
  const calls = [];
  const rawRecovery = await runJobAcquisition({
    nowMs: FIXED_TEST_TIMESTAMP,
    criteria,
    minimumSampleSize: 2,
    cdnWebFetch: async (url) => { calls.push(`web:${url}`); throw new Error("link fetch error"); },
    cdnRawHttp: async (url) => {
      calls.push(`raw:${url}`);
      return { body: JSON.stringify(fixture), metadata: { last_modified: FIXED_LAST_MODIFIED } };
    },
    publicPageRead: async () => { calls.push("public_page"); return { status: "success", jobs: [] }; },
    detailSearch: async () => { calls.push("detail_search"); return { candidates: [] }; },
    externalSearch: async () => { calls.push("external"); return { jobs: [] }; }
  });
  assert.deepEqual(calls, [`web:${FIXED_TEST_CDN_URL}`, `raw:${FIXED_TEST_CDN_URL}`], "web_fetch失败后应复用同一动态URL并由原始HTTP恢复");
  assert.equal(new Set(calls.map((item) => item.replace(/^(?:web|raw):/, ""))).size, 1, "同一次运行不得生成多个CDN地址");
  assert.equal(rawRecovery.cdn_dataset_url, FIXED_TEST_CDN_URL, "本次运行应保存唯一datasetUrl");
  assert.equal(rawRecovery.primary_method, "maimai_cdn");
  assert.equal(rawRecovery.jobs.length, 2);
  assert.equal(rawRecovery.external_used, false);
  assert.equal(rawRecovery.jobs[0].description, "负责高并发服务和系统稳定性");
  assert.equal(rawRecovery.jobs[0].dataset_url, FIXED_TEST_CDN_URL, "职位证据必须复用本次动态URL");
  assert.equal(rawRecovery.jobs[0].published_at, null, "CDN数据集时间不得代替职位发布时间");
  assert.equal(rawRecovery.jobs[0].dataset_updated_at, FIXED_LAST_MODIFIED, "dataset_updated_at必须来自真实元数据");
  assert.notEqual(rawRecovery.jobs[0].dataset_updated_at, String(FIXED_TEST_TIMESTAMP), "v参数不得写入dataset_updated_at");
  assert.equal(rawRecovery.access_states.includes("robots_disallowed"), false, "link fetch error不得误报为robots");

  const nextRunCalls = [];
  const nextRunTimestamp = FIXED_TEST_TIMESTAMP + 1;
  const nextRun = await runJobAcquisition({
    nowMs: nextRunTimestamp,
    criteria,
    minimumSampleSize: 1,
    cdnWebFetch: async (url) => { nextRunCalls.push(url); return fixture; }
  });
  assert.deepEqual(nextRunCalls, [buildMaimaiCdnUrl(nextRunTimestamp)]);
  assert.notEqual(nextRun.cdn_dataset_url, rawRecovery.cdn_dataset_url, "不同运行应能生成不同动态URL");

  const originalDateNow = Date.now;
  let dateNowCalls = 0;
  Date.now = () => {
    dateNowCalls += 1;
    return FIXED_TEST_TIMESTAMP;
  };
  try {
    await runJobAcquisition({
      criteria,
      minimumSampleSize: 1,
      cdnRawHttp: async () => fixture
    });
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(dateNowCalls, 1, "正式取数每次运行只能读取一次系统时钟");

  const fallbackCalls = [];
  const detailCandidate = makeCdnCandidate();
  const layered = await runJobAcquisition({
    criteria,
    minimumSampleSize: 2,
    cdnWebFetch: async () => { fallbackCalls.push("web_fetch"); throw new Error("link fetch error"); },
    cdnRawHttp: async () => { fallbackCalls.push("raw_http"); throw new Error("invalid json"); },
    publicPageRead: async () => { fallbackCalls.push("public_page"); return { status: "success", jobs: [makeCdnCandidate("page-1", { acquisition_method: "maimai_public_page" })] }; },
    browser: { available: false },
    ssrRead: async () => { fallbackCalls.push("ssr"); return { status: "blocked", http_status: 403 }; },
    detailSearch: async () => { fallbackCalls.push("detail_search"); return { candidates: [detailCandidate] }; },
    publicDetailRead: async () => matchingDetail(detailCandidate),
    externalSearch: async () => { fallbackCalls.push("external"); return { jobs: [] }; }
  });
  assert.deepEqual(fallbackCalls, ["web_fetch", "raw_http", "public_page", "ssr", "detail_search"], "CDN失败后必须依次进入网页和详情搜索");
  assert.deepEqual(layered.job_acquisition.map((item) => item.acquisition_method), ["maimai_public_page", "maimai_detail_search"]);
  assert.equal(layered.external_used, false, "脉脉样本达到要求时不得使用外部来源");
  assert.equal(layered.jobs[1].published_at, "2026-11-08T09:30:00+08:00", "datePosted必须保存为published_at");
  assert.notEqual(layered.jobs[1].published_at, String(FIXED_TEST_TIMESTAMP), "v参数不得写入published_at");

  const externalCalls = [];
  const insufficient = await runJobAcquisition({
    criteria,
    minimumSampleSize: 3,
    cdnRawHttp: async () => { throw new Error("download failed"); },
    publicPageRead: async () => ({ status: "success", jobs: [makeCdnCandidate("page-only", { acquisition_method: "maimai_public_page" })] }),
    browser: { available: false },
    detailSearch: async () => ({ candidates: [] }),
    externalSearch: async () => { externalCalls.push("external"); return { jobs: [makeAcquisitionJob("external-1", { source_url: "https://external.example/job/1", source_platform: "外部平台" })] }; }
  });
  assert.deepEqual(externalCalls, ["external"], "前三层脉脉样本不足时才可使用其他来源");
  assert.equal(insufficient.jobs.length, 2, "所有来源不足时保留实际数量，不编造补齐");
  assert.deepEqual(insufficient.job_acquisition.map((item) => item.acquisition_method), ["maimai_public_page", "external_public_search"]);

  const mismatchBase = makeCdnCandidate("mismatch");
  assert.equal(detailMatchesCandidate(mismatchBase, matchingDetail(mismatchBase)), true);
  for (const [key, value] of [["company", "另一家公司"], ["title", "其他岗位"], ["city", "上海"], ["location", "上海"], ["salary_min_yuan", 1], ["salary_max_yuan", 2]]) {
    assert.equal(detailMatchesCandidate(mismatchBase, matchingDetail(mismatchBase, { [key]: value })), false, `详情${key}不一致时核验必须失败`);
  }

  const verifiedSelection = await selectFeaturedJobs({
    candidates: [detailCandidate],
    publicDetailRead: async () => matchingDetail(detailCandidate),
    browser: { available: false }
  });
  assert.equal(verifiedSelection.jobs[0].detail_verified, true);
  assert.equal(isVerifiedMaimaiJob(verifiedSelection.jobs[0], { ...verifiedSelection.jobs[0], same_job_verified: true }), true, "已核验CDN职位应保留真实详情链接");
  const failedSelection = await selectFeaturedJobs({
    candidates: [detailCandidate],
    publicDetailRead: async () => ({ state: "not_found" }),
    browser: { available: false }
  });
  assert.equal(failedSelection.jobs[0].detail_verified, false, "详情失败时应保留CDN候选但隐藏链接");
  assert.equal(isVerifiedMaimaiJob(failedSelection.jobs[0], failedSelection.jobs[0]), false);

  const prompts = [];
  const qrBrowser = makeBrowser(["login_qr", "job_list"], [makeCdnCandidate("browser-page")]);
  const browserPage = await runJobAcquisition({
    criteria,
    minimumSampleSize: 1,
    cdnRawHttp: async () => { throw new Error("failed"); },
    publicPageRead: async () => ({ status: "blocked" }),
    browser: qrBrowser,
    onLoginPrompt: async (message) => prompts.push(message)
  });
  assert.deepEqual(prompts, [LOGIN_PROMPT]);
  assert.equal(browserPage.primary_method, "maimai_public_page");
  assert.equal(browserPage.browser_login_confirmed, true);

  await assert.rejects(() => runJobAcquisition({ pollIntervalMs: 2_999 }), /3至5秒/);
  assert.throws(() => assertNoCredentialFields({ nested: { access_token: "secret" } }), /不得保存登录凭证/);
  assert.equal(classifyPublicFailure({ robots_verified: true, robots_disallowed: true }), "robots_disallowed");

  const expectedMonthlyGap = sourceData.subject.fixed_monthly_salary_yuan - sourceData.salary_market.average_monthly_yuan;
  assert.ok(Math.abs(sourceData.result.monthly_gap_yuan - expectedMonthlyGap) < 1e-9, "职位获取改动不得修改月薪差额公式");
  assert.ok(Math.abs(sourceData.result.annual_equal_gap_yuan - expectedMonthlyGap * 12) < 1e-9, "职位获取改动不得修改12个月等额差额公式");
  assert.equal(sourceData.result.average_label, "本次公开职位样本平均报价");
}

function assertJobEvidenceContracts(data) {
  const evidence = data.evidence_records?.jobs;
  assert.equal(Array.isArray(evidence), true, "测试数据缺少职位内部证据");
  const selected = evidence.filter((item) => item.selection_status === "selected");
  assert.equal(selected.length, data.jobs.length, "已选职位证据与职位数据数量不一致");
  const evidenceById = new Map(evidence.map((item) => [item.job_id, item]));
  const cdnDatasetUrls = new Set(evidence.filter((item) => item.acquisition_method === "maimai_cdn").map((item) => item.dataset_url));
  assert.equal(cdnDatasetUrls.size, 1, "同一份示例数据中的CDN证据必须复用同一个动态URL");
  assert.equal(evidenceById.size, evidence.length, "职位候选内部证据 id 重复");
  evidence.forEach((record, index) => {
    [
      "acquisition_method", "dataset_url", "dataset_schema_version", "dataset_updated_at",
      "source_platform", "source_id", "source_url", "detail_url", "detail_verified",
      "page_public_readable", "company", "title", "location", "experience", "salary_text",
      "salary_min_yuan", "salary_max_yuan", "salary_months", "description", "published_at",
      "verified_at", "selection_status", "selection_reason", "rejection_reason"
    ].forEach((key) => assert.ok(Object.prototype.hasOwnProperty.call(record, key), `第${index + 1}条职位证据缺少${key}`));
    assert.ok(ACQUISITION_METHODS.includes(record.acquisition_method), `第${index + 1}条职位获取方式无效`);
    if (record.acquisition_method === "maimai_cdn") assert.equal(isMaimaiCdnUrl(record.dataset_url), true, "CDN证据必须记录13位动态URL");
    if (record.detail_verified) assert.equal(isMaimaiJobDetailUrl(record.detail_url, record.source_id), true, "已核验详情URL格式无效");
    assertNoCredentialFields(record, `evidence_records.jobs[${index}]`);
  });
  data.jobs.forEach((job, index) => {
    const record = evidenceById.get(job.id);
    assert.ok(record, `第${index + 1}个职位缺少内部证据`);
    assert.equal(record.source_url, job.source_url, `第${index + 1}个职位链接与证据不一致`);
    ["company", "title", "location", "experience", "salary_min_yuan", "salary_max_yuan", "salary_months"].forEach((key) => {
      assert.equal(record[key], job[key], `第${index + 1}个职位字段与证据不一致：${key}`);
    });
  });
}

function makeDiscussionCandidate(id, overrides = {}) {
  const isMaimai = overrides.is_maimai !== false;
  return {
    candidate_id: id,
    discussion_id: id,
    discovery_query: "测试查询",
    discovery_method: "path_site",
    source_platform: isMaimai ? "脉脉" : "外部测试来源",
    source_url: isMaimai ? `https://maimai.cn/community/gossip-detail/${id}` : `https://external.example/${id}`,
    original_title: `候选${id}`,
    is_maimai: isMaimai,
    public_readable: true,
    page_role: "后端开发",
    page_experience: "5年+",
    page_date_text: "2026-10-01",
    published_at: "2026-10-01",
    published_at_verified: true,
    sitemap_lastmod: "2026-10-02",
    content_category: "same_role_pay",
    matched_topics: ["跳槽"],
    verified_facts: ["5年以上后端获得30%涨幅"],
    content_evidence_source: "detail_body",
    used_unreadable_comments: false,
    decision_relevant: true,
    has_specific_signal: true,
    city_match: true,
    verified_at: "2026-11-04",
    ...overrides
  };
}

async function assertDiscussionSearchPolicy(sourceData) {
  const subject = {
    city: "北京",
    role: "后端开发工程师",
    experience_years: 5,
    fixed_monthly_salary_yuan: 25000
  };
  const now = new Date("2026-11-04T00:00:00Z");
  const keywords = buildDiscussionKeywords(subject);
  ["后端开发", "后端工程师", "Java后端", "Go后端", "服务端开发", "后台开发"].forEach((term) => {
    assert.ok(keywords.role_aliases.includes(term), `缺少岗位同义词：${term}`);
  });
  ["5年", "五年", "3-5年", "5年+", "5-10年"].forEach((term) => assert.ok(keywords.experience_terms.includes(term), `缺少年限词：${term}`));
  ["25K", "25k", "2.5万", "25000"].forEach((term) => assert.ok(keywords.salary_terms.includes(term), `缺少薪资写法：${term}`));

  const plan = buildDiscussionSearchPlan(subject);
  assert.deepEqual(plan.stages.map((stage) => stage.id), ["path_site", "domain_site", "public_keyword"]);
  plan.stages.flatMap((stage) => stage.queries).forEach((query) => {
    assert.equal(typeof query.theme_id, "string", "每条查询必须有且仅有一个主题标识");
    assert.equal(Array.isArray(query.theme_id), false, "查询不得合并多个主题标识");
  });

  const fallbackCalls = [];
  let domainDelivered = false;
  const fallbackResult = await discoverDiscussions({
    subject,
    now,
    search: async (step) => {
      fallbackCalls.push(step.stage);
      if (step.stage === "domain_site" && !domainDelivered) {
        domainDelivered = true;
        return { supported: true, results: [
          makeDiscussionCandidate("domain-pay"),
          makeDiscussionCandidate("domain-team", { content_category: "same_role_environment", verified_facts: ["5年以上后端询问团队强度"] }),
          makeDiscussionCandidate("domain-hr", { content_category: "recruiter_view", page_role: "HR", verified_facts: ["做了3年招聘的HR认为谈薪需要预留空间"] })
        ] };
      }
      return { supported: true, results: [] };
    },
    searchExternal: async () => ({ results: [] })
  });
  assert.ok(fallbackCalls.includes("path_site") && fallbackCalls.includes("domain_site"), "路径级无结果后必须继续域名级site查询");
  assert.equal(fallbackResult.selected.length, 3);

  const unsupportedCalls = [];
  let publicDelivered = false;
  const unsupportedResult = await discoverDiscussions({
    subject,
    now,
    search: async (step) => {
      unsupportedCalls.push(step.stage);
      if (step.stage === "path_site") return { supported: false, results: [] };
      if (step.stage === "public_keyword" && !publicDelivered) {
        publicDelivered = true;
        return { supported: true, results: [
          makeDiscussionCandidate("public-pay"),
          makeDiscussionCandidate("public-team", { content_category: "same_role_environment", has_specific_signal: false, verified_facts: ["5年以上后端最关心团队卷不卷和工作强度"] }),
          makeDiscussionCandidate("public-hr", { content_category: "recruiter_view", page_role: "HR", verified_facts: ["做了3年招聘的HR认为期望薪资报低后很难抬高"] })
        ] };
      }
      return { supported: true, results: [] };
    }
  });
  assert.equal(unsupportedCalls.includes("domain_site"), false, "site不受支持时不得继续伪执行域名级site查询");
  assert.ok(unsupportedCalls.includes("public_keyword"), "site不受支持时必须执行普通关键词搜索");
  assert.equal(unsupportedResult.selected.length, 3);
  assert.ok(unsupportedResult.selected.some((item) => item.content_category === "same_role_environment"), "无薪资数字的同岗团队强度内容应可入选");
  assert.ok(unsupportedResult.selected.some((item) => item.content_category === "recruiter_view"), "HR谈薪内容应可入选");

  const timeWindowCalls = [];
  let deliveredRecent = false;
  let deliveredExtended = false;
  const timeWindowResult = await discoverDiscussions({
    subject,
    now,
    search: async (step) => {
      timeWindowCalls.push(step.time_window_months);
      if (step.time_window_months === 12 && !deliveredRecent) {
        deliveredRecent = true;
        return { supported: true, results: [makeDiscussionCandidate("recent-pay")] };
      }
      if (step.time_window_months === 24 && !deliveredExtended) {
        deliveredExtended = true;
        return { supported: true, results: [
          makeDiscussionCandidate("extended-team", { content_category: "same_role_environment" }),
          makeDiscussionCandidate("extended-hr", { content_category: "recruiter_view", page_role: "HR" })
        ] };
      }
      return { supported: true, results: [] };
    },
    searchExternal: async () => ({ results: [] })
  });
  assert.equal(timeWindowResult.selected.length, 3, "近12个月不足时应扩展到近24个月补足");
  assert.ok(timeWindowCalls.includes(12) && timeWindowCalls.includes(24), "搜索必须覆盖12个月与24个月两个时间窗口");
  assert.ok(timeWindowCalls.indexOf(24) > timeWindowCalls.lastIndexOf(12), "必须先穷尽近12个月，再扩展到近24个月");

  let externalCalled = false;
  let maimaiDelivered = false;
  const mixed = await discoverDiscussions({
    subject,
    now,
    search: async () => {
      if (maimaiDelivered) return { supported: true, results: [] };
      maimaiDelivered = true;
      return { supported: true, results: [
        makeDiscussionCandidate("maimai-pay", { city_match: false }),
        makeDiscussionCandidate("maimai-team", { content_category: "same_role_environment", verified_facts: ["异地5年以上后端讨论团队强度"] })
      ] };
    },
    searchExternal: async () => {
      externalCalled = true;
      return { results: [makeDiscussionCandidate("external-hr", { is_maimai: false, content_category: "recruiter_view", page_role: "HR", verified_facts: ["HR认为谈薪应保留20%-30%空间"] })] };
    }
  });
  assert.equal(externalCalled, true, "脉脉不足三条时应继续外部公开搜索");
  assert.equal(mixed.selected.length, 3);
  assert.equal(mixed.selected.filter((item) => item.is_maimai).length, 2, "外部内容只能补足脉脉缺口");
  assert.ok(mixed.selected.some((item) => item.city_match === false), "城市不匹配不得自动淘汰帖子");

  let forbiddenExternalCall = false;
  let exactDelivered = false;
  await discoverDiscussions({
    subject,
    now,
    search: async () => {
      if (exactDelivered) return { supported: true, results: [] };
      exactDelivered = true;
      return { supported: true, results: [makeDiscussionCandidate("m1"), makeDiscussionCandidate("m2"), makeDiscussionCandidate("m3")] };
    },
    searchExternal: async () => {
      forbiddenExternalCall = true;
      return { results: [] };
    }
  });
  assert.equal(forbiddenExternalCall, false, "已有三条合格脉脉帖子时不得调用外部来源");

  assert.equal(rejectReason(makeDiscussionCandidate("boundary", { published_at: "2024-11-04" }), now), "", "恰好24个月边界应保留");
  assert.equal(rejectReason(makeDiscussionCandidate("stale", { published_at: "2024-11-03" }), now), "发布时间超过最近24个月");
  assert.equal(rejectReason(makeDiscussionCandidate("month-only", { page_date_text: "06-21", published_at: null, published_at_verified: false }), now), "发布时间年份未核验");
  assert.equal(rejectReason(makeDiscussionCandidate("lastmod-only", { published_at: null, published_at_verified: false, sitemap_lastmod: "2026-10-01" }), now), "发布时间年份未核验", "sitemap lastmod不得替代发布时间");
  assert.equal(rejectReason(makeDiscussionCandidate("snippet", { content_evidence_source: "search_snippet" }), now), "搜索摘要不能作为正文证据");
  assert.equal(rejectReason(makeDiscussionCandidate("comments", { used_unreadable_comments: true }), now), "使用了未登录状态无法读取的评论");

  for (const count of [1, 2]) {
    let delivered = false;
    const result = await discoverDiscussions({
      subject,
      now,
      search: async () => {
        if (delivered) return { supported: true, results: [] };
        delivered = true;
        return { supported: true, results: Array.from({ length: count }, (_, index) => makeDiscussionCandidate(`only-${count}-${index}`)) };
      },
      searchExternal: async () => ({ results: [] })
    });
    assert.equal(result.selected.length, count, `搜索穷尽后应保留${count}条真实帖子`);
  }

  const salaryBefore = structuredClone({ salary_market: sourceData.salary_market, result: sourceData.result });
  await discoverDiscussions({ subject, now, search: async () => ({ supported: true, results: [] }), searchExternal: async () => ({ results: [] }) });
  assert.deepEqual({ salary_market: sourceData.salary_market, result: sourceData.result }, salaryBefore, "帖子流程不得修改薪资计算结果");
}

function assertDiscussionCopyContracts(data) {
  const evidence = data.evidence_records?.discussions;
  assert.equal(Array.isArray(evidence), true, "测试数据缺少同行内部证据");
  const selectedEvidence = evidence.filter((item) => item.selection_status === "selected");
  assert.equal(selectedEvidence.length, data.discussions.length, "已选同行证据与公开概括数量不一致");
  const evidenceById = new Map(evidence.map((item) => [item.discussion_id, item]));
  assert.equal(evidenceById.size, evidence.length, "同行候选内部证据 id 重复");

  evidence.forEach((record, index) => {
    [
      "discovery_query", "discovery_method", "source_platform", "source_url", "original_title",
      "public_readable", "page_role", "page_experience", "page_date_text", "published_at",
      "published_at_verified", "sitemap_lastmod", "content_category", "matched_topics",
      "verified_facts", "selection_status", "selection_reason", "rejection_reason", "verified_at"
    ].forEach((key) => assert.ok(Object.prototype.hasOwnProperty.call(record, key), `第${index + 1}条候选证据缺少${key}`));
    if (record.selection_status === "rejected") assert.ok(record.rejection_reason, `第${index + 1}条淘汰候选缺少原因`);
  });

  data.discussions.forEach((discussion, index) => {
    assert.ok(discussion.id, `第${index + 1}条同行概括缺少 id`);
    assert.equal(/\r|\n/.test(discussion.summary), false, `第${index + 1}条同行概括必须只有一行`);
    const sentenceMarks = discussion.summary.match(/[。！？!?]/g) || [];
    assert.ok(sentenceMarks.length <= 1, `第${index + 1}条同行概括超过一句话`);
    if (sentenceMarks.length) assert.ok(/[。！？!?]$/.test(discussion.summary.trim()), `第${index + 1}条同行概括的句末标点位置错误`);
    assert.match(discussion.summary, /\d/, `第${index + 1}条测试概括应保留真实数字`);
    assert.match(discussion.summary, /只|却|仍|倒挂|超过|差距|涨幅|年终奖/, `第${index + 1}条测试概括应突出反差、结果或争议`);
    assert.equal(EVIDENCE_SUMMARY_PATTERN.test(discussion.summary), false, `第${index + 1}条概括不能使用证据摘要表达`);
    assert.equal(FORBIDDEN_DISCUSSION_HOOK_PATTERN.test(discussion.summary), false, `第${index + 1}条概括包含虚假悬念`);

    const record = evidenceById.get(discussion.id);
    assert.ok(record, `第${index + 1}条概括缺少对应内部证据`);
    assert.equal(record.selection_status, "selected", `第${index + 1}条概括未标记为已选`);
    assert.equal(record.source_url, discussion.url, `第${index + 1}条帖子链接与证据不一致`);
    const verifiedFacts = record.verified_facts.join("｜");
    record.summary_claims.forEach((claim) => {
      assert.ok(discussion.summary.includes(claim), `第${index + 1}条概括缺少事实：${claim}`);
      assert.ok(verifiedFacts.includes(claim), `第${index + 1}条事实无法回溯内部证据：${claim}`);
    });
    if (!record.supports_question_hook) assert.equal(/[？?]$/.test(discussion.summary.trim()), false, `第${index + 1}条不应增加问题钩子`);
    if (!record.has_final_choice) assert.equal(/他最后会怎么选|后来怎么样了/.test(discussion.summary), false, `第${index + 1}条不得虚构最终选择`);
    if (!record.has_explained_reason) assert.equal(/原因竟然是这个|真相让人意外/.test(discussion.summary), false, `第${index + 1}条不得虚构原因`);
    if (!record.has_systematic_method) assert.equal(/看看避坑指南/.test(discussion.summary), false, `第${index + 1}条不得虚构方法`);
  });

  selectedEvidence.forEach((item) => {
    assert.equal(item.public_readable, true, "已选帖子正文必须公开可读");
    assert.equal(item.published_at_verified, true, "已选帖子必须核验完整发布时间");
    assert.equal(Number.isNaN(new Date(item.published_at).getTime()), false, "已选帖子发布时间无效");
    assert.equal(item.content_evidence_source, "detail_body", "已选帖子只能使用详情页正文作为事实来源");
    assert.equal(item.used_unreadable_comments, false, "已选帖子不得使用不可读评论");
  });
}

function assertDefaultHtmlArtifact() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "salary-v2-html-"));
  const output = path.join(tempDir, "index.html");
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), DATA_PATH, output]);
  assert.deepEqual(fs.readdirSync(tempDir).sort(), ["index.html"], "默认生成目录只能包含单文件HTML，不生成JSON或Markdown附件");
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function openPage(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(pathToFileURL(INDEX_PATH).href, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  return { context, page, errors, requests };
}

async function assertNoOverflow(page) {
  const result = await page.evaluate(() => {
    const wide = document.documentElement.scrollWidth > window.innerWidth + 1;
    const offenders = [...document.querySelectorAll("body *")].filter((node) => {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = node.getBoundingClientRect();
      return rect.right > window.innerWidth + 1 || rect.left < -1;
    }).map((node) => `${node.tagName}.${node.className}`).slice(0, 8);
    return { wide, offenders, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  });
  assert.equal(result.wide, false, `页面横向溢出：${JSON.stringify(result)}`);
  assert.deepEqual(result.offenders, [], `元素越界：${result.offenders.join(", ")}`);
  return result;
}

async function waitForScrollSettled(page, targetSelector, timeoutMs = 3500) {
  await page.locator(targetSelector).waitFor({ state: "visible" });
  return page.evaluate(async ({ targetSelector, timeoutMs }) => {
    const target = document.querySelector(targetSelector);
    if (!target) throw new Error(`滚动目标不存在：${targetSelector}`);

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let previous = null;
      let stableFrames = 0;

      const sample = () => {
        const root = document.scrollingElement;
        const rect = target.getBoundingClientRect();
        const current = {
          scrollY: root.scrollTop,
          scrollHeight: root.scrollHeight,
          targetTop: rect.top,
          targetHeight: rect.height
        };
        const stable = previous
          && Math.abs(current.scrollY - previous.scrollY) <= 0.5
          && Math.abs(current.scrollHeight - previous.scrollHeight) <= 0.5
          && Math.abs(current.targetTop - previous.targetTop) <= 0.5
          && Math.abs(current.targetHeight - previous.targetHeight) <= 0.5;
        stableFrames = stable ? stableFrames + 1 : 0;
        previous = current;

        if (stableFrames >= 8 && performance.now() - startedAt >= 160) {
          resolve(current);
          return;
        }
        if (performance.now() - startedAt > timeoutMs) {
          reject(new Error(`平滑滚动未稳定：${JSON.stringify(current)}`));
          return;
        }
        requestAnimationFrame(sample);
      };

      requestAnimationFrame(sample);
    });
  }, { targetSelector, timeoutMs });
}

async function assertRoundAtViewportTop(page, round, label) {
  const selector = `.message[data-round="${round}"]`;
  await page.waitForFunction((expectedRound) => document.querySelector("#report")?.dataset.round === String(expectedRound), round);
  await waitForScrollSettled(page, selector);
  const geometry = await page.evaluate((targetSelector) => {
    const root = document.scrollingElement;
    const target = document.querySelector(targetSelector).getBoundingClientRect();
    return {
      targetTop: target.top,
      scrollY: root.scrollTop,
      scrollHeight: root.scrollHeight,
      viewportHeight: window.innerHeight,
      remainingScroll: root.scrollHeight - window.innerHeight - root.scrollTop
    };
  }, selector);
  assert.ok(geometry.targetTop >= -1 && geometry.targetTop <= 80,
    `${label} 第${round}轮消息顶部应位于约0-80px，实际${geometry.targetTop}px`);
  return geometry;
}

async function assertRoundThreeScroll(page, label) {
  const geometry = await assertRoundAtViewportTop(page, 3, label);
  const finalCard = await page.locator("#finalCard").evaluate((card) => {
    const rect = card.getBoundingClientRect();
    const roundMessage = card.closest('.message[data-round="3"]');
    return {
      top: rect.top,
      bottom: rect.bottom,
      roundTop: roundMessage.getBoundingClientRect().top,
      viewportHeight: window.innerHeight
    };
  });
  assert.ok(geometry.remainingScroll > 80,
    `${label} 第3轮不应停在页面底部，剩余可滚动距离仅${geometry.remainingScroll}px`);
  assert.ok(finalCard.bottom > finalCard.viewportHeight + 1,
    `${label} 综合诊断卡应仍有内容位于视口下方`);
  assert.ok(finalCard.top > finalCard.roundTop,
    `${label} 综合诊断卡必须位于第3轮分支内容之后`);
  return { ...geometry, finalCardTop: finalCard.top, finalCardBottom: finalCard.bottom };
}

async function assertFinalSeparation(page) {
  const result = await page.locator('.message[data-round="3"] h2.final-section-heading').evaluate((heading) => {
    const previous = heading.previousElementSibling;
    const card = heading.nextElementSibling;
    const headingBox = heading.getBoundingClientRect();
    const previousBox = previous?.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    const style = getComputedStyle(heading);
    return {
      headingText: heading.textContent,
      previousHasAction: Boolean(previous?.querySelector(":scope > .result-action")),
      previousToHeadingGap: previousBox ? headingBox.top - previousBox.bottom : -1,
      headingToCardGap: cardBox ? cardBox.top - headingBox.bottom : -1,
      marginTop: parseFloat(style.marginTop),
      marginBottom: parseFloat(style.marginBottom),
      paddingTop: parseFloat(style.paddingTop),
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: parseFloat(style.borderTopWidth),
      nextIsFinalCard: card?.id === "finalCard"
    };
  });
  assert.equal(result.headingText, "今日跑路可行性诊断卡");
  assert.equal(result.previousHasAction, true, "诊断卡标题前必须是带承接入口的分支模块");
  assert.ok(result.previousToHeadingGap >= 31, `前一模块与诊断卡标题留白不足：${result.previousToHeadingGap}px`);
  assert.ok(result.headingToCardGap >= 15, `诊断卡标题与卡片间距不足：${result.headingToCardGap}px`);
  assert.equal(result.marginTop, 32);
  assert.equal(result.marginBottom, 16);
  assert.equal(result.paddingTop, 24);
  assert.equal(result.borderTopStyle, "solid");
  assert.equal(result.borderTopWidth, 1);
  assert.equal(result.nextIsFinalCard, true, "诊断卡标题下一节点必须是综合诊断卡");
  return result;
}

async function assertModuleEntry(page, scope, moduleName, expectedUrl) {
  const module = page.locator(`${scope} [data-module="${moduleName}"]`);
  assert.equal(await module.count(), 1, `${scope} 的 ${moduleName} 模块数量不为1`);
  const links = module.locator('a[data-role="module-cta"]');
  assert.equal(await links.count(), 1, `${moduleName} 必须只有一个主要脉脉入口`);
  assert.equal(await links.getAttribute("href"), expectedUrl, `${moduleName} 入口链接不正确`);
  const placement = await module.evaluate((node) => {
    const action = node.querySelector(":scope > .result-action");
    const link = action?.querySelector('a[data-role="module-cta"]');
    return {
      actionIsLast: node.lastElementChild === action,
      linkInAction: Boolean(link),
      linkCount: node.querySelectorAll('a[data-role="module-cta"]').length
    };
  });
  assert.deepEqual(placement, { actionIsLast: true, linkInAction: true, linkCount: 1 }, `${moduleName} 入口未紧跟对应结果`);
}

async function assertActionKinds(page) {
  const result = await page.evaluate(() => {
    const button = document.querySelector("button.choice[data-action]");
    const link = document.querySelector('a.external-link[data-role="module-cta"]');
    const buttonStyle = getComputedStyle(button);
    const linkStyle = getComputedStyle(link);
    return {
      buttonTag: button?.tagName,
      buttonHref: button?.getAttribute("href"),
      buttonAction: button?.dataset.action,
      linkTag: link?.tagName,
      linkAction: link?.dataset.action || null,
      linkTarget: link?.getAttribute("target"),
      buttonBorder: buttonStyle.borderStyle,
      linkBorder: linkStyle.borderStyle,
      nested: Boolean(document.querySelector('a button, button a, .choices a, a.external-link.choice'))
    };
  });
  assert.equal(result.buttonTag, "BUTTON");
  assert.equal(result.buttonHref, null);
  assert.ok(result.buttonAction);
  assert.equal(result.linkTag, "A");
  assert.equal(result.linkAction, null);
  assert.equal(result.linkTarget, null);
  assert.notEqual(result.buttonBorder, "none");
  assert.equal(result.linkBorder, "none");
  assert.equal(result.nested, false);
}

async function assertAppEntryMode(page, scope, key) {
  const module = page.locator(`${scope} [data-module="${key}"]`).last();
  const qr = module.locator(`img.app-entry-qr[data-entry-key="${key}"]`);
  const link = module.locator(`a.app-entry-link[data-role="module-cta"][href="${CTA_MAP[key]}"]`);
  assert.equal(await qr.count(), 1, `${key} 二维码缺失`);
  assert.equal(await link.count(), 1, `${key} 手机链接缺失`);
  assert.equal(await qr.isVisible(), true, `${key} 二维码在当前视口不可见`);
  assert.equal(await link.isVisible(), true, `${key} 链接文字在当前视口不可见`);
  assert.equal(await link.getAttribute("target"), null, `${key} 链接不得新开窗口`);
  assert.equal(await module.locator(".app-entry-copy").innerText(), "请使用手机扫码，在脉脉App内查看", `${key} 提示文案不正确`);
  const qrBox = await qr.boundingBox();
  assert.ok(qrBox && Math.abs(qrBox.width - qrBox.height) <= 1, `${key} 二维码不得拉伸变形`);
  assert.ok(Math.abs(qrBox.width - 116) <= 1, `${key} 二维码显示尺寸应保持116px`);
}

async function assertEntryModes(page, viewport) {
  for (const key of WEB_ENTRY_KEYS) {
    const module = page.locator(`[data-module="${key}"]`).last();
    const link = module.locator(`a[data-role="module-cta"][href="${CTA_MAP[key]}"]`);
    assert.equal(await link.count(), 1, `${key} Web入口缺失`);
    assert.equal(await link.isVisible(), true, `${key} Web入口必须可见`);
    assert.equal(await link.getAttribute("target"), null, `${key} 不得新开窗口`);
    assert.equal(await module.locator(".app-entry-qr").count(), 0, `${key} 不应显示App二维码`);
  }

  for (const key of APP_ENTRY_KEYS) await assertAppEntryMode(page, "#finalCard", key);
}

async function decodeAppQr(page, key) {
  return page.evaluate(async ({ key }) => {
    if (!("BarcodeDetector" in window)) throw new Error("当前Chrome不支持二维码解码验收");
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const image = document.querySelector(`#finalCard img.app-entry-qr[data-entry-key="${key}"]`);
    const results = await detector.detect(image);
    return results.map((item) => item.rawValue);
  }, { key });
}

async function assertPublicSourcesHidden(page, sourceData) {
  const bodyText = await page.locator("body").innerText();
  const html = await page.content();
  FORBIDDEN_PUBLIC_SOURCES.forEach((source) => {
    assert.equal(bodyText.includes(source), false, `用户可见文本泄露非脉脉来源：${source}`);
    assert.equal(html.includes(source), false, `HTML公开载荷泄露非脉脉来源：${source}`);
  });
  sourceData.jobs.filter((item) => !item.is_maimai).forEach((item) => {
    assert.equal(html.includes(item.source_url), false, `HTML公开载荷泄露非脉脉职位链接：${item.source_url}`);
  });
  sourceData.discussions.filter((item) => !item.is_maimai && item.url).forEach((item) => {
    assert.equal(html.includes(item.url), false, `HTML公开载荷泄露非脉脉帖子链接：${item.url}`);
  });
  assert.equal(await page.locator('.evidence-block,.source-list,[data-role="evidence"]').count(), 0, "用户侧不得展示证据块");
}

async function assertFinalModules(page) {
  assert.equal(await page.locator("#finalCard .card-links").count(), 0, "综合诊断卡不得保留统一链接集合区");
  for (const [name, url] of Object.entries(CTA_MAP)) await assertModuleEntry(page, "#finalCard", name, url);
  assert.equal(await page.locator('#finalCard > [data-module]').count(), 5);
  const layout = await page.locator("#finalCard").evaluate((card) => {
    const modules = [...card.querySelectorAll(":scope > [data-module]")];
    return modules.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width };
    });
  });
  layout.slice(1).forEach((box, index) => assert.ok(box.y > layout[index].y, "综合卡结果区必须纵向单列"));
  assert.deepEqual(await page.locator("#finalCard > .diagnosis-title").allTextContents(), []);
  assert.deepEqual(await page.locator("#finalCard .diagnosis-title").allTextContents(), ["今日在职性价比", "高薪坑位门槛", "同岗同行真话", "找同岗熟人内推", "看看前同事去向"]);
  const outro = page.locator(`#finalCard > .data-note`, { hasText: FINAL_OUTRO });
  assert.equal(await outro.count(), 1, "诊断卡结束语必须只出现一次");
  assert.equal(await outro.evaluate((node) => node.parentElement.lastElementChild === node), true, "结束语必须位于诊断卡内部最底部");
}

async function assertInitial(page, data, viewport) {
  assert.equal(await page.title(), "今日宜离职跑路吗");
  assert.equal(await page.locator(".brand strong").innerText(), "今日宜离职跑路吗");
  assert.equal(await page.locator(".brand span").innerText(), "同岗报价、好岗与真话｜最多3轮");
  assert.equal(await page.locator("#report").getAttribute("data-round"), "1");
  assert.equal(await page.locator("#report").getAttribute("data-run-id"), data.run_id);
  assert.equal(await page.locator("#round1 img.app-entry-qr").count(), 1, "默认HTML首轮应包含薪资周报二维码");
  assert.equal(await page.locator("#round1 .requirements li").count(), 3);
  assert.equal(await page.locator("#round1 .choice").count(), 2);
  await assertModuleEntry(page, "#round1", "salary_weekly", CTA_MAP.salary_weekly);
  await assertModuleEntry(page, "#round1", "high_salary_jobs", CTA_MAP.high_salary_jobs);
  await assertAppEntryMode(page, "#round1", "salary_weekly");
  assert.equal(await page.locator('#round1 [data-module="salary_weekly"] a[data-role="module-cta"][href="' + CTA_MAP.high_salary_jobs + '"]').count(), 0);
  assert.equal(await page.locator('#round1 [data-module="high_salary_jobs"] a[data-role="module-cta"][href="' + CTA_MAP.salary_weekly + '"]').count(), 0);
  await assertActionKinds(page);
  const text = await page.locator("#round1").innerText();
  [data.subject.city, data.subject.role, `${data.subject.experience_years}年`, data.result.position_label, data.result.average_label].forEach((value) => assert.ok(text.includes(value), `首轮缺少：${value}`));
  assert.equal(await page.locator("#round1 > .speaker + .bubble > h2").innerText(), data.result.headline, "首轮评估标题不得被包装文案覆盖");
  assert.deepEqual(await page.locator("#round1 .result-title").allTextContents(), ["今日在职性价比", "高薪的坑位都在挑什么人？", "带薪摸鱼1分钟，继续看看真话与好岗"]);
  assert.deepEqual(await page.locator("#round1 .choice").allTextContents(), ["1 听同岗同行真话", "2 看今日在招匹配好岗"]);
  assert.ok(text.includes(`数据参考：${data.salary_market.data_scope_label}｜有效样本${data.salary_market.sample_size}个｜核验时间：${data.salary_market.verified_at}`));
  assert.ok(text.includes("以上为公开招聘报价参照，不代表实际涨薪或录用结果。"));
  const height = await page.locator("#round1 .bubble").evaluate((node) => node.getBoundingClientRect().height);
  if (viewport.name === "mobile") assert.ok(height <= viewport.height * 1.3, `移动首轮过高：${height}px`);
  return height;
}

async function testPath(browser, data, pathSpec, viewport) {
  const { name: pathName, firstAction, secondAction, expectedSecondBranch } = pathSpec;
  const session = await openPage(browser, viewport);
  const { page, context, errors, requests } = session;
  const firstHeight = await assertInitial(page, data, viewport);
  assert.equal(await page.evaluate(() => window.scrollY), 0, `${viewport.name}/${pathName} 第1轮不得自动滚动`);
  await assertNoOverflow(page);
  await page.locator(`[data-action="${firstAction}"]`).click();
  assert.equal(await page.locator("#report").getAttribute("data-round"), "2");
  await waitForScrollSettled(page, '.message[data-round="2"]');
  await assertNoOverflow(page);
  if (firstAction === "peer") {
    assert.equal(await page.locator('[data-branch="peer"] h2').innerText(), `${data.subject.role}同行近期的真实处境与真话`);
    assert.deepEqual(await page.locator('[data-branch="peer"] .choice').allTextContents(), ["2 再看今日在招匹配好岗", "3 生成今日跑路可行性诊断卡"]);
    assert.equal(await page.locator('[data-branch="peer"] .post').count(), data.discussions.length);
    assert.equal(await page.locator('[data-branch="peer"] .post a').count(), data.discussions.filter((item) => item.is_maimai).length);
    assert.deepEqual(await page.locator('[data-branch="peer"] .post-title').allTextContents(), data.discussions.map((item, index) => `${index + 1}. ${item.summary}`), "网页没有原样使用 discussions 概括");
    await assertModuleEntry(page, '[data-branch="peer"]', "peer_discussions", CTA_MAP.peer_discussions);
  } else {
    assert.equal(await page.locator('[data-branch="jobs"] h2').innerText(), "看今日在招匹配好岗");
    assert.deepEqual(await page.locator('[data-branch="jobs"] .choice').allTextContents(), ["1 再听同岗同行真话", "3 生成今日跑路可行性诊断卡"]);
    assert.equal(await page.locator('[data-branch="jobs"] .job').count(), data.featured_job_ids.length);
    await assertModuleEntry(page, '[data-branch="jobs"]', "referral_network", CTA_MAP.referral_network);
    assert.equal(await page.locator('[data-branch="jobs"] a[href="' + CTA_MAP.high_salary_jobs + '"]').count(), 0, "岗位列表后不得重复高薪机会入口");
  }
  await page.locator(`[data-action="${secondAction}"]`).click();
  assert.equal(await page.locator("#report").getAttribute("data-round"), "3");
  assert.equal(await page.locator("#finalCard").count(), 1);
  const scroll = await assertRoundThreeScroll(page, `${viewport.name}/${pathName}`);
  const separation = await assertFinalSeparation(page);
  await assertFinalModules(page);
  await assertEntryModes(page, viewport);
  assert.equal(await page.locator(".choice").count(), 0, "第3轮不得保留继续按钮");
  assert.equal(await page.locator('[data-round="4"]').count(), 0);
  if (expectedSecondBranch) {
    assert.equal(await page.locator(`[data-round="3"][data-branch="${expectedSecondBranch}"]`).count(), 1);
  } else {
    assert.equal(await page.locator('[data-round="3"] .branch-summary').count(), 1);
    const summaryPrefix = firstAction === "peer" ? "今日在招匹配好岗速览：" : "同岗同行真话速览：";
    assert.ok((await page.locator('[data-round="3"] .branch-summary').innerText()).startsWith(summaryPrefix), "第3轮摘要前缀不正确");
  }
  const embedded = await page.locator("#report-data").textContent();
  const publicData = JSON.parse(embedded);
  assert.equal(publicData.run_id, data.run_id, "公开渲染数据run_id不一致");
  assert.deepEqual(publicData.subject, data.subject, "公开渲染数据用户输入不一致");
  assert.deepEqual(publicData.result, data.result, "公开渲染数据薪资结果不一致");
  assert.deepEqual(publicData.discussions.map((item) => item.summary), data.discussions.map((item) => item.summary), "公开网页与内部 discussions 概括不一致");
  publicData.jobs.filter((item) => !item.is_maimai).forEach((item) => assert.equal("source_url" in item, false, "非脉脉职位链接进入公开载荷"));
  publicData.discussions.filter((item) => !item.is_maimai).forEach((item) => assert.equal("url" in item, false, "非脉脉帖子链接进入公开载荷"));
  ["evidence", "evidence_records", "internal_evidence", "source_records", "evidence_summary"].forEach((key) => assert.equal(key in publicData, false, `内部证据字段进入公开载荷：${key}`));
  assert.equal(await page.locator("a[target]").count(), 0, "HTML不得设置target新窗口");
  assert.equal(await page.evaluate(() => [...document.scripts].some((script) => /window\.open\s*\(/.test(script.textContent))), false, "HTML不得使用window.open");
  await assertPublicSourcesHidden(page, data);

  const decodedQr = {};
  for (const key of APP_ENTRY_KEYS) {
    decodedQr[key] = await decodeAppQr(page, key);
    assert.deepEqual(decodedQr[key], [CTA_MAP[key]], `${key} 二维码解码结果不一致`);
  }
  const overflow = await assertNoOverflow(page);
  assert.deepEqual(errors, [], `控制台错误：${errors.join(" | ")}`);
  const runtimeHttp = requests.filter((url) => /^https?:/.test(url));
  assert.deepEqual(runtimeHttp, [], `页面运行时出现网络请求：${runtimeHttp.join(", ")}`);
  await context.close();
  return { name: pathName, viewport: viewport.name, max_round: 3, first_round_height: firstHeight, qr_targets: decodedQr, overflow, scroll, separation };
}

async function screenshotPath(browser, viewport, outputPath) {
  const { page, context, errors } = await openPage(browser, viewport);
  await page.locator('[data-action="jobs"]').click();
  await waitForScrollSettled(page, '.message[data-round="2"]');
  await page.locator('[data-action="peer-after-jobs"]').click();
  await assertRoundThreeScroll(page, `截图${viewport.width}x${viewport.height}`);
  await assertNoOverflow(page);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: outputPath, fullPage: true });
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  await context.close();
  return size;
}

async function screenshotMobileRoundOne(browser, outputPath) {
  const viewport = { name: "mobile", width: 390, height: 844 };
  const { page, context, errors } = await openPage(browser, viewport);
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  await assertInitial(page, data, viewport);
  await assertNoOverflow(page);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: outputPath, fullPage: false });
  await context.close();
  return { width: viewport.width, height: viewport.height };
}

async function screenshotFinalHandoff(browser, outputPath) {
  const viewport = { name: "desktop", width: 1440, height: 1000 };
  const { page, context, errors } = await openPage(browser, viewport);
  await page.locator('[data-action="jobs"]').click();
  await waitForScrollSettled(page, '.message[data-round="2"]');
  await page.locator('[data-action="peer-after-jobs"]').click();
  await assertRoundThreeScroll(page, "衔接截图");
  await assertFinalSeparation(page);
  const visibleParts = await page.locator('.message[data-round="3"] h2.final-section-heading').evaluate(async (heading) => {
    const previousAction = heading.previousElementSibling.querySelector(":scope > .result-action");
    const card = heading.nextElementSibling;
    const targetY = window.scrollY + previousAction.getBoundingClientRect().top - 80;
    window.scrollTo({ top: Math.max(0, targetY), behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const actionBox = previousAction.getBoundingClientRect();
    const headingBox = heading.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    return {
      actionVisible: actionBox.top >= 0 && actionBox.bottom <= window.innerHeight,
      headingVisible: headingBox.top >= 0 && headingBox.bottom <= window.innerHeight,
      cardStartVisible: cardBox.top >= 0 && cardBox.top < window.innerHeight
    };
  });
  assert.deepEqual(visibleParts, { actionVisible: true, headingVisible: true, cardStartVisible: true }, "衔接截图必须同时包含前一模块入口、分隔标题和卡片起始区");
  await page.screenshot({ path: outputPath, fullPage: false });
  await assertNoOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
  return { width: viewport.width, height: viewport.height };
}

async function validateDynamicRendering(browser, sourceData) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "salary-v2-"));
  const variant = structuredClone(sourceData);
  variant.run_id = "variant-run";
  variant.subject.city = "深圳";
  variant.subject.role = "数据产品经理";
  variant.subject.experience_years = 6;
  variant.subject.fixed_monthly_salary_yuan = 32000;
  variant.result.headline = "变体数据已载入";
  variant.result.position_label = "位于变体报价区间中部";
  variant.jobs[0].company = "变体公司";
  variant.evidence_records.jobs.find((item) => item.job_id === variant.jobs[0].id).company = "变体公司";
  variant.discussions[0].summary = "变体岗位做了5年，薪资上涨3000元。";
  variant.discussions[0].is_maimai = false;
  variant.discussions[0].url = "https://external.example/discussion";
  variant.discussions[0].source_platform = "外部测试平台";
  const selectedEvidence = variant.evidence_records.discussions.find((item) => item.discussion_id === variant.discussions[0].id);
  selectedEvidence.source_platform = "外部测试平台";
  selectedEvidence.source_url = variant.discussions[0].url;
  selectedEvidence.is_maimai = false;
  selectedEvidence.verified_facts = ["变体岗位", "做了5年", "薪资上涨3000元"];
  selectedEvidence.summary_claims = ["变体岗位", "5年", "3000元"];
  selectedEvidence.supports_question_hook = false;
  const input = path.join(tempDir, "data.json");
  const output = path.join(tempDir, "index.html");
  fs.writeFileSync(input, JSON.stringify(variant, null, 2));
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), input, output]);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(output).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const text = await page.locator("body").innerText();
  assert.ok(text.includes("深圳"));
  assert.ok(text.includes("数据产品经理"));
  assert.ok(!text.includes(sourceData.subject.city));
  const embedded = JSON.parse(await page.locator("#report-data").textContent());
  assert.equal("source_platform" in embedded.discussions[0], false, "非脉脉帖子平台进入公开载荷");
  assert.equal("url" in embedded.discussions[0], false, "非脉脉帖子外链进入公开载荷");
  assert.equal(await page.content().then((html) => html.includes("外部测试平台") || html.includes("external.example")), false, "非脉脉帖子来源泄露到HTML");
  await page.locator('[data-action="peer"]').click();
  await waitForScrollSettled(page, '.message[data-round="2"]');
  assert.equal(await page.locator('[data-branch="peer"] .post a').count(), 2, "非脉脉帖子不应显示原帖链接");
  await context.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  return true;
}

async function assertStrictSourceHiding(browser, sourceData) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "salary-v2-source-hiding-"));
  const input = path.join(tempDir, "data.json");
  const output = path.join(tempDir, "index.html");
  const variant = structuredClone(sourceData);
  const salarySnapshot = structuredClone({
    salary_market: variant.salary_market,
    result: variant.result,
    high_salary_requirements: variant.high_salary_requirements
  });

  const fakeJob = variant.jobs[0];
  const fakeJobEvidence = variant.evidence_records.jobs.find((item) => item.job_id === fakeJob.id);
  fakeJob.source_url = "https://maimai.cn/n/platform/job-detail/unverified-job";
  fakeJob.is_maimai = true;
  fakeJob.source_platform = "拉勾";
  fakeJob.source_name = "拉勾职位";
  fakeJob.source_domain = "lagou.com";
  fakeJob.logo = "https://lagou.com/logo.png";
  fakeJob.url = "https://lagou.com/jobs/1.html";
  fakeJob.canonical_url = "https://lagou.com/jobs/1.html";
  fakeJob.provider = "拉勾";
  fakeJob.metadata = { source_url: "https://lagou.com/jobs/1.html", platform: "拉勾" };
  Object.assign(fakeJobEvidence, {
    acquisition_method: "maimai_public_page",
    source_platform: "脉脉",
    source_id: "unverified-job",
    source_url: fakeJob.source_url,
    detail_url: fakeJob.source_url,
    detail_verified: false,
    page_public_readable: true,
    browser_login_required: false,
    browser_login_confirmed: false,
    same_job_verified: false
  });

  const verifiedJob = variant.jobs[1];
  const verifiedJobEvidence = variant.evidence_records.jobs.find((item) => item.job_id === verifiedJob.id);
  verifiedJob.source_url = "https://maimai.cn/n/job/geo/verified-job";
  verifiedJob.is_maimai = false;
  Object.assign(verifiedJobEvidence, {
    acquisition_method: "maimai_public_page",
    source_id: "verified-job",
    detail_url: verifiedJob.source_url,
    detail_verified: true,
    source_platform: "脉脉",
    source_url: verifiedJob.source_url,
    page_public_readable: true,
    browser_login_required: false,
    browser_login_confirmed: false,
    same_job_verified: true
  });

  const fakeDiscussion = variant.discussions[0];
  const fakeDiscussionEvidence = variant.evidence_records.discussions.find((item) => item.discussion_id === fakeDiscussion.id);
  fakeDiscussion.is_maimai = true;
  fakeDiscussion.source_platform = "拉勾";
  fakeDiscussion.source_url = "https://lagou.com/community/1";
  fakeDiscussion.metadata = { domain: "lagou.com", logo: "https://lagou.com/logo.png" };
  fakeDiscussionEvidence.source_platform = "拉勾";
  fakeDiscussionEvidence.is_maimai = true;

  fs.writeFileSync(input, JSON.stringify(variant, null, 2));
  const inputBefore = fs.readFileSync(input);
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), input, output]);
  assert.deepEqual(fs.readFileSync(input), inputBefore, "来源隐藏不得修改内部证据输入");

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(output).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const embedded = JSON.parse(await page.locator("#report-data").textContent());
  const fakePublicJob = embedded.jobs.find((item) => item.id === fakeJob.id);
  const verifiedPublicJob = embedded.jobs.find((item) => item.id === verifiedJob.id);
  const fakePublicDiscussion = embedded.discussions.find((item) => item.id === fakeDiscussion.id);
  assert.equal(fakePublicJob.is_maimai, false, "未通过详情同一性核验的职位必须按非脉脉处理");
  assert.equal("source_url" in fakePublicJob, false, "未核验职位不得公开原始链接");
  assert.deepEqual(Object.keys(fakePublicJob).sort(), ["company", "date_posted", "experience", "id", "is_maimai", "location", "requirements", "salary_max_yuan", "salary_min_yuan", "salary_months", "title"].sort(), "非脉脉职位公开字段超出白名单");
  assert.equal(verifiedPublicJob.is_maimai, true, "严格核验的脉脉职位应保留来源身份");
  assert.equal(verifiedPublicJob.source_url, verifiedJob.source_url, "严格核验的脉脉职位应保留同一详情链接");
  assert.equal(fakePublicDiscussion.is_maimai, false, "平台证据不一致的帖子必须按非脉脉处理");
  assert.deepEqual(Object.keys(fakePublicDiscussion).sort(), ["id", "is_maimai", "summary"], "非脉脉帖子公开字段超出白名单");
  const publicHtml = await page.content();
  ["拉勾", "lagou.com", "lagou.com/jobs/1.html", "lagou.com/community/1"].forEach((marker) => {
    assert.equal(publicHtml.includes(marker), false, `公开HTML泄露非脉脉来源：${marker}`);
  });
  assert.deepEqual({
    salary_market: embedded.salary_market,
    result: embedded.result,
    high_salary_requirements: embedded.high_salary_requirements
  }, salarySnapshot, "来源隐藏不得改变薪资结果或高薪要求");
  await context.close();

  const leaking = structuredClone(variant);
  leaking.high_salary_requirements[0].requirement = "拉勾数据显示该岗位需要相关经验。";
  fs.writeFileSync(input, JSON.stringify(leaking, null, 2));
  assert.throws(
    () => execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), input, output], { stdio: "pipe" }),
    /Command failed/,
    "未知外部平台名称进入公开内容时生成必须失败"
  );
  for (const phrase of ["根据多个招聘平台交叉验证", "数据来自某平台"]) {
    const phraseLeak = structuredClone(variant);
    phraseLeak.high_salary_requirements[0].requirement = `${phrase}，该岗位需要相关经验。`;
    fs.writeFileSync(input, JSON.stringify(phraseLeak, null, 2));
    assert.throws(
      () => execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), input, output], { stdio: "pipe" }),
      /Command failed/,
      `来源过程话术进入公开内容时生成必须失败：${phrase}`
    );
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  return true;
}

function buildDiscussionCountVariant(sourceData, count) {
  const variant = structuredClone(sourceData);
  const baseDiscussion = sourceData.discussions[0];
  const baseEvidence = sourceData.evidence_records.discussions.find((item) => item.selection_status === "selected");
  const fixtures = [
    { discussion: baseDiscussion, evidence: baseEvidence },
    {
      discussion: {
        id: "team-intensity-fixture",
        summary: "5年以上后端准备了解某团队，最关心的就是卷不卷、工作强度到底多大。",
        url: "https://maimai.cn/community/gossip-detail/39000002",
        is_maimai: true
      },
      evidence: {
        ...baseEvidence,
        discussion_id: "team-intensity-fixture",
        discovery_query: "site:maimai.cn/community/gossip-detail 后端 5年 团队强度",
        discovery_method: "path_site",
        source_url: "https://maimai.cn/community/gossip-detail/39000002",
        original_title: "团队强度测试夹具",
        page_role: "后端开发",
        page_experience: "5年+",
        page_date_text: "2026-09-12",
        published_at: "2026-09-12",
        content_category: "same_role_environment",
        matched_topics: ["团队强度", "加班"],
        verified_facts: ["5年以上后端准备了解某团队", "最关心团队卷不卷和工作强度"],
        summary_claims: ["5年以上后端", "某团队", "卷不卷", "工作强度"],
        supports_question_hook: false,
        selection_reason: "测试同岗团队环境内容可入选。"
      }
    },
    {
      discussion: {
        id: "hr-salary-fixture",
        summary: "做了3年招聘的HR认为，期望薪资报低后很难再抬高，跳槽谈薪应考虑20%-30%的溢价。",
        url: "https://maimai.cn/community/gossip-detail/39000003",
        is_maimai: true
      },
      evidence: {
        ...baseEvidence,
        discussion_id: "hr-salary-fixture",
        discovery_query: "脉脉 HR 跳槽 谈薪",
        discovery_method: "public_keyword",
        source_url: "https://maimai.cn/community/gossip-detail/39000003",
        original_title: "HR谈薪测试夹具",
        page_role: "HR",
        page_experience: "招聘3年",
        page_date_text: "2026-09-15",
        published_at: "2026-09-15",
        content_category: "recruiter_view",
        matched_topics: ["期望薪资", "跳槽谈薪"],
        verified_facts: ["做了3年招聘的HR认为期望薪资报低后很难再抬高", "HR认为跳槽谈薪应考虑20%-30%的溢价"],
        summary_claims: ["做了3年招聘的HR认为", "期望薪资报低后很难再抬高", "20%-30%"],
        supports_question_hook: false,
        selection_reason: "测试招聘方观点保留主体限定。"
      }
    },
    {
      discussion: {
        id: "fourth-fixture",
        summary: "5年以上后端投递10次只拿到1次面试，求职反馈明显偏少。",
        url: "https://maimai.cn/community/gossip-detail/39000004",
        is_maimai: true
      },
      evidence: {
        ...baseEvidence,
        discussion_id: "fourth-fixture",
        source_url: "https://maimai.cn/community/gossip-detail/39000004",
        original_title: "第四条测试夹具",
        page_date_text: "2026-09-18",
        published_at: "2026-09-18",
        content_category: "market_reference",
        matched_topics: ["求职难度"],
        verified_facts: ["5年以上后端投递10次只拿到1次面试"],
        summary_claims: ["5年以上后端", "投递10次", "1次面试"],
        supports_question_hook: false,
        selection_reason: "测试四条上限。"
      }
    }
  ];
  const selected = fixtures.slice(0, count);
  const rejected = sourceData.evidence_records.discussions.filter((item) => item.selection_status === "rejected");
  variant.discussions = selected.map((item) => structuredClone(item.discussion));
  variant.evidence_records.discussions = [...selected.map((item) => structuredClone(item.evidence)), ...structuredClone(rejected)];
  variant.branch_summaries.peer = `本次保留${count}条已核验同行讨论。`;
  variant.evidence_summary.discussion_count = count;
  return variant;
}

async function assertDiscussionCountRendering(browser, sourceData) {
  const salarySnapshot = structuredClone({ salary_market: sourceData.salary_market, result: sourceData.result });
  for (const count of [1, 2, 3]) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `salary-v2-discussion-${count}-`));
    const input = path.join(tempDir, "data.json");
    const output = path.join(tempDir, "index.html");
    const variant = buildDiscussionCountVariant(sourceData, count);
    fs.writeFileSync(input, JSON.stringify(variant, null, 2));
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), input, output]);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(pathToFileURL(output).href);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
    await page.locator('[data-action="peer"]').click();
    await waitForScrollSettled(page, '.message[data-round="2"]');
    assert.equal(await page.locator('[data-branch="peer"] .post').count(), count, `${count}条同行内容渲染数量错误`);
    assert.equal(await page.locator('[data-branch="peer"] .post a').count(), count, `${count}条脉脉帖子原帖链接数量错误`);
    const embedded = JSON.parse(await page.locator("#report-data").textContent());
    assert.deepEqual(embedded.discussions.map((item) => item.summary), variant.discussions.map((item) => item.summary), `${count}条同行概括未同源渲染`);
    assert.deepEqual({ salary_market: embedded.salary_market, result: embedded.result }, salarySnapshot, "帖子数量变化不得修改薪资结果");
    assert.equal(await page.content().then((html) => html.includes("页面只显示06-21")), false, "内部淘汰原因泄露到HTML");
    await assertNoOverflow(page);
    await context.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  for (const count of [0, 4]) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `salary-v2-discussion-invalid-${count}-`));
    const input = path.join(tempDir, "data.json");
    const output = path.join(tempDir, "index.html");
    fs.writeFileSync(input, JSON.stringify(buildDiscussionCountVariant(sourceData, count), null, 2));
    assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), input, output], { stdio: "pipe" }), /Command failed/, `${count}条同行内容应由生成器拒绝`);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "salary-v2-discussion-hr-"));
  const input = path.join(tempDir, "data.json");
  const output = path.join(tempDir, "index.html");
  const invalidHr = buildDiscussionCountVariant(sourceData, 3);
  invalidHr.discussions[2].summary = "跳槽谈薪普遍能涨20%-30%。";
  const invalidHrEvidence = invalidHr.evidence_records.discussions.find((item) => item.discussion_id === "hr-salary-fixture");
  invalidHrEvidence.verified_facts = ["HR个人观察中提到20%-30%的谈薪空间"];
  invalidHrEvidence.summary_claims = ["20%-30%"];
  fs.writeFileSync(input, JSON.stringify(invalidHr, null, 2));
  assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), input, output], { stdio: "pipe" }), /Command failed/, "招聘方个人观点缺少主体限定时应拒绝渲染");
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function main() {
  assertStaticSourceContracts();
  assertDefaultHtmlArtifact();
  const sampleBefore = fs.readFileSync(DATA_PATH);
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "render-interactive-report.cjs"), DATA_PATH, INDEX_PATH], { stdio: "inherit" });
  assert.deepEqual(fs.readFileSync(DATA_PATH), sampleBefore, "生成器不得修改内部结构化输入");
  const sampleHash = createHash("sha256").update(sampleBefore).digest("hex");
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  assertJobEvidenceContracts(data);
  assertDiscussionCopyContracts(data);
  await assertCdnJobAcquisitionPolicy(data);
  await assertDiscussionSearchPolicy(data);
  const template = fs.readFileSync(path.join(ROOT, "assets", "interactive-report-template.html"), "utf8");
  [data.subject.city, data.subject.role, "25K", data.jobs[0].title, data.discussions[0].summary].forEach((value) => {
    assert.ok(!template.includes(value), `模板写死示例数据：${value}`);
  });

  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const paths = [];
    for (const viewport of VIEWPORTS) {
      for (const pathSpec of PATHS) paths.push(await testPath(browser, data, pathSpec, viewport));
    }

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const desktop = await screenshotPath(browser, { width: 1440, height: 1000 }, path.join(SCREENSHOT_DIR, "desktop-round-3.png"));
    const mobile = await screenshotPath(browser, { width: 390, height: 844 }, path.join(SCREENSHOT_DIR, "mobile-round-3.png"));
    const mobileRoundOne = await screenshotMobileRoundOne(browser, path.join(SCREENSHOT_DIR, "mobile-round-1.png"));
    const finalHandoff = await screenshotFinalHandoff(browser, path.join(SCREENSHOT_DIR, "final-card-handoff.png"));
    const dynamic = await validateDynamicRendering(browser, data);
    const strictSourceHiding = await assertStrictSourceHiding(browser, data);
    await assertDiscussionCountRendering(browser, data);

    const validation = {
      generated_at: new Date().toISOString(),
      direct_file_open: true,
      state_paths: paths,
      max_round: Math.max(...paths.map((item) => item.max_round)),
      shared_json: true,
      no_runtime_network: true,
      dynamic_json_rendering: dynamic,
      sample_data_sha256: sampleHash,
      module_cta_adjacency: true,
      one_cta_per_module: true,
      final_unified_link_area: false,
      action_visual_distinction: true,
      mobile_single_column: true,
      scroll_anchor_verified: true,
      round_message_top_range_px: [0, 80],
      remaining_scroll_min_px: 80,
      default_html_delivery: true,
      html_only_user_file: false,
      native_markdown_links_after_html: DELIVERY_LINKS,
      native_fallback_only: true,
      same_tab_navigation: true,
      sources_hidden_from_public_html: true,
      strict_source_identity_and_allowlist: strictSourceHiding,
      job_acquisition_policy: true,
      job_acquisition_priority: ["maimai_cdn", "maimai_public_page", "maimai_detail_search", "external_public_search"],
      job_acquisition_scenarios: ["web_fetch_to_raw_http", "cdn_failure_to_public_page", "public_page_to_detail_search", "maimai_insufficient_to_external", "detail_identity_check", "browser_qr_login"],
      example_job_acquisition: data.evidence_records.job_acquisition_summary,
      job_login_wait_ms: LOGIN_WAIT_MS,
      job_post_login_wait_ms: POST_LOGIN_LIST_WAIT_MS,
      discussion_search_policy: true,
      discussion_render_counts: [1, 2, 3],
      discussion_time_verification: true,
      discussion_salary_isolation: true,
      app_entries: {
        qr_visible_all_viewports: true,
        link_text_visible_all_viewports: true,
        decoded_all_viewports: true,
        rendered_size_px: 116
      },
      fixed_links: FIXED_LINKS,
      screenshots: {
        desktop: { path: "screenshots/desktop-round-3.png", ...desktop },
        mobile: { path: "screenshots/mobile-round-3.png", ...mobile },
        mobile_round_one: { path: "screenshots/mobile-round-1.png", ...mobileRoundOne },
        final_card_handoff: { path: "screenshots/final-card-handoff.png", ...finalHandoff }
      },
      responsive_overflow: false
    };
    fs.writeFileSync(VALIDATION_PATH, `${JSON.stringify(validation, null, 2)}\n`);
    process.stdout.write(`${VALIDATION_PATH}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
