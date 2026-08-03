import assert from "node:assert/strict";
import { createAppServer } from "../server.mjs";

const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const pageResponse = await fetch(baseUrl);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /id="exportState"/);
  assert.match(page, /id="downloadLink"/);

  const viewerResponse = await fetch(`${baseUrl}/api/export?role=viewer&count=5`, {
    method: "POST"
  });
  assert.equal(viewerResponse.status, 403);

  const createResponse = await fetch(`${baseUrl}/api/export?role=admin&count=5`, {
    method: "POST"
  });
  assert.equal(createResponse.status, 202);
  const created = await createResponse.json();

  let job;
  do {
    await new Promise((resolve) => setTimeout(resolve, 15));
    const statusResponse = await fetch(
      `${baseUrl}/api/export/${created.jobId}?role=admin`
    );
    assert.equal(statusResponse.status, 200);
    job = await statusResponse.json();
  } while (job.status !== "complete");

  const downloadResponse = await fetch(`${baseUrl}${job.downloadUrl}?role=admin`);
  assert.equal(downloadResponse.status, 200);
  const csv = await downloadResponse.text();
  assert.match(csv, /customer\*+@example\.test/);
  assert.match(csv, /138\*{4}\d{4}/);
  assert.ok(!csv.includes("customer1@example.test"));
  assert.ok(!csv.includes("13810000000"));

  console.log(
    JSON.stringify(
      {
        pageStatus: pageResponse.status,
        viewerStatus: viewerResponse.status,
        createStatus: createResponse.status,
        finalState: job.status,
        downloadStatus: downloadResponse.status,
        sensitiveFieldsMasked: true
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
