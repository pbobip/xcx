const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function createMemoryCloud(openid) {
  const data = { users: [], messages: [] };
  const database = {
    collection(name) {
      return {
        where(query) {
          return {
            limit() {
              return {
                async get() {
                  return {
                    data: data[name].filter((item) =>
                      Object.entries(query).every(([key, value]) => item[key] === value)
                    )
                  };
                }
              };
            }
          };
        },
        async add({ data: record }) {
          const _id = `${name}-${data[name].length + 1}`;
          data[name].push(Object.assign({ _id }, record));
          return { _id };
        },
        doc(id) {
          return {
            async update({ data: update }) {
              const record = data[name].find((item) => item._id === id);
              Object.assign(record, update);
              return { stats: { updated: record ? 1 : 0 } };
            }
          };
        }
      };
    }
  };

  return {
    data,
    cloud: {
      getWXContext() {
        return { OPENID: openid };
      },
      database() {
        return database;
      }
    }
  };
}

test('访客启动小程序时默认进入首页浏览', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(root, 'app.json'), 'utf8')
  );

  assert.equal(appConfig.pages[0], 'pages/home/home');
});

test('首次微信登录只信任云函数上下文并建立顾客和欢迎消息', async () => {
  const { createAuthHandler } = require('../cloudfunctions/auth/handler');
  const memory = createMemoryCloud('trusted-openid');
  const now = new Date('2026-07-27T04:00:00.000Z');
  const main = createAuthHandler({
    cloud: memory.cloud,
    now: () => now,
    createPlatformUserNo: () => 'BBX-20260727-ABC123'
  });

  const result = await main({
    action: 'init',
    payload: { openid: 'forged-openid', userId: 'forged-user-id' }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.isFirstLogin, true);
  assert.deepEqual(result.data.user, {
    id: 'users-1',
    platformUserNo: 'BBX-20260727-ABC123',
    nickname: '微信用户',
    avatarFileId: null
  });
  assert.equal(memory.data.users[0].openid, 'trusted-openid');
  assert.equal(memory.data.messages[0].userId, 'users-1');
  assert.equal(memory.data.messages[0].type, 'REGISTER_SUCCESS');
});

test('同一微信身份重复登录复用顾客且只更新最近登录时间', async () => {
  const { createAuthHandler } = require('../cloudfunctions/auth/handler');
  const memory = createMemoryCloud('same-openid');
  let currentTime = new Date('2026-07-27T04:00:00.000Z');
  const main = createAuthHandler({
    cloud: memory.cloud,
    now: () => currentTime,
    createPlatformUserNo: () => 'BBX-20260727-REPEAT'
  });

  const first = await main({ action: 'init' });
  currentTime = new Date('2026-07-27T05:00:00.000Z');
  const second = await main({ action: 'init' });

  assert.equal(first.data.user.id, second.data.user.id);
  assert.equal(second.data.isFirstLogin, false);
  assert.equal(memory.data.users.length, 1);
  assert.equal(memory.data.messages.length, 1);
  assert.equal(memory.data.users[0].lastLoginAt, currentTime);
});
