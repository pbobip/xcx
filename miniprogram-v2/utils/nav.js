// 页面跳转与轻提示工具：tab 页必须 switchTab，其余 navigateTo（栈满降级 redirectTo）
const TAB_PAGES = ['home', 'categories', 'messages', 'profile'];

const urlOf = (name) => `/pages/${name}/${name}`;

function go(name) {
  if (TAB_PAGES.includes(name)) {
    wx.switchTab({ url: urlOf(name) });
  } else {
    wx.navigateTo({
      url: urlOf(name),
      fail: () => wx.redirectTo({ url: urlOf(name) })
    });
  }
}

// 替换当前页（如支付完成后跳结果页，避免返回时回到收银台）
function redirect(name) {
  if (TAB_PAGES.includes(name)) {
    wx.switchTab({ url: urlOf(name) });
  } else {
    wx.redirectTo({ url: urlOf(name) });
  }
}

// 关闭所有页面重启（退出登录 → 登录页）
function relaunch(name) {
  wx.reLaunch({ url: urlOf(name) });
}

function back(fallback = 'home') {
  if (getCurrentPages().length > 1) {
    wx.navigateBack();
  } else if (TAB_PAGES.includes(fallback)) {
    wx.switchTab({ url: urlOf(fallback) });
  } else {
    wx.redirectTo({ url: urlOf(fallback) });
  }
}

// 品牌样式轻提示：优先页面内 <bbx-toast id="toast">，缺失时降级 wx.showToast
function toast(msg) {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  const comp = page && page.selectComponent ? page.selectComponent('#toast') : null;
  if (comp && comp.show) {
    comp.show(msg);
  } else {
    wx.showToast({ title: msg, icon: 'none' });
  }
}

module.exports = { TAB_PAGES, go, redirect, relaunch, back, toast };
