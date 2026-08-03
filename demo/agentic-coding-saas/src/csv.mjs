const columns = ["id", "name", "company", "email", "phone", "status"];

function maskEmail(email) {
  const [localPart = "", domain = ""] = String(email ?? "").split("@");
  if (!domain) return "***";

  const visiblePrefix = localPart.replace(/\d+$/u, "") || localPart.slice(0, 1);
  return `${visiblePrefix}***@${domain}`;
}

function maskPhone(phone) {
  const text = String(phone ?? "");
  if (text.length < 7) return "***";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function escapeCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function customersToCsv(customers) {
  const header = columns.join(",");
  const rows = customers.map((customer) => {
    const safeCustomer = {
      ...customer,
      email: maskEmail(customer.email),
      phone: maskPhone(customer.phone)
    };

    return columns.map((column) => escapeCell(safeCustomer[column])).join(",");
  });

  return [header, ...rows].join("\n");
}
