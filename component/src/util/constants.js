const HEADERS_WHITELIST = [
	'content-type',
	'content-length',
	'content-encoding',
	'cache-control',
	'last-modified',
	'etag',
	'vary',
	'transfer-encoding',
	'server-timing',
	'accept-language',
	'accept-encoding',
	'user-agent',
];

const botRequestHeaderAllowlist = ['if-none-match', 'if-modified-since'];

const BOT_PATH_PREFIX = '/page/';
const BOT_REQUEST_KEY_NAME = process.env.BOT_REQUEST_KEY_NAME || 'x-pr-req-key';
const BOT_REQUEST_KEY = process.env.BOT_REQUEST_KEY || '';

const VALID_DEVICE_TYPES = ['desktop', 'mobile', 'tablet'];

export {
	BOT_REQUEST_KEY_NAME,
	BOT_REQUEST_KEY,
	BOT_PATH_PREFIX,
	VALID_DEVICE_TYPES,
	HEADERS_WHITELIST,
	botRequestHeaderAllowlist,
};
