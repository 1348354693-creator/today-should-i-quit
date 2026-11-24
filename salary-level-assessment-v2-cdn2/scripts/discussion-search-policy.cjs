const MAIMAI_DETAIL_PATHS = ["/community/gossip-detail/", "/article/detail"];
const ALLOWED_CATEGORIES = new Set([
  "same_role_pay",
  "same_role_environment",
  "recruiter_view",
  "market_reference"
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildDiscussionKeywords(subject) {
  const role = String(subject.role || "").trim();
  const years = Number(subject.experience_years);
  const salary = Number(subject.fixed_monthly_salary_yuan);
  const backendAliases = /后端|服务端|后台/.test(role)
    ? ["后端开发", "后端工程师", "Java后端", "Go后端", "服务端开发", "后台开发"]
    : [role];
  const yearText = Number.isFinite(years) ? String(years) : "";
  const experienceTerms = Number.isFinite(years)
    ? [`${yearText}年`, `${toChineseNumber(years)}年`, `${Math.max(1, years - 2)}-${years}年`, `${years}年+`, `${years}-${years + 5}年`]
    : [];
  const salaryK = Number.isFinite(salary) ? salary / 1000 : null;
  const salaryWan = Number.isFinite(salary) ? salary / 10000 : null;
  const salaryTerms = Number.isFinite(salary)
    ? unique([
        Number.isInteger(salaryK) ? `${salaryK}K` : null,
        Number.isInteger(salaryK) ? `${salaryK}k` : null,
        Number.isInteger(salaryWan) ? `${salaryWan}万` : `${salaryWan.toFixed(1)}万`,
        String(salary)
      ])
    : [];
  return {
    city: String(subject.city || "").trim(),
    role_main: role.replace(/工程师|开发/g, "").trim() || role,
    role_aliases: unique([role, ...backendAliases]),
    experience_terms: experienceTerms,
    salary_terms: salaryTerms,
    themes: [
      { id: "salary", query: "薪资" },
      { id: "team_intensity", query: "团队强度" },
      { id: "job_change", query: "跳槽 Offer" },
      { id: "promotion", query: "晋升" },
      { id: "bonus", query: "奖金" }
    ]
  };
}

function toChineseNumber(value) {
  const numbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return Number.isInteger(value) && value >= 0 && value <= 10 ? numbers[value] : String(value);
}

function buildDiscussionSearchPlan(subject) {
  const keywords = buildDiscussionKeywords(subject);
  const role = keywords.role_main || keywords.role_aliases[0];
  const experience = keywords.experience_terms[0] || "";
  const relaxations = [
    { id: "city_role_experience", terms: [keywords.city, role, experience] },
    { id: "role_experience", terms: [role, experience] },
    { id: "role", terms: [role] },
    { id: "recruiter", terms: ["HR"] },
    { id: "adjacent_role", terms: [/后端|服务端|后台/.test(role) ? "技术岗位" : role, experience] }
  ];
  const stages = [
    { id: "path_site", method: "path_site", prefixes: ["site:maimai.cn/community/gossip-detail", "site:maimai.cn/article/detail"] },
    { id: "domain_site", method: "domain_site", prefixes: ["site:maimai.cn"] },
    { id: "public_keyword", method: "public_keyword", prefixes: ["脉脉"] }
  ];

  stages.forEach((stage) => {
    stage.queries = [];
    relaxations.forEach((relaxation) => {
      keywords.themes.forEach((theme) => {
        if (relaxation.id === "recruiter" && !["salary", "job_change"].includes(theme.id)) return;
        if (relaxation.id === "adjacent_role" && theme.id !== "job_change") return;
        stage.prefixes.forEach((prefix) => {
          const salaryTerm = theme.id === "salary" && relaxation.id === "role" ? keywords.salary_terms[0] : "";
          stage.queries.push({
            stage: stage.id,
            method: stage.method,
            relaxation: relaxation.id,
            theme_id: theme.id,
            query: [prefix, ...relaxation.terms, salaryTerm, theme.query].filter(Boolean).join(" ")
          });
        });
      });
    });
  });
  return { keywords, stages };
}

function isMaimaiDetailUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "maimai.cn" && MAIMAI_DETAIL_PATHS.some((path) => url.pathname.startsWith(path));
  } catch {
    return false;
  }
}

function canonicalCandidateKey(candidate) {
  try {
    const url = new URL(candidate.source_url);
    if (url.pathname.startsWith("/community/gossip-detail/")) return `${url.origin}${url.pathname}`;
    if (url.pathname.startsWith("/article/detail")) return `${url.origin}${url.pathname}?fid=${url.searchParams.get("fid") || ""}`;
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return candidate.candidate_id;
  }
}

function subtractUtcMonths(date, months) {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

function rejectReason(candidate, now) {
  if (candidate.is_maimai && !isMaimaiDetailUrl(candidate.source_url)) return "不是允许的脉脉帖子详情页";
  if (candidate.public_readable !== true) return "原始详情页正文不可公开读取";
  if (candidate.content_evidence_source !== "detail_body") return "搜索摘要不能作为正文证据";
  if (candidate.used_unreadable_comments === true) return "使用了未登录状态无法读取的评论";
  if (candidate.published_at_verified !== true || !candidate.published_at) return "发布时间年份未核验";
  const publishedAt = new Date(candidate.published_at);
  if (Number.isNaN(publishedAt.getTime())) return "发布时间无效";
  if (publishedAt > now) return "发布时间晚于核验时间";
  if (publishedAt < subtractUtcMonths(now, 24)) return "发布时间超过最近24个月";
  if (!ALLOWED_CATEGORIES.has(candidate.content_category)) return "内容类型不属于同行决策参考";
  if (!Array.isArray(candidate.verified_facts) || candidate.verified_facts.length === 0) return "正文事实未核验";
  return "";
}

function rankCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const booleans = ["decision_relevant", "has_specific_signal"];
    for (const key of booleans) {
      const difference = Number(Boolean(right[key])) - Number(Boolean(left[key]));
      if (difference) return difference;
    }
    const dateDifference = new Date(right.published_at) - new Date(left.published_at);
    if (dateDifference) return dateDifference;
    return Number(Boolean(right.city_match)) - Number(Boolean(left.city_match));
  });
}

function selectPreferredMix(candidates, limit) {
  const ranked = rankCandidates(candidates);
  const groups = [
    (item) => item.content_category === "same_role_pay",
    (item) => item.content_category === "same_role_environment",
    (item) => ["recruiter_view", "market_reference"].includes(item.content_category)
  ];
  const selected = [];
  groups.forEach((matches) => {
    const candidate = ranked.find((item) => matches(item) && !selected.includes(item));
    if (candidate && selected.length < limit) selected.push(candidate);
  });
  ranked.forEach((candidate) => {
    if (selected.length < limit && !selected.includes(candidate)) selected.push(candidate);
  });
  return selected;
}

async function discoverDiscussions({ subject, search, searchExternal, now = new Date(), limit = 3 }) {
  const plan = buildDiscussionSearchPlan(subject);
  const acceptedMaimai = [];
  const rejected = [];
  const seen = new Set();
  let siteUnsupported = false;

  for (const timeWindowMonths of [12, 24]) {
    for (const stage of plan.stages) {
      if (siteUnsupported && stage.method !== "public_keyword") continue;
      for (const step of stage.queries) {
        const response = await search({ ...step, time_window_months: timeWindowMonths });
        if (response?.supported === false && stage.method !== "public_keyword") {
          siteUnsupported = true;
          break;
        }
        for (const candidate of response?.results || []) {
          const key = canonicalCandidateKey(candidate);
          if (seen.has(key)) continue;
          seen.add(key);
          const reason = rejectReason(candidate, now);
          if (reason) rejected.push({ ...candidate, selection_status: "rejected", rejection_reason: reason });
          else if (candidate.is_maimai) acceptedMaimai.push(candidate);
        }
        if (selectPreferredMix(acceptedMaimai, limit).length >= limit) break;
      }
      if (selectPreferredMix(acceptedMaimai, limit).length >= limit) break;
    }
    if (selectPreferredMix(acceptedMaimai, limit).length >= limit) break;
  }

  const selected = selectPreferredMix(acceptedMaimai, limit);
  if (selected.length < limit && typeof searchExternal === "function") {
    const response = await searchExternal(plan.keywords);
    const externalAccepted = [];
    for (const candidate of response?.results || []) {
      const key = canonicalCandidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      const reason = rejectReason(candidate, now);
      if (reason) rejected.push({ ...candidate, selection_status: "rejected", rejection_reason: reason });
      else externalAccepted.push(candidate);
    }
    selected.push(...selectPreferredMix(externalAccepted, limit - selected.length));
  }

  return {
    selected: selected.slice(0, limit).map((item) => ({ ...item, selection_status: "selected", rejection_reason: "" })),
    rejected,
    plan
  };
}

module.exports = {
  buildDiscussionKeywords,
  buildDiscussionSearchPlan,
  discoverDiscussions,
  isMaimaiDetailUrl,
  rejectReason,
  selectPreferredMix
};
