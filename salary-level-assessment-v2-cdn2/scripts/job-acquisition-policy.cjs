const MAIMAI_CDN_BASE_URL = "https://s.taou.com/n/platform/job-list.min.json";
const JOB_LIST_URL = "https://maimai.cn/n/platform/job-list";
const JOB_DETAIL_PREFIX = "https://maimai.cn/n/job/geo/";
const LOGIN_WAIT_MS = 90_000;
const POST_LOGIN_LIST_WAIT_MS = 20_000;
const MIN_POLL_INTERVAL_MS = 3_000;
const MAX_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const LOGIN_PROMPT = "请在90秒内使用脉脉App扫描当前页面二维码登录。登录成功后会自动继续；超时将改用其他公开招聘来源。";
const MOBILE_LOGIN_PROMPT = "在脉脉App中打开并登录";

const REQUIRED_CDN_COLUMNS = Object.freeze([
  "sourceId", "title", "companyName", "city", "locationText",
  "salaryText", "experienceText", "description"
]);
const ACQUISITION_METHODS = Object.freeze([
  "maimai_cdn",
  "maimai_public_page",
  "maimai_detail_search",
  "external_public_search"
]);
const MAIMAI_ACQUISITION_METHODS = new Set(ACQUISITION_METHODS.slice(0, 3));

const ACCESS_STATES = Object.freeze({
  CDN_AVAILABLE: "maimai_cdn_available",
  CDN_WEB_FETCH_FAILED: "maimai_cdn_web_fetch_failed",
  CDN_RAW_HTTP_FAILED: "maimai_cdn_raw_http_failed",
  MAIMAI_JOB_LIST_AVAILABLE: "maimai_job_list_available",
  LOGIN_REQUIRED: "login_required",
  LOGIN_TIMEOUT: "login_timeout",
  POST_LOGIN_LIST_TIMEOUT: "post_login_list_timeout",
  GRAY_OR_ENVIRONMENT_UNAVAILABLE: "gray_or_environment_unavailable",
  RISK_CONTROL: "risk_control",
  BROWSER_UNAVAILABLE: "browser_unavailable",
  MAIMAI_SAMPLE_INSUFFICIENT: "maimai_sample_insufficient",
  MAIMAI_DETAIL_SEARCH: "maimai_detail_search",
  EXTERNAL_PUBLIC_SEARCH: "external_public_search"
});

const READABLE_JOB_STATES = new Set(["job_list", "filter_controls"]);
const DIRECT_FALLBACK_STATES = new Map([
  ["pseudo_404", ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE],
  ["gray_unavailable", ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE],
  ["environment_unavailable", ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE],
  ["access_error", ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE],
  ["captcha", "captcha"],
  ["risk_control", ACCESS_STATES.RISK_CONTROL],
  ["closed", "page_closed"],
  ["login_required_no_qr", "login_required_no_qr"]
]);

function buildMaimaiCdnUrl(nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || String(nowMs).length !== 13) {
    throw new Error("CDN时间戳必须是13位正整数");
  }
  return `${MAIMAI_CDN_BASE_URL}?v=${nowMs}`;
}

function isMaimaiCdnUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}` === MAIMAI_CDN_BASE_URL &&
      [...url.searchParams.keys()].length === 1 &&
      /^[1-9]\d{12}$/.test(url.searchParams.get("v") || "") &&
      Number(url.searchParams.get("v")) > 0 &&
      !url.hash;
  } catch {
    return false;
  }
}

function assertNoCredentialFields(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/cookie|token|password|credential|authorization|secret|session_data|user_profile|personal_info/i.test(key)) {
      throw new Error(`${path}.${key} 不得保存登录凭证或用户个人信息`);
    }
    assertNoCredentialFields(child, `${path}.${key}`);
  }
}

function pushState(state, value) {
  if (value && !state.accessStates.includes(value)) state.accessStates.push(value);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isMaimaiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "maimai.cn" || url.hostname.endsWith(".maimai.cn"));
  } catch {
    return false;
  }
}

function buildMaimaiDetailUrl(sourceId) {
  if (typeof sourceId !== "string" || !sourceId.trim()) throw new Error("sourceId 不能为空");
  return `${JOB_DETAIL_PREFIX}${encodeURIComponent(sourceId.trim())}`;
}

function isMaimaiJobDetailUrl(value, sourceId = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "maimai.cn" || url.search || url.hash) return false;
    const match = url.pathname.match(/^\/n\/job\/geo\/([^/]+)$/);
    if (!match) return false;
    return sourceId === null || decodeURIComponent(match[1]) === String(sourceId);
  } catch {
    return false;
  }
}

function parseSalaryText(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[kK]\s*-\s*(\d+(?:\.\d+)?)\s*[kK](?:\s*[·x×]\s*(\d+)\s*薪)?$/);
  if (!match) return null;
  const salaryMin = Number(match[1]) * 1000;
  const salaryMax = Number(match[2]) * 1000;
  const salaryMonths = match[3] ? Number(match[3]) : null;
  if (!Number.isFinite(salaryMin) || !Number.isFinite(salaryMax) || salaryMin <= 0 || salaryMax <= salaryMin) return null;
  return {
    salary_min_yuan: salaryMin,
    salary_max_yuan: salaryMax,
    salary_months: salaryMonths
  };
}

function monthlySalaryMidpoint(job) {
  if (!Number.isFinite(job?.salary_min_yuan) || !Number.isFinite(job?.salary_max_yuan)) return null;
  return (job.salary_min_yuan + job.salary_max_yuan) / 2;
}

function calculateAverageMonthlySalary(jobs) {
  const midpoints = jobs.map(monthlySalaryMidpoint).filter(Number.isFinite);
  if (!midpoints.length) return null;
  return midpoints.reduce((sum, value) => sum + value, 0) / midpoints.length;
}

function parsePayload(value) {
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  if (typeof value === "string") return JSON.parse(value);
  if (!value || typeof value !== "object") throw new Error("CDN响应为空");
  if (Object.prototype.hasOwnProperty.call(value, "body")) return parsePayload(value.body);
  if (Object.prototype.hasOwnProperty.call(value, "data")) return parsePayload(value.data);
  if (Object.prototype.hasOwnProperty.call(value, "json")) return parsePayload(value.json);
  return value;
}

function parseCdnDataset(value, metadata = {}) {
  const payload = parsePayload(value);
  if (payload.schemaVersion === undefined || payload.schemaVersion === null) throw new Error("CDN缺少 schemaVersion");
  if (!Array.isArray(payload.columns)) throw new Error("CDN columns 必须是数组");
  if (!Array.isArray(payload.rows)) throw new Error("CDN rows 必须是数组");
  const missing = REQUIRED_CDN_COLUMNS.filter((key) => !payload.columns.includes(key));
  if (missing.length) throw new Error(`CDN缺少必要字段：${missing.join(",")}`);
  const records = payload.rows.map((row, rowIndex) => {
    if (!Array.isArray(row)) throw new Error(`CDN rows[${rowIndex}] 必须是数组`);
    const record = Object.fromEntries(payload.columns.map((column, index) => [column, row[index]]));
    if (typeof record.sourceId !== "string" || !record.sourceId.trim()) throw new Error(`CDN rows[${rowIndex}] 缺少 sourceId`);
    return record;
  });
  return {
    schemaVersion: payload.schemaVersion,
    columns: [...payload.columns],
    records,
    dataset_updated_at: metadata.dataset_updated_at || metadata.last_modified || null
  };
}

function experienceIncludes(value, years) {
  if (!Number.isFinite(years)) return true;
  const text = String(value || "");
  let match = text.match(/(\d+)\s*-\s*(\d+)年/);
  if (match) return years >= Number(match[1]) && years <= Number(match[2]);
  match = text.match(/(\d+)年以上/);
  if (match) return years >= Number(match[1]);
  match = text.match(/(\d+)年以内/);
  if (match) return years <= Number(match[1]);
  return false;
}

function roleTerms(criteria) {
  const terms = [criteria.role, ...(criteria.role_terms || criteria.roleTerms || [])]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
  if (terms.some((value) => value.includes("后端"))) terms.push("后端", "服务端", "后台", "Java后端", "Go后端");
  return [...new Set(terms)];
}

function recordMatchesCriteria(record, criteria = {}) {
  if (criteria.city && !`${record.city || ""} ${record.locationText || ""}`.includes(criteria.city)) return false;
  const terms = roleTerms(criteria);
  if (terms.length && !terms.some((term) => String(record.title || "").includes(term))) return false;
  const years = Number.isFinite(criteria.experience_years)
    ? criteria.experience_years
    : Number.parseFloat(String(criteria.experience || ""));
  if (!experienceIncludes(record.experienceText, years)) return false;
  return Boolean(parseSalaryText(record.salaryText));
}

function normalizeCdnJob(record, dataset) {
  const salary = parseSalaryText(record.salaryText);
  if (!salary) return null;
  const sourceId = String(record.sourceId);
  const detailUrl = buildMaimaiDetailUrl(sourceId);
  return {
    id: sourceId,
    job_id: sourceId,
    source_id: sourceId,
    acquisition_method: "maimai_cdn",
    dataset_url: dataset.dataset_url,
    dataset_schema_version: dataset.schemaVersion,
    dataset_updated_at: dataset.dataset_updated_at,
    source_platform: "脉脉",
    source_url: detailUrl,
    detail_url: detailUrl,
    detail_verified: false,
    page_public_readable: false,
    company: record.companyName,
    title: record.title,
    location: record.locationText || record.city,
    city: record.city,
    experience: record.experienceText,
    salary_text: record.salaryText,
    ...salary,
    description: record.description || "",
    requirements: record.description || "",
    published_at: null,
    date_posted: null,
    same_job_verified: false,
    is_maimai: false
  };
}

function filterCdnJobs(dataset, criteria = {}, maximumSampleSize = 50) {
  const jobs = [];
  for (const record of dataset.records) {
    if (!recordMatchesCriteria(record, criteria)) continue;
    const job = normalizeCdnJob(record, dataset);
    if (job) jobs.push(job);
    if (jobs.length >= maximumSampleSize) break;
  }
  return jobs;
}

function jobKey(job) {
  if (job?.source_id) return `source:${job.source_id}`;
  if (job?.job_id || job?.id) return `id:${job.job_id || job.id}`;
  const normalized = normalizeUrl(job?.detail_url || job?.source_url);
  return normalized ? `url:${normalized}` : `record:${JSON.stringify(job)}`;
}

function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = jobKey(job);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameJobFields(job, evidence) {
  const coreMatches = ["company", "title", "salary_min_yuan", "salary_max_yuan"].every((key) => evidence?.[key] === job?.[key]);
  const cityMatches = !job?.city || (evidence?.city ? evidence.city === job.city : String(evidence?.location || "").includes(job.city));
  const locationMatches = evidence?.location === job?.location || (cityMatches && String(evidence?.location || "").includes(job?.city || ""));
  return coreMatches && cityMatches && locationMatches;
}

function detailMatchesCandidate(candidate, detail) {
  if (!candidate || !detail) return false;
  const sourceId = candidate.source_id || candidate.sourceId || candidate.job_id || candidate.id;
  const detailUrl = detail.detail_url || detail.source_url;
  return Boolean(detail.page_type === "job_detail" || detail.state === "job_detail" || detail.is_job_detail === true) &&
    isMaimaiJobDetailUrl(detailUrl, sourceId) && sameJobFields(candidate, detail);
}

function isVerifiedMaimaiJob(job, evidence) {
  const sourceId = evidence?.source_id || job?.source_id || job?.id;
  const detailUrl = evidence?.detail_url || evidence?.source_url;
  return Boolean(
    job && evidence &&
    evidence.source_platform === "脉脉" &&
    MAIMAI_ACQUISITION_METHODS.has(evidence.acquisition_method) &&
    evidence.detail_verified === true &&
    evidence.page_public_readable === true &&
    evidence.same_job_verified === true &&
    isMaimaiJobDetailUrl(detailUrl, sourceId) &&
    normalizeUrl(detailUrl) === normalizeUrl(job.source_url || job.detail_url) &&
    sameJobFields(job, evidence)
  );
}

function classifyPublicFailure(result) {
  if (result?.robots_verified === true && result?.robots_disallowed === true) return "robots_disallowed";
  if ([403, 429].includes(result?.http_status)) return `http_${result.http_status}`;
  return ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE;
}

function resultJobs(result) {
  return Array.isArray(result?.jobs) ? result.jobs : [];
}

async function acquireCdnDataset({ webFetch, rawHttp, datasetUrl = buildMaimaiCdnUrl() }) {
  if (!isMaimaiCdnUrl(datasetUrl)) throw new Error("CDN数据集地址无效");
  const attempts = [];
  if (typeof webFetch === "function") {
    try {
      attempts.push("web_fetch");
      const result = await webFetch(datasetUrl);
      const dataset = parseCdnDataset(result, result?.metadata || {});
      dataset.dataset_url = datasetUrl;
      return { status: "success", dataset, datasetUrl, method: "web_fetch", attempts };
    } catch (error) {
      attempts.push(`web_fetch_failed:${error.message}`);
    }
  }
  if (typeof rawHttp === "function") {
    try {
      attempts.push("raw_http");
      const result = await rawHttp(datasetUrl);
      const dataset = parseCdnDataset(result, result?.metadata || {});
      dataset.dataset_url = datasetUrl;
      return { status: "success", dataset, datasetUrl, method: "raw_http", attempts };
    } catch (error) {
      attempts.push(`raw_http_failed:${error.message}`);
    }
  }
  return { status: "failed", dataset: null, datasetUrl, method: null, attempts };
}

async function waitForPage(browser, pollIntervalMs, limitMs, accept) {
  let elapsed = 0;
  while (elapsed < limitMs) {
    const waitMs = Math.min(pollIntervalMs, limitMs - elapsed);
    await browser.wait(waitMs);
    elapsed += waitMs;
    const result = accept(await browser.inspect());
    if (result) return result;
  }
  return null;
}

async function readBrowserJobs(browser, criteria) {
  if (typeof browser.applyFilters === "function") await browser.applyFilters(criteria);
  const result = await browser.readJobs(criteria);
  return resultJobs(result);
}

async function collectBrowserPage({ browser, criteria, pollIntervalMs, onLoginPrompt, state }) {
  if (!browser?.available) {
    pushState(state, ACCESS_STATES.BROWSER_UNAVAILABLE);
    return [];
  }
  state.browserUsed = true;
  await browser.open(JOB_LIST_URL, { visible: true });
  await browser.bringToFront();
  let page = await browser.inspect();
  if (READABLE_JOB_STATES.has(page.state)) return readBrowserJobs(browser, criteria);
  if (DIRECT_FALLBACK_STATES.has(page.state)) {
    pushState(state, DIRECT_FALLBACK_STATES.get(page.state));
    return [];
  }
  if (page.state !== "login_qr") {
    pushState(state, ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE);
    return [];
  }
  state.loginRequired = true;
  pushState(state, ACCESS_STATES.LOGIN_REQUIRED);
  if (!browser.canContinuouslyMonitor) {
    pushState(state, "continuous_monitoring_unavailable");
    return [];
  }
  if (browser.sameDeviceMobile) {
    if (!browser.supportsAppDeepLink || typeof browser.openInApp !== "function") {
      pushState(state, "mobile_login_unavailable");
      return [];
    }
    state.loginPromptShown = true;
    await onLoginPrompt(MOBILE_LOGIN_PROMPT);
    await browser.openInApp(JOB_LIST_URL);
  } else {
    state.loginPromptShown = true;
    await onLoginPrompt(LOGIN_PROMPT);
  }
  const loginResult = await waitForPage(browser, pollIntervalMs, LOGIN_WAIT_MS, (nextPage) => {
    if (READABLE_JOB_STATES.has(nextPage.state)) return { type: "jobs" };
    if (DIRECT_FALLBACK_STATES.has(nextPage.state)) return { type: "fallback", reason: DIRECT_FALLBACK_STATES.get(nextPage.state) };
    if (["logged_in_no_list", "authenticated_loading"].includes(nextPage.state)) return { type: "authenticated" };
    return null;
  });
  if (!loginResult) {
    pushState(state, ACCESS_STATES.LOGIN_TIMEOUT);
    return [];
  }
  if (loginResult.type === "fallback") {
    pushState(state, loginResult.reason);
    return [];
  }
  state.loginConfirmed = true;
  if (loginResult.type === "jobs") return readBrowserJobs(browser, criteria);
  const listResult = await waitForPage(browser, pollIntervalMs, POST_LOGIN_LIST_WAIT_MS, (nextPage) => {
    if (READABLE_JOB_STATES.has(nextPage.state)) return { type: "jobs" };
    if (DIRECT_FALLBACK_STATES.has(nextPage.state)) return { type: "fallback", reason: DIRECT_FALLBACK_STATES.get(nextPage.state) };
    return null;
  });
  if (!listResult) {
    pushState(state, ACCESS_STATES.POST_LOGIN_LIST_TIMEOUT);
    return [];
  }
  if (listResult.type === "fallback") {
    pushState(state, listResult.reason);
    return [];
  }
  return readBrowserJobs(browser, criteria);
}

function normalizeAcquiredJob(job, method) {
  const result = { ...job, acquisition_method: method };
  if (method === "external_public_search") {
    result.is_maimai = false;
    result.detail_verified = false;
    result.same_job_verified = false;
  } else {
    result.source_platform = "脉脉";
  }
  return result;
}

function appendJobs(acquired, jobs, method, maximumSampleSize) {
  const existing = new Set(acquired.map(({ job }) => jobKey(job)));
  for (const rawJob of jobs) {
    if (acquired.length >= maximumSampleSize) break;
    const job = normalizeAcquiredJob(rawJob, method);
    const key = jobKey(job);
    if (existing.has(key)) continue;
    existing.add(key);
    acquired.push({ job, acquisition_method: method });
  }
}

async function readPublicPage(reader, state) {
  if (typeof reader !== "function") return [];
  try {
    const result = await reader(JOB_LIST_URL);
    if (result?.status === "success" && Array.isArray(result.jobs)) return result.jobs;
    pushState(state, classifyPublicFailure(result));
    return [];
  } catch {
    pushState(state, ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE);
    return [];
  }
}

async function readDetailPage(candidate, { publicDetailRead, browser }) {
  const sourceId = candidate.source_id || candidate.sourceId || candidate.job_id || candidate.id;
  const detailUrl = candidate.detail_url || candidate.source_url || buildMaimaiDetailUrl(sourceId);
  if (!isMaimaiJobDetailUrl(detailUrl, sourceId)) return { verified: false, reason: "invalid_detail_url" };
  let publicFailed = false;
  if (typeof publicDetailRead === "function") {
    try {
      const detail = await publicDetailRead(detailUrl);
      if (detail?.state === "job_detail" || detail?.page_type === "job_detail" || detail?.is_job_detail === true) {
        if (!detailMatchesCandidate(candidate, { ...detail, detail_url: detail.detail_url || detailUrl })) {
          return { verified: false, reason: "job_identity_mismatch" };
        }
        return { verified: true, detail: { ...detail, detail_url: detail.detail_url || detailUrl }, read_method: "public_page" };
      }
      publicFailed = true;
    } catch {
      publicFailed = true;
    }
  }
  if (!publicFailed && typeof publicDetailRead === "function") return { verified: false, reason: "unreadable_job_detail" };
  if (!browser?.available || typeof browser.openJobDetail !== "function" || typeof browser.inspectJobDetail !== "function") {
    return { verified: false, reason: "browser_unavailable_or_source_unconfirmed" };
  }
  try {
    await browser.openJobDetail(detailUrl, { visible: true });
    const detail = await browser.inspectJobDetail();
    if (detail?.state !== "job_detail") return { verified: false, reason: detail?.state || "unreadable_job_detail" };
    const normalized = { ...detail, detail_url: detail.detail_url || detail.source_url || detailUrl };
    if (!detailMatchesCandidate(candidate, normalized)) return { verified: false, reason: "job_identity_mismatch" };
    return { verified: true, detail: normalized, read_method: "browser" };
  } catch {
    return { verified: false, reason: "browser_read_error" };
  }
}

function applyVerifiedDetail(candidate, detail, method = candidate.acquisition_method) {
  const publishedAt = detail.datePosted || detail.published_at || null;
  return {
    ...candidate,
    acquisition_method: method,
    source_platform: "脉脉",
    source_url: detail.detail_url,
    detail_url: detail.detail_url,
    detail_verified: true,
    page_public_readable: true,
    same_job_verified: true,
    published_at: publishedAt,
    date_posted: publishedAt,
    is_maimai: true
  };
}

async function collectDetailSearch({ detailSearch, publicDetailRead, browser, criteria, state, limit }) {
  if (typeof detailSearch !== "function") return [];
  pushState(state, ACCESS_STATES.MAIMAI_DETAIL_SEARCH);
  let candidates = [];
  try {
    const result = await detailSearch(criteria);
    candidates = result?.candidates || result?.jobs || [];
  } catch {
    return [];
  }
  const jobs = [];
  for (const candidate of candidates) {
    if (jobs.length >= limit) break;
    const result = await readDetailPage(candidate, { publicDetailRead, browser });
    if (!result.verified) continue;
    jobs.push(applyVerifiedDetail({ ...candidate, source_platform: "脉脉" }, result.detail, "maimai_detail_search"));
  }
  return jobs;
}

function finalize(acquired, state, cdnResult) {
  const jobs = acquired.map((item) => item.job);
  assertNoCredentialFields(jobs, "jobs");
  const counts = Object.fromEntries(ACQUISITION_METHODS.map((method) => [method, acquired.filter((item) => item.acquisition_method === method).length]));
  return {
    jobs,
    job_acquisition: acquired.map((item) => ({
      job_id: item.job.job_id || item.job.id || null,
      source_id: item.job.source_id || null,
      source_url: item.job.source_url || null,
      acquisition_method: item.acquisition_method
    })),
    primary_method: acquired[0]?.acquisition_method || null,
    acquisition_counts: counts,
    external_used: counts.external_public_search > 0,
    access_state: state.accessStates.at(-1) || null,
    access_states: [...state.accessStates],
    browser_used: state.browserUsed,
    browser_login_required: state.loginRequired,
    browser_login_confirmed: state.loginConfirmed,
    login_prompt_shown: state.loginPromptShown,
    cdn_read_method: cdnResult?.method || null,
    cdn_dataset_url: cdnResult?.datasetUrl || null,
    cdn_attempts: cdnResult?.attempts || []
  };
}

async function runJobAcquisition(options) {
  const {
    cdnWebFetch,
    cdnRawHttp,
    publicPageRead,
    browser,
    ssrRead,
    detailSearch,
    publicDetailRead,
    externalSearch,
    criteria = {},
    minimumSampleSize = 30,
    maximumSampleSize = 50,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onLoginPrompt = () => {}
  } = options;
  if (pollIntervalMs < MIN_POLL_INTERVAL_MS || pollIntervalMs > MAX_POLL_INTERVAL_MS) {
    throw new Error("登录状态检查间隔必须为3至5秒");
  }
  const state = { browserUsed: false, loginRequired: false, loginConfirmed: false, loginPromptShown: false, accessStates: [] };
  const acquired = [];
  const enough = () => acquired.length >= minimumSampleSize;
  const datasetUrl = buildMaimaiCdnUrl(options.nowMs === undefined ? Date.now() : options.nowMs);

  const cdnResult = await acquireCdnDataset({ webFetch: cdnWebFetch, rawHttp: cdnRawHttp, datasetUrl });
  if (cdnResult.status === "success") {
    pushState(state, ACCESS_STATES.CDN_AVAILABLE);
    appendJobs(acquired, filterCdnJobs(cdnResult.dataset, criteria, maximumSampleSize), "maimai_cdn", maximumSampleSize);
    if (enough()) return finalize(acquired, state, cdnResult);
    pushState(state, ACCESS_STATES.MAIMAI_SAMPLE_INSUFFICIENT);
  } else {
    if (cdnResult.attempts.some((item) => item.startsWith("web_fetch_failed"))) pushState(state, ACCESS_STATES.CDN_WEB_FETCH_FAILED);
    pushState(state, ACCESS_STATES.CDN_RAW_HTTP_FAILED);
  }

  appendJobs(acquired, await readPublicPage(publicPageRead, state), "maimai_public_page", maximumSampleSize);
  if (enough()) return finalize(acquired, state, cdnResult);

  try {
    const browserJobs = await collectBrowserPage({ browser, criteria, pollIntervalMs, onLoginPrompt, state });
    appendJobs(acquired, browserJobs, "maimai_public_page", maximumSampleSize);
  } catch {
    pushState(state, ACCESS_STATES.GRAY_OR_ENVIRONMENT_UNAVAILABLE);
  }
  if (enough()) return finalize(acquired, state, cdnResult);

  appendJobs(acquired, await readPublicPage(ssrRead, state), "maimai_public_page", maximumSampleSize);
  if (enough()) return finalize(acquired, state, cdnResult);

  appendJobs(acquired, await collectDetailSearch({
    detailSearch,
    publicDetailRead,
    browser,
    criteria,
    state,
    limit: maximumSampleSize - acquired.length
  }), "maimai_detail_search", maximumSampleSize);
  if (enough()) return finalize(acquired, state, cdnResult);

  pushState(state, ACCESS_STATES.EXTERNAL_PUBLIC_SEARCH);
  if (typeof externalSearch === "function") {
    try {
      appendJobs(acquired, resultJobs(await externalSearch(criteria)), "external_public_search", maximumSampleSize);
    } catch {}
  }
  return finalize(acquired, state, cdnResult);
}

async function verifyMaimaiJobCandidate(browser, candidate, publicDetailRead = null) {
  const result = await readDetailPage(candidate, { publicDetailRead, browser });
  if (!result.verified) return result;
  return {
    verified: true,
    job: applyVerifiedDetail(candidate, result.detail, candidate.acquisition_method || "maimai_cdn"),
    read_method: result.read_method
  };
}

async function selectFeaturedJobs({ candidates, browser, publicDetailRead = null, maxCount = 4 }) {
  const maimaiCandidates = candidates.filter((job) => job?.source_platform === "脉脉" || isMaimaiJobDetailUrl(job?.detail_url || job?.source_url));
  const externalCandidates = candidates.filter((job) => !maimaiCandidates.includes(job));
  const verified = [];
  const unverified = [];
  const verifications = [];
  for (const candidate of maimaiCandidates) {
    if (verified.length + unverified.length >= maxCount) break;
    const result = await verifyMaimaiJobCandidate(browser, candidate, publicDetailRead);
    verifications.push({ job_id: candidate.job_id || candidate.id || null, verified: result.verified, reason: result.reason || null });
    if (result.verified) verified.push(result.job);
    else unverified.push({ ...candidate, is_maimai: false, detail_verified: false, same_job_verified: false });
  }
  const jobs = [...verified, ...unverified, ...externalCandidates.map((job) => ({ ...job, is_maimai: false }))].slice(0, maxCount);
  return { jobs, verifications };
}

module.exports = {
  ACCESS_STATES,
  ACQUISITION_METHODS,
  DEFAULT_POLL_INTERVAL_MS,
  JOB_DETAIL_PREFIX,
  JOB_LIST_URL,
  LOGIN_PROMPT,
  LOGIN_WAIT_MS,
  MAIMAI_CDN_BASE_URL,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  MOBILE_LOGIN_PROMPT,
  POST_LOGIN_LIST_WAIT_MS,
  REQUIRED_CDN_COLUMNS,
  acquireCdnDataset,
  applyVerifiedDetail,
  assertNoCredentialFields,
  buildMaimaiCdnUrl,
  buildMaimaiDetailUrl,
  calculateAverageMonthlySalary,
  classifyPublicFailure,
  dedupeJobs,
  detailMatchesCandidate,
  filterCdnJobs,
  isMaimaiJobDetailUrl,
  isMaimaiCdnUrl,
  isVerifiedMaimaiJob,
  monthlySalaryMidpoint,
  normalizeCdnJob,
  parseCdnDataset,
  parseSalaryText,
  runJobAcquisition,
  selectFeaturedJobs,
  verifyMaimaiJobCandidate
};
