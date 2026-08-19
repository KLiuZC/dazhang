<script>
	export default {
		onLaunch: function() {
			// 临时验证：云端当日汇率拉取（看到控制台输出后即可删除这四行）
			uniCloud.importObject('ledger-service', { customUI: true }).getFxRates()
				.then(res => console.log('【汇率验证】成功：', res))
				.catch(err => console.error('【汇率验证】失败：', err))
		},
		onShow: function() {},
		onHide: function() {}
	}
</script>

<style>
	/* ============================================================
	   搭账 · 全局设计系统（Apple HIG 语言，iOS 尺度 1pt ≈ 2rpx）
	   ============================================================ */

	page {
		/* iOS 系统色板（Light） */
		--bg: #F2F2F7;                          /* systemGroupedBackground */
		--card: #FFFFFF;                        /* secondarySystemGroupedBackground */
		--label: #000000;
		--secondary: rgba(60, 60, 67, 0.6);     /* secondaryLabel */
		--tertiary: rgba(60, 60, 67, 0.3);      /* tertiaryLabel */
		--separator: rgba(60, 60, 67, 0.29);
		--fill: rgba(120, 120, 128, 0.12);      /* systemFill */
		--fill-press: rgba(120, 120, 128, 0.2); /* 行按压高亮 */
		--green: #34C759;
		--green-tint: rgba(52, 199, 89, 0.15);
		--red: #FF3B30;

		background: var(--bg);
		color: var(--label);
		font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
		font-size: 34rpx;      /* body 17pt */
		line-height: 1.47;     /* body 17/25 */
	}

	.page {
		padding: 24rpx 32rpx 240rpx;
	}

	/* ---------- 排版：字距随字号变化，大字紧、小字松 ---------- */

	.title-lg {
		font-size: 68rpx;          /* Large Title 34pt */
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.015em;  /* 大字负字距 */
	}

	.title-1 {
		font-size: 56rpx;          /* Title1 28pt */
		font-weight: 700;
		line-height: 1.25;
		letter-spacing: -0.01em;
	}

	.headline {
		font-size: 34rpx;          /* Headline 17pt semibold */
		font-weight: 600;
		letter-spacing: 0;
	}

	.footnote {
		font-size: 26rpx;          /* Footnote 13pt */
		color: var(--secondary);
		line-height: 1.38;
		letter-spacing: 0;
	}

	.caption {
		font-size: 24rpx;          /* Caption 12pt */
		color: var(--tertiary);
		line-height: 1.35;
	}

	.num {
		font-feature-settings: 'tnum'; /* 等宽数字，金额纵向对齐 */
		font-variant-numeric: tabular-nums;
	}

	.pos { color: var(--green); font-weight: 600; }
	.neg { color: var(--red); font-weight: 600; }

	/* ---------- Inset Grouped 分组列表 ---------- */

	.group {
		background: var(--card);
		border-radius: 20rpx;      /* 10pt */
		margin-bottom: 32rpx;
		overflow: hidden;
	}

	.sec-h {
		padding: 0 32rpx;
		margin: 8rpx 0 14rpx;
		font-size: 26rpx;
		color: var(--secondary);
	}

	.sec-f {
		padding: 0 32rpx;
		margin: -16rpx 0 32rpx;
		font-size: 26rpx;
		color: var(--secondary);
	}

	.cell {
		display: flex;
		align-items: center;
		min-height: 96rpx;         /* 行高 ≥44pt */
		padding: 20rpx 32rpx;
		position: relative;
		background: transparent;
		transition: background-color 240ms ease-out; /* 松手后高亮淡出 */
	}

	/* 发丝分隔线，从内容处起笔 */
	.cell-sep::before {
		content: '';
		position: absolute;
		top: 0;
		left: 32rpx;
		right: 0;
		height: 1rpx;
		background: var(--separator);
	}

	/* 按下瞬时高亮（hover-start-time=0），零延迟进、240ms 退 */
	.cell-press {
		background-color: var(--fill-press);
		transition-duration: 0ms;
	}

	.cell-main {
		flex: 1;
		min-width: 0;
	}

	.cell-title {
		font-size: 34rpx;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cell-value {
		font-size: 34rpx;
		margin-left: 20rpx;
	}

	.cell-value.dim {
		color: var(--secondary);
	}

	.chevron {
		color: var(--tertiary);
		font-size: 40rpx;
		font-weight: 500;
		margin-left: 12rpx;
		line-height: 1;
	}

	/* ---------- 按钮：胶囊主按钮 + 淡色胶囊 ---------- */

	button {
		background: transparent;
		padding: 0;
		margin: 0;
		border: none;
		border-radius: 0;
		font-size: inherit;
		line-height: inherit;
		color: inherit;
		text-align: inherit;
	}

	button::after {
		border: none;
	}

	.btn-capsule {
		background: var(--green);
		color: #FFFFFF;
		font-size: 34rpx;
		font-weight: 600;
		text-align: center;
		height: 100rpx;            /* 50pt */
		line-height: 100rpx;
		border-radius: 100rpx;
		/* 松手回弹带一点动量感（按压本身有速度） */
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1), opacity 200ms ease-out;
	}

	.btn-capsule[disabled] {
		background: var(--green);
		color: rgba(255, 255, 255, 0.9);
		opacity: 0.4;
	}

	.chip {
		display: inline-block;
		font-size: 28rpx;
		font-weight: 600;
		padding: 10rpx 30rpx;
		border-radius: 100rpx;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	.chip-tinted {
		background: var(--green-tint);
		color: var(--green);
	}

	/* 按下即缩，100ms 进、260ms 弹性退 */
	.press-scale {
		transform: scale(0.96);
		transition-duration: 100ms;
		transition-timing-function: ease-out;
	}

	/* ---------- 半透明材质底栏：内容从下面滚过 ---------- */

	.footer-bar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
		background: rgba(242, 242, 247, 0.8);
		-webkit-backdrop-filter: blur(40rpx) saturate(180%);
		backdrop-filter: blur(40rpx) saturate(180%);
		border-top: 1rpx solid var(--separator);
	}

	/* ---------- 空状态 ---------- */

	.empty {
		padding: 180rpx 60rpx;
		text-align: center;
	}

	.empty-icon {
		font-size: 104rpx;
		margin-bottom: 28rpx;
	}

	.empty-text {
		font-size: 34rpx;
		font-weight: 600;
	}

	.empty-sub {
		font-size: 26rpx;
		color: var(--secondary);
		margin-top: 10rpx;
	}

	.hint {
		font-size: 24rpx;
		color: var(--tertiary);
		text-align: center;
		padding: 20rpx 0;
	}

	/* 输入占位符 */
	.ph {
		color: var(--tertiary);
	}

	/* ---------- 列表行左滑操作（首页/明细共用） ---------- */

	.swipe-item {
		position: relative;
		margin-bottom: 20rpx;
	}

	.swipe-actions {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		display: flex;
		align-items: center;
	}

	/* 圆形图标操作钮：浮在页面底色上，卡片滑开后露出 */
	.swipe-btn {
		width: 88rpx;
		height: 88rpx;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-left: 24rpx;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	.swipe-edit {
		background: #007AFF;
	}

	.swipe-del {
		background: var(--red);
	}

	/* 前景卡片自身带圆角，滑开后依然是完整圆角卡片 */
	.swipe-front {
		position: relative;
		z-index: 1;
		background: #FFFFFF;
		border-radius: 20rpx;
		overflow: hidden;
	}

	/* ---------- 成员小头像（无头像时显示昵称首字） ---------- */

	.mini-avatar {
		width: 60rpx;
		height: 60rpx;
		border-radius: 50%;
		margin-right: 20rpx;
		flex-shrink: 0;
		display: block;
	}

	.mini-avatar-ph {
		background: var(--fill);
		color: var(--secondary);
		font-size: 28rpx;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* ---------- Reduced Motion：位移动效降级为直达 ---------- */

	@media (prefers-reduced-motion: reduce) {
		.btn-capsule,
		.chip,
		.press-scale {
			transition: opacity 200ms ease !important;
			transform: none !important;
		}

		.swipe-front {
			transition: none !important;
		}
	}
</style>
