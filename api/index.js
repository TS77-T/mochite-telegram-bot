import axios from "axios";
import fetch from "node-fetch";

/**
 * Telegram → Twilio full version (multiline + debug)
 */

function normalizeNumber(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let n = raw.trim().replace(/[\s()-]/g, "");
  if (/^0?5\d{8}$/.test(n)) n = `+995${n.replace(/^0?/, "")}`;
  if (/^995\d+/.test(n)) n = `+${n}`;
  return n;
}

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

  const sendToTelegram = async (chatId, text) => {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text
    }).catch(() => {});
  };

  try {
    const msg = req.body?.message;
    if (!msg) return res.status(200).send("no message");
    const chatId = String(msg.chat.id);
    const text = (msg.text || "").trim();

    if (ALLOWED_USER_ID && chatId !== ALLOWED_USER_ID) {
      await sendToTelegram(chatId, "❌ You are not authorized to use this bot.");
      return res.status(200).send("unauthorized");
    }

    const parsed = parseMessageText(text);
    if (!parsed) {
      await sendToTelegram(chatId,
`❗ Format example:

saxeli: Mochite
nomeri: +995514333113
texti: gamarjoba!

or

სახელი: Mochite, ნომერი: +995514333113, ტექსტი: გამარჯობა!`);
      return res.status(200).send("bad format");
    }

    const sender = parsed.sender.trim();
    const number = normalizeNumber(parsed.number.trim());
    const messageText = parsed.body.replace(/\r/g, "").trim();

    await sendToTelegram(chatId, `📤 იგზავნება SMS...\n📛 Sender: ${sender}\n📱 Number: ${number}\n💬 Message:\n${messageText}`);

    // --- Raw Twilio API call ---
    const authHeader = Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString("base64");
    const params = new URLSearchParams({
      From: sender,
      To: number,
      Body: messageText
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const data = await response.json();

    if (!response.ok || data.error_code) {
      console.error("Twilio error:", data);
      await sendToTelegram(
        chatId,
        `⚠️ Twilio Error:\nStatus: ${response.status}\nMessage: ${data.message || "Unknown"}\nCode: ${data.error_code || "none"}`
      );
      return res.status(200).send("twilio error");
    }

    await sendToTelegram(chatId, `✅ SMS sent!\nSID: ${data.sid}\nStatus: ${data.status}`);
    return res.status(200).send("sent");

  } catch (err) {
    console.error("Error:", err);
    const chatId = req.body?.message?.chat?.id;
    if (chatId) await sendToTelegram(chatId, `⚠️ Internal error: ${err.message}`);
    return res.status(200).send("error");
  }
}
