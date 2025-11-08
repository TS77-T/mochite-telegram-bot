import express from "express";
import axios from "axios";
import twilio from "twilio";

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH;
const twilioClient = twilio(TWILIO_SID, TWILIO_AUTH);

// ✅ Always reply something for any request (Telegram expects 200)
app.all("*", async (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).send("OK");
  }
  next();
});

// ✅ Handle Telegram webhook POST
app.post("/", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text || "";

    // Only allow your own Telegram ID
    if (String(chatId) !== ALLOWED_USER_ID) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ You are not authorized to use this bot.",
      });
      return res.sendStatus(200);
    }

    // Parse Georgian format
    const match = text.match(/სახელი[:：]\s*(.+?)\s*,\s*ნომერი[:：]\s*(.+?)\s*,\s*ტექსტი[:：]\s*(.+)/i);
    if (!match) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❗გთხოვთ მიუთითოთ ფორმატი:\nსახელი: Test, ნომერი: +9955..., ტექსტი: გამარჯობა!",
      });
      return res.sendStatus(200);
    }

    const [, sender, number, body] = match;

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📤 იგზავნება SMS...\n📛 სახელი: ${sender}\n📱 ნომერი: ${number}\n💬 ტექსტი: ${body}`,
    });

    try {
      // ✅ Attempt to send SMS
      const msg = await twilioClient.messages.create({
        from: sender,
        to: number,
        body,
      });

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `✅ SMS გაგზავნილია წარმატებით!\nSID: ${msg.sid}`,
      });
    } catch (err) {
      console.error("Twilio error:", err.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `⚠️ Twilio შეცდომა: ${err.message}`,
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Handler error:", err.message);
    return res.sendStatus(200);
  }
});

export default app;
