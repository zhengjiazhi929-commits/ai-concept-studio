const roleSelect = document.querySelector("#roleSelect");
const exportButton = document.querySelector("#exportButton");
const exportNotice = document.querySelector("#exportNotice");
const exportState = document.querySelector("#exportState");

function showNotice(message, tone = "info") {
  exportNotice.hidden = false;
  exportNotice.dataset.tone = tone;
  exportNotice.textContent = message;
}

async function loadCustomers() {
  const response = await fetch("/api/customers?count=24");
  const { customers } = await response.json();

  document.querySelector("#customerCount").textContent = customers.length;
  document.querySelector("#activeCount").textContent = customers.filter(
    (customer) => customer.status === "活跃"
  ).length;

  document.querySelector("#customerRows").innerHTML = customers
    .map(
      (customer) => `
        <tr>
          <td><strong>${customer.name}</strong><small>${customer.id}</small></td>
          <td>${customer.company}</td>
          <td>${customer.email}</td>
          <td>${customer.phone}</td>
          <td><span class="status">${customer.status}</span></td>
        </tr>`
    )
    .join("");
}

async function startExport() {
  exportButton.disabled = true;
  exportState.textContent = "准备中";
  showNotice("正在创建导出任务…");

  try {
    const role = roleSelect.value;
    const response = await fetch(`/api/export?role=${role}&count=100000`, { method: "POST" });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `请求失败：${response.status}`);
    }

    const job = await response.json();
    exportState.textContent = job.status === "complete" ? "可以下载" : "处理中";
    showNotice(`导出任务 ${job.jobId} 已创建。`, "success");
  } catch (error) {
    exportState.textContent = "失败";
    showNotice(error instanceof Error ? error.message : "导出失败", "error");
  } finally {
    exportButton.disabled = false;
  }
}

exportButton.addEventListener("click", startExport);
loadCustomers().catch((error) => showNotice(error.message, "error"));

