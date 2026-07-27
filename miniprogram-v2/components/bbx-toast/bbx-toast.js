Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  data: {
    visible: false,
    msg: ''
  },
  methods: {
    show(msg) {
      if (this._timer) clearTimeout(this._timer);
      this.setData({ visible: true, msg });
      this._timer = setTimeout(() => this.setData({ visible: false }), 3000);
    }
  },
  lifetimes: {
    detached() {
      if (this._timer) clearTimeout(this._timer);
    }
  }
});
