#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { isMaimaiDetailUrl, rejectReason } = require("./discussion-search-policy.cjs");
const { assertNoCredentialFields, isMaimaiCdnUrl, isVerifiedMaimaiJob } = require("./job-acquisition-policy.cjs");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(ROOT, "assets", "interactive-report-template.html");
const CSS_PATH = path.join(ROOT, "assets", "interactive-report.css");
const FIXED_LINKS = {
  salary_weekly: "https://taou.cn/x/nosfnMiG",
  high_salary_jobs: "https://maimai.cn/n/platform/job-list",
  peer_discussions: "https://maimai.cn/community/home/recommended",
  referral_network: "https://maimai.cn/n/platform/homepage/jobs",
  former_colleagues: "https://taou.cn/x/nosfnAJf"
};
const INTERNAL_EVIDENCE_KEYS = ["evidence", "evidence_records", "internal_evidence", "source_records", "evidence_summary"];
const PRIVATE_SOURCE_KEYS = ["source_platform", "platform", "source_name", "source_label", "source_domain", "domain", "logo", "source_url"];
const PUBLIC_JOB_KEYS = ["id", "company", "title", "location", "salary_min_yuan", "salary_max_yuan", "salary_months", "experience", "requirements", "date_posted"];
const FORBIDDEN_PUBLIC_SOURCES = ["猎聘", "职友集", "BOSS直聘", "智联招聘", "前程无忧", "liepin.com", "jobui.com", "zhipin.com", "zhaopin.com", "51job.com"];
const FORBIDDEN_PUBLIC_SOURCE_PHRASES = ["根据多个招聘平台交叉验证", "数据来自某平台"];
const EVIDENCE_SUMMARY_PATTERN = /该帖子讨论了|这篇帖子讨论了|发帖人表示|帖子提到/;
const FORBIDDEN_HOOK_PATTERN = /他最后会怎么选|后来怎么样了|原因竟然是这个|看看避坑指南|真相让人意外|结果所有人都没想到/;
const JOB_ACQUISITION_METHODS = ["maimai_cdn", "maimai_public_page", "maimai_detail_search", "external_public_search"];

function fail(message) {
  throw new Error(message);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 必须是对象`);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} 必须是非空字符串`);
}

function requireField(object, key, label) {
  if (!Object.prototype.hasOwnProperty.call(object, key)) fail(`${label} 缺少 ${key}`);
}

function validateDiscussionEvidence(evidence, index, runDate) {
  requireObject(evidence, `evidence_records.discussions[${index}]`);
  [
    "discovery_query", "discovery_method", "source_platform", "source_url", "original_title",
    "public_readable", "page_role", "page_experience", "page_date_text", "published_at",
    "published_at_verified", "sitemap_lastmod", "content_category", "matched_topics",
    "verified_facts", "selection_status", "selection_reason", "rejection_reason", "verified_at"
  ].forEach((key) => requireField(evidence, key, `evidence_records.discussions[${index}]`));
  ["discussion_id", "discovery_query", "discovery_method", "source_platform", "source_url", "original_title", "content_category", "verified_at"].forEach((key) => {
    requireString(evidence[key], `evidence_records.discussions[${index}].${key}`);
  });
  if (typeof evidence.public_readable !== "boolean") fail(`同行证据 public_readable 无效：${index + 1}`);
  if (typeof evidence.published_at_verified !== "boolean") fail(`同行证据 published_at_verified 无效：${index + 1}`);
  if (!Array.isArray(evidence.matched_topics)) fail(`同行证据 matched_topics 无效：${index + 1}`);
  if (!Array.isArray(evidence.verified_facts)) fail(`同行证据 verified_facts 无效：${index + 1}`);
  if (!["selected", "rejected"].includes(evidence.selection_status)) fail(`同行证据 selection_status 无效：${index + 1}`);
  if (typeof evidence.selection_reason !== "string" || typeof evidence.rejection_reason !== "string") fail(`同行证据选择原因无效：${index + 1}`);
  if (evidence.selection_status === "selected") {
    requireString(evidence.selection_reason, `evidence_records.discussions[${index}].selection_reason`);
    if (evidence.rejection_reason) fail(`已选帖子不得保留淘汰原因：${index + 1}`);
    const reason = rejectReason(evidence, runDate);
    if (reason) fail(`已选帖子不满足证据规则：${reason}`);
  } else if (!evidence.rejection_reason.trim()) {
    fail(`淘汰候选必须记录 rejection_reason：${index + 1}`);
  }
}

function validateJobEvidence(evidence, index) {
  requireObject(evidence, `evidence_records.jobs[${index}]`);
  [
    "job_id", "acquisition_method", "dataset_url", "dataset_schema_version", "dataset_updated_at",
    "source_platform", "source_id", "source_url", "detail_url", "detail_verified", "page_public_readable",
    "company", "title", "location", "experience", "salary_text", "salary_min_yuan",
    "salary_max_yuan", "salary_months", "description", "published_at", "verified_at",
    "selection_status", "selection_reason", "rejection_reason"
  ].forEach((key) => requireField(evidence, key, `evidence_records.jobs[${index}]`));
  ["job_id", "acquisition_method", "source_platform", "company", "title", "location", "experience", "salary_text", "description", "verified_at"].forEach((key) => {
    requireString(evidence[key], `evidence_records.jobs[${index}].${key}`);
  });
  if (!JOB_ACQUISITION_METHODS.includes(evidence.acquisition_method)) {
    fail(`职位证据 acquisition_method 无效：${index + 1}`);
  }
  ["detail_verified", "page_public_readable"].forEach((key) => {
    if (typeof evidence[key] !== "boolean") fail(`职位证据 ${key} 无效：${index + 1}`);
  });
  if (!["selected", "rejected"].includes(evidence.selection_status)) fail(`职位证据 selection_status 无效：${index + 1}`);
  if (typeof evidence.selection_reason !== "string" || typeof evidence.rejection_reason !== "string") fail(`职位证据选择原因无效：${index + 1}`);
  if (evidence.selection_status === "selected") {
    ["company", "title", "location", "experience"].forEach((key) => {
      requireString(evidence[key], `evidence_records.jobs[${index}].${key}`);
    });
    if (evidence.published_at !== null) requireString(evidence.published_at, `evidence_records.jobs[${index}].published_at`);
    ["salary_min_yuan", "salary_max_yuan"].forEach((key) => {
      if (!Number.isFinite(evidence[key])) fail(`职位证据 ${key} 无效：${index + 1}`);
    });
    if (evidence.salary_months !== null && !Number.isFinite(evidence.salary_months)) fail(`职位证据 salary_months 无效：${index + 1}`);
    requireString(evidence.selection_reason, `evidence_records.jobs[${index}].selection_reason`);
    if (evidence.rejection_reason) fail(`已选职位不得保留淘汰原因：${index + 1}`);
  } else if (!evidence.rejection_reason.trim()) {
    fail(`淘汰职位必须记录 rejection_reason：${index + 1}`);
  }
  if (evidence.acquisition_method === "maimai_cdn" && !isMaimaiCdnUrl(evidence.dataset_url)) {
    fail(`CDN职位必须记录本次运行生成的动态数据集地址：${index + 1}`);
  }
  if (evidence.acquisition_method === "maimai_cdn" && (!evidence.source_id || evidence.dataset_schema_version === null)) {
    fail(`CDN职位缺少source_id或schemaVersion：${index + 1}`);
  }
  if (evidence.detail_verified) {
    if (!evidence.page_public_readable || evidence.same_job_verified !== true) fail(`详情核验状态不完整：${index + 1}`);
    requireString(evidence.detail_url, `evidence_records.jobs[${index}].detail_url`);
  }
  if (evidence.acquisition_method === "external_public_search" && evidence.detail_verified) {
    fail(`非脉脉职位不得标记为已核验脉脉详情：${index + 1}`);
  }
  if (Object.prototype.hasOwnProperty.call(evidence, "same_job_verified") && typeof evidence.same_job_verified !== "boolean") {
    fail(`职位证据 same_job_verified 无效：${index + 1}`);
  }
  assertNoCredentialFields(evidence, `evidence_records.jobs[${index}]`);
}

function validateDiscussionCopy(item, index, evidence) {
  requireString(item.id, `discussions[${index}].id`);
  requireString(item.summary, `discussions[${index}].summary`);
  if (/\r|\n/.test(item.summary)) fail(`同行概括必须只有一行：${index + 1}`);
  const sentenceMarks = item.summary.match(/[。！？!?]/g) || [];
  if (sentenceMarks.length > 1 || (sentenceMarks.length === 1 && !/[。！？!?]$/.test(item.summary.trim()))) {
    fail(`同行概括必须只有一句话：${index + 1}`);
  }
  if (EVIDENCE_SUMMARY_PATTERN.test(item.summary)) fail(`同行概括不能写成证据摘要：${index + 1}`);
  if (FORBIDDEN_HOOK_PATTERN.test(item.summary)) fail(`同行概括包含禁止的悬念表达：${index + 1}`);

  requireObject(evidence, `discussions[${index}] 的内部证据`);
  if (!Array.isArray(evidence.verified_facts) || !evidence.verified_facts.length) fail(`同行证据缺少 verified_facts：${index + 1}`);
  if (!Array.isArray(evidence.summary_claims) || !evidence.summary_claims.length) fail(`同行证据缺少 summary_claims：${index + 1}`);
  const verifiedFacts = evidence.verified_facts.join("｜");
  evidence.summary_claims.forEach((claim) => {
    requireString(claim, `discussions[${index}] 的 summary_claim`);
    if (!item.summary.includes(claim) || !verifiedFacts.includes(claim)) fail(`同行概括事实无法回溯：${claim}`);
  });
  if (/[？?]$/.test(item.summary.trim())) {
    if (evidence.supports_question_hook !== true) fail(`同行概括钩子缺少原帖支持：${index + 1}`);
    if (!Array.isArray(evidence.hook_basis) || !evidence.hook_basis.length) fail(`同行概括钩子缺少事实依据：${index + 1}`);
  }
  if (evidence.content_category === "recruiter_view" && !/HR认为|招聘方观察|猎头认为|招聘经理认为|面试官认为/.test(item.summary)) {
    fail(`招聘方观点缺少主体限定：${index + 1}`);
  }
  if (evidence.has_final_choice !== true && /他最后会怎么选|后来怎么样了/.test(item.summary)) fail(`同行概括虚构最终选择：${index + 1}`);
  if (evidence.has_explained_reason !== true && /原因竟然是这个|真相让人意外/.test(item.summary)) fail(`同行概括虚构原因揭晓：${index + 1}`);
  if (evidence.has_systematic_method !== true && /看看避坑指南/.test(item.summary)) fail(`同行概括虚构系统方法：${index + 1}`);
}

function validate(data) {
  requireObject(data, "根数据");
  assertNoCredentialFields(data, "根数据");
  requireString(data.run_id, "run_id");
  requireString(data.generated_at, "generated_at");
  ["subject", "salary_market", "result", "branch_summaries", "ctas"].forEach((key) => requireObject(data[key], key));
  ["city", "role"].forEach((key) => requireString(data.subject[key], `subject.${key}`));
  if (!Number.isFinite(data.subject.experience_years)) fail("工作年限无效");
  if (!Number.isFinite(data.subject.fixed_monthly_salary_yuan)) fail("固定月薪无效");
  if (!Number.isFinite(data.salary_market.average_monthly_yuan)) fail("平均报价无效");
  requireString(data.salary_market.data_scope_label, "salary_market.data_scope_label");
  ["headline", "salary_level", "position_label", "average_label"].forEach((key) => requireString(data.result[key], `result.${key}`));
  ["monthly_gap_yuan", "annual_equal_gap_yuan"].forEach((key) => {
    if (!Number.isFinite(data.result[key])) fail(`result.${key} 无效`);
  });
  if (!Array.isArray(data.jobs) || data.jobs.length < 2) fail("至少需要2个职位");
  if (!Array.isArray(data.featured_job_ids) || data.featured_job_ids.length < 2 || data.featured_job_ids.length > 4) fail("featured_job_ids 必须包含2至4个职位");
  const ids = new Set(data.jobs.map((job) => job.id));
  data.featured_job_ids.forEach((id) => { if (!ids.has(id)) fail(`代表职位不存在：${id}`); });
  if (!Array.isArray(data.high_salary_requirements) || data.high_salary_requirements.length !== 3) fail("首轮需要3类高报价要求");
  if (!Array.isArray(data.discussions) || data.discussions.length < 1 || data.discussions.length > 3) fail("同行实况必须包含1至3条真实内容");
  requireObject(data.evidence_records, "evidence_records");
  if (!Array.isArray(data.evidence_records.jobs)) fail("职位需要逐条内部证据");
  data.evidence_records.jobs.forEach(validateJobEvidence);
  const evidenceByJobId = new Map(data.evidence_records.jobs.map((item) => [item.job_id, item]));
  if (evidenceByJobId.size !== data.evidence_records.jobs.length) fail("职位候选内部证据 id 重复");
  const selectedJobEvidence = data.evidence_records.jobs.filter((item) => item.selection_status === "selected");
  if (selectedJobEvidence.length !== data.jobs.length) fail("已选职位与职位数据数量不一致");
  data.jobs.forEach((job, index) => {
    const evidence = evidenceByJobId.get(job.id);
    if (!evidence || evidence.selection_status !== "selected") fail(`职位缺少已选证据：${index + 1}`);
    if (evidence.source_url !== job.source_url) fail(`职位链接与内部证据不一致：${index + 1}`);
    ["company", "title", "location", "experience", "salary_min_yuan", "salary_max_yuan", "salary_months"].forEach((key) => {
      if (evidence[key] !== job[key]) fail(`职位字段与内部证据不一致：${index + 1}.${key}`);
    });
  });
  if (!Array.isArray(data.evidence_records.discussions)) fail("同行实况需要候选内部证据数组");
  const runDate = new Date(`${data.generated_at}T23:59:59Z`);
  if (Number.isNaN(runDate.getTime())) fail("generated_at 无法用于帖子时间核验");
  data.evidence_records.discussions.forEach((item, index) => validateDiscussionEvidence(item, index, runDate));
  const evidenceByDiscussionId = new Map(data.evidence_records.discussions.map((item) => [item.discussion_id, item]));
  if (evidenceByDiscussionId.size !== data.evidence_records.discussions.length) fail("同行候选内部证据 id 重复");
  const selectedEvidence = data.evidence_records.discussions.filter((item) => item.selection_status === "selected");
  if (selectedEvidence.length !== data.discussions.length) fail("已选帖子与同行实况数量不一致");
  const discussionUrls = new Set();
  data.discussions.forEach((item, index) => {
    const evidence = evidenceByDiscussionId.get(item.id);
    if (!evidence || evidence.selection_status !== "selected") fail(`同行帖子缺少已选证据：${index + 1}`);
    validateDiscussionCopy(item, index, evidence);
    if (evidence.source_url && evidence.source_url !== item.url) fail(`同行帖子链接与内部证据不一致：${index + 1}`);
    if (discussionUrls.has(item.url)) fail(`同行帖子链接重复：${index + 1}`);
    discussionUrls.add(item.url);
  });
  requireString(data.branch_summaries.peer, "branch_summaries.peer");
  requireString(data.branch_summaries.jobs, "branch_summaries.jobs");
  Object.entries(FIXED_LINKS).forEach(([key, expected]) => {
    requireObject(data.ctas[key], `ctas.${key}`);
    if (data.ctas[key].url !== expected) fail(`固定链接不一致：${key}`);
    requireString(data.ctas[key].label, `ctas.${key}.label`);
  });
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(object, key)).map((key) => [key, object[key]]));
}

function isVerifiedMaimaiDiscussion(item, evidence) {
  return Boolean(
    evidence &&
    evidence.source_platform === "脉脉" &&
    evidence.public_readable === true &&
    evidence.content_evidence_source === "detail_body" &&
    evidence.selection_status === "selected" &&
    evidence.source_url === item.url &&
    isMaimaiDetailUrl(item.url)
  );
}

function buildPublicJob(job, evidence) {
  const item = pick(job, PUBLIC_JOB_KEYS);
  item.is_maimai = isVerifiedMaimaiJob(job, evidence);
  if (item.is_maimai) item.source_url = job.source_url;
  return item;
}

function buildPublicDiscussion(discussion, evidence) {
  const item = pick(discussion, ["id", "summary"]);
  item.is_maimai = isVerifiedMaimaiDiscussion(discussion, evidence);
  if (item.is_maimai) item.url = discussion.url;
  return item;
}

function sourceMarkers(data, jobEvidenceById, discussionEvidenceById) {
  const markers = new Set([...FORBIDDEN_PUBLIC_SOURCES, ...FORBIDDEN_PUBLIC_SOURCE_PHRASES]);
  data.jobs.forEach((job) => {
    const evidence = jobEvidenceById.get(job.id);
    if (isVerifiedMaimaiJob(job, evidence)) return;
    if (evidence?.source_platform && evidence.source_platform !== "脉脉") markers.add(evidence.source_platform);
    try {
      const hostname = new URL(evidence?.source_url).hostname;
      if (hostname !== "maimai.cn" && !hostname.endsWith(".maimai.cn")) markers.add(hostname);
    } catch {}
  });
  data.discussions.forEach((discussion) => {
    const evidence = discussionEvidenceById.get(discussion.id);
    if (isVerifiedMaimaiDiscussion(discussion, evidence)) return;
    if (evidence?.source_platform && evidence.source_platform !== "脉脉") markers.add(evidence.source_platform);
    try {
      const hostname = new URL(evidence?.source_url).hostname;
      if (hostname !== "maimai.cn" && !hostname.endsWith(".maimai.cn")) markers.add(hostname);
    } catch {}
  });
  return [...markers].filter(Boolean);
}

function toPublicData(data) {
  const publicData = structuredClone(data);
  const jobEvidenceById = new Map(data.evidence_records.jobs.map((item) => [item.job_id, item]));
  const discussionEvidenceById = new Map(data.evidence_records.discussions.map((item) => [item.discussion_id, item]));
  const hiddenMarkers = sourceMarkers(data, jobEvidenceById, discussionEvidenceById);
  INTERNAL_EVIDENCE_KEYS.forEach((key) => delete publicData[key]);
  PRIVATE_SOURCE_KEYS.forEach((key) => delete publicData.salary_market[key]);
  publicData.jobs = data.jobs.map((job) => buildPublicJob(job, jobEvidenceById.get(job.id)));
  publicData.discussions = data.discussions.map((discussion) => buildPublicDiscussion(discussion, discussionEvidenceById.get(discussion.id)));

  const serialized = JSON.stringify(publicData);
  hiddenMarkers.forEach((source) => {
    if (serialized.includes(source)) fail(`公开渲染数据包含非脉脉来源：${source}`);
  });
  return publicData;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || path.join(ROOT, "examples", "sample-data.json"));
  const outputPath = path.resolve(process.argv[3] || path.join(ROOT, "examples", "index.html"));
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  validate(data);
  const publicData = toPublicData(data);

  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const salaryQr = await QRCode.toDataURL(FIXED_LINKS.salary_weekly, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 320,
    color: { dark: "#000000", light: "#ffffff" }
  });
  const formerColleaguesQr = await QRCode.toDataURL(FIXED_LINKS.former_colleagues, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 320,
    color: { dark: "#000000", light: "#ffffff" }
  });
  const html = template
    .replace("/*__REPORT_CSS__*/", css)
    .replace("__REPORT_DATA__", safeJson(publicData))
    .replace("__SALARY_QR__", salaryQr)
    .replace("__FORMER_COLLEAGUES_QR__", formerColleaguesQr);

  if (html.includes("__REPORT_" ) || html.includes("__SALARY_QR__") || html.includes("__FORMER_COLLEAGUES_QR__")) fail("模板存在未替换的渲染标记");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
