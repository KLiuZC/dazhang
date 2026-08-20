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
				<view v-if="ledger.status === 1" class="settled-badge">已结清 🎉</view>
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
							<view
								class="swipe-btn swipe-edit"
								hover-class="press-scale"
								hover-start-time="0"
								@click="editExpense(e)"
							>
								<uni-icons type="compose" size="22" color="#FFFFFF" />
							</view>
							<view
								class="swipe-btn swipe-del"
								hover-class="press-scale"
								hover-start-time="0"
								@click="removeExpense(e)"
							>
								<uni-icons type="trash" size="22" color="#FFFFFF" />
							</view>
						</view>
						<view
							class="swipe-front"
							:style="swipeFrontStyle(e._id)"
							@touchstart="swipeStart($event, e._id)"
							@touchmove="swipeMove($event, e._id, e.can_delete && ledger.status !== 1)"
							@touchend="swipeEnd($event, e._id)"
							@click="onRowTap(e)"
						>
							<view class="cell">
								<view class="cell-main">
									<view class="cell-title">{{ e.kind === 'repayment' ? '已转账 ✓' : e.title }}</view>
									<view class="footnote">
										<template v-if="e.kind === 'repayment'">{{ memberName(e.payer_member_id) }} 转给 {{ memberName(e.participants[0] && e.participants[0].member_id) }} · {{ fmtDate(e.expense_date) }}</template>
										<template v-else>{{ memberName(e.payer_member_id) }} 垫付 · {{ e.participants.length }}人分 · {{ fmtDate(e.expense_date) }}</template>
									</view>
								</view>
								<view class="val-col">
									<view class="cell-value num exp-amount" :class="{ pos: e.kind === 'repayment' }">¥{{ fen2yuan(e.amount_cny) }}</view>
									<view v-if="e.currency && e.currency !== 'CNY'" class="caption num">{{ curSymbol(e.currency) }}{{ fen2yuan(e.amount) }}</view>
								</view>
							</view>
						</view>
					</view>
					<view class="hint">{{ ledger.status === 1 ? '已结清账本不可改动，可在「管理」中重新打开' : '左滑账目可修改或删除' }}</view>
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
						<view
							v-if="canMark(t)"
							class="mark-btn"
							hover-class="press-scale"
							hover-start-time="0"
							@click="markPaid(t)"
						>
							<uni-icons type="checkmarkempty" size="18" color="#34C759" />
						</view>
					</view>
				</view>
				<view v-if="transfers.length" class="hint">转完账点右侧 ✓ 标记，全部转清即可结清账本</view>
				<view v-if="hasDust" class="hint">几分钱的凑整尾差已自动抹平，不用转账</view>

				<button
					v-if="canSettle"
					class="btn-settle"
					hover-class="press-scale"
					hover-start-time="0"
					@click="doSettleLedger"
				>标记账本已结清 🎉</button>

				<button
					class="btn-share-img"
					hover-class="press-scale"
					hover-start-time="0"
					@click="makeShareImage"
				>把结算结果发到群里</button>
			</view>

			<view v-if="ledger.status !== 1" class="footer-bar">
				<button
					class="btn-capsule"
					hover-class="press-scale"
					hover-start-time="0"
					@click="goAdd"
				>记一笔</button>
			</view>

			<!-- 离屏画布：生成结算分享图用 -->
			<canvas id="shareCanvas" type="2d" class="share-canvas"></canvas>

			<!-- 账目详情浮层：底部 sheet + 遮罩，点遮罩关闭 -->
			<view v-if="sheetExpense" class="sheet-mask" :class="{ open: sheetOpen }" @click="closeSheet">
				<view class="sheet" :class="{ open: sheetOpen }" @click.stop>
					<view class="sheet-grabber"></view>
					<view class="sheet-title">{{ sheetExpense.title }}</view>
					<view class="sheet-amount num">¥{{ fen2yuan(sheetExpense.amount_cny) }}</view>
					<view class="footnote sheet-sub">
						{{ memberName(sheetExpense.payer_member_id) }} 垫付 · {{ sheetExpense.split_type === 'custom' ? '自定义分摊' : '均摊' }} · {{ fmtDate(sheetExpense.expense_date) }}
					</view>
					<view v-if="sheetExpense.currency && sheetExpense.currency !== 'CNY'" class="footnote sheet-fx">
						原币 {{ curSymbol(sheetExpense.currency) }}{{ fen2yuan(sheetExpense.amount) }} · 汇率 {{ sheetExpense.rate }}
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
	import { callLedger, showError, toast, fen2yuan, fmtDate, fmtDay, getMyNickname, saveMyNickname, safeImg, readCache, writeCache } from '@/utils/cloud.js'
	import { createSwipeMixin } from '@/utils/swipe.js'
	import { curSymbol } from '@/utils/currency.js'

	export default {
		mixins: [createSwipeMixin(224)],
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
				hasDust: false,
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
			},
			// 可标记结清：创建者 + 进行中 + 有真实消费 + 已无待转款项
			canSettle() {
				return this.isMember === true &&
					this.isCreator &&
					this.ledger.status !== 1 &&
					this.transfers.length === 0 &&
					this.expenses.some(e => (e.kind || 'expense') !== 'repayment')
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
			curSymbol,
			// 兼容旧缓存/旧数据：没有 amount_cny 字段时视为人民币账目
			normalizeExpenses(list) {
				return (list || []).map(e => ({ ...e, amount_cny: e.amount_cny != null ? e.amount_cny : e.amount }))
			},
			memberName(id) {
				const m = this.memberMap[id]
				return (m && m.nickname) || '?'
			},
			// 异步返回时用户可能已离开本页，只有自己还是当前页才设置标题，避免污染别的页面
			setNavTitle(title) {
				const pages = getCurrentPages()
				const current = pages[pages.length - 1]
				if (current && current.route === 'pages/ledger/detail') {
					uni.setNavigationBarTitle({ title })
				}
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
						this.expenses = this.normalizeExpenses(cached.expenses)
						this.balances = cached.balances || []
						this.transfers = cached.transfers || []
						this.hasDust = !!cached.hasDust
						if (cached.ledger && cached.ledger.title) {
							this.setNavTitle(cached.ledger.title)
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
						this.expenses = this.normalizeExpenses(res.expenses)
						this.balances = res.balances || []
						this.transfers = res.transfers || []
						this.hasDust = !!res.hasDust
						writeCache('ledger_' + this.ledgerId, {
							isCreator: this.isCreator,
							myMemberId: this.myMemberId,
							ledger: this.ledger,
							expenses: this.expenses,
							balances: this.balances,
							transfers: this.transfers,
							hasDust: this.hasDust
						})
					} else {
						const p = await callLedger('getMyProfile')
						this.profile = (p && p.profile) || { nickname: '', avatar: '' }
						this.profile.avatar = safeImg(this.profile.avatar)
					}
					this.setNavTitle(res.ledger.title)
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
				if (item.kind === 'repayment') return // 转账记录信息都在行上，无浮层
				this.openSheet(item)
			},
			/* ---------- 转账打钩与结清 ---------- */
			canMark(t) {
				return this.ledger.status !== 1 &&
					(this.isCreator || t.from === this.myMemberId || t.to === this.myMemberId)
			},
			markPaid(t) {
				uni.showModal({
					title: '标记已转账？',
					content: `${this.memberName(t.from)} 转给 ${this.memberName(t.to)} ¥${fen2yuan(t.amount)}，将作为转账记录写入明细`,
					confirmText: '标记',
					success: async res => {
						if (!res.confirm) return
						try {
							await callLedger('addRepayment', {
								ledgerId: this.ledgerId,
								fromMemberId: t.from,
								toMemberId: t.to,
								amount: t.amount
							})
							uni.vibrateShort({ type: 'light' })
							this.load()
						} catch (e) {
							showError(e)
						}
					}
				})
			},
			doSettleLedger() {
				uni.showModal({
					title: '标记账本已结清？',
					content: '结清后账本将归档，不能再记账；创建者可在管理页随时重新打开',
					confirmText: '结清',
					success: async res => {
						if (!res.confirm) return
						try {
							await callLedger('settleLedger', { ledgerId: this.ledgerId })
							uni.vibrateShort({ type: 'light' })
							uni.showToast({ title: '已结清 🎉', icon: 'none' })
							this.load()
						} catch (e) {
							showError(e)
						}
					}
				})
			},
			goManage() {
				uni.navigateTo({ url: `/pages/ledger/create?id=${this.ledgerId}` })
			},
			/* ---------- 结算分享图 ---------- */
			async makeShareImage() {
				uni.showLoading({ title: '生成中…', mask: true })
				try {
					const path = await this.drawShareImage()
					uni.hideLoading()
					// 直接调起微信的图片分享面板；不支持时退回大图预览（长按可转发/保存）
					uni.showShareImageMenu({
						path,
						fail: () => {
							uni.previewImage({ urls: [path] })
						}
					})
				} catch (e) {
					uni.hideLoading()
					showError(e)
				}
			},
			drawShareImage() {
				const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '')
				return new Promise((resolve, reject) => {
					uni.createSelectorQuery()
						.in(this)
						.select('#shareCanvas')
						.fields({ node: true })
						.exec(res => {
							const node = res && res[0] && res[0].node
							if (!node) return reject({ errMsg: '画布初始化失败，请重试' })
							try {
								const W = 750
								const shown = this.transfers.slice(0, 10)
								const moreLine = this.transfers.length > 10 ? 1 : 0
								const rowH = 84
								const listTop = 420
								const H = listTop + (Math.max(shown.length, 1) + moreLine) * rowH + 210
								const info = uni.getWindowInfo ? uni.getWindowInfo() : uni.getSystemInfoSync()
								const dpr = info.pixelRatio || 2
								node.width = W * dpr
								node.height = H * dpr
								const ctx = node.getContext('2d')
								ctx.scale(dpr, dpr)

								// 底色
								ctx.fillStyle = '#FFFFFF'
								ctx.fillRect(0, 0, W, H)
								// 账本名与概况
								ctx.fillStyle = '#000000'
								ctx.font = '600 40px sans-serif'
								ctx.fillText(clip(`${this.ledger.icon} ${this.ledger.title}`, 14), 48, 108)
								ctx.fillStyle = 'rgba(60,60,67,0.6)'
								ctx.font = '26px sans-serif'
								ctx.fillText(`${this.ledger.members.length}位成员 · ${this.ledger.expense_count}笔支出 · ${fmtDay(Date.now())}`, 48, 156)
								// 总支出（大数字紧凑排版）
								ctx.fillStyle = '#000000'
								ctx.font = '700 84px sans-serif'
								ctx.fillText(`¥${fen2yuan(this.ledger.total_amount)}`, 48, 268)
								ctx.fillStyle = 'rgba(60,60,67,0.6)'
								ctx.font = '26px sans-serif'
								ctx.fillText('总支出', 48, 312)
								// 分隔线
								ctx.fillStyle = 'rgba(60,60,67,0.29)'
								ctx.fillRect(48, 348, W - 96, 1)
								// 方案标题
								ctx.fillStyle = 'rgba(60,60,67,0.6)'
								ctx.font = '28px sans-serif'
								ctx.fillText('最省事的转账方案', 48, 400)
								// 方案列表
								let y = listTop + 56
								if (!shown.length) {
									ctx.fillStyle = '#000000'
									ctx.font = '34px sans-serif'
									ctx.fillText('已结清，无需转账 🎉', 48, y)
								} else {
									for (const t of shown) {
										ctx.fillStyle = '#000000'
										ctx.font = '32px sans-serif'
										ctx.fillText(`${clip(this.memberName(t.from), 6)} → ${clip(this.memberName(t.to), 6)}`, 48, y)
										ctx.font = '600 32px sans-serif'
										ctx.textAlign = 'right'
										ctx.fillText(`¥${fen2yuan(t.amount)}`, W - 48, y)
										ctx.textAlign = 'left'
										y += rowH
									}
									if (moreLine) {
										ctx.fillStyle = 'rgba(60,60,67,0.6)'
										ctx.font = '28px sans-serif'
										ctx.fillText(`还有 ${this.transfers.length - 10} 笔，进入小程序查看`, 48, y)
									}
								}
								// 底部品牌
								ctx.fillStyle = 'rgba(60,60,67,0.29)'
								ctx.fillRect(48, H - 150, W - 96, 1)
								ctx.fillStyle = '#34C759'
								ctx.font = '600 32px sans-serif'
								ctx.fillText('搭账', 48, H - 84)
								ctx.fillStyle = 'rgba(60,60,67,0.6)'
								ctx.font = '26px sans-serif'
								ctx.fillText('一起搭账，分账容易', 136, H - 84)

								uni.canvasToTempFilePath({
									canvas: node,
									success: r => resolve(r.tempFilePath),
									fail: err => reject(err)
								}, this)
							} catch (err) {
								reject(err)
							}
						})
				})
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
				if (item.kind === 'repayment') {
					this.openId = ''
					return toast('转账记录不支持修改，可删除后重新标记')
				}
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

	.settled-badge {
		display: inline-block;
		margin-top: 16rpx;
		background: var(--green-tint);
		color: var(--green);
		font-size: 26rpx;
		font-weight: 600;
		padding: 8rpx 28rpx;
		border-radius: 100rpx;
	}

	.mark-btn {
		width: 56rpx;
		height: 56rpx;
		border-radius: 50%;
		background: var(--green-tint);
		display: flex;
		align-items: center;
		justify-content: center;
		margin-left: 20rpx;
		flex-shrink: 0;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
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

	/* 分段控件全局样式在 App.vue；本页仅补列表下方间距 */
	.segmented {
		margin-bottom: 28rpx;
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

	.sheet-fx {
		text-align: center;
		margin-top: -16rpx;
		margin-bottom: 28rpx;
	}

	.val-col {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		margin-left: 20rpx;
	}

	.val-col .cell-value {
		margin-left: 0;
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

	/* 结清：改变账本状态的主行动，实心绿 */
	.btn-settle {
		background: var(--green);
		color: #FFFFFF;
		font-size: 32rpx;
		font-weight: 600;
		text-align: center;
		height: 96rpx;
		line-height: 96rpx;
		border-radius: 100rpx;
		margin: 4rpx 0 16rpx;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	/* 分享结算图：次级动作，同色淡染（与实心结清钮构成主次层级） */
	.btn-share-img {
		background: var(--green-tint);
		color: var(--green);
		font-size: 32rpx;
		font-weight: 600;
		text-align: center;
		height: 96rpx;
		line-height: 96rpx;
		border-radius: 100rpx;
		margin: 4rpx 0 8rpx;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	/* 离屏画布：移出可视区，仅用于绘制导出 */
	.share-canvas {
		position: fixed;
		left: 9999px;
		top: 0;
		width: 750px;
		height: 1600px;
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
