<template>
	<view class="page">
		<!-- 加载中 -->
		<view v-if="isMember === null" class="empty">
			<view class="empty-sub">加载中…</view>
		</view>

		<!-- 非成员：从分享进来，先认领身份或加入 -->
		<view v-else-if="isMember === false">
			<view class="join-hero">
				<view class="join-icon">{{ ledger.icon }}</view>
				<view class="title-1">{{ ledger.title }}</view>
				<view class="footnote join-sub">邀请你一起记账，账单透明，分账容易</view>
			</view>

			<template v-if="unclaimedMembers.length">
				<view class="sec-h">账本里已经有你了？认领你的身份</view>
				<view class="group">
					<view
						v-for="(m, i) in unclaimedMembers"
						:key="m.id"
						class="cell"
						:class="{ 'cell-sep': i > 0 }"
					>
						<view class="cell-main">
							<view class="cell-title">{{ m.nickname }}</view>
						</view>
						<button
							class="chip chip-tinted"
							hover-class="press-scale"
							hover-start-time="0"
							@click="claim(m)"
						>我是TA</button>
					</view>
				</view>
			</template>

			<view class="sec-h">{{ unclaimedMembers.length ? '都不是？以新成员加入' : '以新成员加入' }}</view>
			<template v-if="profile.nickname">
				<view class="group">
					<view class="cell">
						<image v-if="profile.avatar" class="mini-avatar" :src="profile.avatar" mode="aspectFill" />
						<view v-else class="mini-avatar mini-avatar-ph">{{ profile.nickname.slice(0, 1) }}</view>
						<view class="cell-main">
							<view class="cell-title">{{ profile.nickname }}</view>
							<view class="footnote">微信身份</view>
						</view>
					</view>
				</view>
				<button
					class="btn-capsule"
					hover-class="press-scale"
					hover-start-time="0"
					@click="join"
				>以这个身份加入</button>
			</template>
			<template v-else>
				<view class="group">
					<view class="cell">
						<input
							class="cell-input"
							v-model="joinNickname"
							placeholder="你的昵称"
							placeholder-class="ph"
							maxlength="30"
						/>
					</view>
				</view>
				<button
					class="btn-capsule"
					hover-class="press-scale"
					hover-start-time="0"
					@click="join"
				>加入账本</button>
			</template>
		</view>

		<!-- 成员视图 -->
		<template v-else>
			<view class="hero">
				<view class="footnote">{{ ledger.icon }} {{ ledger.title }}</view>
				<view class="hero-amount num">¥{{ fen2yuan(ledger.total_amount) }}</view>
				<view class="footnote">{{ ledger.members.length }}位成员 · {{ ledger.expense_count }}笔支出</view>
				<view class="hero-chips">
					<button
						class="chip chip-tinted"
						open-type="share"
						hover-class="press-scale"
						hover-start-time="0"
					>邀请群友</button>
					<button
						v-if="isCreator"
						class="chip chip-plain"
						hover-class="press-scale"
						hover-start-time="0"
						@click="goManage"
					>管理</button>
				</view>
			</view>

			<!-- 分段控件：白色滑块在两段间滑动 -->
			<view class="segmented">
				<view class="seg-thumb" :class="{ right: tab === 'settle' }"></view>
				<view
					class="seg-item"
					:class="{ active: tab === 'expenses' }"
					@click="tab = 'expenses'"
				>明细</view>
				<view
					class="seg-item"
					:class="{ active: tab === 'settle' }"
					@click="tab = 'settle'"
				>结算</view>
			</view>

			<view v-if="tab === 'expenses'" :key="'expenses'" class="tab-pane">
				<view v-if="!expenses.length" class="empty">
					<view class="empty-icon">✏️</view>
					<view class="empty-text">还没有账目</view>
					<view class="empty-sub">记第一笔吧</view>
				</view>
				<view v-else>
					<view v-for="e in expenses" :key="e._id" class="swipe-item">
						<view class="swipe-actions">
							<view class="swipe-btn swipe-edit" @click="editExpense(e)">修改</view>
							<view class="swipe-btn swipe-del" @click="removeExpense(e)">删除</view>
						</view>
						<view
							class="swipe-front"
							:style="swipeFrontStyle(e._id)"
							@touchstart="swipeStart($event, e._id)"
							@touchmove="swipeMove($event, e._id, e.can_delete)"
							@touchend="swipeEnd($event, e._id)"
							@click="onRowTap(e)"
						>
							<view class="cell">
								<view class="cell-main">
									<view class="cell-title">{{ e.title }}</view>
									<view class="footnote">{{ memberName(e.payer_member_id) }} 垫付 · {{ e.participants.length }}人分 · {{ fmtDate(e.expense_date) }}</view>
								</view>
								<view class="cell-value num exp-amount">¥{{ fen2yuan(e.amount) }}</view>
							</view>
						</view>
					</view>
					<view class="hint">左滑账目可修改或删除</view>
				</view>
			</view>

			<view v-else :key="'settle'" class="tab-pane">
				<view class="sec-h">每人净额</view>
				<view class="group">
					<view
						v-for="(b, i) in balanceRows"
						:key="b.member_id"
						class="cell"
						:class="{ 'cell-sep': i > 0 }"
					>
						<image v-if="b.avatar" class="mini-avatar" :src="b.avatar" mode="aspectFill" />
						<view v-else class="mini-avatar mini-avatar-ph">{{ b.nickname.slice(0, 1) }}</view>
						<view class="cell-main">
							<view class="cell-title">
								{{ b.nickname }}<text v-if="b.member_id === myMemberId" class="me-tag">我</text>
							</view>
						</view>
						<view class="cell-value num" :class="b.amount >= 0 ? 'pos' : 'neg'">
							{{ b.amount >= 0 ? '应收' : '应付' }} ¥{{ fen2yuan(Math.abs(b.amount)) }}
						</view>
					</view>
				</view>

				<view class="sec-h">最省事的转账方案</view>
				<view class="group">
					<view v-if="!transfers.length" class="cell">
						<view class="cell-main">
							<view class="cell-title">已结清，无需转账 🎉</view>
						</view>
					</view>
					<view
						v-for="(t, i) in transfers"
						:key="i"
						class="cell"
						:class="{ 'cell-sep': i > 0 }"
					>
						<view class="cell-main">
							<view class="cell-title">{{ memberName(t.from) }} <text class="arrow">→</text> {{ memberName(t.to) }}</view>
						</view>
						<view class="cell-value num neg">¥{{ fen2yuan(t.amount) }}</view>
					</view>
				</view>
			</view>

			<view class="footer-bar">
				<button
					class="btn-capsule"
					hover-class="press-scale"
					hover-start-time="0"
					@click="goAdd"
				>记一笔</button>
			</view>

			<!-- 账目详情浮层：底部 sheet + 遮罩，点遮罩关闭 -->
			<view v-if="sheetExpense" class="sheet-mask" :class="{ open: sheetOpen }" @click="closeSheet">
				<view class="sheet" :class="{ open: sheetOpen }" @click.stop>
					<view class="sheet-grabber"></view>
					<view class="sheet-title">{{ sheetExpense.title }}</view>
					<view class="sheet-amount num">¥{{ fen2yuan(sheetExpense.amount) }}</view>
					<view class="footnote sheet-sub">
						{{ memberName(sheetExpense.payer_member_id) }} 垫付 · {{ sheetExpense.split_type === 'custom' ? '自定义分摊' : '均摊' }} · {{ fmtDate(sheetExpense.expense_date) }}
					</view>
					<view class="sheet-list">
						<view v-for="p in sheetExpense.participants" :key="p.member_id" class="sheet-row">
							<view>{{ memberName(p.member_id) }}</view>
							<view class="num sheet-share">¥{{ fen2yuan(p.amount) }}</view>
						</view>
					</view>
					<view v-if="sheetExpense.can_delete" class="sheet-btns">
						<button class="sheet-btn sheet-btn-edit" hover-class="press-scale" hover-start-time="0" @click="editExpense(sheetExpense)">修改</button>
						<button class="sheet-btn sheet-btn-del" hover-class="press-scale" hover-start-time="0" @click="removeExpense(sheetExpense)">删除</button>
					</view>
				</view>
			</view>
		</template>
	</view>
</template>

<script>
	import { callLedger, showError, toast, fen2yuan, fmtDate, getMyNickname, saveMyNickname, safeImg, readCache, writeCache } from '@/utils/cloud.js'
	import { createSwipeMixin } from '@/utils/swipe.js'

	export default {
		mixins: [createSwipeMixin(264)],
		data() {
			return {
				ledgerId: '',
				isMember: null,
				myMemberId: '',
				ledger: { title: '', icon: '', members: [], expense_count: 0, total_amount: 0 },
				expenses: [],
				balances: [],
				transfers: [],
				tab: 'expenses',
				joinNickname: '',
				profile: { nickname: '', avatar: '' },
				isCreator: false,
				// 账目详情浮层
				sheetExpense: null,
				sheetOpen: false
			}
		},
		computed: {
			memberMap() {
				const map = {}
				for (const m of this.ledger.members) map[m.id] = m
				return map
			},
			unclaimedMembers() {
				return this.ledger.members.filter(m => !m.claimed)
			},
			balanceRows() {
				return this.balances
					.map(b => {
						const m = this.memberMap[b.member_id] || {}
						return { ...b, nickname: m.nickname || '?', avatar: m.avatar || '' }
					})
					.sort((a, b) => b.amount - a.amount)
			}
		},
		onLoad(options) {
			this.ledgerId = (options && options.id) || ''
			this.joinNickname = getMyNickname()
			if (!this.ledgerId) {
				toast('缺少账本ID')
				setTimeout(() => uni.navigateBack(), 800)
			}
		},
		onShow() {
			if (this.ledgerId) this.load()
		},
		onShareAppMessage() {
			return {
				title: `${this.ledger.title}｜一起搭账，分账容易`,
				path: `/pages/ledger/detail?id=${this.ledgerId}`
			}
		},
		methods: {
			fen2yuan,
			fmtDate,
			memberName(id) {
				const m = this.memberMap[id]
				return (m && m.nickname) || '?'
			},
			async load() {
				// 首次进入先出缓存（秒开）；之后的刷新保持当前画面，静默更新
				if (this.isMember === null) {
					const cached = readCache('ledger_' + this.ledgerId)
					if (cached) {
						this.isMember = true
						this.isCreator = cached.isCreator
						this.myMemberId = cached.myMemberId
						this.ledger = cached.ledger
						this.expenses = cached.expenses || []
						this.balances = cached.balances || []
						this.transfers = cached.transfers || []
						if (cached.ledger && cached.ledger.title) {
							uni.setNavigationBarTitle({ title: cached.ledger.title })
						}
					}
				}
				try {
					const res = await callLedger('getLedger', { ledgerId: this.ledgerId })
					this.isMember = res.isMember
					this.isCreator = !!res.isCreator
					this.ledger = res.ledger
					this.ledger.members = (res.ledger.members || []).map(m => ({ ...m, avatar: safeImg(m.avatar) }))
					if (res.isMember) {
						this.myMemberId = res.myMemberId
						this.expenses = res.expenses || []
						this.balances = res.balances || []
						this.transfers = res.transfers || []
						writeCache('ledger_' + this.ledgerId, {
							isCreator: this.isCreator,
							myMemberId: this.myMemberId,
							ledger: this.ledger,
							expenses: this.expenses,
							balances: this.balances,
							transfers: this.transfers
						})
					} else {
						const p = await callLedger('getMyProfile')
						this.profile = (p && p.profile) || { nickname: '', avatar: '' }
						this.profile.avatar = safeImg(this.profile.avatar)
					}
					uni.setNavigationBarTitle({ title: res.ledger.title })
				} catch (e) {
					showError(e)
				}
			},
			async claim(member) {
				try {
					await callLedger('claimMember', { ledgerId: this.ledgerId, memberId: member.id })
					uni.vibrateShort({ type: 'light' })
					toast('认领成功')
					this.load()
				} catch (e) {
					showError(e)
				}
			},
			async join() {
				let nickname
				if (!this.profile.nickname) {
					nickname = this.joinNickname.trim()
					if (!nickname) return toast('填一下你的昵称')
				}
				try {
					await callLedger('joinLedger', { ledgerId: this.ledgerId, nickname })
					if (nickname) saveMyNickname(nickname)
					uni.vibrateShort({ type: 'light' })
					this.load()
				} catch (e) {
					showError(e)
				}
			},
			goAdd() {
				uni.navigateTo({ url: `/pages/expense/add?id=${this.ledgerId}` })
			},
			onRowTap(item) {
				if (this.swipeTapGuard()) return
				this.openSheet(item)
			},
			goManage() {
				uni.navigateTo({ url: `/pages/ledger/create?id=${this.ledgerId}` })
			},
			/* ---------- 账目详情浮层 ---------- */
			openSheet(item) {
				this.sheetExpense = item
				setTimeout(() => {
					this.sheetOpen = true
				}, 30)
			},
			closeSheet() {
				this.sheetOpen = false
				setTimeout(() => {
					this.sheetExpense = null
				}, 320)
			},
			editExpense(item) {
				this.sheetOpen = false
				this.sheetExpense = null
				this.openId = ''
				uni.navigateTo({ url: `/pages/expense/add?id=${this.ledgerId}&expenseId=${item._id}` })
			},
			removeExpense(expense) {
				if (!expense.can_delete) {
					return toast('只有记账人或账本创建者可以删除')
				}
				this.sheetOpen = false
				this.sheetExpense = null
				this.openId = ''
				uni.showModal({
					title: '删除这笔账目？',
					content: `${expense.title} ¥${fen2yuan(expense.amount)}`,
					confirmColor: '#FF3B30',
					success: async res => {
						if (!res.confirm) return
						try {
							await callLedger('deleteExpense', { expenseId: expense._id })
							uni.vibrateShort({ type: 'light' })
							toast('已删除')
							this.load()
						} catch (e) {
							showError(e)
						}
					}
				})
			}
		}
	}
</script>

<style>
	/* ---------- 头部：大数字居中，负字距 ---------- */
	.hero {
		text-align: center;
		padding: 36rpx 0 44rpx;
	}

	.hero-amount {
		font-size: 88rpx;
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.02em;
		margin: 8rpx 0 4rpx;
	}

	.hero-chips {
		margin-top: 24rpx;
		display: flex;
		justify-content: center;
	}

	.chip-plain {
		background: var(--fill);
		color: var(--secondary);
		margin-left: 16rpx;
	}

	/* ---------- iOS 分段控件：滑块位移，Apple 曲线 ---------- */
	.segmented {
		position: relative;
		display: flex;
		background: var(--fill);
		border-radius: 18rpx;
		padding: 4rpx;
		margin-bottom: 28rpx;
	}

	.seg-thumb {
		position: absolute;
		top: 4rpx;
		bottom: 4rpx;
		left: 4rpx;
		width: calc(50% - 4rpx);
		background: #FFFFFF;
		border-radius: 14rpx;
		box-shadow: 0 6rpx 16rpx rgba(0, 0, 0, 0.08), 0 1rpx 2rpx rgba(0, 0, 0, 0.06);
		transition: transform 300ms cubic-bezier(0.32, 0.72, 0, 1);
	}

	.seg-thumb.right {
		transform: translateX(100%);
	}

	.seg-item {
		position: relative;
		flex: 1;
		text-align: center;
		font-size: 28rpx;
		color: var(--label);
		padding: 12rpx 0;
		transition: font-weight 100ms;
	}

	.seg-item.active {
		font-weight: 600;
	}

	/* 面板切换：轻微上浮淡入 */
	.tab-pane {
		animation: pane-in 260ms cubic-bezier(0.25, 0.1, 0.25, 1);
	}

	@keyframes pane-in {
		from {
			opacity: 0;
			transform: translateY(10rpx);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.seg-thumb {
			transition: none;
		}
		.tab-pane {
			animation: none;
		}
	}

	.exp-amount {
		font-weight: 600;
	}

	/* ---------- 账目详情浮层 ---------- */
	.sheet-mask {
		position: fixed;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		z-index: 100;
		background: rgba(0, 0, 0, 0);
		transition: background 280ms ease;
	}

	.sheet-mask.open {
		background: rgba(0, 0, 0, 0.4);
	}

	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background: #FFFFFF;
		border-radius: 28rpx 28rpx 0 0;
		padding: 12rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
		transform: translateY(100%);
		transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
	}

	.sheet.open {
		transform: translateY(0);
	}

	.sheet-grabber {
		width: 72rpx;
		height: 10rpx;
		border-radius: 5rpx;
		background: rgba(60, 60, 67, 0.18);
		margin: 8rpx auto 28rpx;
	}

	.sheet-title {
		font-size: 30rpx;
		color: var(--secondary);
		text-align: center;
	}

	.sheet-amount {
		font-size: 76rpx;
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.02em;
		text-align: center;
		margin: 8rpx 0 4rpx;
	}

	.sheet-sub {
		text-align: center;
		margin-bottom: 28rpx;
	}

	.sheet-list {
		background: var(--bg);
		border-radius: 20rpx;
		padding: 6rpx 28rpx;
		margin-bottom: 28rpx;
		max-height: 480rpx;
		overflow-y: auto;
	}

	.sheet-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20rpx 0;
		font-size: 30rpx;
	}

	.sheet-row + .sheet-row {
		border-top: 1rpx solid var(--separator);
	}

	.sheet-share {
		font-weight: 600;
	}

	.sheet-btns {
		display: flex;
	}

	.sheet-btn {
		flex: 1;
		height: 92rpx;
		line-height: 92rpx;
		border-radius: 24rpx;
		font-size: 32rpx;
		font-weight: 600;
		text-align: center;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	.sheet-btn-edit {
		background: var(--fill);
		color: var(--label);
		margin-right: 20rpx;
	}

	.sheet-btn-del {
		background: rgba(255, 59, 48, 0.12);
		color: var(--red);
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet,
		.sheet-mask {
			transition: opacity 200ms ease !important;
		}
	}

	.me-tag {
		font-size: 22rpx;
		color: var(--green);
		background: var(--green-tint);
		border-radius: 8rpx;
		padding: 2rpx 10rpx;
		margin-left: 12rpx;
		vertical-align: 4rpx;
	}

	.arrow {
		color: var(--tertiary);
	}

	/* ---------- 加入视图 ---------- */
	.join-hero {
		text-align: center;
		padding: 72rpx 32rpx 48rpx;
	}

	.join-icon {
		font-size: 112rpx;
		margin-bottom: 20rpx;
	}

	.join-sub {
		margin-top: 10rpx;
	}

	.cell-input {
		flex: 1;
		font-size: 34rpx;
		height: 56rpx;
	}
</style>
