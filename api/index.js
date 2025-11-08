import express from "express";
import axios from "axios";
import twilio from "twilio";

const app = express();
app.use(express.json());

// Load environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID; // your Telegram ID
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH;

// Twilio client
const twilioClient = twilio(TWILIO_SID, TWILIO_AUTH);

// Helper: send SMS via Twilio with ANY sender name
async function sendSMS(sender, to, text) {
  try {
    const message = await twilioClient.messages.create({
      from: sender, // ✅ custom alphanumeric sender name
      to,
      body: text,
    });
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error("Twilio Error:", error);
    return { success: false, error: error.message };
  }
}

// Telegram message handler
app.post("/", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text || "";

    // Allow only your Telegram account
    if (String(chatId) !== ALLOWED_USER_ID) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ You are not authorized to use this bot."
      });
      return res.sendStatus(200);
    }

    // Parse text format: სახელი: X, ნომერი: X, ტექსტი: X
    const match = text.match(/სახელი[:：]\s*(.+?)\s*,\s*ნომერი[:：]\s*(.+?)\s*,\s*ტექსტი[:：]\s*(.+)/i);
    if (!match) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❗გთხოვთ მიუთითოთ ფორმატი:\n\nსახელი: Test, ნომერი: +9955..., ტექსტი: გამარჯობა!"
      });
      return res.sendStatus(200);
    }

    const [, sender, number, body] = match;

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📤 იგზავნება SMS...\n\n📛 სახელი: ${sender}\n📱 ნომერი: ${number}\n💬 ტექსტი: ${body}`
    });

    // Send the SMS
    const result = await sendSMS(sender, number, body);

    if (result.success) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `✅ SMS გაგზავნილია წარმატებით!\nSID: ${result.sid}`
      });
    } else {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `⚠️ Twilio შეცდომა: ${result.error}`
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

export default app;

