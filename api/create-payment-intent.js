import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { amount, email, name, tournamentId, tournamentName } = req.body;
    const origin = req.headers.origin || "https://bankanglerseries.com";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: tournamentName || "Bank Angler Series Entry Fee",
            description: `Tournament entry fee for ${name}`,
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode: "payment",
      customer_email: email,
      metadata: { name, email, tournamentId },
      success_url: `${origin}?payment=success&tournament=${tournamentId}`,
      cancel_url: `${origin}?payment=cancelled`,
    });

    res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
