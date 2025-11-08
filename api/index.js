import twilio from "twilio";
import axios from "axios";

export default async function handler(req, res) {
  // Always acknowledge Telegram first
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
    const TWILIO_SID = process.env.TWILIO_SID;
    const TWILIO_AUTH = process.env.TWILIO_AUTH;

    const telegramApi = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    const client = twilio(TWILIO_SID, TWILIO_AUTH);

    const msg = req.body.message;
    if (!msg) return res.status(200).send("no message");

    const chatId = msg.chat.id.toString();
    const text = msg.text || "";

    // authorize
    if (chatId !== ALLOWED_USER_ID) {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: "❌ You are not authorized.",
      });
      return res.status(200).send("unauthorized");
    }

    // parse Georgian format
    const match = text.match(/სახელი[:：]\s*(.+?)\s*,\s*ნომერი[:：]\s*(.+?)\s*,\s*ტექსტი[:：]\s*(.+)/i);
    if (!match) {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: "❗ფორმატი: სახელი: Test, ნომერი: +9955..., ტექსტი: გამარჯობა!",
      });
      return res.status(200).send("bad format");
    }

    const [, sender, number, body] = match;
    await axios.post(`${telegramApi}/sendMessage`, {
      chat_id: chatId,
      text: `📤 იგზავნება SMS...\n📛 ${sender}\n📱 ${number}\n💬 ${body}`,
    });

    try {
      const r = await client.messages.create({ from: sender, to: number, body });
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: `✅ გაგზავნილია!\nSID: ${r.sid}`,
      });
    } catch (e) {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: `⚠️ Twilio შეცდომა: ${e.message}`,
      });
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    return res.status(200).send("error");
  }
}
