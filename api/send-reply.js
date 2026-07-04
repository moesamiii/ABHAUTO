import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res
        .status(400)
        .json({ success: false, error: "Missing to or message" });
    }

    const response = await fetch(
      `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: {
            body: message,
          },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ success: false, error: data });
    }

    await supabase.from("messages").insert({
      wa_message_id: data.messages?.[0]?.id,
      phone: to,
      direction: "outgoing",
      message_type: "text",
      message,
      status: "sent",
    });

    await supabase.from("conversations").upsert(
      {
        phone: to,
        last_message: message,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "phone" },
    );

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
