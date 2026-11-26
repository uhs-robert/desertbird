// The Inbox of the `shots` profile kind: mail that reads like a real inbox, for the screenshots of the README and the store listing.
// Senders are fictional and use the reserved example domains. The other kinds keep the plain `Thread n` fixture, which the checks count on.

export const SHOTS_USER = { name: "Sam Rivera", address: "sam.rivera@example.com" };

const CACTUS_LIST = "Cactus Gardeners <cactus-gardeners.lists.example.org>";
const TRAIL_LIST = "Trail Maintainers <trail-maintainers.lists.example.org>";

// The HTML newsletter holds the links the body hint shot labels.
export const NEWSLETTER_ID = "trailhead-weekly-47";
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
<p style="font-size: 0.85em; color: #666666;">You get this issue because you subscribed at trailhead.example.com. <a href="https://trailhead.example.com/prefs">Change your preferences</a> or <a href="https://trailhead.example.com/unsubscribe">unsubscribe</a>.</p>
</body></html>`;

// Newest first in the list. `day` and `hour` are UTC in November 2026. `read` false is bold in the list.
export const SHOTS_MESSAGES = [
  { id: "roadmap-1", from: "Priya Raman <priya.raman@example.com>", subject: "Q4 roadmap review: agenda and notes", day: 25, hour: 8, read: false, starred: true, body: "Hi Sam,\n\nHere is the agenda for Thursday's roadmap review.\n\n1. Where the migration stands\n2. What slips into January\n3. The two requests from support\n\nI put last week's notes in the shared folder. Please add anything I missed before the meeting.\n\nThanks,\nPriya" },
  { id: "lunch-1", from: "Marcus Webb <marcus.webb@example.org>", subject: "Lunch on Thursday?", day: 25, hour: 7, read: false, body: "Sam,\n\nAre you free for lunch on Thursday? The new noodle place on Fourth Street opened last week and I hear the line is short before noon.\n\nMarcus" },
  { id: "cactus-4", from: "Dana Ortiz <dana.ortiz@example.net>", subject: "[cactus-gardeners] Re: Repotting in the heat?", day: 24, hour: 21, read: false, list: CACTUS_LIST, refs: ["cactus-1", "cactus-2"], body: "I repotted mine in August and lost nothing. Wait for the soil to dry out fully first, and give them a week in the shade after.\n\nDana\n\n--\nCactus Gardeners mailing list\nhttps://lists.example.org/cactus-gardeners" },
  { id: "invoice-1", from: "Elena Petrova <elena.petrova@example.net>", subject: "Invoice 2026-1142 for November", day: 24, hour: 16, read: true, starred: true, body: "Hello Sam,\n\nThe invoice for November is attached to this message as a PDF. The amount is due within 30 days.\n\nPlease tell me if anything looks wrong.\n\nBest regards,\nElena Petrova\nPetrova Design Studio" },
  { id: NEWSLETTER_ID, from: "Trailhead Weekly <news@trailhead.example.com>", subject: "This week on the trail: five canyon loops", day: 24, hour: 12, read: false, html: true, body: newsletter_html },
  { id: "talk-3", from: "Tom O'Neill <tom.oneill@example.org>", subject: "Re: Draft of the conference talk", day: 23, hour: 18, read: false, refs: ["talk-1", "talk-2"], body: "Slide 12 is much clearer now. One last thought: cut the second demo and keep the time for questions.\n\nTom" },
  { id: "ci-1", from: "Build Server <ci@builds.example.com>", subject: "Build 482 passed on main", day: 23, hour: 15, read: true, body: "Build 482 passed.\n\nBranch: main\nCommit: 3f9a1c2\nDuration: 4 min 12 s\n\nThis message was sent by the build server at builds.example.com." },
  { id: "photos-1", from: "Aisha Khan <aisha.khan@example.com>", subject: "Photos from the weekend", day: 22, hour: 19, read: true, body: "Sam,\n\nHere is the link to the photos from the hike: https://photos.example.com/albums/weekend-hike\n\nThe sunset one is my favorite. Let me know which ones you want printed.\n\nAisha" },
  { id: "trail-2", from: "Jonas Keller <jonas.keller@example.org>", subject: "[trail-maintainers] Volunteer day: Cholla Trail", day: 21, hour: 17, read: false, list: TRAIL_LIST, refs: ["trail-1"], body: "We meet at the lower trailhead at 8:00 on Saturday. Bring gloves and water. Tools are provided.\n\nJonas" },
  { id: "cactus-3", from: "Mei Lin <mei.lin@example.com>", subject: "[cactus-gardeners] Re: Repotting in the heat?", day: 21, hour: 9, read: true, list: CACTUS_LIST, refs: ["cactus-1", "cactus-2"], body: "I would wait until October. The roots stay calmer when the nights cool down.\n\nMei" },
  { id: "library-1", from: "Maple Street Library <notices@library.example.org>", subject: "Your hold is ready for pickup", day: 20, hour: 14, read: true, body: "Your hold is ready.\n\nTitle: The Desert Naturalist's Handbook\nPickup by: November 30\n\nMaple Street Library\nOpen Monday to Saturday, 9:00 to 18:00" },
  { id: "talk-2", from: "Sam Rivera <sam.rivera@example.com>", subject: "Re: Draft of the conference talk", day: 19, hour: 16, read: true, refs: ["talk-1"], body: "Thanks Tom. I tightened the opening and added a diagram on slide 12. New draft is in the shared folder.\n\nSam" },
  { id: "cactus-2", from: "Carlos Mendez <carlos.mendez@example.net>", subject: "[cactus-gardeners] Re: Repotting in the heat?", day: 19, hour: 11, read: true, list: CACTUS_LIST, refs: ["cactus-1"], body: "Depends on the species. Barrel cacti hate being disturbed in summer.\n\nCarlos" },
  { id: "talk-1", from: "Tom O'Neill <tom.oneill@example.org>", subject: "Draft of the conference talk", day: 18, hour: 10, read: true, body: "Sam,\n\nI read through the draft. The structure works. I have a few notes on the second half, mostly about pacing. Can we talk after the stand-up?\n\nTom" },
  { id: "cactus-1", from: "Hana Sato <hana.sato@example.org>", subject: "[cactus-gardeners] Repotting in the heat?", day: 18, hour: 8, read: true, list: CACTUS_LIST, body: "My cacti outgrew their pots over the summer. Is it too hot to repot now, or should I wait for autumn?\n\nHana" },
  { id: "trail-1", from: "Jonas Keller <jonas.keller@example.org>", subject: "[trail-maintainers] Trail closure notice", day: 17, hour: 12, read: true, list: TRAIL_LIST, body: "The upper loop is closed until the washout is cleared. I will post the reopening date here.\n\nJonas" },
  { id: "standup-1", from: "Priya Raman <priya.raman@example.com>", subject: "Standup notes for Tuesday", day: 24, hour: 14, read: true, body: "Notes from Tuesday's standup:\n\n- The migration is on track for the 4th\n- Support asked for two small fixes\n- Jamal is out Thursday\n\nPriya" },
  { id: "dentist-1", from: "Smile Dental <reminders@smiledental.example.com>", subject: "Reminder: your appointment on Friday at 9:30", day: 24, hour: 9, read: false, body: "This is a reminder of your appointment on Friday, November 27 at 9:30.\n\nPlease arrive ten minutes early. To change the time, call the front desk.\n\nSmile Dental" },
  { id: "order-1", from: "Mesa Outfitters <orders@mesaoutfitters.example.com>", subject: "Your order has shipped", day: 23, hour: 20, read: true, body: "Good news: order 88213 is on its way.\n\n1 x Trail shell, size M\n1 x Wool socks (2 pack)\n\nExpected delivery: November 28.\n\nMesa Outfitters" },
  { id: "offsite-1", from: "Jamal Brooks <jamal.brooks@example.com>", subject: "Team offsite: vote on the date", day: 23, hour: 13, read: false, body: "Hi all,\n\nPlease vote on the offsite date in the shared sheet by Friday:\n\n- March 12\n- March 19\n- March 26\n\nThanks,\nJamal" },
  { id: "coffee-1", from: "Blue Mesa Coffee <receipts@bluemesa.example.com>", subject: "Receipt from Blue Mesa Coffee", day: 22, hour: 15, read: true, body: "Thank you for your visit.\n\n1 x Flat white    4.50\n1 x Croissant     3.25\n\nTotal            7.75\n\nBlue Mesa Coffee" },
  { id: "bookclub-1", from: "Aisha Khan <aisha.khan@example.com>", subject: "Book club pick for December", day: 21, hour: 21, read: true, body: "Sam,\n\nWe have two finalists for December: a desert travel memoir and a short mystery. Tell me which one you would rather read.\n\nAisha" },
  { id: "permit-1", from: "City Services <noreply@city.example.org>", subject: "Parking permit renewal due December 1", day: 20, hour: 9, read: false, body: "Your residential parking permit expires on December 1.\n\nRenew online at https://city.example.org/permits or at the service counter.\n\nCity Services" },
  { id: "slides-1", from: "Priya Raman <priya.raman@example.com>", subject: "Slides for Thursday", day: 19, hour: 13, read: true, starred: true, body: "Sam,\n\nThe slides for Thursday are in the shared folder. Can you check the numbers on slide 6?\n\nPriya" },
  { id: "welcome-1", from: "Jamal Brooks <jamal.brooks@example.com>", subject: "Welcome to the team", day: 18, hour: 15, read: true, body: "Hi Sam,\n\nThanks for the warm welcome last week. I put together a short list of questions about the release process. Do you have 20 minutes this week?\n\nJamal" },
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
    ...(message.refs ? [`In-Reply-To: <${message.refs.at(-1)}@example.com>`, `References: ${message.refs.map((ref) => `<${ref}@example.com>`).join(" ")}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: text/${message.html ? "html" : "plain"}; charset=UTF-8`,
    "",
    message.body,
    "",
    "",
  ].join("\n");
}

// Oldest first in the file, as an mbox grows.
export const shots_inbox_text = () => [...SHOTS_MESSAGES].reverse().map(entry).join("");
