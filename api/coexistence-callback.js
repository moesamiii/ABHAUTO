import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const REDIRECT_URI = "https://abhauto.vercel.app/api/coexistence-callback";

export default async function handler(req, res) {
  const { code, error, error_reason, error_description } = req.query;

  if (error) {
    return res
      .status(400)
      .send(
        `WhatsApp connection cancelled: ${error_reason || error_description}`,
      );
  }

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const tokenUrl = new URL(
      "https://graph.facebook.com/v25.0/oauth/access_token",
    );

    tokenUrl.searchParams.set("client_id", process.env.META_APP_ID);
    tokenUrl.searchParams.set("client_secret", process.env.META_APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    tokenUrl.searchParams.set("code", code);

    const tokenResponse = await fetch(tokenUrl);
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error?.message || "Could not get access token");
    }

    const accessToken = tokenData.access_token;

    const wabaResponse = await fetch(
      `https://graph.facebook.com/v25.0/${process.env.META_BUSINESS_ID}/owned_whatsapp_business_accounts`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const wabaData = await wabaResponse.json();
    const wabaId = wabaData.data?.[0]?.id;

    if (!wabaResponse.ok || !wabaId) {
      throw new Error("Could not find WhatsApp Business Account");
    }

    const phonesResponse = await fetch(
      `https://graph.facebook.com/v25.0/${wabaId}/phone_numbers`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const phonesData = await phonesResponse.json();
    const phoneNumber = phonesData.data?.[0];

    if (!phonesResponse.ok || !phoneNumber?.id) {
      throw new Error("Could not find Phone Number ID");
    }

    const { error: saveError } = await supabase
      .from("whatsapp_connections")
      .upsert(
        {
          id: "abh",
          access_token: accessToken,
          waba_id: wabaId,
          phone_number_id: phoneNumber.id,
          display_phone_number: phoneNumber.display_phone_number || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    if (saveError) throw saveError;

    return res.redirect("/chat.html?coexistence=connected");
  } catch (error) {
    console.error("COEXISTENCE CALLBACK ERROR:", error);

    return res.status(500).send(`Connection failed: ${error.message}`);
  }
}
