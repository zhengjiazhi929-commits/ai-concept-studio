import { setupPublicDiscoveryIdentity } from "./lib/public-discovery-authority.mjs";
import {
  isDirectPublicDiscoveryCli,
  parsePublicDiscoveryArguments,
  reportPublicDiscoveryCli
} from "./lib/public-discovery-cli.mjs";

export async function runSetupPublicDiscoveryCli(argv = process.argv.slice(2)) {
  return setupPublicDiscoveryIdentity(parsePublicDiscoveryArguments(argv, { setup: true }));
}

if (isDirectPublicDiscoveryCli(import.meta.url)) {
  await reportPublicDiscoveryCli(() => runSetupPublicDiscoveryCli());
}
