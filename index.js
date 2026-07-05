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

      // Send ONLY the approved offer template — no text message before it
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
        success: offerResult.ok,
        offerData: offerResult.data,
      });

      // keep spacing between numbers when sending to multiple recipients
      await delay(3000);
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
