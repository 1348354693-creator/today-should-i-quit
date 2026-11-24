# 今日宜离职跑路吗

[![Release 下载量](https://img.shields.io/github/downloads/1348354693-creator/today-should-i-quit/total?label=Release%20%E4%B8%8B%E8%BD%BD&color=2ea44f)](https://github.com/1348354693-creator/today-should-i-quit/releases)
[![GitHub Release](https://img.shields.io/github/v/release/1348354693-creator/today-should-i-quit?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC)](https://github.com/1348354693-creator/today-should-i-quit/releases/latest)

输入城市、岗位、工作年限和税前固定月薪，基于可核验的公开招聘报价、职位和同行讨论，生成单文件交互报告，帮助用户对照当前薪资与公开市场报价。

“跑路”是产品包装，不代表离职预测、实际涨薪承诺或录用保证。

## 下载与安装

推荐从 [Releases](https://github.com/1348354693-creator/today-should-i-quit/releases/latest) 下载最新的 `today-should-i-quit-v2.0.0.zip`，再在支持本地 Skill 导入的客户端中上传该 ZIP。

也可以克隆源码：

```bash
git clone https://github.com/1348354693-creator/today-should-i-quit.git
cd today-should-i-quit/salary-level-assessment-v2-cdn2
npm ci
```

Skill 的内部标识是 `salary-level-assessment-v2-cdn2`，入口与完整执行规则见 [SKILL.md](salary-level-assessment-v2-cdn2/SKILL.md)。

## 本地验证

```bash
npm test
```

`npm test` 会重新生成 `examples/index.html`、校验 JSON 和示例截图。实时 CDN 检查需要联网，并会更新 `examples/cdn-live-validation.json`：

```bash
npm run test:cdn-live
```

## 数据说明

`examples/` 中的职位、公司、讨论链接和岗位 ID 来自生成示例时可访问的公开信息，仅作为历史快照与验收样例，不代表职位当前仍在招聘，也不作为个人结果或承诺。

## 统计口径

- README 顶部的下载量统计 GitHub Release 附件的累计下载次数，不包含 GitHub 自动生成的源码 ZIP/TAR。
- 仓库所有者可以在 `Insights -> Traffic` 查看近 14 天的克隆量和访问量；GitHub 不公开这组明细，也不长期保存完整历史。
- GitHub 无法判断下载后是否完成安装，因此 Release 下载量只能作为安装兴趣的代理指标，不等于真实安装量或活跃用户数。

## 许可证

[MIT](LICENSE)
