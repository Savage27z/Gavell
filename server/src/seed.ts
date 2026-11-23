import type { Risk } from "./types.js";

interface Seed {
  chatTitle: string;
  username: string | null;
  text: string;
  risk: Risk;
  score: number;
  reason: string;
  offenses: number;
}

export const seeds: Seed[] = [
  { chatTitle: "Solana Degens", username: "support_agent_sol", text: "Hello, I'm from Phantom Support. Your wallet has a sync error. DM me now to validate your wallet: phantom-validate.xyz", risk: "high", score: 0.96, reason: "Fake support + wallet link", offenses: 1 },
  { chatTitle: "ETH Builders", username: "airdrop_hunter88", text: "Claim your free ARB airdrop before it expires! Connect wallet at arb-claims.top/claim", risk: "high", score: 0.93, reason: "Wallet/airdrop lure + link", offenses: 3 },
  { chatTitle: "Bitcoin Talk", username: null, text: "Send 0.1 BTC and receive 0.2 BTC back instantly. Guaranteed, verified giveaway by Michael Saylor!", risk: "high", score: 0.95, reason: "Double-your-crypto giveaway", offenses: 1 },
  { chatTitle: "Solana Degens", username: "mod_helpdesk_", text: "Admin here. To keep access, verify with your 12-word seed phrase in DM. Urgent.", risk: "high", score: 0.98, reason: "Asks for seed phrase", offenses: 2 },
  { chatTitle: "NFT Alpha", username: "mint_whale", text: "FREE mint live for 10 minutes only! Mint now bit.ly/free-mint-now before it's gone", risk: "high", score: 0.85, reason: "Fake free mint + short link", offenses: 1 },
  { chatTitle: "DeFi Yield Club", username: "yield_king", text: "Make 300% daily profit with my trading signals. 100% risk-free. DM me for the private group", risk: "high", score: 0.9, reason: "Too-good-to-be-true profit", offenses: 1 },
  { chatTitle: "ETH Builders", username: "recovery_expert_jo", text: "Lost funds to a scam? I recovered 4 ETH for a friend, message me on WhatsApp +1 555 013 2290", risk: "high", score: 0.88, reason: "Fund recovery pitch", offenses: 1 },
  { chatTitle: "Bitcoin Talk", username: "binance_official_help", text: "Your Binance account is limited. Contact support immediately: t.me/binance_helpdesk_24", risk: "high", score: 0.87, reason: "Fake exchange support", offenses: 2 },
  { chatTitle: "Solana Degens", username: "pump_insider", text: "Insider pump group starting soon, 50x guaranteed. Join t.me/+AbCdEf123 last chance", risk: "medium", score: 0.7, reason: "Pump group invite", offenses: 1 },
  { chatTitle: "DeFi Yield Club", username: "newbie2024", text: "hey guys, can someone dm me? my wallet won't connect to the dapp, pls help", risk: "medium", score: 0.45, reason: "Asks to DM (maybe benign)", offenses: 1 },
  { chatTitle: "NFT Alpha", username: "collector_x", text: "Check my new collection on opensea https://opensea.io/collection/pixel-pets", risk: "low", score: 0.4, reason: "Self-promo link", offenses: 1 },
  { chatTitle: "ETH Builders", username: "arb_claim_bot", text: "ARB airdrop is live, connect your wallet at arb-claims.top/claim before it closes", risk: "high", score: 0.9, reason: "Wallet/airdrop lure + link", offenses: 1 },
  { chatTitle: "ETH Builders", username: "claim_arb_now", text: "Last chance: claim ARB tokens at arb-claims.top/claim, wallet connect required", risk: "high", score: 0.9, reason: "Wallet/airdrop lure + link", offenses: 1 },
  { chatTitle: "ETH Builders", username: "arbdrop_team", text: "Official ARB giveaway. Claim at arb-claims.top/claim and connect wallet", risk: "high", score: 0.9, reason: "Wallet/airdrop lure + link", offenses: 1 },
  { chatTitle: "Bitcoin Talk", username: "hodler_anna", text: "Free BTC faucet giveaway going on in my channel, check it out", risk: "medium", score: 0.5, reason: "Giveaway bait", offenses: 1 },
];
