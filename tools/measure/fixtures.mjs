// Generated Local Folders for the probe: an Inbox of 60 messages (10 threads of 4 and 20 single messages) and 50 folders of 100 messages.
// A mbox file with X-Mozilla-Status headers is all Thunderbird needs, so the fixture is plain text and no account or network is involved.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BULK_FOLDERS = 50;
export const BULK_MESSAGES_PER_FOLDER = 100;
export const INBOX_THREADS = 10;
export const THREAD_LENGTH = 4;
export const INBOX_SINGLES = 20;
export const BIG_MESSAGES = 10000;
// Unread messages in the Inbox: 2 of every thread of 4 and 13 of the 20 singles.
export const INBOX_UNREAD = INBOX_THREADS * 2 + 13;

const BASE_TIME_S = Date.UTC(2026, 0, 1) / 1000;

function mbox_entry({ id, subject, from, time_s, unread, starred, references, body, html = false }) {
  // 0001 read, 0004 flagged.
  const status = (unread ? 0 : 1) | (starred ? 4 : 0);
  const lines = [
    `From ${from} ${new Date(time_s * 1000).toUTCString()}`,
    `X-Mozilla-Status: ${status.toString(16).padStart(4, "0")}`,
    "X-Mozilla-Status2: 00000000",
    `Message-ID: <${id}@fixture.invalid>`,
    `Date: ${new Date(time_s * 1000).toUTCString().replace("GMT", "+0000")}`,
    `From: Fixture Sender <${from}>`,
    "To: Local <local@fixture.invalid>",
    `Subject: ${subject}`,
    ...(references.length ? [`In-Reply-To: <${references.at(-1)}@fixture.invalid>`, `References: ${references.map((ref) => `<${ref}@fixture.invalid>`).join(" ")}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: text/${html ? "html" : "plain"}; charset=UTF-8`,
    "",
    body,
    "",
  ];
  return lines.join("\n") + "\n";
}

function inbox_text() {
  const entries = [];
  let time_s = BASE_TIME_S;
  for (let thread = 0; thread < INBOX_THREADS; thread++) {
    const references = [];
    for (let position = 0; position < THREAD_LENGTH; position++) {
      const id = `inbox-t${thread}-m${position}`;
      entries.push(mbox_entry({ id, subject: `${position ? "Re: " : ""}Thread ${thread}`, from: `thread${thread}@fixture.invalid`, time_s: (time_s += 60), unread: position % 2 === 0, starred: false, references: [...references], body: `Body of ${id}.\nSecond line of ${id}.` }));
      references.push(id);
    }
  }
  for (let single = 0; single < INBOX_SINGLES; single++) {
    const id = `inbox-s${single}`;
    entries.push(mbox_entry({ id, subject: `Single ${single}`, from: `single${single}@fixture.invalid`, time_s: (time_s += 60), unread: single % 3 !== 0, starred: single % 7 === 0, references: [], body: `Body of ${id}.\nSecond line of ${id}.` }));
  }
  return entries.join("");
}

function bulk_text(folder) {
  const entries = [];
  for (let index = 0; index < BULK_MESSAGES_PER_FOLDER; index++) {
    const id = `bulk-${folder}-${index}`;
    entries.push(mbox_entry({ id, subject: `Bulk ${folder} ${index}`, from: `bulk${folder}@fixture.invalid`, time_s: BASE_TIME_S + folder * 100000 + index * 60, unread: index % 10 < 3, starred: index % 25 === 0, references: [], body: `Body of ${id}.` }));
  }
  return entries.join("");
}

// Unread messages in the bulk folders: 3 of every 10, so 30 per folder and 1500 in all.
export const BULK_UNREAD_TOTAL = BULK_FOLDERS * BULK_MESSAGES_PER_FOLDER * 0.3;

function big_text() {
  const entries = [];
  for (let index = 0; index < BIG_MESSAGES; index++) {
    const id = `big-${index}`;
    entries.push(mbox_entry({ id, subject: `Big ${index}`, from: "big@fixture.invalid", time_s: BASE_TIME_S + index * 60, unread: index % 10 < 3, starred: index % 25 === 0, references: [], body: `Body of ${id}.` }));
  }
  return entries.join("");
}

// big adds one folder of 10,000 messages. It stays out of the other runs so their counts stay at 5,000 in the 50 folders.
export function write_fixtures(profile_dir, { big = false } = {}) {
  const folder_dir = join(profile_dir, "Mail", "Local Folders");
  mkdirSync(folder_dir, { recursive: true });
  writeFileSync(join(folder_dir, "Inbox"), inbox_text());
  writeFileSync(join(folder_dir, "Trash"), "");
  writeFileSync(join(folder_dir, "Html"), mbox_entry({ id: "html-0", subject: "Html 0", from: "html@fixture.invalid", time_s: BASE_TIME_S, unread: false, starred: false, references: [], body: "<html><body><p>Body of <b>html-0</b>.</p></body></html>", html: true }));
  for (let folder = 0; folder < BULK_FOLDERS; folder++) writeFileSync(join(folder_dir, `Bulk${String(folder).padStart(2, "0")}`), bulk_text(folder));
  if (big) writeFileSync(join(folder_dir, "Big"), big_text());
  return folder_dir;
}
