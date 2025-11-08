import axios from "axios";
import twilio from "twilio";

/**
 * Telegram → Twilio SMS Bot (Vercel version)
 * Supports multi-line messages & both Georgian / English transliteration.
 */

function normalizeNumber(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let n = raw.trim().replace(/[\s()-]/g, "");
  if (/^0?5\d{8}$/.test(n)) {
    n = n.replace(/^0?/, "");
    n = `+995${n}`;
  }
  if (/^995\d+/.test(n)) n = `+${n}`;
  return n;
}

function parseMessageText(text) {
  if (!text) return null;
  const normalized = text.replace(/\r/g, "").trim();

  const quickPairs = {};
  const lines = normalized.split(/\n|,/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (m) {
      quickPairs[m[1].trim().toLowerCase()] = m[2].trim();
    }
  }

  const senderKeys = ["სახელი", "saxeli", "sxeli"];
  const numberKeys = ["ნომერი", "nomeri", "nomer", "number"];
  const textKeys = ["ტექსტი", "texti", "text", "teksti"];

  let sender, number, body;
  for (const [k, v] of Object.entries(quickPairs)) {
    if (!sender && senderKeys.includes(k)) sender = v;
    if (!number && numberKeys.includes(k)) number = v;
    if (!body && textKeys.includes(k)) body = v;
  }

  if (!sender || !number || !body) return null;
  return { sender, number, body };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const ALLOWED_USER_ID = String(process.env.ALLOWED_USER_ID || "");
  const TWILIO_SID = process.env.TWILIO_SID;
  const TWILIO_AUTH = process.env.TWILIO_AUTH;

  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  try {
    const message = req.body?.message;
    if (!message) return res.status(200).send("no message");

    const chatId = String(message.chat.id);
    const text = (message.text || "").trim();

    // Only allow owner
    if (ALLOWED_USER_ID && chatId !== ALLOWED_USER_ID) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ You are not authorized to use this bot."
      });
      return res.status(200).send("unauthorized");
    }

    // Parse message
    const parsed = parseMessageText(text);
    if (!parsed) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text:
`❗ Please use this format:

saxeli: Mochite
nomeri: +995514333113
texti: gamarjoba!

or

სახელი: Mochite, ნომერი: +995514333113, ტექსტი: გამარჯობა!`
      });
      return res.status(200).send("bad format");
    }

    const sender = parsed.sender.trim();
    const number = normalizeNumber(parsed.number.trim());
    let messageText = parsed.body.trim();

    // ✅ Fix Twilio line break issue — replace newlines with spaces
    messageText = messageText.replace(/\r?\n+/g, " ").trim();

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📤 იგზავნება SMS...\n\n📛 Sender: ${sender}\n📱 Number: ${number}\n💬 Message: ${messageText}`
    });

    const client = twilio(TWILIO_SID, TWILIO_AUTH);

    try {
      const tw = await client.messages.create({
        from: sender,
        to: number,
        body: messageText
      });

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `✅ SMS sent successfully!\nSID: ${tw.sid}`
      });
      return res.status(200).send("sent");
    } catch (e) {
      console.error("Twilio error:", e.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `⚠️ Twilio error: ${e.message}`
      });
      return res.status(200).send("twilio error");
    }

  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(200).send("error");
  }
}
