import { createClient } from "@supabase/supabase-js";

function cleanPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getMetaError(data) {
  return data?.error?.message || "WhatsApp rejected the template message";
}

// Real customer-facing text of the template body (used so the chat bubble
// shows actual content the customer received, not an internal admin note)
const TEMPLATE_CUSTOMER_TEXT =
  "سيارتك تستحق عناية تليق فيها ✨🚗 استفد من عرض ABH Auto على خدمات العناية بالسيارات، التظليل الحراري، النانو سيراميك، والحماية. اضغط على الزر بالأسفل للحجز أو لمعرفة التفاصيل.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    if (!process.env.PHONE_NUMBER_ID)
      throw new Error("Missing PHONE_NUMBER_ID");
    if (!process.env.WHATSAPP_TOKEN) throw new Error("Missing WHATSAPP_TOKEN");

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const phone = cleanPhone(req.body.to);
    const customerName = String(req.body.name || "عميلنا العزيز").trim();

    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone required" });
    }

    const payload = {
      messaging_product: "whatsapp",
      to: phone,
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
            parameters: [{ type: "text", text: customerName }],
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

    if (!response.ok) {
      const errorMessage = getMetaError(data);
      const errorCode = data?.error?.code || null;

      // Logged as "system" so it never renders as a chat bubble,
      // but is still tracked in the messages table for reporting.
      await supabase.from("messages").insert({
        wa_message_id: null,
        phone,
        direction: "outgoing",
        message_type: "system",
        message: `Template failed: ${errorMessage}`,
        status: "failed",
        error_message: errorMessage,
        error_code: errorCode,
      });

      return res.status(400).json({
        success: false,
        step: "send_template",
        error: errorMessage,
        meta: data,
      });
    }

    // Store the REAL customer-facing content, not an internal note
    await supabase.from("messages").insert({
      wa_message_id: data.messages?.[0]?.id || null,
      phone,
      direction: "outgoing",
      message_type: "template",
      message: TEMPLATE_CUSTOMER_TEXT,
      status: "accepted",
    });

    await supabase.from("conversations").upsert(
      {
        phone,
        customer_name: customerName,
        last_message: TEMPLATE_CUSTOMER_TEXT,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "phone" },
    );

    return res.status(200).json({
      success: true,
      message: "Template accepted by WhatsApp",
      data,
    });
  } catch (error) {
    console.error("SEND TEMPLATE ERROR:", error);
    return res.status(500).json({
      success: false,
      step: "server_error",
      error: error.message,
    });
  }
}
