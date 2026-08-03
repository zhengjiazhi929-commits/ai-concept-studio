import { getCloudBackupStatus } from "../src/shared/cloud-backup.mjs";

console.log(JSON.stringify(await getCloudBackupStatus(), null, 2));
