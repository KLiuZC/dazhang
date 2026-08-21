'use strict'

/**
 * 搭账核心云对象。
 * 客户端不直连数据库（schema permission 全部 false），所有读写经过这里，
 * 权限规则（是否账本成员、谁能删账等）在代码里集中校验。
 */
const uniIdCommon = require('uni-id-common')
const { splitEqually, calcBalances, calcTransfers, convertPartsToCny } = require('./settle')
const { checkText } = require('./wx-sec')
const { fetchDailyRates, SUPPORTED } = require('./fx')

const db = uniCloud.database()
const dbCmd = db.command

const MAX_MEMBERS = 50
const MAX_TEXT_LEN = 30
const MAX_AMOUNT = 100000000 // 单笔上限 100 万元（分）

// 结算尾差阈值（分）：净额 ≤ 此值的不生成转账（多笔凑整攒出的几分钱不值得为它转账）
const SETTLE_DUST = 9

// 账本配额：上线初期不限制（开关关闭）。启用时把 QUOTA_ENABLED 改为 true 并重新上传即可，
// 届时：进行中账本数 ≤ 免费额度 + 用户通过看广告等方式获得的 extra_ledger_quota
const QUOTA_ENABLED = false
const FREE_LEDGER_QUOTA = 3
const AD_QUOTA_DAILY_LIMIT = 5 // 每日看广告加额度的上限，防刷

function fail(errCode, errMsg) {
	// 抛真正的 Error（支付宝云序列化普通对象异常会丢失全部信息），
	// 业务错误最终在 _after 里转为 errCode 返回值送达客户端
	const err = new Error(errMsg)
	err.errCode = errCode
	err.errMsg = errMsg
	throw err
}

function assert(cond, errMsg, errCode = 'INVALID_PARAM') {
	if (!cond) fail(errCode, errMsg)
}

function cleanText(value, label) {
	assert(typeof value === 'string' && value.trim().length > 0, `${label}不能为空`)
	const text = value.trim()
	assert(text.length <= MAX_TEXT_LEN, `${label}不能超过${MAX_TEXT_LEN}个字`)
	return text
}

function genMemberId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

async function mustGetLedger(ledgerId) {
	assert(typeof ledgerId === 'string' && ledgerId.length > 0, '缺少账本ID')
	const res = await db.collection('ledgers').doc(ledgerId).get()
	const ledger = res.data && res.data[0]
	assert(ledger, '账本不存在或已删除', 'NOT_FOUND')
	return ledger
}

function findMemberByUid(ledger, uid) {
	return (ledger.members || []).find(m => m.uid === uid)
}

/** 校验并生成一笔账的分摊明细（新增和修改共用） */
function buildParticipants(ledger, { amount, payerMemberId, participantMemberIds, splitType, participants }) {
	assert(Number.isInteger(amount) && amount > 0 && amount <= MAX_AMOUNT, '金额不合法')
	const memberIds = new Set((ledger.members || []).map(m => m.id))
	assert(memberIds.has(payerMemberId), '付款人不是账本成员')
	splitType = splitType === 'custom' ? 'custom' : 'equal'
	let parts
	if (splitType === 'equal') {
		assert(Array.isArray(participantMemberIds) && participantMemberIds.length > 0, '请选择参与人')
		const unique = [...new Set(participantMemberIds)]
		assert(unique.length === participantMemberIds.length, '参与人重复')
		for (const id of unique) {
			assert(memberIds.has(id), '参与人不是账本成员')
		}
		// 垫付人排最前：均摊除不尽时，多出的分数优先由垫付者吸收
		const ordered = unique.includes(payerMemberId)
			? [payerMemberId, ...unique.filter(id => id !== payerMemberId)]
			: unique
		parts = splitEqually(amount, ordered)
	} else {
		assert(Array.isArray(participants) && participants.length > 0, '缺少分摊明细')
		const seen = new Set()
		let sum = 0
		for (const p of participants) {
			assert(p && memberIds.has(p.member_id), '分摊人不是账本成员')
			assert(!seen.has(p.member_id), '分摊人重复')
			seen.add(p.member_id)
			assert(Number.isInteger(p.amount) && p.amount > 0, '分摊金额不合法')
			sum += p.amount
		}
		assert(sum === amount, '分摊金额合计需等于总金额')
		parts = participants.map(p => ({ member_id: p.member_id, amount: p.amount }))
	}
	return { splitType, parts }
}

/** 读取用户的微信身份资料（头像昵称） */
async function readProfile(uid) {
	const res = await db.collection('uni-id-users').doc(uid).field({ nickname: true, avatar: true }).get()
	const user = (res.data && res.data[0]) || {}
	return { nickname: (user.nickname || '').trim(), avatar: user.avatar || '' }
}

/** UGC 文本安全检测（微信 msgSecCheck）：明确违规才拦截，接口异常放行 */
async function ensureTextSafe(uid, texts, scene = 2) {
	const content = (texts || []).filter(t => typeof t === 'string' && t.trim()).join('\n')
	if (!content) return
	const res = await db.collection('uni-id-users').doc(uid).field({ wx_openid: true }).get()
	const user = (res.data && res.data[0]) || {}
	const openid = user.wx_openid && user.wx_openid.mp
	const ok = await checkText(content, openid, scene)
	if (!ok) fail('CONTENT_RISKY', '内容含违规信息，请修改后重试')
}

/**
 * 身份识别以微信资料为主：优先用个人资料里的头像昵称；
 * 未设置过资料时退回到传入的昵称（和可选头像），并顺手存为资料供后续账本复用。
 */
async function resolveIdentity(uid, fallbackNickname, fallbackAvatar) {
	const profile = await readProfile(uid)
	if (profile.nickname) return profile
	if (typeof fallbackNickname === 'string' && fallbackNickname.trim()) {
		const nickname = cleanText(fallbackNickname, '你的昵称')
		await ensureTextSafe(uid, [nickname], 1)
		const data = { nickname }
		if (typeof fallbackAvatar === 'string' && fallbackAvatar && fallbackAvatar.length < 512) {
			data.avatar = fallbackAvatar
		}
		await db.collection('uni-id-users').doc(uid).update(data)
		return { nickname, avatar: data.avatar || profile.avatar }
	}
	fail('PROFILE_REQUIRED', '请先设置你的头像和昵称')
}

/**
 * 支付宝云的存储 fileID 是 cloud:// 协议，<image> 渲染不了。
 * 数据库始终存 fileID，读取时批量换成临时 https 地址。
 * 返回映射函数：fileID → 可渲染地址（转换失败返回空串，前端会退回占位符）。
 */
async function toDisplayURLs(fileIDs) {
	const ids = [...new Set((fileIDs || []).filter(f => typeof f === 'string' && f.startsWith('cloud://')))]
	const map = {}
	if (ids.length) {
		try {
			const res = await uniCloud.getTempFileURL({ fileList: ids })
			for (const item of res.fileList || []) {
				if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL
			}
		} catch (e) {
			console.error('getTempFileURL 失败', e)
		}
	}
	return fileID => {
		if (!fileID) return ''
		if (map[fileID]) return map[fileID]
		return fileID.startsWith('cloud://') ? '' : fileID
	}
}

/** 确保当日参考汇率缓存就绪（东八区按天缓存），返回 { date, toCny } */
async function ensureFxRates() {
	const dayKey = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
	const cacheCol = db.collection('sys-cache')
	try {
		const res = await cacheCol.doc('fx_rates').get()
		const cached = res.data && res.data[0]
		if (cached && cached.date === dayKey && cached.toCny) {
			return { date: cached.date, toCny: cached.toCny }
		}
	} catch (e) {
		// 缓存未建等情况，走拉取
	}
	const fresh = await fetchDailyRates()
	await cacheCol.doc('fx_rates').set({
		date: dayKey,
		source: fresh.source,
		toCny: fresh.toCny,
		updated_at: Date.now()
	})
	return { date: dayKey, toCny: fresh.toCny }
}

/** 账本的币种→汇率映射（1 外币 = rate 人民币），主币种人民币恒为 1 */
function ledgerRateMap(ledger) {
	const map = { CNY: 1 }
	for (const c of ledger.currencies || []) {
		map[c.code] = c.rate
	}
	return map
}

/** 原币最小单位 → 人民币分 */
function toCnyAmount(amount, rate) {
	return Math.round(amount * rate)
}

function publicMembers(ledger, uid) {
	return (ledger.members || []).map(m => ({
		id: m.id,
		nickname: m.nickname,
		avatar: m.avatar || '',
		claimed: !!m.uid,
		is_me: !!uid && m.uid === uid,
		is_owner: !!m.uid && m.uid === ledger.creator_uid
	}))
}

module.exports = {
	_before: async function() {
		const clientInfo = this.getClientInfo()
		// 定时保温触发（来源 timing）不携带用户身份，跳过鉴权
		if (clientInfo.source === 'timing') return
		this.uniIdCommon = uniIdCommon.createInstance({ clientInfo })
		const token = this.getUniIdToken()
		if (!token) {
			fail('uni-id-check-token-failed', '未登录，请先登录')
		}
		const payload = await this.uniIdCommon.checkToken(token)
		if (payload.errCode) {
			fail(payload.errCode, payload.errMsg || '登录状态校验失败，请重新进入')
		}
		this.uid = payload.uid
		// checkToken 临近过期会返回新 token，透传给客户端续期
		this.newToken = payload.token ? { token: payload.token, tokenExpired: payload.tokenExpired } : null
	},

	_after: function(error, result) {
		if (error) {
			// 业务错误（带 errCode）转为返回值：客户端 importObject 对非 0 errCode
			// 会自动还原为异常并携带 errMsg；避免被平台的异常序列化吞掉信息
			if (error.errCode) {
				return { errCode: error.errCode, errMsg: error.errMsg || error.message || '操作失败' }
			}
			throw error // 真正的程序异常继续抛出，日志里保留堆栈
		}
		if (this.newToken && result && typeof result === 'object') {
			result.newToken = this.newToken
		}
		return result
	},

	/** 定时保温：每 5 分钟被 timer 触发一次（见 package.json），防止免费实例冷启动；顺带 ping 数据库、保证当日汇率就绪 */
	async _timing() {
		await db.collection('ledgers').limit(1).get()
		try {
			await ensureFxRates()
		} catch (e) {
			console.error('保温时刷新汇率失败', e)
		}
		return 'warm'
	},

	/** 当日参考汇率（1 外币 = X 人民币），仅作账本设置汇率时的默认参考 */
	async getFxRates() {
		const { date, toCny } = await ensureFxRates()
		return { errCode: 0, date, rates: toCny }
	},

	/** 意见反馈：身份绑定 + 每人每日限 3 条 + 内容安全检测，入库供控制台查看 */
	async addFeedback({ content } = {}) {
		assert(typeof content === 'string' && content.trim().length > 0, '写点什么再提交吧')
		content = content.trim()
		assert(content.length <= 500, '反馈内容不能超过 500 字')
		const dayKey = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
		const countRes = await db.collection('feedbacks').where({ uid: this.uid, day: dayKey }).count()
		assert(countRes.total < 3, '今天的反馈已达上限，明天再来吧', 'FEEDBACK_LIMIT')
		await ensureTextSafe(this.uid, [content])
		const profile = await readProfile(this.uid)
		const clientInfo = this.getClientInfo()
		await db.collection('feedbacks').add({
			uid: this.uid,
			nickname: profile.nickname || '',
			content,
			day: dayKey,
			platform: clientInfo.uniPlatform || '',
			app_version: clientInfo.appVersion || '',
			create_date: Date.now()
		})
		return { errCode: 0 }
	},

	/** 我的微信身份资料（头像转换成可渲染地址） */
	async getMyProfile() {
		const profile = await readProfile(this.uid)
		const toURL = await toDisplayURLs([profile.avatar])
		profile.avatar = toURL(profile.avatar)
		return { errCode: 0, profile }
	},

	/** 更新头像昵称，并同步到我在所有账本里的成员条目 */
	async updateMyProfile({ nickname, avatar } = {}) {
		const data = {}
		if (nickname !== undefined) {
			data.nickname = cleanText(nickname, '昵称')
		}
		if (avatar !== undefined) {
			assert(typeof avatar === 'string' && avatar.length < 512, '头像不合法')
			data.avatar = avatar
		}
		assert(Object.keys(data).length > 0, '没有要更新的内容')
		if (data.nickname) {
			await ensureTextSafe(this.uid, [data.nickname], 1)
		}
		await db.collection('uni-id-users').doc(this.uid).update(data)
		const res = await db.collection('ledgers').where({ 'members.uid': this.uid }).limit(100).get()
		for (const ledger of res.data) {
			const members = (ledger.members || []).map(m => (m.uid === this.uid ? { ...m, ...data } : m))
			await db.collection('ledgers').doc(ledger._id).update({ members })
		}
		return { errCode: 0 }
	},

	/** 新建账本，创建者自动成为第一个成员 */
	async createLedger({ title, icon, nickname } = {}) {
		title = cleanText(title, '账本名称')
		if (QUOTA_ENABLED) {
			const [countRes, userRes] = await Promise.all([
				db.collection('ledgers').where({ creator_uid: this.uid, status: 0 }).count(),
				db.collection('uni-id-users').doc(this.uid).field({ extra_ledger_quota: true }).get()
			])
			const extra = ((userRes.data && userRes.data[0]) || {}).extra_ledger_quota || 0
			assert(countRes.total < FREE_LEDGER_QUOTA + extra, '进行中的账本已达上限', 'QUOTA_EXCEEDED')
		}
		await ensureTextSafe(this.uid, [title])
		const identity = await resolveIdentity(this.uid, nickname)
		const now = Date.now()
		const res = await db.collection('ledgers').add({
			title,
			icon: typeof icon === 'string' && icon ? icon : '🧾',
			creator_uid: this.uid,
			status: 0,
			members: [{ id: genMemberId(), uid: this.uid, nickname: identity.nickname, avatar: identity.avatar }],
			currencies: [],
			expense_count: 0,
			total_amount: 0,
			create_date: now,
			update_date: now
		})
		return { errCode: 0, ledgerId: res.id }
	},

	/** 我参与的账本列表 */
	async listMyLedgers() {
		const res = await db.collection('ledgers')
			.where({ 'members.uid': this.uid })
			.orderBy('update_date', 'desc')
			.limit(50)
			.get()
		const list = res.data.map(l => ({
			_id: l._id,
			title: l.title,
			icon: l.icon,
			status: l.status,
			member_count: (l.members || []).length,
			expense_count: l.expense_count || 0,
			total_amount: l.total_amount || 0,
			create_date: l.create_date,
			update_date: l.update_date,
			is_creator: l.creator_uid === this.uid
		}))
		return { errCode: 0, list }
	},

	/**
	 * 看完激励视频后 +1 账本额度（每日限次防刷）。
	 * 接入流量主后，由客户端在激励视频 onClose 且 ended=true 时调用。
	 */
	async grantAdQuota() {
		// 按东八区日期做每日计数
		const dayKey = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
		const res = await db.collection('uni-id-users').doc(this.uid)
			.field({ ad_quota_date: true, ad_quota_count: true, extra_ledger_quota: true })
			.get()
		const user = (res.data && res.data[0]) || {}
		const usedToday = user.ad_quota_date === dayKey ? (user.ad_quota_count || 0) : 0
		assert(usedToday < AD_QUOTA_DAILY_LIMIT, '今天的额度已用完，明天再来吧', 'AD_QUOTA_LIMIT')
		await db.collection('uni-id-users').doc(this.uid).update({
			ad_quota_date: dayKey,
			ad_quota_count: usedToday + 1,
			extra_ledger_quota: dbCmd.inc(1)
		})
		return { errCode: 0, extraQuota: (user.extra_ledger_quota || 0) + 1 }
	},

	/** 编辑账本信息（名称/封面/币种与汇率）。仅创建者；汇率变化后全账本按新汇率重算合计 */
	async updateLedger({ ledgerId, title, icon, currencies } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(ledger.creator_uid === this.uid, '只有账本创建者可以修改', 'FORBIDDEN')
		title = cleanText(title, '账本名称')
		await ensureTextSafe(this.uid, [title])

		const data = {
			title,
			icon: typeof icon === 'string' && icon ? icon : ledger.icon,
			update_date: Date.now()
		}

		if (Array.isArray(currencies)) {
			const seen = new Set()
			const clean = []
			for (const c of currencies) {
				assert(c && SUPPORTED.includes(c.code), '存在不支持的币种')
				assert(!seen.has(c.code), '币种重复')
				seen.add(c.code)
				const rate = Number(c.rate)
				assert(Number.isFinite(rate) && rate > 0 && rate <= 100000, `${c.code} 的汇率不合法`)
				clean.push({ code: c.code, rate: Number(rate.toFixed(4)) })
			}
			// 已有账目的外币不能停用，否则历史账目无法折算
			const used = await db.collection('expenses')
				.where({ ledger_id: ledger._id })
				.field({ currency: true })
				.limit(1000)
				.get()
			for (const e of used.data) {
				if (e.currency && e.currency !== 'CNY' && !seen.has(e.currency)) {
					fail('CURRENCY_IN_USE', `${e.currency} 已有账目，不能停用该币种`)
				}
			}
			data.currencies = clean
		}

		await db.collection('ledgers').doc(ledger._id).update(data)

		// 币种/汇率有变动时，按新汇率口径重算账本合计（低频操作，全量重算保证一致）
		if (data.currencies) {
			const all = await db.collection('expenses')
				.where({ ledger_id: ledger._id })
				.field({ amount: true, currency: true })
				.limit(1000)
				.get()
			const rates = { CNY: 1 }
			for (const c of data.currencies) rates[c.code] = c.rate
			let total = 0
			for (const e of all.data) {
				total += toCnyAmount(e.amount, rates[e.currency || 'CNY'] || 1)
			}
			await db.collection('ledgers').doc(ledger._id).update({ total_amount: total })
		}
		return { errCode: 0 }
	},

	/** 删除账本及其全部账目。仅创建者，不可恢复 */
	async deleteLedger({ ledgerId } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(ledger.creator_uid === this.uid, '只有账本创建者可以删除', 'FORBIDDEN')
		await db.collection('expenses').where({ ledger_id: ledger._id }).remove()
		await db.collection('ledgers').doc(ledger._id).remove()
		return { errCode: 0 }
	},

	/**
	 * 账本详情。非成员（从分享进来）只返回基本信息和成员名单用于加入/认领；
	 * 成员返回账目、每人净额和转账方案。
	 */
	async getLedger({ ledgerId } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		const me = findMemberByUid(ledger, this.uid)
		const toURL = await toDisplayURLs((ledger.members || []).map(m => m.avatar))
		const baseInfo = {
			_id: ledger._id,
			title: ledger.title,
			icon: ledger.icon,
			status: ledger.status,
			expense_count: ledger.expense_count || 0,
			total_amount: ledger.total_amount || 0,
			currencies: ledger.currencies || [],
			members: publicMembers(ledger, this.uid).map(m => ({ ...m, avatar: toURL(m.avatar) }))
		}
		if (!me) {
			return { errCode: 0, isMember: false, ledger: baseInfo }
		}
		const expRes = await db.collection('expenses')
			.where({ ledger_id: ledger._id })
			.orderBy('create_date', 'desc')
			.limit(200)
			.get()
		// 读取时统一折算：账目存原币，按账本当前锁定汇率折成人民币分，结算全在人民币域进行
		const rates = ledgerRateMap(ledger)
		const converted = expRes.data.map(e => {
			const cur = e.currency || 'CNY'
			const rate = rates[cur] !== undefined ? rates[cur] : 1
			const amountCny = toCnyAmount(e.amount, rate)
			const partsCny = cur === 'CNY' ? e.participants : convertPartsToCny(amountCny, e.participants, e.payer_member_id)
			return { raw: e, cur, rate, amountCny, partsCny }
		})
		const balances = calcBalances(
			ledger.members,
			converted.map(x => ({ payer_member_id: x.raw.payer_member_id, amount: x.amountCny, participants: x.partsCny }))
		)
		const transfers = calcTransfers(balances, SETTLE_DUST)
		// 有被抹平的尾差时告知前端展示说明
		const hasDust = [...balances.values()].some(v => v !== 0 && Math.abs(v) <= SETTLE_DUST)
		return {
			errCode: 0,
			isMember: true,
			myMemberId: me.id,
			isCreator: ledger.creator_uid === this.uid,
			ledger: baseInfo,
			expenses: converted.map(x => ({
				_id: x.raw._id,
				kind: x.raw.kind || 'expense',
				title: x.raw.title,
				currency: x.cur,
				rate: x.rate,
				amount: x.raw.amount,       // 原币最小单位
				amount_cny: x.amountCny,    // 人民币分（列表与结算口径）
				payer_member_id: x.raw.payer_member_id,
				participants: x.partsCny,   // 每人份额（人民币分，守恒折算）
				participants_original: x.raw.participants, // 原币份额（编辑自定义分摊时回填用）
				split_type: x.raw.split_type,
				expense_date: x.raw.expense_date,
				create_date: x.raw.create_date,
				can_delete: x.raw.creator_uid === this.uid || ledger.creator_uid === this.uid
			})),
			balances: [...balances].map(([member_id, amount]) => ({ member_id, amount })),
			transfers,
			hasDust
		}
	},

	/** 以新成员身份加入（分享链接进来）。已是成员则直接返回 */
	async joinLedger({ ledgerId, nickname, avatar } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		const existing = findMemberByUid(ledger, this.uid)
		if (existing) {
			return { errCode: 0, memberId: existing.id, already: true }
		}
		assert((ledger.members || []).length < MAX_MEMBERS, `账本成员已达上限${MAX_MEMBERS}人`)
		const identity = await resolveIdentity(this.uid, nickname, avatar)
		const member = { id: genMemberId(), uid: this.uid, nickname: identity.nickname, avatar: identity.avatar }
		await db.collection('ledgers').doc(ledgerId).update({
			members: dbCmd.push([member]),
			update_date: Date.now()
		})
		return { errCode: 0, memberId: member.id }
	},

	/** 认领虚拟成员：把创建者代记的“我”绑定到自己的账号 */
	async claimMember({ ledgerId, memberId } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(!findMemberByUid(ledger, this.uid), '你已经是该账本成员，无法再认领', 'ALREADY_MEMBER')
		const members = ledger.members || []
		const idx = members.findIndex(m => m.id === memberId)
		assert(idx >= 0, '要认领的成员不存在', 'NOT_FOUND')
		assert(!members[idx].uid, '该成员已被其他人认领', 'ALREADY_CLAIMED')
		members[idx].uid = this.uid
		// 已设置微信资料的，认领后统一以微信身份显示
		const profile = await readProfile(this.uid)
		if (profile.nickname) {
			members[idx].nickname = profile.nickname
			members[idx].avatar = profile.avatar
		}
		await db.collection('ledgers').doc(ledgerId).update({
			members,
			update_date: Date.now()
		})
		return { errCode: 0, memberId }
	},

	/** 添加虚拟成员（帮还没进小程序的朋友先记上） */
	async addVirtualMember({ ledgerId, nickname } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(findMemberByUid(ledger, this.uid), '你不是该账本成员', 'NOT_MEMBER')
		assert((ledger.members || []).length < MAX_MEMBERS, `账本成员已达上限${MAX_MEMBERS}人`)
		nickname = cleanText(nickname, '成员昵称')
		await ensureTextSafe(this.uid, [nickname], 1)
		const member = { id: genMemberId(), uid: null, nickname }
		await db.collection('ledgers').doc(ledgerId).update({
			members: dbCmd.push([member]),
			update_date: Date.now()
		})
		return { errCode: 0, memberId: member.id }
	},

	/** 修改虚拟成员昵称（仅创建者；真实成员的昵称由其微信身份决定） */
	async renameMember({ ledgerId, memberId, nickname } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(ledger.creator_uid === this.uid, '只有账本创建者可以修改成员', 'FORBIDDEN')
		assert(ledger.status !== 1, '账本已结清，可在管理页重新打开后再改动', 'LEDGER_SETTLED')
		nickname = cleanText(nickname, '成员昵称')
		await ensureTextSafe(this.uid, [nickname], 1)
		const members = ledger.members || []
		const idx = members.findIndex(m => m.id === memberId)
		assert(idx >= 0, '成员不存在', 'NOT_FOUND')
		assert(!members[idx].uid, '真实成员的昵称由本人的微信身份决定，不能修改')
		members[idx].nickname = nickname
		await db.collection('ledgers').doc(ledgerId).update({
			members,
			update_date: Date.now()
		})
		return { errCode: 0 }
	},

	/** 移除成员（仅创建者；成员必须没有任何账目牵连，创建者本人不可移除） */
	async removeMember({ ledgerId, memberId } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(ledger.creator_uid === this.uid, '只有账本创建者可以移除成员', 'FORBIDDEN')
		assert(ledger.status !== 1, '账本已结清，可在管理页重新打开后再改动', 'LEDGER_SETTLED')
		const members = ledger.members || []
		const idx = members.findIndex(m => m.id === memberId)
		assert(idx >= 0, '成员不存在', 'NOT_FOUND')
		assert(!members[idx].uid || members[idx].uid !== ledger.creator_uid, '创建者不能被移除')
		// 有任何账目牵连（垫付过或参与过分摊）都不能移除，保护账目完整。
		// 不用嵌套数组的点路径查询（部分云厂商支持不稳），拉出来在代码里判断
		const refRes = await db.collection('expenses')
			.where({ ledger_id: ledger._id })
			.field({ payer_member_id: true, participants: true })
			.limit(1000)
			.get()
		const inUse = (refRes.data || []).some(e =>
			e.payer_member_id === memberId ||
			(e.participants || []).some(p => p && p.member_id === memberId)
		)
		assert(!inUse, '该成员已有账目牵连，不能移除', 'MEMBER_IN_USE')
		members.splice(idx, 1)
		await db.collection('ledgers').doc(ledgerId).update({
			members,
			update_date: Date.now()
		})
		return { errCode: 0 }
	},

	/**
	 * 记一笔。
	 * equal：传 participantMemberIds，服务端均摊（余数分给靠前的人）；
	 * custom：传 participants: [{ member_id, amount(分) }]，合计必须等于总金额。
	 */
	async addExpense({ ledgerId, title, amount, currency, payerMemberId, participantMemberIds, splitType, participants, expenseDate } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(findMemberByUid(ledger, this.uid), '你不是该账本成员', 'NOT_MEMBER')
		assert(ledger.status !== 1, '账本已结清，可在管理页重新打开后再记账', 'LEDGER_SETTLED')
		title = cleanText(title, '账目标题')
		await ensureTextSafe(this.uid, [title])
		currency = typeof currency === 'string' && currency ? currency : 'CNY'
		const rates = ledgerRateMap(ledger)
		assert(rates[currency] !== undefined, '该币种未在账本中启用')
		const { splitType: type, parts } = buildParticipants(ledger, {
			amount, payerMemberId, participantMemberIds, splitType, participants
		})

		const now = Date.now()
		const res = await db.collection('expenses').add({
			ledger_id: ledger._id,
			title,
			amount,
			currency,
			payer_member_id: payerMemberId,
			participants: parts,
			split_type: type,
			creator_uid: this.uid,
			expense_date: Number.isFinite(expenseDate) ? expenseDate : now,
			create_date: now
		})
		await db.collection('ledgers').doc(ledger._id).update({
			expense_count: dbCmd.inc(1),
			total_amount: dbCmd.inc(toCnyAmount(amount, rates[currency])),
			update_date: now
		})
		return { errCode: 0, expenseId: res.id }
	},

	/** 改一笔。仅记账人或账本创建者可改；合计按当前汇率口径增量修正 */
	async updateExpense({ expenseId, title, amount, currency, payerMemberId, participantMemberIds, splitType, participants, expenseDate } = {}) {
		assert(typeof expenseId === 'string' && expenseId.length > 0, '缺少账目ID')
		const res = await db.collection('expenses').doc(expenseId).get()
		const expense = res.data && res.data[0]
		assert(expense, '账目不存在或已删除', 'NOT_FOUND')
		const ledger = await mustGetLedger(expense.ledger_id)
		assert(findMemberByUid(ledger, this.uid), '你不是该账本成员', 'NOT_MEMBER')
		assert(
			expense.creator_uid === this.uid || ledger.creator_uid === this.uid,
			'只有记账人或账本创建者可以修改',
			'FORBIDDEN'
		)
		assert(ledger.status !== 1, '账本已结清，可在管理页重新打开后再修改', 'LEDGER_SETTLED')
		assert(expense.kind !== 'repayment', '转账记录不支持修改，可删除后重新标记')
		title = cleanText(title, '账目标题')
		await ensureTextSafe(this.uid, [title])
		currency = typeof currency === 'string' && currency ? currency : 'CNY'
		const rates = ledgerRateMap(ledger)
		assert(rates[currency] !== undefined, '该币种未在账本中启用')
		const { splitType: type, parts } = buildParticipants(ledger, {
			amount, payerMemberId, participantMemberIds, splitType, participants
		})

		// 新旧两笔都按当前账本汇率折算，与合计的当前口径保持一致
		const oldCny = toCnyAmount(expense.amount, rates[expense.currency || 'CNY'] || 1)
		const newCny = toCnyAmount(amount, rates[currency])

		const now = Date.now()
		await db.collection('expenses').doc(expenseId).update({
			title,
			amount,
			currency,
			payer_member_id: payerMemberId,
			participants: parts,
			split_type: type,
			expense_date: Number.isFinite(expenseDate) ? expenseDate : (expense.expense_date || now)
		})
		await db.collection('ledgers').doc(ledger._id).update({
			total_amount: dbCmd.inc(newCny - oldCny),
			update_date: now
		})
		return { errCode: 0 }
	},

	/**
	 * 标记一笔转账已完成：写入转账记录（人民币口径），作为负向流水参与净额抵消，
	 * 不计入消费合计。只有转账双方本人或创建者可标记。
	 */
	async addRepayment({ ledgerId, fromMemberId, toMemberId, amount } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		const me = findMemberByUid(ledger, this.uid)
		assert(me, '你不是该账本成员', 'NOT_MEMBER')
		assert(ledger.status !== 1, '账本已结清', 'LEDGER_SETTLED')
		assert(Number.isInteger(amount) && amount > 0 && amount <= MAX_AMOUNT, '金额不合法')
		const ids = new Set((ledger.members || []).map(m => m.id))
		assert(ids.has(fromMemberId) && ids.has(toMemberId) && fromMemberId !== toMemberId, '成员不合法')
		assert(
			me.id === fromMemberId || me.id === toMemberId || ledger.creator_uid === this.uid,
			'只有转账双方或账本创建者可以标记',
			'FORBIDDEN'
		)
		const now = Date.now()
		await db.collection('expenses').add({
			ledger_id: ledger._id,
			kind: 'repayment',
			title: '转账',
			amount,
			currency: 'CNY',
			payer_member_id: fromMemberId,
			participants: [{ member_id: toMemberId, amount }],
			split_type: 'custom',
			creator_uid: this.uid,
			expense_date: now,
			create_date: now
		})
		await db.collection('ledgers').doc(ledger._id).update({ update_date: now })
		return { errCode: 0 }
	},

	/** 标记账本结清（仅创建者，且所有净额都已在尾差范围内） */
	async settleLedger({ ledgerId } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(ledger.creator_uid === this.uid, '只有账本创建者可以标记结清', 'FORBIDDEN')
		assert(ledger.status !== 1, '账本已是结清状态')
		const expRes = await db.collection('expenses').where({ ledger_id: ledger._id }).limit(1000).get()
		const rates = ledgerRateMap(ledger)
		const cnyExpenses = expRes.data.map(e => {
			const rate = rates[e.currency || 'CNY'] !== undefined ? rates[e.currency || 'CNY'] : 1
			const amountCny = toCnyAmount(e.amount, rate)
			const parts = (e.currency || 'CNY') === 'CNY'
				? e.participants
				: convertPartsToCny(amountCny, e.participants, e.payer_member_id)
			return { payer_member_id: e.payer_member_id, amount: amountCny, participants: parts }
		})
		const balances = calcBalances(ledger.members, cnyExpenses)
		const unsettled = [...balances.values()].some(v => Math.abs(v) > SETTLE_DUST)
		assert(!unsettled, '还有待转账的款项，全部转清后才能标记结清', 'NOT_SETTLED')
		await db.collection('ledgers').doc(ledger._id).update({
			status: 1,
			settle_date: Date.now(),
			update_date: Date.now()
		})
		return { errCode: 0 }
	},

	/** 重新打开已结清的账本（仅创建者） */
	async reopenLedger({ ledgerId } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(ledger.creator_uid === this.uid, '只有账本创建者可以重新打开', 'FORBIDDEN')
		await db.collection('ledgers').doc(ledger._id).update({ status: 0, update_date: Date.now() })
		return { errCode: 0 }
	},

	/** 删一笔。仅记账人或账本创建者可删 */
	async deleteExpense({ expenseId } = {}) {
		assert(typeof expenseId === 'string' && expenseId.length > 0, '缺少账目ID')
		const res = await db.collection('expenses').doc(expenseId).get()
		const expense = res.data && res.data[0]
		assert(expense, '账目不存在或已删除', 'NOT_FOUND')
		const ledger = await mustGetLedger(expense.ledger_id)
		assert(findMemberByUid(ledger, this.uid), '你不是该账本成员', 'NOT_MEMBER')
		assert(
			expense.creator_uid === this.uid || ledger.creator_uid === this.uid,
			'只有记账人或账本创建者可以删除',
			'FORBIDDEN'
		)
		assert(ledger.status !== 1, '账本已结清，可在管理页重新打开后再改动', 'LEDGER_SETTLED')
		await db.collection('expenses').doc(expenseId).remove()
		// 转账记录不计入消费合计，删除时也不回退计数
		if (expense.kind === 'repayment') {
			await db.collection('ledgers').doc(ledger._id).update({ update_date: Date.now() })
		} else {
			const rates = ledgerRateMap(ledger)
			const cny = toCnyAmount(expense.amount, rates[expense.currency || 'CNY'] || 1)
			await db.collection('ledgers').doc(ledger._id).update({
				expense_count: dbCmd.inc(-1),
				total_amount: dbCmd.inc(-cny),
				update_date: Date.now()
			})
		}
		return { errCode: 0 }
	}
}
