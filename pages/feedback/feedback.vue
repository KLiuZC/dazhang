<template>
	<view class="page">
		<view class="sec-h">告诉我们你的想法</view>
		<view class="group">
			<textarea
				class="fb-input"
				v-model="content"
				maxlength="500"
				placeholder="遇到的问题、想要的功能，都可以说说"
				placeholder-class="ph"
			/>
			<view class="fb-count caption">{{ content.length }}/500</view>
		</view>
		<view class="sec-f">每一条我们都会认真看。</view>

		<button
			class="btn-capsule"
			:disabled="submitting || !content.trim()"
			hover-class="press-scale"
			hover-start-time="0"
			@click="submit"
		>提交</button>
	</view>
</template>

<script>
	import { callLedger, showError } from '@/utils/cloud.js'

	export default {
		data() {
			return {
				content: '',
				submitting: false
			}
		},
		methods: {
			async submit() {
				const content = this.content.trim()
				if (!content) return
				this.submitting = true
				try {
					await callLedger('addFeedback', { content })
					uni.vibrateShort({ type: 'light' })
					uni.showToast({ title: '已收到，谢谢你', icon: 'success' })
					setTimeout(() => uni.navigateBack(), 700)
				} catch (e) {
					showError(e)
					this.submitting = false
				}
			}
		}
	}
</script>

<style>
	.fb-input {
		width: 100%;
		box-sizing: border-box;
		height: 320rpx;
		padding: 28rpx 32rpx;
		font-size: 32rpx;
		line-height: 1.5;
	}

	.fb-count {
		text-align: right;
		padding: 0 32rpx 20rpx;
	}
</style>
