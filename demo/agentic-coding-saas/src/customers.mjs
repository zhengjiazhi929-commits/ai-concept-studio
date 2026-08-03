const firstNames = ["林然", "周宁", "陈屿", "沈禾", "宋遥", "许言", "顾南", "唐果"];
const companies = ["北岸工作室", "启点科技", "青禾产品", "远山数据", "拾光设计", "澄明咨询"];

export function makeCustomers(count = 24) {
  const safeCount = Math.max(1, Math.min(Number(count) || 24, 100000));

  return Array.from({ length: safeCount }, (_, index) => {
    const serial = String(index + 1).padStart(5, "0");
    const name = firstNames[index % firstNames.length];

    return {
      id: `CUS-${serial}`,
      name: `${name}${index >= firstNames.length ? (index % 9) + 1 : ""}`,
      company: companies[index % companies.length],
      email: `customer${index + 1}@example.test`,
      phone: `138${String(10000000 + index).slice(-8)}`,
      status: index % 5 === 0 ? "待跟进" : "活跃"
    };
  });
}

