function formatDateStamp(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function defaultPlatformUserNo(now) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
  return `BBX-${formatDateStamp(now)}-${suffix}`;
}

function publicUser(record) {
  return {
    id: record._id,
    platformUserNo: record.platformUserNo,
    nickname: record.nickname,
    avatarFileId: record.avatarFileId || null
  };
}

function failure(code, message, requestId) {
  return {
    success: false,
    error: { code, message, details: {} },
    requestId
  };
}

function createAuthHandler({
  cloud,
  now = () => new Date(),
  createPlatformUserNo = defaultPlatformUserNo
}) {
  const db = cloud.database();

  return async function main(event = {}) {
    const requestId = event.requestId || '';
    if (event.action !== 'init') {
      return failure('INVALID_ARGUMENT', '不支持的身份动作', requestId);
    }

    const { OPENID: openid } = cloud.getWXContext();
    if (!openid) {
      return failure('UNAUTHENTICATED', '无法取得微信身份', requestId);
    }

    return db.runTransaction(async (transaction) => {
      const users = transaction.collection('users');
      const existingResult = await users.where({ openid }).limit(1).get();
      const existing = existingResult.data[0];
      const timestamp = now();
      if (existing) {
        const update = {
          lastLoginAt: timestamp,
          updatedAt: timestamp,
          version: (Number(existing.version) || 0) + 1
        };
        await users.doc(existing._id).update({ data: update });
        return {
          success: true,
          data: {
            user: publicUser(Object.assign({}, existing, update)),
            isFirstLogin: false
          },
          requestId
        };
      }

      const userRecord = {
        openid,
        platformUserNo: createPlatformUserNo(timestamp),
        nickname: '微信用户',
        avatarFileId: null,
        status: 'ACTIVE',
        preferences: {
          orderNotifications: true,
          recentSearches: []
        },
        agreementConsents: [],
        lastLoginAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        isTest: false
      };
      const created = await users.add({ data: userRecord });
      const user = Object.assign({ _id: created._id }, userRecord);

      await transaction.collection('messages').add({
        data: {
          userId: created._id,
          type: 'REGISTER_SUCCESS',
          title: '欢迎来到爆爆熊电竞',
          summary: '请勿向任何人提供密码、验证码或支付凭证。',
          relatedType: null,
          relatedId: null,
          targetPage: '/pages/home/home',
          targetParams: {},
          isRead: false,
          readAt: null,
          sentAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
          isTest: false
        }
      });

      return {
        success: true,
        data: { user: publicUser(user), isFirstLogin: true },
        requestId
      };
    });
  };
}

module.exports = { createAuthHandler };
