import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export default async function handler(req, res) {
  const { phone } = req.query;

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("phone", phone)
    .order("id", { ascending: true });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.status(200).json({ success: true, messages: data });
}
