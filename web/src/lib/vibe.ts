/**
 * Money "vibe" for the dashboard hero - turns cash-after-bills into a colour + a
 * rotating one-liner, so the balance has personality. Each tier has a pool of
 * lines the hero cycles through every few minutes. Tiers are tuned to the owner's real
 * numbers (salary ~R40k, normal mid-month ~R5-10k), so ~R7k is the "fuck yeah"
 * zone and the lavish stuff is reserved for just-after-payday. Emoji is baked into
 * each line. Keep them punchy; a little SA flavour 🇿🇦.
 */
export interface Vibe {
  lines: string[];
  gradient: string; // hero background gradient classes
  accent: string; // text colour for the line
}

const NEUTRAL: Vibe = {
  lines: ["🙈 Balances hidden"],
  gradient: "from-indigo-600/25 via-neutral-900 to-neutral-900",
  accent: "text-neutral-400",
};

const TIERS: { min: number; vibe: Vibe }[] = [
  {
    min: 25000,
    vibe: {
      gradient: "from-emerald-500/30 via-indigo-900/20 to-neutral-900",
      accent: "text-emerald-300",
      lines: [
        "🤑 Wallet looking THICC.",
        '👑 The bank called. They said "damn."',
        "🚀 Financial trajectory: up only.",
        "🤑 Rich for approximately 36 hours. Enjoy it.",
        "🏖️ One bad decision away from a holiday.",
        "💸 Looking financially irresponsible - in the best way.",
      ],
    },
  },
  {
    min: 12000,
    vibe: {
      gradient: "from-emerald-500/25 via-neutral-900 to-neutral-900",
      accent: "text-emerald-300",
      lines: [
        "😎 Look at you, stable and everything.",
        "💼 Money's working with you today.",
        "📈 Your accountant would be proud.",
        "😌 Bills? Never heard of them.",
        "🇿🇦 Sharp! Looking lekker.",
        "🍻 You could buy a round… probably don't.",
      ],
    },
  },
  {
    min: 5000,
    vibe: {
      gradient: "from-emerald-600/25 via-neutral-900 to-neutral-900",
      accent: "text-emerald-400",
      lines: [
        "😎 Fuck yeah - that's my money.",
        "👍 You're doing alright, champ.",
        "☕ Coffee's still on the menu.",
        "🇿🇦 Ja nee, we're chilling.",
        "😏 Not rich, not worried.",
        "🚗 Still got petrol money. We Ride!",
      ],
    },
  },
  {
    min: 2500,
    vibe: {
      gradient: "from-amber-500/25 via-neutral-900 to-neutral-900",
      accent: "text-amber-400",
      lines: [
        "🤔 Maybe chill on Takealot…",
        "🍔 Do you really need that Uber Eats?",
        "💳 Your card's starting to sweat.",
        "🇿🇦 Eish… that Takealot order.",
        "☕ Homemade coffee tastes better anyway.",
        "🎮 Steam sale? Walk away.",
      ],
    },
  },
  {
    min: 800,
    vibe: {
      gradient: "from-orange-600/30 via-neutral-900 to-neutral-900",
      accent: "text-orange-400",
      lines: [
        "😅 Survival mode engaged.",
        "🍜 Instant noodles are looking premium.",
        "🥲 Remember that savings goal?",
        "🇿🇦 Ag nee man…",
        "🛋️ Staying home suddenly sounds fun.",
        "🤞 Payday isn't that far away.",
      ],
    },
  },
  {
    min: 0,
    vibe: {
      gradient: "from-rose-600/30 via-neutral-900 to-neutral-900",
      accent: "text-rose-400",
      lines: [
        "💀 Ow sheet… here we go again.",
        "🚨 DEFCON 1.",
        "🍞 Bread and two-minute noodles it is.",
        "📞 Mum… hypothetically…",
        "🇿🇦 Yoh. Taxi money only.",
        "🏃 Run. Don't shop.",
      ],
    },
  },
];

const OVERDRAWN: Vibe = {
  gradient: "from-rose-700/40 via-neutral-900 to-neutral-900",
  accent: "text-rose-400",
  lines: [
    "🪦 Wallet status: deceased.",
    "💀 Ay karamba. That's a hole, not a balance.",
    "🫡 It's been an honour.",
    "💳 Your bank card has trust issues.",
    "🧻 Hope you've already got the toilet paper.",
  ],
};

export function moneyVibe(amount: number | null, hidden = false): Vibe {
  if (hidden || amount === null) return NEUTRAL;
  if (amount < 0) return OVERDRAWN;
  for (const t of TIERS) if (amount >= t.min) return t.vibe;
  return OVERDRAWN;
}
