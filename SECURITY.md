# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub instead: open the repository's **Security** tab
and choose **Report a vulnerability**
(https://github.com/jiangding01/easy-translate/security/advisories/new).

Useful details: the affected version or commit, the browser and its version, steps to
reproduce, and the impact you expect. You will get a reply as soon as possible; please
keep the report private until a fix is released.

## Scope

This is a browser extension that runs on every web page. Of particular interest:

- a web page reading or influencing the extension (its ID, its messages, its storage);
- API keys stored by the extension leaking to a page, a log or a third party;
- text sent to a translation service the user did not choose.

## 安全问题报告（中文）

发现安全问题时，请不要公开提 issue。请在仓库的 **Security** 页点 **Report a vulnerability**
私下提交，并附上受影响的版本或提交、浏览器及版本、复现步骤和可能的影响。修复发布前请勿公开细节。
