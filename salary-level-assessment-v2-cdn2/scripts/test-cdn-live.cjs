#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const {
  JOB_LIST_URL,
  buildMaimaiCdnUrl,
  buildMaimaiDetailUrl,
  parseCdnDataset,
  parseSalaryText
} = require("./job-acquisition-policy.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "examples", "cdn-live-validation.json");

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "accept-encoding": "identity",
        "user-agent": "Mozilla/5.0 salary-level-assessment-v2-cdn2-validation"
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 3) return reject(new Error(`重定向过多：${url}`));
        return resolve(get(new URL(response.headers.location, url).toString(), redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode}：${url}`));
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        url,
        status_code: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.setTimeout(60_000, () => request.destroy(new Error(`请求超时：${url}`)));
    request.on("error", reject);
  });
}

function jsonLd(html, type) {
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const value = JSON.parse(match[1]);
      if (value?.["@type"] === type) return value;
    } catch {}
  }
  return null;
}

function visibleSalary(html) {
  const match = html.match(/\d+(?:\.\d+)?k-\d+(?:\.\d+)?k(?:·\d+薪)?/i);
  return match?.[0] || null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const timestampMs = Date.now();
  const datasetUrl = buildMaimaiCdnUrl(timestampMs);
  const cdnResponse = await get(datasetUrl);
  const dataset = parseCdnDataset(cdnResponse.body, { last_modified: cdnResponse.headers["last-modified"] || null });
  assert.ok(dataset.records.length > 0, "CDN rows必须大于0");
  assert.ok(dataset.records.some((record) => typeof record.description === "string" && record.description.trim()), "CDN description不可读");

  const listResponse = await get(JOB_LIST_URL);
  const itemList = jsonLd(listResponse.body, "ItemList");
  assert.ok(itemList && Number.isFinite(itemList.numberOfItems), "职位网页缺少ItemList数量");
  assert.equal(itemList.numberOfItems, dataset.records.length, "同一时点网页职位数量与CDN不一致");
  const pageIds = [...new Set([...listResponse.body.matchAll(/\/n\/job\/geo\/([^?"'<\\/]+)/g)].map((match) => decodeURIComponent(match[1])))].slice(0, 3);
  assert.ok(pageIds.length > 0, "职位网页首屏未发现详情ID");
  const datasetIds = new Set(dataset.records.map((record) => record.sourceId));
  pageIds.forEach((id) => assert.ok(datasetIds.has(id), `网页首屏ID不在CDN：${id}`));
  const cdnFirstIds = dataset.records.slice(0, pageIds.length).map((record) => record.sourceId);
  assert.deepEqual(pageIds, cdnFirstIds, "网页首屏职位顺序与CDN前排记录不一致");

  const detailResults = [];
  for (const id of pageIds.slice(0, 2)) {
    const record = dataset.records.find((item) => item.sourceId === id);
    const detailUrl = buildMaimaiDetailUrl(id);
    const detailResponse = await get(detailUrl);
    const posting = jsonLd(detailResponse.body, "JobPosting");
    assert.ok(posting, `详情页缺少JobPosting：${id}`);
    assert.equal(posting.title, record.title, `详情岗位不一致：${id}`);
    assert.equal(posting.hiringOrganization?.name, record.companyName, `详情公司不一致：${id}`);
    assert.ok(String(posting.jobLocation?.address || "").includes(record.city), `详情城市不一致：${id}`);
    assert.equal(posting.experienceRequirements, record.experienceText, `详情经验不一致：${id}`);
    const salaryText = visibleSalary(detailResponse.body);
    assert.deepEqual(parseSalaryText(salaryText), parseSalaryText(record.salaryText), `详情薪资不一致：${id}`);
    assert.ok(posting.datePosted, `详情缺少datePosted：${id}`);
    detailResults.push({
      source_id: id,
      detail_url: detailUrl,
      title: posting.title,
      company: posting.hiringOrganization.name,
      city: record.city,
      salary_text: salaryText,
      experience: posting.experienceRequirements,
      published_at: posting.datePosted
    });
  }

  const result = {
    checked_at: new Date().toISOString(),
    started_at: startedAt,
    acquisition_method: "raw_http",
    timestamp_ms: timestampMs,
    dataset_url: datasetUrl,
    http_status: cdnResponse.status_code,
    schema_version: dataset.schemaVersion,
    last_modified: cdnResponse.headers["last-modified"] || null,
    dataset_updated_at: dataset.dataset_updated_at,
    cdn_job_count: dataset.records.length,
    description_readable: true,
    webpage_declared_count: itemList.numberOfItems,
    webpage_first_ids: pageIds,
    cdn_first_ids: cdnFirstIds,
    webpage_first_ids_exist_in_cdn: true,
    webpage_first_ids_order_matches: true,
    detail_verified_count: detailResults.length,
    details: detailResults
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
