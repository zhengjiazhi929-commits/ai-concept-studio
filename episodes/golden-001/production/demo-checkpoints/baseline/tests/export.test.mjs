import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

test("客户列表使用本地虚构数据", async () => {
  const response = await fetch(`${baseUrl}/api/customers?count=8`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.customers.length, 8);
  assert.match(body.customers[0].email, /@example\.test$/);
});

test("普通用户不能创建导出任务", async () => {
  const response = await fetch(`${baseUrl}/api/export?role=viewer&count=20`, { method: "POST" });
  assert.equal(response.status, 403);
});

test("管理员创建后台导出任务时立即收到 202 和任务编号", async () => {
  const response = await fetch(`${baseUrl}/api/export?role=admin&count=20`, { method: "POST" });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(typeof body.jobId, "string");
  assert.match(body.status, /queued|processing|complete/);
});

test("导出任务完成后提供脱敏 CSV 下载", async () => {
  const createResponse = await fetch(`${baseUrl}/api/export?role=admin&count=20`, { method: "POST" });
  assert.equal(createResponse.status, 202);
  const created = await createResponse.json();

  let job;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const statusResponse = await fetch(`${baseUrl}/api/export/${created.jobId}?role=admin`);
    assert.equal(statusResponse.status, 200);
    job = await statusResponse.json();
    if (job.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(job.status, "complete");
  assert.equal(typeof job.downloadUrl, "string");

  const downloadResponse = await fetch(`${baseUrl}${job.downloadUrl}?role=admin`);
  assert.equal(downloadResponse.status, 200);
  const csv = await downloadResponse.text();

  assert.match(csv, /customer\*+@example\.test/);
  assert.match(csv, /138\*{4}\d{4}/);
  assert.doesNotMatch(csv, /customer1@example\.test/);
  assert.doesNotMatch(csv, /13810000000/);
});

test("普通用户不能查询或下载管理员的导出结果", async () => {
  const createResponse = await fetch(`${baseUrl}/api/export?role=admin&count=5`, { method: "POST" });
  assert.equal(createResponse.status, 202);
  const created = await createResponse.json();

  const statusResponse = await fetch(`${baseUrl}/api/export/${created.jobId}?role=viewer`);
  assert.equal(statusResponse.status, 403);

  const downloadResponse = await fetch(`${baseUrl}/api/export/${created.jobId}/download?role=viewer`);
  assert.equal(downloadResponse.status, 403);
});

