'use strict'

/**
 * 每日参考汇率（人民币基准，1 外币 = X 人民币）。
 * 免费源均为每日更新粒度；账本内实际使用的是成员商量后锁定的汇率，
 * 这里只提供设置时的「默认参考值」。多源兜底：er-api → frankfurter → jsDelivr CDN。
 */

// 产品内开放选择的外币（主币种恒为人民币 CNY，不在此列）
const SUPPORTED = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'HKD', 'TWD', 'KRW', 'THB', 'SGD', 'MYR', 'CAD', 'NZD', 'VND']

/** 把「1 CNY = v 外币」的表转成「1 外币 = X CNY」，只保留支持的币种 */
function pickToCny(ratesFromCny) {
	const toCny = {}
	for (const code of SUPPORTED) {
		const v = ratesFromCny[code]
		if (typeof v === 'number' && v > 0) {
			toCny[code] = Number((1 / v).toFixed(6))
		}
	}
	return toCny
}

async function fromErApi() {
	const resp = await uniCloud.httpclient.request('https://open.er-api.com/v6/latest/CNY', {
		dataType: 'json',
		timeout: 8000
	})
	const data = resp.data || {}
	if (data.result !== 'success' || !data.rates) throw new Error('er-api 返回异常')
	return { source: 'er-api', toCny: pickToCny(data.rates) }
}

async function fromFrankfurter() {
	const resp = await uniCloud.httpclient.request(
		`https://api.frankfurter.dev/v1/latest?base=CNY&symbols=${SUPPORTED.join(',')}`,
		{ dataType: 'json', timeout: 8000 }
	)
	const data = resp.data || {}
	if (!data.rates) throw new Error('frankfurter 返回异常')
	return { source: 'frankfurter', toCny: pickToCny(data.rates) }
}

async function fromCdn() {
	const resp = await uniCloud.httpclient.request(
		'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json',
		{ dataType: 'json', timeout: 8000 }
	)
	const data = resp.data || {}
	if (!data.cny) throw new Error('cdn 源返回异常')
	const upper = {}
	for (const k in data.cny) {
		upper[k.toUpperCase()] = data.cny[k]
	}
	return { source: 'jsdelivr', toCny: pickToCny(upper) }
}

/** 依次尝试各源，返回 { source, toCny }；至少要拿到 5 个币种才算成功 */
async function fetchDailyRates() {
	const sources = [fromErApi, fromFrankfurter, fromCdn]
	let lastErr
	for (const fn of sources) {
		try {
			const res = await fn()
			if (Object.keys(res.toCny).length >= 5) return res
		} catch (e) {
			lastErr = e
			console.error('汇率源失败，尝试下一个：', (e && e.message) || e)
		}
	}
	throw lastErr || new Error('全部汇率源不可用')
}

module.exports = { fetchDailyRates, SUPPORTED }
