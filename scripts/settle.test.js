'use strict'
// 结算算法自测：node scripts/settle.test.js
const { splitEqually, calcBalances, calcTransfers, convertPartsToCny } = require('../uniCloud-alipay/cloudfunctions/ledger-service/settle.js')

let passed = 0
let failed = 0

function check(name, cond) {
	if (cond) {
		passed++
	} else {
		failed++
		console.error('  ✗ FAIL:', name)
	}
}

function sum(arr, key) {
	return arr.reduce((s, x) => s + x[key], 0)
}

// —— splitEqually：合计恒等于总额，余数从前往后每人 +1 分 ——
{
	const parts = splitEqually(10000, ['a', 'b', 'c']) // 100元 3人
	check('均摊合计=总额', sum(parts, 'amount') === 10000)
	check('均摊余数分布', parts[0].amount === 3334 && parts[1].amount === 3333 && parts[2].amount === 3333)

	const p2 = splitEqually(1, ['a', 'b', 'c']) // 极端:1分3人
	check('1分3人合计仍=1', sum(p2, 'amount') === 1 && p2[0].amount === 1)

	// 随机压测 2000 组
	let ok = true
	for (let i = 0; i < 2000; i++) {
		const n = 1 + Math.floor(Math.random() * 20)
		const amt = 1 + Math.floor(Math.random() * 10000000)
		const ids = Array.from({ length: n }, (_, k) => 'm' + k)
		const ps = splitEqually(amt, ids)
		if (sum(ps, 'amount') !== amt) { ok = false; break }
		if (Math.max(...ps.map(p => p.amount)) - Math.min(...ps.map(p => p.amount)) > 1) { ok = false; break }
	}
	check('均摊随机压测2000组：合计守恒且最大差1分', ok)
}

// —— calcBalances + calcTransfers ——
{
	// 场景：3人吃饭。A垫付300元均摊；B垫付90元只有B和C参与
	const members = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
	const expenses = [
		{ payer_member_id: 'A', amount: 30000, participants: splitEqually(30000, ['A', 'B', 'C']) },
		{ payer_member_id: 'B', amount: 9000, participants: splitEqually(9000, ['B', 'C']) }
	]
	const balances = calcBalances(members, expenses)
	const total = [...balances.values()].reduce((s, v) => s + v, 0)
	check('净余额总和为0', total === 0)
	check('A应收200元', balances.get('A') === 20000)
	check('B应付55元', balances.get('B') === -5500)
	check('C应付145元', balances.get('C') === -14500)

	const transfers = calcTransfers(balances)
	check('转账笔数≤成员数-1', transfers.length <= members.length - 1)
	// 转账后人人归零
	const after = new Map(balances)
	for (const t of transfers) {
		after.set(t.from, after.get(t.from) + t.amount)
		after.set(t.to, after.get(t.to) - t.amount)
	}
	check('执行转账后全员清零', [...after.values()].every(v => v === 0))
	check('无零额/负额转账', transfers.every(t => t.amount > 0))
}

// —— 随机压测：任意账目组合都必须守恒、清零、笔数达标 ——
{
	let ok = true
	for (let round = 0; round < 500 && ok; round++) {
		const n = 2 + Math.floor(Math.random() * 15)
		const members = Array.from({ length: n }, (_, k) => ({ id: 'm' + k }))
		const expenses = []
		const count = 1 + Math.floor(Math.random() * 30)
		for (let i = 0; i < count; i++) {
			const amt = 1 + Math.floor(Math.random() * 1000000)
			const shuffled = members.map(m => m.id).sort(() => Math.random() - 0.5)
			const takers = shuffled.slice(0, 1 + Math.floor(Math.random() * n))
			expenses.push({
				payer_member_id: shuffled[Math.floor(Math.random() * n) % shuffled.length] || shuffled[0],
				amount: amt,
				participants: splitEqually(amt, takers)
			})
		}
		const balances = calcBalances(members, expenses)
		if ([...balances.values()].reduce((s, v) => s + v, 0) !== 0) { ok = false; break }
		const transfers = calcTransfers(balances)
		if (transfers.length > n - 1) { ok = false; break }
		const after = new Map(balances)
		for (const t of transfers) {
			after.set(t.from, after.get(t.from) + t.amount)
			after.set(t.to, after.get(t.to) - t.amount)
		}
		if (![...after.values()].every(v => v === 0)) { ok = false; break }
	}
	check('结算随机压测500组：守恒/清零/笔数全部通过', ok)
}

// 全员已结清场景
{
	const members = [{ id: 'A' }, { id: 'B' }]
	const expenses = [
		{ payer_member_id: 'A', amount: 100, participants: [{ member_id: 'B', amount: 100 }] },
		{ payer_member_id: 'B', amount: 100, participants: [{ member_id: 'A', amount: 100 }] }
	]
	const transfers = calcTransfers(calcBalances(members, expenses))
	check('互相抵消时无需转账', transfers.length === 0)
}

// —— convertPartsToCny：外币份额守恒折算 ——
{
	const parts = splitEqually(2500, ['a', 'b', 'c']) // A$25.00 三人均摊
	const totalCny = Math.round(2500 * 4.7865)
	const cny = convertPartsToCny(totalCny, parts)
	check('外币折算合计守恒', sum(cny, 'amount') === totalCny)

	let ok = true
	for (let i = 0; i < 1000; i++) {
		const n = 1 + Math.floor(Math.random() * 12)
		const amt = 1 + Math.floor(Math.random() * 1000000)
		const ids = Array.from({ length: n }, (_, k) => 'm' + k)
		const ps = splitEqually(amt, ids)
		const rate = Math.random() * 10 + 0.001
		const t = Math.round(amt * rate)
		const c = convertPartsToCny(t, ps)
		if (sum(c, 'amount') !== t) { ok = false; break }
		if (c.some(x => x.amount < 0)) { ok = false; break }
	}
	check('外币折算随机压测1000组：守恒且无负值', ok)
}

// —— 尾差抹平与"余数优先给垫付人" ——
{
	const b = new Map([['A', 7180], ['B', -7179], ['C', -1]])
	const ts = calcTransfers(b, 9)
	check('≤9分的尾差净额不生成转账', ts.length === 1 && ts[0].from === 'B' && ts[0].to === 'A' && ts[0].amount === 7179)
	check('纯尾差时无需任何转账', calcTransfers(new Map([['A', 1], ['B', -1]]), 9).length === 0)

	const parts = [
		{ member_id: 'a', amount: 1000 },
		{ member_id: 'b', amount: 1000 },
		{ member_id: 'c', amount: 1000 }
	]
	const cny = convertPartsToCny(14360, parts, 'b') // 余 2 分，应从 b 开始分
	const byId = id => cny.find(p => p.member_id === id).amount
	check('折算余数优先落在垫付人头上', byId('b') === 4787 && byId('c') === 4787 && byId('a') === 4786)
	check('优先分配后合计仍守恒', byId('a') + byId('b') + byId('c') === 14360)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
