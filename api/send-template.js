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
  console.log("STEP 1 - API HIT", req.method);

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    console.log("STEP 2 - BODY", req.body);

    const requiredEnv = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PHONE_NUMBER_ID",
      "WHATSAPP_TOKEN",
    ];

    for (const key of requiredEnv) {
      if (!process.env[key]) {
        console.log("MISSING ENV:", key);
        return res.status(500).json({
          success: false,
          step: "env_check",
          error: `Missing ${key}`,
        });
      }
    }

    console.log("STEP 3 - ENV OK");

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    console.log("STEP 4 - SUPABASE CLIENT CREATED");

    const phone = cleanPhone(req.body.to);
    const customerName = String(req.body.name || "عميلنا العزيز").trim();
    const templateKey = String(req.body.templateKey || "offer1");
    const selectedTemplate = TEMPLATES[templateKey] || TEMPLATES.offer1;

    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone required" });
    }

    console.log("STEP 5 - SELECTED TEMPLATE", selectedTemplate.templateName);

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

    console.log("STEP 6 - BEFORE META FETCH");

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
        body: JSON.stringify(payload),
      },
    );

    console.log("STEP 7 - AFTER META FETCH", response.status);

    const data = await response.json();

    console.log("STEP 8 - META DATA", data);

    if (!response.ok) {
      const errorMessage = getMetaError(data);
      const errorCode = data?.error?.code || null;

      console.log("STEP 9 - META FAILED", errorMessage);

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

    console.log("STEP 10 - BEFORE SUPABASE INSERT");

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

    console.log("STEP 11 - DONE");

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
