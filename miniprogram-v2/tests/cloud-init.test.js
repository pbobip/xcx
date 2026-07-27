const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ENV_ID = 'cloud1-d5gmfvq70c644d633';

test('小程序启动时初始化指定的云开发环境', (t) => {
  const calls = [];
  let definition;
  const previousWx = global.wx;
  const previousApp = global.App;
  const appPath = path.join(root, 'app.js');

  t.after(() => {
    delete require.cache[require.resolve(appPath)];
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
    if (previousApp === undefined) {
      delete global.App;
    } else {
      global.App = previousApp;
    }
  });

  global.wx = {
    cloud: {
      init(options) {
        calls.push(options);
      }
    },
    getStorageSync() {
      return '';
    },
    setTabBarBadge() {},
    removeTabBarBadge() {}
  };
  global.App = (app) => {
    definition = app;
  };

  delete require.cache[require.resolve(appPath)];
  require(appPath);
  definition.onLaunch.call(definition);

  assert.deepEqual(calls, [{ env: ENV_ID, traceUser: true }]);
});

test('项目配置声明云函数目录且目录真实存在', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'project.config.json'), 'utf8')
  );

  assert.equal(config.cloudfunctionRoot, 'cloudfunctions/');
  assert.equal(fs.statSync(path.join(root, 'cloudfunctions')).isDirectory(), true);
});
