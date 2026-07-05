import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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
            last_message:
              status === "failed"
                ? `Message failed: ${errorMessage || errorCode}`
                : `Message status: ${status}`,
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
