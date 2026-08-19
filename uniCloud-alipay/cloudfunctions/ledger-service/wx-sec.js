'use strict'

/**
 * 微信内容安全：access_token 数据库缓存 + msgSecCheck v2。
 * - token 缓存在 sys-cache 集合（serverless 实例间不共享内存，只能落库）
 * - 检测策略：明确 risky 才算违规；接口异常/超时放行（fail-open），不阻断业务
 */
const createConfig = require('uni-config-center')

const db = uniCloud.database()

function getWxAuthConfig() {
	const uniIdConfig = createConfig({ pluginId: 'uni-id' }).config()
	return (((uniIdConfig['mp-weixin'] || {}).oauth || {}).weixin) || {}
}

async function getAccessToken() {
	const cacheCol = db.collection('sys-cache')
	const now = Date.now()
	try {
		const res = await cacheCol.doc('wx_access_token').get()
		const cached = res.data && res.data[0]
		if (cached && cached.expire_at > now + 60 * 1000) {
			return cached.value
		}
	} catch (e) {
		// 集合还不存在等情况，直接走重新获取
	}

	const { appid, appsecret } = getWxAuthConfig()
	if (!appid || !appsecret) {
		throw new Error('uni-id 配置缺少微信 appid/appsecret')
	}
	const resp = await uniCloud.httpclient.request(
		`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${appsecret}`,
		{ dataType: 'json', timeout: 5000 }
	)
	const data = resp.data || {}
	if (!data.access_token) {
		throw new Error('获取 access_token 失败: ' + JSON.stringify(data))
	}
	// 提前 5 分钟过期，避开边界
	await cacheCol.doc('wx_access_token').set({
		value: data.access_token,
		expire_at: now + (data.expires_in - 300) * 1000
	})
	return data.access_token
}

/**
 * 文本安全检测。
 * @param {string} content 待检文本（多段可用 \n 拼接，上限 2500 字）
 * @param {string} openid  用户 openid（须近 2 小时内访问过小程序，正常使用场景必然满足）
 * @param {number} scene   1=资料（昵称类） 2=评论（标题类）
 * @returns {Promise<boolean>} true=可用 false=违规
 */
async function checkText(content, openid, scene = 2) {
	if (!content || !openid) return true
	try {
		const token = await getAccessToken()
		const resp = await uniCloud.httpclient.request(
			`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`,
			{
				method: 'POST',
				contentType: 'json',
				dataType: 'json',
				timeout: 5000,
				data: { version: 2, openid, scene, content }
			}
		)
		const data = resp.data || {}
		if (data.errcode !== 0) {
			console.error('msgSecCheck 调用失败', data)
			return true
		}
		return !(data.result && data.result.suggest === 'risky')
	} catch (e) {
		console.error('msgSecCheck 异常', e)
		return true
	}
}

module.exports = { checkText }
