const columns = ["id", "name", "company", "email", "phone", "status"];

function escapeCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function customersToCsv(customers) {
  const header = columns.join(",");
  const rows = customers.map((customer) =>
    columns.map((column) => escapeCell(customer[column])).join(",")
  );

  return [header, ...rows].join("\n");
}

