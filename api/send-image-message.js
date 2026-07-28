import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MEDIA_BUCKET = "whatsapp-media";

function cleanPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getMetaError(data) {
  return data?.error?.message || "WhatsApp rejected the media message";
}

function getMediaType(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  return "document";
}

function getExtension(mimeType = "", fileName = "") {
  if (fileName.includes(".")) {
    return fileName.split(".").pop().toLowerCase();
  }

  return mimeType.split("/")[1]?.split(";")[0] || "bin";
}

function buildMetaPayload(type, mediaId, caption, fileName) {
  if (type === "image") {
    return {
      type: "image",
      image: { id: mediaId, caption: caption || "" },
    };
  }

  if (type === "video") {
    return {
      type: "video",
      video: { id: mediaId, caption: caption || "" },
    };
  }

  if (type === "audio") {
    return {
      type: "audio",
      audio: { id: mediaId },
    };
  }

  return {
    type: "document",
    document: {
      id: mediaId,
      caption: caption || "",
      filename: fileName || "document",
    },
  };
}

function previewForType(type, caption) {
  if (caption) return caption;
  if (type === "image") return "📷 صورة";
  if (type === "video") return "🎥 فيديو";
  if (type === "audio") return "🎤 رسالة صوتية";
  return "📄 مستند";
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
        error: "Missing phone, file, or file type",
      });
    }

    const base64Data = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;

    const fileBuffer = Buffer.from(base64Data, "base64");
    const mediaType = getMediaType(mimeType);
    const extension = getExtension(mimeType, fileName || "");

    const safeFileName = (fileName || `file.${extension}`).replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    );

    // نسخة دائمة في Supabase ليبقى الملف ظاهرًا في الشات لاحقًا
    const storagePath = `outgoing/${Date.now()}-${safeFileName}`;

    let mediaUrl = null;

    const { error: storageError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      console.error("OUTGOING MEDIA STORAGE ERROR:", storageError);
    } else {
      const { data: publicUrlData } = supabase.storage
        .from(MEDIA_BUCKET)
        .getPublicUrl(storagePath);

      mediaUrl = publicUrlData?.publicUrl || null;
    }

    // رفع الملف إلى Meta للحصول على media ID
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append(
      "file",
      new Blob([fileBuffer], { type: mimeType }),
      safeFileName,
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
        message: `Media upload failed: ${errorMessage}`,
        status: "failed",
        error_message: errorMessage,
        error_code: errorCode,
      });

      return res.status(400).json({
        success: false,
        step: "upload_media",
        error: errorMessage,
      });
    }

    // إرسال نوع الملف الصحيح إلى واتساب
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
          ...buildMetaPayload(mediaType, uploadData.id, message, safeFileName),
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
        message: `Media send failed: ${errorMessage}`,
        status: "failed",
        error_message: errorMessage,
        error_code: errorCode,
      });

      return res.status(400).json({
        success: false,
        step: "send_media",
        error: errorMessage,
      });
    }

    await supabase.from("messages").insert({
      wa_message_id: sendData.messages?.[0]?.id || null,
      phone,
      direction: "outgoing",
      message_type: mediaType,
      message: message || `[${mediaType}]`,
      media_url: mediaUrl,
      status: "accepted",
    });

    await supabase.from("conversations").upsert(
      {
        phone,
        last_message: previewForType(mediaType, message),
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "phone" },
    );

    return res.status(200).json({
      success: true,
      type: mediaType,
      media_url: mediaUrl,
      data: sendData,
    });
  } catch (error) {
    console.error("SEND MEDIA ERROR:", error);

    return res.status(500).json({
      success: false,
      step: "server_error",
      error: error.message,
    });
  }
}
