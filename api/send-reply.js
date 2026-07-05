import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function cleanPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getMetaError(data) {
  return data?.error?.message || data?.error || "WhatsApp API error";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const phone = cleanPhone(req.body.to);
    const message = String(req.body.message || "").trim();

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: "Missing phone or message",
      });
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
          to: phone,
          type: "text",
          text: { body: message },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      await supabase.from("messages").insert({
        wa_message_id: null,
        phone,
        direction: "outgoing",
        message_type: "text",
        message,
        status: "failed",
        error: JSON.stringify(data),
      });

      return res.status(400).json({
        success: false,
        step: "send_text",
        error: getMetaError(data),
        meta: data,
      });
    }

    await supabase.from("messages").insert({
      wa_message_id: data.messages?.[0]?.id || null,
      phone,
      direction: "outgoing",
      message_type: "text",
      message,
      status: "accepted",
    });

    await supabase.from("conversations").upsert(
      {
        phone,
        last_message: message,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "phone" },
    );

    return res.status(200).json({
      success: true,
      message: "Message accepted by WhatsApp",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      step: "server_error",
      error: error.message,
    });
  }
}
