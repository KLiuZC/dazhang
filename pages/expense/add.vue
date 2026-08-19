<template>
	<view class="page">
		<view class="group">
			<view class="cell">
				<input
					class="cell-input"
					v-model="title"
					placeholder="这笔是什么？如：晚饭、打车"
					placeholder-class="ph"
					maxlength="30"
				/>
			</view>
			<view class="cell cell-sep amount-cell">
				<text class="amount-prefix num">¥</text>
				<input
					class="amount-input num"
					v-model="amountStr"
					type="digit"
					placeholder="0.00"
					placeholder-class="ph"
				/>
			</view>
		</view>

		<view class="sec-h">谁垫付的</view>
		<view class="group">
			<picker :range="memberNames" :value="payerIndex" @change="onPayerChange">
				<view class="cell" hover-class="cell-press" hover-start-time="0" hover-stay-time="80">
					<view class="cell-main">
						<view class="cell-title">付款人</view>
					</view>
					<view class="cell-value dim">{{ memberNames[payerIndex] || '请选择' }}</view>
					<view class="chevron">›</view>
				</view>
			</picker>
		</view>

		<view class="sec-h">谁参与（均摊）</view>
		<view class="group">
			<view class="chips">
				<view
					v-for="m in members"
					:key="m.id"
					class="chip chip-select"
					:class="{ active: checked[m.id] }"
					hover-class="press-scale"
					hover-start-time="0"
					@click="toggle(m.id)"
				>{{ m.nickname }}</view>
			</view>
			<view
				class="cell cell-sep"
				hover-class="cell-press"
				hover-start-time="0"
				hover-stay-time="80"
				@click="addVirtualMember"
			>
				<view class="cell-main">
					<view class="cell-title add-title">＋ 帮不在群里的朋友添一个</view>
				</view>
			</view>
		</view>
		<view v-if="previewText" class="sec-f">{{ previewText }}</view>

		<view class="footer-bar">
			<button
				class="btn-capsule"
				:disabled="submitting"
				hover-class="press-scale"
				hover-start-time="0"
				@click="submit"
			>{{ expenseId ? '保存修改' : '记下这笔' }}</button>
		</view>
	</view>
</template>

<script>
	import { callLedger, showError, toast, fen2yuan, yuan2fen } from '@/utils/cloud.js'

	export default {
		data() {
			return {
				ledgerId: '',
				expenseId: '', // 有值 = 编辑已有账目
				members: [],
				checked: {},
				payerIndex: 0,
				title: '',
				amountStr: '',
				submitting: false
			}
		},
		computed: {
			memberNames() {
				return this.members.map(m => m.nickname)
			},
			checkedIds() {
				return this.members.filter(m => this.checked[m.id]).map(m => m.id)
			},
			previewText() {
				const fen = yuan2fen(this.amountStr)
				const n = this.checkedIds.length
				if (!Number.isFinite(fen) || fen <= 0 || n === 0) return ''
				return `${n}人均摊，每人约 ¥${fen2yuan(Math.round(fen / n))}`
			}
		},
		onLoad(options) {
			this.ledgerId = (options && options.id) || ''
			this.expenseId = (options && options.expenseId) || ''
			if (this.expenseId) {
				uni.setNavigationBarTitle({ title: '修改账目' })
			}
			this.load()
		},
		methods: {
			async load() {
				try {
					const res = await callLedger('getLedger', { ledgerId: this.ledgerId })
					if (!res.isMember) {
						toast('你还不是该账本成员')
						setTimeout(() => uni.navigateBack(), 800)
						return
					}
					this.members = res.ledger.members
					const checked = {}
					for (const m of this.members) checked[m.id] = true
					this.checked = checked
					const myIdx = this.members.findIndex(m => m.id === res.myMemberId)
					this.payerIndex = myIdx >= 0 ? myIdx : 0
					// 编辑模式：用原账目回填表单
					if (this.expenseId) {
						const exp = (res.expenses || []).find(x => x._id === this.expenseId)
						if (!exp) {
							toast('账目不存在或已删除')
							setTimeout(() => uni.navigateBack(), 800)
							return
						}
						this.title = exp.title
						this.amountStr = fen2yuan(exp.amount)
						const payerIdx = this.members.findIndex(m => m.id === exp.payer_member_id)
						if (payerIdx >= 0) this.payerIndex = payerIdx
						const inExp = new Set(exp.participants.map(p => p.member_id))
						for (const m of this.members) checked[m.id] = inExp.has(m.id)
						this.checked = { ...checked }
					}
				} catch (e) {
					showError(e)
				}
			},
			onPayerChange(e) {
				this.payerIndex = Number(e.detail.value)
			},
			toggle(id) {
				this.checked[id] = !this.checked[id]
			},
			addVirtualMember() {
				uni.showModal({
					title: '添加成员',
					editable: true,
					placeholderText: '朋友的昵称',
					success: async res => {
						const nickname = (res.content || '').trim()
						if (!res.confirm || !nickname) return
						try {
							await callLedger('addVirtualMember', { ledgerId: this.ledgerId, nickname })
							toast('已添加，对方进小程序后可认领')
							this.load()
						} catch (e) {
							showError(e)
						}
					}
				})
			},
			async submit() {
				const title = this.title.trim()
				if (!title) return toast('写一下这笔是什么')
				const fen = yuan2fen(this.amountStr)
				if (!Number.isFinite(fen) || fen <= 0) return toast('金额不对哦')
				if (!this.checkedIds.length) return toast('至少选一个参与人')
				const payer = this.members[this.payerIndex]
				if (!payer) return toast('选一下谁垫付的')
				this.submitting = true
				try {
					const params = {
						title,
						amount: fen,
						payerMemberId: payer.id,
						participantMemberIds: this.checkedIds,
						splitType: 'equal'
					}
					if (this.expenseId) {
						await callLedger('updateExpense', { ...params, expenseId: this.expenseId })
					} else {
						await callLedger('addExpense', { ...params, ledgerId: this.ledgerId })
					}
					uni.vibrateShort({ type: 'light' })
					uni.showToast({ title: this.expenseId ? '已保存' : '已记账', icon: 'success' })
					setTimeout(() => uni.navigateBack(), 600)
				} catch (e) {
					showError(e)
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

	/* 金额行：大号紧字距数字 */
	.amount-cell {
		padding-top: 28rpx;
		padding-bottom: 28rpx;
	}

	.amount-prefix {
		font-size: 48rpx;
		font-weight: 600;
		color: var(--secondary);
		margin-right: 12rpx;
	}

	.amount-input {
		flex: 1;
		font-size: 64rpx;
		font-weight: 700;
		letter-spacing: -0.02em;
		height: 88rpx;
	}

	/* 参与人：胶囊选择块，选中态为绿色淡染 */
	.chips {
		display: flex;
		flex-wrap: wrap;
		padding: 28rpx 32rpx 8rpx;
	}

	.chip-select {
		background: var(--fill);
		color: var(--label);
		font-weight: 500;
		margin: 0 16rpx 20rpx 0;
	}

	.chip-select.active {
		background: var(--green-tint);
		color: var(--green);
		font-weight: 600;
	}

	.add-title {
		color: var(--green);
		font-size: 30rpx;
	}
</style>
