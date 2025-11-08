import axios from "axios";
import twilio from "twilio";

/**
 * Vercel-style serverless handler
 *
 * Expected message formats (either style—commas or newlines):
 *
 * Georgian:
 *   სახელი: Mochite, ნომერი: +995514333113, ტექსტი: გამარჯობა!
 *
 * Transliteration:
 *   saxeli: Mochite
 *   nomeri: +995514333113
 *   texti: gamarjoba!
 *
 * Environment variables required in Vercel:
 * - TELEGRAM_TOKEN    (bot token, e.g. 123:AA...)
 * - ALLOWED_USER_ID   (your numeric Telegram user id, e.g. 123456789)
 * - TWILIO_SID
 * - TWILIO_AUTH
 *
 * Notes:
 * - This attempts to send using the provided 'from' (sender) string.
 * - Phone normalization handles a few common Georgian formats.
 */

function normalizeNumber(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let n = raw.trim();
  // remove spaces, parentheses, dashes
  n = n.replace(/[\s()-]/g, "");
  // If it starts with 0 and then 5xx or 5..., convert 0XXXXXXXX to +995XXXXXXXXX
  if (/^0?5\d{8}$/.test(n)) {
    // If it starts with 0 then drop 0 and prepend +995, else if just starts with 5 (9 digits) prepend +995
    n = n.replace(/^0?/, "");
    n = `+995${n}`;
  }
  // If it starts with 995 (without +), add +
  if (/^995\d+/.test(n)) {
    n = `+${n}`;
  }
  // If it already starts with + and digits, keep as is.
  return n;
}

function parseMessageText(text) {
  if (!text || typeof text !== "string") return null;

  // Normalize newlines and commas to a common separator
  const normalized = text.replace(/\r/g, "").trim();

  // Combined regex to accept Georgian keys or transliteration keys.
  // Allows separators either commas or newlines or both.
  // Captures three groups: sender, number, message body.
  const re = /(?:ს*h?axeli|სახელი|saxeli)\s*[:：]\s*(.+?)\s*(?:,|\n)\s*(?:ნომერი|nomeri)\s*[:：]\s*(.+?)\s*(?:,|\n)\s*(?:ტექსტი|texti)\s*[:：]\s*([\s\S]+)/i;

  // Try a more flexible approach: try to find key:value pairs individually
  const quickPairs = {};
  // split by lines first
  const lines = normalized.split(/\n|,/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (m) {
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      quickPairs[key] = val;
    }
  }

  // Possible keys map (lowercase)
  const senderKeys = ["სახელი", "saxeli", "saxeli", "sxeli"].map(k => k.toLowerCase());
  const numberKeys = ["ნომერი", "nomeri", "nomer", "number"].map(k => k.toLowerCase());
  const textKeys = ["ტექსტი", "texti", "text", "teksti"].map(k => k.toLowerCase());

  // Try quickPairs first
  let sender = null, number = null, body = null;
  for (const k of Object.keys(quickPairs)) {
    if (!sender && senderKeys.includes(k)) sender = quickPairs[k];
    if (!number && numberKeys.includes(k)) number = quickPairs[k];
    if (!body && textKeys.includes(k)) body = quickPairs[k];
  }

  // If quickPairs didn't find everything, fallback to single-regex
  if (!sender || !number || !body) {
    const m = normalized.match(re);
    if (m) {
      sender = sender || m[1].trim();
      number = number || m[2].trim();
      body = body || m[3].trim();
    }
  }

  if (!sender || !number || !body) return null;
  return { sender, number, body };
}

export default async function handler(req, res) {
  // Always return 200 quickly for non-POSTs so Telegram's test pings don't break.
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // Read env
  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const ALLOWED_USER_ID = String(process.env.ALLOWED_USER_ID || "");
  const TWILIO_SID = process.env.TWILIO_SID;
  const TWILIO_AUTH = process.env.TWILIO_AUTH;

  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  // Validate essential env vars
  if (!TELEGRAM_TOKEN || !ALLOWED_USER_ID || !TWILIO_SID || !TWILIO_AUTH) {
    console.error("Missing required environment variables.");
    // still acknowledge Telegram
    return res.status(200).send("missing env");
  }

  try {
    const body = req.body || {};
    const message = body.message || body.edited_message || null;
    if (!message) {
      // nothing to do
      return res.status(200).send("no message");
    }

    const chatId = String(message.chat && message.chat.id ? message.chat.id : "");
    if (!chatId) return res.status(200).send("no chat");

    // Authorization: allow only owner
    if (ALLOWED_USER_ID && chatId !== ALLOWED_USER_ID) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ You are not authorized to use this bot."
      }).catch(()=>{});
      return res.status(200).send("unauthorized");
    }

    const text = (message.text || "").trim();
    const parsed = parseMessageText(text);

    if (!parsed) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text:
`❗ Unknown format. Use either (Georgian) or (transliteration):
saxeli: Mochite
nomeri: +995514333113
texti: gamarjoba!

OR

სახელი: Mochite, ნომერი: +995514333113, ტექსტი: გამარჯობა!`
      }).catch(()=>{});
      return res.status(200).send("bad format");
    }

    // normalize number
    const sender = parsed.sender.trim();
    const number = normalizeNumber(parsed.number.trim());
    const messageText = parsed.body.trim();

    // Inform user in Telegram that sending starts
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📤 Sending SMS...\n\n📛 Sender: ${sender}\n📱 Number: ${number}\n💬 Message: ${messageText}`
    }).catch(()=>{});

    // Send via Twilio
    const client = twilio(TWILIO_SID, TWILIO_AUTH);

    try {
      // Attempt sending using Twilio SDK (from field set to the provided sender)
      const tw = await client.messages.create({
        from: sender,
        to: number,
        body: messageText
      });

      // Report success
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `✅ SMS sent!\nSID: ${tw.sid}`
      }).catch(()=>{});

      return res.status(200).send("sent");
    } catch (twErr) {
      console.error("Twilio error:", twErr && twErr.message ? twErr.message : twErr);
      // Tell user Twilio failed (use Twilio message if present)
      const errMsg = (twErr && twErr.message) ? twErr.message : String(twErr);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `⚠️ Twilio error: ${errMsg}`
      }).catch(()=>{});
      return res.status(200).send("twilio error");
    }
  } catch (err) {
    console.error("Handler unexpected error:", err);
    // best-effort notify user
    try {
      const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
      if (TELEGRAM_TOKEN) {
        const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
        const chatId = (req.body && req.body.message && req.body.message.chat && req.body.message.chat.id) ? req.body.message.chat.id : null;
        if (chatId) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `⚠️ Internal error: ${err && err.message ? err.message : "unknown"}`
          }).catch(()=>{});
        }
      }
    } catch (_) {}
    return res.status(200).send("error");
  }
}

