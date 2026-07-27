const PACKAGES = [
  {
    code: 'BASIC',
    label: '基础档',
    tag: '无畏契约 · 基础档',
    title: '匹配 / 下三 / 黄金',
    unit: '局',
    unitPrice: 10,
    standard: '也可按 20 元 / 小时下单，具体联系客服',
    oldPrice: '基础价目'
  },
  {
    code: 'FUN',
    label: '娱乐陪',
    tag: '无畏契约 · 娱乐陪',
    title: '钻石段位娱乐陪',
    unit: '局',
    unitPrice: 25,
    standard: '轻松组队，以娱乐体验为主',
    oldPrice: '基础档 ¥10/局'
  },
  {
    code: 'PRO',
    label: '技术陪',
    tag: '无畏契约 · 技术陪',
    title: '钻石段位技术陪',
    unit: '局',
    unitPrice: 35,
    standard: '技术 C：白金或人前五',
    oldPrice: '钻石娱乐陪 ¥25/局'
  },
  {
    code: 'SWEET',
    label: '甜蜜单',
    tag: '无畏契约 · 甜蜜单',
    title: '甜蜜单陪玩',
    unit: '小时',
    unitPrice: 52,
    standard: '可以在备注中指定称呼',
    oldPrice: '按小时计价'
  }
];

function normalizeIndex(index) {
  const value = Number(index);
  return Number.isInteger(value) && value >= 0 && value < PACKAGES.length ? value : 2;
}

function getPackage(index) {
  return PACKAGES[normalizeIndex(index)];
}

function getPackageByCode(code) {
  return PACKAGES.find((pkg) => pkg.code === String(code || '').toUpperCase()) || getPackage(2);
}

function getIndexByCode(code) {
  const index = PACKAGES.findIndex((pkg) => pkg.code === String(code || '').toUpperCase());
  return index >= 0 ? index : 2;
}

module.exports = { PACKAGES, getPackage, getPackageByCode, getIndexByCode, normalizeIndex };
