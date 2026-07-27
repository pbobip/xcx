const KEYS = {
  unreadMessages: 'bbx_unread_messages',
  currentUser: 'bbx_current_user',
  loginReturn: 'bbx_login_return',
  selectedService: 'bbx_selected_service',
  pendingTabState: 'bbx_pending_tab_state',
  selectedOrder: 'bbx_selected_order',
  lastOrder: 'bbx_last_order'
};

function read(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value === undefined || value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    // 本地原型即使存储失败也允许继续浏览。
  }
}

function pop(key) {
  const value = read(key, null);
  try {
    wx.removeStorageSync(key);
  } catch (error) {
    // 一次性状态清理失败不阻断当前页面跳转。
  }
  return value;
}

function getUnreadMessages() {
  return Number(read(KEYS.unreadMessages, 2)) || 0;
}

function setUnreadMessages(count) {
  write(KEYS.unreadMessages, Math.max(0, Number(count) || 0));
}

function setCurrentUser(user) {
  write(KEYS.currentUser, user || null);
}

function getCurrentUser() {
  return read(KEYS.currentUser, null);
}

function clearCurrentUser() {
  pop(KEYS.currentUser);
}

function setLoginReturn(value) {
  write(KEYS.loginReturn, value || null);
}

function popLoginReturn() {
  return pop(KEYS.loginReturn);
}

function setSelectedService(service) {
  write(KEYS.selectedService, service || null);
}

function getSelectedService(fallback) {
  return read(KEYS.selectedService, fallback || null);
}

function setPendingTabState(value) {
  write(KEYS.pendingTabState, value || null);
}

function popPendingTabState() {
  return pop(KEYS.pendingTabState);
}

function setSelectedOrder(order) {
  write(KEYS.selectedOrder, order || null);
}

function getSelectedOrder(fallback) {
  return read(KEYS.selectedOrder, fallback || null);
}

function setLastOrder(order) {
  write(KEYS.lastOrder, order || null);
}

function getLastOrder(fallback) {
  return read(KEYS.lastOrder, fallback || null);
}

module.exports = {
  getUnreadMessages,
  setUnreadMessages,
  setCurrentUser,
  getCurrentUser,
  clearCurrentUser,
  setLoginReturn,
  popLoginReturn,
  setSelectedService,
  getSelectedService,
  setPendingTabState,
  popPendingTabState,
  setSelectedOrder,
  getSelectedOrder,
  setLastOrder,
  getLastOrder
};
