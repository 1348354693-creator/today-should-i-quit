# 今日宜离职跑路吗 (Should I Quit Today?)

**Thinking of quitting today? Check the real market before you hand in your resignation.**

We all have moments at work when we ask, *"Should I just quit today?"* Instead of guessing or staying stuck in silence, check what the outside market actually looks like.

Just enter 4 basics: **City, Role, Years of Experience, and Pre-tax Fixed Monthly Salary**. You will see:

- 💰 **Are you underpaid?** Compare your current pay with public job quotes for the same role in your city.
- 👀 **What jobs are out there?** See verified public roles that match your background and what higher-paying jobs look for.
- 💬 **What are peers saying?** Read verified public discussions from people doing similar work.
- 🤝 **Where can you look for referrals?** Jump to [Maimai Jobs](https://maimai.cn/n/platform/homepage/jobs) to explore referral opportunities yourself. This Skill does not identify insiders or arrange referrals.
- 🕵️ **Want to see where former colleagues went?** Open the [Maimai App entry](https://taou.cn/x/nosfnAJf). Maimai may show relevant information based on the profile you provided there; this Skill does not read or display your Maimai profile, connections, or results.

No resume upload or recruiter chat is required to run the check. This Skill does not contact your employer or current HR. Visibility after entering Maimai depends on your Maimai account and privacy settings.

*"Should I Quit Today?" is lighthearted workplace humor. Public job data is provided for market reference only. It does not guarantee a raise or job offer, or predict the right time to quit. This Skill never reads your private Maimai data, relationship graph, cookies, or login credentials.*

## 下载与收藏

<!-- metrics:start -->
**[直接下载最新 Skill ZIP](https://github.com/1348354693-creator/today-should-i-quit/releases/download/v2.0.0/today-should-i-quit-v2.0.0.zip)**（v2.0.0，无需 GitHub 账号）

在仓库右上角点击 **Star** 即可收藏，后续可以在自己的 GitHub Stars 中找到。

| 指标 | 当前值 | 统计口径 |
| --- | ---: | --- |
| 收藏（Stars） | 2 | GitHub Stars |
| Release 下载 | 24 | 所有 Release 附件累计请求次数 |
| Forks | 1 | GitHub Forks |

_每天自动更新一次，也可以在 Actions 中手动刷新。_
<!-- metrics:end -->

下载 ZIP 后，可以在支持本地 Skill 导入的客户端中直接上传。

[查看访问量和克隆量](https://github.com/1348354693-creator/today-should-i-quit/graphs/traffic)（仅仓库所有者可见，GitHub 原生提供近 14 天数据）。

## 从源码安装

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

- README 中的下载量统计 GitHub Release 附件的累计请求次数，不包含 GitHub 自动生成的源码 ZIP/TAR。
- 仓库所有者可以在 `Insights -> Traffic` 查看近 14 天的克隆量和访问量；GitHub 不公开这组明细，也不长期保存完整历史。
- GitHub 无法判断下载后是否完成安装，因此 Release 下载量只能作为安装兴趣的代理指标，不等于真实安装量或活跃用户数。

## 许可证

[MIT](LICENSE)
