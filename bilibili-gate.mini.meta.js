// ==UserScript==
// @name         Bilibili-Gate revamped
// @namespace    https://github.com/owwkmidream
// @version      0.37.1
// @author       owwkmidream
// @description  Bilibili 自定义首页
// @license      MIT
// @icon         https://www.bilibili.com/favicon.ico
// @homepageURL  https://github.com/owwkmidream/Bilibili-Gate
// @supportURL   https://github.com/owwkmidream/Bilibili-Gate/issues
// @downloadURL  https://raw.githubusercontent.com/owwkmidream/Bilibili-Gate/refs/heads/release/bilibili-gate.mini.user.js
// @updateURL    https://raw.githubusercontent.com/owwkmidream/Bilibili-Gate/refs/heads/release/bilibili-gate.mini.meta.js
// @match        https://www.bilibili.com/
// @match        https://www.bilibili.com/?*
// @match        https://www.bilibili.com/index.html
// @match        https://www.bilibili.com/index.html?*
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/watchlater?*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://space.bilibili.com/*
// @match        https://search.bilibili.com/*
// @match        https://t.bilibili.com/*
// @require      https://registry.npmmirror.com/axios/0.30.2/files/dist/axios.min.js
// @require      https://registry.npmmirror.com/react/18.3.1/files/umd/react.production.min.js
// @require      https://registry.npmmirror.com/react-dom/18.3.1/files/umd/react-dom.production.min.js
// @require      https://registry.npmmirror.com/ua-parser-js/1.0.41/files/dist/ua-parser.min.js
// @require      https://registry.npmmirror.com/framer-motion/12.26.2/files/dist/framer-motion.js
// @require      https://registry.npmmirror.com/localforage/1.10.0/files/dist/localforage.min.js
// @require      https://registry.npmmirror.com/pinyin-match/1.2.10/files/dist/main.js
// @require      https://registry.npmmirror.com/spark-md5/3.0.2/files/spark-md5.min.js
// @tag          bilibili
// @connect      app.bilibili.com
// @grant        GM.deleteValue
// @grant        GM.getValue
// @grant        GM.listValues
// @grant        GM.openInTab
// @grant        GM.registerMenuCommand
// @grant        GM.setClipboard
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_download
// @grant        GM_info
// @grant        unsafeWindow
// @run-at       document-body
// ==/UserScript==