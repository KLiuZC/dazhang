<template>
	<view class="page">
		<view class="sec-h">账本名称</view>
		<view class="group">
			<view class="cell">
				<view class="title-icon">{{ icon }}</view>
				<input
					class="cell-input"
					v-model="title"
					placeholder="如：周末烧烤、川西之行"
					placeholder-class="ph"
					maxlength="30"
				/>
			</view>
		</view>

		<view class="sec-h">封面</view>
		<view class="group">
			<view class="cat-wrap">
				<view
					v-for="(c, i) in categories"
					:key="c.name"
					class="cat-chip"
					:class="{ active: i === catIndex }"
					hover-class="press-scale"
					hover-start-time="0"
					@click="catIndex = i"
				>{{ c.name }}</view>
			</view>
			<view class="icon-grid">
				<view
					v-for="ic in categories[catIndex].icons"
					:key="ic"
					class="icon-item"
					:class="{ active: ic === icon }"
					hover-class="press-scale"
					hover-start-time="0"
					@click="icon = ic"
				>{{ ic }}</view>
			</view>
		</view>

		<!-- 币种与汇率：仅管理模式配置，主币种恒为人民币 -->
		<template v-if="editId">
			<view class="sec-h">币种与汇率</view>
			<view class="group">
				<view v-for="(c, i) in currencies" :key="c.code" class="cell" :class="{ 'cell-sep': i > 0 }">
					<view class="cell-main">
						<view class="cell-title">{{ currencyName(c.code) }} {{ c.code }}</view>
						<view v-if="fxRates[c.code]" class="caption">今日参考 {{ fxDisplay(c.code) }}</view>
					</view>
					<input
						class="rate-input num"
						type="digit"
						:value="String(c.rate)"
						@blur="onRateBlur(i, $event)"
					/>
					<view class="footnote rate-unit">CNY</view>
					<view class="rate-remove" hover-class="press-scale" hover-start-time="0" @click="removeCurrency(i)">
						<uni-icons type="closeempty" size="16" color="#8E8E93" />
					</view>
				</view>
				<picker :range="remainNames" @change="onAddCurrency">
					<view class="cell" :class="{ 'cell-sep': currencies.length > 0 }" hover-class="cell-press" hover-start-time="0">
						<view class="cell-main">
							<view class="add-cur">＋ 添加币种</view>
						</view>
					</view>
				</picker>
			</view>
			<view class="sec-f">1 外币 = 多少人民币，由大家商量确定，默认填入今日参考价；保存后全账本按新汇率重新折算。</view>
		</template>

		<!-- 编辑模式不需要身份；新建时：已设置微信身份直接用，未设置则填一次昵称 -->
		<template v-if="!editId && hasProfile">
			<view class="sec-h">你的身份</view>
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
		</template>
		<template v-else-if="!editId">
			<view class="sec-h">你在账本里的昵称</view>
			<view class="group">
				<view class="cell">
					<input
						class="cell-input"
						v-model="nickname"
						placeholder="让朋友认得出你"
						placeholder-class="ph"
						maxlength="30"
					/>
				</view>
			</view>
		</template>

		<!-- 已结清账本：重新打开入口 -->
		<view v-if="editId && isCreator && ledgerStatus === 1" class="group">
			<view
				class="cell"
				hover-class="cell-press"
				hover-start-time="0"
				hover-stay-time="80"
				@click="reopenLedger"
			>
				<view class="cell-main">
					<view class="reopen-text">重新打开账本</view>
				</view>
			</view>
		</view>

		<!-- 危险操作区：仅创建者在管理模式可见 -->
		<view v-if="editId && isCreator" class="group">
			<view
				class="cell"
				hover-class="cell-press"
				hover-start-time="0"
				hover-stay-time="80"
				@click="removeLedger"
			>
				<view class="cell-main">
					<view class="danger-text">删除账本</view>
				</view>
			</view>
		</view>

		<view class="footer-bar">
			<button
				class="btn-capsule"
				:disabled="submitting"
				hover-class="press-scale"
				hover-start-time="0"
				@click="submit"
			>{{ editId ? '保存修改' : '创建账本' }}</button>
		</view>
	</view>
</template>

<script>
	import { callLedger, showError, toast, getMyNickname, saveMyNickname, safeImg, removeCache } from '@/utils/cloud.js'
	import { CURRENCIES, currencyName } from '@/utils/currency.js'

	export default {
		data() {
			return {
				editId: '', // 有值 = 管理已有账本
				isCreator: false,
				ledgerStatus: 0,
				title: '',
				icon: '🧾',
				catIndex: 0,
				categories: [
					{ name: '通用', icons: ['🧾', '💰', '🤝', '📒', '🎁', '⭐', '🎂', '❤️', '🛒', '🧹'] },
					{ name: '聚餐', icons: ['🍔', '🍕', '🍜', '🍣', '🍖', '🦞', '🍻', '🧋', '☕', '🍰'] },
					{ name: '出行', icons: ['✈️', '🚄', '🚗', '🏝️', '🏔️', '🏕️', '🗺️', '🚢', '🏖️', '⛩️'] },
					{ name: '玩乐', icons: ['🎉', '🎮', '🎤', '🎬', '🎳', '🎯', '🎡', '🃏', '🀄', '🎣'] },
					{ name: '运动', icons: ['⚽', '🏀', '🏸', '🎾', '🏊', '🚴', '⛷️', '🧗', '🥊', '⛳'] }
				],
				nickname: '',
				profile: { nickname: '', avatar: '' },
				currencies: [],
				fxRates: {},
				fxDate: '',
				submitting: false
			}
		},
		computed: {
			hasProfile() {
				return !!this.profile.nickname
			},
			remaining() {
				return CURRENCIES.filter(c => !this.currencies.some(x => x.code === c.code))
			},
			remainNames() {
				return this.remaining.map(c => `${c.name} ${c.code}`)
			}
		},
		onLoad(options) {
			this.editId = (options && options.id) || ''
			this.nickname = getMyNickname()
			if (this.editId) {
				uni.setNavigationBarTitle({ title: '管理账本' })
				this.loadLedger()
				this.loadFx()
			} else {
				this.loadProfile()
			}
		},
		methods: {
			async loadProfile() {
				try {
					const res = await callLedger('getMyProfile')
					this.profile = (res && res.profile) || { nickname: '', avatar: '' }
					this.profile.avatar = safeImg(this.profile.avatar)
				} catch (e) {
					// 资料读取失败不阻塞建账本，退回昵称输入
					console.error(e)
				}
			},
			async loadLedger() {
				try {
					const res = await callLedger('getLedger', { ledgerId: this.editId })
					this.title = res.ledger.title
					this.icon = res.ledger.icon || '🧾'
					this.isCreator = !!res.isCreator
					this.ledgerStatus = res.ledger.status || 0
					this.currencies = (res.ledger.currencies || []).map(c => ({ ...c }))
					const idx = this.categories.findIndex(c => c.icons.includes(this.icon))
					if (idx >= 0) this.catIndex = idx
				} catch (e) {
					showError(e)
				}
			},
			// 今日参考汇率，仅作添加币种时的默认值；拉不到不阻塞（手填即可）
			async loadFx() {
				try {
					const res = await callLedger('getFxRates')
					this.fxRates = res.rates || {}
					this.fxDate = res.date || ''
				} catch (e) {
					console.error(e)
				}
			},
			currencyName,
			fxDisplay(code) {
				const v = this.fxRates[code]
				return v ? Number(v.toFixed(4)) : ''
			},
			onAddCurrency(e) {
				const cur = this.remaining[Number(e.detail.value)]
				if (!cur) return
				const ref = this.fxRates[cur.code]
				this.currencies.push({ code: cur.code, rate: ref ? Number(ref.toFixed(4)) : 1 })
			},
			removeCurrency(i) {
				this.currencies.splice(i, 1)
			},
			onRateBlur(i, e) {
				const v = parseFloat(e.detail.value)
				if (Number.isFinite(v) && v > 0) {
					this.currencies[i].rate = Number(v.toFixed(4))
				} else {
					toast('汇率要大于 0')
					this.currencies = this.currencies.map(c => ({ ...c }))
				}
			},
			reopenLedger() {
				uni.showModal({
					title: '重新打开账本？',
					content: '打开后可以继续记账，之后可再次标记结清',
					success: async res => {
						if (!res.confirm) return
						try {
							await callLedger('reopenLedger', { ledgerId: this.editId })
							uni.vibrateShort({ type: 'light' })
							uni.showToast({ title: '已重新打开', icon: 'success' })
							setTimeout(() => uni.navigateBack(), 600)
						} catch (e) {
							showError(e)
						}
					}
				})
			},
			removeLedger() {
				uni.showModal({
					title: '删除这个账本？',
					content: `「${this.title}」和里面的所有账目都会被永久删除，无法恢复`,
					confirmText: '删除',
					confirmColor: '#FF3B30',
					success: async res => {
						if (!res.confirm) return
						try {
							await callLedger('deleteLedger', { ledgerId: this.editId })
							removeCache('ledger_' + this.editId)
							uni.vibrateShort({ type: 'light' })
							uni.showToast({ title: '已删除', icon: 'success' })
							setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 600)
						} catch (e) {
							showError(e)
						}
					}
				})
			},
			async submit() {
				const title = this.title.trim()
				if (!title) return toast('先给账本起个名字')
				// 管理模式：保存名称/封面
				if (this.editId) {
					this.submitting = true
					try {
						await callLedger('updateLedger', {
							ledgerId: this.editId,
							title,
							icon: this.icon,
							currencies: this.currencies.map(c => ({ code: c.code, rate: Number(c.rate) }))
						})
						uni.vibrateShort({ type: 'light' })
						uni.showToast({ title: '已保存', icon: 'success' })
						setTimeout(() => uni.navigateBack(), 600)
					} catch (e) {
						showError(e)
						this.submitting = false
					}
					return
				}
				let nickname
				if (!this.hasProfile) {
					nickname = this.nickname.trim()
					if (!nickname) return toast('填一下你的昵称')
				}
				this.submitting = true
				try {
					const res = await callLedger('createLedger', { title, icon: this.icon, nickname })
					if (nickname) saveMyNickname(nickname)
					uni.vibrateShort({ type: 'light' })
					uni.redirectTo({ url: `/pages/ledger/detail?id=${res.ledgerId}` })
				} catch (e) {
					if (e && e.errCode === 'QUOTA_EXCEEDED') {
						// 配额启用后的引导；接入流量主后此处换成 [看广告] 按钮 → 激励视频 → grantAdQuota → 重试
						uni.showModal({
							title: '账本数量已达上限',
							content: '看一个小广告可以增加 1 个账本额度，或删除不再使用的账本后再试。',
							showCancel: false,
							confirmText: '知道了'
						})
					} else {
						showError(e)
					}
					this.submitting = false
				}
			}
		}
	}
</script>

<style>
	.cell-input {
		flex: 1;
		font-size: 34rpx;
		height: 56rpx;
	}

	/* 账本名称前的封面预览位 */
	.title-icon {
		width: 64rpx;
		height: 64rpx;
		border-radius: 16rpx;
		background: var(--fill);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 36rpx;
		margin-right: 20rpx;
		flex-shrink: 0;
	}

	/* 分类胶囊：等宽撑满一行，均匀摆放 */
	.cat-wrap {
		display: flex;
		padding: 24rpx 24rpx 0;
	}

	.cat-chip {
		flex: 1;
		text-align: center;
		font-size: 26rpx;
		font-weight: 500;
		color: var(--secondary);
		background: var(--fill);
		padding: 10rpx 0;
		border-radius: 100rpx;
		margin: 0 8rpx 16rpx;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	.cat-chip.active {
		background: var(--green-tint);
		color: var(--green);
		font-weight: 600;
	}

	.icon-grid {
		display: flex;
		flex-wrap: wrap;
		padding: 8rpx 24rpx 12rpx;
	}

	/* 每行固定 5 个，等宽撑满，与上方胶囊同节奏 */
	.icon-item {
		width: calc(20% - 16rpx);
		height: 92rpx;
		box-sizing: border-box;
		border-radius: 22rpx;
		background: var(--fill);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 48rpx;
		margin: 0 8rpx 20rpx;
		border: 4rpx solid transparent;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1), border-color 160ms ease-out;
	}

	.icon-item.active {
		background: var(--green-tint);
		border-color: var(--green);
	}

	.rate-input {
		width: 150rpx;
		text-align: right;
		font-size: 32rpx;
	}

	.rate-unit {
		margin-left: 8rpx;
	}

	.rate-remove {
		margin-left: 20rpx;
		padding: 8rpx;
	}

	.add-cur {
		color: var(--green);
		font-size: 30rpx;
	}

	.danger-text {
		color: var(--red);
		text-align: center;
		font-size: 34rpx;
		font-weight: 500;
	}

	.reopen-text {
		color: var(--green);
		text-align: center;
		font-size: 34rpx;
		font-weight: 500;
	}
</style>
