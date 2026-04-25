const axios = require("axios");

/**
 * Sends an HTML email via Brevo (Sendinblue).
 *
 * Returns an object: { sent: true } on success.
 * Throws ONLY when credentials are present but Brevo itself returns an error.
 * When credentials are simply missing (EMAIL_FROM / BREVO_API_KEY not set)
 * it resolves with { sent: false, reason: "...missing" } so callers can
 * decide what to do (e.g. return the OTP in the response for development).
 */
async function sendEmail(to, subject, htmlContent) {
    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.EMAIL_FROM;
    const fromName = process.env.EMAIL_FROM_NAME || "TastieKit";

    // --- credential checks (non-fatal) ---
    if (!apiKey) {
        console.warn("[email] BREVO_API_KEY not set – email will NOT be sent.");
        return { sent: false, reason: "BREVO_API_KEY missing" };
    }

    if (!fromEmail) {
        console.warn("[email] EMAIL_FROM not set – email will NOT be sent.");
        return { sent: false, reason: "EMAIL_FROM missing" };
    }

    // --- actual send ---
    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: { name: fromName, email: fromEmail },
                to: [{ email: to }],
                subject,
                htmlContent,
            },
            {
                headers: {
                    "api-key": apiKey,
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            }
        );

        console.log("[email] Sent to:", to);
        return { sent: true };
    } catch (err) {
        const providerError =
            err.response?.data?.message ||
            err.response?.data?.code ||
            err.response?.data ||
            err.message;
        console.error("[email] Brevo error:", providerError);
        throw new Error(`Failed to send email: ${providerError}`);
    }
}

/**
 * Tiny helper used by admin routes to embed delivery-partner info in emails.
 */
const formatDeliveryPartnerHtml = (partner) => `
    <div style="margin-top:20px; padding:16px; background:#fff4f4; border-radius:12px;">
      <h3 style="margin:0 0 10px; color:#E53935;">Delivery Partner Details</h3>
      <p style="margin:4px 0;"><strong>Name:</strong> ${partner.name}</p>
      <p style="margin:4px 0;"><strong>Phone:</strong> ${partner.phone || "Not available"}</p>
    </div>
`;

module.exports = {
    sendEmail,
    formatDeliveryPartnerHtml,
};
