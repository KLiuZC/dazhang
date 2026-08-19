'use strict'

/**
 * 搭账核心云对象。
 * 客户端不直连数据库（schema permission 全部 false），所有读写经过这里，
 * 权限规则（是否账本成员、谁能删账等）在代码里集中校验。
 */
const uniIdCommon = require('uni-id-common')
const { splitEqually, calcBalances, calcTransfers } = require('./settle')
const { checkText } = require('./wx-sec')

const db = uniCloud.database()
const dbCmd = db.command

const MAX_MEMBERS = 50
const MAX_TEXT_LEN = 30
const MAX_AMOUNT = 100000000 // 单笔上限 100 万元（分）

// 账本配额：上线初期不限制（开关关闭）。启用时把 QUOTA_ENABLED 改为 true 并重新上传即可，
// 届时：进行中账本数 ≤ 免费额度 + 用户通过看广告等方式获得的 extra_ledger_quota
const QUOTA_ENABLED = false
const FREE_LEDGER_QUOTA = 3
const AD_QUOTA_DAILY_LIMIT = 5 // 每日看广告加额度的上限，防刷

function fail(errCode, errMsg) {
	throw { errCode, errMsg }
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
		parts = splitEqually(amount, unique)
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
 * 未设置过资料时退回到传入的昵称，并顺手存为资料供后续账本复用。
 */
async function resolveIdentity(uid, fallbackNickname) {
	const profile = await readProfile(uid)
	if (profile.nickname) return profile
	if (typeof fallbackNickname === 'string' && fallbackNickname.trim()) {
		const nickname = cleanText(fallbackNickname, '你的昵称')
		await ensureTextSafe(uid, [nickname], 1)
		await db.collection('uni-id-users').doc(uid).update({ nickname })
		return { nickname, avatar: profile.avatar }
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

function publicMembers(ledger, uid) {
	return (ledger.members || []).map(m => ({
		id: m.id,
		nickname: m.nickname,
		avatar: m.avatar || '',
		claimed: !!m.uid,
		is_me: !!uid && m.uid === uid
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
			throw payload
		}
		this.uid = payload.uid
		// checkToken 临近过期会返回新 token，透传给客户端续期
		this.newToken = payload.token ? { token: payload.token, tokenExpired: payload.tokenExpired } : null
	},

	_after: function(error, result) {
		if (error) throw error
		if (this.newToken && result && typeof result === 'object') {
			result.newToken = this.newToken
		}
		return result
	},

	/** 定时保温：每 5 分钟被 timer 触发一次（见 package.json），防止免费实例冷启动；顺带 ping 数据库连接 */
	async _timing() {
		await db.collection('ledgers').limit(1).get()
		return 'warm'
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

	/** 编辑账本信息（名称/封面）。仅创建者 */
	async updateLedger({ ledgerId, title, icon } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(ledger.creator_uid === this.uid, '只有账本创建者可以修改', 'FORBIDDEN')
		title = cleanText(title, '账本名称')
		await ensureTextSafe(this.uid, [title])
		await db.collection('ledgers').doc(ledger._id).update({
			title,
			icon: typeof icon === 'string' && icon ? icon : ledger.icon,
			update_date: Date.now()
		})
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
		const expenses = expRes.data
		const balances = calcBalances(ledger.members, expenses)
		const transfers = calcTransfers(balances)
		return {
			errCode: 0,
			isMember: true,
			myMemberId: me.id,
			isCreator: ledger.creator_uid === this.uid,
			ledger: baseInfo,
			expenses: expenses.map(e => ({
				_id: e._id,
				title: e.title,
				amount: e.amount,
				payer_member_id: e.payer_member_id,
				participants: e.participants,
				split_type: e.split_type,
				expense_date: e.expense_date,
				create_date: e.create_date,
				can_delete: e.creator_uid === this.uid || ledger.creator_uid === this.uid
			})),
			balances: [...balances].map(([member_id, amount]) => ({ member_id, amount })),
			transfers
		}
	},

	/** 以新成员身份加入（分享链接进来）。已是成员则直接返回 */
	async joinLedger({ ledgerId, nickname } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		const existing = findMemberByUid(ledger, this.uid)
		if (existing) {
			return { errCode: 0, memberId: existing.id, already: true }
		}
		assert((ledger.members || []).length < MAX_MEMBERS, `账本成员已达上限${MAX_MEMBERS}人`)
		const identity = await resolveIdentity(this.uid, nickname)
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

	/**
	 * 记一笔。
	 * equal：传 participantMemberIds，服务端均摊（余数分给靠前的人）；
	 * custom：传 participants: [{ member_id, amount(分) }]，合计必须等于总金额。
	 */
	async addExpense({ ledgerId, title, amount, payerMemberId, participantMemberIds, splitType, participants, expenseDate } = {}) {
		const ledger = await mustGetLedger(ledgerId)
		assert(findMemberByUid(ledger, this.uid), '你不是该账本成员', 'NOT_MEMBER')
		title = cleanText(title, '账目标题')
		await ensureTextSafe(this.uid, [title])
		const { splitType: type, parts } = buildParticipants(ledger, {
			amount, payerMemberId, participantMemberIds, splitType, participants
		})

		const now = Date.now()
		const res = await db.collection('expenses').add({
			ledger_id: ledger._id,
			title,
			amount,
			payer_member_id: payerMemberId,
			participants: parts,
			split_type: type,
			creator_uid: this.uid,
			expense_date: Number.isFinite(expenseDate) ? expenseDate : now,
			create_date: now
		})
		await db.collection('ledgers').doc(ledger._id).update({
			expense_count: dbCmd.inc(1),
			total_amount: dbCmd.inc(amount),
			update_date: now
		})
		return { errCode: 0, expenseId: res.id }
	},

	/** 改一笔。仅记账人或账本创建者可改；金额差额同步进账本合计 */
	async updateExpense({ expenseId, title, amount, payerMemberId, participantMemberIds, splitType, participants, expenseDate } = {}) {
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
		title = cleanText(title, '账目标题')
		await ensureTextSafe(this.uid, [title])
		const { splitType: type, parts } = buildParticipants(ledger, {
			amount, payerMemberId, participantMemberIds, splitType, participants
		})

		const now = Date.now()
		await db.collection('expenses').doc(expenseId).update({
			title,
			amount,
			payer_member_id: payerMemberId,
			participants: parts,
			split_type: type,
			expense_date: Number.isFinite(expenseDate) ? expenseDate : (expense.expense_date || now)
		})
		await db.collection('ledgers').doc(ledger._id).update({
			total_amount: dbCmd.inc(amount - expense.amount),
			update_date: now
		})
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
		await db.collection('expenses').doc(expenseId).remove()
		await db.collection('ledgers').doc(ledger._id).update({
			expense_count: dbCmd.inc(-1),
			total_amount: dbCmd.inc(-expense.amount),
			update_date: Date.now()
		})
		return { errCode: 0 }
	}
}
