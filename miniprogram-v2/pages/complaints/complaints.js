const nav = require('../../utils/nav');
const auth = require('../../utils/auth');

Page({
  onLoad() {
    auth.requireLogin('complaints', 'back');
  },
  onNew() {
    nav.go('complaint-submit');
  },
  onComplaintTap() {
    nav.toast('售后详情将在接入后台后展示');
  }
});
