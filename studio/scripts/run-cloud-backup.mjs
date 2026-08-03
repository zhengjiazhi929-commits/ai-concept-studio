import { getCloudBackupStatus, runFullMediaBackup } from "../src/shared/cloud-backup.mjs";

const result = await runFullMediaBackup();
if (result.status === "not_configured") {
  console.error("尚未配置 OneDrive 素材目录。请先创建 config/cloud-backup.local.json。");
  process.exitCode = 1;
} else {
  console.log(`云端素材备份完成：${result.copiedFiles} 个文件。`);
  console.log(JSON.stringify(await getCloudBackupStatus(), null, 2));
}
