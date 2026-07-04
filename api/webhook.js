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
      const body = req.body;

      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return res.status(200).json({ success: true });
      }

      const phone = message.from;
      const text = message.text?.body || "";

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
          unread_count: 1,
        },
        { onConflict: "phone" },
      );

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
