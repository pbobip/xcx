function amountText(cents) {
  const value = (Number(cents) || 0) / 100;
  return `¥${Number(value.toFixed(2))}`;
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : '';
}

function view(item) {
  const template = item.template || {};
  let scopeText = '全部服务套餐';
  if ((template.serviceIds || []).length) scopeText = '指定服务套餐';
  else if ((template.categoryIds || []).length) scopeText = '指定专区';
  else if ((template.gameIds || []).length) scopeText = '指定游戏';
  return {
    id: item.id,
    name: template.name || '优惠券',
    amountText: amountText(template.discountCents),
    thresholdText: template.type === 'THRESHOLD'
      ? `满 ${amountText(template.thresholdCents)} 可用`
      : '无门槛',
    scopeText,
    validFromText: dateText(item.validFrom),
    validToText: dateText(item.validTo)
  };
}

module.exports = { view };
