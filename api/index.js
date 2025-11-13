export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(200).send("✅ Alive and waiting for Telegram POST.");

  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  const TWILIO_SID = process.env.TWILIO_SID;
  const TWILIO_AUTH = process.env.TWILIO_AUTH;
  const ALLOWED_USER_ID = String(process.env.ALLOWED_USER_ID || "");
  const TWILIO_NUMBER = process.env.TWILIO_NUMBER;

  const chatId = req.body?.message?.chat?.id;
  const text = req.body?.message?.text || "";

  async function reply(t) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: t }),
    }).catch(() => {});
  }

  // extract text between labels (like your old bot)
  function extractBetween(src, startLabel, nextLabels = []) {
    const start = src.indexOf(startLabel);
    if (start === -1) return "";
    const from = start + startLabel.length;

    let to = src.length;
    for (const label of nextLabels) {
      const idx = src.indexOf(label, from);
      if (idx !== -1 && idx < to) to = idx;
    }
    return src.slice(from, to).trim();
  }

  try {
    if (!chatId) return res.status(200).send("no chat");

    // ✅ fixed string-safe auth check
    if (ALLOWED_USER_ID && String(chatId).trim() !== String(ALLOWED_USER_ID).trim()) {
      await reply(`❌ Not authorized.\nYour chatId: ${chatId}\nAllowed: ${ALLOWED_USER_ID}`);
      return res.status(200).send("unauthorized");
    }

    // accept both Georgian and English labels
    const sender = extractBetween(text, "saxeli:", ["nomeri:", "ნომერი:", "texti:", "ტექსტი:"]) ||
                   extractBetween(text, "სახელი:", ["nomeri:", "ნომერი:", "texti:", "ტექსტი:"]);
    const number = extractBetween(text, "nomeri:", ["texti:", "ტექსტი:"]) ||
                   extractBetween(text, "ნომერი:", ["texti:", "ტექსტი:"]);
    const messageText = extractBetween(text, "texti:", []) ||
                        extractBetween(text, "ტექსტი:", []);

    if (!sender || !number || !messageText) {
      await reply(
        "❗ Format example:\n\nsaxeli: Mochite\nnomeri: +995514333113\ntexti: გამარჯობა დეა, როგორ გიკითხოთ ხო ხართ კარგად? ✅"
      );
      return res.status(200).send("bad format");
    }

    const authHeader = Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString("base64");

    // normalize Georgian numbers
    let to = number.trim().replace(/\s/g, "");
    if (/^5\d{8}$/.test(to)) to = "+995" + to;
    if (/^0?5\d{8}$/.test(to)) to = "+995" + to.replace(/^0/, "");

    await reply(
      `📤 იგზავნება SMS...\n📛 Sender: ${sender}\n📱 Number: ${to}\n💬 Message:\n${messageText}`
    );

    // Twilio send (Unicode + full text, no truncation)
    const params = new URLSearchParams({
      From: sender,
      To: to,
      Body: messageText,
      SmartEncoding: "false"
    });

    let twResp = await fetch(
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
    let data = await twResp.json();

    // fallback to your number if sender name unsupported
    if (!twResp.ok || data.error_code) {
      if (TWILIO_NUMBER) {
        await reply(
          `⚠️ Sender '${sender}' may not be supported. Retrying from ${TWILIO_NUMBER}...`
        );

        const retryParams = new URLSearchParams({
          From: TWILIO_NUMBER,
          To: to,
          Body: messageText,
          SmartEncoding: "false"
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

    // report result back to Telegram
    if (data.error_code) {
      await reply(
        `⚠️ Twilio Error:\nMessage: ${data.message}\nCode: ${data.error_code}`
      );
    } else {
      await reply(
        `✅ SMS გაგზავნილია წარმატებით!\nSID: ${data.sid || "-"}\nSender: ${sender}\nNumber: ${to}\n💬 ტექსტი:\n${messageText}`
      );
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("Crash:", err);
    if (chatId) await reply("⚠️ Internal error: " + err.message);
    return res.status(200).send("error");
  }
}

