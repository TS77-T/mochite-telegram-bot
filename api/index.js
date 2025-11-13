import axios from "axios";
import twilio from "twilio";

// Normalize Georgian numbers to +9955...
function normalizeNumber(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let n = raw.trim().replace(/[\s()-]/g, "");
  if (/^0?5\d{8}$/.test(n)) n = `+995${n.replace(/^0?/, "")}`;
  if (/^995\d+/.test(n)) n = `+${n}`;
  return n;
}

// Parse both Georgian & transliterated formats
function parseMessageText(text) {
  if (!text) return null;
  const quickPairs = {};
  const lines = text.split(/\n|,/).map(s => s.trim()).filter(Boolean);
  for (const l of lines) {
    const m = l.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (m) quickPairs[m[1].trim().toLowerCase()] = m[2].trim();
  }

  const senderKeys = ["სახელი", "saxeli", "sxeli"];
  const numberKeys = ["ნომერი", "nomeri", "number"];
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
    const msg = req.body?.message;
    if (!msg) return res.status(200).send("no message");
    const chatId = String(msg.chat.id);
    const text = (msg.text || "").trim();

    // Authorize only your ID
    if (ALLOWED_USER_ID && chatId !== ALLOWED_USER_ID) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ You are not authorized to use this bot."
      });
      return res.status(200).send("unauthorized");
    }

    const parsed = parseMessageText(text);
    if (!parsed) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text:
`❗ Use format:

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

    // ✅ Convert all types of line breaks to a single newline escape that Twilio accepts
    const messageText = parsed.body
      .replace(/\r/g, "")      // remove carriage returns
      .replace(/\n{2,}/g, "\n") // collapse multiple line breaks
      .trim();

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📤 იგზავნება SMS...\n\n📛 Sender: ${sender}\n📱 Number: ${number}\n💬 Message:\n${messageText}`
    });

    const client = twilio(TWILIO_SID, TWILIO_AUTH);

    // ✅ Ensure body is a full UTF-8 string (no truncation)
    const fullBody = Buffer.from(messageText, "utf8").toString();

    const tw = await client.messages.create({
      from: sender,
      to: number,
      body: fullBody
    });

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `✅ SMS sent successfully!\nSID: ${tw.sid}`
    });

    return res.status(200).send("sent");
  } catch (err) {
    console.error("Error:", err.message);
    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
    const chatId = req.body?.message?.chat?.id;
    if (chatId) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `⚠️ Error: ${err.message}`
      }).catch(() => {});
    }
    return res.status(200).send("error");
  }
}
