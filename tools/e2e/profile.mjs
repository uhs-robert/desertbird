// Builds a fresh Thunderbird or Betterbird profile for the end-to-end run: Local Folders, one identity, the fixture mbox files,
// and the prefs an unsigned Experiment xpi needs. run.mjs in tools/measure builds its profile inline and exports nothing, so this is a rewrite of that part.
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { write_fixtures } from "../measure/fixtures.mjs";

const IDENTITY_PREFS = {
  "mail.account.account1.identities": "id1",
  "mail.identity.id1.fullName": "E2E",
  "mail.identity.id1.useremail": "e2e@fixture.invalid",
  "mail.identity.id1.valid": true,
  "mail.identity.id1.compose_html": false,
};

const BASE_PREFS = {
  "mail.accountmanager.accounts": "account1",
  "mail.accountmanager.defaultaccount": "account1",
  "mail.accountmanager.localfoldersserver": "server1",
  "mail.account.account1.server": "server1",
  "mail.server.server1.type": "none",
  "mail.server.server1.hostname": "Local Folders",
  "mail.server.server1.userName": "nobody",
  "mail.server.server1.name": "Local Folders",
  "mail.server.server1.storeContractID": "@mozilla.org/msgstore/berkeleystore;1",
  // Threaded without the expand-all flag (8), so every thread opens collapsed.
  "mailnews.default_view_flags": 1,
  "mailnews.default_sort_type": 18,
  "mailnews.default_sort_order": 1,
  "mail.provider.suppress_dialog_on_startup": true,
  "mail.spotlight.firstRunDone": true,
  "mail.shell.checkDefaultClient": false,
  "mailnews.start_page.enabled": false,
  "app.update.auto": false,
  "app.update.enabled": false,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "extensions.experiments.enabled": true,
  "xpinstall.signatures.required": false,
  "extensions.blocklist.enabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.enabled": false,
  "network.proxy.type": 0,
  "mail.biff.show_alert": false,
  "mail.chat.enabled": false,
  "mail.rights.version": 1,
  "mail.collect_email_address_outgoing": false,
};

// kind "default" has an identity. kind "reply_no_identity" has an account with none.
export function build_profile(profile_dir, { kind = "default" } = {}) {
  rmSync(profile_dir, { recursive: true, force: true });
  mkdirSync(join(profile_dir, "extensions"), { recursive: true });
  const folder_dir = write_fixtures(profile_dir);
  // The bulk folders only slow startup here. The Inbox keeps its collapsed threads.
  for (const entry of readdirSync(folder_dir)) if (/^Bulk\d+$/.test(entry)) rmSync(join(folder_dir, entry));
  const prefs = { ...BASE_PREFS, ...(kind === "reply_no_identity" ? {} : IDENTITY_PREFS), "mail.server.server1.directory": folder_dir };
  writeFileSync(join(profile_dir, "user.js"), Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join("\n") + "\n");
  return { profile_dir, folder_dir };
}

// An app loads a file named <extension id>.xpi from <profile>/extensions. The id comes from the manifest's gecko id.
export function install_xpi(profile_dir, xpi_path) {
  const manifest = JSON.parse(execFileSync("unzip", ["-p", xpi_path, "manifest.json"], { encoding: "utf8" }));
  const id = manifest.browser_specific_settings?.gecko?.id ?? manifest.applications?.gecko?.id;
  if (!id) throw new Error(`${xpi_path} has no gecko id in its manifest`);
  copyFileSync(xpi_path, join(profile_dir, "extensions", `${id}.xpi`));
  return id;
}
