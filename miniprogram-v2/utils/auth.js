const store = require('./store');
const nav = require('./nav');

async function login() {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    throw new Error('当前微信版本无法使用云开发登录');
  }

  const response = await wx.cloud.callFunction({
    name: 'auth',
    data: { action: 'init', payload: {} }
  });
  const result = response && response.result;
  if (!result || !result.success || !result.data || !result.data.user) {
    const message = result && result.error && result.error.message
      ? result.error.message
      : '微信登录失败，请稍后重试';
    throw new Error(message);
  }

  store.setCurrentUser(result.data.user);
  return result.data;
}

function getCurrentUser() {
  return store.getCurrentUser();
}

function isLoggedIn() {
  const user = getCurrentUser();
  return Boolean(user && user.id);
}

function logout() {
  store.clearCurrentUser();
}

function requireLogin(page, mode = 'redirect') {
  if (isLoggedIn()) return true;
  store.setLoginReturn({ page, mode });
  nav.go('login');
  return false;
}

module.exports = { login, getCurrentUser, isLoggedIn, logout, requireLogin };
