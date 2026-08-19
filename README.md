# 搭账

> 一起搭账，分账容易。

微信小程序 · 多人共享记账 / AA 分账工具。聚会、旅行时开一个账本，把朋友拉进来一起记，谁垫付了什么一目了然，最后自动算出最省事的转账方案——账单透明，分账容易。

## 功能特性

- **共享账本**：创建账本 → 分享到微信群 → 群友点卡片即可加入
- **虚拟成员与认领**：可以先帮没进小程序的朋友记账，TA 进来后一键认领自己的身份和历史账目
- **微信身份**：头像昵称一次设置全账本通用（基于微信官方头像昵称填写能力，合规）
- **灵活分摊**：均摊（余数逐分分配，合计严格守恒）；云端支持自定义分摊
- **最简转账方案**：净额结算 + 贪心配对，转账笔数 ≤ 成员数-1
- **账目管理**：左滑修改/删除、点击查看每人分摊明细的底部浮层
- **内容安全**：所有用户输入接入微信 msgSecCheck 检测
- **体验细节**：iOS 风格设计语言、按下即时反馈、SWR 本地缓存秒开、云函数定时保温防冷启动、关键操作触觉反馈、prefers-reduced-motion 适配

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | uni-app（Vue 3 选项式 API），无 UI 框架，手写 iOS 风格设计系统 |
| 后端 | uniCloud（支付宝云/阿里云均可）云对象 |
| 登录 | uni-id（微信静默登录，无感） |
| 数据库 | uniCloud 云数据库（MongoDB 语法） |

## 架构要点

- **安全模型**：所有表的 schema 权限全部关闭，客户端不可直连数据库；全部读写经由 `ledger-service` 云对象，鉴权（uni-id token 校验与自动续期）和业务权限（是否成员、谁能删改）在 `_before` 与各方法中集中校验
- **金额一律用整数「分」**存储与运算，杜绝浮点误差；均摊余数从前往后每人 +1 分，合计严格等于总额（见 `settle.js`，附带 2500 组随机压测：`node scripts/settle.test.js`）
- **成员内嵌**在账本文档的 `members` 数组中（含 `uid=null` 的虚拟成员），省去联表查询；账目的 `participants` 存记账时已算好的每人金额，结算只做求和
- **头像存 fileID**（`cloud://`），展示时经 `getTempFileURL` 批量转换成临时地址（支付宝云的 fileID 无法直接渲染）
- **性能**：客户端 stale-while-revalidate 缓存（先出上次数据再静默刷新）；云对象配定时触发器每 5 分钟保温，规避按量实例冷启动

## 目录结构

```
├── pages/
│   ├── index/index.vue        # 首页：账本列表（左滑删除）+ 大标题头部
│   ├── ledger/create.vue      # 新建账本 / 管理账本（编辑、删除）
│   ├── ledger/detail.vue      # 账本详情：明细（左滑操作/详情浮层）、结算、邀请加入
│   ├── expense/add.vue        # 记一笔 / 修改账目
│   └── profile/me.vue         # 微信头像昵称设置
├── utils/
│   ├── cloud.js               # 登录、云对象调用、缓存、格式化工具
│   └── swipe.js               # 列表左滑手势 mixin（跟手/速度决策/橡皮筋）
├── uniCloud-alipay/
│   ├── cloudfunctions/ledger-service/
│   │   ├── index.obj.js       # 核心云对象：账本/成员/账目/结算/资料
│   │   ├── settle.js          # 均摊与最简转账算法（纯函数，可单测）
│   │   └── wx-sec.js          # 微信内容安全（access_token 缓存 + msgSecCheck）
│   └── database/              # 表 schema 与索引定义
└── scripts/settle.test.js     # 结算算法自测
```

## 快速开始

前置条件：[HBuilderX](https://www.dcloud.io/hbuilderx.html)、微信小程序账号（个人主体即可）、uniCloud 服务空间（支付宝云/阿里云免费空间均可）。

1. **克隆并导入**：HBuilderX → 文件 → 导入项目
2. **关联云空间**：右键 `uniCloud-alipay` → 关联云服务空间（阿里云空间需把目录改名为 `uniCloud-aliyun`）
3. **填 appid**：`manifest.json` → 微信小程序配置 → 填入你自己的 appid
4. **配置 uni-id**：复制 `uni_modules/uni-config-center/uniCloud/cloudfunctions/common/uni-config-center/uni-id/config.example.json` 为同目录 `config.json`，填入微信 appid、AppSecret 和随机生成的 tokenSecret（此文件已在 .gitignore 中，不会被提交）
5. **导入 uni-id-pages**：本仓库已含；若缺失则从插件市场导入（只用它的 `uni-id-co` 云对象做登录，页面未注册）
6. **初始化数据库**：右键 `uniCloud-alipay/database` → 上传所有 Schema；右键 `db_init.json` → 初始化云数据库（建索引）
7. **上传云端**：依次上传公共模块 `uni-config-center`、`uni-id-common`，云对象 `uni-id-co`、`ledger-service`（会连同定时保温触发器一起注册）
8. **运行**：运行 → 运行到小程序模拟器 → 微信开发者工具（工具内记得开启「不校验合法域名」）

### 真机与发布前

- 微信公众平台 → 开发管理 → 开发设置 → 服务器域名：
  - **request 合法域名**：你的云空间 API 域名（开发者工具 Network 面板可见，形如 `https://env-xxx.api-hz.cloudbasefunction.cn`）
  - **uploadFile / downloadFile 合法域名**：云存储域名（形如 `https://env-xxx.normal.cloudstatic.cn`）
- **IP 白名单保持关闭**（开发管理 → 开发设置）：云函数出口 IP 不固定，开了会导致内容安全接口取不到 access_token
- 提审时按流程完善《用户隐私保护指引》，声明「头像」「昵称」（用途：用于在共享账本中向其他成员展示你的身份）

## 常见问题

| 现象 | 原因与解法 |
|---|---|
| 登录报「获取第三方账号失败」 | `config.json` 里 appid/AppSecret 未填或填错；**改完必须重新上传 `uni-id-co`**（配置打包在云函数里） |
| 真机报 `request fail` | 微信后台 request 合法域名未配置，见上节 |
| 头像不显示 | 支付宝云 fileID 是 `cloud://` 协议，需 `getTempFileURL` 转换——本项目已内置处理，若自行改造请保留 `toDisplayURLs` 逻辑 |
| 第一次请求特别慢 | 按量实例冷启动；本项目已配定时保温触发器，上传 `ledger-service` 后在 uniCloud 控制台确认触发器生效 |
| 违规词没有被拦截 | 查看云函数日志：多半是 access_token 获取失败（IP 白名单未关闭或 AppSecret 错误） |

## 测试

```bash
node scripts/settle.test.js
```

覆盖均摊余数分配、净额守恒、转账后全员清零、笔数上限等 13 项断言（含 2500 组随机压测）。

## 许可

本项目以 [AGPL-3.0](./LICENSE) 协议开源：可自由学习、修改、自部署；基于本项目对外提供服务（含小程序上架）的衍生作品须以相同协议开源。**「搭账」名称与 logo 等品牌资产不在开源授权范围内**——欢迎改造自用，但请换上你自己的名字和图标。
