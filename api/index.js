import express from "express";
import axios from "axios";
import twilio from "twilio";

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID; // your Telegram ID
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH;
const twilioClient = twilio(TWILIO_SID, TWILIO_AUTH);

// Function to send SMS via Twilio
async function sendSMS(from, to, text) {
  return await twilioClient.messages.create({
    from, // custom sender name
    to,
    body: text,
  });
}

// Handle Telegram messages
app.post("/", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text || "";

    if (String(chatId) !== ALLOWED_USER_ID) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ You are not authorized to use this bot."
      });
      return res.sendStatus(200);
    }

    // Expected format: სახელი: X, ნომერი: X, ტექსტი: X
    const match = text.match(/სახელი[:：]\s*(.+?)\s*,\s*ნომერი[:：]\s*(.+?)\s*,\s*ტექსტი[:：]\s*(.+)/i);
    if (!match) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❗გთხოვთ მიუთითოთ ფორმატი:\nსახელი: Test, ნომერი: +9955..., ტექსტი: გამარჯობა!"
      });
      return res.sendStatus(200);
    }

    const [, sender, number, body] = match;
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📤 იგზავნება SMS...\n\n📛 სახელი: ${sender}\n📱 ნომერი: ${number}\n💬 ტექსტი: ${body}`
    });

    const result = await sendSMS(sender, number, body);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `✅ SMS გაგზავნილია!\nSID: ${result.sid}`
    });

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

export default app;
