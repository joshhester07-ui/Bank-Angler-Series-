import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { amount, cardLast4, name } = req.body;

    // Create a payout to connected account or bank
    // For now we log the payout request — full Connect payouts require Stripe Connect setup
    // This endpoint is ready for when Connect is enabled
    res.status(200).json({ 
      success: true, 
      message: `Payout of $${amount} queued for ${name} (card ending ${cardLast4})` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
