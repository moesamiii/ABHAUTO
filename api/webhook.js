import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MEDIA_BUCKET = "whatsapp-media";

function getFriendlyStatusText(status, errorCode, errorMessage) {
  if (status === "read") return "✅ مقروءة";
  if (status === "delivered") return "✅ تم التسليم";
  if (status === "sent") return "✅ تم الإرسال";

  if (status === "failed") {
    if (errorCode === 131047) return "❌ العميل لم يتفاعل / لا يوجد opt-in";
    if (errorCode === 131049) return "❌ واتساب رفض الإرسال لحماية جودة الحساب";
    if (errorCode === 131026) return "❌ الرقم غير قابل للتسليم";
    return `❌ فشل الإرسال: ${errorMessage || "خطأ غير معروف"}`;
  }

  return status || "";
}

function getExtension(mimeType, filename = "") {
  const fromName = filename.split(".").pop()?.toLowerCase();

  if (filename.includes(".") && fromName) return fromName;

  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };

  return (
    extensions[mimeType] || mimeType?.split("/")[1]?.split(";")[0] || "bin"
  );
}

// ينزّل الملف من Meta فور وصوله ويحفظ نسخة دائمة في Supabase Storage
async function fetchAndStoreMedia(mediaId, originalFilename = "") {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    });

    const metaData = await metaRes.json();

    if (!metaRes.ok || !metaData.url) {
      console.error("MEDIA META LOOKUP FAILED:", metaData);
      return null;
    }

    const fileRes = await fetch(metaData.url, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    });

    if (!fileRes.ok) {
      console.error("MEDIA DOWNLOAD FAILED:", fileRes.status);
      return null;
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const mimeType =
      metaData.mime_type ||
      fileRes.headers.get("content-type") ||
      "application/octet-stream";

    const extension = getExtension(mimeType, originalFilename);
    const safeName = originalFilename
      ? originalFilename.replace(/[^\w.-]/g, "_")
      : `${mediaId}.${extension}`;

    const storagePath = `incoming/${Date.now()}-${mediaId}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("MEDIA UPLOAD ERROR:", uploadError);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(storagePath);

    const permanentUrl = publicUrlData?.publicUrl || null;

    console.log("MEDIA SAVED:", {
      mediaId,
      mimeType,
      storagePath,
      permanentUrl,
    });

    return permanentUrl;
  } catch (error) {
    console.error("MEDIA STORE ERROR:", error);
    return null;
  }
}

function getMediaObject(message) {
  return (
    message.image ||
    message.audio ||
    message.video ||
    message.document ||
    message.sticker ||
    null
  );
}

function getMessageText(message) {
  return (
    message.text?.body ||
    message.image?.caption ||
    message.document?.caption ||
    message.video?.caption ||
    `[${message.type || "unknown"}]`
  );
}

function getPreviewText(message) {
  if (message.type === "image") return message.image?.caption || "📷 صورة";
  if (message.type === "audio") return "🎤 رسالة صوتية";
  if (message.type === "video") return message.video?.caption || "🎥 فيديو";
  if (message.type === "document")
    return message.document?.caption || "📄 مستند";
  if (message.type === "sticker") return "🏷️ ملصق";

  return getMessageText(message);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const entries = req.body?.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        // حالات الرسائل المرسلة
        for (const statusItem of value.statuses || []) {
          const waMessageId = statusItem.id;
          const phone = statusItem.recipient_id;
          const status = statusItem.status;
          const errorMessage = statusItem.errors?.[0]?.message || null;
          const errorCode = statusItem.errors?.[0]?.code || null;

          await supabase
            .from("messages")
            .update({
              status,
              error_message: errorMessage,
              error_code: errorCode,
            })
            .eq("wa_message_id", waMessageId);

          if (phone) {
            await supabase.from("conversations").upsert(
              {
                phone,
                last_message: getFriendlyStatusText(
                  status,
                  errorCode,
                  errorMessage,
                ),
                last_message_at: new Date().toISOString(),
              },
              { onConflict: "phone" },
            );
          }
        }

        // رسائل العميل الواردة: نصوص، صور، مستندات، صوت، فيديو، ستيكر
        for (const message of value.messages || []) {
          const phone = message.from;
          const mediaObj = getMediaObject(message);

          let mediaUrl = null;

          if (mediaObj?.id) {
            mediaUrl = await fetchAndStoreMedia(
              mediaObj.id,
              mediaObj.filename || "",
            );
          }

          const { error: insertError } = await supabase
            .from("messages")
            .insert({
              wa_message_id: message.id,
              phone,
              direction: "incoming",
              message_type: message.type,
              message: getMessageText(message),
              media_url: mediaUrl,
              status: "received",
            });

          // WhatsApp قد يعيد إرسال نفس الـ webhook؛ لا نعتبر تكرار الرسالة خطأً خطيرًا
          if (insertError && insertError.code !== "23505") {
            console.error("MESSAGE INSERT ERROR:", insertError);
          }

          await supabase.from("conversations").upsert(
            {
              phone,
              last_message: getPreviewText(message),
              last_message_at: new Date().toISOString(),
            },
            { onConflict: "phone" },
          );

          console.log("INCOMING MESSAGE SAVED:", {
            phone,
            type: message.type,
            hasMedia: Boolean(mediaObj?.id),
            mediaStored: Boolean(mediaUrl),
          });
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
