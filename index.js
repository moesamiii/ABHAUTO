require("dotenv").config();

console.log("🚀 NEW INDEX.JS LOADED");

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWhatsAppMessage(payload) {
  const response = await fetch(
    `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json();

  return {
    ok: response.ok,
    data,
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server route is working" });
});

app.post("/send-template", async (req, res) => {
  try {
    const { to, numbers, name } = req.body;

    const finalNumbers = Array.isArray(numbers)
      ? numbers
      : String(to || "")
          .split(/\n|,/)
          .map((n) => n.trim())
          .filter(Boolean);

    if (!finalNumbers.length || !name) {
      return res.status(400).json({
        success: false,
        error: "Phone numbers and customer name are required",
      });
    }

    const results = [];

    for (const phone of finalNumbers) {
      const cleanPhone = phone.replace("+", "").replace(/\s/g, "");

      // 1) Send first text template: مرحبا
      const helloPayload = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: "abh_auto_hello_v1",
          language: {
            code: "ar",
          },
        },
      };

      const helloResult = await sendWhatsAppMessage(helloPayload);

      console.log(
        "Hello response for",
        cleanPhone,
        JSON.stringify(helloResult.data, null, 2),
      );

      // 2) Wait 3 seconds
      await delay(3000);

      // 3) Send image offer template
      const offerPayload = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: "abh_auto_offer_image_v1",
          language: {
            code: "ar",
          },
          components: [
            {
              type: "header",
              parameters: [
                {
                  type: "image",
                  image: {
                    link: "https://abhauto.vercel.app/offer1.jpeg",
                  },
                },
              ],
            },
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  text: name,
                },
              ],
            },
          ],
        },
      };

      const offerResult = await sendWhatsAppMessage(offerPayload);

      console.log(
        "Offer response for",
        cleanPhone,
        JSON.stringify(offerResult.data, null, 2),
      );

      results.push({
        to: cleanPhone,
        helloSuccess: helloResult.ok,
        offerSuccess: offerResult.ok,
        success: helloResult.ok && offerResult.ok,
        helloData: helloResult.data,
        offerData: offerResult.data,
      });
    }

    res.json({
      success: true,
      total: finalNumbers.length,
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (error) {
    console.log("Server error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=================================");
  console.log(`✅ Dashboard running: http://localhost:${PORT}`);
  console.log("PHONE_NUMBER_ID:", process.env.PHONE_NUMBER_ID);
  console.log("TOKEN EXISTS:", !!process.env.WHATSAPP_TOKEN);
  console.log("=================================");
});
