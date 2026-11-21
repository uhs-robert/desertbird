// The fixture Inbox: the row order of its ten four-message threads and twenty single messages.

export const header_id = (index) => (index.kind === "thread" ? `inbox-t${index.n}-m0` : `inbox-s${index.n}`) + "@fixture.invalid";
// Row order of the fixture Inbox, sorted by date ascending. Collapsed threads show only their root (m0).
export const FLAT_ROWS = [
  ...Array.from({ length: 10 }, (_, thread) => Array.from({ length: 4 }, (_, position) => `inbox-t${thread}-m${position}@fixture.invalid`)).flat(),
  ...Array.from({ length: 20 }, (_, single) => `inbox-s${single}@fixture.invalid`),
];
export const COLLAPSED_ROWS = [...Array.from({ length: 10 }, (_, thread) => header_id({ kind: "thread", n: thread })), ...Array.from({ length: 20 }, (_, single) => header_id({ kind: "single", n: single }))];
