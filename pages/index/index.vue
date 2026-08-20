<template>
	<view class="page">
		<!-- iOS Large Title 头部：大标题在左，头像入口在右，下滚时标题收进导航栏 -->
		<view class="page-head">
			<view class="title-lg">搭账</view>
			<view
				class="head-avatar"
				hover-class="press-scale"
				hover-start-time="0"
				@click="goProfile"
			>
				<image v-if="profile.avatar" class="head-avatar-img" :src="profile.avatar" mode="aspectFill" />
				<view v-else class="head-avatar-img head-avatar-ph">{{ profile.nickname ? profile.nickname.slice(0, 1) : '🙂' }}</view>
			</view>
		</view>

		<view v-if="ledgers.length">
			<view
				v-for="l in sortedLedgers"
				:key="l._id"
				class="swipe-item"
				:class="{ 'settled-item': l.status === 1 }"
			>
				<view class="swipe-actions">
					<view
						class="swipe-btn swipe-del"
						hover-class="press-scale"
						hover-start-time="0"
						@click="removeLedger(l)"
					>
						<uni-icons type="trash" size="22" color="#FFFFFF" />
					</view>
				</view>
				<view
					class="swipe-front"
					:style="swipeFrontStyle(l._id)"
					@touchstart="swipeStart($event, l._id)"
					@touchmove="swipeMove($event, l._id, l.is_creator)"
					@touchend="swipeEnd($event, l._id)"
					@click="onRowTap(l)"
				>
					<view class="cell">
						<view class="row-icon">{{ l.icon }}</view>
						<view class="cell-main">
							<view class="cell-title">{{ l.title }}</view>
							<view class="footnote">{{ l.member_count }}人 · {{ l.expense_count }}笔</view>
						</view>
						<view class="cell-value-col">
							<view class="cell-value num">¥{{ fen2yuan(l.total_amount) }}</view>
							<view class="caption">{{ l.status === 1 ? '已结清 🎉' : fmtDay(l.create_date) }}</view>
						</view>
						<view class="chevron">›</view>
					</view>
				</view>
			</view>
		</view>

		<view v-else-if="!loading" class="empty">
			<view class="empty-icon">🧾</view>
			<view class="empty-text">还没有账本</view>
			<view class="empty-sub">聚会、旅行开一个，账单透明，分账容易</view>
		</view>

		<view class="footer-bar">
			<button
				class="btn-capsule"
				hover-class="press-scale"
				hover-start-time="0"
				@click="goCreate"
			>新建账本</button>
		</view>
	</view>
</template>

<script>
	import { callLedger, showError, toast, fen2yuan, fmtDay, safeImg, readCache, writeCache, removeCache } from '@/utils/cloud.js'
	import { createSwipeMixin } from '@/utils/swipe.js'

	export default {
		mixins: [createSwipeMixin(112)],
		data() {
			return {
				ledgers: [],
				profile: { nickname: '', avatar: '' },
				loading: false,
				navTitled: false
			}
		},
		computed: {
			// 进行中在前，已结清沉底
			sortedLedgers() {
				return [
					...this.ledgers.filter(l => l.status !== 1),
					...this.ledgers.filter(l => l.status === 1)
				]
			}
		},
		onShow() {
			// 复位本页标题：防止从详情页快速返回时，详情的异步标题落到首页头上
			uni.setNavigationBarTitle({ title: this.navTitled ? '搭账' : '' })
			this.load()
		},
		onPullDownRefresh() {
			this.load().finally(() => uni.stopPullDownRefresh())
		},
		// 下滚过大标题后，标题“收进”导航栏（iOS Large Title 收缩行为）
		onPageScroll(e) {
			const showBar = e.scrollTop > 40
			if (showBar !== this.navTitled) {
				this.navTitled = showBar
				uni.setNavigationBarTitle({ title: showBar ? '搭账' : '' })
			}
		},
		methods: {
			fen2yuan,
			fmtDay,
			async load() {
				// 先出上次的缓存（秒开），云端刷新到了再覆盖
				const cached = readCache('home')
				if (cached) {
					this.ledgers = cached.ledgers || []
					this.profile = cached.profile || { nickname: '', avatar: '' }
				}
				this.loading = true
				try {
					const [listRes, profileRes] = await Promise.all([
						callLedger('listMyLedgers'),
						callLedger('getMyProfile')
					])
					this.ledgers = listRes.list || []
					this.profile = (profileRes && profileRes.profile) || { nickname: '', avatar: '' }
					this.profile.avatar = safeImg(this.profile.avatar)
					writeCache('home', { ledgers: this.ledgers, profile: this.profile })
				} catch (e) {
					showError(e)
				}
				this.loading = false
			},
			onRowTap(ledger) {
				if (this.swipeTapGuard()) return
				uni.navigateTo({ url: `/pages/ledger/detail?id=${ledger._id}` })
			},
			removeLedger(ledger) {
				if (!ledger.is_creator) {
					return toast('只有账本创建者可以删除')
				}
				this.openId = ''
				uni.showModal({
					title: '删除这个账本？',
					content: `「${ledger.title}」和里面的所有账目都会被永久删除，无法恢复`,
					confirmText: '删除',
					confirmColor: '#FF3B30',
					success: async res => {
						if (!res.confirm) return
						try {
							await callLedger('deleteLedger', { ledgerId: ledger._id })
							removeCache('ledger_' + ledger._id)
							uni.vibrateShort({ type: 'light' })
							toast('已删除')
							this.load()
						} catch (e) {
							showError(e)
						}
					}
				})
			},
			goProfile() {
				uni.navigateTo({ url: '/pages/profile/me' })
			},
			goCreate() {
				uni.navigateTo({ url: '/pages/ledger/create' })
			}
		}
	}
</script>

<style>
	.page-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12rpx 8rpx 28rpx;
	}

	.head-avatar {
		border-radius: 50%;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	.head-avatar-img {
		width: 76rpx;
		height: 76rpx;
		border-radius: 50%;
		display: block;
		border: 1rpx solid var(--separator);
		box-sizing: border-box;
	}

	.head-avatar-ph {
		background: var(--fill);
		color: var(--secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 34rpx;
		font-weight: 600;
	}

	/* 已结清账本：内容降透明度表示归档；卡片背景保持不透明，挡住下层操作钮 */
	.settled-item .cell {
		opacity: 0.55;
	}

	/* 账本图标：iOS 设置风格的圆角方块容器 */
	.row-icon {
		width: 80rpx;
		height: 80rpx;
		border-radius: 18rpx;
		background: var(--fill);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 44rpx;
		margin-right: 24rpx;
		flex-shrink: 0;
	}

	.cell-value-col {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		margin-left: 20rpx;
	}

	.cell-value-col .cell-value {
		margin-left: 0;
	}

	.cell-value-col .caption {
		margin-top: 4rpx;
	}

	.cell-value.num {
		font-weight: 600;
	}
</style>
