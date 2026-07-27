const nav = require('../../utils/nav');

Page({
  onNew() {
    nav.go('complaint-submit');
  },
  onComplaintTap() {
    nav.toast('售后详情将在接入后台后展示');
  }
});
