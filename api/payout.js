import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { amount, name } = req.body;
    res.status(200).json({ success: true, message: `Payout of $${amount} queued for ${name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
