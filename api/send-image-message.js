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
    const { to, message, imageBase64, fileName, mimeType } = req.body;

    const phone = String(to || "").replace(/\D/g, "");

    if (!phone || !imageBase64 || !mimeType) {
      return res.status(400).json({
        success: false,
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
      return res.status(400).json({
        success: false,
        step: "upload_image",
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
      return res.status(400).json({
        success: false,
        step: "send_image",
        meta: sendData,
      });
    }

    await supabase.from("messages").insert({
      wa_message_id: sendData.messages?.[0]?.id || null,
      phone,
      direction: "outgoing",
      message_type: "image",
      message: message || "Image sent",
      status: "sent",
    });

    await supabase.from("conversations").upsert(
      {
        phone,
        last_message: message || "Image sent",
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
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
