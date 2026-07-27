const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function createMemoryCloud(openid, controls = {}) {
  const data = { users: [], messages: [] };
  function createDatabase(target) {
    return {
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
          if (name === 'messages' && controls.failMessageAddOnce) {
            controls.failMessageAddOnce = false;
            throw new Error('message insert failed');
          }
          const _id = `${name}-${target[name].length + 1}`;
          target[name].push(Object.assign({ _id }, record));
          return { _id };
        },
        doc(id) {
          return {
            async update({ data: update }) {
              const record = target[name].find((item) => item._id === id);
              Object.assign(record, update);
              return { stats: { updated: record ? 1 : 0 } };
            }
          };
        }
      };
    }
    };
  }

  const database = createDatabase(data);
  database.runTransaction = async (run) => {
    const staged = {
      users: data.users.map((item) => Object.assign({}, item)),
      messages: data.messages.map((item) => Object.assign({}, item))
    };
    const result = await run(createDatabase(staged));
    data.users.splice(0, data.users.length, ...staged.users);
    data.messages.splice(0, data.messages.length, ...staged.messages);
    return result;
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

test('建立顾客或欢迎消息失败时事务回滚，重试后只生成一套数据', async () => {
  const { createAuthHandler } = require('../cloudfunctions/auth/handler');
  const controls = { failMessageAddOnce: true };
  const memory = createMemoryCloud('atomic-openid', controls);
  const main = createAuthHandler({
    cloud: memory.cloud,
    now: () => new Date('2026-07-27T06:00:00.000Z'),
    createPlatformUserNo: () => 'BBX-20260727-ATOMIC'
  });

  await assert.rejects(main({ action: 'init' }), /message insert failed/);
  assert.equal(memory.data.users.length, 0);
  assert.equal(memory.data.messages.length, 0);

  const retry = await main({ action: 'init' });
  assert.equal(retry.success, true);
  assert.equal(retry.data.isFirstLogin, true);
  assert.equal(memory.data.users.length, 1);
  assert.equal(memory.data.messages.length, 1);
});
