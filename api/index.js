import express from "express";
import axios from "axios";
import twilio from "twilio";

const app = express();
app.use(express.json());

// handle GET and HEAD (Telegram sometimes pings webhook before sending JSON)
app.all("*", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).send("OK");
  }
  return next();
});

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH;
const twilioClient = twilio(TWILIO_SID, TWILIO_AUTH);

async function sendSMS(sender, to, text) {
  try {
    const message = await twilioClient.messages.create({
      from: sender,
      to,
      body: text,
    });
    return { success: true, sid: message.sid };
  } catch (err) {
    console.error("Twilio error:", err.message);
    return { success: false, error: err.message };
  }
}

app.post("/", async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (String(chatId) !== ALLOWED_USER_ID) {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "❌ You are not authorized to use this bot.",
    });
    return res.sendStatus(200);
  }

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

  const result = await sendSMS(sender, number, body);
  const reply = result.success
    ? `✅ SMS გაგზავნილია წარმატებით!\nSID: ${result.sid}`
    : `⚠️ Twilio შეცდომა: ${result.error}`;

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: reply,
  });

  res.sendStatus(200);
});

export default app;
