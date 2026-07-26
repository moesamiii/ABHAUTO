import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Friendly Arabic text for the conversation list preview.
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

  return status;
}

// NEW: pulls the temporary Meta media URL, downloads the file, and
// re-uploads it to Supabase Storage so we have a permanent link.
// Meta's own media URLs expire after a few hours, so we can't store
// those directly — we have to make our own copy.
async function fetchAndStoreMedia(mediaId) {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    });
    const metaData = await metaRes.json();

    if (!metaRes.ok || !metaData.url) {
      console.error("MEDIA META LOOKUP FAILED:", metaData);
      return null;
    }

    const fileRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    });

    if (!fileRes.ok) {
      console.error("MEDIA DOWNLOAD FAILED:", fileRes.status);
      return null;
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const mimeType = metaData.mime_type || "application/octet-stream";
    const ext = mimeType.split("/")[1]?.split(";")[0] || "bin";
    const path = `incoming/${mediaId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) {
      console.error("MEDIA UPLOAD ERROR:", uploadError);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from("whatsapp-media")
      .getPublicUrl(path);

    return publicUrlData?.publicUrl || null;
  } catch (err) {
    console.error("MEDIA STORE ERROR:", err);
    return null;
  }
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

  if (req.method === "POST") {
    try {
      console.log("WEBHOOK BODY:", JSON.stringify(req.body, null, 2));

      const value = req.body?.entry?.[0]?.changes?.[0]?.value;

      // ✅ 1) WhatsApp delivery statuses: sent / delivered / read / failed
      const statuses = value?.statuses || [];

      for (const s of statuses) {
        const waMessageId = s.id;
        const phone = s.recipient_id;
        const status = s.status;
        const errorMessage = s.errors?.[0]?.message || null;
        const errorCode = s.errors?.[0]?.code || null;

        await supabase
          .from("messages")
          .update({
            status,
            error_message: errorMessage,
            error_code: errorCode,
          })
          .eq("wa_message_id", waMessageId);

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

      // ✅ 2) Incoming customer messages
      const messages = value?.messages || [];

      for (const message of messages) {
        const phone = message.from;

        // Any of these message types can carry a media "id" from Meta.
        const mediaObj =
          message.image ||
          message.audio ||
          message.video ||
          message.document ||
          message.sticker ||
          null;

        let mediaUrl = null;
        if (mediaObj?.id) {
          mediaUrl = await fetchAndStoreMedia(mediaObj.id);
        }

        const text =
          message.text?.body ||
          message.image?.caption ||
          message.document?.caption ||
          message.video?.caption ||
          `[${message.type}]`;

        // Preview text for the sidebar — keep media types readable even
        // when there's no caption.
        const previewText =
          message.type === "image"
            ? message.image?.caption || "📷 صورة"
            : message.type === "audio"
              ? "🎤 رسالة صوتية"
              : message.type === "video"
                ? message.video?.caption || "🎥 فيديو"
                : message.type === "document"
                  ? message.document?.caption || "📄 مستند"
                  : text;

        await supabase.from("messages").insert({
          wa_message_id: message.id,
          phone,
          direction: "incoming",
          message_type: message.type,
          message: text,
          media_url: mediaUrl,
          status: "received",
        });

        await supabase.from("conversations").upsert(
          {
            phone,
            last_message: previewText,
            last_message_at: new Date().toISOString(),
          },
          { onConflict: "phone" },
        );
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

  return res.status(405).json({ error: "Method not allowed" });
}
