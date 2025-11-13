export default async function handler(req, res) {
  try {
    console.log("Function invoked:", req.method);

    // Confirm server is alive
    if (req.method !== "POST") {
      return res.status(200).send("✅ Serverless function is alive! Use POST for Telegram webhook.");
    }

    // Telegram webhook test
    const body = req.body || {};
    console.log("Request body:", body);

    const token = process.env.TELEGRAM_TOKEN;
    const chatId = body?.message?.chat?.id;
    const text = body?.message?.text || "(no text)";

    if (!token) {
      console.error("Missing TELEGRAM_TOKEN in environment!");
      return res.status(500).send("Missing TELEGRAM_TOKEN");
    }

    if (!chatId) {
      console.log("No chatId, probably not from Telegram.");
      return res.status(200).send("No chatId in body");
    }

    // Reply to Telegram
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `✅ Webhook working!\nText received:\n${text}`
      })
    });

    console.log("Telegram API status:", response.status);
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Handler crash:", error);
    return res.status(500).send("Internal server error: " + error.message);
  }
}
