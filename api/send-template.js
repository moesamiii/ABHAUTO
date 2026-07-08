import { createClient } from "@supabase/supabase-js";

function cleanPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getMetaError(data) {
  return data?.error?.message || "WhatsApp rejected the template message";
}

const TEMPLATES = {
  offer1: {
    templateName: "abh_auto_offer_image_v1",
    languageCode: "ar",
    imageLink: "https://abhauto.vercel.app/offer1.jpeg",
    customerText:
      "سيارتك تستحق عناية تليق فيها ✨🚗 استفد من عرض ABH Auto على خدمات العناية بالسيارات، التظليل الحراري، النانو سيراميك، والحماية. اضغط على الزر بالأسفل للحجز أو لمعرفة التفاصيل.",
    useCustomerName: true,
  },

  offer2: {
    templateName: "image_template_2",
    languageCode: "ar",
    imageLink: "https://abhauto.vercel.app/offer2.jpeg",
    customerText:
      "كودك صار له قيمة مع ABH Auto ✨ سجل في الموقع، واحصل على كودك، وشاركه مع أصدقائك. كل استخدام ناجح للكود يمنحك خصماً ويمنحهم خصماً أيضاً. اضغط على الزر بالأسفل للتسجيل الآن.",
    useCustomerName: true,
  },
};

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
    const templateKey = String(req.body.templateKey || "offer1");

    const selectedTemplate = TEMPLATES[templateKey] || TEMPLATES.offer1;

    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone required" });
    }

    const components = [
      {
        type: "header",
        parameters: [
          {
            type: "image",
            image: {
              link: selectedTemplate.imageLink,
            },
          },
        ],
      },
    ];

    if (selectedTemplate.useCustomerName) {
      components.push({
        type: "body",
        parameters: [{ type: "text", text: customerName }],
      });
    }

    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: selectedTemplate.templateName,
        language: { code: selectedTemplate.languageCode },
        components,
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
        selectedTemplate: selectedTemplate.templateName,
        error: errorMessage,
        meta: data,
      });
    }

    await supabase.from("messages").insert({
      wa_message_id: data.messages?.[0]?.id || null,
      phone,
      direction: "outgoing",
      message_type: "template",
      message: selectedTemplate.customerText,
      status: "accepted",
    });

    await supabase.from("conversations").upsert(
      {
        phone,
        customer_name: customerName,
        last_message: selectedTemplate.customerText,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "phone" },
    );

    return res.status(200).json({
      success: true,
      message: "Template accepted by WhatsApp",
      selectedTemplate: selectedTemplate.templateName,
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
