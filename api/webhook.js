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
      const message = value?.messages?.[0];

      if (!message) {
        console.log("No message found");
        return res.status(200).json({ success: true });
      }

      const phone = message.from;
      const text = message.text?.body || "";

      const { error: msgError } = await supabase.from("messages").insert({
        wa_message_id: message.id,
        phone,
        direction: "incoming",
        message_type: message.type,
        message: text,
        status: "received",
      });

      if (msgError) {
        console.error("MESSAGES INSERT ERROR:", msgError);
        return res
          .status(500)
          .json({ success: false, error: msgError.message });
      }

      const { error: convError } = await supabase.from("conversations").upsert(
        {
          phone,
          last_message: text,
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "phone" },
      );

      if (convError) {
        console.error("CONVERSATIONS UPSERT ERROR:", convError);
        return res
          .status(500)
          .json({ success: false, error: convError.message });
      }

      console.log("Message saved successfully");
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
