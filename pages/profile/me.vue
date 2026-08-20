<template>
	<view class="page">
		<view class="group">
			<view class="cell avatar-cell">
				<button
					class="avatar-btn"
					open-type="chooseAvatar"
					@chooseavatar="onChooseAvatar"
					hover-class="press-scale"
					hover-start-time="0"
				>
					<image v-if="avatar" class="avatar-img" :src="avatar" mode="aspectFill" @error="onImgError" />
					<view v-else class="avatar-img avatar-ph">{{ uploading ? '⏳' : '🙂' }}</view>
				</button>
				<view class="caption avatar-tip">{{ uploading ? '上传中…' : '点击选择微信头像' }}</view>
			</view>
			<view class="cell cell-sep">
				<view class="cell-main">
					<view class="cell-title">昵称</view>
				</view>
				<input
					class="nick-input"
					type="nickname"
					v-model="nickname"
					placeholder="填写或用微信昵称"
					placeholder-class="ph"
					maxlength="30"
					@blur="onNickBlur"
				/>
			</view>
		</view>
		<view class="sec-f">这是你在所有账本里的统一身份，改一次处处生效。填昵称时键盘上方可一键使用微信昵称。</view>

		<button
			class="btn-capsule"
			:disabled="saving || uploading"
			hover-class="press-scale"
			hover-start-time="0"
			@click="save"
		>保存</button>

		<view class="group feedback-entry">
			<view
				class="cell"
				hover-class="cell-press"
				hover-start-time="0"
				hover-stay-time="80"
				@click="goFeedback"
			>
				<view class="cell-main">
					<view class="cell-title">意见反馈</view>
				</view>
				<view class="chevron">›</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { callLedger, showError, toast, fileIdToURL, safeImg } from '@/utils/cloud.js'

	export default {
		data() {
			return {
				nickname: '',
				avatar: '',          // 展示用地址（https）
				newAvatarFileID: '', // 新选头像的云存储 fileID（保存时提交这个）
				tempAvatar: '',      // 上传失败时留存的本地路径，保存时重试
				uploading: false,
				saving: false
			}
		},
		onLoad() {
			this.loadProfile()
		},
		methods: {
			async loadProfile() {
				try {
					const res = await callLedger('getMyProfile')
					this.nickname = res.profile.nickname
					this.avatar = safeImg(res.profile.avatar)
				} catch (e) {
					showError(e)
				}
			},
			async uploadAvatar(filePath) {
				const up = await uniCloud.uploadFile({
					filePath,
					cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`
				})
				return up.fileID
			},
			// 选完头像立刻上传；数据库存 fileID，预览用转换后的 https 地址
			async onChooseAvatar(e) {
				const url = e.detail && e.detail.avatarUrl
				if (!url) return
				this.uploading = true
				try {
					const fileID = await this.uploadAvatar(url)
					this.newAvatarFileID = fileID
					this.avatar = await fileIdToURL(fileID)
					this.tempAvatar = ''
				} catch (err) {
					showError(err)
					this.tempAvatar = url
				}
				this.uploading = false
			},
			onImgError(e) {
				console.error('头像图片加载失败，src =', this.avatar, e && e.detail)
			},
			goFeedback() {
				uni.navigateTo({ url: '/pages/feedback/feedback' })
			},
			// 微信昵称快捷填入有时在失焦才回传，这里兜底同步
			onNickBlur(e) {
				const value = e.detail && e.detail.value
				if (value) this.nickname = value
			},
			async save() {
				const nickname = this.nickname.trim()
				if (!nickname) return toast('填一下昵称')
				this.saving = true
				try {
					if (this.tempAvatar) {
						this.newAvatarFileID = await this.uploadAvatar(this.tempAvatar)
						this.tempAvatar = ''
					}
					const params = { nickname }
					if (this.newAvatarFileID) {
						params.avatar = this.newAvatarFileID
					}
					await callLedger('updateMyProfile', params)
					uni.vibrateShort({ type: 'light' })
					uni.showToast({ title: '已保存', icon: 'success' })
					setTimeout(() => uni.navigateBack(), 600)
				} catch (e) {
					showError(e)
					this.saving = false
				}
			}
		}
	}
</script>

<style>
	.avatar-cell {
		flex-direction: column;
		align-items: center;
		padding: 44rpx 32rpx 28rpx;
	}

	.avatar-btn {
		width: 152rpx;
		height: 152rpx;
		border-radius: 50%;
		overflow: hidden;
		transition: transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
	}

	.avatar-img {
		width: 152rpx;
		height: 152rpx;
		border-radius: 50%;
		display: block;
	}

	.avatar-ph {
		background: var(--fill);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 72rpx;
	}

	.avatar-tip {
		margin-top: 16rpx;
	}

	.nick-input {
		flex: 1;
		text-align: right;
		font-size: 34rpx;
		height: 56rpx;
		margin-left: 20rpx;
	}

	.feedback-entry {
		margin-top: 40rpx;
	}
</style>
