import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Friendly Arabic text for the conversation list preview.
// This NEVER gets written into the messages table as a bubble —
// it only updates conversations.last_message.
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
        console.log("STATUS UPDATE:", JSON.stringify(s, null, 2));

        const waMessageId = s.id;
        const phone = s.recipient_id;
        const status = s.status;
        const errorMessage = s.errors?.[0]?.message || null;
        const errorCode = s.errors?.[0]?.code || null;

        // Update the existing message row only — never insert a new
        // "chat bubble" row for a status event.
        await supabase
          .from("messages")
          .update({
            status,
            error_message: errorMessage,
            error_code: errorCode,
          })
          .eq("wa_message_id", waMessageId);

        // Conversation list preview only — chat.html reads this for the
        // sidebar, not for the message bubbles.
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
        const text =
          message.text?.body || message.image?.caption || `[${message.type}]`;

        await supabase.from("messages").insert({
          wa_message_id: message.id,
          phone,
          direction: "incoming",
          message_type: message.type,
          message: text,
          status: "received",
        });

        await supabase.from("conversations").upsert(
          {
            phone,
            last_message: text,
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
