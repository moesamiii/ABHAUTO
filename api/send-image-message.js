import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function cleanPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getMetaError(data) {
  return data?.error?.message || "WhatsApp rejected the image message";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const { to, message, imageBase64, fileName, mimeType } = req.body;
    const phone = cleanPhone(to);

    if (!phone || !imageBase64 || !mimeType) {
      return res.status(400).json({
        success: false,
        step: "validation",
        error: "Missing phone or image",
      });
    }

    const base64Data = imageBase64.split(",")[1];
    const imageBuffer = Buffer.from(base64Data, "base64");

    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append(
      "file",
      new Blob([imageBuffer], { type: mimeType }),
      fileName || "image.jpg",
    );

    const uploadResponse = await fetch(
      `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
        body: formData,
      },
    );

    const uploadData = await uploadResponse.json();

    if (!uploadResponse.ok) {
      const errorMessage = getMetaError(uploadData);
      const errorCode = uploadData?.error?.code || null;

      await supabase.from("messages").insert({
        wa_message_id: null,
        phone,
        direction: "outgoing",
        message_type: "system",
        message: `Image upload failed: ${errorMessage}`,
        status: "failed",
        error_message: errorMessage,
        error_code: errorCode,
      });

      return res.status(400).json({
        success: false,
        step: "upload_image",
        error: errorMessage,
        meta: uploadData,
      });
    }

    const mediaId = uploadData.id;

    const sendResponse = await fetch(
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
          type: "image",
          image: {
            id: mediaId,
            caption: message || "",
          },
        }),
      },
    );

    const sendData = await sendResponse.json();

    if (!sendResponse.ok) {
      const errorMessage = getMetaError(sendData);
      const errorCode = sendData?.error?.code || null;

      await supabase.from("messages").insert({
        wa_message_id: null,
        phone,
        direction: "outgoing",
        message_type: "system",
        message: `Image send failed: ${errorMessage}`,
        status: "failed",
        error_message: errorMessage,
        error_code: errorCode,
      });

      return res.status(400).json({
        success: false,
        step: "send_image",
        error: errorMessage,
        meta: sendData,
      });
    }

    await supabase.from("messages").insert({
      wa_message_id: sendData.messages?.[0]?.id || null,
      phone,
      direction: "outgoing",
      message_type: "image",
      message: message || "Image sent",
      status: "accepted",
    });

    await supabase.from("conversations").upsert(
      {
        phone,
        last_message: message || "📷 صورة",
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "phone" },
    );

    return res.status(200).json({
      success: true,
      media_id: mediaId,
      data: sendData,
    });
  } catch (error) {
    console.error("SEND IMAGE ERROR:", error);
    return res.status(500).json({
      success: false,
      step: "server_error",
      error: error.message,
    });
  }
}
