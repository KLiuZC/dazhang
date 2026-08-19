/**
 * 云端调用与登录工具。
 * 登录采用微信静默登录（wx.login code → uni-id-co.loginByWeixin），无需用户点任何按钮。
 * token 存储键沿用 uni-id 约定（uni_id_token），uniCloud 请求会自动携带。
 */
const TOKEN_KEY = 'uni_id_token'
const TOKEN_EXPIRED_KEY = 'uni_id_token_expired'
const NICKNAME_KEY = 'ma_nickname'

let loginPromise = null

export function ensureLogin() {
	const token = uni.getStorageSync(TOKEN_KEY)
	const expired = uni.getStorageSync(TOKEN_EXPIRED_KEY)
	// 提前 5 分钟视为过期，避免请求途中失效
	if (token && expired && expired > Date.now() + 5 * 60 * 1000) {
		return Promise.resolve()
	}
	if (!loginPromise) {
		loginPromise = doLogin().finally(() => {
			loginPromise = null
		})
	}
	return loginPromise
}

async function doLogin() {
	// #ifdef MP-WEIXIN
	const loginRes = await uni.login({ provider: 'weixin' })
	const uniIdCo = uniCloud.importObject('uni-id-co', { customUI: true })
	const res = await uniIdCo.loginByWeixin({ code: loginRes.code })
	const t = res.newToken || res
	if (t && t.token) {
		uni.setStorageSync(TOKEN_KEY, t.token)
		uni.setStorageSync(TOKEN_EXPIRED_KEY, t.tokenExpired)
	}
	// #endif
	// #ifndef MP-WEIXIN
	throw { errCode: 'PLATFORM_NOT_SUPPORTED', errMsg: '请在微信小程序中使用' }
	// #endif
}

/** 调用 ledger-service 云对象（自动确保已登录，token 续期自动落盘） */
export async function callLedger(method, params = {}) {
	await ensureLogin()
	const service = uniCloud.importObject('ledger-service', { customUI: true })
	const res = await service[method](params)
	if (res && res.newToken && res.newToken.token) {
		uni.setStorageSync(TOKEN_KEY, res.newToken.token)
		uni.setStorageSync(TOKEN_EXPIRED_KEY, res.newToken.tokenExpired)
	}
	return res
}

export function toast(msg) {
	uni.showToast({ title: msg, icon: 'none' })
}

export function showError(e) {
	console.error(e)
	toast((e && (e.errMsg || e.message)) || '出错了，请重试')
}

/** 分 → 元字符串 */
export function fen2yuan(fen) {
	return ((fen || 0) / 100).toFixed(2)
}

/** 元字符串 → 分（整数）；非法输入返回 NaN */
export function yuan2fen(yuan) {
	const n = Math.round(parseFloat(yuan) * 100)
	return Number.isFinite(n) ? n : NaN
}

export function fmtDate(ts) {
	if (!ts) return ''
	const d = new Date(ts)
	const pad = x => String(x).padStart(2, '0')
	return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 年/月/日，如 2026/8/19 */
export function fmtDay(ts) {
	if (!ts) return ''
	const d = new Date(ts)
	return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 图片地址渲染保险：cloud:// 原始 fileID 不能进 <image>，一律返回空串走占位符 */
export function safeImg(url) {
	return url && typeof url === 'string' && !url.startsWith('cloud://') ? url : ''
}

/** 云存储 fileID（cloud://…）转成可渲染的临时地址；普通 https 地址原样返回 */
export async function fileIdToURL(fileID) {
	if (!fileID || typeof fileID !== 'string') return ''
	if (!fileID.startsWith('cloud://')) return fileID
	try {
		const res = await uniCloud.getTempFileURL({ fileList: [fileID] })
		const item = res.fileList && res.fileList[0]
		return (item && item.tempFileURL) || ''
	} catch (e) {
		console.error(e)
		return ''
	}
}

/* ---------- 页面数据缓存（stale-while-revalidate：先出缓存秒开，云端回来再覆盖） ---------- */

const CACHE_PREFIX = 'ma_cache_'

export function readCache(key) {
	try {
		const box = uni.getStorageSync(CACHE_PREFIX + key)
		return box ? box.v : null
	} catch (e) {
		return null
	}
}

export function writeCache(key, value) {
	try {
		uni.setStorageSync(CACHE_PREFIX + key, { v: value, t: Date.now() })
	} catch (e) {
		// 存储满等异常不影响业务
	}
}

export function removeCache(key) {
	try {
		uni.removeStorageSync(CACHE_PREFIX + key)
	} catch (e) {}
}

export function getMyNickname() {
	return uni.getStorageSync(NICKNAME_KEY) || ''
}

export function saveMyNickname(nickname) {
	uni.setStorageSync(NICKNAME_KEY, nickname)
}
