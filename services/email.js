const axios = require("axios");

async function sendEmail(to, subject, htmlContent) {
    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || "no-reply@tastiekit.in";
    const fromName = process.env.EMAIL_FROM_NAME || "TastieKit";

    if (!apiKey) {
        throw new Error("Email service is not configured: BREVO_API_KEY missing");
    }

    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: {
                    name: fromName,
                    email: fromEmail,
                },
                to: [{ email: to }],
                subject: subject,
                htmlContent: htmlContent,
            },
            {
                headers: {
                    "api-key": apiKey,
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            }
        );

        console.log("Email sent to:", to);
    } catch (err) {
        const providerError =
            err.response?.data?.message ||
            err.response?.data?.code ||
            err.response?.data ||
            err.message;
        console.error("Brevo error:", providerError);
        throw new Error(`Failed to send email: ${providerError}`);
    }
}

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
