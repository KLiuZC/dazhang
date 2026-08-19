'use strict'

/**
 * 结算核心算法。全部以整数「分」运算，杜绝浮点误差。
 */

/**
 * 均摊：把 amount（分）分给 memberIds，余数（不足每人一分的部分）
 * 从前往后每人多摊 1 分，保证合计严格等于 amount。
 */
function splitEqually(amount, memberIds) {
	const n = memberIds.length
	const base = Math.floor(amount / n)
	const remainder = amount - base * n
	return memberIds.map((id, idx) => ({
		member_id: id,
		amount: base + (idx < remainder ? 1 : 0)
	}))
}

/**
 * 计算每个成员的净余额：垫付合计 - 分摊合计。
 * 正数 = 应收，负数 = 应付。所有成员余额之和恒为 0。
 * @returns Map<member_id, 余额(分)>
 */
function calcBalances(members, expenses) {
	const balances = new Map()
	for (const m of members) {
		balances.set(m.id, 0)
	}
	for (const e of expenses) {
		balances.set(e.payer_member_id, (balances.get(e.payer_member_id) || 0) + e.amount)
		for (const p of e.participants) {
			balances.set(p.member_id, (balances.get(p.member_id) || 0) - p.amount)
		}
	}
	return balances
}

/**
 * 由净余额生成转账方案：欠得最多的人还给应收最多的人，逐一抵消。
 * 贪心结果保证转账笔数 ≤ 成员数-1（严格最少笔数是 NP-hard，贪心已足够好）。
 * @returns [{ from: member_id, to: member_id, amount(分) }]
 */
function calcTransfers(balances) {
	const creditors = []
	const debtors = []
	for (const [id, v] of balances) {
		if (v > 0) creditors.push({ id, v })
		else if (v < 0) debtors.push({ id, v: -v })
	}
	creditors.sort((a, b) => b.v - a.v)
	debtors.sort((a, b) => b.v - a.v)

	const transfers = []
	let i = 0
	let j = 0
	while (i < debtors.length && j < creditors.length) {
		const pay = Math.min(debtors[i].v, creditors[j].v)
		transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: pay })
		debtors[i].v -= pay
		creditors[j].v -= pay
		if (debtors[i].v === 0) i++
		if (creditors[j].v === 0) j++
	}
	return transfers
}

module.exports = {
	splitEqually,
	calcBalances,
	calcTransfers
}
