# 云成本规划器

[English](README.md) · 在线使用：**https://cost.1ms.dog**

填上你要跑的业务和每月流量，它把每家 VPS 和云主机，连同对象存储和 CDN，按一个月算出费用，推荐最便宜的整套方案。

- **服务器**：Hetzner、DigitalOcean、Vultr、Linode（Akamai）、AWS Lightsail、腾讯云轻量、阿里云轻量应用服务器（香港、新加坡、东京、法兰克福、弗吉尼亚）、Oracle Cloud、AWS EC2、谷歌云、Azure
- **对象存储**：Cloudflare R2、Amazon S3、Backblaze B2、Wasabi、DigitalOcean Spaces、Hetzner Object Storage
- **CDN**：Cloudflare（免费版）、Amazon CloudFront、Bunny CDN
- 套餐流量和超额费、云厂商按 GB 收的出口费（含阶梯和免费额度）、Premium/Standard 网络层级、发往中国大陆的价格、请求费、最低计费量、公平使用和条款限制（Cloudflare 免费版不能发视频、Wasabi 出口不能超过存储量）
- 从你自己的浏览器测到页面上每个机房的延迟（用 Me2Cloud 的测速点和方法）
- 流量大时自动按多台服务器计算（每台按 1 Gbit/s 或套餐带宽）；缺货的套餐会显示，但不推荐
- 推荐：用户所在区域最便宜、服务商最少、中国大陆用户的香港机房、明显更便宜时的其他大洲；流量变化时的费用曲线和交叉点；所有厂商对比表
- 10 种语言，每种语言 25 个预渲染页面（场景、流量费、对比、最便宜）
- 全部在浏览器里计算，没有后端，不上传任何数据

## 价格数据

所有价格都在 `data/*.json`，每一条带 `source`（厂商定价页或价格接口）和 `verifiedAt`（核对日期）。构建时复制到 `/data/*.json`（允许跨域），谁都可以用。

| 文件 | 内容 |
|---|---|
| `vps.json` | 按厂商产品线和区域的服务器套餐：CPU、内存、硬盘、价格、自带流量 |
| `egress.json` | 云厂商公网出口阶梯价，按来源区域和目的地 |
| `storage.json` | 对象存储：存储、出口、请求、最低计费 |
| `cdn.json` | 按用户区域的 CDN 阶梯价 |
| `rates.json` | 固定汇率（欧洲央行） |

价格不含税。1 TB = 1024 GB，一个月按 730 小时。`npm test` 检查每条数据都有来源和日期、阶梯价单调递增，并用手算值和所有场景的快照测试计算结果；超过 90 天没核对的数据会给出警告。

发现价格不对？带上厂商页面开个 issue。

## 开发

```bash
npm ci
npm run build      # 从 src/ 和 data/ 生成 public/
npm test           # 构建是否最新、数据检查、计算测试
npm run dev        # http://localhost:8799/
npm run og         # 链接预览图（用系统字体，生成后提交）
```

`npm run prices` 把数据和 AWS、Azure、Vultr 的价格接口比对，并列出超过 90 天没人工核对的条目；GitHub 每周一自动跑一次，有需要处理的就会失败并发邮件。有意改了价格之后刷新快照：`UPDATE=1 node --test "test/*.test.mjs"`。

## 部署

`npx wrangler deploy` 上传 `public/` 静态资源和 `src/worker.js`。静态文件直接返回、不运行 Worker（免费）；Worker 只处理分享出去的结果链接（`/r/<编码>`），把推荐结论写进预览标题，以及返回 404。部署到别的域名时构建前设置 `SITE_URL`。放在普通静态托管上也能用，只是结果链接没有专属预览标题。

## 许可

MIT
