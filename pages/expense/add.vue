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
				<picker
					v-if="currencyOptions.length > 1"
					:range="currencyOptions"
					range-key="label"
					:value="currencyIndex"
					@change="onCurrencyChange"
				>
					<view class="amount-prefix num cur-switch">{{ curSymbol(currency) }} ▾</view>
				</picker>
				<text v-else class="amount-prefix num">¥</text>
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

		<view class="sec-h">谁参与</view>
		<view class="group">
			<!-- 分摊方式切换 -->
			<view class="split-seg">
				<view class="segmented">
					<view class="seg-thumb" :class="{ right: splitMode === 'custom' }"></view>
					<view class="seg-item" :class="{ active: splitMode === 'equal' }" @click="splitMode = 'equal'">均摊</view>
					<view class="seg-item" :class="{ active: splitMode === 'custom' }" @click="splitMode = 'custom'">按金额</view>
				</view>
			</view>

			<!-- 均摊：勾选参与人 -->
			<view v-if="splitMode === 'equal'" class="chips">
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

			<!-- 按金额：每人填各自承担的金额，留空 = 不参与 -->
			<template v-else>
				<view v-for="m in members" :key="m.id" class="cell cell-sep">
					<view class="cell-main">
						<view class="cell-title">{{ m.nickname }}</view>
					</view>
					<view class="footnote">{{ curSymbol(currency) }}</view>
					<input
						class="custom-input num"
						type="digit"
						:value="customAmounts[m.id] || ''"
						placeholder="0"
						placeholder-class="ph"
						@input="onCustomInput(m.id, $event)"
					/>
				</view>
			</template>

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
		<view v-if="previewText" class="sec-f" :class="{ 'sec-f-warn': customMismatch }">{{ previewText }}</view>

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
	import { curSymbol, currencyName } from '@/utils/currency.js'

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
				currency: 'CNY',
				ledgerCurrencies: [],
				splitMode: 'equal',
				customAmounts: {}, // member_id -> 输入的金额字符串（原币）
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
			currencyOptions() {
				return [{ code: 'CNY', label: '人民币 ¥' }].concat(
					this.ledgerCurrencies.map(c => ({ code: c.code, label: `${currencyName(c.code)} ${curSymbol(c.code)}` }))
				)
			},
			currencyIndex() {
				const i = this.currencyOptions.findIndex(o => o.code === this.currency)
				return i >= 0 ? i : 0
			},
			curRate() {
				if (this.currency === 'CNY') return 1
				const c = this.ledgerCurrencies.find(x => x.code === this.currency)
				return c ? c.rate : 1
			},
			// 按金额模式：已分配合计与参与人数（原币分值）
			assignedFen() {
				let sum = 0
				for (const m of this.members) {
					const v = yuan2fen(this.customAmounts[m.id])
					if (Number.isFinite(v) && v > 0) sum += v
				}
				return sum
			},
			customCount() {
				return this.members.filter(m => yuan2fen(this.customAmounts[m.id]) > 0).length
			},
			customMismatch() {
				if (this.splitMode !== 'custom') return false
				const fen = yuan2fen(this.amountStr)
				return Number.isFinite(fen) && fen > 0 && this.assignedFen !== fen
			},
			previewText() {
				const fen = yuan2fen(this.amountStr)
				const sym = curSymbol(this.currency)
				if (this.splitMode === 'custom') {
					if (!Number.isFinite(fen) || fen <= 0) return '先在上面填总金额，再给每个人分'
					const diff = fen - this.assignedFen
					if (diff > 0) return `还差 ${sym}${fen2yuan(diff)} 未分完`
					if (diff < 0) return `多分了 ${sym}${fen2yuan(-diff)}，超过总金额`
					const done = `已分完，${this.customCount}人参与`
					return this.currency === 'CNY' ? done : `${done}（合计约 ¥${fen2yuan(Math.round(fen * this.curRate))}）`
				}
				const n = this.checkedIds.length
				if (!Number.isFinite(fen) || fen <= 0 || n === 0) return ''
				const per = `${n}人均摊，每人约 ${sym}${fen2yuan(Math.round(fen / n))}`
				if (this.currency === 'CNY') return per
				return `${per}（合计约 ¥${fen2yuan(Math.round(fen * this.curRate))}）`
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
					this.ledgerCurrencies = res.ledger.currencies || []
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
						this.currency = exp.currency || 'CNY'
						const payerIdx = this.members.findIndex(m => m.id === exp.payer_member_id)
						if (payerIdx >= 0) this.payerIndex = payerIdx
						this.splitMode = exp.split_type === 'custom' ? 'custom' : 'equal'
						if (this.splitMode === 'custom') {
							// 用原币份额回填每人金额
							const src = exp.participants_original || exp.participants
							const ca = {}
							for (const p of src) ca[p.member_id] = fen2yuan(p.amount)
							this.customAmounts = ca
						} else {
							const inExp = new Set(exp.participants.map(p => p.member_id))
							for (const m of this.members) checked[m.id] = inExp.has(m.id)
							this.checked = { ...checked }
						}
					}
				} catch (e) {
					showError(e)
				}
			},
			onPayerChange(e) {
				this.payerIndex = Number(e.detail.value)
			},
			curSymbol,
			onCurrencyChange(e) {
				const option = this.currencyOptions[Number(e.detail.value)]
				if (option) this.currency = option.code
			},
			toggle(id) {
				this.checked[id] = !this.checked[id]
			},
			onCustomInput(id, e) {
				this.customAmounts[id] = e.detail.value
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
				const payer = this.members[this.payerIndex]
				if (!payer) return toast('选一下谁垫付的')

				const params = {
					title,
					amount: fen,
					currency: this.currency,
					payerMemberId: payer.id
				}
				if (this.splitMode === 'custom') {
					const parts = []
					for (const m of this.members) {
						const v = yuan2fen(this.customAmounts[m.id])
						if (Number.isFinite(v) && v > 0) parts.push({ member_id: m.id, amount: v })
					}
					if (!parts.length) return toast('给至少一个人分点金额')
					const sum = parts.reduce((s, p) => s + p.amount, 0)
					if (sum > fen) return toast('分配超过了总金额')
					if (sum < fen) return toast(`还差 ${curSymbol(this.currency)}${fen2yuan(fen - sum)} 未分完`)
					params.splitType = 'custom'
					params.participants = parts
				} else {
					if (!this.checkedIds.length) return toast('至少选一个参与人')
					params.splitType = 'equal'
					params.participantMemberIds = this.checkedIds
				}

				this.submitting = true
				try {
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

	/* 可切换币种时前缀变绿提示可点 */
	.cur-switch {
		color: var(--green);
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

	.split-seg {
		padding: 24rpx 32rpx 8rpx;
	}

	.custom-input {
		width: 200rpx;
		text-align: right;
		font-size: 32rpx;
		margin-left: 12rpx;
	}

	.sec-f-warn {
		color: var(--red);
	}

	.add-title {
		color: var(--green);
		font-size: 30rpx;
	}
</style>
