// Builds a fresh Thunderbird or Betterbird profile for the end-to-end run: Local Folders, one identity, the fixture mbox files,
// and the prefs an unsigned Experiment xpi needs. run.mjs in tools/measure builds its profile inline and exports nothing, so this is a rewrite of that part.
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { write_fixtures } from "../measure/fixtures.mjs";
import { write_reading_folder } from "./reading_fixture.mjs";
import { SHOTS_USER, shots_inbox_text } from "./shots_fixture.mjs";

const IDENTITY_PREFS = {
  "mail.account.account1.identities": "id1",
  "mail.identity.id1.fullName": "E2E",
  "mail.identity.id1.useremail": "e2e@fixture.invalid",
  "mail.identity.id1.valid": true,
  "mail.identity.id1.compose_html": false,
};

// The quick reply kinds give the identity a signature, in plain or HTML compose, so the run can see whether a draft keeps it.
const QUICK_REPLY_SIGNATURE = { "mail.identity.id1.htmlSigText": "E2E signature line", "mail.identity.id1.htmlSigFormat": false, "mail.identity.id1.attach_signature": false };

// A reply above the quote with the signature above it too, the layout where the user's text and the signature share one side.
const REPLY_ON_TOP = { "mail.identity.id1.compose_html": true, "mail.identity.id1.reply_on_top": 1, "mail.identity.id1.sig_bottom": false };

// Settings of the add-on that every run seeds into its storage, because a profile pref cannot reach them. A toast of a refused command lasts 6 s by default, and a check that waits for its end waited that long each time. No check names the default time, so the run shortens it here, and `src/` keeps its default.
export const E2E_SETTINGS = { toast_error_ms: 3000 };

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

// Prefs of the e2e runs only. A person looking at an owner-test window keeps the profile users have.
// The text caret blinks, so a region with the command line open draws two different hashes in turn. A blink time of 0 keeps the caret drawn, and a pixel poll sees only real changes.
const E2E_ONLY_PREFS = { "ui.caretBlinkTime": 0, "toolkit.legacyUserProfileCustomizations.stylesheets": true };

// The red current-time line of the calendar week view moves about 1 px on each minute tick, so a region compare across a minute boundary fails. This sheet hides it (userChrome.css, loaded by the pref above).
const E2E_ONLY_USER_CHROME = ".timeIndicator, .multiday-timebar-now-indicator { display: none !important; }\n";

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

// The Lists folder serves the list and date filters (b m l, b m d), in profile kinds "lists" and "owner" only, so the folder pane of every other piece stays as it was and a hand test has mail with a List-Id. Seven single messages on three days, from two mailing lists and none. Every message is sent at 12:00 UTC plus its index in minutes, so the messages of one UTC day share a local day in any zone a run uses. Lists 1 is starred, Lists 3 and 6 are unread.
const LISTS_MAIL = [
  ["dev", 3], ["dev", 3], ["ops", 3], ["dev", 4], ["ops", 5], [null, 5], ["dev", 6],
];
function lists_text() {
  return LISTS_MAIL.map(([list, day], index) => {
    const time = new Date(Date.UTC(2026, 1, day, 12, index)).toUTCString();
    const unread = index === 3 || index === 6;
    return [
      `From l${index}@fixture.invalid ${time}`,
      `X-Mozilla-Status: ${((unread ? 0 : 1) | (index === 1 ? 4 : 0)).toString(16).padStart(4, "0")}`,
      "X-Mozilla-Status2: 00000000",
      `Message-ID: <lists-${index}@fixture.invalid>`,
      `Date: ${time.replace("GMT", "+0000")}`,
      `From: Lists Sender ${index} <l${index}@fixture.invalid>`,
      "To: Local <local@fixture.invalid>",
      `Subject: Lists ${index}`,
      ...(list ? [`List-Id: The ${list} list <${list}.fixture.invalid>`] : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      `Body of lists-${index}.`,
      "",
    ].join("\n") + "\n";
  }).join("");
}

// The Threads folder of the same kinds: a thread of two on the dev list and a single on the ops list a day later, so a filter by the message can start from a thread row.
function threads_text() {
  return [["dev", 3, null], ["dev", 3, 0], ["ops", 4, null]].map(([list, day, parent], index) => {
    const time = new Date(Date.UTC(2026, 1, day, 12, index)).toUTCString();
    return [
      `From t${index}@fixture.invalid ${time}`,
      "X-Mozilla-Status: 0001",
      "X-Mozilla-Status2: 00000000",
      `Message-ID: <threads-${index}@fixture.invalid>`,
      ...(parent === null ? [] : [`In-Reply-To: <threads-${parent}@fixture.invalid>`, `References: <threads-${parent}@fixture.invalid>`]),
      `Date: ${time.replace("GMT", "+0000")}`,
      `From: Threads Sender ${index} <t${index}@fixture.invalid>`,
      "To: Local <local@fixture.invalid>",
      `Subject: ${parent === null ? "" : "Re: "}Threads ${parent ?? index}`,
      `List-Id: The ${list} list <${list}.fixture.invalid>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      `Body of threads-${index}.`,
      "",
    ].join("\n") + "\n";
  }).join("");
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

// E2E_THEME=dark or light starts the app with that built-in theme, for the screenshots of the themed surfaces.
const THEME_PREFS = {
  dark: { "extensions.activeThemeID": "thunderbird-compact-dark@mozilla.org", "ui.systemUsesDarkTheme": 1 },
  light: { "extensions.activeThemeID": "thunderbird-compact-light@mozilla.org", "ui.systemUsesDarkTheme": 0 },
  // Thunderbird's own scheme set against the OS scheme, to tell which signal the themed surfaces can follow.
  tb_dark_os_light: { "extensions.activeThemeID": "thunderbird-compact-dark@mozilla.org", "ui.systemUsesDarkTheme": 0 },
  tb_light_os_dark: { "extensions.activeThemeID": "thunderbird-compact-light@mozilla.org", "ui.systemUsesDarkTheme": 1 },
  default_os_dark: { "ui.systemUsesDarkTheme": 1 },
  default_os_light: { "ui.systemUsesDarkTheme": 0 },
};

const OWNER_PREFS = { "toolkit.telemetry.reportingpolicy.firstRun": false };

// E2E_CONSOLE=1 prints the app and add-on console to app.log.
const CONSOLE_PREFS = { "devtools.console.stdout.chrome": true, "devtools.console.stdout.content": true };

const mail_account_inbox = () =>
  [["mail-plain", "Mail plain", "main@fixture.invalid"], ["mail-alias", "Mail alias", "list@fixture.invalid"]]
    .map(([id, subject, to], index) => [`From sender@fixture.invalid ${new Date(Date.UTC(2026, 1, 1, 0, index)).toUTCString()}`, "X-Mozilla-Status: 0000", "X-Mozilla-Status2: 00000000", `Message-ID: <${id}@fixture.invalid>`, `Date: ${new Date(Date.UTC(2026, 1, 1, 0, index)).toUTCString().replace("GMT", "+0000")}`, "From: Fixture Sender <sender@fixture.invalid>", `To: Someone <${to}>`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", `Body of ${id}.`, ""].join("\n") + "\n")
    .join("");

// Kind "shots" is for the screenshots of the README and the listing: its own Inbox of realistic mail (shots_fixture.mjs), the newest message first, an identity with a real-looking name, and none of the checks' fixture folders.
const SHOTS_PREFS = {
  "mailnews.default_sort_order": 2,
  // The table view, which has the room for the sender and the date, in place of the cards.
  "mail.threadpane.listview": 1,
  "mail.identity.id1.fullName": SHOTS_USER.name,
  "mail.identity.id1.useremail": SHOTS_USER.address,
};
const SHOTS_FOLDERS = ["Archives", "Sent", "Drafts"];

// kind "owner" is the default plus the prefs a window a person looks at needs: no first-run policy tab. owner-test uses it.
// kind "lists" adds the Lists folder (List-Id headers and three days). kind "owner" adds it too.
// kind "message_header" adds the Header folder (a message with Cc, a tag and an attachment) and the dark scheme.
// kinds "quick_reply_plain" and "quick_reply_html" have an identity with a signature. kind "default" has an identity. kind "reply_no_identity" has an account with none. kind "mail_account" adds a default mail account with two identities and gives Local Folders none.
export function build_profile(profile_dir, { kind = "default" } = {}) {
  rmSync(profile_dir, { recursive: true, force: true });
  mkdirSync(join(profile_dir, "extensions"), { recursive: true });
  // E2E_SCALE=1 adds the 10,000-message Big folder and keeps the 50 Bulk folders, for the step timing run.
  const scale = process.env.E2E_SCALE === "1";
  const folder_dir = write_fixtures(profile_dir, { big: scale, header: kind === "message_header" });
  writeFileSync(join(folder_dir, "Views"), views_text());
  if (kind === "lists" || kind === "owner") {
    writeFileSync(join(folder_dir, "Lists"), lists_text());
    writeFileSync(join(folder_dir, "Threads"), threads_text());
  }
  write_reading_folder(folder_dir);
  // The bulk folders only slow startup here. The Inbox keeps its collapsed threads.
  if (!scale) for (const entry of readdirSync(folder_dir)) if (/^Bulk\d+$/.test(entry)) rmSync(join(folder_dir, entry));
  if (kind === "shots") {
    for (const name of ["Views", "Reading", "Html"]) rmSync(join(folder_dir, name), { force: true });
    writeFileSync(join(folder_dir, "Inbox"), shots_inbox_text());
    for (const name of SHOTS_FOLDERS) writeFileSync(join(folder_dir, name), "");
  }
  const mail_dir = join(profile_dir, "Mail", "pop.invalid");
  if (kind === "mail_account") {
    mkdirSync(mail_dir, { recursive: true });
    writeFileSync(join(mail_dir, "Inbox"), mail_account_inbox());
  }
  const quick_reply_prefs = kind === "quick_reply_plain" || kind === "compose_editor" ? QUICK_REPLY_SIGNATURE : kind === "quick_reply_html" || kind === "compose_editor_html" ? { ...QUICK_REPLY_SIGNATURE, "mail.identity.id1.compose_html": true } : kind === "compose_editor_html_top" ? { ...QUICK_REPLY_SIGNATURE, ...REPLY_ON_TOP } : {};
  const identity_prefs = kind === "reply_no_identity" || kind === "mail_account" ? {} : { ...IDENTITY_PREFS, ...quick_reply_prefs };
  const mail_prefs = kind === "mail_account" ? { ...MAIL_ACCOUNT_PREFS, "mail.server.server2.directory": mail_dir } : {};
  // Kind "message_remote" lets mail load remote content. The others keep the default, which blocks it.
  const remote_prefs = kind === "message_remote" ? { "mailnews.message_display.disable_remote_image": false } : {};
  const owner_prefs = kind === "owner" ? OWNER_PREFS : {};
  // Kind "message_header" shows the dark scheme, the only one where the message header shows its day/night switch.
  const header_prefs = kind === "message_header" ? THEME_PREFS.default_os_dark : {};
  const shots_prefs = kind === "shots" ? SHOTS_PREFS : {};
  const prefs = { ...BASE_PREFS, ...(kind === "owner" ? {} : E2E_ONLY_PREFS), ...identity_prefs, ...owner_prefs, ...mail_prefs, ...remote_prefs, ...header_prefs, ...shots_prefs, ...THEME_PREFS[process.env.E2E_THEME ?? ""], ...(process.env.E2E_CONSOLE ? CONSOLE_PREFS : {}), "mail.server.server1.directory": folder_dir };
  writeFileSync(join(profile_dir, "user.js"), Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join("\n") + "\n");
  // nativeMessaging is an optional permission that the options page asks for with a prompt, and a headless run has no one to allow it. The app keeps granted optional permissions in the profile's extension-preferences.json. The editor kinds need the grant for the native host.
  if (kind.startsWith("compose_editor")) writeFileSync(join(profile_dir, "extension-preferences.json"), JSON.stringify({ "desertbird@uhs-robert": { permissions: ["nativeMessaging"], origins: [] } }));
  if (kind !== "owner") {
    mkdirSync(join(profile_dir, "chrome"), { recursive: true });
    writeFileSync(join(profile_dir, "chrome", "userChrome.css"), E2E_ONLY_USER_CHROME);
  }
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
