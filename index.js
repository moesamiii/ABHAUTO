require("dotenv").config();

console.log("🚀 NEW INDEX.JS LOADED");

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server route is working" });
});

app.post("/send-template", async (req, res) => {
  try {
    const { to, name } = req.body;

    if (!to || !name) {
      return res.status(400).json({
        success: false,
        error: "Phone and customer name are required",
      });
    }

    const payload = {
      messaging_product: "whatsapp",
      to: to.replace("+", ""),
      type: "template",
      template: {
        name: "abh_auto_offer_image_v1",
        language: {
          code: "ar",
        },
        components: [
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

    console.log("Meta response:", data);

    if (!response.ok) {
      return res.status(400).json({
        success: false,
        meta: data,
      });
    }

    res.json({
      success: true,
      data,
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
