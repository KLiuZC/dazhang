/**
 * 币种展示信息。主币种恒为人民币（CNY），此表为可启用的外币。
 * 需与云端 fx.js 的 SUPPORTED 列表保持一致。
 */
export const CURRENCIES = [
	{ code: 'USD', name: '美元', symbol: '$' },
	{ code: 'EUR', name: '欧元', symbol: '€' },
	{ code: 'JPY', name: '日元', symbol: 'JP¥' },
	{ code: 'GBP', name: '英镑', symbol: '£' },
	{ code: 'AUD', name: '澳元', symbol: 'A$' },
	{ code: 'HKD', name: '港币', symbol: 'HK$' },
	{ code: 'TWD', name: '新台币', symbol: 'NT$' },
	{ code: 'KRW', name: '韩元', symbol: '₩' },
	{ code: 'THB', name: '泰铢', symbol: '฿' },
	{ code: 'SGD', name: '新加坡元', symbol: 'S$' },
	{ code: 'MYR', name: '马来西亚令吉', symbol: 'RM' },
	{ code: 'CAD', name: '加元', symbol: 'C$' },
	{ code: 'NZD', name: '新西兰元', symbol: 'NZ$' },
	{ code: 'VND', name: '越南盾', symbol: '₫' }
]

export function currencyInfo(code) {
	return CURRENCIES.find(c => c.code === code) || { code, name: code, symbol: code + ' ' }
}

export function currencyName(code) {
	return currencyInfo(code).name
}

export function curSymbol(code) {
	return code === 'CNY' ? '¥' : currencyInfo(code).symbol
}
