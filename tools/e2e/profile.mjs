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

// The Views folder serves the view setting checks. Six single messages: 3 unread (v0 to v2), 2 starred (v0, v1), 1 with an attachment (v0). The helper add-on tags v4 and v5.
const VIEWS_COUNT = 6;
// The sender names sort in an order that matches neither the date order nor its reverse, so a sort by author shows in the rows.
const VIEWS_SENDER_RANK = [2, 5, 0, 3, 1, 4];
function views_text() {
  const entries = [];
  for (let index = 0; index < VIEWS_COUNT; index++) {
    const unread = index < 3;
    const starred = index < 2;
    const time = new Date(Date.UTC(2026, 1, 1, 0, index)).toUTCString();
    const head = [
      `From v${index}@fixture.invalid ${time}`,
      `X-Mozilla-Status: ${((unread ? 0 : 1) | (starred ? 4 : 0)).toString(16).padStart(4, "0")}`,
      "X-Mozilla-Status2: 00000000",
      `Message-ID: <views-${index}@fixture.invalid>`,
      `Date: ${time.replace("GMT", "+0000")}`,
      `From: Views Sender ${VIEWS_SENDER_RANK[index]} <v${index}@fixture.invalid>`,
      "To: Local <local@fixture.invalid>",
      `Subject: Views ${index}`,
      "MIME-Version: 1.0",
    ];
    const body =
      index === 0
        ? ['Content-Type: multipart/mixed; boundary="views-boundary"', "", "--views-boundary", "Content-Type: text/plain; charset=UTF-8", "", "Body of views-0.", "--views-boundary", 'Content-Type: application/octet-stream; name="note.bin"', 'Content-Disposition: attachment; filename="note.bin"', "Content-Transfer-Encoding: base64", "", "SGVsbG8gYXR0YWNobWVudA==", "--views-boundary--"]
        : ["Content-Type: text/plain; charset=UTF-8", "", `Body of views-${index}.`];
    entries.push([...head, ...body, ""].join("\n") + "\n");
  }
  return entries.join("");
}

// A second account, the default one: a POP3 account that never connects, with two identities and two Inbox messages. One message is addressed to the alias identity.
// Local Folders keeps no identity of its own in this kind, as in a real profile.
const MAIL_ACCOUNT_PREFS = {
  "mail.accountmanager.accounts": "account1,account2",
  "mail.accountmanager.defaultaccount": "account2",
  "mail.account.account2.server": "server2",
  "mail.account.account2.identities": "id2,id3",
  "mail.identity.id2.fullName": "Main",
  "mail.identity.id2.useremail": "main@fixture.invalid",
  "mail.identity.id2.valid": true,
  "mail.identity.id2.compose_html": false,
  "mail.identity.id3.fullName": "Alias",
  "mail.identity.id3.useremail": "list@fixture.invalid",
  "mail.identity.id3.valid": true,
  "mail.identity.id3.compose_html": false,
  "mail.server.server2.type": "pop3",
  "mail.server.server2.hostname": "pop.invalid",
  "mail.server.server2.userName": "main",
  "mail.server.server2.name": "Mail",
  "mail.server.server2.storeContractID": "@mozilla.org/msgstore/berkeleystore;1",
  "mail.server.server2.check_new_mail": false,
  "mail.server.server2.login_at_startup": false,
};

const mail_account_inbox = () =>
  [["mail-plain", "Mail plain", "main@fixture.invalid"], ["mail-alias", "Mail alias", "list@fixture.invalid"]]
    .map(([id, subject, to], index) => [`From sender@fixture.invalid ${new Date(Date.UTC(2026, 1, 1, 0, index)).toUTCString()}`, "X-Mozilla-Status: 0000", "X-Mozilla-Status2: 00000000", `Message-ID: <${id}@fixture.invalid>`, `Date: ${new Date(Date.UTC(2026, 1, 1, 0, index)).toUTCString().replace("GMT", "+0000")}`, "From: Fixture Sender <sender@fixture.invalid>", `To: Someone <${to}>`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", `Body of ${id}.`, ""].join("\n") + "\n")
    .join("");

// kind "default" has an identity. kind "reply_no_identity" has an account with none. kind "mail_account" adds a default mail account with two identities and gives Local Folders none.
export function build_profile(profile_dir, { kind = "default" } = {}) {
  rmSync(profile_dir, { recursive: true, force: true });
  mkdirSync(join(profile_dir, "extensions"), { recursive: true });
  const folder_dir = write_fixtures(profile_dir);
  writeFileSync(join(folder_dir, "Views"), views_text());
  // The bulk folders only slow startup here. The Inbox keeps its collapsed threads.
  for (const entry of readdirSync(folder_dir)) if (/^Bulk\d+$/.test(entry)) rmSync(join(folder_dir, entry));
  const mail_dir = join(profile_dir, "Mail", "pop.invalid");
  if (kind === "mail_account") {
    mkdirSync(mail_dir, { recursive: true });
    writeFileSync(join(mail_dir, "Inbox"), mail_account_inbox());
  }
  const identity_prefs = kind === "reply_no_identity" || kind === "mail_account" ? {} : IDENTITY_PREFS;
  const mail_prefs = kind === "mail_account" ? { ...MAIL_ACCOUNT_PREFS, "mail.server.server2.directory": mail_dir } : {};
  const prefs = { ...BASE_PREFS, ...identity_prefs, ...mail_prefs, "mail.server.server1.directory": folder_dir };
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
