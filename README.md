# Holiday Coordinator

A texting assistant for hosting family gatherings. It sends the invitations, keeps track of who's coming by household, asks people to bring dishes, answers their questions from your plan, sends daily nudges to anyone who hasn't answered, and checks with you on anything it isn't sure about. You run it by texting it, and your family just texts it like a person.

It was built for a family Thanksgiving, but nothing in it is Thanksgiving-specific. A birthday dinner, a reunion, a holiday brunch or a potluck works the same way: you describe the occasion in a few plain files, and the assistant takes on a persona you choose ("Tom the Turkey 🦃" for Thanksgiving, someone else for the next occasion).

> **How it texts.** By default the assistant runs on a Mac through the **Messages app**: iPhone relatives get iMessages, and everyone else gets ordinary SMS relayed through an iPhone. It needs its own Apple ID and, for SMS, its own phone number (see [Setting up Messages](#setting-up-messages)). A WhatsApp mode is still there (`TRANSPORT=whatsapp`). It uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp client, which is against WhatsApp's terms and can get the number banned, so use it only with a spare number.

## What it's like

For your family, it's a contact that texts them:

> **Tom 🦃:** Hi Robin & Pat! You're invited to Thanksgiving 2026 at Alex & Sam's on Thursday, November 26, 123 Example St. Arrive between 10:00 and 11:00 AM. Will you be joining? Reply YES or NO. — Tom 🦃
>
> **Robin:** YES!
>
> **Tom 🦃:** Gobble gobble, that's great news! You and Pat are on the list. See you Thursday, arrive between 10 and 11. — Tom 🦃
>
> **Tom 🦃** (to Pat, a few seconds later): Hi Pat! Robin let me know you're both coming to Thanksgiving. See you there! … For Thanksgiving, could you please bring: • Spanakopita • Cranberry Sauce. Reply YES if you can do them all, tell me which ones work, or send me any questions.
>
> **Pat:** Yes to both. Can I bring my friend Dana too?
>
> **Tom 🦃:** Great, both are on the menu! Let me check with Alex about Dana and get back to you.

And for you, the host:

> **Tom 🦃:** #4 Pat Lee asks: Can Dana come too? Suggested reply: "Of course, the more the merrier!" Reply "#4 ok" to send it, or "#4 <your answer>".
>
> **You:** #4 ok
>
> **You:** status
>
> **Tom 🦃:** Thanksgiving 2026: 6 coming. Robin & Pat: yes (2) · Spanakopita ✅ · Cranberry Sauce ✅ …

## How an occasion flows

1. **Announce.** You text the bot `announce …`, and it texts an introduction to everyone (or posts it to a family group chat, if you set `GROUP_NAME`).
2. **Invite.** You text `rsvp`. Each household gets one invitation, addressed to everyone in it, or custom text for a household (for example, the people staying over the night before).
3. **Confirm.** When anyone replies YES, the bot confirms, lets the rest of their household know, and counts the whole household. Kids without phones are counted but never texted.
4. **Request.** Right after a yes, that household gets its dish requests: one message per person, listing what you've asked them to bring.
5. **Follow up.** Once a day, during daytime, anyone who hasn't RSVP'd or confirmed their dishes gets a short nudge. It stops after the event.
6. **Settle the details.** People confirm or decline dishes, ask for your recipe, offer new dishes for you to approve, and tell the bot oven temperatures. The plan updates itself as they do.

Anything the bot isn't sure about comes to you as a numbered question. Nothing about extra guests, new dishes or changes to the plan happens without your OK.

## Your plan lives in plain files

You describe the occasion in a private folder of plain text files, which you can edit at any time. The bot re-reads them on every message.

```
private/                              ← never committed to this repo; keep it in a private repo of its own
  .env                                API key, the bot's number, the family group's name
  family.yaml                         people, phones, households, dietary needs
  recipes/                            recipe files the bot can send
  holidays/<occasion>/
    persona.yaml                      who the bot is: name, tone, sign-off
    requests.yaml                     how each dish is worded when asking for it (carries over year to year)
    <year>/event.yaml                 date, address, invitations, ovens, and the menu
    <year>/plan.md                    your master plan and prep calendar (the bot answers from it)
    <year>/schedule.md                the day's timeline
    <year>/state.db                   RSVPs, messages, questions, audit log (written by the bot)
```

Pick the occasion with `HOLIDAY` and `YEAR` in `.env` (for example `HOLIDAY=thanksgiving`, `YEAR=2026`). A new occasion is a new folder.

**`family.yaml`** lists the host and everyone else, each with a phone number, a `household` (people who RSVP and are counted together) and optional `dietary` needs (e.g. `gluten-free`). Leave out the phone for children.

**`event.yaml`** holds:
- `planning`: what guests need up front (`arrival`, `address`, …). The invitation uses the date, the address and `arrival`.
- `invitations`: optional custom invitation text per household.
- `day_of: ovens`: the ovens you have, and which one is gluten-free only.
- `menu`: every dish and day-of task. Each entry has:

| Field | What it's for |
|---|---|
| `dish`, `description` | A short name, plus the specifics |
| `owner`, `status` | Who's making it (a name, or a list of names for a shared task), and where it stands: `Proposed` (not asked yet), `Requested` (asked), `Confirmed`. The bot updates the status as people reply |
| `plan` | What's needed up front: `serves`, `dietary`, `recipe` (a file in `recipes/`), `notes` |
| `shopping`, `prep_ahead`, `day_of` | What to buy, what to do before the day, and the day itself (starting with when it's served) |
| `oven` | Which oven, when, and the temperature. The bot asks guests for their temperatures |
| `fallback` | Who takes the dish if the owner says no |
| `confirm_on_rsvp` | For tasks that come with attending: never asked about, confirmed by the household's yes |
| `course: Task` | A day-of job ("Glaze the carrots at 1:33") rather than something to bring |

`examples/data/` has a small, complete example to copy from.

## Texting the bot

From the host's own phone:

| Text | What happens |
|---|---|
| `status` | Who's coming, who's bringing what, open questions |
| `announce <message>` | Posts to the family group in the persona's voice |
| `rsvp` | Invites every household that hasn't answered |
| `request` / `request <name>` | Sends dish requests to households that said yes (normally automatic), or just one person's household |
| `remind` | Sends any reminders that are due right now (normally once a day, automatically) |
| `#<n> ok` / `#<n> no` / `#<n> <answer>` | Answers a question the bot sent you, approves or turns down an offered dish |
| `tell <name>: <message>` | Sends your own words to someone through the bot |
| `ovens` | Each oven's lineup in time order, with temperatures |
| `temps` / `temp <dish> <°F> [minutes]` | Asks guests for missing oven temperatures, or sets one for your own dish |
| `changes` | The latest changes guests' messages made, and any messages it held back |

## Guardrails

Family members can't make the bot run code or change things they shouldn't:

- **Narrow actions only.** The AI can only reply, record an RSVP, confirm or decline its sender's own dishes, send a recipe you provided, propose a dish for you to approve, save dietary or oven details for its sender's own dishes, or ask you. Each is limited to the sender's own household.
- **Screening.** Every message is first checked by a small, fast model. Off-topic requests get a polite "I can only help with Thanksgiving plans". Anything suspicious (trying to change the bot's rules, asking for other people's details, acting for another household) gets no reply and comes to you.
- **Limits.** Each message can make only a few changes, each guest can have only a couple of pending dish ideas, text is trimmed, and auto-replies pause if one person sends too many messages.
- **No phone numbers out.** A reply containing a phone number is blocked and shown to you instead.
- **You stay informed.** You're told when someone changes a yes, declines a dish, or offers something that doesn't fit a family member's dietary needs. Every change is logged.

## Getting started

You'll need:
- Node 24 or newer
- an [Anthropic API key](https://console.anthropic.com)
- a Mac that stays on during the planning weeks
- an Apple ID for the assistant, and ideally a spare iPhone with its own number (see [Setting up Messages](#setting-up-messages))

```bash
npm install
mkdir -p private && cp -R examples/data/* private/ && cp examples/env.example private/.env
```

1. **Fill in the settings.** In `private/.env`, set `ANTHROPIC_API_KEY`. `TRANSPORT=messages` is the default. To post announcements to a group chat instead of texting everyone, set `GROUP_NAME` to the chat's exact name in Messages.
2. **Describe your occasion.** Edit `private/family.yaml` and the files under `private/holidays/`.
3. **Try it without sending anything.** These run messages through the real AI but don't send any texts or save anything:
   ```bash
   npm run hc -- simulate host "rsvp"
   ```
   ```bash
   npm run hc -- simulate "Aunt Sue" "what time should we get there?"
   ```
4. **Set up Messages** (below), then check the Mac can read and send texts:
   ```bash
   npm run hc -- check
   ```
5. **Start the bot:**
   ```bash
   npm run hc -- serve
   ```
6. **Text it `status`** from your own phone to check it's working. Then text yourself `tell <your name>: test` from the bot to check sending.

### Setting up Messages

The bot sends from whichever Apple ID is signed in to Messages on the Mac, and treats any text it sends as its own. So it needs **its own Apple ID**, separate from yours. Otherwise it would text your family as you, and your commands would look like its own messages.

1. **Give the assistant an identity.** Pick one:
   - **Best:** a spare iPhone with a prepaid SIM, signed in to the assistant's Apple ID. That reaches everyone: iPhones get iMessage, and Android phones get SMS through the spare iPhone. On that iPhone, go to Settings → Apps → Messages → Text Message Forwarding and turn on the Mac. Keep the iPhone charged and on Wi-Fi.
   - **iMessage only:** an Apple ID with just an email address. No extra phone is needed, but relatives without iPhones can't be reached.
2. **Sign the Mac in.** Messages is per macOS user. If your own Messages is signed in to your Apple ID, create a separate macOS user for the assistant (System Settings → Users & Groups), log in to it, and sign Messages in there with the assistant's Apple ID. Run the bot from that user. Fast User Switching keeps it running while you use your own account.
3. **Give permissions.** In that user, go to System Settings → Privacy & Security → Full Disk Access and add Terminal and node. To find node's real file, run `realpath $(which node)` and press ⌘⇧G in the file picker to paste the path. The first `npm run hc -- check` also asks to let Terminal control Messages; allow it.
4. **Tell people it's coming.** Ask everyone to save the assistant's number (or email) as a contact, so the first text isn't filtered as unknown.

If an iMessage can't be delivered (the person isn't on iMessage), the bot sends it again as SMS. After that, it uses SMS with that person.

### WhatsApp mode

Set `TRANSPORT=whatsapp`, `WA_BOT_PHONE` (a spare WhatsApp number, digits with country code) and `GROUP_NAME` (your family WhatsApp group, with the spare number added to it). `npm run hc -- serve` prints an 8-character code. On the spare phone, go to WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead", and enter it.

### Keeping it running

On a Mac, install it as a background service. It starts at login, restarts if it crashes, keeps the Mac awake while the display sleeps, and logs to `private/logs/bot.log`:

```bash
npm run bot:install
```

`bot:status`, `bot:logs`, `bot:restart` (after changing code) and `bot:uninstall` manage it. If it's offline for a while, it catches up on messages from the last 3 days when it reconnects.

A MacBook still sleeps when its lid closes. To run it lid-closed while plugged in, `sudo pmset -a disablesleep 1` keeps it awake. Turn that off again with `0` after the occasion. An always-on machine such as a Raspberry Pi also works, but the Messages mode needs a Mac.

## What it costs

- **AI:** each message the bot answers is a short Claude conversation plus a quick screening check, so a few cents at most. A whole holiday's back-and-forth with a family is typically a few dollars.
- **Everything else:** iMessage is free, and SMS costs whatever the spare iPhone's plan charges (a basic prepaid plan is plenty). You need a Mac that stays on.

## How it's built

TypeScript on Node with no build step:
- `src/agent.ts`: the conversation logic, built on Claude tool use
- `src/guard.ts`: screening and limits
- `src/transport.ts`: sending and receiving, whichever way the bot texts
- `src/imessage.ts`: the Mac Messages app (AppleScript to send, its database to receive)
- `src/whatsapp.ts`: the Baileys connection
- `src/config.ts`: reading and writing your YAML files, preserving your comments
- `src/db.ts`: SQLite for messages, RSVPs and questions

```bash
npm test
```

The tests use stand-ins for Claude, Messages and WhatsApp, so they're free and work offline.

## Limitations

- **Messages:** sending relies on AppleScript control of the Messages app, which Apple changes from time to time. Run `npm run hc -- check` after macOS updates. Group chats that mix iPhones and Android phones (MMS) are unreliable to post to, so leaving `GROUP_NAME` empty and texting individually is the safer default.
- **WhatsApp terms** (WhatsApp mode only): see the note at the top. A banned number would mean starting over with a new one.
- **One coordinator:** it's built around a single host texting commands.
- **Uptime:** replies only happen while the computer running it is on. Missed messages are caught up within 3 days.
- **Judgment:** the screening model can occasionally misjudge a message. Held messages come to you, and you can answer with `tell`.

## License

[MIT](LICENSE)
