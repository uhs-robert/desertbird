// The Inbox of the `shots` profile kind: mail that reads like a real inbox, for the screenshots of the README and the store listing.
// Senders are fictional and use the reserved example domains. The other kinds keep the plain `Thread n` fixture, which the checks count on.

export const SHOTS_USER = { name: "Sam Rivera", address: "sam.rivera@example.com" };

const CACTUS_LIST = "Cactus Gardeners <cactus-gardeners.lists.example.org>";
const TRAIL_LIST = "Trail Maintainers <trail-maintainers.lists.example.org>";

// The HTML newsletter holds the links the body hint shot labels. Its unsubscribe link and its List-Unsubscribe header are both mailto links, so a pick of the link opens a compose window and no browser.
export const NEWSLETTER_ID = "trailhead-weekly-47";
const NEWSLETTER_UNSUBSCRIBE = "unsubscribe@trailhead.example.com";
const newsletter_html = `<html><body style="font-family: sans-serif; max-width: 34em; margin: 0 auto; padding: 1em;">
<h2 style="color: #8a3b1e;">Trailhead Weekly</h2>
<p>Issue 47. Five canyon loops that stay cool even when the valley does not.</p>
<p>This week we walked the Slot Canyon Loop in the early morning and found it empty. The wash was dry, the walls held the night chill and the whole loop took under three hours. <a href="https://trailhead.example.com/guides/slot-canyon-loop">Read the full guide</a> for the parking notes and the water plan.</p>
<p>Also in this issue:</p>
<ul>
<li><a href="https://trailhead.example.com/guides/ridge-line-sunrise">A sunrise on the Ridge Line</a>, with the best time to start</li>
<li><a href="https://trailhead.example.com/gear/lightweight-shells">Four lightweight shells compared</a> after a wet season</li>
<li><a href="https://trailhead.example.com/community/volunteer-days">Volunteer days</a> on the Cholla Trail, first Saturday of the month</li>
</ul>
<p style="text-align: center;"><a href="https://trailhead.example.com/subscribe/upgrade" style="background: #c8664a; color: #ffffff; padding: 0.6em 1.2em; text-decoration: none; border-radius: 4px;">Support the trail fund</a></p>
<p style="font-size: 0.85em; color: #666666;">You get this issue because you subscribed at trailhead.example.com. <a href="https://trailhead.example.com/prefs">Change your preferences</a> or <a href="mailto:${NEWSLETTER_UNSUBSCRIBE}?subject=unsubscribe">unsubscribe</a>.</p>
</body></html>`;

// Newest first in the list. `day` and `hour` are UTC in November 2026. `read` false is bold in the list.
// The order serves the demo film (pieces/shots.demo.mjs), which works down the list from the top: two messages to read, a shipping notice to archive, an invoice to star, a spam to mark and delete, four mailing list posts to archive as one batch, then a receipt and the newsletter, the oldest.
export const SHOTS_MESSAGES = [
  { id: "roadmap-1", from: "Priya Raman <priya.raman@example.com>", subject: "Q4 roadmap review: agenda and notes", day: 25, hour: 8, read: false, body: "Hi Sam,\n\nHere is the agenda for Thursday's roadmap review.\n\n1. Where the migration stands\n2. What slips into January\n3. The two requests from support\n\nI put last week's notes in the shared folder. Please add anything I missed before the meeting.\n\nThanks,\nPriya" },
  { id: "lunch-1", from: "Marcus Webb <marcus.webb@example.org>", subject: "Lunch on Thursday?", day: 25, hour: 7, read: false, body: "Sam,\n\nAre you free for lunch on Thursday? The new noodle place on Fourth Street opened last week and I hear the line is short before noon.\n\nMarcus" },
  { id: "order-1", from: "Mesa Outfitters <orders@mesaoutfitters.example.com>", subject: "Your order has shipped", day: 25, hour: 6, read: false, body: "Good news: order 88213 is on its way.\n\n1 x Trail shell, size M\n1 x Wool socks (2 pack)\n\nExpected delivery: November 28.\n\nMesa Outfitters" },
  { id: "invoice-1", from: "Elena Petrova <elena.petrova@example.net>", subject: "Invoice 2026-1142 for November", day: 24, hour: 16, read: false, body: "Hello Sam,\n\nThe invoice for November is attached to this message as a PDF. The amount is due within 30 days.\n\nPlease tell me if anything looks wrong.\n\nBest regards,\nElena Petrova\nPetrova Design Studio" },
  { id: "prize-1", from: "Prize Center <winner@prizes.example.net>", subject: "YOU WON a $500 gift card!!! Claim it today", day: 24, hour: 13, read: false, body: "Dear customer,\n\nYou are our lucky winner! Click the link below within 24 hours to claim your $500 gift card.\n\nPrize Center" },
  { id: "cactus-4", from: "Dana Ortiz <dana.ortiz@example.net>", subject: "[cactus-gardeners] Repotting in the heat?", day: 24, hour: 11, read: false, list: CACTUS_LIST, body: "I repotted mine in August and lost nothing. Wait for the soil to dry out fully first, and give them a week in the shade after.\n\nDana\n\n--\nCactus Gardeners mailing list\nhttps://lists.example.org/cactus-gardeners" },
  { id: "cactus-3", from: "Mei Lin <mei.lin@example.com>", subject: "[cactus-gardeners] Seed swap in December", day: 24, hour: 9, read: false, list: CACTUS_LIST, body: "The seed swap is on December 6 at the community garden. Bring labeled packets.\n\nMei" },
  { id: "cactus-2", from: "Carlos Mendez <carlos.mendez@example.net>", subject: "[cactus-gardeners] Best soil mix for barrels?", day: 23, hour: 18, read: true, list: CACTUS_LIST, body: "Half pumice, a quarter coarse sand, a quarter potting soil. Barrel cacti hate wet feet.\n\nCarlos" },
  { id: "cactus-1", from: "Hana Sato <hana.sato@example.org>", subject: "[cactus-gardeners] Photos from the fall show", day: 23, hour: 10, read: false, list: CACTUS_LIST, body: "The photos from the fall show are up on the list site. The golden barrel took first prize again.\n\nHana" },
  { id: "coffee-1", from: "Blue Mesa Coffee <receipts@bluemesa.example.com>", subject: "Receipt from Blue Mesa Coffee", day: 22, hour: 15, read: true, body: "Thank you for your visit.\n\n1 x Flat white    4.50\n1 x Croissant     3.25\n\nTotal            7.75\n\nBlue Mesa Coffee" },
  { id: NEWSLETTER_ID, from: "Trailhead Weekly <news@trailhead.example.com>", subject: "This week on the trail: five canyon loops", day: 22, hour: 12, read: false, html: true, list: "Trailhead Weekly <weekly.trailhead.example.com>", unsubscribe: `<mailto:${NEWSLETTER_UNSUBSCRIBE}?subject=unsubscribe>`, body: newsletter_html },
];

// Mail that arrives while the demo film shows the Trash, so the filter and sort keys have a full Inbox to reshape. All unread, newer than the Inbox above, three on one mailing list. The demo imports them through the e2e helper.
export const SHOTS_ARRIVALS = [
  { id: "trail-3", from: "Jonas Keller <jonas.keller@example.org>", subject: "[trail-maintainers] Volunteer day: Cholla Trail", day: 26, hour: 9, list: TRAIL_LIST, body: "We meet at the lower trailhead at 8:00 on Saturday. Bring gloves and water. Tools are provided.\n\nJonas" },
  { id: "offsite-1", from: "Jamal Brooks <jamal.brooks@example.com>", subject: "Team offsite: vote on the date", day: 26, hour: 8, body: "Hi all,\n\nPlease vote on the offsite date in the shared sheet by Friday:\n\n- March 12\n- March 19\n- March 26\n\nThanks,\nJamal" },
  { id: "trail-2", from: "Ana Flores <ana.flores@example.net>", subject: "[trail-maintainers] The loppers are back from repair", day: 26, hour: 7, list: TRAIL_LIST, body: "Both pairs of loppers are sharp again and back in the shed.\n\nAna" },
  { id: "dentist-1", from: "Smile Dental <reminders@smiledental.example.com>", subject: "Reminder: your appointment on Friday at 9:30", day: 26, hour: 6, body: "This is a reminder of your appointment on Friday, November 27 at 9:30.\n\nPlease arrive ten minutes early. To change the time, call the front desk.\n\nSmile Dental" },
  { id: "talk-3", from: "Tom O'Neill <tom.oneill@example.org>", subject: "Draft of the conference talk", day: 26, hour: 5, body: "Slide 12 is much clearer now. One last thought: cut the second demo and keep the time for questions.\n\nTom" },
  { id: "trail-1", from: "Jonas Keller <jonas.keller@example.org>", subject: "[trail-maintainers] Trail closure notice", day: 26, hour: 4, list: TRAIL_LIST, body: "The upper loop is closed until the washout is cleared. I will post the reopening date here.\n\nJonas" },
  { id: "permit-1", from: "City Services <noreply@city.example.org>", subject: "Parking permit renewal due December 1", day: 26, hour: 3, body: "Your residential parking permit expires on December 1.\n\nRenew online at the city website or at the service counter.\n\nCity Services" },
  { id: "photos-1", from: "Aisha Khan <aisha.khan@example.com>", subject: "Photos from the weekend", day: 26, hour: 2, body: "Sam,\n\nThe photos from the hike are in the shared album. The sunset one is my favorite. Let me know which ones you want printed.\n\nAisha" },
];

// The Receipts folder, the target of the move in the demo.
export const SHOTS_RECEIPTS = [
  { id: "books-1", from: "Canyon Books <orders@canyonbooks.example.com>", subject: "Your receipt from Canyon Books", day: 12, hour: 17, read: true, body: "1 x The Desert Naturalist's Handbook    24.00\n\nTotal    24.00\n\nCanyon Books" },
  { id: "transit-1", from: "Desert Line Transit <billing@desertline.example.org>", subject: "Receipt: monthly pass for November", day: 1, hour: 8, read: true, body: "Monthly pass, November 2026    45.00\n\nDesert Line Transit" },
];

function entry(message) {
  const time = new Date(Date.UTC(2026, 10, message.day, message.hour, 14));
  const [, sender_address] = message.from.match(/<(.+)>/);
  return [
    `From ${sender_address} ${time.toUTCString()}`,
    `X-Mozilla-Status: ${((message.read ? 1 : 0) | (message.starred ? 4 : 0)).toString(16).padStart(4, "0")}`,
    "X-Mozilla-Status2: 00000000",
    `Message-ID: <${message.id}@example.com>`,
    `Date: ${time.toUTCString().replace("GMT", "+0000")}`,
    `From: ${message.from}`,
    `To: ${SHOTS_USER.name} <${SHOTS_USER.address}>`,
    `Subject: ${message.subject}`,
    ...(message.list ? [`List-Id: ${message.list}`] : []),
    ...(message.unsubscribe ? [`List-Unsubscribe: ${message.unsubscribe}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: text/${message.html ? "html" : "plain"}; charset=UTF-8`,
    "",
    message.body,
    "",
    "",
  ].join("\n");
}

// Oldest first in the file, as an mbox grows.
const mbox_text = (messages) => [...messages].reverse().map(entry).join("");
export const shots_inbox_text = () => mbox_text(SHOTS_MESSAGES);
export const shots_receipts_text = () => mbox_text(SHOTS_RECEIPTS);
// One message file each, without the mbox lines, for an import into a folder.
export const shots_arrival_files = () => SHOTS_ARRIVALS.map((message) => entry(message).split("\n").filter((line) => !/^(From |X-Mozilla-Status)/.test(line)).join("\n"));
