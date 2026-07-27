const nav = require('../../utils/nav');

Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  methods: {
    onTap() {
      // 真机上 open-type="contact" 会拉起微信客服会话；此提示与原型保持一致
      nav.toast('已打开微信客服入口');
    }
  }
});
