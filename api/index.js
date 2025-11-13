export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(200).send("✅ Alive and waiting for Telegram POST.");

  // === Environment Variables ===
  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  const TWILIO_SID = process.env.TWILIO_SID;
  const TWILIO_AUTH = process.env.TWILIO_AUTH;
  const ALLOWED_USER_ID = String(process.env.ALLOWED_USER_ID || "");
  const TWILIO_NUMBER = process.env.TWILIO_NUMBER; // optional fallback

  const chatId = req.body?.message?.chat?.id;
  const text = req.body?.message?.text || "";

  // === Helper to reply to Telegram ===
  async function reply(t) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: t }),
    }).catch(() => {});
  }

  // === Normalize phone numbers ===
  function normalizeNumber(raw) {
    if (!raw || typeof raw !== "string") return raw;
    let n = raw.trim().replace(/[\s()-]/g, "");
    if (/^0?5\d{8}$/.test(n)) n = `+995${n.replace(/^0?/, "")}`;
    if (/^995\d+/.test(n)) n = `+${n}`;
    return n;
  }

  // === Parse message text ===
  function parseMessageText(txt) {
    if (!txt) return null;
    const lines = txt.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    const kv = {};
    for (const line of lines) {
      const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
      if (m) kv[m[1].trim().toLowerCase()] = m[2].trim();
    }
    const sender =
      kv["saxeli"] || kv["სახელი"] || kv["sender"] || kv["name"] || null;
    const number =
      kv["nomeri"] || kv["ნომერი"] || kv["number"] || kv["to"] || null;
    const body =
      kv["texti"] || kv["ტექსტი"] || kv["text"] || kv["body"] || null;
    if (!sender || !number || !body) return null;
    return { sender, number, body };
  }

  try {
    if (!chatId) return res.status(200).send("no chat");

    // === Authorization check (type-safe) ===
    if (ALLOWED_USER_ID && String(chatId).trim() !== String(ALLOWED_USER_ID).trim()) {
      await reply(`❌ Not authorized.\nYour chatId: ${chatId}\nAllowed: ${ALLOWED_USER_ID}`);
      return res.status(200).send("unauthorized");
    }

    // === Parse message content ===
    const parsed = parseMessageText(text);
    if (!parsed) {
      await reply(
        "❗ Format example:\n\nsaxeli: Mochite\nnomeri: +995514333113\ntexti: გამარჯობა!\nმეორე ხაზი ✅"
      );
      return res.status(200).send("bad format");
    }

    const sender = parsed.sender.trim();
    const number = normalizeNumber(parsed.number.trim());
    let messageText = parsed.body.replace(/\r/g, "").trim();
    messageText = messageText.replace(/\n{2,}/g, "\n");

    await reply(
      `📤 იგზავნება SMS...\n📛 Sender: ${sender}\n📱 Number: ${number}\n💬 Message:\n${messageText}`
    );

    // === Twilio send (Unicode-safe, multi-line) ===
    const authHeader = Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString("base64");

    const params = new URLSearchParams({
      From: sender,
      To: number,
      Body: messageText,
      SmartEncoding: "false", // ensures Unicode is sent directly
    });

    let twilioResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: params,
      }
    );
    let data = await twilioResp.json();

    // === Fallback if alphanumeric sender fails ===
    if (!twilioResp.ok || data.error_code) {
      if (TWILIO_NUMBER) {
        await reply(
          `⚠️ Sender '${sender}' may not be supported. Retrying from number ${TWILIO_NUMBER}...`
        );

        const retryParams = new URLSearchParams({
          From: TWILIO_NUMBER,
          To: number,
          Body: messageText,
          SmartEncoding: "false",
        });

        const retryResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${authHeader}`,
              "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            },
            body: retryParams,
          }
        );

        data = await retryResp.json();
      }
    }

    // === Result feedback ===
    if (data.error_code) {
      await reply(
        `⚠️ Twilio Error:\nMessage: ${data.message}\nCode: ${data.error_code}`
      );
    } else {
      await reply(
        `✅ SMS sent!\nSID: ${data.sid || "unknown"}\nStatus: ${data.status}`
      );
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("Crash:", err);
    if (chatId) await reply("⚠️ Internal error: " + err.message);
    return res.status(200).send("error");
  }
}
