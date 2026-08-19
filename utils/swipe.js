/**
 * 列表行左滑操作的通用手势（首页/账本明细共用）。
 * Apple 风格：跟手 1:1、8px 方向锁定、松手按速度决策、边界橡皮筋。
 *
 * 页面用法：
 *   mixins: [createSwipeMixin(264)]   // 参数 = 操作按钮区总宽（rpx）
 *   模板绑定 swipeStart / swipeMove / swipeEnd / swipeFrontStyle；
 *   行点击处理里先 if (this.swipeTapGuard()) return —— 刚滑动过或有行
 *   处于打开态时，这次点击只负责收起，不触发页面动作。
 */
export function createSwipeMixin(actionRpx) {
	return {
		data() {
			return {
				swActionPx: 0,
				openId: '',
				swDragId: '',
				swOffset: 0,
				swDragging: false,
				swMoved: false,
				swStartX: 0,
				swStartY: 0,
				swBaseX: 0,
				swLastX: 0,
				swLastT: 0,
				swVx: 0,
				swLock: ''
			}
		},
		created() {
			const win = uni.getWindowInfo ? uni.getWindowInfo() : uni.getSystemInfoSync()
			this.swActionPx = (win.windowWidth / 750) * actionRpx
		},
		methods: {
			swipeFrontStyle(id) {
				if (this.swDragging && this.swDragId === id) {
					return `transform: translateX(${this.swOffset}px); transition: none;`
				}
				const x = this.openId === id ? -this.swActionPx : 0
				return `transform: translateX(${x}px); transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1);`
			},
			swipeStart(ev, id) {
				const t = ev.touches[0]
				this.swStartX = t.clientX
				this.swStartY = t.clientY
				this.swLastX = t.clientX
				this.swLastT = Date.now()
				this.swVx = 0
				this.swLock = ''
				this.swBaseX = this.openId === id ? -this.swActionPx : 0
				// 摸到别的行时，先把已滑开的行合上
				if (this.openId && this.openId !== id) this.openId = ''
			},
			swipeMove(ev, id, canAct) {
				if (!canAct) return
				const t = ev.touches[0]
				const dx = t.clientX - this.swStartX
				const dy = t.clientY - this.swStartY
				if (!this.swLock) {
					if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
					this.swLock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
				}
				if (this.swLock !== 'h') return
				const now = Date.now()
				if (now > this.swLastT) {
					this.swVx = (t.clientX - this.swLastX) / (now - this.swLastT)
					this.swLastX = t.clientX
					this.swLastT = now
				}
				let x = this.swBaseX + dx
				if (x > 0) x *= 0.3 // 右端橡皮筋
				if (x < -this.swActionPx) x = -this.swActionPx + (x + this.swActionPx) * 0.3 // 左端超出阻尼
				this.swDragging = true
				this.swMoved = true
				this.swDragId = id
				this.swOffset = x
			},
			swipeEnd(ev, id) {
				if (!this.swDragging) return
				// 速度优先，其次看停下的位置过没过半
				const open = this.swVx < -0.2 ? true : this.swVx > 0.2 ? false : this.swOffset < -this.swActionPx / 2
				this.openId = open ? id : ''
				this.swDragging = false
				this.swDragId = ''
			},
			swipeTapGuard() {
				if (this.swMoved) {
					this.swMoved = false
					return true
				}
				if (this.openId) {
					this.openId = ''
					return true
				}
				return false
			}
		}
	}
}
