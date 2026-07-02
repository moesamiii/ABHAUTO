export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to, name } = req.body;

    const payload = {
      messaging_product: "whatsapp",
      to: to.replace("+", ""),
      type: "template",
      template: {
        name: "abh_auto_offer_image_v1",
        language: { code: "ar" },
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
            parameters: [{ type: "text", text: name }],
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
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ success: false, meta: data });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
